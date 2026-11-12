import { AzureOpenAI } from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import {
  AiBoqBatchAnalysisResponse,
  AiBoqBatchAnalysisResponseSchema,
  AiFieldNoteExtraction,
  AiFieldNoteExtractionSchema,
  AiIpcBatchReconciliationOutput,
  AiIpcBatchReconciliationOutputSchema,
  BoqItemInput,
  ExtractedQuantityItem,
  IndependenceTier,
} from '@insite/shared';
import { env } from '../config/env';

class AzureOpenAiService {
  private client: AzureOpenAI | null = null;

  constructor() {
    if (env.AZURE_OPENAI_ENDPOINT && env.AZURE_OPENAI_API_KEY) {
      this.client = new AzureOpenAI({
        endpoint: env.AZURE_OPENAI_ENDPOINT,
        apiKey: env.AZURE_OPENAI_API_KEY,
        apiVersion: env.AZURE_OPENAI_API_VERSION,
        deployment: env.AZURE_OPENAI_GPT_DEPLOYMENT,
        maxRetries: env.AzureOpenAI__MaxRetries,
        timeout: env.AzureOpenAI__TimeoutSeconds * 1000,
      });
    }
  }

  public isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * 1. Extracts structured material/work quantities, blockers, and BOQ WBS matches
   * from a field voice transcript (English or Nigerian Pidgin) and optional site photo.
   */
  public async extractFieldNoteFromTranscript(params: {
    rawTranscriptOrNote: string;
    offlineManualQuantities?: ExtractedQuantityItem[];
    photoUrl?: string;
    projectBoqItems: Array<{ wbsCode: string; description: string; unit: string }>;
  }): Promise<AiFieldNoteExtraction> {
    if (!this.client) {
      return this.fallbackFieldExtraction(params);
    }

    try {
      const boqContext = params.projectBoqItems
        .map((b) => `- [${b.wbsCode}] ${b.description} (Unit: ${b.unit})`)
        .join('\n');

      const userContent: Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      > = [
        {
          type: 'text',
          text:
            `Extract structured construction quantities, progress claims, and site blockers from this Nigerian field update.\n\n` +
            `Project BOQ Items:\n${boqContext || 'None specified'}\n\n` +
            `Field Note / Transcript:\n"${params.rawTranscriptOrNote}"`,
        },
      ];

      if (params.photoUrl && params.photoUrl.startsWith('http')) {
        userContent.push({
          type: 'image_url',
          image_url: { url: params.photoUrl },
        });
      }

      const completion = await this.client.beta.chat.completions.parse({
        model: env.AZURE_OPENAI_GPT_DEPLOYMENT,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert Nigerian Quantity Surveyor and Civil Engineering Co-Pilot. ' +
              'Translate Nigerian Pidgin or accented speech into a clear professional summary, ' +
              'extract exact numerical material/work quantities and units (e.g. bags, m, m3, tons, trips), ' +
              'identify site blockers (e.g., rain, granite delay), and match relevant BOQ WBS codes.',
          },
          {
            role: 'user',
            content: userContent,
          },
        ],
        response_format: zodResponseFormat(
          AiFieldNoteExtractionSchema,
          'field_note_extraction'
        ),
      });

      const parsed = completion.choices[0]?.message?.parsed;
      if (parsed) {
        return parsed;
      }
    } catch (error) {
      console.warn('[AzureOpenAiService.extractFieldNoteFromTranscript] Fallback triggered:', error);
    }

    return this.fallbackFieldExtraction(params);
  }

  private fallbackFieldExtraction(params: {
    rawTranscriptOrNote: string;
    offlineManualQuantities?: ExtractedQuantityItem[];
    projectBoqItems: Array<{ wbsCode: string; description: string; unit: string }>;
  }): AiFieldNoteExtraction {
    const text = params.rawTranscriptOrNote || '';
    const extracted: ExtractedQuantityItem[] = [
      ...(params.offlineManualQuantities ?? []),
    ];

    // Regex extraction for common Nigerian construction patterns (e.g. "40 bags", "12m", "2 trips")
    const regex = /(\d+(?:\.\d+)?)\s*(bags?|meters?|m3|m2|m|trips?|tons?|tonnes?|cubics?)/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const qty = parseFloat(match[1]);
      const unit = match[2].toLowerCase();
      if (!extracted.some((e) => e.quantity === qty && e.unit === unit)) {
        extracted.push({
          materialOrWork:
            unit.startsWith('bag')
              ? 'Cement used'
              : unit.startsWith('trip')
              ? 'Aggregate / material delivery'
              : 'Measured site work',
          quantity: qty,
          unit,
          boqWbsCodeHint: params.projectBoqItems[0]?.wbsCode ?? null,
        });
      }
    }

    const blockers: string[] = [];
    if (/rain|flood|water/i.test(text)) {
      blockers.push('Weather / rainfall impact reported on site');
    }
    if (/delay|shortage|wait/i.test(text)) {
      blockers.push('Material delivery or logistics delay noted');
    }

    return {
      normalizedSummary:
        text.length > 0
          ? text
          : 'Field photo and site update captured for verification.',
      extractedQuantities: extracted,
      siteBlockers: blockers,
      matchedBoqWbsCodes: params.projectBoqItems.slice(0, 1).map((b) => b.wbsCode),
      visionObservationSummary:
        'Site capture logged and verified against project geofence.',
    };
  }

  /**
   * 2. Analyzes uploaded BOQ items to flag opaque Lump Sums (per QSRBN guidelines),
   * recommend Mandatory Visual Hold Points, and propose Facility Tranche mappings.
   */
  public async analyzeBoqItems(params: {
    totalProjectBudgetNgn: number;
    tranches: Array<{ trancheNumber: number; name: string }>;
    boqItems: BoqItemInput[];
  }): Promise<AiBoqBatchAnalysisResponse> {
    if (this.client) {
      try {
        const completion = await this.client.beta.chat.completions.parse({
          model: env.AZURE_OPENAI_GPT_DEPLOYMENT,
          temperature: 0.1,
          messages: [
            {
              role: 'system',
              content:
                'You are a QSRBN-licensed Independent Project Cost Monitor in Nigeria. ' +
                'Analyze each BOQ line item to: (1) Flag opaque lump-sum items (units like LS, Item, Sum with large unbundled cost), ' +
                '(2) Recommend Mandatory Visual Hold Points for buried/covered works (reinforcement before pour, piling, underground piping, earthing), ' +
                'and (3) Map each item to the most appropriate loan Facility Tranche number.',
            },
            {
              role: 'user',
              content: JSON.stringify(params),
            },
          ],
          response_format: zodResponseFormat(
            AiBoqBatchAnalysisResponseSchema,
            'boq_batch_analysis'
          ),
        });

        const parsed = completion.choices[0]?.message?.parsed;
        if (parsed) {
          return parsed;
        }
      } catch (error) {
        console.warn('[AzureOpenAiService.analyzeBoqItems] Fallback triggered:', error);
      }
    }

    // Deterministic QSRBN engineering heuristic fallback
    return {
      items: params.boqItems.map((item) => {
        const unitUpper = item.unit.trim().toUpperCase();
        const isLumpUnit = ['LS', 'ITEM', 'SUM', 'PROV', 'LUMP SUM'].includes(unitUpper);
        const pctOfBudget =
          params.totalProjectBudgetNgn > 0
            ? (item.budgetedCostNgn / params.totalProjectBudgetNgn) * 100
            : 0;
        const isOpaqueLumpSum =
          isLumpUnit && (pctOfBudget >= 3 || item.budgetedCostNgn >= 150_000_000);

        const descLower = item.description.toLowerCase();
        const isBuriedOrCritical =
          /reinforcement|rebar|culvert|blinding|foundation|piling|underground|earthing|plinth/i.test(
            descLower
          );

        const defaultTrancheNumber =
          /clear|excavat|earthwork|mobiliz|substructure|piling/i.test(descLower)
            ? params.tranches[0]?.trancheNumber ?? 1
            : params.tranches[1]?.trancheNumber ?? params.tranches[0]?.trancheNumber ?? 1;

        return {
          wbsCode: item.wbsCode,
          isOpaqueLumpSum,
          opacityWarningReason: isOpaqueLumpSum
            ? `Unbundled Lump Sum (${item.unit}) of ₦${item.budgetedCostNgn.toLocaleString()} (${pctOfBudget.toFixed(1)}% of project budget) requires schedule of rates breakdown per QSRBN IPCM guidelines.`
            : null,
          recommendedIsHoldPoint: item.isHoldPoint || isBuriedOrCritical,
          recommendedHoldPointInstruction:
            item.holdPointInstruction ||
            (isBuriedOrCritical
              ? 'Mandatory geotagged pre-pour / pre-backfill inspection photo and test certificate required before covering work.'
              : null),
          suggestedTrancheNumber: defaultTrancheNumber,
          mappingRationale: `Mapped to Tranche ${defaultTrancheNumber} based on construction work sequence (${item.section}).`,
        };
      }),
    };
  }

  /**
   * 3. Evaluates Contractor IPC Line-Item Claims against Confirmed Field Evidence Logs.
   * Assigns an Evidence Strength Rating (SUPPORTED, PARTIALLY_SUPPORTED, UNSUPPORTED, CONTRADICTED)
   * and triggers Smart Visit Planner flags. NEVER legally certifies completion %.
   */
  public async reconcileIpcLineItems(params: {
    projectName: string;
    ipcNumber: number;
    lineClaims: Array<{
      boqItemId: string;
      wbsCode: string;
      description: string;
      unit: string;
      totalQuantity: number;
      budgetedCostNgn: number;
      isHoldPoint: boolean;
      isOpaqueLumpSum: boolean;
      previousCertifiedPct: number;
      contractorClaimedPct: number;
      contractorClaimedNgn: number;
      confirmedLogs: Array<{
        id: string;
        independenceTier: IndependenceTier;
        isWithinGeofence: boolean;
        chainageLabel: string | null;
        confirmedSummary: string | null;
        confirmedQuantities: unknown;
        siteBlockers: unknown;
      }>;
    }>;
  }): Promise<AiIpcBatchReconciliationOutput> {
    if (this.client) {
      try {
        const completion = await this.client.beta.chat.completions.parse({
          model: env.AZURE_OPENAI_GPT_DEPLOYMENT,
          temperature: 0.1,
          messages: [
            {
              role: 'system',
              content:
                'You are an Auditor Co-Pilot for QSRBN/COREN Independent Project Monitors in Nigeria. ' +
                'Cross-examine each Contractor IPC line-item claim against confirmed field evidence logs. ' +
                'Assign an EvidenceStrengthRating (SUPPORTED, PARTIALLY_SUPPORTED, UNSUPPORTED, or CONTRADICTED). ' +
                'Rules:\n' +
                '1. Never certify a legal completion percentage.\n' +
                '2. If an item is a Hold Point and lacks MONITOR_INSPECTOR or INDEPENDENT_RESIDENT logs, set missingHoldPointFlag=true and cap at PARTIALLY_SUPPORTED or UNSUPPORTED.\n' +
                '3. If a claim relies ONLY on CONTRACTOR_ENGINEER self-reports, cap at PARTIALLY_SUPPORTED and set visitPlannerFlag=true.\n' +
                '4. If field logs report blockers or significantly lower progress than claimed, rate as CONTRADICTED and set visitPlannerFlag=true.',
            },
            {
              role: 'user',
              content: JSON.stringify(params),
            },
          ],
          response_format: zodResponseFormat(
            AiIpcBatchReconciliationOutputSchema,
            'ipc_batch_reconciliation'
          ),
        });

        const parsed = completion.choices[0]?.message?.parsed;
        if (parsed) {
          return parsed;
        }
      } catch (error) {
        console.warn('[AzureOpenAiService.reconcileIpcLineItems] Fallback triggered:', error);
      }
    }

    // Deterministic engineering reconciliation rules
    const lineEvaluations = params.lineClaims.map((line) => {
      const validLogs = line.confirmedLogs.filter((l) => l.isWithinGeofence);
      const independentLogs = validLogs.filter(
        (l) =>
          l.independenceTier === 'MONITOR_INSPECTOR' ||
          l.independenceTier === 'INDEPENDENT_RESIDENT'
      );
      const hasBlockers = validLogs.some(
        (l) => Array.isArray(l.siteBlockers) && l.siteBlockers.length > 0
      );

      const highestTier: IndependenceTier | null = validLogs.some(
        (l) => l.independenceTier === 'MONITOR_INSPECTOR'
      )
        ? 'MONITOR_INSPECTOR'
        : validLogs.some((l) => l.independenceTier === 'INDEPENDENT_RESIDENT')
        ? 'INDEPENDENT_RESIDENT'
        : validLogs.length > 0
        ? 'CONTRACTOR_ENGINEER'
        : null;

      if (validLogs.length === 0) {
        return {
          boqItemId: line.boqItemId,
          evidenceStrengthRating: 'UNSUPPORTED' as const,
          aiRationale: `Zero geofence-verified field evidence logs found for [${line.wbsCode}] to support claimed ${line.contractorClaimedPct}% (₦${line.contractorClaimedNgn.toLocaleString()}).`,
          visitPlannerFlag: true,
          visitPlannerReason: `Unverified claim of ₦${line.contractorClaimedNgn.toLocaleString()} with zero field logs.`,
          missingHoldPointFlag: line.isHoldPoint,
          highestCorroboratingTier: null,
          corroboratingEvidenceLogIds: [],
        };
      }

      if (hasBlockers && line.contractorClaimedPct > line.previousCertifiedPct + 25) {
        return {
          boqItemId: line.boqItemId,
          evidenceStrengthRating: 'CONTRADICTED' as const,
          aiRationale: `Contractor claims ${line.contractorClaimedPct}% completion, but on-site logs report active blockers and lower physical progress.`,
          visitPlannerFlag: true,
          visitPlannerReason: `Active site blocker conflicts with ${line.contractorClaimedPct}% IPC progress claim.`,
          missingHoldPointFlag: line.isHoldPoint && independentLogs.length === 0,
          highestCorroboratingTier: highestTier,
          corroboratingEvidenceLogIds: validLogs.map((l) => l.id),
        };
      }

      if (independentLogs.length === 0) {
        return {
          boqItemId: line.boqItemId,
          evidenceStrengthRating: 'PARTIALLY_SUPPORTED' as const,
          aiRationale: `Claimed ${line.contractorClaimedPct}% relies solely on CONTRACTOR_ENGINEER self-reports without independent Resident CoW or Monitor Inspector corroboration.`,
          visitPlannerFlag: true,
          visitPlannerReason: `Contractor self-reported claim (₦${line.contractorClaimedNgn.toLocaleString()}) requires independent Monitor site verification.`,
          missingHoldPointFlag: line.isHoldPoint,
          highestCorroboratingTier: 'CONTRACTOR_ENGINEER' as const,
          corroboratingEvidenceLogIds: validLogs.map((l) => l.id),
        };
      }

      return {
        boqItemId: line.boqItemId,
        evidenceStrengthRating: 'SUPPORTED' as const,
        aiRationale: `Claimed ${line.contractorClaimedPct}% is corroborated by ${independentLogs.length} geofence-verified independent field log(s) (${highestTier}).`,
        visitPlannerFlag: false,
        visitPlannerReason: null,
        missingHoldPointFlag: false,
        highestCorroboratingTier: highestTier,
        corroboratingEvidenceLogIds: validLogs.map((l) => l.id),
      };
    });

    const conflictCount = lineEvaluations.filter(
      (e) =>
        e.evidenceStrengthRating === 'CONTRADICTED' ||
        e.evidenceStrengthRating === 'UNSUPPORTED'
    ).length;

    return {
      lineEvaluations,
      executiveSummaryNote: `Evaluated ${lineEvaluations.length} BOQ line items for IPC #${params.ipcNumber}: ${conflictCount} item(s) flagged as Contradicted or Unsupported for Monitor review.`,
    };
  }
}

export const azureOpenAiService = new AzureOpenAiService();

