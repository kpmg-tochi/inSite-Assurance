import {
  NEEDS_STAGE_ORDER,
  PROPOSAL_FLAG_KIND_META,
  PROPOSAL_FLAG_RESOLUTION_LABELS,
  XLSX_CONTENT_TYPE,
  formatCalendarDate,
  lgaByCode,
  standardRateFor,
  stateByCode,
  zoneOfState,
  type NeedsCycleDocumentDto,
  type NeedsReportKind,
  type NeedsStage,
  type ProposalFlagKind,
  type ProposalFlagResolution,
  type SiteVerification,
} from '@insite/shared';
import { prisma } from '../../../config/prisma';
import { AppError } from '../../../middleware/error.middleware';
import type { WebJwtPayload } from '../../../middleware/auth.middleware';
import { generateRegisterPdf, type RegisterPdfColumn } from '../../../integrations/register-pdf.service';
import { buildExportWorkbook, dateCell, generatedLine, type ExportColumn } from '../../../utils/exportSheet';
import { safeZone } from '../../kpis/kpis.service';
import { parseTenantBranding } from '../../rbac/rbac.service';
import { workspaceShortName } from '../../scope/scopeImport.service';
import { loadWritableCycle, type CycleRow } from '../needsAccess';
import { PDF_CONTENT_TYPE, registerGeneratedReportInTx, storeGeneratedReportFiles, type GeneratedReportFile } from '../needsGeneratedDocuments';
import { costingStandardById, cycleConfig, dec, facilitiesSummary, facilityNames, parsedOf } from '../needsSupport';
import { lockCycle } from '../needsVersions';
import { holds } from '../decisions/proposalRules';

/**
 * Needs pipeline wave 3 (A6, D-N.5): the generated cycle reports of the stage work.
 * - Validated Project List: every proposal of the cycle that passed Validation and was not closed as
 *   not validated, withdrawn or merged (reference, title, State, LGAs, sites, facilities, preliminary
 *   cost, validated on and by, site verification date and method, resolved flags).
 * - Cost Estimate Report: every proposal past Costing (preliminary cost, costed subtotal, S&M,
 *   contingency, total, the same quantities at the standard's rates, variance, acknowledged flags with
 *   their reasons; a totals row).
 * Each is an xlsx (`exportSheet.ts`, UBEC styling) and a PDF (`generateRegisterPdf`; amounts as "NGN").
 * Generated after a stage decision commits (VALIDATION with an ADVANCE, COSTING with an ADVANCE) and
 * on demand (`POST /cycles/:cycleId/reports/:kind`); each regeneration supersedes the last.
 * The Prioritised Project Portfolio is Track B's (committee).
 */

export const STAGE_REPORT_KINDS = ['VALIDATED_PROJECT_LIST', 'COST_ESTIMATE_REPORT'] as const;
export type StageReportKind = (typeof STAGE_REPORT_KINDS)[number];

const REPORT_STAGE: Record<StageReportKind, NeedsStage> = { VALIDATED_PROJECT_LIST: 'VALIDATION', COST_ESTIMATE_REPORT: 'COSTING' };
const REPORT_TITLE: Record<StageReportKind, string> = { VALIDATED_PROJECT_LIST: 'Validated Project List', COST_ESTIMATE_REPORT: 'Cost Estimate Report' };
const EXCLUDED_STATUSES = ['NOT_VALIDATED', 'WITHDRAWN', 'MERGED'];
const idx = (s: string) => NEEDS_STAGE_ORDER.indexOf(s as NeedsStage);

const money = (n: number | null | undefined) => (n === null || n === undefined ? '' : `NGN ${Math.round(n).toLocaleString('en-GB')}`);
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '' : `${n.toFixed(1)}%`);
const round2 = (n: number) => Math.round(n * 100) / 100;

const METHOD_LABELS: Record<string, string> = { WEB_EVIDENCE: 'Evidence uploaded on the web', FIELD_APP: 'Field app visit' };

function flagLine(f: { kind: string; resolution: string | null; resolutionReason: string | null }): string {
  const kind = PROPOSAL_FLAG_KIND_META[f.kind as ProposalFlagKind]?.label ?? f.kind;
  const how = f.resolution ? PROPOSAL_FLAG_RESOLUTION_LABELS[f.resolution as ProposalFlagResolution] ?? f.resolution : '';
  return `${kind}: ${how}${f.resolutionReason ? ` (${f.resolutionReason})` : ''}`;
}

interface ReportContext {
  cycle: CycleRow;
  typeName: string;
  tenantName: string;
  zone: string;
  branding: ReturnType<typeof parseTenantBranding>;
  label: string;
  filePrefix: string;
}

async function reportContext(cycle: CycleRow): Promise<ReportContext> {
  const [tenant, type] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: cycle.tenantId }, select: { name: true, timezone: true, brandingConfig: true } }),
    prisma.projectType.findUniqueOrThrow({ where: { id: cycle.projectTypeId }, select: { name: true } }),
  ]);
  const state = cycle.stateCode ? stateByCode(cycle.stateCode)?.name ?? cycle.stateCode : null;
  const config = cycleConfig(cycle);
  return {
    cycle,
    typeName: type.name,
    tenantName: tenant.name,
    zone: safeZone(tenant.timezone),
    branding: parseTenantBranding(tenant.brandingConfig),
    label: `${type.name} ${cycle.interventionYear}${state ? `, ${state}` : ''}`,
    filePrefix: `${cycle.interventionYear} ${config.referencePrefix}${cycle.stateCode ? `-${cycle.stateCode}` : ''}`,
  };
}

interface BuiltReport {
  title: string;
  proposalIds: string[];
  files: GeneratedReportFile[];
}

async function buildFiles<T>(
  ctx: ReportContext,
  kind: StageReportKind,
  byName: string,
  rows: T[],
  columns: Array<ExportColumn<T> & { pdf: (row: T) => string; weight: number; align?: RegisterPdfColumn['align'] }>,
  totals: { label: string; values: Record<number, number> } | null,
  footnote?: string
): Promise<GeneratedReportFile[]> {
  const now = new Date();
  const title = REPORT_TITLE[kind];
  const short = workspaceShortName(ctx.tenantName) ?? ctx.tenantName;
  const xlsx = await buildExportWorkbook({
    brandName: short,
    title: `${title}: ${ctx.label}`,
    generatedAt: now,
    sheets: [
      {
        name: title,
        title: `${short} · ${title} · ${ctx.label}`,
        hint: `${rows.length} proposed project${rows.length === 1 ? '' : 's'} · ${generatedLine(now, ctx.zone, byName)}`,
        columns: columns.map(({ header, width, format, wrap, value }) => ({ header, width, format, wrap, value })),
        rows,
        emptyText: 'No proposed project has passed this stage yet.',
        totals: totals ?? undefined,
      },
    ],
  });
  const pdfRows = rows.map((r) => columns.map((c) => c.pdf(r)));
  if (totals) pdfRows.push(columns.map((c, i) => (i === 0 ? totals.label : totals.values[i] !== undefined ? money(totals.values[i]) : '')));
  const pdf = await generateRegisterPdf({
    branding: {
      tenantName: ctx.tenantName,
      headerTitle: `${short} needs assessment`,
      footerDisclaimer: ctx.branding.pdfFooterDisclaimer || undefined,
      primaryColorHex: ctx.branding.primaryColorHex || undefined,
      timeZone: ctx.zone,
    },
    heading: title,
    subtitle: `${ctx.label} · ${rows.length} proposed project${rows.length === 1 ? '' : 's'} · prepared for ${byName}`,
    columns: columns.map((c) => ({ header: c.header, weight: c.weight, align: c.align })),
    rows: pdfRows,
    footnote,
  });
  return [
    { buffer: xlsx, fileName: `${ctx.filePrefix} ${title}.xlsx`, mimeType: XLSX_CONTENT_TYPE },
    { buffer: pdf, fileName: `${ctx.filePrefix} ${title}.pdf`, mimeType: PDF_CONTENT_TYPE },
  ];
}

const lgaNames = (codes: string[]) => codes.map((c) => lgaByCode(c)?.name ?? c).join(', ');
const stateName = (code: string | null) => (code ? stateByCode(code)?.name ?? code : '');

async function buildValidatedList(ctx: ReportContext, byName: string): Promise<BuiltReport> {
  const proposals = await prisma.needsProposal.findMany({
    where: { cycleId: ctx.cycle.id, status: { notIn: EXCLUDED_STATUSES } },
    include: {
      currentVersion: { select: { siteCount: true } },
      breakdownRows: { select: { facilityCode: true, proposedQuantity: true }, orderBy: { sortOrder: 'asc' } },
      flags: { where: { kind: { in: ['DUPLICATE', 'ESSENTIAL_FACILITY_GAP'] }, resolvedAt: { not: null }, resolution: { not: 'CORRECTED' } }, orderBy: { resolvedAt: 'asc' } },
      validationRecords: { where: { outcome: 'ADVANCE' }, orderBy: { recordedAt: 'desc' }, take: 1 },
      decisionItems: {
        where: { outcome: 'ADVANCE', decision: { stage: 'VALIDATION' } },
        include: { decision: { select: { decidedAt: true, decidedByName: true } } },
      },
    },
    orderBy: { sequence: 'asc' },
  });
  const passed = proposals.filter((p) => idx(p.stage) > idx('VALIDATION'));
  const names = await facilityNames(ctx.cycle.tenantId);
  type Row = (typeof passed)[number] & { validatedAt: Date | null; validatedBy: string | null; verification: SiteVerification | null; facilities: string };
  const rows: Row[] = passed.map((p) => {
    const latest = [...p.decisionItems].sort((a, b) => b.decision.decidedAt.getTime() - a.decision.decidedAt.getTime())[0];
    return {
      ...p,
      validatedAt: latest?.decision.decidedAt ?? null,
      validatedBy: latest?.decision.decidedByName ?? null,
      verification: (p.validationRecords[0]?.siteVerificationJson as SiteVerification | null) ?? null,
      facilities: facilitiesSummary(
        p.breakdownRows.map((r) => ({ facilityCode: r.facilityCode, proposedQuantity: Number(r.proposedQuantity) })),
        names
      ),
    };
  });
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const columns: Array<ExportColumn<Row> & { pdf: (row: Row) => string; weight: number; align?: RegisterPdfColumn['align'] }> = [
    { header: 'Reference', width: 16, value: (r) => r.reference, pdf: (r) => r.reference, weight: 8 },
    { header: 'Title', width: 34, wrap: true, value: (r) => r.title, pdf: (r) => r.title, weight: 16 },
    { header: 'State', width: 12, value: (r) => stateName(r.stateCode), pdf: (r) => stateName(r.stateCode), weight: 6 },
    { header: 'LGAs', width: 18, wrap: true, value: (r) => lgaNames(r.lgaCodes), pdf: (r) => lgaNames(r.lgaCodes), weight: 9 },
    { header: 'Sites', width: 8, format: 'integer', value: (r) => r.currentVersion?.siteCount ?? 0, pdf: (r) => String(r.currentVersion?.siteCount ?? 0), weight: 4, align: 'right' },
    { header: 'Facilities', width: 30, wrap: true, value: (r) => r.facilities, pdf: (r) => r.facilities, weight: 14 },
    { header: 'Preliminary cost (₦)', width: 16, format: 'money', value: (r) => dec(r.preliminaryAmountNgn), pdf: (r) => money(dec(r.preliminaryAmountNgn)), weight: 9, align: 'right' },
    { header: 'Validated on', width: 12, format: 'date', value: (r) => dateCell(day(r.validatedAt)), pdf: (r) => formatCalendarDate(day(r.validatedAt)), weight: 7, align: 'center' },
    { header: 'Validated by', width: 18, value: (r) => r.validatedBy ?? '', pdf: (r) => r.validatedBy ?? '', weight: 9 },
    {
      header: 'Site verification',
      width: 22,
      wrap: true,
      value: (r) => (r.verification ? `${formatCalendarDate(r.verification.verifiedOn)}, ${METHOD_LABELS[r.verification.method] ?? r.verification.method}` : 'Not recorded'),
      pdf: (r) => (r.verification ? `${formatCalendarDate(r.verification.verifiedOn)}\n${METHOD_LABELS[r.verification.method] ?? r.verification.method}` : 'Not recorded'),
      weight: 10,
    },
    { header: 'Resolved flags', width: 40, wrap: true, value: (r) => r.flags.map(flagLine).join('\n'), pdf: (r) => r.flags.map(flagLine).join('\n'), weight: 16 },
  ];
  const files = await buildFiles(ctx, 'VALIDATED_PROJECT_LIST', byName, rows, columns, null);
  return { title: `${REPORT_TITLE.VALIDATED_PROJECT_LIST}: ${ctx.label}`, proposalIds: rows.map((r) => r.id), files };
}

async function buildCostEstimate(ctx: ReportContext, byName: string): Promise<BuiltReport> {
  const proposals = await prisma.needsProposal.findMany({
    where: { cycleId: ctx.cycle.id, status: { notIn: EXCLUDED_STATUSES } },
    include: {
      currentVersion: { select: { parsedJson: true } },
      versions: { select: { number: true, source: true, preliminaryCostNgn: true }, orderBy: { number: 'desc' } },
      flags: { where: { kind: { in: ['RATE_VARIANCE', 'CEILING_EXCEEDED'] }, resolution: 'ACKNOWLEDGED' }, orderBy: { resolvedAt: 'asc' } },
    },
    orderBy: { sequence: 'asc' },
  });
  const passed = proposals.filter((p) => idx(p.stage) > idx('COSTING'));
  const standard = await costingStandardById(ctx.cycle.costingStandardVersionId);
  type Row = {
    id: string;
    reference: string;
    title: string;
    preliminary: number | null;
    subtotal: number | null;
    sm: number | null;
    contingency: number | null;
    total: number | null;
    atStandard: number | null;
    variancePct: number | null;
    flags: string;
  };
  const rows: Row[] = passed.map((p) => {
    const parsed = parsedOf(p.currentVersion?.parsedJson);
    const summary = parsed?.costingSummary ?? null;
    // Variance compares the lines the standard lists with the same quantities at its rates.
    let atStandard: number | null = null;
    let matchedActual = 0;
    if (parsed && standard) {
      const zone = zoneOfState(p.stateCode);
      for (const l of parsed.boqLines) {
        const rate = standardRateFor(standard.standard, l.itemCode, zone);
        if (rate === null) continue;
        atStandard = (atStandard ?? 0) + l.totalQuantity * rate;
        matchedActual += l.amountNgn;
      }
    }
    const preliminary = p.versions.find((v) => v.source !== 'COSTING')?.preliminaryCostNgn ?? null;
    return {
      id: p.id,
      reference: p.reference,
      title: p.title,
      preliminary: dec(preliminary),
      subtotal: summary?.subtotalNgn ?? null,
      sm: summary?.supervisionMonitoringNgn ?? null,
      contingency: summary?.contingencyNgn ?? null,
      total: dec(p.costedAmountNgn) ?? summary?.totalNgn ?? null,
      atStandard: atStandard === null ? null : round2(atStandard),
      variancePct: atStandard ? round2(((matchedActual - atStandard) / atStandard) * 100) : null,
      flags: p.flags.map(flagLine).join('\n'),
    };
  });
  const sum = (f: (r: Row) => number | null) => round2(rows.reduce((s, r) => s + (f(r) ?? 0), 0));
  const columns: Array<ExportColumn<Row> & { pdf: (row: Row) => string; weight: number; align?: RegisterPdfColumn['align'] }> = [
    { header: 'Reference', width: 16, value: (r) => r.reference, pdf: (r) => r.reference, weight: 8 },
    { header: 'Title', width: 34, wrap: true, value: (r) => r.title, pdf: (r) => r.title, weight: 16 },
    { header: 'Preliminary cost (₦)', width: 16, format: 'money', value: (r) => r.preliminary, pdf: (r) => money(r.preliminary), weight: 9, align: 'right' },
    { header: 'Costed subtotal (₦)', width: 16, format: 'money', value: (r) => r.subtotal, pdf: (r) => money(r.subtotal), weight: 9, align: 'right' },
    { header: 'Supervision and monitoring (₦)', width: 16, format: 'money', value: (r) => r.sm, pdf: (r) => money(r.sm), weight: 9, align: 'right' },
    { header: 'Contingency (₦)', width: 16, format: 'money', value: (r) => r.contingency, pdf: (r) => money(r.contingency), weight: 8, align: 'right' },
    { header: 'Total (₦)', width: 17, format: 'money', value: (r) => r.total, pdf: (r) => money(r.total), weight: 9, align: 'right' },
    { header: 'At standard rates (₦)', width: 17, format: 'money', value: (r) => r.atStandard, pdf: (r) => money(r.atStandard), weight: 9, align: 'right' },
    { header: 'Variance', width: 10, format: 'number', value: (r) => r.variancePct, pdf: (r) => pct(r.variancePct), weight: 5, align: 'right' },
    { header: 'Acknowledged flags', width: 40, wrap: true, value: (r) => r.flags, pdf: (r) => r.flags, weight: 18 },
  ];
  const totals = {
    label: 'Total',
    values: { 2: sum((r) => r.preliminary), 3: sum((r) => r.subtotal), 4: sum((r) => r.sm), 5: sum((r) => r.contingency), 6: sum((r) => r.total), 7: sum((r) => r.atStandard) },
  };
  const files = await buildFiles(
    ctx,
    'COST_ESTIMATE_REPORT',
    byName,
    rows,
    columns,
    rows.length ? totals : null,
    standard ? `At standard rates: the BoQ lines whose item the costing standard (version ${standard.version}) lists, at its rates for the State's zone; variance in % of that amount.` : undefined
  );
  return { title: `${REPORT_TITLE.COST_ESTIMATE_REPORT}: ${ctx.label}`, proposalIds: rows.map((r) => r.id), files };
}

/**
 * Builds the report, stores its files (outside any transaction), then registers them under the cycle
 * lock in a short transaction (actor = `by`).
 */
export async function generateStageReport(params: {
  cycle: CycleRow;
  kind: StageReportKind;
  by: { userId: string; name: string; actor: { actorType: 'WEB_USER' | 'SYSTEM'; actorId: string; actorDisplayName: string } };
}): Promise<NeedsCycleDocumentDto[]> {
  const ctx = await reportContext(params.cycle);
  const built = params.kind === 'VALIDATED_PROJECT_LIST' ? await buildValidatedList(ctx, params.by.name) : await buildCostEstimate(ctx, params.by.name);
  const stored = await storeGeneratedReportFiles(params.cycle.tenantId, params.cycle.id, built.files);
  return prisma.$transaction(async (tx) => {
    await lockCycle(tx, params.cycle.id);
    return registerGeneratedReportInTx(tx, {
      tenantId: params.cycle.tenantId,
      cycleId: params.cycle.id,
      kind: params.kind as NeedsReportKind,
      title: built.title,
      proposalIds: built.proposalIds,
      files: stored,
      by: { userId: params.by.userId, name: params.by.name },
      actor: params.by.actor,
    });
  });
}

/** `POST /cycles/:cycleId/reports/:kind`: the stage's actor or `needs:manage_cycle`, on a writable cycle. */
export async function regenerateStageReport(user: WebJwtPayload, cycleId: string, kind: string): Promise<NeedsCycleDocumentDto[]> {
  if (!(STAGE_REPORT_KINDS as readonly string[]).includes(kind)) throw new AppError('Report not found', 404, 'NEEDS_REPORT_NOT_FOUND');
  const reportKind = kind as StageReportKind;
  const cycle = await loadWritableCycle(user, cycleId);
  const config = cycleConfig(cycle);
  const actor = config.stages.find((s) => s.stage === REPORT_STAGE[reportKind])?.actorPermissionKey ?? null;
  if (!(actor && holds(user, actor)) && !holds(user, 'needs:manage_cycle')) {
    throw new AppError(`Access requires permission(s): ${[actor, 'needs:manage_cycle'].filter(Boolean).join(' or ')}`, 403, 'FORBIDDEN_PERMISSION');
  }
  return generateStageReport({
    cycle,
    kind: reportKind,
    by: { userId: user.userId, name: user.fullName, actor: { actorType: 'WEB_USER', actorId: user.userId, actorDisplayName: `${user.fullName} (${user.roleName})` } },
  });
}
