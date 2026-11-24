import { Prisma } from '@prisma/client';
import {
  addDays,
  ApprovalProgressDto,
  assembleVisitForm,
  assemblyInputFromBundle,
  calendarDateInTimeZone,
  CaptureFact,
  CreateUnscheduledVisitRequest,
  MyVisitsFeedDto,
  ProjectGeofenceSchema,
  rescheduleWindow,
  sameFormApartFromRechecks,
  sprintForDate,
  submissionDeadlineFor,
  SubmissionGeotag,
  SubmissionGeotagInput,
  SubmitVisitRequest,
  validateVisitAnswers,
  VisitAnswerDto,
  VisitCheckInRequest,
  VisitDto,
  VisitFieldPackDto,
  VisitFormAnswer,
  VisitFormAssemblyError,
  VisitFormDto,
  VisitSubmissionDto,
  VisitSubmissionStatus,
  zonedCalendarDate,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import type { FieldAgentJwtPayload, WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { evaluateProjectGeofence, GEOFENCE_CONTEXT_SELECT } from '../../utils/geofenceEvaluation';
import { toCaptureSummary } from '../../utils/serializers';
import { buildApprovalProgress } from '../process/approvalChain';
import {
  buildPinnedAdHocBundle,
  buildVisitFormLibraryBundle,
  getVisitFormSnapshot,
  hashVisitFormSnapshot,
  storeVisitFormSnapshot,
} from '../forms/visitForm.service';
import {
  fieldVisitActor,
  flushVisitPushes,
  isUniqueViolation,
  loadVisitInProject,
  loadVisitProject,
  lockVisit,
  monitoringConfigOf,
  Tx,
  VISIT_INCLUDE,
  VisitPrincipal,
  VisitPushQueue,
  visitLabel,
} from './visitCore';
import { completedUnitIdsFor, recheckInputsForProject } from './visitForms';
import { assertMayReadVisit, serializeVisits, visitDto } from './visits.service';
import { serializeSiteLogEntry, SITE_LOG_INCLUDE } from '../site-log/siteLog.service';
import { startSubmissionApproval, afterAcceptanceCommitted, AcceptanceOutbox } from './visitAcceptance';

/**
 * Redesign R4c: the field API (D-R4.19–D-R4.22, register section 2). Every write is idempotent on a
 * client UUID so the phone's outbox can retry. Web users cannot submit (photos come from the field
 * app, as with inspections).
 */

const SUBMISSION_INCLUDE = {
  captures: { include: { mediaAttachments: true }, orderBy: { capturedAtDevice: 'asc' } },
  siteLogItems: { include: SITE_LOG_INCLUDE, orderBy: { capturedAtDevice: 'asc' } },
} satisfies Prisma.VisitSubmissionInclude;
type SubmissionRow = Prisma.VisitSubmissionGetPayload<{ include: typeof SUBMISSION_INCLUDE }>;

function requireSubmitter(f: FieldAgentJwtPayload) {
  if (!f.permissions.includes('visits:submit')) throw new AppError('Access requires permission(s): visits:submit', 403, 'FORBIDDEN_PERMISSION');
}

function evaluateGeotag(input: SubmissionGeotagInput | null | undefined, project: Parameters<typeof evaluateProjectGeofence>[0]): SubmissionGeotag | null {
  if (!input) return null;
  const e = evaluateProjectGeofence(project, input);
  return {
    latitude: input.latitude,
    longitude: input.longitude,
    accuracyMeters: input.accuracyMeters ?? null,
    altitudeMeters: input.altitudeMeters ?? null,
    isMocked: input.isMocked,
    capturedAt: input.capturedAt,
    isWithinGeofence: e.isWithinGeofence,
    geofenceStatus: e.geofenceStatus,
    distanceOutsideMeters: e.distanceOutsideMeters,
    distanceFromSiteMeters: e.distanceFromSiteMeters,
  };
}

// ---------------------------------------------------------------------------
// Serialising submissions
// ---------------------------------------------------------------------------

async function approvalFor(s: SubmissionRow, viewer: WebJwtPayload | null): Promise<ApprovalProgressDto | null> {
  if (s.approvalChainVersion === null) return null;
  return buildApprovalProgress(prisma, {
    projectId: s.projectId,
    chainType: 'REPORT',
    version: s.approvalChainVersion,
    subjectType: 'VISIT_SUBMISSION',
    subjectId: s.id,
    currentStepOrder: s.status === 'PENDING_APPROVAL' ? s.currentApprovalStep : s.status === 'APPROVED' ? null : 0,
    amount: null,
    viewer,
    excludedUserId: s.submittedByUserId,
    excludedReason: 'You carried out this visit, so someone else must review it.',
  });
}

export async function serializeSubmission(s: SubmissionRow, viewer: WebJwtPayload | null): Promise<VisitSubmissionDto> {
  const answers = (Array.isArray(s.answersJson) ? s.answersJson : []) as VisitFormAnswer[];
  const byCapture = new Map(s.captures.map((c) => [c.clientCaptureId, c]));
  const findings = await prisma.inspectionFinding.findMany({ where: { visitSubmissionId: s.id }, select: { id: true } });
  const photoGaps = (Array.isArray(s.integrityFlags) ? s.integrityFlags : []) as VisitSubmissionDto['photoGaps'];
  return {
    id: s.id,
    clientSubmissionId: s.clientSubmissionId,
    visitId: s.visitId,
    projectId: s.projectId,
    revisionNumber: s.revisionNumber,
    status: s.status,
    reporterName: s.reporterName,
    reporterRoleName: s.reporterRoleName,
    submittedByUserId: s.submittedByUserId,
    formSnapshotId: s.formSnapshotId,
    formHash: s.formHash,
    answers: answers.map(
      (a): VisitAnswerDto => ({
        path: a.path,
        value: a.value ?? null,
        comment: a.comment ?? null,
        captures: (a.captures ?? [])
          .map((ref) => {
            const c = byCapture.get(ref.clientCaptureId);
            return c ? { ...toCaptureSummary(c as Parameters<typeof toCaptureSummary>[0]), unitId: ref.unitId ?? null } : null;
          })
          .filter((c): c is NonNullable<typeof c> => c !== null),
      })
    ),
    overallFinding: s.overallFinding,
    summaryText: s.summaryText,
    submissionGeotag: (s.submissionGeotag as SubmissionGeotag | null) ?? null,
    geofenceStatus: s.geofenceStatus,
    photoGaps,
    isLate: s.isLate,
    confirmedAt: s.confirmedAt.toISOString(),
    receivedAt: s.receivedAt.toISOString(),
    approvedAt: s.approvedAt?.toISOString() ?? null,
    returnedAt: s.returnedAt?.toISOString() ?? null,
    returnedNotes: s.returnedNotes,
    approval: await approvalFor(s, viewer),
    siteLog: s.siteLogItems.map(serializeSiteLogEntry),
    findingIds: findings.map((f) => f.id),
  };
}

export async function listVisitSubmissions(visitId: string, viewer: WebJwtPayload | null): Promise<VisitSubmissionDto[]> {
  const rows = await prisma.visitSubmission.findMany({ where: { visitId }, include: SUBMISSION_INCLUDE, orderBy: { revisionNumber: 'desc' } });
  return Promise.all(rows.map((r) => serializeSubmission(r, viewer)));
}

export async function getSubmissionDto(submissionId: string, viewer: WebJwtPayload | null): Promise<VisitSubmissionDto> {
  return serializeSubmission(await prisma.visitSubmission.findUniqueOrThrow({ where: { id: submissionId }, include: SUBMISSION_INCLUDE }), viewer);
}

// ---------------------------------------------------------------------------
// Check-in (D-R4.19)
// ---------------------------------------------------------------------------

/** Records the check-in in the caller's transaction (also used when it rides inside a submission). */
async function recordCheckIn(tx: Tx, visitId: string, f: FieldAgentJwtPayload, input: VisitCheckInRequest, project: Parameters<typeof evaluateProjectGeofence>[0] & { id: string }) {
  const geotag = evaluateGeotag(input.geotag, project);
  const v = await tx.visit.findUniqueOrThrow({ where: { id: visitId } });
  await tx.visit.update({
    where: { id: visitId },
    data: {
      checkInAt: new Date(input.checkedInAt),
      checkInGeotag: (geotag ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
      checkInGeofenceStatus: geotag?.geofenceStatus ?? null,
      checkInByUserId: f.userId,
      clientCheckInId: input.clientCheckInId,
      ...(v.status === 'PLANNED' ? { status: 'IN_PROGRESS' as const } : {}),
    },
  });
  const actor = fieldVisitActor(f);
  const outside = geotag?.geofenceStatus === 'OUTSIDE';
  await recordAuditEvent(tx, {
    projectId: project.id,
    actorType: actor.actorType,
    actorId: actor.actorId,
    actorDisplayName: actor.actorDisplayName,
    action: 'VISIT_CHECKED_IN',
    summaryText: `Checked in for the ${visitLabel(v.visitKind).toLowerCase()} of ${v.plannedDate}${
      geotag ? (outside ? `, ${Math.round(geotag.distanceOutsideMeters ?? 0)} m outside the site boundary` : ', on site') : ', without a location'
    }.`,
    payload: { visitId, clientCheckInId: input.clientCheckInId, geofenceStatus: geotag?.geofenceStatus ?? null, flagged: outside },
  });
}

export async function checkInVisit(projectId: string, visitId: string, f: FieldAgentJwtPayload, input: VisitCheckInRequest): Promise<VisitDto> {
  requireSubmitter(f);
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true, ...GEOFENCE_CONTEXT_SELECT } });
  try {
    await prisma.$transaction(async (tx) => {
      const v = await lockVisit(tx, projectId, visitId);
      if (!v.assignees.some((a) => a.userId === f.userId)) throw new AppError('This visit is not assigned to you', 403, 'VISIT_NOT_ASSIGNED');
      if (v.clientCheckInId === input.clientCheckInId || v.checkInAt) return; // replay, or already checked in
      if (!['PLANNED', 'MISSED'].includes(v.status)) throw new AppError('This visit cannot be checked in to', 409, 'VISIT_CHANGED', { status: v.status });
      await recordCheckIn(tx, visitId, f, input, project);
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const other = await prisma.visit.findUnique({ where: { clientCheckInId: input.clientCheckInId }, select: { id: true } });
    if (other?.id !== visitId) throw new AppError('This check-in ID is already in use', 409, 'CHECK_IN_ID_CONFLICT');
  }
  return visitDto(prisma, projectId, visitId);
}

// ---------------------------------------------------------------------------
// Submission (D-R4.20–D-R4.22)
// ---------------------------------------------------------------------------

interface CaptureLink {
  id: string;
  clientCaptureId: string;
  path: string;
  unitId: string | null;
}

/**
 * The captures the answers name. Each must be registered (else a retryable 409: the phone uploads
 * captures separately), in this project, taken by this officer (any of their devices) and not linked
 * to anything else.
 */
async function loadAnswerCaptures(projectId: string, userId: string, answers: SubmitVisitRequest['answers']): Promise<{ links: CaptureLink[]; facts: CaptureFact[] }> {
  const wanted = answers.flatMap((a) => a.captures.map((c) => ({ clientCaptureId: c.clientCaptureId, path: a.path, unitId: c.unitId ?? null })));
  const ids = [...new Set(wanted.map((w) => w.clientCaptureId))];
  if (ids.length !== wanted.length) throw new AppError('A capture is attached to two answers', 400, 'CAPTURE_DUPLICATED');
  if (ids.length === 0) return { links: [], facts: [] };
  const rows = await prisma.fieldEvidenceLog.findMany({
    where: { clientCaptureId: { in: ids } },
    select: {
      id: true,
      clientCaptureId: true,
      projectId: true,
      locationAvailable: true,
      geofenceStatus: true,
      visitSubmissionId: true,
      fieldSession: { select: { userId: true } },
      siteLogEntry: { select: { id: true } },
    },
  });
  const found = new Map(rows.map((r) => [r.clientCaptureId, r]));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) throw new AppError('Some captures are not registered yet', 409, 'CAPTURES_NOT_REGISTERED', { missingClientCaptureIds: missing });
  for (const c of rows) {
    if (c.projectId !== projectId) throw new AppError('A photo belongs to another project', 403, 'CAPTURE_OTHER_PROJECT');
    if (c.fieldSession.userId !== userId) throw new AppError('A capture was taken by someone else', 403, 'CAPTURE_NOT_OWNED');
    if (c.visitSubmissionId || c.siteLogEntry) {
      throw new AppError('A capture is already linked to another report', 409, 'CAPTURE_ALREADY_LINKED', { clientCaptureId: c.clientCaptureId });
    }
  }
  return {
    links: wanted.map((w) => ({ ...w, id: found.get(w.clientCaptureId)!.id })),
    facts: rows.map((c) => ({
      clientCaptureId: c.clientCaptureId,
      geotagged: c.locationAvailable,
      insideBoundary: c.geofenceStatus === null ? null : c.geofenceStatus !== 'OUTSIDE',
    })),
  };
}

async function replaySubmission(clientSubmissionId: string, f: FieldAgentJwtPayload): Promise<VisitSubmissionDto | null> {
  const existing = await prisma.visitSubmission.findUnique({ where: { clientSubmissionId }, include: SUBMISSION_INCLUDE });
  if (!existing) return null;
  if (existing.submittedByUserId !== f.userId) throw new AppError('This submission ID is already in use', 409, 'SUBMISSION_ID_CONFLICT');
  return serializeSubmission(existing, null);
}

/** The snapshot the phone answered: the visit's own, or an older one that differs only in re-checks. */
async function snapshotAnswered(visit: { id: string; formSnapshotId: string | null; formHash: string | null; projectId: string; visitKind: string; plannedDate: string }, input: SubmitVisitRequest) {
  if (!visit.formSnapshotId) throw new AppError('This visit has no form yet', 409, 'VISIT_CHANGED');
  const stale = () =>
    new AppError('The visit form changed since it was downloaded. Download it again and resubmit.', 409, 'FORM_SNAPSHOT_STALE', {
      formSnapshotId: visit.formSnapshotId,
      formHash: visit.formHash,
    });
  const current = await getVisitFormSnapshot(prisma, visit.formSnapshotId);
  if (input.formSnapshotId === visit.formSnapshotId) {
    if (input.formHash !== current.contentSha256) throw stale();
    return current;
  }
  const older = await prisma.visitFormSnapshot.findUnique({ where: { id: input.formSnapshotId }, select: { id: true, projectId: true } });
  if (!older || older.projectId !== visit.projectId) throw stale();
  const parsed = await getVisitFormSnapshot(prisma, older.id);
  if (parsed.contentSha256 !== input.formHash) throw stale();
  const ctx = parsed.snapshot.context;
  if (ctx.visitKind !== visit.visitKind || ctx.visitDate !== visit.plannedDate || !sameFormApartFromRechecks(parsed.snapshot, current.snapshot)) throw stale();
  return parsed;
}

const SUBMITTABLE = ['PLANNED', 'IN_PROGRESS', 'RETURNED', 'MISSED'];

export async function submitVisit(params: {
  projectId: string;
  visitId: string;
  fieldAgent: FieldAgentJwtPayload;
  input: SubmitVisitRequest;
}): Promise<{ submission: VisitSubmissionDto; created: boolean }> {
  const { projectId, visitId, fieldAgent: f, input } = params;
  requireSubmitter(f);
  const earlier = await replaySubmission(input.clientSubmissionId, f);
  if (earlier) {
    if (earlier.visitId !== visitId) throw new AppError('This submission ID is already in use', 409, 'SUBMISSION_ID_CONFLICT');
    return { submission: earlier, created: false };
  }

  const visit = await loadVisitInProject(prisma, projectId, visitId);
  if (!visit.assignees.some((a) => a.userId === f.userId)) throw new AppError('This visit is not assigned to you', 403, 'VISIT_NOT_ASSIGNED');
  if (visit.status === 'SUBMITTED' || visit.status === 'APPROVED') throw new AppError('This visit has already been submitted', 409, 'VISIT_ALREADY_SUBMITTED');
  if (!SUBMITTABLE.includes(visit.status)) throw new AppError('This visit is not open for submission', 409, 'VISIT_CHANGED', { status: visit.status });

  const answered = await snapshotAnswered(visit, input);
  const { links, facts } = await loadAnswerCaptures(projectId, f.userId, input.answers);
  const check = validateVisitAnswers(answered.snapshot, input.answers, facts);
  if (!check.valid) throw new AppError('Some answers are missing or invalid', 422, 'INVALID_VISIT_ANSWERS', { errors: check.errors });

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { id: true, tenantId: true, timezone: true, codePrefix: true, projectTypeSnapshotJson: true, ...GEOFENCE_CONTEXT_SELECT },
  });
  const confirmedAt = new Date(input.confirmedAt);
  if (confirmedAt.getTime() - Date.now() > 15 * 60 * 1000) throw new AppError('The submission is dated in the future. Check the phone clock.', 400, 'CONFIRMED_AT_IN_FUTURE');
  const confirmedDay = calendarDateInTimeZone(confirmedAt, project.timezone);
  const deadline = visit.submissionDeadline ?? submissionDeadlineFor(visit.plannedDate, monitoringConfigOf(project.projectTypeSnapshotJson).submissionDeadlineDays);
  const isLate = confirmedDay > deadline;
  const geotag = evaluateGeotag(input.submissionGeotag, project);

  const siteLogIds = [...new Set(input.siteLogEntryIds)];
  if (siteLogIds.length) {
    const entries = await prisma.siteLogEntry.findMany({ where: { id: { in: siteLogIds } }, include: { attachedSubmission: { select: { visitId: true, status: true } } } });
    if (entries.length !== siteLogIds.length) throw new AppError('Some site log entries have not reached the server yet', 409, 'SITE_LOG_NOT_REGISTERED');
    for (const e of entries) {
      if (e.projectId !== projectId) throw new AppError('A site log entry belongs to another project', 403, 'SITE_LOG_OTHER_PROJECT');
      if (e.authorUserId !== f.userId) throw new AppError('A site log entry was written by someone else', 403, 'SITE_LOG_NOT_OWNED');
      if (e.attachedSubmission && !(e.attachedSubmission.visitId === visitId && e.attachedSubmission.status === 'RETURNED')) {
        throw new AppError('A site log entry is attached to another submission', 409, 'SITE_LOG_ALREADY_ATTACHED');
      }
    }
  }

  const pushes: VisitPushQueue = [];
  const outbox: AcceptanceOutbox = { emails: [], refreshProjects: new Set() };
  let createdId: string;
  try {
    createdId = await prisma.$transaction(async (tx) => {
      const v = await lockVisit(tx, projectId, visitId);
      if (v.status === 'SUBMITTED' || v.status === 'APPROVED') throw new AppError('This visit has already been submitted', 409, 'VISIT_ALREADY_SUBMITTED');
      if (!SUBMITTABLE.includes(v.status)) throw new AppError('This visit is not open for submission', 409, 'VISIT_CHANGED', { status: v.status });
      if (input.checkIn && !v.checkInAt) await recordCheckIn(tx, visitId, f, input.checkIn, project);
      const revisionNumber = (await tx.visitSubmission.count({ where: { visitId } })) + 1;
      const submission = await tx.visitSubmission.create({
        data: {
          clientSubmissionId: input.clientSubmissionId,
          visitId,
          projectId,
          revisionNumber,
          submittedByUserId: f.userId,
          fieldSessionId: f.sessionId,
          reporterName: f.agentFullName,
          reporterRoleName: f.roleName,
          formSnapshotId: answered.id,
          formHash: answered.contentSha256,
          answersJson: input.answers as unknown as Prisma.InputJsonValue,
          overallFinding: input.overallFinding,
          summaryText: input.summaryText,
          submissionGeotag: (geotag ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
          geofenceStatus: geotag?.geofenceStatus ?? null,
          integrityFlags: check.photoGaps as unknown as Prisma.InputJsonValue,
          confirmedAt,
          isLate,
          status: 'PENDING_APPROVAL',
        },
      });
      for (const c of links) {
        const linked = await tx.fieldEvidenceLog.updateMany({
          where: { id: c.id, visitSubmissionId: null },
          data: { visitSubmissionId: submission.id, visitAnswerPath: c.path, facilityUnitId: c.unitId },
        });
        if (linked.count !== 1) throw new AppError('A capture is already linked to another report', 409, 'CAPTURE_ALREADY_LINKED');
      }
      if (siteLogIds.length) {
        await tx.siteLogEntry.updateMany({ where: { id: { in: siteLogIds } }, data: { attachedSubmissionId: submission.id } });
        const withCaptures = await tx.siteLogEntry.findMany({ where: { id: { in: siteLogIds }, captureId: { not: null } }, select: { captureId: true } });
        await tx.fieldEvidenceLog.updateMany({ where: { id: { in: withCaptures.map((e) => e.captureId!) } }, data: { visitSubmissionId: submission.id } });
      }
      await tx.visit.update({ where: { id: visitId }, data: { status: 'SUBMITTED' } });
      const actor = fieldVisitActor(f);
      await recordAuditEvent(tx, {
        projectId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        actorDisplayName: actor.actorDisplayName,
        action: 'VISIT_SUBMITTED',
        summaryText: `Submitted the ${visitLabel(v.visitKind).toLowerCase()} of ${v.plannedDate} (revision ${revisionNumber}): ${input.overallFinding
          .replace('_', ' ')
          .toLowerCase()}, ${links.length} capture(s), ${check.findingsToRaise.length} finding(s) to raise${isLate ? `; late (deadline ${deadline})` : ''}${
          check.photoGaps.length ? `; ${check.photoGaps.length} photo gap(s)` : ''
        }.`,
        payload: {
          visitId,
          visitSubmissionId: submission.id,
          clientSubmissionId: input.clientSubmissionId,
          formSnapshotId: answered.id,
          isLate,
          missedBefore: Boolean(v.missedAt),
          photoGaps: check.photoGaps.length,
        },
      });
      await startSubmissionApproval(tx, submission.id, { pushes, outbox });
      return submission.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const again = await replaySubmission(input.clientSubmissionId, f);
      if (again) return { submission: again, created: false };
      throw new AppError('This visit has already been submitted', 409, 'VISIT_ALREADY_SUBMITTED');
    }
    throw error;
  }
  await flushVisitPushes(pushes);
  await afterAcceptanceCommitted(outbox);
  return { submission: await getSubmissionDto(createdId, null), created: true };
}

// ---------------------------------------------------------------------------
// Unscheduled (Ad hoc) visits from the field (D-R4.9, register section 2)
// ---------------------------------------------------------------------------

export async function createUnscheduledVisit(projectId: string, f: FieldAgentJwtPayload, input: CreateUnscheduledVisitRequest): Promise<{ visit: VisitDto; created: boolean }> {
  requireSubmitter(f);
  const existing = await prisma.visit.findUnique({ where: { clientVisitId: input.clientVisitId }, include: VISIT_INCLUDE });
  if (existing) {
    if (existing.projectId !== projectId || existing.createdByUserId !== f.userId) throw new AppError('This visit ID is already in use', 409, 'VISIT_ID_CONFLICT');
    return { visit: (await serializeVisits(prisma, [existing]))[0], created: false };
  }
  const project = await loadVisitProject(prisma, projectId);
  const today = zonedCalendarDate(new Date(), project.timezone);
  if (input.plannedDate > addDays(today, 1)) throw new AppError('An unscheduled visit is recorded on the day it happens', 422, 'VISIT_DATE_IN_FUTURE');

  // Re-assemble with the same inputs the phone used and compare hashes.
  const bundle = await buildPinnedAdHocBundle(prisma, projectId, input.components);
  const inScope = new Set(bundle.units.map((u) => u.facilityId));
  const outside = input.pickedFacilityIds.filter((id) => !inScope.has(id));
  if (outside.length) throw new AppError('Pick facilities that have units on this project', 422, 'FACILITY_NOT_IN_SCOPE', { facilityIds: outside });
  const allRechecks = await prisma.$transaction((tx) => recheckInputsForProjectAnyStatus(tx, projectId, project.timezone, input.recheckIds));
  if (allRechecks.length !== new Set(input.recheckIds).size) throw new AppError('A re-check item is not a finding of this project', 409, 'FORM_SNAPSHOT_STALE');
  const builtAt = new Date();
  let snapshot;
  try {
    ({ snapshot } = assembleVisitForm(
      assemblyInputFromBundle(bundle, {
        visitKind: 'AD_HOC',
        visitDate: input.plannedDate,
        builtAt: builtAt.toISOString(),
        pickedFacilityIds: input.pickedFacilityIds,
        rechecks: allRechecks,
      })
    ));
  } catch (error) {
    if (error instanceof VisitFormAssemblyError) throw new AppError(error.message, 422, error.code);
    throw error;
  }
  const serverHash = hashVisitFormSnapshot(snapshot);
  if (serverHash !== input.formHash) {
    throw new AppError('The Ad hoc form the phone built does not match the server. Refresh the field pack and start again.', 409, 'FORM_SNAPSHOT_STALE', {
      formHash: serverHash,
    });
  }
  const config = monitoringConfigOf(project.projectTypeSnapshotJson);
  try {
    const id = await prisma.$transaction(async (tx) => {
      const stored = await storeVisitFormSnapshot(tx, { tenantId: project.tenantId, projectId, snapshot, builtAt, builtByUserId: f.userId });
      const sprints = await tx.projectSprint.findMany({ where: { projectId }, select: { id: true, startDate: true, endDate: true } });
      const v = await tx.visit.create({
        data: {
          projectId,
          visitKind: 'AD_HOC',
          status: 'PLANNED',
          origin: 'UNSCHEDULED',
          originalPlannedDate: input.plannedDate,
          plannedDate: input.plannedDate,
          sprintId: sprintForDate(sprints, input.plannedDate)?.id ?? null,
          confirmation: 'CONFIRMED',
          confirmedAt: builtAt,
          formSnapshotId: stored.id,
          formHash: stored.contentSha256,
          formAssembledAt: builtAt,
          pickedFacilityIds: input.pickedFacilityIds,
          submissionDeadline: submissionDeadlineFor(input.plannedDate, config.submissionDeadlineDays),
          publishedAt: builtAt,
          publishedByUserId: f.userId,
          createdByUserId: f.userId,
          clientVisitId: input.clientVisitId,
          assignees: { create: [{ userId: f.userId, isLead: true }] },
        },
      });
      const actor = fieldVisitActor(f);
      await recordAuditEvent(tx, {
        projectId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        actorDisplayName: actor.actorDisplayName,
        action: 'VISIT_CREATED',
        summaryText: `Started an unscheduled ad hoc visit on ${input.plannedDate} (${input.pickedFacilityIds.length} facilit${input.pickedFacilityIds.length === 1 ? 'y' : 'ies'}).`,
        payload: { visitId: v.id, clientVisitId: input.clientVisitId, origin: 'UNSCHEDULED', formSnapshotId: stored.id },
      });
      return v.id;
    });
    return { visit: await visitDto(prisma, projectId, id), created: true };
  } catch (error) {
    if (isUniqueViolation(error)) return createUnscheduledVisit(projectId, f, input);
    throw error;
  }
}

/** Findings by id (any status) as re-check items, in the order given. */
async function recheckInputsForProjectAnyStatus(tx: Tx, projectId: string, timezone: string, ids: string[]) {
  if (ids.length === 0) return [];
  const open = await recheckInputsForProject(tx, projectId, timezone);
  const byId = new Map(open.map((r) => [r.id, r]));
  // A finding closed since the phone built its form still re-checks the way it was built.
  const closed = ids.filter((id) => !byId.has(id));
  if (closed.length) {
    const rows = await tx.inspectionFinding.findMany({ where: { id: { in: closed }, projectId } });
    for (const f of rows) {
      const text = f.description.trim();
      byId.set(f.id, {
        id: f.id,
        kind: 'FINDING',
        title: (f.title ?? text).slice(0, 300) || 'Open finding',
        description: f.title ? text.slice(0, 2000) : null,
        severity: f.severity,
        raisedDate: zonedCalendarDate(f.createdAt, timezone),
        facilityId: f.facilityId,
        unitId: f.facilityUnitId,
      });
    }
  }
  return ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
}

// ---------------------------------------------------------------------------
// Reads for the phone: form, field pack, feed
// ---------------------------------------------------------------------------

export async function getVisitForm(projectId: string, visitId: string, principal: VisitPrincipal): Promise<VisitFormDto> {
  const visit = await loadVisitInProject(prisma, projectId, visitId);
  assertMayReadVisit(visit, principal);
  if (!visit.formSnapshotId) throw new AppError('This visit is not published yet', 404, 'VISIT_FORM_NOT_READY');
  const [snap, project] = await Promise.all([
    getVisitFormSnapshot(prisma, visit.formSnapshotId),
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { geofenceGeoJson: true, geofenceToleranceMeters: true, tenant: { select: { defaultGeofenceToleranceMeters: true } } } }),
  ]);
  const geofence = ProjectGeofenceSchema.safeParse(project.geofenceGeoJson);
  return {
    visitId,
    formSnapshotId: snap.id,
    formHash: snap.contentSha256,
    snapshot: snap.snapshot,
    geofence: geofence.success ? geofence.data : null,
    geofenceToleranceMeters: project.geofenceToleranceMeters ?? project.tenant.defaultGeofenceToleranceMeters,
  };
}

export async function getVisitFieldPack(projectId: string): Promise<VisitFieldPackDto> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { timezone: true, geofenceGeoJson: true } });
  const result = await prisma.$transaction(async (tx) => {
    const bundle = await buildVisitFormLibraryBundle(tx, projectId);
    const completed = await completedUnitIdsFor(tx, projectId);
    return { bundle: completed ? { ...bundle, completedUnitIds: completed.sort() } : bundle, rechecks: await recheckInputsForProject(tx, projectId, project.timezone) };
  });
  const geofence = ProjectGeofenceSchema.safeParse(project.geofenceGeoJson);
  return { projectId, ...result, geofence: geofence.success ? geofence.data : null, generatedAt: new Date().toISOString() };
}

/**
 * The officer's visits across projects (register section 2): default 7 days back to 14 ahead, plus
 * every visit still owed (overdue, returned, missed) and every visit with a pending proposal.
 */
export async function getMyVisits(userId: string, tenantId: string, q: { from?: string; to?: string }, now: Date = new Date()): Promise<MyVisitsFeedDto> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true, visitRescheduleToleranceWorkdays: true } });
  const today = zonedCalendarDate(now, tenant.timezone);
  const from = q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? q.from : addDays(today, -7);
  const to = q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to) && q.to >= from ? q.to : addDays(today, 14);
  const mine = { assignees: { some: { userId } }, project: { tenantId, status: 'ACTIVE' as const } };
  const rows = await prisma.visit.findMany({
    where: {
      ...mine,
      status: { not: 'PROPOSED' },
      OR: [
        { plannedDate: { gte: from, lte: to } },
        { status: { in: ['PLANNED', 'IN_PROGRESS', 'RETURNED', 'MISSED'] }, plannedDate: { lt: from } },
        { dateChanges: { some: { status: 'PENDING' } } },
      ],
    },
    include: { ...VISIT_INCLUDE, project: { select: { codePrefix: true, name: true, workWeekDays: true } } },
    orderBy: [{ plannedDate: 'asc' }, { createdAt: 'asc' }],
    take: 500,
  });
  const projectIds = [...new Set(rows.map((r) => r.projectId))];
  const [visits, projects, sprints, findings, nextVisits] = await Promise.all([
    serializeVisits(prisma, rows),
    prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, codePrefix: true, name: true, constructionPhase: true, timezone: true } }),
    prisma.projectSprint.findMany({ where: { projectId: { in: projectIds } }, select: { projectId: true, number: true, name: true, startDate: true, endDate: true } }),
    prisma.inspectionFinding.groupBy({ by: ['projectId'], where: { projectId: { in: projectIds }, status: 'OPEN' }, _count: { _all: true } }),
    prisma.visit.findMany({
      where: { ...mine, projectId: { in: projectIds }, status: 'PLANNED', plannedDate: { gte: today } },
      select: { projectId: true, plannedDate: true },
      orderBy: { plannedDate: 'asc' },
    }),
  ]);
  const findingCount = new Map(findings.map((f) => [f.projectId, f._count._all]));
  return {
    from,
    to,
    toleranceWorkdays: tenant.visitRescheduleToleranceWorkdays,
    items: rows.map((r, i) => ({
      visit: visits[i],
      moveWindow:
        r.status === 'PLANNED' && !r.checkInAt
          ? rescheduleWindow(
              r.originalPlannedDate,
              tenant.visitRescheduleToleranceWorkdays,
              r.project.workWeekDays,
              sprints.filter((s) => s.projectId === r.projectId)
            )
          : null,
    })),
    projects: projects.map((p) => {
      const own = sprints.filter((s) => s.projectId === p.id);
      const current = sprintForDate(own, zonedCalendarDate(now, p.timezone));
      return {
        projectId: p.id,
        code: p.codePrefix,
        name: p.name,
        constructionPhase: p.constructionPhase,
        currentSprint: current ? { number: current.number, name: current.name, endDate: current.endDate } : null,
        openFindings: findingCount.get(p.id) ?? 0,
        nextVisitDate: nextVisits.find((n) => n.projectId === p.id)?.plannedDate ?? null,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export async function addVisitComment(projectId: string, visitId: string, principal: VisitPrincipal, text: string) {
  const visit = await loadVisitInProject(prisma, projectId, visitId);
  assertMayReadVisit(visit, principal);
  const author = principal.webUser
    ? { userId: principal.webUser.userId, name: principal.webUser.fullName }
    : { userId: principal.fieldAgent.userId, name: principal.fieldAgent.agentFullName };
  const latest = await prisma.visitSubmission.findFirst({ where: { visitId }, orderBy: { revisionNumber: 'desc' }, select: { id: true } });
  const c = await prisma.visitComment.create({ data: { visitId, submissionId: latest?.id ?? null, authorUserId: author.userId, authorName: author.name, text } });
  return { id: c.id, submissionId: c.submissionId, authorName: c.authorName, text: c.text, createdAt: c.createdAt.toISOString() };
}

export type { VisitSubmissionStatus };
