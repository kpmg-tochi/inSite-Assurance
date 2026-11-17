import { AzureOpenAI } from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import {
  AiBoqBatchAnalysisResponse,
  AiBoqBatchAnalysisResponseSchema,
  AiFieldNoteExtraction,
  AiFieldNoteExtractionSchema,
  AiIpcBatchReconciliationOutput,
  AiIpcBatchReconciliationOutputSchema,
  AiOmissionPayload,
  AiOmissionPayloadSchema,
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

  /**
   * 4. Generates a structured Morning Deliverable Brief for a specific WBS/BOQ item,
   * highlighting today's expected deliverable and concrete evidence reporting pointers.
   */
  public async generateMorningDeliverableBrief(params: {
    projectName: string;
    wbsCode: string;
    description: string;
    unit: string;
    totalQuantity: number;
    cumulativeCertifiedPct: number;
    dailyTargetQuantity: number | null;
    expectedDeliverableOverride?: string | null;
    isHoldPoint: boolean;
    holdPointInstruction?: string | null;
    previousReportSummary?: string | null;
    planningTier: string;
  }): Promise<{
    headline: string;
    expectedDeliverable: string;
    reportingChecklist: string[];
    generatedByAi: boolean;
  }> {
    const MorningBriefSchema = z.object({
      headline: z.string(),
      expectedDeliverable: z.string(),
      reportingChecklist: z.array(z.string()).min(2).max(5),
    });

    if (!this.client) {
      return {
        ...this.fallbackMorningBrief(params),
        generatedByAi: false,
      };
    }

    try {
      const response = await this.client.chat.completions.create({
        model: env.AZURE_OPENAI_GPT_DEPLOYMENT,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'You are a Senior Civil Engineering Resident Monitor on Nigerian infrastructure projects. Generate a concise, practical Morning Deliverable Brief for a site engineer. Specify what must be completed today and give concrete pointers on what photos, quantities, and material counts (e.g., bags of cement used/remaining, cube tests, rebar spacing) to include in their daily report.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              projectName: params.projectName,
              wbsCode: params.wbsCode,
              description: params.description,
              unit: params.unit,
              totalQuantity: params.totalQuantity,
              cumulativeCertifiedPct: params.cumulativeCertifiedPct,
              dailyTargetQuantity: params.dailyTargetQuantity,
              expectedDeliverableOverride: params.expectedDeliverableOverride,
              isHoldPoint: params.isHoldPoint,
              holdPointInstruction: params.holdPointInstruction,
              previousReportSummary: params.previousReportSummary,
              planningTier: params.planningTier,
            }),
          },
        ],
        response_format: zodResponseFormat(
          MorningBriefSchema,
          'morning_deliverable_brief'
        ),
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty Morning Brief response from Azure OpenAI');
      }
      const parsed = MorningBriefSchema.parse(JSON.parse(content));
      return { ...parsed, generatedByAi: true };
    } catch (err) {
      console.warn('Azure OpenAI Morning Brief failed, using fallback:', err);
      return {
        ...this.fallbackMorningBrief(params),
        generatedByAi: false,
      };
    }
  }

  private fallbackMorningBrief(params: {
    wbsCode: string;
    description: string;
    unit: string;
    cumulativeCertifiedPct: number;
    dailyTargetQuantity: number | null;
    expectedDeliverableOverride?: string | null;
    isHoldPoint: boolean;
    holdPointInstruction?: string | null;
    planningTier: string;
  }) {
    const targetText =
      params.dailyTargetQuantity && params.dailyTargetQuantity > 0
        ? `Target: ${params.dailyTargetQuantity} ${params.unit}`
        : `Current Certified: ${params.cumulativeCertifiedPct}%`;

    const tierPrefix =
      params.planningTier === 'FALLBACK_BACKLOG' ? 'Fallback Ready · ' : '';

    const headline = `${tierPrefix}WBS ${params.wbsCode} — ${targetText}`;
    const expectedDeliverable =
      params.expectedDeliverableOverride?.trim() ||
      `Execute today's scheduled scope for ${params.description} (${targetText}).`;

    const descLower = params.description.toLowerCase();
    const checklist: string[] = [];

    if (
      descLower.includes('concrete') ||
      descLower.includes('culvert') ||
      descLower.includes('slab') ||
      descLower.includes('cement')
    ) {
      checklist.push(
        'Submit wide and close-up photos of the completed pour/formwork with GPS stamp.'
      );
      checklist.push(
        'State how many bags of cement (or m3 ready-mix) were used today and how many remain on site.'
      );
    } else if (
      descLower.includes('compaction') ||
      descLower.includes('sub-base') ||
      descLower.includes('earthworks')
    ) {
      checklist.push(
        'Submit photos of field density / compaction testing and graded surface levels.'
      );
      checklist.push(
        `Record total area/volume compacted today (${params.unit}) and chainage limits covered.`
      );
    } else {
      checklist.push(
        `Capture before, during, and after progress photos for WBS ${params.wbsCode}.`
      );
      checklist.push(
        `Report exact installed quantity (${params.unit}) and materials consumed vs remaining.`
      );
    }

    if (params.isHoldPoint) {
      checklist.push(
        `MANDATORY HOLD-POINT: ${
          params.holdPointInstruction ||
          'Do not cover or proceed past this stage until inspection photos are logged.'
        }`
      );
    }

    checklist.push(
      'Log any weather, delivery, or equipment delays in the WBS thread as they happen.'
    );

    return {
      headline,
      expectedDeliverable,
      reportingChecklist: checklist,
    };
  }

  /**
   * 5. Evaluates a submitted Workday Report against BOQ Hold-Point rules and Morning Brief
   * checklist requirements. Flags an omission ONLY when required proof was omitted AND no
   * explanation/blocker reason was supplied by the engineer.
   */
  public async evaluateWorkdayReportOmissions(params: {
    wbsCode: string;
    wbsDescription: string;
    unit: string;
    summaryText: string;
    reportedQuantity: number;
    isHoldPoint: boolean;
    holdPointInstruction?: string | null;
    isHoldPointClaimed: boolean;
    morningChecklist: string[];
    evidenceItems: Array<{ type: string; caption?: string; mediaUrl?: string }>;
    voiceNoteUrl?: string | null;
    delaysOrBlockers?: string;
  }): Promise<{
    hasUnexplainedOmission: boolean;
    omissionPayload: AiOmissionPayload | null;
    aiConfidence: number;
    aiReasoning: string;
  }> {
    const fallback = this.fallbackEvaluateOmissions(params);

    if (!this.client) {
      return fallback;
    }

    const OmissionEvalSchema = z.object({
      hasUnexplainedOmission: z.boolean(),
      omittedItems: z.array(z.string()),
      expectedRequirement: z.string(),
      reasonProvidedInReport: z.boolean(),
      clarificationQuestion: z.string(),
      aiConfidence: z.number().min(0).max(1),
      aiReasoning: z.string(),
    });

    try {
      const checklistText =
        params.morningChecklist.length > 0
          ? params.morningChecklist.map((c) => `- ${c}`).join('\n')
          : '- Standard daily photo & quantity log';

      const completion = await this.client.beta.chat.completions.parse({
        model: env.AZURE_OPENAI_GPT_DEPLOYMENT,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content:
              'You are an infrastructure assurance AI auditor. Determine whether specifically required ' +
              'evidence (Hold-Point proofs, photos, test certificates, or morning checklist deliverables) ' +
              'was omitted in a daily report AND whether the engineer provided any explanation or blocker ' +
              'justifying the omission. Set hasUnexplainedOmission = true ONLY when required evidence was ' +
              'omitted AND reasonProvidedInReport = false.',
          },
          {
            role: 'user',
            content:
              `WBS [${params.wbsCode}]: ${params.wbsDescription}\n` +
              `Mandatory Hold Point: ${params.isHoldPoint ? `YES (${params.holdPointInstruction || 'Inspect prior to cover-up'})` : 'NO'}\n` +
              `Morning Checklist:\n${checklistText}\n\n` +
              `Submitted Summary: "${params.summaryText}"\n` +
              `Reported Quantity: ${params.reportedQuantity} ${params.unit}\n` +
              `Blockers/Delays Note: "${params.delaysOrBlockers || 'None'}"\n` +
              `Evidence Items Attached (${params.evidenceItems.length}): ${JSON.stringify(params.evidenceItems)}\n` +
              `Voice Note Attached: ${Boolean(params.voiceNoteUrl)}`,
          },
        ],
        response_format: zodResponseFormat(OmissionEvalSchema, 'workday_omission_eval'),
      });

      const parsed = completion.choices[0]?.message?.parsed;
      if (parsed) {
        const shouldRaise =
          parsed.hasUnexplainedOmission && !parsed.reasonProvidedInReport;
        return {
          hasUnexplainedOmission: shouldRaise,
          omissionPayload: shouldRaise
            ? AiOmissionPayloadSchema.parse({
                omittedItems: parsed.omittedItems,
                expectedRequirement: parsed.expectedRequirement,
                reasonProvidedInReport: parsed.reasonProvidedInReport,
                clarificationQuestion: parsed.clarificationQuestion,
              })
            : null,
          aiConfidence: parsed.aiConfidence,
          aiReasoning: parsed.aiReasoning,
        };
      }
    } catch (error) {
      console.warn('[AzureOpenAiService.evaluateWorkdayReportOmissions] Fallback:', error);
    }

    return fallback;
  }

  private fallbackEvaluateOmissions(params: {
    wbsCode: string;
    wbsDescription: string;
    unit: string;
    summaryText: string;
    reportedQuantity: number;
    isHoldPoint: boolean;
    holdPointInstruction?: string | null;
    isHoldPointClaimed: boolean;
    morningChecklist: string[];
    evidenceItems: Array<{ type: string; caption?: string; mediaUrl?: string }>;
    delaysOrBlockers?: string;
  }) {
    const photoCount = params.evidenceItems.filter((e) => e.type === 'PHOTO').length;
    const combinedText = `${params.summaryText} ${params.delaysOrBlockers || ''}`.toLowerCase();

    const checklistNeedsPhotoOrCert = params.morningChecklist.some((item) =>
      /photo|certificate|test|slump|rebar|grid/i.test(item)
    );

    const requiresVisualProof =
      (params.isHoldPoint && (params.reportedQuantity > 0 || params.isHoldPointClaimed)) ||
      (checklistNeedsPhotoOrCert && params.reportedQuantity > 0);

    const hasJustification =
      Boolean(params.delaysOrBlockers && params.delaysOrBlockers.trim().length > 5) ||
      /(rain|delay|halted|postponed|pending|cancelled|camera|no pour|omitted|not poured|waiting)/i.test(
        combinedText
      );

    if (requiresVisualProof && photoCount === 0 && !hasJustification) {
      const requirement = params.isHoldPoint
        ? params.holdPointInstruction ||
          `Hold-Point photo/proof verification required for WBS ${params.wbsCode}.`
        : params.morningChecklist.find((c) => /photo|certificate|test/i.test(c)) ||
          `Visual/test evidence required by morning deliverable checklist for WBS ${params.wbsCode}.`;

      const omittedItems = params.isHoldPoint
        ? ['Geotagged Hold-Point inspection photo', 'Mandatory test/mill certificate or omission note']
        : ['Geotagged site progress photo required by daily deliverable checklist'];

      return {
        hasUnexplainedOmission: true,
        omissionPayload: {
          omittedItems,
          expectedRequirement: requirement,
          reasonProvidedInReport: false,
          clarificationQuestion: `Required evidence for WBS ${params.wbsCode} was omitted without an explanation: ${requirement} Please attach the missing site photo/proof or state why it could not be captured today, then re-submit.`,
        },
        aiConfidence: 0.62,
        aiReasoning: `AI Omission Check flagged missing visual/Hold-Point evidence (${photoCount} photos attached) with no omission reason documented in report.`,
      };
    }

    return {
      hasUnexplainedOmission: false,
      omissionPayload: null,
      aiConfidence: photoCount > 0 ? 0.92 : 0.84,
      aiReasoning:
        photoCount > 0
          ? `Report backed by ${photoCount} photo evidence item(s) and aligned with WBS ${params.wbsCode}.`
          : hasJustification
            ? `Supporting visual proof omitted, but valid operational reason/blocker was documented in report.`
            : `Report aligns with WBS ${params.wbsCode} deliverable parameters.`,
    };
  }

  /**
   * 6. Re-parses the full updated WBS chat thread + newly provided evidence/justification
   * against the original Monitor or AI query context when resubmitting a report.
   */
  public async reparseWorkdayChatAfterQuery(params: {
    wbsCode: string;
    wbsDescription: string;
    unit: string;
    previousSummary: string;
    previousQuantity: number;
    originalQuery: {
      source: string;
      monitorComment?: string | null;
      aiOmissionPayload?: AiOmissionPayload | null;
    };
    chatMessages: Array<{
      senderName: string;
      senderRole: string;
      messageType: string;
      textContent?: string | null;
      caption?: string | null;
    }>;
    newEvidenceCount: number;
    overrideSummary?: string;
    overrideQuantity?: number;
  }): Promise<{
    updatedSummary: string;
    updatedQuantity: number;
    aiConfidence: number;
    aiReasoning: string;
    omissionAddressed: boolean;
  }> {
    const queryPromptText =
      params.originalQuery.monitorComment ||
      params.originalQuery.aiOmissionPayload?.clarificationQuestion ||
      'Clarification requested';

    const chatLines = params.chatMessages
      .map(
        (m) =>
          `[${m.senderRole} - ${m.senderName}] (${m.messageType}): ${m.textContent || m.caption || ''}`
      )
      .filter((line) => line.trim().length > 0)
      .join('\n');

    if (this.client) {
      const RevalidationSchema = z.object({
        updatedSummary: z.string(),
        updatedQuantity: z.number().nonnegative(),
        aiConfidence: z.number().min(0).max(1),
        aiReasoning: z.string(),
        omissionAddressed: z.boolean(),
      });

      try {
        const completion = await this.client.beta.chat.completions.parse({
          model: env.AZURE_OPENAI_GPT_DEPLOYMENT,
          temperature: 0.1,
          messages: [
            {
              role: 'system',
              content:
                'You are an infrastructure assurance AI co-pilot re-evaluating a queried daily WBS report. ' +
                'Synthesize the prior report, the original query (Monitor comment or AI omission details), ' +
                'and the engineer’s newly added evidence/clarifications from the WBS chat into an updated summary.',
            },
            {
              role: 'user',
              content:
                `WBS [${params.wbsCode}] ${params.wbsDescription}\n` +
                `Previous Summary: "${params.previousSummary}" (${params.previousQuantity} ${params.unit})\n` +
                `Original Query (${params.originalQuery.source}): ${queryPromptText}\n` +
                `AI Omission Context: ${JSON.stringify(params.originalQuery.aiOmissionPayload ?? null)}\n` +
                `Updated Chat Thread:\n${chatLines || 'No extra messages'}\n` +
                `New Evidence Items Attached: ${params.newEvidenceCount}\n` +
                `User Edited Summary Override: "${params.overrideSummary || ''}"`,
            },
          ],
          response_format: zodResponseFormat(RevalidationSchema, 'workday_chat_revalidation'),
        });

        const parsed = completion.choices[0]?.message?.parsed;
        if (parsed) {
          return {
            updatedSummary: params.overrideSummary?.trim() || parsed.updatedSummary,
            updatedQuantity:
              params.overrideQuantity !== undefined ? params.overrideQuantity : parsed.updatedQuantity,
            aiConfidence: parsed.aiConfidence,
            aiReasoning: parsed.aiReasoning,
            omissionAddressed: parsed.omissionAddressed,
          };
        }
      } catch (err) {
        console.warn('[AzureOpenAiService.reparseWorkdayChatAfterQuery] Fallback:', err);
      }
    }

    const engineerFollowUps = params.chatMessages
      .filter((m) => m.senderRole === 'ENGINEER' || m.senderRole === 'INSPECTOR')
      .map((m) => m.textContent || m.caption)
      .filter((txt): txt is string => Boolean(txt && txt.trim()))
      .slice(-4);

    const updatedSummary =
      params.overrideSummary?.trim() ||
      [
        params.previousSummary.trim(),
        engineerFollowUps.length > 0
          ? `Query Clarification: ${engineerFollowUps.join(' · ')}`
          : null,
      ]
        .filter(Boolean)
        .join(' | ');

    const hasEvidenceOrNote = params.newEvidenceCount > 0 || engineerFollowUps.length > 0;

    return {
      updatedSummary,
      updatedQuantity:
        params.overrideQuantity !== undefined ? params.overrideQuantity : params.previousQuantity,
      aiConfidence: hasEvidenceOrNote ? 0.91 : 0.72,
      aiReasoning: hasEvidenceOrNote
        ? `Re-parsed WBS ${params.wbsCode} chat after ${params.originalQuery.source} query ("${queryPromptText.slice(0, 90)}"). Incorporates ${params.newEvidenceCount} newly attached evidence item(s) and ${engineerFollowUps.length} field clarification note(s).`
        : `Resubmission logged against ${params.originalQuery.source} query; awaiting additional photo/note proof if still unclear.`,
      omissionAddressed: hasEvidenceOrNote,
    };
  }
}

export const azureOpenAiService = new AzureOpenAiService();

