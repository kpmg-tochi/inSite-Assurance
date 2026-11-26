import {
  formatProjectCode,
  fundingSourceLabel,
  lgaByCode,
  PortfolioOverviewProject,
  ProjectRegisterFilterOptionsDto,
  ProjectRegisterFilters,
  ProjectSiteSummaryDto,
  projectStageChipLabel,
  SCHOOL_LEVEL_LABELS,
  SITE_STATUS_LABELS,
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

/**
 * One register line: a project, or (client demo updates C2, wave 2) one of its sites, listed right
 * under the project as the client's register does (school, LGA, status, % complete; the contractor
 * repeated on every site row).
 */
interface RegisterRow {
  p: PortfolioOverviewProject;
  contractSumNgn: number | null;
  site?: ProjectSiteSummaryDto;
}

const isProjectRow = (r: RegisterRow) => r.site === undefined;
const siteSchool = (s: ProjectSiteSummaryDto) => `${s.schoolName} (${SCHOOL_LEVEL_LABELS[s.schoolLevel]})`;
const siteCode = (s: ProjectSiteSummaryDto) => `   Site ${s.siteNumber}`;
const siteCount = (p: PortfolioOverviewProject) => p.sites?.length ?? 0;

async function loadRegister(webUser: WebJwtPayload, filters: ProjectRegisterFilters) {
  const [overview, tenant] = await Promise.all([
    getPortfolioOverview(webUser, filters),
    prisma.tenant.findUniqueOrThrow({
      where: { id: webUser.tenantId },
      select: { name: true, timezone: true, brandingConfig: true, terminologyLabels: true },
    }),
  ]);
  const rows: RegisterRow[] = [...overview.projects]
    .sort((a, b) => a.codePrefix.localeCompare(b.codePrefix, undefined, { numeric: true }))
    .flatMap((p) => {
      const contractSumNgn = p.contractSumNgn;
      return [{ p, contractSumNgn }, ...(p.sites ?? []).map((site) => ({ p, contractSumNgn, site }))];
    });
  const projectCount = overview.projects.length;
  return {
    rows,
    projectCount,
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
/**
 * Client demo updates C1/C3: zone and state from the national codes (an older project without a
 * state code: the state it recorded, as the register table shows it); codes as people read them.
 */
const zoneText = (p: PortfolioOverviewProject) => zoneName(p.zone) ?? '';
const stateText = (p: PortfolioOverviewProject) => stateByCode(p.stateCode)?.name ?? (p.stateLocation || p.region?.name || '');
const codeText = (p: PortfolioOverviewProject) => formatProjectCode(p.codePrefix);

export async function buildRegisterXlsx(webUser: WebJwtPayload, filters: ProjectRegisterFilters): Promise<{ buffer: Buffer; fileName: string }> {
  const now = new Date();
  const { rows, projectCount, tenant, brand, zone, term, canSeePaid } = await loadRegister(webUser, filters);
  const filterText = await describeFilters(webUser.tenantId, filters);
  // Site rows (wave 2) fill the site's own cells and repeat the contractor; project-only cells stay empty.
  const projectOnly =
    <T>(fn: (r: RegisterRow) => T) =>
    (r: RegisterRow): T | null =>
      r.site ? null : fn(r);
  const columns: ExportColumn<RegisterRow>[] = [
    { header: 'Code', width: 18, value: (r) => (r.site ? siteCode(r.site) : codeText(r.p)) },
    { header: term, width: 22, value: projectOnly((r) => r.p.externalReference) },
    { header: 'Project', width: 40, wrap: true, value: projectOnly((r) => r.p.name) },
    { header: 'School', width: 30, wrap: true, value: (r) => (r.site ? siteSchool(r.site) : siteCount(r.p) ? null : (r.p.primaryBeneficiary?.name ?? null)) },
    { header: 'Zone', width: 14, value: projectOnly((r) => zoneText(r.p) || null) },
    { header: 'State', width: 14, value: projectOnly((r) => stateText(r.p) || null) },
    { header: 'LGA', width: 16, value: (r) => (r.site ? (r.site.lgaName ?? r.site.lgaCode) : r.p.lgaLocation) },
    { header: 'Number of sites', width: 10, format: 'integer', value: projectOnly((r) => siteCount(r.p) || null) },
    { header: 'Type', width: 20, value: projectOnly((r) => r.p.projectType?.name ?? null) },
    { header: 'Owner', width: 22, wrap: true, value: projectOnly((r) => r.p.owningOrganization?.name ?? null) },
    { header: 'Contractor', width: 26, wrap: true, value: (r) => r.p.contractorName },
    { header: 'Contract sum', width: 18, format: 'money', value: projectOnly((r) => r.contractSumNgn) },
    ...(canSeePaid
      ? [{ header: 'Paid to date', width: 18, format: 'money' as const, value: projectOnly((r: RegisterRow) => r.p.disbursedToDateNgn) }]
      : []),
    { header: 'Intervention year', width: 12, format: 'integer', value: projectOnly((r) => r.p.interventionYear) },
    { header: 'Funding source', width: 26, wrap: true, value: projectOnly((r) => r.p.fundingSource) },
    { header: 'Stage', width: 22, wrap: true, value: (r) => (r.site ? SITE_STATUS_LABELS[r.site.status] : stageText(r.p)) },
    { header: 'Schedule', width: 16, value: projectOnly((r) => scheduleText(r.p)) },
    { header: '% complete', width: 11, format: 'number', value: (r) => (r.site ? r.site.progressPct : r.p.certifiedProgressPct) },
    {
      header: 'Progress basis',
      width: 18,
      value: (r) => (r.site ? 'Site BoQ lines' : r.p.progressIsImported ? 'Reported at import' : 'Approved monitoring reports'),
    },
    {
      header: 'Last approved update',
      width: 14,
      format: 'date',
      value: projectOnly((r) => dateCell(r.p.lastApprovedUpdateAt ? zonedCalendarDate(new Date(r.p.lastApprovedUpdateAt), zone) : null)),
    },
    { header: 'Open findings', width: 10, format: 'integer', value: projectOnly((r) => r.p.openFindingsCount) },
  ];
  const projectRows = rows.filter(isProjectRow);
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
        hint: `${filterText}  |  ${projectCount} project${projectCount === 1 ? '' : 's'}  |  ${generatedLine(now, zone, webUser.fullName)}`,
        columns,
        rows,
        emptyText: 'No projects match these filters.',
        totals: projectCount
          ? {
              label: `${projectCount} project${projectCount === 1 ? '' : 's'}`,
              values: {
                [moneyIndex]: projectRows.reduce((s, r) => s + (r.contractSumNgn ?? 0), 0),
                ...(paidIndex >= 0 ? { [paidIndex]: projectRows.reduce((s, r) => s + r.p.disbursedToDateNgn, 0) } : {}),
              },
            }
          : undefined,
      },
    ],
  });
  return { buffer, fileName: registerFileName(tenant.name, zonedCalendarDate(now, zone), 'xlsx') };
}

const money = (n: number | null) => (n === null ? '' : `NGN ${Math.round(n).toLocaleString('en-NG')}`);

/** "UBEC project register"; "Project register" without a short name (the PDF's title band). */
export function registerTitle(tenantName: string | null | undefined): string {
  const short = workspaceShortName(tenantName);
  return short ? `${short} project register` : 'Project register';
}

export async function buildRegisterPdf(webUser: WebJwtPayload, filters: ProjectRegisterFilters): Promise<{ buffer: Buffer; fileName: string }> {
  const now = new Date();
  const { rows, projectCount, tenant, zone, term, canSeePaid } = await loadRegister(webUser, filters);
  const filterText = await describeFilters(webUser.tenantId, filters);
  const branding = parseTenantBranding(tenant.brandingConfig);
  const lastUpdate = (p: PortfolioOverviewProject) => (p.lastApprovedUpdateAt ? zonedCalendarDate(new Date(p.lastApprovedUpdateAt), zone) : '');
  // Site rows (wave 2): the site's own cells and the contractor; project-only cells stay empty.
  const projectOnly = (fn: (r: RegisterRow) => string) => (r: RegisterRow) => (r.site ? '' : fn(r));
  const columns: Array<RegisterPdfColumn & { value: (r: RegisterRow) => string }> = [
    {
      header: `Code\n${term}`,
      weight: 9,
      value: (r) => (r.site ? siteCode(r.site) : [codeText(r.p), r.p.externalReference].filter(Boolean).join('\n')),
    },
    {
      header: 'Project / school',
      weight: 17,
      value: (r) =>
        r.site
          ? siteSchool(r.site)
          : [r.p.name, siteCount(r.p) ? `${siteCount(r.p)} ${siteCount(r.p) === 1 ? 'site' : 'sites'}` : r.p.primaryBeneficiary?.name].filter(Boolean).join('\n'),
    },
    { header: 'Zone · State', weight: 8, value: projectOnly((r) => [zoneText(r.p), stateText(r.p)].filter(Boolean).join('\n')) },
    { header: 'LGA', weight: 8, value: (r) => (r.site ? (r.site.lgaName ?? r.site.lgaCode) : (r.p.lgaLocation ?? '')) },
    { header: 'Type / owner', weight: 10, value: projectOnly((r) => [r.p.projectType?.name, r.p.owningOrganization?.name].filter(Boolean).join('\n')) },
    { header: 'Contractor', weight: 10, value: (r) => r.p.contractorName ?? '' },
    { header: 'Contract sum', weight: 8, align: 'right', value: projectOnly((r) => money(r.contractSumNgn)) },
    ...(canSeePaid
      ? [{ header: 'Paid to date', weight: 8, align: 'right' as const, value: projectOnly((r: RegisterRow) => money(r.p.disbursedToDateNgn)) }]
      : []),
    {
      header: 'Year / funding',
      weight: 9,
      value: projectOnly((r) => [r.p.interventionYear ? String(r.p.interventionYear) : '', r.p.fundingSource].filter(Boolean).join('\n')),
    },
    {
      header: 'Stage / schedule',
      weight: 10,
      value: (r) => (r.site ? SITE_STATUS_LABELS[r.site.status] : [stageText(r.p), scheduleText(r.p)].filter(Boolean).join('\n')),
    },
    {
      header: '% complete',
      weight: 5,
      align: 'right',
      value: (r) =>
        r.site
          ? r.site.progressPct === null
            ? ''
            : `${r.site.progressPct.toFixed(1)}%`
          : `${r.p.certifiedProgressPct.toFixed(1)}%${r.p.progressIsImported ? '*' : ''}`,
    },
    { header: 'Last approved update', weight: 7, align: 'center', value: projectOnly((r) => lastUpdate(r.p)) },
    { header: 'Open findings', weight: 5, align: 'right', value: projectOnly((r) => String(r.p.openFindingsCount)) },
  ];
  const buffer = await generateRegisterPdf({
    branding: {
      tenantName: tenant.name,
      // The tenant's PDF header title names the monitoring report; the register carries its own title.
      headerTitle: registerTitle(tenant.name),
      footerDisclaimer: branding.pdfFooterDisclaimer || undefined,
      primaryColorHex: branding.primaryColorHex || undefined,
      timeZone: zone,
    },
    heading: 'Project register',
    subtitle: `${filterText} · ${projectCount} project${projectCount === 1 ? '' : 's'} · prepared for ${webUser.fullName}`,
    columns,
    rows: rows.map((r) => columns.map((c) => c.value(r))),
    footnote: rows.some((r) => !r.site && r.p.progressIsImported)
      ? '* % complete reported when the project was imported; replaced by verified progress once its scope is added.'
      : undefined,
  });
  return { buffer, fileName: registerFileName(tenant.name, zonedCalendarDate(now, zone), 'pdf') };
}
