import { XLSX_CONTENT_TYPE, lgaByCode, stateByCode, type NeedsRankingRow } from '@insite/shared';
import { prisma } from '../../../config/prisma';
import { generateRegisterPdf, type RegisterPdfColumn } from '../../../integrations/register-pdf.service';
import { buildExportWorkbook, generatedLine, type ExportColumn } from '../../../utils/exportSheet';
import { parseTenantBranding } from '../../rbac/rbac.service';
import { workspaceShortName } from '../../scope/scopeImport.service';
import type { CycleRow } from '../needsAccess';
import { PDF_CONTENT_TYPE, type GeneratedReportFile } from '../needsGeneratedDocuments';
import { cycleConfig, parsedOf } from '../needsSupport';
import type { ComputedRanking } from './committeeFacts';

/**
 * Needs pipeline wave 3, Track B (B4): the Prioritised Project Portfolio (D-N.5; plan: list, business
 * case, location, impact, beneficiaries, cost, timeline, strategy), from the finalised ranking. One
 * xlsx (UBEC sheet style) and one landscape PDF (amounts as "NGN": the PDF font has no ₦ glyph).
 */

interface PortfolioRow extends NeedsRankingRow {
  businessCase: string;
  location: string;
  siteCount: number;
  beneficiaries: string;
  durationMonths: number | null;
  assumptions: string;
  side: string;
}

const money = (n: number | null) => (n === null ? '' : `NGN ${n.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`);
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '' : n.toFixed(2));

async function portfolioRows(ranking: ComputedRanking): Promise<PortfolioRow[]> {
  const ids = ranking.rows.map((r) => r.proposalId);
  const [proposals, sites] = await Promise.all([
    prisma.needsProposal.findMany({ where: { id: { in: ids } }, select: { id: true, currentVersion: { select: { parsedJson: true } } } }),
    prisma.needsProposalSite.findMany({ where: { proposalId: { in: ids } }, select: { proposalId: true, enrolment: true } }),
  ]);
  const parsedById = new Map(proposals.map((p) => [p.id, parsedOf(p.currentVersion?.parsedJson)]));
  return ranking.rows.map((r) => {
    const parsed = parsedById.get(r.proposalId) ?? null;
    const own = sites.filter((s) => s.proposalId === r.proposalId);
    const enrolment = own.reduce((sum, s) => sum + (s.enrolment ?? 0), 0);
    const state = stateByCode(r.stateCode)?.name ?? r.stateCode ?? '';
    const lgas = r.lgaCodes.map((c) => lgaByCode(c)?.name ?? c).join(', ');
    const beneficiaries = [parsed?.project.beneficiaries, enrolment ? `${enrolment.toLocaleString('en-NG')} pupils enrolled` : null].filter(Boolean).join('; ');
    const override = r.placement && r.aboveLine !== r.computedAboveLine ? r.placementReason : null;
    return {
      ...r,
      businessCase: parsed?.project.justification ?? '',
      location: [state, lgas].filter(Boolean).join(': '),
      siteCount: own.length,
      beneficiaries,
      durationMonths: parsed?.project.estimatedDurationMonths ?? null,
      assumptions: parsed?.project.assumptions ?? '',
      side: `${r.aboveLine ? 'Above' : 'Below'} the line${override ? ` (override: ${override})` : ''}`,
    };
  });
}

export async function buildPrioritisedPortfolioFiles(params: {
  cycle: CycleRow;
  ranking: ComputedRanking;
  preparedBy: string;
}): Promise<{ files: GeneratedReportFile[]; title: string }> {
  const { cycle, ranking } = params;
  const now = new Date();
  const [tenant, type, rows] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: cycle.tenantId }, select: { name: true, timezone: true, brandingConfig: true } }),
    prisma.projectType.findUniqueOrThrow({ where: { id: cycle.projectTypeId }, select: { name: true } }),
    portfolioRows(ranking),
  ]);
  const config = cycleConfig(cycle);
  const zone = tenant.timezone || 'Africa/Lagos';
  const brand = workspaceShortName(tenant.name);
  const scope = [String(cycle.interventionYear), config.referencePrefix, cycle.stateCode].filter(Boolean).join(' ');
  const title = `${scope} Prioritised Project Portfolio`;
  const ceiling = cycle.indicativeCeilingNgn === null ? null : Number(cycle.indicativeCeilingNgn);
  const above = rows.filter((r) => r.aboveLine);
  const lineText = [
    `${above.length} of ${rows.length} proposed project${rows.length === 1 ? '' : 's'} above the funding line, ${money(ranking.totalAboveNgn) || 'NGN 0'}`,
    ceiling === null ? 'no indicative ceiling' : `indicative ceiling ${money(ceiling)}`,
    cycle.fundingLineReason ? `line moved by the chair: ${cycle.fundingLineReason}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const subtitle = `${type.name} · ${lineText} · finalised by ${cycle.rankingFinalisedByName ?? params.preparedBy}`;

  const columns: Array<ExportColumn<PortfolioRow>> = [
    { header: 'Rank', width: 6, format: 'integer', value: (r) => r.rank },
    { header: 'Reference', width: 16, value: (r) => r.reference },
    { header: 'Proposed project', width: 32, wrap: true, value: (r) => r.title },
    { header: 'Business case', width: 48, wrap: true, value: (r) => r.businessCase },
    { header: 'Location (State: LGAs)', width: 28, wrap: true, value: (r) => r.location },
    { header: 'Sites', width: 7, format: 'integer', value: (r) => r.siteCount },
    { header: 'Impact (0–100)', width: 10, format: 'number', value: (r) => r.score?.impact ?? null },
    { header: 'Ease (0–100)', width: 10, format: 'number', value: (r) => r.score?.ease ?? null },
    { header: 'Total score', width: 10, format: 'number', value: (r) => r.score?.total ?? null },
    { header: 'Beneficiaries', width: 30, wrap: true, value: (r) => r.beneficiaries },
    { header: 'Costed amount', width: 18, format: 'money', value: (r) => r.costNgn },
    { header: 'Cumulative amount', width: 18, format: 'money', value: (r) => r.cumulativeNgn },
    { header: 'Funding line', width: 30, wrap: true, value: (r) => r.side },
    { header: 'Estimated duration (months)', width: 12, format: 'integer', value: (r) => r.durationMonths },
    { header: 'Assumptions (strategy)', width: 40, wrap: true, value: (r) => r.assumptions },
  ];
  const costIndex = columns.findIndex((c) => c.header === 'Costed amount');
  const xlsx = await buildExportWorkbook({
    brandName: brand,
    title,
    generatedAt: now,
    sheets: [
      {
        name: 'Prioritised portfolio',
        title: [brand, title].filter(Boolean).join(' · '),
        hint: `${subtitle} · ${generatedLine(now, zone, params.preparedBy)}`,
        columns,
        rows,
        emptyText: 'No proposed project was ranked.',
        totals: { label: `Total above the line (${above.length})`, values: { [costIndex]: ranking.totalAboveNgn } },
      },
    ],
  });

  const branding = parseTenantBranding(tenant.brandingConfig);
  const pdfColumns: Array<RegisterPdfColumn & { value: (r: PortfolioRow) => string }> = [
    { header: 'Rank', weight: 3, align: 'right', value: (r) => (r.rank === null ? '' : String(r.rank)) },
    { header: 'Reference\nProposed project', weight: 12, value: (r) => `${r.reference}\n${r.title}` },
    { header: 'Business case', weight: 17, value: (r) => r.businessCase },
    { header: 'Location\nSites', weight: 10, value: (r) => [r.location, `${r.siteCount} site${r.siteCount === 1 ? '' : 's'}`].filter(Boolean).join('\n') },
    { header: 'Impact · Ease\nTotal', weight: 6, align: 'right', value: (r) => (r.score ? `${pct(r.score.impact)} · ${pct(r.score.ease)}\n${pct(r.score.total)}` : '') },
    { header: 'Beneficiaries', weight: 10, value: (r) => r.beneficiaries },
    { header: 'Costed amount\nCumulative', weight: 10, align: 'right', value: (r) => [money(r.costNgn), money(r.cumulativeNgn)].join('\n') },
    { header: 'Funding line', weight: 10, value: (r) => r.side },
    { header: 'Duration', weight: 4, align: 'right', value: (r) => (r.durationMonths ? `${r.durationMonths} mo` : '') },
    { header: 'Assumptions (strategy)', weight: 14, value: (r) => r.assumptions },
  ];
  const totalRow = pdfColumns.map((c, i) =>
    i === 1 ? `Total above the line (${above.length})` : c.header.startsWith('Costed') ? money(ranking.totalAboveNgn) || 'NGN 0' : ''
  );
  const pdf = await generateRegisterPdf({
    branding: {
      tenantName: tenant.name,
      headerTitle: brand ? `${brand} needs assessment` : 'Needs assessment',
      footerDisclaimer: branding.pdfFooterDisclaimer || undefined,
      primaryColorHex: branding.primaryColorHex || undefined,
      timeZone: zone,
    },
    heading: title,
    subtitle,
    columns: pdfColumns,
    rows: [...rows.map((r) => pdfColumns.map((c) => c.value(r))), totalRow],
    footnote: `Funding line: ${lineText}. Scores are the committee's means on 0–100 (Impact and Ease of Implementation, weighted). Ties: higher Impact, then lower cost. Prepared for ${params.preparedBy}.`,
  });

  return {
    title,
    files: [
      { buffer: xlsx, fileName: `${title}.xlsx`, mimeType: XLSX_CONTENT_TYPE },
      { buffer: pdf, fileName: `${title}.pdf`, mimeType: PDF_CONTENT_TYPE },
    ],
  };
}
