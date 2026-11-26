import { Prisma, ContractorStatus } from '@prisma/client';
import {
  ChangeContractorStatusRequest,
  ContractorDetailDto,
  ContractorDuplicateCandidate,
  ContractorListQuery,
  ContractorPerformanceSettingsSchema,
  ContractorProjectDto,
  ContractorRatingComponent,
  ContractorRatingFacts,
  ContractorReliabilityDto,
  ContractorSummaryDto,
  CreateContractorRequest,
  UpdateContractorRequest,
  contractorReliability,
  formatProjectCode,
  normaliseRcNumber,
  zonedCalendarDate,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { hasWebPermission, WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

/**
 * Client demo updates F.1–F.3 (wave 2): the contractor register. Contractors are `Organization`
 * rows tagged CONTRACTOR (no login, decision P2) with register fields (status, TIN, address,
 * state). A contractor created here is INACTIVE until a signed contract (`CONTRACT` document) of one
 * of its projects is on file; SUSPENDED comes from a decision and stops it being named on a new
 * project (`assertContractorSelectable`). The rating is stored per contractor as a snapshot
 * (`refreshContractorRatingSnapshots`: nightly job `contractor-ratings`, "Refresh ratings", seed),
 * computed by the pure `contractorReliability` over facts loaded in batches for the whole tenant.
 */

/** A zone the runtime accepts, else Africa/Lagos (as `safeZone` in the KPI module; not imported, to keep
 * the documents → contractors import free of the projects module). */
function safeZone(zone: string | null | undefined): string {
  if (!zone) return 'Africa/Lagos';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return zone;
  } catch {
    return 'Africa/Lagos';
  }
}

export const WORKMANSHIP_ANSWER_PATH = 's:WORKMANSHIP/workmanship';

function actorName(webUser: WebJwtPayload) {
  return `${webUser.fullName} (${webUser.roleName})`;
}

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

const IGNORED_NAME_WORDS = new Set(['ltd', 'limited', 'nig', 'nigeria', 'plc']);

/** Case, punctuation and "Ltd / Limited / Nig" ignored: "Abc Builders (Nig.) Ltd" → "abc builders". */
export function normaliseContractorName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !IGNORED_NAME_WORDS.has(w))
    .join(' ');
}

/** Same normalised name, or one contains the other when the shorter has at least 6 characters. */
export function contractorNamesSimilar(a: string, b: string): boolean {
  const x = normaliseContractorName(a);
  const y = normaliseContractorName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 6 && long.includes(short);
}

/** EXACT_RC (any organisation of the tenant) first, then SIMILAR_NAME among contractors. */
export async function findContractorDuplicates(
  db: Db,
  tenantId: string,
  input: { name?: string | null; registrationNumber?: string | null },
  excludeId?: string
): Promise<ContractorDuplicateCandidate[]> {
  const rc = normaliseRcNumber(input.registrationNumber ?? null);
  const name = (input.name ?? '').trim();
  if (!rc && name.length < 3) return [];
  const rows = await db.organization.findMany({
    where: {
      tenantId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [{ categories: { has: 'CONTRACTOR' } }, ...(rc ? [{ registrationNumber: { not: null } }] : [])],
    },
    select: { id: true, name: true, registrationNumber: true, contractorStatus: true, categories: true },
    orderBy: { name: 'asc' },
  });
  const out: ContractorDuplicateCandidate[] = [];
  for (const r of rows) {
    if (rc && r.registrationNumber && normaliseRcNumber(r.registrationNumber) === rc) {
      out.push({ id: r.id, name: r.name, registrationNumber: r.registrationNumber, status: r.contractorStatus, match: 'EXACT_RC' });
    }
  }
  if (name.length >= 3) {
    for (const r of rows) {
      if (!r.categories.includes('CONTRACTOR') || out.some((c) => c.id === r.id)) continue;
      if (contractorNamesSimilar(name, r.name)) {
        out.push({ id: r.id, name: r.name, registrationNumber: r.registrationNumber, status: r.contractorStatus, match: 'SIMILAR_NAME' });
      }
    }
  }
  return out.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Register reads
// ---------------------------------------------------------------------------

const CONTRACTOR_ORG_SELECT = {
  id: true,
  name: true,
  registrationNumber: true,
  contractorStatus: true,
  stateCode: true,
  tin: true,
  address: true,
  contactEmail: true,
  contactPhone: true,
  ratingSnapshots: true,
  _count: { select: { contractorFlags: { where: { status: 'OPEN' } } } }, // F.4 (wave 3)
} satisfies Prisma.OrganizationSelect;
type ContractorOrgRow = Prisma.OrganizationGetPayload<{ select: typeof CONTRACTOR_ORG_SELECT }>;
type SnapshotRow = ContractorOrgRow['ratingSnapshots'][number];

const ENGAGEMENT_SELECT = {
  id: true,
  organizationId: true,
  projectId: true,
  contractStatus: true,
  terminatedAt: true,
  createdAt: true,
  project: {
    select: {
      id: true,
      codePrefix: true,
      name: true,
      interventionYear: true,
      stateCode: true,
      status: true,
      constructionPhase: true,
      contractSumNgn: true,
      certifiedProgressPct: true,
      timezone: true,
    },
  },
} satisfies Prisma.ProjectContractorSelect;
type EngagementRow = Prisma.ProjectContractorGetPayload<{ select: typeof ENGAGEMENT_SELECT }>;

function standingOf(e: EngagementRow): ContractorProjectDto['standing'] {
  if (e.contractStatus === 'TERMINATED') return 'TERMINATED';
  if (e.project.status === 'DRAFT') return 'DRAFT';
  if (e.project.status === 'ARCHIVED' || e.project.constructionPhase === 'COMPLETED_CLOSED') return 'COMPLETED';
  return 'CURRENT';
}

export function ratingFromSnapshot(s: SnapshotRow | null | undefined): ContractorReliabilityDto {
  if (!s) {
    return { rated: false, score: null, stars: null, reportCount: 0, projectCount: 0, components: [], summary: 'Not yet rated: 0 reports', computedAt: null };
  }
  return {
    rated: s.rated,
    score: s.score === null ? null : Number(s.score),
    stars: s.stars === null ? null : Number(s.stars),
    reportCount: s.reportCount,
    projectCount: s.projectCount,
    components: (Array.isArray(s.componentsJson) ? s.componentsJson : []) as unknown as ContractorRatingComponent[],
    summary: s.summary,
    computedAt: s.computedAt.toISOString(),
  };
}

function summaryOf(org: ContractorOrgRow, engagements: EngagementRow[]): ContractorSummaryDto {
  const standings = engagements.map(standingOf);
  const states = new Set<string>();
  for (const e of engagements) if (e.project.status !== 'DRAFT' && e.project.stateCode) states.add(e.project.stateCode);
  return {
    id: org.id,
    name: org.name,
    registrationNumber: org.registrationNumber,
    status: org.contractorStatus,
    stateCode: org.stateCode,
    rating: ratingFromSnapshot(org.ratingSnapshots[0]),
    activeProjectCount: standings.filter((s) => s === 'CURRENT').length,
    completedProjectCount: standings.filter((s) => s === 'COMPLETED').length,
    statesWorkedIn: [...states].sort(),
    openFlagCount: org._count.contractorFlags,
  };
}

async function engagementsByOrg(db: Db, tenantId: string, organizationIds?: string[]) {
  const rows = await db.projectContractor.findMany({
    where: { project: { tenantId }, ...(organizationIds ? { organizationId: { in: organizationIds } } : {}) },
    select: ENGAGEMENT_SELECT,
    orderBy: { createdAt: 'asc' },
  });
  const map = new Map<string, EngagementRow[]>();
  for (const r of rows) map.set(r.organizationId, [...(map.get(r.organizationId) ?? []), r]);
  return map;
}

/** GET /api/v1/contractors: the tenant's contractors (tagged CONTRACTOR, not archived) with rating and project counts. */
export async function listContractors(tenantId: string, query: ContractorListQuery): Promise<ContractorSummaryDto[]> {
  const q = query.q?.trim();
  const orgs = await prisma.organization.findMany({
    where: {
      tenantId,
      isArchived: false,
      categories: { has: 'CONTRACTOR' },
      ...(query.status ? { contractorStatus: query.status } : {}),
      // F.4 (wave 3): with / without an open flag.
      ...(query.flagged ? { contractorFlags: query.flagged === 'true' ? { some: { status: 'OPEN' } } : { none: { status: 'OPEN' } } } : {}),
      ...(q
        ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { registrationNumber: { contains: q, mode: 'insensitive' } }] }
        : {}),
    },
    select: CONTRACTOR_ORG_SELECT,
    orderBy: { name: 'asc' },
  });
  const engagements = await engagementsByOrg(
    prisma,
    tenantId,
    orgs.map((o) => o.id)
  );
  const rows = orgs.map((o) => summaryOf(o, engagements.get(o.id) ?? []));
  return query.stateCode ? rows.filter((r) => r.stateCode === query.stateCode || r.statesWorkedIn.includes(query.stateCode!)) : rows;
}

async function loadContractorOrg(db: Db, tenantId: string, id: string): Promise<ContractorOrgRow> {
  const org = await db.organization.findFirst({ where: { id, tenantId, categories: { has: 'CONTRACTOR' } }, select: CONTRACTOR_ORG_SELECT });
  if (!org) throw new AppError('Contractor not found', 404, 'CONTRACTOR_NOT_FOUND');
  return org;
}

/** GET /api/v1/contractors/:id */
export async function getContractorDetail(webUser: WebJwtPayload, id: string): Promise<ContractorDetailDto> {
  const org = await loadContractorOrg(prisma, webUser.tenantId, id);
  const engagements = (await engagementsByOrg(prisma, webUser.tenantId, [id])).get(id) ?? [];
  const reports = await loadWorkmanshipReports(prisma, webUser.tenantId, [...new Set(engagements.map((e) => e.projectId))]);
  const perProject = new Map<string, number[]>();
  const engagementsByProject = groupEngagements(engagements);
  for (const r of reports) {
    const e = engagementForReport(engagementsByProject.get(r.projectId) ?? [], r.confirmedAt);
    if (!e || e.organizationId !== id) continue;
    perProject.set(r.projectId, [...(perProject.get(r.projectId) ?? []), r.workmanship]);
  }
  const order: Record<ContractorProjectDto['standing'], number> = { CURRENT: 0, DRAFT: 1, COMPLETED: 2, TERMINATED: 3 };
  const projects: ContractorProjectDto[] = engagements
    .map((e) => {
      const w = perProject.get(e.projectId) ?? [];
      return {
        projectId: e.project.id,
        codePrefix: e.project.codePrefix,
        name: e.project.name,
        interventionYear: e.project.interventionYear,
        stateCode: e.project.stateCode,
        standing: standingOf(e),
        contractSumNgn: e.project.contractSumNgn === null ? null : Number(e.project.contractSumNgn),
        progressPct: Number(e.project.certifiedProgressPct),
        reportCount: w.length,
        averageWorkmanship: w.length ? Math.round((w.reduce((s, v) => s + v, 0) / w.length) * 10) / 10 : null,
      };
    })
    .sort((a, b) => order[a.standing] - order[b.standing] || (b.interventionYear ?? 0) - (a.interventionYear ?? 0) || a.codePrefix.localeCompare(b.codePrefix));
  return {
    ...summaryOf(org, engagements),
    tin: org.tin,
    address: org.address,
    contactEmail: org.contactEmail,
    contactPhone: org.contactPhone,
    projects,
    canManage: hasWebPermission(webUser, 'contractors:manage'),
  };
}

// ---------------------------------------------------------------------------
// Register writes
// ---------------------------------------------------------------------------

function duplicateError(candidates: ContractorDuplicateCandidate[], exact: boolean) {
  return new AppError(
    exact
      ? `A contractor with this registration number is already on the register: ${candidates[0].name}.`
      : 'Contractors with a similar name are already on the register. Pick one of them, or confirm that this is a different company.',
    409,
    'CONTRACTOR_DUPLICATE',
    { candidates }
  );
}

/** POST /api/v1/contractors: creates the organisation tagged CONTRACTOR, INACTIVE until a signed contract is on file. */
export async function createContractor(webUser: WebJwtPayload, input: CreateContractorRequest): Promise<ContractorDetailDto> {
  const rc = normaliseRcNumber(input.registrationNumber ?? null);
  const id = await prisma.$transaction(async (tx) => {
    // One writer per tenant, so two people cannot add the same RC number at once.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('contractor-register'), hashtext(${webUser.tenantId}))`;
    const candidates = await findContractorDuplicates(tx, webUser.tenantId, { name: input.name, registrationNumber: rc });
    const exact = candidates.filter((c) => c.match === 'EXACT_RC');
    if (exact.length) throw duplicateError(exact, true);
    if (candidates.length && !input.confirmNotDuplicate) throw duplicateError(candidates, false);
    const org = await tx.organization.create({
      data: {
        tenantId: webUser.tenantId,
        name: input.name.trim(),
        categories: ['CONTRACTOR'],
        registrationNumber: rc,
        tin: input.tin ?? null,
        address: input.address ?? null,
        stateCode: input.stateCode ?? null,
        contactEmail: input.contactEmail ?? null,
        contactPhone: input.contactPhone ?? null,
        contractorStatus: 'INACTIVE',
      },
    });
    await recordAuditEvent(tx, {
      tenantId: webUser.tenantId,
      projectId: null,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'CONTRACTOR_CREATED',
      summaryText: `Added contractor ${org.name}${rc ? ` (${rc})` : ''} to the register, inactive until a signed contract is on file.`,
      payload: {
        organizationId: org.id,
        name: org.name,
        registrationNumber: rc,
        status: 'INACTIVE',
        similarNamesConfirmed: candidates.map((c) => c.id),
      },
    });
    return org.id;
  });
  return getContractorDetail(webUser, id);
}

/** PUT /api/v1/contractors/:id (profile; omitted keeps, null clears). */
export async function updateContractor(webUser: WebJwtPayload, id: string, input: UpdateContractorRequest): Promise<ContractorDetailDto> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('contractor-register'), hashtext(${webUser.tenantId}))`;
    const before = await loadContractorOrg(tx, webUser.tenantId, id);
    const data: Prisma.OrganizationUpdateInput = {};
    const changed: string[] = [];
    const set = <K extends keyof UpdateContractorRequest>(key: K, value: string | null | undefined, current: string | null) => {
      if (value === undefined || value === current) return;
      (data as Record<string, unknown>)[key] = value;
      changed.push(key);
    };
    if (input.registrationNumber !== undefined) {
      const rc = normaliseRcNumber(input.registrationNumber);
      if (rc && rc !== normaliseRcNumber(before.registrationNumber)) {
        const exact = (await findContractorDuplicates(tx, webUser.tenantId, { registrationNumber: rc }, id)).filter((c) => c.match === 'EXACT_RC');
        if (exact.length) throw duplicateError(exact, true);
      }
      set('registrationNumber', rc, before.registrationNumber);
    }
    if (input.name !== undefined) set('name', input.name.trim(), before.name);
    set('tin', input.tin, before.tin);
    set('address', input.address, before.address);
    set('stateCode', input.stateCode, before.stateCode);
    set('contactEmail', input.contactEmail, before.contactEmail);
    set('contactPhone', input.contactPhone, before.contactPhone);
    if (changed.length === 0) return;
    await tx.organization.update({ where: { id }, data });
    await recordAuditEvent(tx, {
      tenantId: webUser.tenantId,
      projectId: null,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'CONTRACTOR_UPDATED',
      summaryText: `Updated contractor ${input.name?.trim() || before.name}: ${changed.join(', ')}.`,
      payload: { organizationId: id, changed, values: Object.fromEntries(changed.map((k) => [k, (data as Record<string, unknown>)[k] ?? null])) },
    });
  });
  return getContractorDetail(webUser, id);
}

async function writeStatusChange(
  tx: Tx,
  p: {
    tenantId: string;
    projectId: string | null;
    organizationId: string;
    name: string;
    from: ContractorStatus;
    to: ContractorStatus;
    reason: string;
    actor: { userId: string; displayName: string };
  }
) {
  await tx.organization.update({ where: { id: p.organizationId }, data: { contractorStatus: p.to } });
  await recordAuditEvent(tx, {
    tenantId: p.tenantId,
    projectId: p.projectId,
    actorType: 'WEB_USER',
    actorId: p.actor.userId,
    actorDisplayName: p.actor.displayName,
    action: 'CONTRACTOR_STATUS_CHANGED',
    summaryText: `Contractor ${p.name}: ${p.from.toLowerCase()} → ${p.to.toLowerCase()}. ${p.reason}`,
    payload: { organizationId: p.organizationId, from: p.from, to: p.to, reason: p.reason },
  });
}

/** POST /api/v1/contractors/:id/status (reason required; tenant ledger). */
export async function changeContractorStatus(
  webUser: WebJwtPayload,
  id: string,
  input: ChangeContractorStatusRequest
): Promise<ContractorDetailDto> {
  await prisma.$transaction(async (tx) => {
    const org = await loadContractorOrg(tx, webUser.tenantId, id);
    if (org.contractorStatus === input.status) {
      throw new AppError(`${org.name} is already ${input.status.toLowerCase()}`, 409, 'CONTRACTOR_STATUS_UNCHANGED');
    }
    await writeStatusChange(tx, {
      tenantId: webUser.tenantId,
      projectId: null,
      organizationId: id,
      name: org.name,
      from: org.contractorStatus,
      to: input.status,
      reason: input.reason.trim(),
      actor: { userId: webUser.userId, displayName: actorName(webUser) },
    });
  });
  return getContractorDetail(webUser, id);
}

/**
 * Called when a signed contract (document type CONTRACT) of a project is uploaded or signed off:
 * the project's contractor organisation goes INACTIVE → ACTIVE (audit CONTRACTOR_STATUS_CHANGED on
 * the project ledger). No-op when there is no contractor or it is already ACTIVE or SUSPENDED.
 */
export async function activateContractorOnSignedContract(
  tx: Tx,
  projectId: string,
  actor: { userId: string; displayName: string }
): Promise<void> {
  const rows = await tx.projectContractor.findMany({
    where: { projectId, contractStatus: 'ACTIVE', organization: { contractorStatus: 'INACTIVE' } },
    select: { organization: { select: { id: true, name: true, tenantId: true } }, project: { select: { codePrefix: true } } },
  });
  for (const r of rows) {
    await writeStatusChange(tx, {
      tenantId: r.organization.tenantId,
      projectId,
      organizationId: r.organization.id,
      name: r.organization.name,
      from: 'INACTIVE',
      to: 'ACTIVE',
      reason: `Signed contract on file for ${formatProjectCode(r.project.codePrefix)}`,
      actor,
    });
  }
}

/**
 * A SUSPENDED contractor cannot be newly named on a project (F.1). For the project contractor save
 * (`syncProjectContractors`): call with the organisation being added or switched to.
 */
export async function assertContractorSelectable(db: Db, organizationId: string): Promise<void> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true, contractorStatus: true } });
  if (org?.contractorStatus === 'SUSPENDED') {
    throw new AppError(`${org.name} is suspended and cannot be named on a new project.`, 409, 'CONTRACTOR_SUSPENDED');
  }
}

// ---------------------------------------------------------------------------
// Rating snapshots (F.3)
// ---------------------------------------------------------------------------

export interface WorkmanshipReport {
  /** F.4 (wave 3): the flag rule's evidence names the report and its visit. */
  visitSubmissionId: string;
  visitId: string;
  projectId: string;
  confirmedAt: Date;
  workmanship: number;
}

/** Accepted monitoring reports with a 1–5 workmanship answer, read from the stored answers in one query. */
export async function loadWorkmanshipReports(db: Db, tenantId: string, projectIds?: string[]): Promise<WorkmanshipReport[]> {
  if (projectIds && projectIds.length === 0) return [];
  const projectFilter = projectIds ? Prisma.sql`AND s."projectId" IN (${Prisma.join(projectIds.map((id) => Prisma.sql`${id}::uuid`))})` : Prisma.empty;
  const rows = await db.$queryRaw<Array<{ id: string; visitId: string; projectId: string; confirmedAt: Date; value: string | null }>>`
    SELECT s."id" AS "id", s."visitId" AS "visitId", s."projectId" AS "projectId", s."confirmedAt" AS "confirmedAt",
      (SELECT a->>'value' FROM jsonb_array_elements(
         CASE WHEN jsonb_typeof(s."answersJson") = 'array' THEN s."answersJson" ELSE '[]'::jsonb END
       ) a WHERE a->>'path' = ${WORKMANSHIP_ANSWER_PATH} LIMIT 1) AS "value"
    FROM "visit_submissions" s
    JOIN "Project" p ON p."id" = s."projectId"
    WHERE p."tenantId" = ${tenantId}::uuid AND s."status" = 'APPROVED' ${projectFilter}`;
  const out: WorkmanshipReport[] = [];
  for (const r of rows) {
    const v = r.value === null ? NaN : Number(r.value);
    if (Number.isFinite(v) && v >= 1 && v <= 5) out.push({ visitSubmissionId: r.id, visitId: r.visitId, projectId: r.projectId, confirmedAt: r.confirmedAt, workmanship: v });
  }
  return out;
}

export function groupEngagements<T extends { projectId: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) map.set(r.projectId, [...(map.get(r.projectId) ?? []), r]);
  return map;
}

/** The engagement a dated fact belongs to: the first (oldest) one not terminated before it, else the last. */
export function engagementForReport<T extends { terminatedAt: Date | null }>(rows: T[], at: Date): T | null {
  if (rows.length === 0) return null;
  return rows.find((r) => !r.terminatedAt || r.terminatedAt >= at) ?? rows[rows.length - 1];
}

function emptyFacts(): ContractorRatingFacts {
  return {
    reports: [],
    workPhases: { verifiedMetOnTime: 0, verified: 0 },
    mobilisation: { onTime: 0, total: 0 },
    findings: { majorOrCritical: 0, rectifiedAverageDays: null },
    closureRatings: [],
  };
}

const DAY_MS = 86_400_000;

/**
 * Recomputes every contractor's rating snapshot for a tenant (nightly job, "Refresh ratings" on the
 * register, and the demo seed). Facts are loaded in one query per source for the whole tenant.
 * Returns the number of snapshots written.
 */
export async function refreshContractorRatingSnapshots(tenantId: string, now: Date = new Date()): Promise<number> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true, contractorPerformanceJson: true } });
  if (!tenant) return 0;
  const parsed = ContractorPerformanceSettingsSchema.safeParse(tenant.contractorPerformanceJson ?? {});
  const settings = parsed.success ? parsed.data : ContractorPerformanceSettingsSchema.parse({});
  const today = zonedCalendarDate(now, safeZone(tenant.timezone));
  const windowStart = new Date(now.getTime() - settings.windowMonths * 30.44 * DAY_MS);

  const [orgs, engagements, reports, sprints, milestones, findings, closure] = await Promise.all([
    prisma.organization.findMany({ where: { tenantId, categories: { has: 'CONTRACTOR' } }, select: { id: true } }),
    prisma.projectContractor.findMany({
      where: { project: { tenantId } },
      select: { id: true, projectId: true, organizationId: true, terminatedAt: true, project: { select: { timezone: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    loadWorkmanshipReports(prisma, tenantId),
    prisma.projectSprint.findMany({
      where: { project: { tenantId }, verificationOutcome: { not: null } },
      select: { projectId: true, endDate: true, verificationOutcome: true },
    }),
    prisma.projectContractMilestone.findMany({
      where: { project: { tenantId, status: { not: 'DRAFT' } }, completionMode: 'AUTO_CONTRACTOR_ON_SITE', status: { not: 'WAIVED' } },
      select: { projectId: true, projectContractorId: true, dueDate: true, status: true, completedAt: true },
    }),
    prisma.finding.findMany({
      where: { project: { tenantId }, severity: { in: ['MAJOR', 'CRITICAL'] }, status: { not: 'DISMISSED' }, createdAt: { gte: windowStart } },
      select: { projectId: true, projectContractorId: true, createdAt: true, resolvedAt: true, status: true },
    }),
    prisma.contractorPerformanceRating.findMany({
      where: { project: { tenantId } },
      select: { projectContractorId: true, overallScore: true },
    }),
  ]);

  const byProject = groupEngagements(engagements);
  const engagementById = new Map(engagements.map((e) => [e.id, e]));
  const facts = new Map<string, ContractorRatingFacts>(orgs.map((o) => [o.id, emptyFacts()]));
  const factsFor = (organizationId: string | undefined) => (organizationId ? facts.get(organizationId) : undefined);
  const orgFor = (projectId: string, projectContractorId: string | null, at: Date) =>
    projectContractorId ? engagementById.get(projectContractorId)?.organizationId : engagementForReport(byProject.get(projectId) ?? [], at)?.organizationId;

  for (const r of reports) {
    const e = engagementForReport(byProject.get(r.projectId) ?? [], r.confirmedAt);
    const f = factsFor(e?.organizationId);
    if (!e || !f) continue;
    f.reports.push({ date: zonedCalendarDate(r.confirmedAt, safeZone(e.project.timezone)), workmanship: r.workmanship, projectId: r.projectId });
  }
  for (const s of sprints) {
    const f = factsFor(orgFor(s.projectId, null, new Date(`${s.endDate}T12:00:00Z`)));
    if (!f) continue;
    f.workPhases.verified += 1;
    if (s.verificationOutcome === 'MET') f.workPhases.verifiedMetOnTime += 1;
  }
  for (const m of milestones) {
    const e = m.projectContractorId ? engagementById.get(m.projectContractorId) : (byProject.get(m.projectId) ?? [])[0];
    const f = factsFor(e?.organizationId);
    if (!e || !f || !m.dueDate) continue;
    const zone = safeZone(e.project.timezone);
    if (m.status === 'DONE' && m.completedAt) {
      f.mobilisation.total += 1;
      if (zonedCalendarDate(m.completedAt, zone) <= m.dueDate) f.mobilisation.onTime += 1;
    } else if (m.dueDate < today) {
      f.mobilisation.total += 1; // Not done and past due: late.
    }
  }
  const rectifiedDays = new Map<string, number[]>();
  for (const x of findings) {
    const orgId = orgFor(x.projectId, x.projectContractorId, x.createdAt);
    const f = factsFor(orgId);
    if (!f || !orgId) continue;
    f.findings.majorOrCritical += 1;
    if (x.status === 'RESOLVED' && x.resolvedAt) {
      rectifiedDays.set(orgId, [...(rectifiedDays.get(orgId) ?? []), (x.resolvedAt.getTime() - x.createdAt.getTime()) / DAY_MS]);
    }
  }
  for (const [orgId, days] of rectifiedDays) {
    const f = facts.get(orgId)!;
    f.findings.rectifiedAverageDays = days.reduce((s, v) => s + v, 0) / days.length;
  }
  const closureByEngagement = new Map<string, number[]>();
  for (const c of closure) closureByEngagement.set(c.projectContractorId, [...(closureByEngagement.get(c.projectContractorId) ?? []), Number(c.overallScore)]);
  for (const [engagementId, scores] of closureByEngagement) {
    const f = factsFor(engagementById.get(engagementId)?.organizationId);
    if (f) f.closureRatings.push(scores.reduce((s, v) => s + v, 0) / scores.length);
  }

  let written = 0;
  for (const [organizationId, f] of facts) {
    const r = contractorReliability(f, today, settings);
    const data = {
      rated: r.rated,
      score: r.score,
      stars: r.stars,
      reportCount: r.reportCount,
      projectCount: r.projectCount,
      componentsJson: r.components as unknown as Prisma.InputJsonValue,
      summary: r.summary,
      computedAt: now,
    };
    await prisma.contractorRatingSnapshot.upsert({
      where: { organizationId },
      create: { tenantId, organizationId, ...data },
      update: data,
    });
    written += 1;
  }
  return written;
}
