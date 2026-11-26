import { Prisma } from '@prisma/client';
import {
  buildLotBatchCode,
  CreateProjectDraftRequest,
  CreateProjectDraftRequestSchema,
  findStateByName,
  formatProjectCode,
  FUNDING_SOURCES,
  fundingSourceCodeFromText,
  FundingSourceCode,
  InterventionYearSchema,
  lgaByCode,
  LOT_TITLE_MAX,
  LotChoice,
  NEEDS_ASSESSMENT_FIELD_LABELS,
  NeedsAssessmentConfirmRequest,
  NeedsAssessmentConfirmResultDto,
  NeedsAssessmentFieldKey,
  NeedsAssessmentFieldValue,
  NeedsAssessmentImportState,
  NeedsAssessmentImportStateSchema,
  NeedsAssessmentPreviewDto,
  NeedsAssessmentPreviewRequest,
  NeedsAssessmentSiteRow,
  parseSheetNumber,
  stateByCode,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { invalidateUserAuthCache, WebJwtPayload } from '../../middleware/auth.middleware';
import { createProjectDraftInTx, markStepSaved } from '../projects/projectSetup.service';
import { lockProjectLots, tenantInterventionYears } from '../projectLots/projectLots.service';
import { deriveLineDatesFromSprints } from '../scope/scope.service';
import {
  applyScopeImportInTx,
  decodeScopeWorkbook,
  findDeliveryModel,
  scopePreviewFromParsed,
  sha256Of,
  siteStateIssues,
  tenantFacilities,
} from '../scope/scopeImport.service';
import { parseScopeWorkbook, ParsedScopeWorkbook, resolveLgaText } from '../scope/workbook/scopeWorkbook';

/**
 * Client demo updates D1 (wave 2): start a project from the needs assessment. Template parsing only
 * (decision Z: no AI). Preview reads the UBEC needs assessment template and says, per draft field,
 * what the file gives and what the person must still give; confirm creates the draft (type applied,
 * lot/batch code assigned), then runs the in-project import into it (sites, work phases, units, BoQ,
 * empty fields), all in one transaction. What was filled and what is still missing is kept in
 * `setupState.needsAssessment` for the wizard (also in the SCOPE_IMPORTED audit payload).
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export const NOT_TEMPLATE_MESSAGE = 'This file is not the UBEC needs assessment template: download the template, or start without one';

/** Keys a draft cannot be created without (the delivery model only when the workspace has types). */
const REQUIRED_KEYS: NeedsAssessmentFieldKey[] = ['name', 'projectTypeId', 'interventionYear', 'lot', 'totalBudgetNgn'];

const money = (n: number) => `NGN ${n.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

interface Resolved {
  name: string | null;
  projectTypeId: string | null;
  interventionYear: number | null;
  lotTitle: string | null;
  stateCode: string | null;
  lgaCode: string | null;
  fundingSourceCode: FundingSourceCode | null;
  totalBudgetNgn: number | null;
}

interface NeedsAssessmentAnalysis {
  buffer: Buffer;
  parsed: ParsedScopeWorkbook;
  preview: NeedsAssessmentPreviewDto;
  resolved: Resolved;
  hasTypes: boolean;
}

/** The lot a title names in a year: the workspace's lot of that title, else the next new lot. */
async function lotFor(db: Db, tenantId: string, year: number, title: string) {
  const lots = await db.projectLot.findMany({
    where: { tenantId, interventionYear: year },
    select: { id: true, number: true, title: true, projects: { select: { batchNumber: true }, orderBy: { batchNumber: 'desc' }, take: 1, where: { batchNumber: { not: null } } } },
  });
  const existing = lots.find((l) => sameTitle(l.title, title));
  if (existing) return { lotId: existing.id, number: existing.number, batch: (existing.projects[0]?.batchNumber ?? 0) + 1, title: existing.title, isNew: false };
  return { lotId: null, number: lots.reduce((m, l) => Math.max(m, l.number), 0) + 1, batch: 1, title: title.trim(), isNew: true };
}

async function analyse(db: Db, webUser: WebJwtPayload, fileBase64: string, fileName: string | null): Promise<NeedsAssessmentAnalysis> {
  const tenantId = webUser.tenantId;
  const buffer = decodeScopeWorkbook(fileBase64);
  const facilities = await tenantFacilities(db, tenantId);
  const parsed = await parseScopeWorkbook(buffer, { facilities });
  if (parsed.issues.some((i) => i.code === 'WORKBOOK_UNREADABLE' || i.code === 'WORKBOOK_VERSION_MISMATCH')) {
    throw new AppError(NOT_TEMPLATE_MESSAGE, 422, 'NOT_NEEDS_ASSESSMENT_TEMPLATE', { issues: parsed.issues });
  }
  const wb = parsed.project;
  const fields = new Map<NeedsAssessmentFieldKey, NeedsAssessmentFieldValue>();
  const set = (key: NeedsAssessmentFieldKey, value: string | number | null, display: string | null, opts: { needsInput?: boolean; message?: string | null } = {}) =>
    fields.set(key, {
      key,
      label: NEEDS_ASSESSMENT_FIELD_LABELS[key],
      value,
      display,
      source: value !== null ? 'TEMPLATE' : null,
      needsInput: opts.needsInput ?? value === null,
      message: opts.message ?? null,
    });
  const resolved: Resolved = { name: null, projectTypeId: null, interventionYear: null, lotTitle: null, stateCode: null, lgaCode: null, fundingSourceCode: null, totalBudgetNgn: null };

  // Name
  const name = wb.name?.trim() ?? '';
  if (name.length >= 3 && name.length <= 200) {
    resolved.name = name;
    set('name', name, name);
  } else set('name', null, name || null, { message: name ? 'The project name must be 3 to 200 characters.' : 'The Project sheet gives no project name.' });

  // Delivery model
  const hasTypes = (await db.projectType.count({ where: { tenantId, isActive: true } })) > 0;
  if (!hasTypes) set('projectTypeId', null, null, { needsInput: false, message: 'This workspace has no delivery models.' });
  else if (wb.deliveryModel) {
    const type = await findDeliveryModel(db, tenantId, wb.deliveryModel);
    if (type) {
      resolved.projectTypeId = type.id;
      set('projectTypeId', type.id, type.name);
    } else set('projectTypeId', null, wb.deliveryModel, { message: `"${wb.deliveryModel}" is not one of this workspace's delivery models.` });
  } else set('projectTypeId', null, null, { message: 'Choose the delivery model.' });

  // Intervention year (D5)
  const { allowed } = await tenantInterventionYears(db, tenantId);
  if (wb.interventionYear) {
    const y = InterventionYearSchema.safeParse(parseSheetNumber(wb.interventionYear));
    if (!y.success) set('interventionYear', null, wb.interventionYear, { message: `"${wb.interventionYear}" is not a year.` });
    else if (!allowed.includes(y.data)) {
      set('interventionYear', null, String(y.data), { message: `A new project takes the intervention year ${allowed.join(' or ')}. Earlier years come in through the project register import.` });
    } else {
      resolved.interventionYear = y.data;
      set('interventionYear', y.data, String(y.data));
    }
  } else set('interventionYear', null, null, { message: `Choose the intervention year (${allowed.join(' or ')}).` });

  // Lot (C3): the title matched against the year's lots, else the next new lot.
  let codePreview: string | null = null;
  const lotTitle = wb.lotTitle?.trim() ?? '';
  if (lotTitle.length >= 3 && lotTitle.length <= LOT_TITLE_MAX) {
    resolved.lotTitle = lotTitle;
    if (resolved.interventionYear) {
      const lot = await lotFor(db, tenantId, resolved.interventionYear, lotTitle);
      codePreview = formatProjectCode(buildLotBatchCode(resolved.interventionYear, lot.number, lot.batch));
      set('lot', lotTitle, `LOT ${lot.number}: ${lot.title}${lot.isNew ? ' (new lot)' : ''}`);
    } else set('lot', lotTitle, lotTitle, { message: 'The lot is numbered once the intervention year is known.' });
  } else set('lot', null, lotTitle || null, { message: lotTitle ? 'The lot title must be 3 to 200 characters.' : 'The Project sheet gives no lot title: choose the lot.' });

  // State (C1): the State row, else the Region row when it names a State, else the sites' State.
  const siteStates = [...new Set(parsed.sites.map((s) => lgaByCode(s.lgaCode)?.stateCode).filter((c): c is string => Boolean(c)))];
  const state = stateByCode(parsed.stateCode) ?? findStateByName(wb.region) ?? (siteStates.length === 1 ? stateByCode(siteStates[0]) : null);
  if (state) {
    resolved.stateCode = state.code;
    set('stateCode', state.code, state.name);
  } else set('stateCode', null, wb.state ?? null, { message: wb.state ? `"${wb.state}" is not a State.` : 'Choose the State.' });

  // LGA of the project (optional: each site carries its own)
  if (wb.lga) {
    const found = resolveLgaText(wb.lga, resolved.stateCode);
    if ('lga' in found && (!resolved.stateCode || found.lga.stateCode === resolved.stateCode)) {
      resolved.lgaCode = found.lga.code;
      set('lgaCode', found.lga.code, found.lga.name);
    } else set('lgaCode', null, wb.lga, { needsInput: false, message: 'message' in found ? found.message : null });
  } else set('lgaCode', null, null, { needsInput: false });

  // Funding source (C4)
  if (wb.fundingSource) {
    const code = fundingSourceCodeFromText(wb.fundingSource);
    if (code) {
      resolved.fundingSourceCode = code;
      set('fundingSourceCode', code, FUNDING_SOURCES.find((f) => f.code === code)!.label);
    } else set('fundingSourceCode', null, wb.fundingSource, { message: `"${wb.fundingSource}" is not on the funding source list.` });
  } else set('fundingSourceCode', null, null, { message: 'Choose the funding source.' });

  // Budget
  if (wb.budget) {
    const n = Number(String(wb.budget).replace(/[^\d.-]/g, ''));
    if (Number.isFinite(n) && n > 0) {
      resolved.totalBudgetNgn = n;
      set('totalBudgetNgn', n, money(n));
    } else set('totalBudgetNgn', null, wb.budget, { message: `"${wb.budget}" is not an amount.` });
  } else set('totalBudgetNgn', null, null, { message: 'Enter the budget.' });

  // Text fields (the template has no description row)
  set('description', null, null, { needsInput: false });
  for (const key of ['strategicJustification', 'assumptions'] as const) {
    const v = wb[key]?.trim() || null;
    set(key, v, v, { needsInput: false });
  }

  // Sites and scope
  const linesByUnit = new Map<string, number>();
  for (const l of parsed.lines) linesByUnit.set(l.unitCode, (linesByUnit.get(l.unitCode) ?? 0) + l.amountNgn);
  const sites: NeedsAssessmentSiteRow[] = parsed.sites.map((s) => {
    const units = parsed.units.filter((u) => u.siteNumber === s.siteNumber);
    return {
      siteNumber: s.siteNumber,
      schoolName: s.schoolName,
      schoolLevel: s.schoolLevel,
      lgaCode: s.lgaCode,
      lgaName: s.lgaName,
      address: s.address,
      latitude: s.latitude,
      longitude: s.longitude,
      unitCount: units.length,
      amountNgn: Math.round(units.reduce((sum, u) => sum + (linesByUnit.get(u.code) ?? 0), 0) * 100) / 100,
    };
  });
  const lgaCount = new Set(parsed.sites.map((s) => s.lgaCode)).size;
  set('sites', parsed.sites.length || null, parsed.sites.length ? `${parsed.sites.length} site(s) in ${lgaCount} LGA(s)` : null, { needsInput: false });

  const sha256 = sha256Of(buffer);
  const scope = scopePreviewFromParsed(parsed, facilities, {
    fileName,
    sha256,
    budgetNgn: resolved.totalBudgetNgn,
    issues: resolved.stateCode ? siteStateIssues(parsed.sites, resolved.stateCode) : [],
  });
  const t = scope.totals;
  set(
    'scope',
    t.lineCount || null,
    t.lineCount ? `${t.lineCount} BoQ line(s) on ${t.unitCount} facility unit(s), ${t.sprintCount} work phase(s), ${money(t.amountNgn)}` : null,
    { message: t.lineCount ? null : 'The BoQ sheet has no lines: add them on the BoQ & work phases step.' }
  );

  const ordered = [...fields.values()];
  return {
    buffer,
    parsed,
    hasTypes,
    resolved,
    preview: {
      fileName,
      sha256,
      fields: ordered,
      sites,
      scope,
      codePreview,
      needsInput: ordered.filter((f) => f.needsInput).map((f) => f.key),
      issues: scope.issues,
      warnings: scope.warnings,
      canConfirm: scope.issues.length === 0,
    },
  };
}

export async function previewNeedsAssessment(webUser: WebJwtPayload, input: NeedsAssessmentPreviewRequest): Promise<NeedsAssessmentPreviewDto> {
  return (await analyse(prisma, webUser, input.fileBase64, input.fileName ?? null)).preview;
}

export async function confirmNeedsAssessment(webUser: WebJwtPayload, input: NeedsAssessmentConfirmRequest): Promise<NeedsAssessmentConfirmResultDto> {
  const fileName = input.fileName ?? null;
  const buffer = decodeScopeWorkbook(input.fileBase64);
  if (sha256Of(buffer) !== input.sha256) {
    throw new AppError('This is not the file that was checked. Upload it again before creating the draft.', 409, 'NEEDS_ASSESSMENT_FILE_CHANGED');
  }
  const a = await analyse(prisma, webUser, input.fileBase64, fileName);
  if (a.preview.issues.length) {
    throw new AppError(`The needs assessment has ${a.preview.issues.length} error(s). Fix them in the file and upload it again.`, 422, 'NEEDS_ASSESSMENT_INVALID', {
      issues: a.preview.issues,
    });
  }
  const o = input.overrides ?? {};
  const r = a.resolved;
  const merged = {
    name: o.name ?? r.name,
    projectTypeId: o.projectTypeId ?? r.projectTypeId,
    interventionYear: o.interventionYear ?? r.interventionYear,
    stateCode: o.stateCode ?? r.stateCode,
    fundingSourceCode: o.fundingSourceCode ?? r.fundingSourceCode,
    totalBudgetNgn: o.totalBudgetNgn ?? r.totalBudgetNgn,
  };
  const hasLot = Boolean(o.lotChoice || r.lotTitle);
  const missing = REQUIRED_KEYS.filter((k) => {
    if (k === 'lot') return !hasLot;
    if (k === 'projectTypeId') return a.hasTypes && !merged.projectTypeId;
    return merged[k as keyof typeof merged] === null || merged[k as keyof typeof merged] === undefined;
  });
  if (missing.length) {
    throw new AppError(
      `Give the ${missing.map((k) => NEEDS_ASSESSMENT_FIELD_LABELS[k].toLowerCase()).join(', ')} before creating the draft.`,
      422,
      'NEEDS_ASSESSMENT_INPUT_REQUIRED',
      { missing }
    );
  }
  const overridden = new Set<NeedsAssessmentFieldKey>(
    (Object.keys(o) as Array<keyof typeof o>).filter((k) => o[k] !== undefined).map((k) => (k === 'lotChoice' ? 'lot' : (k as NeedsAssessmentFieldKey)))
  );
  const filled = a.preview.fields
    .filter((f) => f.source === 'TEMPLATE' && !f.needsInput && !overridden.has(f.key))
    .map((f) => ({ key: f.key, source: 'TEMPLATE' as const }));
  const lgaCode = r.lgaCode && lgaByCode(r.lgaCode)?.stateCode === merged.stateCode ? r.lgaCode : undefined;

  const result = await prisma.$transaction(
    async (tx) => {
      // The lot: the person's choice, else the file's title (that lot of the year, or a new one).
      let lotChoice: LotChoice;
      if (o.lotChoice) lotChoice = o.lotChoice;
      else {
        // Matched under the lot lock (held to commit), so two drafts never open the same new lot twice.
        await lockProjectLots(tx, webUser.tenantId);
        const lot = await lotFor(tx, webUser.tenantId, merged.interventionYear!, r.lotTitle!);
        lotChoice = lot.lotId ? { lotId: lot.lotId } : { newLotTitle: lot.title };
      }
      const draftInput: CreateProjectDraftRequest = CreateProjectDraftRequestSchema.parse({
        name: merged.name,
        totalBudgetNgn: merged.totalBudgetNgn,
        ...(merged.projectTypeId ? { projectTypeId: merged.projectTypeId } : {}),
        interventionYear: merged.interventionYear,
        lotChoice,
        ...(merged.stateCode ? { stateCode: merged.stateCode } : {}),
        ...(lgaCode ? { lgaCode } : {}),
        ...(merged.fundingSourceCode ? { fundingSourceCode: merged.fundingSourceCode } : {}),
      });
      const projectId = await createProjectDraftInTx(tx, webUser, draftInput);
      const applied = await applyScopeImportInTx(tx, projectId, webUser, buffer, fileName, {
        auditNote: ' (the draft was created from it)',
        payloadExtra: { needsAssessmentFirst: true, filled, overridden: [...overridden] },
      });
      await deriveLineDatesFromSprints(tx, projectId);
      await markStepSaved(tx, projectId, 'scope', webUser.userId);
      if (applied.siteCount) await markStepSaved(tx, projectId, 'sites', webUser.userId);
      const needsInput = await missingKeys(tx, projectId);
      const state: NeedsAssessmentImportState = { importedAt: new Date().toISOString(), fileName, filled, needsInput };
      const row = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { setupState: true, codePrefix: true } });
      const setupState = row.setupState && typeof row.setupState === 'object' ? (row.setupState as Record<string, unknown>) : {};
      await tx.project.update({
        where: { id: projectId },
        data: { setupState: { ...setupState, needsAssessment: state } as unknown as Prisma.InputJsonValue },
      });
      return { projectId, codePrefix: row.codePrefix, needsInput };
    },
    { timeout: 60_000, maxWait: 10_000 }
  );
  invalidateUserAuthCache(webUser.userId);
  return result;
}

/** The keys a draft made from a needs assessment still lacks (the wizard's "Needs your input"). */
async function missingKeys(db: Db, projectId: string): Promise<NeedsAssessmentFieldKey[]> {
  const p = await db.project.findUnique({
    where: { id: projectId },
    select: {
      tenantId: true,
      name: true,
      projectTypeId: true,
      interventionYear: true,
      lotId: true,
      stateCode: true,
      fundingSourceCode: true,
      totalBudgetNgn: true,
      _count: { select: { boqItems: true } },
    },
  });
  if (!p) return [];
  const hasTypes = (await db.projectType.count({ where: { tenantId: p.tenantId, isActive: true } })) > 0;
  const out: NeedsAssessmentFieldKey[] = [];
  if (!p.name?.trim()) out.push('name');
  if (hasTypes && !p.projectTypeId) out.push('projectTypeId');
  if (p.interventionYear === null) out.push('interventionYear');
  if (!p.lotId) out.push('lot');
  if (!p.stateCode) out.push('stateCode');
  if (!p.fundingSourceCode) out.push('fundingSourceCode');
  if (p.totalBudgetNgn === null) out.push('totalBudgetNgn');
  if (p._count.boqItems === 0) out.push('scope');
  return out;
}

/**
 * The setup DTO's `needsAssessmentImport`: what the confirm stored, with `needsInput` recomputed as
 * the keys still missing on the project now. Read from `setupState.needsAssessment`; the
 * SCOPE_IMPORTED audit payload is the fallback when a later setupState write did not keep the key.
 */
export async function getNeedsAssessmentImportState(projectId: string): Promise<NeedsAssessmentImportState | null> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { setupState: true } });
  if (!project) return null;
  const raw = (project.setupState as Record<string, unknown> | null)?.needsAssessment;
  let stored = NeedsAssessmentImportStateSchema.safeParse(raw).data ?? null;
  if (!stored) {
    const entry = await prisma.auditLog.findFirst({
      where: { projectId, action: 'SCOPE_IMPORTED', payload: { path: ['needsAssessmentFirst'], equals: true } },
      orderBy: { seq: 'asc' },
      select: { createdAt: true, payload: true },
    });
    if (!entry) return null;
    const payload = entry.payload as { fileName?: string | null; filled?: unknown };
    stored = NeedsAssessmentImportStateSchema.safeParse({
      importedAt: entry.createdAt.toISOString(),
      fileName: payload.fileName ?? null,
      filled: Array.isArray(payload.filled) ? payload.filled : [],
      needsInput: [],
    }).data ?? null;
    if (!stored) return null;
  }
  return { ...stored, needsInput: await missingKeys(prisma, projectId) };
}
