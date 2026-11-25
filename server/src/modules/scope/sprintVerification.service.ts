import {
  deriveSprintStatus,
  SprintVerificationViewDto,
  unitsActiveInSprint,
  VerifySprintRequest,
  VisitFormAnswer,
  VisitFormSnapshotSchema,
  VisitKind,
  zonedCalendarDate,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { hasWebPermission, type WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { refreshScheduleBadge } from '../schedule/schedule.service';
import { monitoringConfigOf } from '../visits/visitCore';

/**
 * Redesign R4e (D-R4.31): the M&E manager verifies a sprint as met, partly met or not met once it has
 * started (normally after it ends; verifying early needs a note). Re-verifying replaces the outcome
 * and keeps `firstVerifiedAt` (the on-time KPI). The badge follows (D-R4.32). Verification is the
 * event an ERP webhook will listen to later (spec 9); nothing is sent now.
 */

async function loadSprint(projectId: string, sprintId: string) {
  const sprint = await prisma.projectSprint.findFirst({ where: { id: sprintId, projectId } });
  if (!sprint) throw new AppError('Work phase not found', 404, 'SPRINT_NOT_FOUND');
  return sprint;
}

function answerText(value: unknown, options: Array<{ key: string; label: string }>): string {
  const label = (k: string) => options.find((o) => o.key === k)?.label ?? k;
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.map((v) => label(String(v))).join(', ');
  if (value === 'YES') return 'Yes';
  if (value === 'NO') return 'No';
  if (value === 'NA') return 'N/A';
  return typeof value === 'string' ? label(value) : String(value);
}

export async function getSprintVerification(projectId: string, sprintId: string, webUser: WebJwtPayload): Promise<SprintVerificationViewDto> {
  const sprint = await loadSprint(projectId, sprintId);
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { timezone: true, projectTypeSnapshotJson: true } });
  const today = zonedCalendarDate(new Date(), project.timezone);
  const days = monitoringConfigOf(project.projectTypeSnapshotJson).sprintVerificationDays;
  const units = await prisma.facilityUnit.findMany({
    where: { projectId },
    include: { facility: { select: { id: true, name: true, sortOrder: true } }, startSprint: { select: { number: true } }, endSprint: { select: { number: true } } },
    orderBy: [{ facility: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
  });
  const inSprint = unitsActiveInSprint(
    units.map((u) => ({ ...u, startSprintNumber: u.startSprint?.number ?? null, endSprintNumber: u.endSprint?.number ?? null })),
    sprint.number
  );
  const facilityIds = [...new Set(inSprint.map((u) => u.facilityId))];
  const [submissions, findings, verifier] = await Promise.all([
    prisma.visitSubmission.findMany({
      where: { projectId, status: 'APPROVED', visit: { plannedDate: { gte: sprint.startDate, lte: sprint.endDate } } },
      include: { visit: { select: { id: true, visitKind: true, plannedDate: true } } },
      orderBy: { visit: { plannedDate: 'desc' } },
    }),
    prisma.finding.findMany({ where: { projectId, status: 'OPEN', facilityId: { in: facilityIds } }, orderBy: { createdAt: 'asc' } }),
    sprint.verifiedByUserId ? prisma.user.findUnique({ where: { id: sprint.verifiedByUserId }, select: { fullName: true } }) : null,
  ]);
  const snapshots = new Map<string, ReturnType<typeof VisitFormSnapshotSchema.safeParse>>();
  for (const s of submissions) {
    if (snapshots.has(s.formSnapshotId)) continue;
    const row = await prisma.visitFormSnapshot.findUnique({ where: { id: s.formSnapshotId }, select: { snapshotJson: true } });
    snapshots.set(s.formSnapshotId, VisitFormSnapshotSchema.safeParse(row?.snapshotJson));
  }
  const facilities: SprintVerificationViewDto['facilities'] = facilityIds.map((facilityId) => {
    const own = inSprint.filter((u) => u.facilityId === facilityId);
    let latestVisit: SprintVerificationViewDto['facilities'][number]['latestVisit'] = null;
    for (const s of submissions) {
      const parsed = snapshots.get(s.formSnapshotId);
      if (!parsed?.success) continue;
      const block = parsed.data.blocks.find((b) => b.facility?.id === facilityId);
      if (!block) continue;
      const answers = new Map(((Array.isArray(s.answersJson) ? s.answersJson : []) as VisitFormAnswer[]).map((a) => [a.path, a]));
      latestVisit = {
        visitId: s.visit.id,
        visitKind: s.visit.visitKind as VisitKind,
        date: s.visit.plannedDate,
        submissionId: s.id,
        answers: block.fields
          .filter((f) => f.type !== 'PHOTO' && f.type !== 'VOICE_NOTE')
          .map((f) => ({ label: f.unitId ? `${f.label} (${block.units.find((u) => u.id === f.unitId)?.label ?? 'unit'})` : f.label, answer: answerText(answers.get(f.path)?.value, f.options) })),
      };
      break;
    }
    return {
      facilityId,
      facilityName: own[0].facility.name,
      units: own.map((u) => ({
        unitId: u.id,
        code: u.code,
        label: u.label,
        progressPct: u.progressPct === null ? null : Number(u.progressPct),
        progressAsOf: u.progressAsOf,
      })),
      latestVisit,
      openFindings: findings
        .filter((f) => f.facilityId === facilityId)
        .map((f) => ({ id: f.id, title: f.title ?? f.description.slice(0, 120), severity: f.severity, raisedDate: zonedCalendarDate(f.createdAt, project.timezone) })),
    };
  });
  return {
    sprintId: sprint.id,
    number: sprint.number,
    name: sprint.name,
    startDate: sprint.startDate,
    endDate: sprint.endDate,
    deliverables: sprint.deliverables,
    status: deriveSprintStatus(sprint, today, days),
    outcome: sprint.verificationOutcome,
    verifiedAt: sprint.verifiedAt?.toISOString() ?? null,
    verifiedByName: verifier?.fullName ?? null,
    notes: sprint.verificationNotes,
    firstVerifiedAt: sprint.firstVerifiedAt?.toISOString() ?? null,
    endedYet: today > sprint.endDate,
    canVerify: today >= sprint.startDate && hasWebPermission(webUser, 'sprints:verify'),
    facilities,
  };
}

export async function verifySprint(projectId: string, sprintId: string, webUser: WebJwtPayload, input: VerifySprintRequest): Promise<SprintVerificationViewDto> {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "project_sprints" WHERE id = ${sprintId}::uuid AND "projectId" = ${projectId}::uuid FOR UPDATE`;
    const sprint = await tx.projectSprint.findFirst({ where: { id: sprintId, projectId } });
    if (!sprint) throw new AppError('Work phase not found', 404, 'SPRINT_NOT_FOUND');
    const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { timezone: true, status: true } });
    if (project.status !== 'ACTIVE') throw new AppError('Work phases are verified on live projects', 409, 'PROJECT_NOT_ACTIVE');
    const today = zonedCalendarDate(now, project.timezone);
    if (today < sprint.startDate) throw new AppError('A work phase can be verified once it has started', 409, 'SPRINT_NOT_STARTED');
    const notes = input.notes?.trim() || null;
    if (today <= sprint.endDate && (notes ?? '').length < 3) {
      throw new AppError('This work phase has not ended yet: say why it is verified early', 422, 'NOTE_REQUIRED');
    }
    await tx.projectSprint.update({
      where: { id: sprintId },
      data: {
        verificationOutcome: input.outcome,
        verifiedAt: now,
        verifiedByUserId: webUser.userId,
        verificationNotes: notes,
        firstVerifiedAt: sprint.firstVerifiedAt ?? now,
      },
    });
    const label = input.outcome === 'MET' ? 'met' : input.outcome === 'PARTLY_MET' ? 'partly met' : 'not met';
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
      action: 'SPRINT_VERIFIED',
      summaryText: `${sprint.verificationOutcome ? 'Re-verified' : 'Verified'} ${sprint.name} as ${label}${sprint.verificationOutcome ? ` (was ${sprint.verificationOutcome.replace('_', ' ').toLowerCase()})` : ''}${
        notes ? `: ${notes}` : '.'
      }`,
      payload: { sprintId, outcome: input.outcome, previousOutcome: sprint.verificationOutcome, notes, early: today <= sprint.endDate },
    });
  });
  await refreshScheduleBadge(projectId, now);
  return getSprintVerification(projectId, sprintId, webUser);
}
