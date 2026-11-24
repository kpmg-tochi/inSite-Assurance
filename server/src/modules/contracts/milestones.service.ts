import { Prisma } from '@prisma/client';
import {
  ContractMilestoneAnchor,
  ContractMilestoneDto,
  ContractMilestoneStatus,
  computeMilestoneDueDates,
  HANDOVER_CEREMONY_MILESTONE_KEY,
  deriveMilestoneStatus,
  describeMilestoneAnchor,
  MilestoneAnchorDates,
  MilestoneCompletionMode,
  milestoneDaysLeft,
  MilestoneResponsibleScope,
  OPEN_DEFAULT_CASE_STATUSES,
  ProjectMilestonesDto,
  resolveProjectTypeConfig,
  zonedCalendarDate,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { evidenceFor, registerEvidence, RegisterEvidence, usersHoldingPermission } from '../documents/documents.service';

/**
 * Phase 13: contract milestones. Rows are created from the project type's snapshot
 * (`contractMilestones`), one per contractor for per-contractor templates, and their due dates are
 * computed from the project's anchor dates (shared `computeMilestoneDueDates`). Stored status is
 * written by the milestone-deadlines job; reads derive PENDING / DUE / OVERDUE for today.
 */

type Db = Prisma.TransactionClient | typeof prisma;
type Tx = Prisma.TransactionClient;

const CLOSED: ContractMilestoneStatus[] = ['DONE', 'WAIVED'];
export const OPEN_MILESTONE_STATUSES: ContractMilestoneStatus[] = ['PENDING', 'DUE', 'OVERDUE'];

export interface MilestoneActor {
  actorType: 'WEB_USER' | 'FIELD_AGENT' | 'SYSTEM';
  actorId: string;
  actorDisplayName: string;
  userId: string | null;
}

export function webActor(webUser: WebJwtPayload): MilestoneActor {
  return {
    actorType: 'WEB_USER',
    actorId: webUser.userId,
    actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
    userId: webUser.userId,
  };
}

export const SYSTEM_ACTOR: MilestoneActor = {
  actorType: 'SYSTEM',
  actorId: 'contract-milestones',
  actorDisplayName: 'InSite (contract milestones)',
  userId: null,
};

const PROJECT_ANCHOR_SELECT = {
  id: true,
  tenantId: true,
  status: true,
  timezone: true,
  workWeekDays: true,
  activatedAt: true,
  contractAwardDate: true,
  contractSignedDate: true,
  kickoffDate: true,
  projectTypeSnapshotJson: true,
  // Phase 15 anchors
  constructionPhase: true,
  constructionPhaseChangedAt: true,
  completionCertificates: { where: { status: 'ISSUED' }, select: { issuedAt: true }, take: 1 },
} satisfies Prisma.ProjectSelect;

type AnchorProject = Prisma.ProjectGetPayload<{ select: typeof PROJECT_ANCHOR_SELECT }>;

export function anchorDatesOf(project: AnchorProject): MilestoneAnchorDates {
  return {
    CONTRACT_AWARD: project.contractAwardDate,
    CONTRACT_SIGNED: project.contractSignedDate,
    KICKOFF: project.kickoffDate,
    ACTIVATION: project.activatedAt ? zonedCalendarDate(project.activatedAt, project.timezone) : null,
    COC_ISSUED: project.completionCertificates[0]?.issuedAt ? zonedCalendarDate(project.completionCertificates[0].issuedAt, project.timezone) : null,
    PROJECT_CLOSED:
      project.constructionPhase === 'COMPLETED_CLOSED' && project.constructionPhaseChangedAt
        ? zonedCalendarDate(project.constructionPhaseChangedAt, project.timezone)
        : null,
  };
}

/** Anchors (other than ACTIVATION and MILESTONE) the project type's templates count from. */
export function requiredAnchorsFor(snapshot: unknown): ContractMilestoneAnchor[] {
  const templates = resolveProjectTypeConfig(snapshot)?.contractMilestones ?? [];
  const order: ContractMilestoneAnchor[] = ['CONTRACT_AWARD', 'CONTRACT_SIGNED', 'KICKOFF'];
  return order.filter((a) => templates.some((t) => t.anchor === a));
}

// ---------------------------------------------------------------------------
// Generation and recomputation
// ---------------------------------------------------------------------------

/**
 * Makes the project's milestone rows follow its type snapshot: creates missing rows (one per active
 * contractor for per-contractor templates), refreshes the template fields of open rows, and
 * removes open rows whose template is gone. Done and waived rows are history and stay.
 */
export async function syncContractMilestones(tx: Tx, projectId: string): Promise<{ created: number; removed: number }> {
  const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: PROJECT_ANCHOR_SELECT });
  const templates = resolveProjectTypeConfig(project.projectTypeSnapshotJson)?.contractMilestones ?? [];
  const [contractors, existing] = await Promise.all([
    tx.projectContractor.findMany({
      where: { projectId, contractStatus: 'ACTIVE' },
      orderBy: [{ createdAt: 'asc' }],
      select: { id: true },
    }),
    tx.projectContractMilestone.findMany({ where: { projectId } }),
  ]);
  const roleCodes = [...new Set(templates.map((t) => t.responsibleRoleCode).filter((c): c is string => Boolean(c)))];
  const roles = roleCodes.length
    ? await tx.role.findMany({ where: { tenantId: project.tenantId, code: { in: roleCodes } }, select: { id: true, code: true } })
    : [];
  const roleIdByCode = new Map(roles.map((r) => [r.code, r.id]));

  let created = 0;
  const wanted = new Set<string>();
  for (const [index, t] of templates.entries()) {
    const fields = {
      label: t.label,
      description: t.description,
      anchor: t.anchor,
      anchorMilestoneKey: t.anchor === 'MILESTONE' ? t.anchorMilestoneKey : null,
      offsetValue: t.offsetValue,
      offsetUnit: t.offsetUnit,
      completionMode: t.completionMode,
      requiredDocumentTypeCodes: t.requiredDocumentTypeCodes,
      requiresSignOffPermissionKey: t.signOffPermissionKey,
      responsibleRoleId: t.responsibleRoleCode ? roleIdByCode.get(t.responsibleRoleCode) ?? null : null,
      responsibleOrganizationScope: t.responsibleScope,
      sortOrder: (index + 1) * 10,
    };
    const scopes: Array<string | null> = t.perContractor ? contractors.map((c) => c.id) : [null];
    for (const pcId of scopes) {
      wanted.add(`${t.key}|${pcId ?? ''}`);
      const row = existing.find((r) => r.key === t.key && r.projectContractorId === pcId);
      if (!row) {
        await tx.projectContractMilestone.create({ data: { projectId, projectContractorId: pcId, key: t.key, ...fields } });
        created += 1;
      } else if (!CLOSED.includes(row.status)) {
        await tx.projectContractMilestone.update({ where: { id: row.id }, data: fields });
      }
    }
  }
  // Open rows whose template disappeared. Rows of terminated or replacement contractors are kept,
  // and so is the handover ceremony the platform creates when a CoC is issued (Phase 15).
  const templateKeys = new Set(templates.map((t) => t.key));
  const stale = existing.filter((r) => !CLOSED.includes(r.status) && !templateKeys.has(r.key) && r.key !== HANDOVER_CEREMONY_MILESTONE_KEY);
  if (stale.length) await tx.projectContractMilestone.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
  void wanted;
  await recomputeMilestoneDates(tx, projectId);
  return { created, removed: stale.length };
}

/**
 * Recomputes the due dates of open rows from the current anchors. A row whose date moves gets its
 * status re-derived and its notification history cleared (a new date can be notified again).
 * Returns the rows that moved.
 */
export async function recomputeMilestoneDates(
  tx: Tx,
  projectId: string,
  now: Date = new Date()
): Promise<Array<{ id: string; label: string; from: string | null; to: string | null }>> {
  const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: PROJECT_ANCHOR_SELECT });
  const rows = await tx.projectContractMilestone.findMany({ where: { projectId } });
  if (rows.length === 0) return [];
  const dates = computeMilestoneDueDates(
    rows.map((r) => ({
      id: r.id,
      key: r.key,
      projectContractorId: r.projectContractorId,
      anchor: r.anchor,
      anchorMilestoneKey: r.anchorMilestoneKey,
      offsetValue: r.offsetValue,
      offsetUnit: r.offsetUnit,
      anchorDateOverride: r.anchorDateOverride,
      status: r.status,
      completedDate: r.completedAt ? zonedCalendarDate(r.completedAt, project.timezone) : null,
    })),
    anchorDatesOf(project),
    project.workWeekDays
  );
  const today = zonedCalendarDate(now, project.timezone);
  const moved: Array<{ id: string; label: string; from: string | null; to: string | null }> = [];
  for (const r of rows) {
    if (CLOSED.includes(r.status)) continue;
    const next = dates.get(r.id) ?? null;
    if (next === r.dueDate) continue;
    await tx.projectContractMilestone.update({
      where: { id: r.id },
      data: {
        dueDate: next,
        status: deriveMilestoneStatus(r.status, next, today),
        lastNotifiedStatus: null,
        remindedOffsetsDays: [],
      },
    });
    moved.push({ id: r.id, label: r.label, from: r.dueDate, to: next });
  }
  return moved;
}

/** Recomputes and, when anything moved, records MILESTONE_DATES_RECOMPUTED with the reason. */
export async function recomputeAndAudit(tx: Tx, projectId: string, actor: MilestoneActor, reason: string) {
  const moved = await recomputeMilestoneDates(tx, projectId);
  if (moved.length === 0) return moved;
  await recordAuditEvent(tx, {
    projectId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    actorDisplayName: actor.actorDisplayName,
    action: 'MILESTONE_DATES_RECOMPUTED',
    summaryText: `Moved the due dates of ${moved.length} contract milestone(s): ${reason}`,
    payload: { reason, moved },
  });
  return moved;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const MILESTONE_INCLUDE = {
  projectContractor: { select: { organization: { select: { name: true } } } },
  defaultCases: { where: { status: { in: OPEN_DEFAULT_CASE_STATUSES } }, select: { id: true }, take: 1 },
} satisfies Prisma.ProjectContractMilestoneInclude;

type MilestoneRow = Prisma.ProjectContractMilestoneGetPayload<{ include: typeof MILESTONE_INCLUDE }>;

interface EvidenceContext {
  evidence: RegisterEvidence[];
  typeNames: Map<string, string>;
  /** permissionKey → signer ids holding it */
  holders: Map<string, Set<string>>;
}

async function loadEvidenceContext(db: Db, projectId: string, tenantId: string, rows: Array<Pick<MilestoneRow, 'requiredDocumentTypeCodes' | 'requiresSignOffPermissionKey'>>): Promise<EvidenceContext> {
  const codes = [...new Set(rows.flatMap((r) => r.requiredDocumentTypeCodes))];
  const [evidence, types] = await Promise.all([
    registerEvidence(db, projectId, codes),
    codes.length ? db.documentType.findMany({ where: { tenantId, code: { in: codes } }, select: { code: true, name: true } }) : [],
  ]);
  const signerIds = [...new Set(evidence.flatMap((e) => e.currentSignerIds))];
  const keys = [...new Set(rows.map((r) => r.requiresSignOffPermissionKey).filter((k): k is string => Boolean(k)))];
  const holders = new Map<string, Set<string>>();
  for (const key of keys) holders.set(key, await usersHoldingPermission(db, signerIds, key));
  return { evidence, typeNames: new Map(types.map((t) => [t.code, t.name])), holders };
}

function milestoneEvidence(row: Pick<MilestoneRow, 'requiredDocumentTypeCodes' | 'requiresSignOffPermissionKey' | 'projectContractorId'>, ctx: EvidenceContext) {
  return row.requiredDocumentTypeCodes.map((code) => {
    const docs = evidenceFor(ctx.evidence, code, row.projectContractorId);
    const signedBy = (e: RegisterEvidence) => {
      if (row.requiresSignOffPermissionKey) {
        const holders = ctx.holders.get(row.requiresSignOffPermissionKey) ?? new Set<string>();
        return e.currentSignerIds.some((id) => holders.has(id));
      }
      return e.currentSignerIds.length > 0;
    };
    const signOffRequired = Boolean(row.requiresSignOffPermissionKey) || docs.some((d) => d.requiresSignOff);
    const best = docs.find((d) => !signOffRequired || signedBy(d)) ?? docs[0] ?? null;
    const requiresForBest = Boolean(row.requiresSignOffPermissionKey) || Boolean(best?.requiresSignOff);
    return {
      documentTypeCode: code,
      documentTypeName: ctx.typeNames.get(code) ?? code,
      documentId: best?.documentId ?? null,
      documentTitle: best?.title ?? null,
      signOffRequired: requiresForBest,
      signed: best ? !requiresForBest || signedBy(best) : false,
    };
  });
}

function evidenceComplete(evidence: ReturnType<typeof milestoneEvidence>) {
  return evidence.every((e) => e.documentId && (!e.signOffRequired || e.signed));
}

export async function getProjectMilestones(projectId: string, now: Date = new Date()): Promise<ProjectMilestonesDto> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: PROJECT_ANCHOR_SELECT });
  const rows = await prisma.projectContractMilestone.findMany({
    where: { projectId },
    include: MILESTONE_INCLUDE,
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  const today = zonedCalendarDate(now, project.timezone);
  const ctx = await loadEvidenceContext(prisma, projectId, project.tenantId, rows);
  const userIds = [...new Set(rows.map((r) => r.completedByUserId).filter((v): v is string => Boolean(v)))];
  const roleIds = [...new Set(rows.map((r) => r.responsibleRoleId).filter((v): v is string => Boolean(v)))];
  const [users, roles] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : [],
    roleIds.length ? prisma.role.findMany({ where: { id: { in: roleIds } }, select: { id: true, name: true } }) : [],
  ]);
  const userName = new Map(users.map((u) => [u.id, u.fullName]));
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  const labelByKey = new Map(rows.map((r) => [r.key, r.label]));

  const milestones: ContractMilestoneDto[] = rows.map((r) => {
    const status = deriveMilestoneStatus(r.status, r.dueDate, today);
    const evidence = milestoneEvidence(r, ctx);
    return {
      id: r.id,
      projectContractorId: r.projectContractorId,
      contractorName: r.projectContractor?.organization.name ?? null,
      key: r.key,
      label: r.label,
      description: r.description,
      anchor: r.anchor,
      anchorMilestoneKey: r.anchorMilestoneKey,
      offsetValue: r.offsetValue,
      offsetUnit: r.offsetUnit,
      anchorLabel: describeMilestoneAnchor(r, (k) => labelByKey.get(k) ?? null),
      anchorDateOverride: r.anchorDateOverride,
      dueDate: r.dueDate,
      status,
      daysLeft: milestoneDaysLeft(status, r.dueDate, today),
      completionMode: r.completionMode,
      requiredDocumentTypeCodes: r.requiredDocumentTypeCodes,
      requiresSignOffPermissionKey: r.requiresSignOffPermissionKey,
      responsibleRoleId: r.responsibleRoleId,
      responsibleRoleName: r.responsibleRoleId ? roleName.get(r.responsibleRoleId) ?? null : null,
      responsibleScope: r.responsibleOrganizationScope as MilestoneResponsibleScope,
      completedAt: r.completedAt?.toISOString() ?? null,
      completedByName: r.completedByUserId ? userName.get(r.completedByUserId) ?? null : null,
      completedNotes: r.completedNotes,
      waivedReason: r.waivedReason,
      evidence,
      readyToComplete: STAFF_COMPLETABLE.includes(r.completionMode) && !CLOSED.includes(status) && evidenceComplete(evidence),
      openDefaultCaseId: r.defaultCases[0]?.id ?? null,
      sortOrder: r.sortOrder,
    };
  });
  const soon = (m: ContractMilestoneDto) => m.daysLeft !== null && m.daysLeft >= 0 && m.daysLeft <= 7;
  return {
    today,
    anchors: {
      contractAwardDate: project.contractAwardDate,
      contractSignedDate: project.contractSignedDate,
      kickoffDate: project.kickoffDate,
      activationDate: anchorDatesOf(project).ACTIVATION,
    },
    milestones,
    summary: {
      total: milestones.length,
      done: milestones.filter((m) => CLOSED.includes(m.status)).length,
      overdue: milestones.filter((m) => m.status === 'OVERDUE').length,
      dueSoon: milestones.filter(soon).length,
    },
  };
}

/** Overdue open milestones per project (directory badge), derived for today in each project's zone. */
export async function overdueMilestoneCounts(projects: Array<{ id: string; timezone: string }>, now: Date = new Date()) {
  const out = new Map<string, number>();
  if (projects.length === 0) return out;
  const rows = await prisma.projectContractMilestone.findMany({
    where: { projectId: { in: projects.map((p) => p.id) }, status: { in: OPEN_MILESTONE_STATUSES }, dueDate: { not: null } },
    select: { projectId: true, dueDate: true },
  });
  const tz = new Map(projects.map((p) => [p.id, p.timezone]));
  for (const r of rows) {
    const today = zonedCalendarDate(now, tz.get(r.projectId) ?? 'Africa/Lagos');
    if (r.dueDate! < today) out.set(r.projectId, (out.get(r.projectId) ?? 0) + 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Completing and waiving
// ---------------------------------------------------------------------------

async function lockMilestone(tx: Tx, projectId: string, milestoneId: string) {
  await tx.$queryRaw`SELECT id FROM "project_contract_milestones" WHERE id = ${milestoneId}::uuid FOR UPDATE`;
  const row = await tx.projectContractMilestone.findFirst({ where: { id: milestoneId, projectId } });
  if (!row) throw new AppError('Milestone not found', 404, 'MILESTONE_NOT_FOUND');
  if (CLOSED.includes(row.status)) {
    throw new AppError(`This milestone is already ${row.status === 'DONE' ? 'done' : 'waived'}`, 409, 'MILESTONE_CLOSED');
  }
  return row;
}

/**
 * Modes staff complete by hand. R1e: telemetry is gone, so "contractor on site" is confirmed by an
 * officer until the mobilisation check visits complete it (R4).
 */
const STAFF_COMPLETABLE: string[] = ['MANUAL', 'AUTO_CONTRACTOR_ON_SITE'];

export async function completeMilestone(projectId: string, milestoneId: string, webUser: WebJwtPayload, notes: string | null) {
  await prisma.$transaction(async (tx) => {
    const row = await lockMilestone(tx, projectId, milestoneId);
    if (!STAFF_COMPLETABLE.includes(row.completionMode)) {
      throw new AppError('This milestone is completed by the platform when its event happens.', 409, 'MILESTONE_NOT_MANUAL');
    }
    const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { tenantId: true } });
    const ctx = await loadEvidenceContext(tx, projectId, project.tenantId, [row]);
    const evidence = milestoneEvidence(row, ctx);
    const missing = evidence.filter((e) => !e.documentId || (e.signOffRequired && !e.signed));
    if (missing.length) {
      throw new AppError(
        `Still needed: ${missing.map((m) => (m.documentId ? `a sign-off on ${m.documentTypeName}` : m.documentTypeName)).join(', ')}.`,
        422,
        'MILESTONE_DOCUMENTS_MISSING',
        { missing: missing.map((m) => ({ documentTypeCode: m.documentTypeCode, documentPresent: Boolean(m.documentId), signed: m.signed })) }
      );
    }
    await markDone(tx, row, webActor(webUser), new Date(), notes);
    await recomputeMilestoneDates(tx, projectId);
  });
  return getProjectMilestones(projectId);
}

export async function waiveMilestone(projectId: string, milestoneId: string, webUser: WebJwtPayload, reason: string) {
  await prisma.$transaction(async (tx) => {
    const row = await lockMilestone(tx, projectId, milestoneId);
    await tx.projectContractMilestone.update({
      where: { id: row.id },
      data: { status: 'WAIVED', waivedReason: reason, completedAt: new Date(), completedByUserId: webUser.userId },
    });
    const actor = webActor(webUser);
    await recordAuditEvent(tx, {
      projectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      actorDisplayName: actor.actorDisplayName,
      action: 'MILESTONE_WAIVED',
      summaryText: `Waived contract milestone "${row.label}" (due ${row.dueDate ?? 'no date'}): ${reason}`,
      payload: { milestoneId: row.id, key: row.key, projectContractorId: row.projectContractorId, dueDate: row.dueDate, reason },
    });
    await recomputeMilestoneDates(tx, projectId);
  });
  return getProjectMilestones(projectId);
}

type OpenRow = Prisma.ProjectContractMilestoneGetPayload<object>;

async function markDone(tx: Tx, row: OpenRow, actor: MilestoneActor, at: Date, notes: string | null) {
  await tx.projectContractMilestone.update({
    where: { id: row.id },
    data: { status: 'DONE', completedAt: at, completedByUserId: actor.userId, completedNotes: notes },
  });
  await recordAuditEvent(tx, {
    projectId: row.projectId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    actorDisplayName: actor.actorDisplayName,
    action: 'MILESTONE_COMPLETED',
    summaryText: `Contract milestone "${row.label}" done${row.dueDate ? ` (due ${row.dueDate})` : ''}${notes ? `: ${notes}` : '.'}`,
    payload: { milestoneId: row.id, key: row.key, projectContractorId: row.projectContractorId, dueDate: row.dueDate, completedAt: at.toISOString(), completionMode: row.completionMode },
  });
}

/**
 * Completes the open milestones of an automatic mode (idempotent: closed rows are skipped).
 * `projectContractorId`: undefined = every row of the mode; a contractor id = that contractor's
 * rows and project-level ones. A cure period running on a completed milestone ends as cured.
 */
export async function autoCompleteMilestones(
  tx: Tx,
  params: {
    projectId: string;
    mode: MilestoneCompletionMode;
    projectContractorId?: string;
    /** Only rows without a contractor. */
    onlyProjectLevel?: boolean;
    /** Phase 15: only rows that have a due date (their anchor has happened). */
    onlyDated?: boolean;
    at: Date;
    notes: string;
    actor?: MilestoneActor;
  }
): Promise<number> {
  const rows = await tx.projectContractMilestone.findMany({
    where: {
      projectId: params.projectId,
      completionMode: params.mode,
      status: { in: OPEN_MILESTONE_STATUSES },
      ...(params.onlyDated ? { dueDate: { not: null } } : {}),
      ...(params.onlyProjectLevel
        ? { projectContractorId: null }
        : params.projectContractorId
          ? { OR: [{ projectContractorId: params.projectContractorId }, { projectContractorId: null }] }
          : {}),
    },
  });
  if (rows.length === 0) return 0;
  const actor = params.actor ?? SYSTEM_ACTOR;
  for (const row of rows) {
    // Claim the row so a concurrent completion does not complete it twice.
    const claimed = await tx.projectContractMilestone.updateMany({
      where: { id: row.id, status: { in: OPEN_MILESTONE_STATUSES } },
      data: { status: 'DONE', completedAt: params.at, completedByUserId: actor.userId, completedNotes: params.notes },
    });
    if (claimed.count === 0) continue;
    await markDone(tx, row, actor, params.at, params.notes);
    const cured = await tx.contractorDefaultCase.findMany({ where: { milestoneId: row.id, status: 'CURE_PERIOD' }, select: { id: true } });
    for (const c of cured) {
      await tx.contractorDefaultCase.update({
        where: { id: c.id },
        data: { status: 'CLOSED', currentStepOrder: null, outcomeNotes: `Cured: "${row.label}" done on ${params.at.toISOString().slice(0, 10)}.` },
      });
      await recordAuditEvent(tx, {
        projectId: row.projectId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        actorDisplayName: actor.actorDisplayName,
        action: 'DEFAULT_CASE_DECIDED',
        summaryText: `Default case closed as cured: "${row.label}" was done within the cure period.`,
        payload: { caseId: c.id, milestoneId: row.id, outcome: 'CLOSED', cured: true },
      });
    }
  }
  await recomputeMilestoneDates(tx, params.projectId);
  return rows.length;
}

/**
 * Phase 15: reopens the done rows of an automatic mode (a revoked Certificate of Completion
 * reopens what its issue completed). Waived rows stay waived.
 */
export async function reopenMilestones(tx: Tx, params: { projectId: string; mode: MilestoneCompletionMode; reason: string; actor: MilestoneActor }) {
  const rows = await tx.projectContractMilestone.findMany({ where: { projectId: params.projectId, completionMode: params.mode, status: 'DONE' } });
  for (const row of rows) {
    await tx.projectContractMilestone.update({
      where: { id: row.id },
      data: { status: 'PENDING', completedAt: null, completedByUserId: null, completedNotes: null, lastNotifiedStatus: null, remindedOffsetsDays: [] },
    });
  }
  if (rows.length) {
    await recordAuditEvent(tx, {
      projectId: params.projectId,
      actorType: params.actor.actorType,
      actorId: params.actor.actorId,
      actorDisplayName: params.actor.actorDisplayName,
      action: 'MILESTONE_DATES_RECOMPUTED',
      summaryText: `Reopened ${rows.length} contract milestone(s): ${params.reason}`,
      payload: { reason: params.reason, reopened: rows.map((r) => ({ id: r.id, key: r.key, label: r.label })) },
    });
  }
  return rows.length;
}

