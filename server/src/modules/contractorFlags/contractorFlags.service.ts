import { Prisma, VisitKind } from '@prisma/client';
import {
  CONTRACTOR_FLAG_ACTION_META,
  ContractorFlagActionDto,
  ContractorFlagActionKind,
  ContractorFlagActionStatus,
  ContractorFlagDto,
  ContractorFlagEvidence,
  ContractorFlagEvidenceSchema,
  ContractorFlagListQuery,
  ContractorFlagStatus,
  ContractorPerformanceSettingsSchema,
  DecideContractorFlagActionRequest,
  FlagRule,
  FlagRuleReport,
  LiftContractorFlagActionRequest,
  ProjectPaymentHoldDto,
  addDays,
  contractorFlagDue,
  contractorFlagSummary,
  formatCalendarDate,
  formatProjectCode,
  formatProjectCodeWithYear,
  isoWeekday,
  sprintForDate,
  submissionDeadlineFor,
  zonedCalendarDate,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { hasWebPermission, WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { createWebNotification } from '../notifications/notifications.service';
import { buildProjectVisibilityWhere } from '../../utils/accessControl';
import {
  engagementForReport,
  groupEngagements,
  loadWorkmanshipReports,
  refreshContractorRatingSnapshots,
} from '../contractors/contractors.service';
import {
  defaultOfficersFor,
  isUniqueViolation,
  loadVisitProject,
  monitoringConfigOf,
  OfficerInput,
  projectToday,
  resolveOfficers,
  setVisitAssignees,
  visitLabel,
  visitLabelInSentence,
} from '../visits/visitCore';

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

/**
 * Client demo updates F.4 (wave 3): contractor flags and decided actions.
 *
 * The rule (`contractorFlagDue` over the tenant's `ContractorPerformanceSettingsSchema.flagRule`) runs
 * per engagement (project contractor, not terminated) of ACTIVE projects: daily in the job
 * `contractor-flags` and after a monitoring report is accepted (`evaluateFlagsAfterAcceptance`).
 * Reports are the accepted ones with a workmanship answer (`loadWorkmanshipReports`, the rating's
 * fact loader), dated on the visit's date (the day the site was observed; the confirmation date in the
 * project zone when a visit has none) and attributed to an engagement as the rating does. One OPEN flag per contractor and project (partial unique index
 * `contractor_flags_one_open_per_project`; a lost race merges into the winner); later low reports
 * join it as evidence without a new notification. Reports that were evidence on a closed flag do
 * not count again, so "No further action" is not undone by the next run.
 *
 * Actions (`contractors:manage`, with a reason): see the header of `contractorFlag.schema.ts`.
 * ADDITIONAL_VISITS writes PROPOSED visits in the same transaction (the planner publishes them);
 * PAYMENT_HOLD is IN_EFFECT until lifted, one per engagement (`activePaymentHold`).
 */

const SYSTEM_ACTOR = { actorType: 'SYSTEM' as const, actorId: 'contractor-flags', actorDisplayName: 'System (contractor flags)' };

/** Visit kinds an "additional visits" decision may propose (no facilities to pick, or all in scope for Ad hoc). */
const ADDITIONAL_VISIT_KINDS: VisitKind[] = ['ROUTINE', 'QUARTERLY_ME', 'AD_HOC'];

function safeZone(zone: string | null | undefined): string {
  if (!zone) return 'Africa/Lagos';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return zone;
  } catch {
    return 'Africa/Lagos';
  }
}

function actorName(u: WebJwtPayload) {
  return `${u.fullName} (${u.roleName})`;
}

function webActor(u: WebJwtPayload) {
  return { actorType: 'WEB_USER' as const, actorId: u.userId, actorDisplayName: actorName(u) };
}

function flagRuleOf(json: unknown): FlagRule {
  const parsed = ContractorPerformanceSettingsSchema.safeParse(json ?? {});
  return (parsed.success ? parsed.data : ContractorPerformanceSettingsSchema.parse({})).flagRule;
}

function evidenceOf(json: unknown): ContractorFlagEvidence[] {
  return (Array.isArray(json) ? json : []).map((e) => ContractorFlagEvidenceSchema.safeParse(e)).filter((r) => r.success).map((r) => r.data!);
}

function ruleOf(json: unknown): ContractorFlagDto['rule'] {
  const r = (json ?? {}) as Partial<ContractorFlagDto['rule']>;
  return { reportCount: Number(r.reportCount ?? 0), workmanshipAtOrBelow: Number(r.workmanshipAtOrBelow ?? 0), withinDays: Number(r.withinDays ?? 0) };
}

function sortEvidence(list: ContractorFlagEvidence[]): ContractorFlagEvidence[] {
  return [...list].sort((a, b) => b.date.localeCompare(a.date) || a.visitSubmissionId.localeCompare(b.visitSubmissionId));
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

const FLAG_INCLUDE = {
  organization: { select: { name: true } },
  project: { select: { codePrefix: true, name: true, interventionYear: true } },
  actions: { orderBy: { decidedAt: 'asc' } },
} satisfies Prisma.ContractorFlagInclude;
type FlagRow = Prisma.ContractorFlagGetPayload<{ include: typeof FLAG_INCLUDE }>;
type ActionRow = FlagRow['actions'][number];

function serializeAction(a: ActionRow): ContractorFlagActionDto {
  return {
    id: a.id,
    kind: a.kind as ContractorFlagActionKind,
    status: a.status as ContractorFlagActionStatus,
    reason: a.reason,
    params: (a.paramsJson && typeof a.paramsJson === 'object' && !Array.isArray(a.paramsJson) ? a.paramsJson : {}) as Record<string, unknown>,
    decidedByName: a.decidedByName,
    decidedAt: a.decidedAt.toISOString(),
    liftedAt: a.liftedAt?.toISOString() ?? null,
    liftedByName: a.liftedByName,
    liftReason: a.liftReason,
    visitIds: a.visitIds,
  };
}

function serializeFlag(f: FlagRow, viewer: WebJwtPayload | null): ContractorFlagDto {
  const rule = ruleOf(f.ruleJson);
  const evidence = sortEvidence(evidenceOf(f.evidenceJson));
  return {
    id: f.id,
    organizationId: f.organizationId,
    contractorName: f.organization.name,
    projectId: f.projectId,
    projectCode: formatProjectCode(f.project.codePrefix),
    projectName: f.project.name,
    interventionYear: f.project.interventionYear,
    status: f.status as ContractorFlagStatus,
    raisedAt: f.raisedAt.toISOString(),
    rule,
    summary: contractorFlagSummary(rule, evidence.length),
    evidence,
    actions: f.actions.map(serializeAction),
    closedAt: f.closedAt?.toISOString() ?? null,
    closedByName: f.closedByName,
    closeReason: f.closeReason,
    // Deciding needs contractors:manage; on a CLOSED flag only an in-effect payment hold can still be lifted.
    canDecide: hasWebPermission(viewer ?? undefined, 'contractors:manage'),
  };
}

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

/**
 * Runs the flag rule for a tenant's engagements on ACTIVE projects (all of them, or `projectIds`).
 * Returns the number of flags raised.
 */
async function evaluateEngagements(tenantId: string, now: Date, projectIds?: string[]): Promise<number> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true, contractorPerformanceJson: true } });
  if (!tenant) return 0;
  const rule = flagRuleOf(tenant.contractorPerformanceJson);
  if (!rule.enabled) return 0;
  const today = zonedCalendarDate(now, safeZone(tenant.timezone));

  const engagements = await prisma.projectContractor.findMany({
    where: { project: { tenantId, status: 'ACTIVE', ...(projectIds ? { id: { in: projectIds } } : {}) } },
    select: {
      id: true,
      projectId: true,
      organizationId: true,
      contractStatus: true,
      terminatedAt: true,
      organization: { select: { name: true } },
      project: { select: { codePrefix: true, timezone: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (engagements.length === 0) return 0;
  const liveProjectIds = [...new Set(engagements.map((e) => e.projectId))];
  const [reports, flags] = await Promise.all([
    loadWorkmanshipReports(prisma, tenantId, liveProjectIds),
    prisma.contractorFlag.findMany({
      where: { tenantId, projectId: { in: liveProjectIds } },
      select: { id: true, organizationId: true, projectId: true, status: true, evidenceJson: true },
    }),
  ]);
  const visits = await prisma.visit.findMany({
    where: { id: { in: [...new Set(reports.map((r) => r.visitId))] } },
    select: { id: true, visitKind: true, plannedDate: true },
  });
  const visitById = new Map(visits.map((v) => [v.id, v]));
  const byProject = groupEngagements(engagements);

  // Reports per engagement (as the rating attributes them).
  const perEngagement = new Map<string, FlagRuleReport[]>();
  for (const r of reports) {
    const e = engagementForReport(byProject.get(r.projectId) ?? [], r.confirmedAt);
    if (!e) continue;
    const v = visitById.get(r.visitId);
    // The date the site was observed (the visit's date), else the officer's confirmation in the project zone.
    const date = v?.plannedDate || zonedCalendarDate(r.confirmedAt, safeZone(e.project.timezone));
    perEngagement.set(e.id, [
      ...(perEngagement.get(e.id) ?? []),
      {
        visitSubmissionId: r.visitSubmissionId,
        visitId: r.visitId,
        date,
        workmanship: r.workmanship,
        label: `${v ? visitLabel(v.visitKind) : 'Monitoring visit'} of ${formatCalendarDate(date)}`,
      },
    ]);
  }

  let raised = 0;
  for (const e of engagements) {
    if (e.contractStatus === 'TERMINATED') continue;
    const mine = flags.filter((f) => f.organizationId === e.organizationId && f.projectId === e.projectId);
    const closedEvidence = new Set(mine.filter((f) => f.status !== 'OPEN').flatMap((f) => evidenceOf(f.evidenceJson).map((x) => x.visitSubmissionId)));
    const candidates = (perEngagement.get(e.id) ?? []).filter((r) => !closedEvidence.has(r.visitSubmissionId));
    const { due, evidence } = contractorFlagDue(candidates, rule, today);
    const open = mine.find((f) => f.status === 'OPEN');
    if (open) {
      await mergeEvidence(open.id, evidence);
      continue;
    }
    if (!due) continue;
    if (await raiseFlag({ tenantId, engagement: e, rule, evidence, now })) raised += 1;
  }
  return raised;
}

/** Adds new low reports to an open flag (no notification). */
async function mergeEvidence(flagId: string, evidence: ContractorFlagEvidence[]): Promise<void> {
  if (evidence.length === 0) return;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "contractor_flags" WHERE id = ${flagId}::uuid FOR UPDATE`;
    const flag = await tx.contractorFlag.findUnique({ where: { id: flagId }, select: { status: true, evidenceJson: true } });
    if (!flag || flag.status !== 'OPEN') return;
    const current = evidenceOf(flag.evidenceJson);
    const known = new Set(current.map((x) => x.visitSubmissionId));
    const added = evidence.filter((x) => !known.has(x.visitSubmissionId));
    if (added.length === 0) return;
    await tx.contractorFlag.update({
      where: { id: flagId },
      data: { evidenceJson: sortEvidence([...current, ...added]) as unknown as Prisma.InputJsonValue },
    });
  });
}

/** Creates the flag, its audit entry and the notification. Returns false when another run won the race. */
async function raiseFlag(params: {
  tenantId: string;
  engagement: { organizationId: string; projectId: string; organization: { name: string }; project: { codePrefix: string } };
  rule: FlagRule;
  evidence: ContractorFlagEvidence[];
  now: Date;
}): Promise<boolean> {
  const { tenantId, engagement: e, rule, evidence, now } = params;
  const ruleJson = { reportCount: rule.reportCount, workmanshipAtOrBelow: rule.workmanshipAtOrBelow, withinDays: rule.withinDays };
  const summary = contractorFlagSummary(ruleJson, evidence.length);
  const code = formatProjectCodeWithYear(e.project.codePrefix);
  try {
    await prisma.$transaction(async (tx) => {
      const flag = await tx.contractorFlag.create({
        data: {
          tenantId,
          organizationId: e.organizationId,
          projectId: e.projectId,
          status: 'OPEN',
          ruleJson,
          evidenceJson: sortEvidence(evidence) as unknown as Prisma.InputJsonValue,
          raisedAt: now,
        },
      });
      await recordAuditEvent(tx, {
        projectId: e.projectId,
        ...SYSTEM_ACTOR,
        action: 'CONTRACTOR_FLAG_RAISED',
        summaryText: `${e.organization.name} flagged on ${code}: ${summary}.`,
        payload: { flagId: flag.id, organizationId: e.organizationId, rule: ruleJson, visitSubmissionIds: evidence.map((x) => x.visitSubmissionId) },
      });
      await createWebNotification(tx, {
        projectId: e.projectId,
        targetPermissionKey: 'contractors:manage',
        category: 'CONTRACTOR_FLAGGED',
        title: `${code}: contractor flagged`,
        description: `${e.organization.name}: ${summary}.`,
        actionUrl: `/app/contractors/${e.organizationId}?flag=${flag.id}`,
        metadata: { flagId: flag.id, organizationId: e.organizationId },
        hideFromProjectContractors: true,
      });
    });
    return true;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Another run opened the flag first: this run's evidence joins it.
    const open = await prisma.contractorFlag.findFirst({ where: { organizationId: e.organizationId, projectId: e.projectId, status: 'OPEN' }, select: { id: true } });
    if (open) await mergeEvidence(open.id, evidence);
    return false;
  }
}

/** Raises / extends flags for every contractor engagement of a tenant (daily job). Returns flags raised. */
export async function evaluateContractorFlags(tenantId: string, now: Date = new Date()): Promise<number> {
  return evaluateEngagements(tenantId, now);
}

/**
 * After a monitoring report is accepted (after commit): the flag rule for that project's contractor,
 * then the tenant's rating snapshots (the rating is computed tenant-wide in one batch).
 */
export async function evaluateFlagsAfterAcceptance(projectId: string, now: Date = new Date()): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { tenantId: true, status: true } });
  if (!project) return;
  if (project.status === 'ACTIVE') await evaluateEngagements(project.tenantId, now, [projectId]);
  await refreshContractorRatingSnapshots(project.tenantId, now);
}

// ---------------------------------------------------------------------------
// Payment hold
// ---------------------------------------------------------------------------

/** The payment hold in effect on the project's contractor, or null (payments service and summary). */
export async function activePaymentHold(db: Db, projectId: string): Promise<ProjectPaymentHoldDto | null> {
  const engagements = await db.projectContractor.findMany({ where: { projectId, contractStatus: { not: 'TERMINATED' } }, select: { organizationId: true } });
  if (engagements.length === 0) return null;
  const action = await db.contractorFlagAction.findFirst({
    where: {
      kind: 'PAYMENT_HOLD',
      status: 'IN_EFFECT',
      flag: { projectId, organizationId: { in: engagements.map((e) => e.organizationId) } },
    },
    orderBy: { decidedAt: 'desc' },
  });
  if (!action) return null;
  return { flagId: action.flagId, actionId: action.id, since: action.decidedAt.toISOString(), reason: action.reason, decidedByName: action.decidedByName };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** GET /api/v1/contractor-flags: the tenant's flags, open first, newest first. */
export async function listContractorFlags(webUser: WebJwtPayload, query: ContractorFlagListQuery): Promise<ContractorFlagDto[]> {
  const rows = await prisma.contractorFlag.findMany({
    where: {
      tenantId: webUser.tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
    },
    include: FLAG_INCLUDE,
    orderBy: [{ status: 'desc' }, { raisedAt: 'desc' }], // 'OPEN' > 'CLOSED'
  });
  return rows.map((r) => serializeFlag(r, webUser));
}

/** GET /api/v1/projects/:projectId/contractor-flags (any reader of the project). */
export async function listProjectContractorFlags(projectId: string, webUser: WebJwtPayload): Promise<ContractorFlagDto[]> {
  const rows = await prisma.contractorFlag.findMany({
    where: { projectId },
    include: FLAG_INCLUDE,
    orderBy: [{ status: 'desc' }, { raisedAt: 'desc' }],
  });
  return rows.map((r) => serializeFlag(r, webUser));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertFlagId(flagId: string): void {
  if (!UUID_RE.test(flagId)) throw new AppError('Flag not found', 404, 'CONTRACTOR_FLAG_NOT_FOUND');
}

async function loadFlag(db: Db, tenantId: string, flagId: string): Promise<FlagRow> {
  assertFlagId(flagId);
  const flag = await db.contractorFlag.findFirst({ where: { id: flagId, tenantId }, include: FLAG_INCLUDE });
  if (!flag) throw new AppError('Flag not found', 404, 'CONTRACTOR_FLAG_NOT_FOUND');
  return flag;
}

/**
 * GET /api/v1/contractor-flags/:flagId: the register's readers (`contractors:view_register` or
 * `contractors:manage`) see any flag of the tenant; anyone else a flag of a project they can see
 * (live, draft or archived, as the project guard), so the overview can open it. 404 otherwise.
 */
export async function getContractorFlag(webUser: WebJwtPayload, flagId: string): Promise<ContractorFlagDto> {
  if (!hasWebPermission(webUser, 'contractors:view_register', 'contractors:manage')) {
    assertFlagId(flagId);
    const visible = await prisma.contractorFlag.count({
      where: { id: flagId, tenantId: webUser.tenantId, project: buildProjectVisibilityWhere(webUser, undefined, { statuses: ['DRAFT', 'ACTIVE', 'ARCHIVED'] }) },
    });
    if (!visible) throw new AppError('Flag not found', 404, 'CONTRACTOR_FLAG_NOT_FOUND');
  }
  return serializeFlag(await loadFlag(prisma, webUser.tenantId, flagId), webUser);
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

/** The next working day on or after `date` (the project's working days; any day when none are set). */
function onWorkday(date: string, workWeekDays: number[]): string {
  if (workWeekDays.length === 0) return date;
  let d = date;
  for (let i = 0; i < 7 && !workWeekDays.includes(isoWeekday(d)); i += 1) d = addDays(d, 1);
  return d;
}

/** ADDITIONAL_VISITS: PROPOSED visits, one a week from next week, on working days. Returns their ids. */
async function proposeAdditionalVisits(
  tx: Tx,
  webUser: WebJwtPayload,
  flag: FlagRow,
  input: DecideContractorFlagActionRequest,
  now: Date
): Promise<{ visitIds: string[]; params: Record<string, unknown> }> {
  const project = await loadVisitProject(tx, flag.projectId);
  if (project.status !== 'ACTIVE') {
    throw new AppError('Additional monitoring visits can be proposed on active projects only', 409, 'PROJECT_NOT_ACTIVE');
  }
  const kind = (input.visitKind ?? 'ROUTINE') as VisitKind;
  if (!ADDITIONAL_VISIT_KINDS.includes(kind)) {
    throw new AppError('Additional monitoring visits are routine, quarterly M&E or ad hoc', 422, 'VISIT_KIND_NOT_ALLOWED', { allowed: ADDITIONAL_VISIT_KINDS });
  }
  let officers: OfficerInput[];
  let assignedToProject: string[] = [];
  if (input.officerUserId) {
    ({ officers, assignedToProject } = await resolveOfficers(tx, project, [{ userId: input.officerUserId, isLead: true }]));
  } else {
    officers = await defaultOfficersFor(tx, project);
  }
  let pickedFacilityIds: string[] = [];
  if (kind === 'AD_HOC') {
    const units = await tx.facilityUnit.findMany({ where: { projectId: project.id }, select: { facilityId: true } });
    pickedFacilityIds = [...new Set(units.map((u) => u.facilityId))];
    if (pickedFacilityIds.length === 0) throw new AppError('This project has no facility units for an ad hoc monitoring visit to check', 422, 'VISIT_NEEDS_FACILITIES');
  }
  const config = monitoringConfigOf(project.projectTypeSnapshotJson);
  const sprints = await tx.projectSprint.findMany({ where: { projectId: project.id }, select: { id: true, startDate: true, endDate: true } });
  const today = projectToday(project, now);
  const count = input.visitCount ?? 1;
  const label = visitLabelInSentence(kind);
  const visitIds: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const date = onWorkday(addDays(today, 7 * i), project.workWeekDays);
    const visit = await tx.visit.create({
      data: {
        projectId: project.id,
        visitKind: kind,
        status: 'PROPOSED',
        origin: 'MANUAL',
        originalPlannedDate: date,
        plannedDate: date,
        sprintId: sprintForDate(sprints, date)?.id ?? null,
        pickedFacilityIds,
        submissionDeadline: submissionDeadlineFor(date, config.submissionDeadlineDays),
        createdByUserId: webUser.userId,
      },
    });
    await setVisitAssignees(tx, visit.id, officers);
    await recordAuditEvent(tx, {
      projectId: project.id,
      ...webActor(webUser),
      action: 'VISIT_CREATED',
      summaryText: `Proposed a ${label} on ${date}${officers.length ? ` with ${officers.length} officer(s)` : ''}: additional monitoring visit decided on the contractor flag.`,
      payload: { visitId: visit.id, visitKind: kind, plannedDate: date, assignees: officers, assignedToProject, contractorFlagId: flag.id },
    });
    visitIds.push(visit.id);
  }
  return { visitIds, params: { visitCount: count, visitKind: kind, officerUserIds: officers.map((o) => o.userId) } };
}

/** POST /api/v1/contractor-flags/:flagId/actions (`contractors:manage`). */
export async function decideContractorFlagAction(webUser: WebJwtPayload, flagId: string, input: DecideContractorFlagActionRequest): Promise<ContractorFlagDto> {
  const now = new Date();
  const meta = CONTRACTOR_FLAG_ACTION_META[input.kind];
  await prisma.$transaction(
    async (tx) => {
      assertFlagId(flagId);
      await tx.$queryRaw`SELECT id FROM "contractor_flags" WHERE id = ${flagId}::uuid FOR UPDATE`;
      const flag = await loadFlag(tx, webUser.tenantId, flagId);
      if (flag.status !== 'OPEN') throw new AppError('This flag is closed', 409, 'FLAG_CLOSED');
      const code = formatProjectCodeWithYear(flag.project.codePrefix);

      let params: Record<string, unknown> = {};
      let visitIds: string[] = [];
      if (input.kind === 'ADDITIONAL_VISITS') {
        ({ visitIds, params } = await proposeAdditionalVisits(tx, webUser, flag, input, now));
      } else if (input.kind === 'PAYMENT_HOLD') {
        const holding = await tx.contractorFlagAction.findFirst({
          where: { kind: 'PAYMENT_HOLD', status: 'IN_EFFECT', flag: { projectId: flag.projectId, organizationId: flag.organizationId } },
          select: { id: true },
        });
        if (holding) throw new AppError('A payment hold is already in effect on this contractor for this project', 409, 'PAYMENT_HOLD_ACTIVE', { actionId: holding.id });
      } else if (input.kind === 'DEDUCTION') {
        params = { deductionAmountNgn: input.deductionAmountNgn ?? null, clause: input.clause ?? null };
      }

      const action = await tx.contractorFlagAction.create({
        data: {
          flagId,
          kind: input.kind,
          status: meta.initialStatus,
          reason: input.reason,
          paramsJson: params as Prisma.InputJsonValue,
          visitIds,
          decidedByUserId: webUser.userId,
          decidedByName: actorName(webUser),
          decidedAt: now,
        },
      });
      await recordAuditEvent(tx, {
        projectId: flag.projectId,
        ...webActor(webUser),
        action: 'CONTRACTOR_FLAG_ACTION_DECIDED',
        summaryText:
          `${meta.label} decided on the flag on ${flag.organization.name} (${code}): ${input.reason}` +
          (meta.initialStatus === 'SENT_TO_LEGAL_REVIEW' ? ' Sent to Legal review.' : '') +
          (visitIds.length ? ` ${visitIds.length} monitoring visit(s) proposed.` : ''),
        payload: { flagId, actionId: action.id, kind: input.kind, status: meta.initialStatus, params, visitIds },
      });
      if (meta.closesFlag) {
        await tx.contractorFlag.update({
          where: { id: flagId },
          data: { status: 'CLOSED', closedAt: now, closedByUserId: webUser.userId, closedByName: actorName(webUser), closeReason: input.reason },
        });
        await recordAuditEvent(tx, {
          projectId: flag.projectId,
          ...webActor(webUser),
          action: 'CONTRACTOR_FLAG_CLOSED',
          summaryText: `Closed the flag on ${flag.organization.name} (${code}): ${input.reason}`,
          payload: { flagId, actionId: action.id, organizationId: flag.organizationId },
        });
      }
    },
    { timeout: 30_000 }
  );
  return getContractorFlag(webUser, flagId);
}

/** POST /api/v1/contractor-flags/:flagId/actions/:actionId/lift: ends an in-effect payment hold. */
export async function liftContractorFlagAction(
  webUser: WebJwtPayload,
  flagId: string,
  actionId: string,
  input: LiftContractorFlagActionRequest
): Promise<ContractorFlagDto> {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    assertFlagId(flagId);
    await tx.$queryRaw`SELECT id FROM "contractor_flags" WHERE id = ${flagId}::uuid FOR UPDATE`;
    const flag = await loadFlag(tx, webUser.tenantId, flagId);
    const action = flag.actions.find((a) => a.id === actionId);
    if (!action) throw new AppError('Action not found', 404, 'CONTRACTOR_FLAG_ACTION_NOT_FOUND');
    if (action.kind !== 'PAYMENT_HOLD' || action.status !== 'IN_EFFECT') {
      throw new AppError('Only a payment hold in effect can be lifted', 409, 'ACTION_NOT_LIFTABLE', { kind: action.kind, status: action.status });
    }
    await tx.contractorFlagAction.update({
      where: { id: actionId },
      data: { status: 'LIFTED', liftedAt: now, liftedByUserId: webUser.userId, liftedByName: actorName(webUser), liftReason: input.reason },
    });
    await recordAuditEvent(tx, {
      projectId: flag.projectId,
      ...webActor(webUser),
      action: 'CONTRACTOR_FLAG_ACTION_LIFTED',
      summaryText: `Lifted the payment hold on ${flag.organization.name} (${formatProjectCode(flag.project.codePrefix)}): ${input.reason}`,
      payload: { flagId, actionId, kind: action.kind },
    });
  });
  return getContractorFlag(webUser, flagId);
}
