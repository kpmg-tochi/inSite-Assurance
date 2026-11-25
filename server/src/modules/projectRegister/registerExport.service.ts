import {
  formatProjectCode,
  fundingSourceLabel,
  lgaByCode,
  PortfolioOverviewProject,
  ProjectRegisterFilterOptionsDto,
  ProjectRegisterFilters,
  projectStageChipLabel,
  resolveTerminology,
  stateByCode,
  zoneName,
  zonedCalendarDate,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { hasWebPermission, type WebJwtPayload } from '../../middleware/auth.middleware';
import { buildProjectVisibilityWhere } from '../../utils/accessControl';
import { buildExportWorkbook, dateCell, ExportColumn, generatedLine } from '../../utils/exportSheet';
import { generateRegisterPdf, RegisterPdfColumn } from '../../integrations/register-pdf.service';
import { parseTenantBranding } from '../rbac/rbac.service';
import { getPortfolioOverview } from '../projects/projects.service';
import { workspaceShortName } from '../scope/scopeImport.service';

/**
 * UBEC IRL: the project register export (.xlsx and .pdf) and the register filter options. Rows come
 * from the portfolio overview with the register filters (`registerFilterWhere`), so the file holds
 * exactly the projects the caller can see and has filtered to. "Paid to date" is included only for
 * holders of `payments:view`.
 */

const STATUS_LABEL: Record<NonNullable<ProjectRegisterFilters['status']>, string> = {
  ongoing: 'Ongoing',
  behind: 'Behind schedule',
  completed: 'Completed',
  archived: 'Archived',
};

/** GET /projects/register/options: distinct values over the projects the caller can see (live and archived). */
export async function getRegisterFilterOptions(webUser: WebJwtPayload): Promise<ProjectRegisterFilterOptionsDto> {
  const projects = await prisma.project.findMany({
    where: buildProjectVisibilityWhere(webUser, undefined, { statuses: ['ACTIVE', 'ARCHIVED'] }),
    select: {
      lgaLocation: true,
      interventionYear: true,
      fundingSource: true,
      owningOrganization: { select: { id: true, name: true } },
      contractors: { select: { organization: { select: { id: true, name: true } } } },
    },
  });
  const lgas = new Map<string, string>();
  const funding = new Map<string, string>();
  const years = new Set<number>();
  const contractors = new Map<string, string>();
  const owners = new Map<string, string>();
  for (const p of projects) {
    const lga = p.lgaLocation?.trim();
    if (lga && !lgas.has(lga.toLowerCase())) lgas.set(lga.toLowerCase(), lga);
    const fs = p.fundingSource?.trim();
    if (fs && !funding.has(fs.toLowerCase())) funding.set(fs.toLowerCase(), fs);
    if (p.interventionYear) years.add(p.interventionYear);
    if (p.owningOrganization) owners.set(p.owningOrganization.id, p.owningOrganization.name);
    for (const c of p.contractors) contractors.set(c.organization.id, c.organization.name);
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return {
    lgas: [...lgas.values()].sort((a, b) => a.localeCompare(b)),
    contractors: [...contractors.entries()].map(([id, name]) => ({ id, name })).sort(byName),
    interventionYears: [...years].sort((a, b) => b - a),
    fundingSources: [...funding.values()].sort((a, b) => a.localeCompare(b)),
    owners: [...owners.entries()].map(([id, name]) => ({ id, name })).sort(byName),
  };
}

interface RegisterRow {
  p: PortfolioOverviewProject;
  contractSumNgn: number | null;
}

async function loadRegister(webUser: WebJwtPayload, filters: ProjectRegisterFilters) {
  const [overview, tenant] = await Promise.all([
    getPortfolioOverview(webUser, filters),
    prisma.tenant.findUniqueOrThrow({
      where: { id: webUser.tenantId },
      select: { name: true, timezone: true, brandingConfig: true, terminologyLabels: true },
    }),
  ]);
  const sums = overview.projects.length
    ? await prisma.project.findMany({ where: { id: { in: overview.projects.map((p) => p.id) } }, select: { id: true, contractSumNgn: true } })
    : [];
  const sumById = new Map(sums.map((s) => [s.id, s.contractSumNgn === null ? null : Number(s.contractSumNgn)]));
  const rows: RegisterRow[] = [...overview.projects]
    .sort((a, b) => a.codePrefix.localeCompare(b.codePrefix, undefined, { numeric: true }))
    .map((p) => ({ p, contractSumNgn: sumById.get(p.id) ?? null }));
  return {
    rows,
    tenant,
    brand: workspaceShortName(tenant.name),
    zone: tenant.timezone || 'Africa/Lagos',
    term: resolveTerminology(tenant.terminologyLabels).externalReference.singular,
    canSeePaid: hasWebPermission(webUser, 'payments:view'),
  };
}

/** "Type: Direct Intervention · State: Kano · Status: Ongoing · Search: "Kano"" (names resolved). */
async function describeFilters(tenantId: string, f: ProjectRegisterFilters): Promise<string> {
  const [type, region, owner, contractor] = await Promise.all([
    f.projectTypeId ? prisma.projectType.findFirst({ where: { id: f.projectTypeId, tenantId }, select: { name: true } }) : null,
    f.regionId ? prisma.region.findFirst({ where: { id: f.regionId, tenantId }, select: { name: true } }) : null,
    f.owningOrganizationId ? prisma.organization.findFirst({ where: { id: f.owningOrganizationId, tenantId }, select: { name: true } }) : null,
    f.contractorOrganizationId ? prisma.organization.findFirst({ where: { id: f.contractorOrganizationId, tenantId }, select: { name: true } }) : null,
  ]);
  const parts = [
    type && `Type: ${type.name}`,
    region && `Programme zone: ${region.name}`,
    f.lga && `LGA: ${f.lga}`,
    // Client demo updates C1/C4
    f.zone && `Zone: ${zoneName(f.zone) ?? f.zone}`,
    f.stateCode && `State: ${stateByCode(f.stateCode)?.name ?? f.stateCode}`,
    f.lgaCode && `LGA: ${lgaByCode(f.lgaCode)?.name ?? f.lgaCode}`,
    f.fundingSourceCode && `Funding source: ${fundingSourceLabel(f.fundingSourceCode) ?? f.fundingSourceCode}`,
    owner && `Owner: ${owner.name}`,
    contractor && `Contractor: ${contractor.name}`,
    f.interventionYear && `Intervention year: ${f.interventionYear}`,
    f.fundingSource && `Funding source: ${f.fundingSource}`,
    f.status && `Status: ${STATUS_LABEL[f.status]}`,
    f.q && `Search: "${f.q}"`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'All projects you can see';
}

/** "UBEC project register 2026-11-25.xlsx"; "Project register 2026-11-25.xlsx" without a short name. */
export function registerFileName(tenantName: string | null | undefined, date: string, ext: 'xlsx' | 'pdf'): string {
  const short = workspaceShortName(tenantName);
  return short ? `${short} project register ${date}.${ext}` : `Project register ${date}.${ext}`;
}

const scheduleText = (p: PortfolioOverviewProject) => p.scheduleVariance?.label ?? (p.status === 'ARCHIVED' ? 'Archived' : 'Not computed');
const stageText = (p: PortfolioOverviewProject) =>
  p.stage ? `${projectStageChipLabel(p.stage)}${p.stage.contractTerminated ? ' (contract terminated)' : ''}` : '';
const regionText = (p: PortfolioOverviewProject) => p.region?.name ?? p.stateLocation ?? '';
/** Client demo updates C1/C3: zone and state from the national codes; codes as people read them. */
const zoneText = (p: PortfolioOverviewProject) => zoneName(p.zone) ?? '';
const stateText = (p: PortfolioOverviewProject) => stateByCode(p.stateCode)?.name ?? '';
const codeText = (p: PortfolioOverviewProject) => formatProjectCode(p.codePrefix);

export async function buildRegisterXlsx(webUser: WebJwtPayload, filters: ProjectRegisterFilters): Promise<{ buffer: Buffer; fileName: string }> {
  const now = new Date();
  const { rows, tenant, brand, zone, term, canSeePaid } = await loadRegister(webUser, filters);
  const filterText = await describeFilters(webUser.tenantId, filters);
  const columns: ExportColumn<RegisterRow>[] = [
    { header: 'Code', width: 18, value: (r) => codeText(r.p) },
    { header: term, width: 22, value: (r) => r.p.externalReference },
    { header: 'Project', width: 40, wrap: true, value: (r) => r.p.name },
    { header: 'School', width: 30, wrap: true, value: (r) => r.p.primaryBeneficiary?.name ?? null },
    { header: 'Zone', width: 14, value: (r) => zoneText(r.p) || null },
    { header: 'State', width: 14, value: (r) => stateText(r.p) || null },
    { header: 'Programme zone', width: 16, value: (r) => regionText(r.p) },
    { header: 'LGA', width: 16, value: (r) => r.p.lgaLocation },
    { header: 'Type', width: 20, value: (r) => r.p.projectType?.name ?? null },
    { header: 'Owner', width: 22, wrap: true, value: (r) => r.p.owningOrganization?.name ?? null },
    { header: 'Contractor', width: 26, wrap: true, value: (r) => r.p.contractorName },
    { header: 'Contract sum', width: 18, format: 'money', value: (r) => r.contractSumNgn ?? r.p.totalBudgetNgn },
    ...(canSeePaid ? [{ header: 'Paid to date', width: 18, format: 'money' as const, value: (r: RegisterRow) => r.p.disbursedToDateNgn }] : []),
    { header: 'Intervention year', width: 12, format: 'integer', value: (r) => r.p.interventionYear },
    { header: 'Funding source', width: 26, wrap: true, value: (r) => r.p.fundingSource },
    { header: 'Stage', width: 22, wrap: true, value: (r) => stageText(r.p) },
    { header: 'Schedule', width: 16, value: (r) => scheduleText(r.p) },
    { header: '% complete', width: 11, format: 'number', value: (r) => r.p.certifiedProgressPct },
    { header: 'Progress basis', width: 18, value: (r) => (r.p.progressIsImported ? 'Reported at import' : 'Verified visits') },
    {
      header: 'Last approved update',
      width: 14,
      format: 'date',
      value: (r) => dateCell(r.p.lastApprovedUpdateAt ? zonedCalendarDate(new Date(r.p.lastApprovedUpdateAt), zone) : null),
    },
    { header: 'Open findings', width: 10, format: 'integer', value: (r) => r.p.openFindingsCount },
  ];
  const moneyIndex = columns.findIndex((c) => c.header === 'Contract sum');
  const paidIndex = columns.findIndex((c) => c.header === 'Paid to date');
  const buffer = await buildExportWorkbook({
    brandName: brand,
    title: 'Project register',
    generatedAt: now,
    sheets: [
      {
        name: 'Project register',
        title: [brand, 'Project register'].filter(Boolean).join(' · '),
        hint: `${filterText}  |  ${rows.length} project${rows.length === 1 ? '' : 's'}  |  ${generatedLine(now, zone, webUser.fullName)}`,
        columns,
        rows,
        emptyText: 'No projects match these filters.',
        totals: rows.length
          ? {
              label: `${rows.length} project${rows.length === 1 ? '' : 's'}`,
              values: {
                [moneyIndex]: rows.reduce((s, r) => s + (r.contractSumNgn ?? r.p.totalBudgetNgn), 0),
                ...(paidIndex >= 0 ? { [paidIndex]: rows.reduce((s, r) => s + r.p.disbursedToDateNgn, 0) } : {}),
              },
            }
          : undefined,
      },
    ],
  });
  return { buffer, fileName: registerFileName(tenant.name, zonedCalendarDate(now, zone), 'xlsx') };
}

const money = (n: number | null) => (n === null ? '' : `NGN ${Math.round(n).toLocaleString('en-NG')}`);

export async function buildRegisterPdf(webUser: WebJwtPayload, filters: ProjectRegisterFilters): Promise<{ buffer: Buffer; fileName: string }> {
  const now = new Date();
  const { rows, tenant, zone, term, canSeePaid } = await loadRegister(webUser, filters);
  const filterText = await describeFilters(webUser.tenantId, filters);
  const branding = parseTenantBranding(tenant.brandingConfig);
  const lastUpdate = (p: PortfolioOverviewProject) => (p.lastApprovedUpdateAt ? zonedCalendarDate(new Date(p.lastApprovedUpdateAt), zone) : '');
  const columns: Array<RegisterPdfColumn & { value: (r: RegisterRow) => string }> = [
    { header: `Code\n${term}`, weight: 9, value: (r) => [codeText(r.p), r.p.externalReference].filter(Boolean).join('\n') },
    { header: 'Project / school', weight: 17, value: (r) => [r.p.name, r.p.primaryBeneficiary?.name].filter(Boolean).join('\n') },
    { header: 'Zone · State', weight: 8, value: (r) => [zoneText(r.p), stateText(r.p)].filter(Boolean).join('\n') },
    { header: 'State · LGA', weight: 8, value: (r) => [regionText(r.p), r.p.lgaLocation].filter(Boolean).join(' · ') },
    { header: 'Type / owner', weight: 10, value: (r) => [r.p.projectType?.name, r.p.owningOrganization?.name].filter(Boolean).join('\n') },
    { header: 'Contractor', weight: 10, value: (r) => r.p.contractorName ?? '' },
    { header: 'Contract sum', weight: 8, align: 'right', value: (r) => money(r.contractSumNgn ?? r.p.totalBudgetNgn) },
    ...(canSeePaid ? [{ header: 'Paid to date', weight: 8, align: 'right' as const, value: (r: RegisterRow) => money(r.p.disbursedToDateNgn) }] : []),
    { header: 'Year / funding', weight: 9, value: (r) => [r.p.interventionYear ? String(r.p.interventionYear) : '', r.p.fundingSource].filter(Boolean).join('\n') },
    { header: 'Stage / schedule', weight: 10, value: (r) => [stageText(r.p), scheduleText(r.p)].filter(Boolean).join('\n') },
    { header: '% complete', weight: 5, align: 'right', value: (r) => `${r.p.certifiedProgressPct.toFixed(1)}%${r.p.progressIsImported ? '*' : ''}` },
    { header: 'Last approved update', weight: 7, align: 'center', value: (r) => lastUpdate(r.p) },
    { header: 'Open findings', weight: 5, align: 'right', value: (r) => String(r.p.openFindingsCount) },
  ];
  const buffer = await generateRegisterPdf({
    branding: {
      tenantName: tenant.name,
      headerTitle: branding.pdfHeaderTitle || undefined,
      footerDisclaimer: branding.pdfFooterDisclaimer || undefined,
      primaryColorHex: branding.primaryColorHex || undefined,
      timeZone: zone,
    },
    heading: 'Project register',
    subtitle: `${filterText} · ${rows.length} project${rows.length === 1 ? '' : 's'} · prepared for ${webUser.fullName}`,
    columns,
    rows: rows.map((r) => columns.map((c) => c.value(r))),
    footnote: rows.some((r) => r.p.progressIsImported)
      ? '* % complete reported when the project was imported; replaced by verified progress once its scope is added.'
      : undefined,
  });
  return { buffer, fileName: registerFileName(tenant.name, zonedCalendarDate(now, zone), 'pdf') };
}
