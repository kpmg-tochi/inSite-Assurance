import { Prisma } from '@prisma/client';
import {
  BoqItemInput,
  BoqItemInputSchema,
  BoqRevisionDto,
  ContractorPackageSuggestion,
  ContractorSuggestionResponse,
  TRADE_CODE_REGEX,
  UpdateBoqMappingsRequest,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { azureOpenAiService } from '../../integrations/azure-openai.service';
import { recordAuditEvent } from '../audit/audit.service';
import { loadBoqItemInProject, loadTrancheInProject } from '../../utils/ownership';
import { serializeBoqItem } from '../../utils/serializers';
import { markStepSaved } from '../projects/projectSetup.service';
import { previewBoqSpreadsheet } from './boqParser';

export { previewBoqSpreadsheet } from './boqParser';

function actorName(webUser: WebJwtPayload) {
  return `${webUser.fullName} (${webUser.roleName})`;
}

/**
 * Parses a base64-encoded .xlsx or .csv spreadsheet into the rows that have no errors. The preview
 * endpoint returns the per-row warnings and errors; this is for callers that only need items.
 */
export async function parseBoqSpreadsheetBase64(base64Content: string): Promise<BoqItemInput[]> {
  const preview = await previewBoqSpreadsheet(base64Content);
  return preview.rows
    .filter((r) => r.item)
    .map((r) => BoqItemInputSchema.parse({ ...r.item!, holdPointInstruction: null }));
}

export async function listProjectBoqItems(projectId: string, webUser?: WebJwtPayload) {
  void webUser;
  const items = await prisma.boqItem.findMany({
    where: { projectId },
    orderBy: { wbsCode: 'asc' },
    include: {
      tranche: {
        select: { id: true, trancheNumber: true, name: true },
      },
    },
  });

  return items.map((item) => serializeBoqItem(item));
}

/**
 * Commits a BOQ.
 * - Draft: replaces the draft BOQ with the upload (items not in the upload are removed).
 * - Active: a revision with a required reason. Items with certified progress keep at least the
 *   certified quantity, never lose rate, and cannot be removed; claimed or reported items cannot
 *   be removed either. The certified percentage is recomputed so the certified quantity is kept.
 */
export async function uploadAndAnalyzeProjectBoq(params: {
  projectId: string;
  webUser: WebJwtPayload;
  items?: BoqItemInput[];
  spreadsheetBase64?: string;
  reason?: string;
  /** REPLACE (default) removes items not in the upload; MERGE only adds and updates. */
  mode?: 'REPLACE' | 'MERGE';
}) {
  const project = await prisma.project.findUnique({
    where: { id: params.projectId },
    include: { tranches: { orderBy: { trancheNumber: 'asc' } } },
  });
  if (!project) {
    throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  }
  if (project.status === 'ARCHIVED') {
    throw new AppError('This project is archived and read-only', 409, 'PROJECT_ARCHIVED');
  }
  const isRevision = project.status === 'ACTIVE';
  const reason = params.reason?.trim();
  if (isRevision && !reason) {
    throw new AppError('Give a reason for revising the BOQ of an active project', 422, 'REVISION_REASON_REQUIRED');
  }

  const parsedItems =
    params.items && params.items.length > 0
      ? params.items.map((i) => BoqItemInputSchema.parse(i))
      : params.spreadsheetBase64
        ? await parseBoqSpreadsheetBase64(params.spreadsheetBase64)
        : [];

  if (parsedItems.length === 0) {
    throw new AppError('Provide either a non-empty items array or spreadsheetBase64 payload', 400, 'EMPTY_BOQ_PAYLOAD');
  }
  const codes = parsedItems.map((i) => i.wbsCode);
  const dup = codes.find((c, i) => codes.indexOf(c) !== i);
  if (dup) {
    throw new AppError(`WBS code ${dup} appears more than once`, 422, 'DUPLICATE_WBS_CODE');
  }

  // BOQ hygiene and tranche mapping: Azure OpenAI when configured, else the deterministic rules.
  const aiAnalysis = await azureOpenAiService.analyzeBoqItems({
    totalProjectBudgetNgn: Number(project.totalBudgetNgn ?? 0),
    tranches: project.tranches.map((t) => ({ trancheNumber: t.trancheNumber, name: t.name })),
    boqItems: parsedItems,
  });
  const analysisByWbs = new Map(aiAnalysis.items.map((a) => [a.wbsCode, a]));
  const trancheIdByNumber = new Map(project.tranches.map((t) => [t.trancheNumber, t.id]));
  const replace = (params.mode ?? 'REPLACE') === 'REPLACE';

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${params.projectId}::uuid FOR UPDATE`;
    const existing = await tx.boqItem.findMany({
      where: { projectId: params.projectId },
      include: {
        _count: { select: { ipcLineItems: true, workdayReports: true, evidenceLogs: true } },
      },
    });
    const existingByWbs = new Map(existing.map((e) => [e.wbsCode, e]));
    const incoming = new Set(codes);

    // Refusals first, so nothing is half-applied.
    if (isRevision) {
      for (const item of parsedItems) {
        const before = existingByWbs.get(item.wbsCode);
        if (!before) continue;
        const pct = Number(before.cumulativeCertifiedPct);
        if (pct <= 0) continue;
        const certifiedQty = (pct / 100) * Number(before.totalQuantity);
        if (item.totalQuantity + 1e-9 < certifiedQty) {
          throw new AppError(
            `${item.wbsCode}: quantity ${item.totalQuantity} is below the certified quantity ${certifiedQty.toFixed(3)}.`,
            409,
            'BOQ_BELOW_CERTIFIED'
          );
        }
        if (item.rateNgn + 1e-9 < Number(before.rateNgn)) {
          throw new AppError(
            `${item.wbsCode}: the rate cannot be reduced below ${Number(before.rateNgn)} because progress on it has been certified.`,
            409,
            'BOQ_BELOW_CERTIFIED'
          );
        }
      }
    }
    const toRemove = replace ? existing.filter((e) => !incoming.has(e.wbsCode)) : [];
    for (const e of toRemove) {
      if (Number(e.cumulativeCertifiedPct) > 0 || e._count.ipcLineItems > 0 || e._count.workdayReports > 0 || e._count.evidenceLogs > 0) {
        throw new AppError(
          `${e.wbsCode} has certified progress, claims or field reports and cannot be removed. Include it in the upload.`,
          409,
          'BOQ_ITEM_HAS_PROGRESS'
        );
      }
    }

    let revision: { id: string; revisionNumber: number } | null = null;
    if (isRevision) {
      const last = await tx.boqRevision.aggregate({ where: { projectId: params.projectId }, _max: { revisionNumber: true } });
      revision = await tx.boqRevision.create({
        data: {
          projectId: params.projectId,
          revisionNumber: (last._max.revisionNumber ?? 0) + 1,
          uploadedByUserId: params.webUser.userId,
          reason: reason!,
          itemCount: parsedItems.length,
        },
        select: { id: true, revisionNumber: true },
      });
    }

    if (toRemove.length) {
      await tx.boqItem.deleteMany({ where: { id: { in: toRemove.map((e) => e.id) } } });
    }

    const upsertedItems = [];
    for (const item of parsedItems) {
      const analysis = analysisByWbs.get(item.wbsCode);
      const suggestedTrancheId =
        item.trancheId ??
        (analysis?.suggestedTrancheNumber ? trancheIdByNumber.get(analysis.suggestedTrancheNumber) ?? null : null);
      const before = existingByWbs.get(item.wbsCode);
      const isHoldPoint = item.isHoldPoint || Boolean(analysis?.recommendedIsHoldPoint);
      const holdPointInstruction = item.holdPointInstruction ?? analysis?.recommendedHoldPointInstruction ?? null;
      if (before) {
        const pct = Number(before.cumulativeCertifiedPct);
        const keepCertifiedQtyPct =
          pct > 0 && Number(before.totalQuantity) !== item.totalQuantity
            ? Math.min(100, (pct * Number(before.totalQuantity)) / item.totalQuantity)
            : pct;
        const record = await tx.boqItem.update({
          where: { id: before.id },
          data: {
            section: item.section,
            description: item.description,
            unit: item.unit,
            totalQuantity: item.totalQuantity,
            rateNgn: item.rateNgn,
            budgetedCostNgn: item.budgetedCostNgn,
            isHoldPoint: before.isHoldPoint || isHoldPoint,
            holdPointInstruction: before.holdPointInstruction ?? holdPointInstruction,
            isOpaqueLumpSum: Boolean(analysis?.isOpaqueLumpSum),
            opacityWarningReason: analysis?.opacityWarningReason ?? null,
            aiSuggestedTrancheId: suggestedTrancheId,
            cumulativeCertifiedPct: Math.round(keepCertifiedQtyPct * 100) / 100,
            ...(revision ? { lastRevisionId: revision.id } : {}),
          },
        });
        upsertedItems.push(record);
      } else {
        const record = await tx.boqItem.create({
          data: {
            projectId: params.projectId,
            wbsCode: item.wbsCode,
            section: item.section,
            description: item.description,
            unit: item.unit,
            totalQuantity: item.totalQuantity,
            rateNgn: item.rateNgn,
            budgetedCostNgn: item.budgetedCostNgn,
            isHoldPoint,
            holdPointInstruction,
            isOpaqueLumpSum: Boolean(analysis?.isOpaqueLumpSum),
            opacityWarningReason: analysis?.opacityWarningReason ?? null,
            // A suggestion is not a mapping: the person confirms it in the BOQ step.
            trancheId: item.trancheId ?? null,
            aiSuggestedTrancheId: suggestedTrancheId,
            trancheMappingConfirmedByMonitor: Boolean(item.trancheId),
            ...(revision ? { lastRevisionId: revision.id } : {}),
          },
        });
        upsertedItems.push(record);
      }
    }

    const opaqueCount = upsertedItems.filter((i) => i.isOpaqueLumpSum).length;
    const holdPointCount = upsertedItems.filter((i) => i.isHoldPoint).length;
    await recordAuditEvent(tx, {
      projectId: params.projectId,
      actorType: 'WEB_USER',
      actorId: params.webUser.userId,
      actorDisplayName: actorName(params.webUser),
      action: isRevision ? 'BOQ_REVISED' : 'BOQ_UPLOADED',
      summaryText: isRevision
        ? `BOQ revision ${revision!.revisionNumber}: ${upsertedItems.length} item(s), ${toRemove.length} removed. Reason: ${reason}`
        : `Uploaded and analysed ${upsertedItems.length} BOQ line items (${holdPointCount} hold points, ${opaqueCount} opaque lump sums flagged)${toRemove.length ? `; ${toRemove.length} earlier item(s) replaced` : ''}.`,
      payload: {
        itemCount: upsertedItems.length,
        removedWbsCodes: toRemove.map((e) => e.wbsCode),
        opaqueCount,
        holdPointCount,
        ...(revision ? { revisionId: revision.id, revisionNumber: revision.revisionNumber, reason } : {}),
      },
    });
    if (!isRevision) await markStepSaved(tx, params.projectId, 'boq', params.webUser.userId);

    return {
      totalUploaded: upsertedItems.length,
      removedCount: toRemove.length,
      opaqueLumpSumCount: opaqueCount,
      holdPointCount,
      revisionNumber: revision?.revisionNumber ?? null,
      items: upsertedItems.map((item) => serializeBoqItem(item)),
    };
  });
  return result;
}

export async function listBoqRevisions(projectId: string): Promise<BoqRevisionDto[]> {
  const rows = await prisma.boqRevision.findMany({ where: { projectId }, orderBy: { revisionNumber: 'desc' } });
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.uploadedByUserId))] } },
    select: { id: true, fullName: true },
  });
  const names = new Map(users.map((u) => [u.id, u.fullName]));
  return rows.map((r) => ({
    id: r.id,
    revisionNumber: r.revisionNumber,
    reason: r.reason,
    itemCount: r.itemCount,
    uploadedByUserId: r.uploadedByUserId,
    uploadedByName: names.get(r.uploadedByUserId) ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function confirmBoqTrancheMappings(params: {
  projectId: string;
  webUser: WebJwtPayload;
  input: UpdateBoqMappingsRequest;
}) {
  return prisma.$transaction(async (tx) => {
    const updated = [];
    for (const u of params.input.updates) {
      await loadBoqItemInProject(tx, params.projectId, u.boqItemId);
      if (u.trancheId) {
        await loadTrancheInProject(tx, params.projectId, u.trancheId);
      }
      const item = await tx.boqItem.update({
        where: { id: u.boqItemId, projectId: params.projectId },
        data: {
          trancheId: u.trancheId,
          trancheMappingConfirmedByMonitor: u.trancheId !== null,
          isHoldPoint: u.isHoldPoint,
          ...(u.holdPointInstruction !== undefined ? { holdPointInstruction: u.holdPointInstruction } : {}),
        },
      });
      updated.push(item);
    }

    await recordAuditEvent(tx, {
      projectId: params.projectId,
      actorType: 'WEB_USER',
      actorId: params.webUser.userId,
      actorDisplayName: actorName(params.webUser),
      action: 'BASELINE_UPDATED',
      summaryText: `Confirmed BOQ-to-tranche mappings and hold point settings for ${updated.length} line item(s).`,
      payload: { updatedBoqItemIds: updated.map((i) => i.id) },
    });

    return updated.map((item) => serializeBoqItem(item));
  });
}

// ---------------------------------------------------------------------------
// Contractor package suggestion (Phase 6). Suggests only; nothing is saved.
// ---------------------------------------------------------------------------

interface TradeRule {
  tradeCode: string;
  category: string;
  pattern: RegExp;
}

/** Ordered: the first rule that matches the section wins, then the description. */
const TRADE_RULES: TradeRule[] = [
  { tradeCode: 'PRE', category: 'Preliminaries and general', pattern: /prelim|mobili[sz]|general items|site establishment|insurance|bond/i },
  { tradeCode: 'ELEC', category: 'Electrical works', pattern: /electric|cabl|wiring|lighting|luminaire|transformer|earthing|switchgear|solar|\bpv\b|inverter|conduit|socket|distribution board/i },
  { tradeCode: 'MEP', category: 'Mechanical and plumbing', pattern: /plumb|sanitary|hvac|air.?condition|pump|borehole|water supply|fire fight|sprinkler|ventilat/i },
  { tradeCode: 'DRN', category: 'Drainage and culverts', pattern: /drain|culvert|channel|manhole|gully|storm ?water|catch ?pit/i },
  { tradeCode: 'ROAD', category: 'Roads and pavement', pattern: /asphalt|bitumen|pavement|kerb|road ?marking|surfacing|base course|sub-?base|wearing course|carriageway/i },
  { tradeCode: 'EARTH', category: 'Earthworks', pattern: /excavat|earthwork|clearing|grubbing|backfill|embankment|compaction|cut to fill/i },
  { tradeCode: 'FIN', category: 'Finishes', pattern: /paint|tiling|tile|plaster|render|screed|ceiling|door|window|glazing|finish/i },
  { tradeCode: 'STR', category: 'Structural and building works', pattern: /concrete|reinforce|rebar|formwork|block ?work|masonry|column|beam|slab|roof|foundation|piling|steel ?work/i },
];

function ruleFor(text: string): TradeRule | null {
  return TRADE_RULES.find((r) => r.pattern.test(text)) ?? null;
}

function rulesSuggestion(
  items: Array<{ wbsCode: string; section: string; description: string; budgetedCostNgn: number }>
): Array<Omit<ContractorPackageSuggestion, 'existingProjectContractorId'>> {
  const groups = new Map<string, { rule: TradeRule; wbs: string[]; budget: number; bySection: number; byDescription: number }>();
  const fallback: TradeRule = { tradeCode: 'CIV', category: 'Civil works (general)', pattern: /./ };
  for (const item of items) {
    const bySection = ruleFor(item.section);
    const rule = bySection ?? ruleFor(item.description) ?? fallback;
    const g = groups.get(rule.tradeCode) ?? { rule, wbs: [], budget: 0, bySection: 0, byDescription: 0 };
    g.wbs.push(item.wbsCode);
    g.budget += item.budgetedCostNgn;
    if (bySection) g.bySection += 1;
    else if (rule !== fallback) g.byDescription += 1;
    groups.set(rule.tradeCode, g);
  }
  return [...groups.values()]
    .sort((a, b) => b.budget - a.budget)
    .map((g) => ({
      suggestedTradeCategory: g.rule.category,
      tradeCode: g.rule.tradeCode,
      matchedWbsCodes: g.wbs,
      estimatedPackageBudgetNgn: Math.round(g.budget * 100) / 100,
      rationale:
        g.rule.tradeCode === 'CIV'
          ? `${g.wbs.length} item(s) matched no specific trade and are grouped as general civil works.`
          : `${g.wbs.length} item(s) matched ${g.rule.category.toLowerCase()} keywords (${g.bySection} by section, ${g.byDescription} by description).`,
    }));
}

export async function suggestContractorPackages(projectId: string): Promise<ContractorSuggestionResponse> {
  const [project, items, contractors] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { totalBudgetNgn: true } }),
    prisma.boqItem.findMany({
      where: { projectId },
      orderBy: { wbsCode: 'asc' },
      select: { wbsCode: true, section: true, description: true, unit: true, budgetedCostNgn: true },
    }),
    prisma.projectContractor.findMany({ where: { projectId }, select: { id: true, tradeCode: true } }),
  ]);
  if (items.length === 0) {
    throw new AppError('Upload the BOQ before asking for contractor packages', 409, 'BOQ_REQUIRED');
  }
  const plain = items.map((i) => ({ ...i, budgetedCostNgn: Number(i.budgetedCostNgn) }));
  const budgetByWbs = new Map(plain.map((i) => [i.wbsCode, i.budgetedCostNgn]));
  const existingByCode = new Map(contractors.map((c) => [c.tradeCode, c.id]));

  let engine: ContractorSuggestionResponse['engine'] = 'RULES_ENGINE';
  let engineDetail: string | null = 'Section and keyword rules';
  let packages: Array<Omit<ContractorPackageSuggestion, 'existingProjectContractorId'>> | null = null;

  const ai = await azureOpenAiService.suggestContractorPackages({
    totalProjectBudgetNgn: Number(project.totalBudgetNgn ?? 0),
    boqItems: plain,
  });
  if (ai && ai.packages.length > 0) {
    // Keep only real WBS codes, each in one package; anything the model left out goes to rules.
    const assigned = new Set<string>();
    const cleaned = ai.packages
      .map((p) => {
        const code = p.tradeCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
        const wbs = p.matchedWbsCodes.filter((w) => budgetByWbs.has(w) && !assigned.has(w));
        wbs.forEach((w) => assigned.add(w));
        return {
          suggestedTradeCategory: p.suggestedTradeCategory.slice(0, 80),
          tradeCode: TRADE_CODE_REGEX.test(code) ? code : 'PKG',
          matchedWbsCodes: wbs,
          estimatedPackageBudgetNgn: Math.round(wbs.reduce((s, w) => s + (budgetByWbs.get(w) ?? 0), 0) * 100) / 100,
          rationale: p.rationale.slice(0, 500),
        };
      })
      .filter((p) => p.matchedWbsCodes.length > 0);
    const leftovers = plain.filter((i) => !assigned.has(i.wbsCode));
    packages = [...cleaned, ...rulesSuggestion(leftovers)];
    engine = 'AZURE_OPENAI';
    engineDetail = env.AZURE_OPENAI_GPT_DEPLOYMENT || null;
  }
  if (!packages) packages = rulesSuggestion(plain);

  // Trade codes must be unique in the suggestion.
  const seen = new Set<string>();
  const unique = packages.map((p) => {
    let code = p.tradeCode;
    let n = 2;
    while (seen.has(code)) code = `${p.tradeCode.slice(0, 5)}${n++}`;
    seen.add(code);
    return { ...p, tradeCode: code, existingProjectContractorId: existingByCode.get(code) ?? null };
  });
  return { engine, engineDetail, packages: unique };
}

export type BoqItemWithCounts = Prisma.BoqItemGetPayload<object>;
