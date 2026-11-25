import { Prisma } from '@prisma/client';
import {
  AssignDefectTicketRequest,
  ConvertSnagsRequest,
  CreateDefectTicketRequest,
  DefectCaptureDto,
  DefectTicketDto,
  OPEN_DEFECT_STATUSES,
  RejectDefectTicketRequest,
  sanitizeHandoverLine,
  sanitizeHandoverText,
  VerifyDefectTicketRequest,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { FieldAgentJwtPayload, hasWebPermission, WebJwtPayload } from '../../middleware/auth.middleware';
import { sendPushToFieldSession } from '../../integrations/push.service';
import { recordAuditEvent } from '../audit/audit.service';
import { createMobileNotification, createWebNotification } from '../notifications/notifications.service';
import { assertModuleOn, projectToday } from './closeoutGate';

/**
 * Defect tickets for the defects liability period (Phase 10 Step 6), staff-only since redesign R1c/R1d
 * (decision P2: the contractor has no login). Staff with defects:manage raise tickets
 * against the project's contractor (one per project, decision T), mark them as passed to the
 * contractor (outside the platform), close them with an officer's site photos (from the field app),
 * reopen a ticket awaiting verification, or reject one as not a defect. Photos are Phase 4 captures,
 * linked by their clientCaptureId.
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

const MANAGE = 'defects:manage';

/** Who is acting on a defect: a staff web user or an officer's field session. */
export interface DefectViewer {
  label: string;
  userId: string | null;
  canAct: boolean;
  channel: 'web' | 'field';
}

export function defectViewerFor(principal: { webUser?: WebJwtPayload; fieldAgent?: FieldAgentJwtPayload }): DefectViewer {
  if (principal.webUser) {
    const u = principal.webUser;
    return { label: `${u.fullName} (${u.roleName})`, userId: u.userId, canAct: hasWebPermission(u, MANAGE), channel: 'web' };
  }
  const f = principal.fieldAgent!;
  return { label: `${f.agentFullName} (${f.roleName}, field)`, userId: f.userId, canAct: f.permissions.includes(MANAGE), channel: 'field' };
}

/**
 * The liable contractor: the project's contractor (one per project, decision T). On a project that
 * still has several from before R1d, the earliest one still under contract.
 */
export async function liableContractorId(db: Db, projectId: string): Promise<string> {
  const contractor = await db.projectContractor.findFirst({
    where: { projectId },
    orderBy: [{ contractStatus: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  if (!contractor) throw new AppError('This project has no contractor', 409, 'NO_CONTRACTOR');
  return contractor.id;
}

async function assertDefectPhase(db: Db, projectId: string) {
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { constructionPhase: true } });
  if (project.constructionPhase !== 'HANDOVER_IN_PROGRESS' && project.constructionPhase !== 'RETENTION_PERIOD') {
    throw new AppError('Defect tickets are raised during handover and the defects liability period.', 409, 'PROJECT_PHASE_NOT_DEFECTS');
  }
}

async function nextTicketNumber(tx: Tx, projectId: string): Promise<number> {
  await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId}::uuid FOR UPDATE`;
  const last = await tx.retentionDefectTicket.aggregate({ where: { projectId }, _max: { ticketNumber: true } });
  return (last._max.ticketNumber ?? 0) + 1;
}

const reference = (n: number) => `DEF-${String(n).padStart(3, '0')}`;

async function assertCapturesInProject(db: Db, projectId: string, captureIds: string[]) {
  if (captureIds.length === 0) return;
  const unique = [...new Set(captureIds)];
  const found = await db.fieldEvidenceLog.count({ where: { projectId, clientCaptureId: { in: unique } } });
  if (found !== unique.length) {
    throw new AppError('Some photos have not reached the server yet, or belong to another project', 422, 'CAPTURES_NOT_FOUND');
  }
}

// ---------------------------------------------------------------------------
// Aimed notifications
// ---------------------------------------------------------------------------

/** Pushes are sent after the transaction commits, never from inside it. */
export type PushQueue = Array<{ sessionId: string; title: string; body: string; defectTicketId: string }>;

export async function flushDefectPushes(pushes: PushQueue) {
  for (const p of pushes) {
    await sendPushToFieldSession(p.sessionId, {
      title: p.title,
      body: p.body,
      data: { actionType: 'OPEN_DEFECTS', defectTicketId: p.defectTicketId },
    }).catch((error) => console.warn('[defects] push failed:', error));
  }
}

/** Field sessions whose role may verify defects. */
async function verifierSessionIds(db: Db, projectId: string): Promise<string[]> {
  const sessions = await db.fieldAgentSession.findMany({
    where: {
      projectId,
      isActive: true,
      role: { rolePermissions: { some: { permission: { key: MANAGE } } } },
    },
    select: { id: true },
  });
  return sessions.map((s) => s.id);
}

async function notifySessions(tx: Tx, pushes: PushQueue, projectId: string, sessionIds: string[], title: string, body: string, ticketId: string) {
  for (const sessionId of sessionIds) {
    await createMobileNotification(tx, {
      projectId,
      fieldSessionId: sessionId,
      type: 'DEFECT_UPDATE',
      actionType: 'OPEN_DEFECTS',
      title,
      message: body,
      metadata: { defectTicketId: ticketId },
    });
    pushes.push({ sessionId, title, body, defectTicketId: ticketId });
  }
}

/** Staff with defects:manage; optionally the verifiers' devices too. */
async function notifyMonitors(
  tx: Tx,
  pushes: PushQueue,
  params: { projectId: string; ticketId: string; title: string; description: string; toVerifierDevices: boolean }
) {
  await createWebNotification(tx, {
    projectId: params.projectId,
    targetPermissionKey: MANAGE,
    category: 'DEFECT_TICKET',
    title: params.title,
    description: params.description,
    actionUrl: `/app/projects/${params.projectId}/completion?tab=defects&ticket=${params.ticketId}`,
    metadata: { defectTicketId: params.ticketId },
  });
  if (params.toVerifierDevices) {
    const sessions = await verifierSessionIds(tx, params.projectId);
    await notifySessions(tx, pushes, params.projectId, sessions, params.title, params.description, params.ticketId);
  }
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

const TICKET_INCLUDE = {
  projectContractor: { select: { organization: { select: { name: true } } } },
} satisfies Prisma.RetentionDefectTicketInclude;
type TicketRow = Prisma.RetentionDefectTicketGetPayload<{ include: typeof TICKET_INCLUDE }>;

const ids = (v: Prisma.JsonValue): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

async function serializeTickets(
  db: Db,
  rows: TicketRow[],
  viewer: DefectViewer,
  today: string
): Promise<DefectTicketDto[]> {
  const captureIds = rows.flatMap((r) => ids(r.verificationCaptureIds));
  const [captures, items, users] = await Promise.all([
    captureIds.length
      ? db.fieldEvidenceLog.findMany({
          where: { clientCaptureId: { in: captureIds } },
          select: {
            clientCaptureId: true,
            capturedAtDevice: true,
            integrityPassed: true,
            isWithinGeofence: true,
            mediaAttachments: { select: { objectKey: true }, take: 1, orderBy: { createdAt: 'asc' } },
          },
        })
      : Promise.resolve([]),
    db.boqItem.findMany({
      where: { id: { in: rows.map((r) => r.boqItemId).filter((v): v is string => Boolean(v)) } },
      select: { id: true, wbsCode: true, description: true },
    }),
    db.user.findMany({
      where: { id: { in: rows.flatMap((r) => [r.raisedByUserId, r.verifiedByUserId]).filter((v): v is string => Boolean(v)) } },
      select: { id: true, fullName: true },
    }),
  ]);
  const captureById = new Map(captures.map((c) => [c.clientCaptureId, c]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const nameById = new Map(users.map((u) => [u.id, u.fullName]));
  const toCaptures = (list: string[]): DefectCaptureDto[] =>
    list.map((id) => {
      const c = captureById.get(id);
      return {
        clientCaptureId: id,
        objectKey: c?.mediaAttachments[0]?.objectKey ?? null,
        capturedAt: c?.capturedAtDevice.toISOString() ?? null,
        integrityPassed: c ? c.integrityPassed : null,
        isWithinGeofence: c ? c.isWithinGeofence : null,
      };
    });

  return rows.map((t) => {
    const open = OPEN_DEFECT_STATUSES.includes(t.status);
    const staff = viewer.canAct;
    const gate = (checks: Array<[boolean, string]>) => {
      const failed = checks.find(([ok]) => !ok);
      return { allowed: !failed, reason: failed ? failed[1] : null };
    };
    const awaiting = t.status === 'RECTIFIED_PENDING_VERIFICATION';
    const openOrAssigned = t.status === 'OPEN' || t.status === 'ASSIGNED';
    const item = t.boqItemId ? itemById.get(t.boqItemId) : null;
    return {
      id: t.id,
      projectId: t.projectId,
      reference: reference(t.ticketNumber),
      title: t.title,
      description: t.description,
      severity: t.severity,
      status: t.status,
      location: t.location,
      dueDate: t.dueDate,
      isOverdue: Boolean(t.dueDate && open && !awaiting && t.dueDate < today),
      projectContractorId: t.projectContractorId,
      contractorName: t.projectContractor.organization.name,
      boqItemId: t.boqItemId,
      boqItemLabel: item ? `${item.wbsCode} ${item.description}` : null,
      sourceHandoverSubmissionId: t.sourceHandoverSubmissionId,
      raisedByName: nameById.get(t.raisedByUserId) ?? null,
      verificationNotes: t.verificationNotes,
      verificationCaptures: toCaptures(ids(t.verificationCaptureIds)),
      verifiedByName: t.verifiedByLabel ?? (t.verifiedByUserId ? nameById.get(t.verifiedByUserId) ?? null : null),
      verifiedAt: t.verifiedAt?.toISOString() ?? null,
      resolutionReason: t.resolutionReason,
      reopenCount: t.reopenCount,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      actions: {
        assign: gate([
          [staff, 'You cannot manage defects on this project.'],
          [openOrAssigned, 'Only an open ticket can be assigned.'],
        ]),
        verify: gate([
          [staff, 'You cannot manage defects on this project.'],
          [awaiting || openOrAssigned, 'Nothing is waiting for verification.'],
          // Closing needs the officer's site photos: that happens in the field app.
          [!(openOrAssigned && viewer.channel === 'web'), 'Close it from the field app with photos of the repair.'],
        ]),
        reject: gate([
          [staff, 'You cannot manage defects on this project.'],
          [openOrAssigned, 'Only an open ticket can be rejected.'],
        ]),
      },
    };
  });
}

async function loadTicket(db: Db, projectId: string, ticketId: string) {
  const ticket = await db.retentionDefectTicket.findFirst({ where: { id: ticketId, projectId }, include: TICKET_INCLUDE });
  if (!ticket) {
    throw new AppError('Defect ticket not found', 404, 'DEFECT_TICKET_NOT_FOUND');
  }
  return ticket;
}

async function todayFor(db: Db, projectId: string) {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { timezone: true } });
  return projectToday(p.timezone);
}

/** GET /projects/:projectId/defects */
export async function listDefectTickets(projectId: string, viewer: DefectViewer): Promise<DefectTicketDto[]> {
  await assertModuleOn(projectId, 'retention');
  const rows = await prisma.retentionDefectTicket.findMany({
    where: { projectId },
    include: TICKET_INCLUDE,
    orderBy: [{ ticketNumber: 'desc' }],
  });
  return serializeTickets(prisma, rows, viewer, await todayFor(prisma, projectId));
}

export async function getDefectTicket(projectId: string, ticketId: string, viewer: DefectViewer): Promise<DefectTicketDto> {
  await assertModuleOn(projectId, 'retention');
  const row = await loadTicket(prisma, projectId, ticketId);
  return (await serializeTickets(prisma, [row], viewer, await todayFor(prisma, projectId)))[0];
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

function requireStaff(viewer: DefectViewer) {
  if (!viewer.canAct) {
    throw new AppError(`Access requires permission(s): ${MANAGE}`, 403, 'FORBIDDEN_DEFECT_ACTION');
  }
}

async function audit(tx: Tx, projectId: string, viewer: DefectViewer, action: 'DEFECT_TICKET_RAISED' | 'DEFECT_TICKET_UPDATED' | 'DEFECT_TICKET_CLOSED', summaryText: string, payload: Record<string, unknown>) {
  await recordAuditEvent(tx, {
    projectId,
    actorType: viewer.userId ? 'WEB_USER' : 'FIELD_AGENT',
    actorId: viewer.userId ?? 'field-session',
    actorDisplayName: viewer.label,
    action,
    summaryText,
    payload,
  });
}

/** Creates one ticket inside a transaction (also used for handover snags). */
export async function createTicketInTx(
  tx: Tx,
  pushes: PushQueue,
  params: {
    projectId: string;
    viewer: DefectViewer;
    raisedByUserId: string;
    title: string;
    description: string;
    severity: CreateDefectTicketRequest['severity'];
    projectContractorId: string;
    boqItemId?: string | null;
    location?: string | null;
    dueDate?: string | null;
    assign: boolean;
    source?: { submissionId: string; snagIndex: number };
  }
) {
  const ticketNumber = await nextTicketNumber(tx, params.projectId);
  const ticket = await tx.retentionDefectTicket.create({
    data: {
      projectId: params.projectId,
      ticketNumber,
      projectContractorId: params.projectContractorId,
      boqItemId: params.boqItemId ?? null,
      title: sanitizeHandoverLine(params.title, 160),
      description: sanitizeHandoverText(params.description, 4000) || sanitizeHandoverLine(params.title, 160),
      location: params.location ? sanitizeHandoverLine(params.location, 200) : null,
      severity: params.severity,
      status: params.assign ? 'ASSIGNED' : 'OPEN',
      assignedAt: params.assign ? new Date() : null,
      dueDate: params.dueDate ?? null,
      raisedByUserId: params.raisedByUserId,
      sourceHandoverSubmissionId: params.source?.submissionId ?? null,
      sourceSnagIndex: params.source?.snagIndex ?? null,
    },
    include: TICKET_INCLUDE,
  });
  await audit(
    tx,
    params.projectId,
    params.viewer,
    'DEFECT_TICKET_RAISED',
    `Raised ${reference(ticketNumber)} "${ticket.title}" (${ticket.severity}) against ${ticket.projectContractor.organization.name}` +
      (params.source ? ' from a handover snag.' : '.'),
    {
      defectTicketId: ticket.id,
      reference: reference(ticketNumber),
      projectContractorId: ticket.projectContractorId,
      severity: ticket.severity,
      status: ticket.status,
      sourceHandoverSubmissionId: params.source?.submissionId ?? null,
      sourceSnagIndex: params.source?.snagIndex ?? null,
    }
  );
  return ticket;
}

/** POST /projects/:projectId/defects */
export async function createDefectTicket(projectId: string, viewer: DefectViewer, input: CreateDefectTicketRequest) {
  await assertModuleOn(projectId, 'retention');
  requireStaff(viewer);
  const pushes: PushQueue = [];
  const id = await prisma.$transaction(async (tx) => {
    await assertDefectPhase(tx, projectId);
    const contractorId = await liableContractorId(tx, projectId);
    if (input.boqItemId) {
      const item = await tx.boqItem.findFirst({ where: { id: input.boqItemId, projectId }, select: { id: true } });
      if (!item) throw new AppError('BOQ item not found', 404, 'BOQ_ITEM_NOT_FOUND');
    }
    const ticket = await createTicketInTx(tx, pushes, {
      projectId,
      viewer,
      raisedByUserId: viewer.userId!,
      title: input.title,
      description: input.description,
      severity: input.severity,
      projectContractorId: contractorId,
      boqItemId: input.boqItemId,
      location: input.location,
      dueDate: input.dueDate,
      assign: input.assign,
    });
    return ticket.id;
  });
  await flushDefectPushes(pushes);
  return getDefectTicket(projectId, id, viewer);
}

/** POST /projects/:projectId/defects/:ticketId/assign: the ticket was passed to the contractor (outside the platform). */
export async function assignDefectTicket(projectId: string, ticketId: string, viewer: DefectViewer, input: AssignDefectTicketRequest) {
  await assertModuleOn(projectId, 'retention');
  requireStaff(viewer);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "retention_defect_tickets" WHERE id = ${ticketId}::uuid FOR UPDATE`;
    const ticket = await loadTicket(tx, projectId, ticketId);
    if (ticket.status !== 'OPEN' && ticket.status !== 'ASSIGNED') {
      throw new AppError('Only an open ticket can be assigned', 409, 'DEFECT_TICKET_NOT_OPEN');
    }
    const updated = await tx.retentionDefectTicket.update({
      where: { id: ticket.id },
      data: {
        status: 'ASSIGNED',
        assignedAt: new Date(),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      },
      include: TICKET_INCLUDE,
    });
    await audit(tx, projectId, viewer, 'DEFECT_TICKET_UPDATED', `Passed ${reference(ticket.ticketNumber)} to ${updated.projectContractor.organization.name}.`, {
      defectTicketId: ticket.id,
      from: ticket.status,
      to: 'ASSIGNED',
      projectContractorId: ticket.projectContractorId,
      dueDate: updated.dueDate,
    });
  });
  return getDefectTicket(projectId, ticketId, viewer);
}

/**
 * POST /projects/:projectId/defects/:ticketId/verify: close with the officer's site photos, or reopen
 * a ticket awaiting verification (legacy contractor-reported repairs) with a reason.
 */
export async function verifyDefectTicket(projectId: string, ticketId: string, viewer: DefectViewer, input: VerifyDefectTicketRequest) {
  await assertModuleOn(projectId, 'retention');
  requireStaff(viewer);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "retention_defect_tickets" WHERE id = ${ticketId}::uuid FOR UPDATE`;
    const ticket = await loadTicket(tx, projectId, ticketId);
    const close = input.decision === 'CLOSE';
    const awaiting = ticket.status === 'RECTIFIED_PENDING_VERIFICATION';
    const openOrAssigned = ticket.status === 'OPEN' || ticket.status === 'ASSIGNED';
    if (!awaiting && !(close && openOrAssigned)) {
      throw new AppError('Nothing is waiting for verification on this ticket', 409, 'DEFECT_TICKET_NOT_RECTIFIED');
    }
    if (close && input.captureIds.length === 0) {
      throw new AppError('Closing a defect needs your photos of the repair.', 422, 'VERIFICATION_EVIDENCE_REQUIRED');
    }
    await assertCapturesInProject(tx, projectId, input.captureIds);
    await tx.retentionDefectTicket.update({
      where: { id: ticket.id },
      data: close
        ? {
            status: 'VERIFIED_CLOSED',
            verificationCaptureIds: [...new Set(input.captureIds)],
            verificationNotes: input.notes ? sanitizeHandoverText(input.notes, 2000) : null,
            verifiedByUserId: viewer.userId,
            verifiedByLabel: viewer.label,
            verifiedAt: new Date(),
          }
        : {
            status: 'ASSIGNED',
            resolutionReason: sanitizeHandoverText(input.notes, 2000),
            reopenCount: { increment: 1 },
            verificationCaptureIds: [...new Set(input.captureIds)],
          },
    });
    await audit(
      tx,
      projectId,
      viewer,
      close ? 'DEFECT_TICKET_CLOSED' : 'DEFECT_TICKET_UPDATED',
      close
        ? `Verified the repair on site and closed ${reference(ticket.ticketNumber)} (${input.captureIds.length} photo(s)).`
        : `Reopened ${reference(ticket.ticketNumber)}: ${input.notes}`,
      {
        defectTicketId: ticket.id,
        from: ticket.status,
        to: close ? 'VERIFIED_CLOSED' : 'ASSIGNED',
        captureIds: input.captureIds,
        notes: input.notes || null,
      }
    );
  });
  return getDefectTicket(projectId, ticketId, viewer);
}

/** POST /projects/:projectId/defects/:ticketId/reject: not a defect, with a reason. */
export async function rejectDefectTicket(projectId: string, ticketId: string, viewer: DefectViewer, input: RejectDefectTicketRequest) {
  await assertModuleOn(projectId, 'retention');
  requireStaff(viewer);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "retention_defect_tickets" WHERE id = ${ticketId}::uuid FOR UPDATE`;
    const ticket = await loadTicket(tx, projectId, ticketId);
    if (ticket.status !== 'OPEN' && ticket.status !== 'ASSIGNED') {
      throw new AppError('Only an open ticket can be rejected', 409, 'DEFECT_TICKET_NOT_OPEN');
    }
    await tx.retentionDefectTicket.update({
      where: { id: ticket.id },
      data: { status: 'REJECTED_NOT_A_DEFECT', resolutionReason: sanitizeHandoverText(input.reason, 2000) },
    });
    await audit(tx, projectId, viewer, 'DEFECT_TICKET_CLOSED', `Rejected ${reference(ticket.ticketNumber)} as not a defect: ${input.reason}`, {
      defectTicketId: ticket.id,
      from: ticket.status,
      to: 'REJECTED_NOT_A_DEFECT',
      reason: input.reason,
    });
  });
  return getDefectTicket(projectId, ticketId, viewer);
}

/**
 * Turns a handover response's snags into tickets in one action (Phase 10 Step 2). Snags that
 * already have a ticket are skipped, so the action can be repeated safely.
 */
export async function createTicketsFromSnags(
  projectId: string,
  submissionId: string,
  webUser: WebJwtPayload,
  input: ConvertSnagsRequest
): Promise<{ created: number; skipped: number }> {
  await assertModuleOn(projectId, 'handover');
  await assertModuleOn(projectId, 'retention');
  const viewer = defectViewerFor({ webUser });
  requireStaff(viewer);
  const pushes: PushQueue = [];
  const result = await prisma.$transaction(async (tx) => {
    await assertDefectPhase(tx, projectId);
    const submission = await tx.handoverSubmission.findFirst({ where: { id: submissionId, projectId } });
    if (!submission) throw new AppError('Handover submission not found', 404, 'HANDOVER_SUBMISSION_NOT_FOUND');
    const snags = Array.isArray(submission.snagsJson)
      ? (submission.snagsJson as Array<{ title: string; location: string | null; description: string | null }>)
      : [];
    const wanted = input.snagIndexes ?? snags.map((_, i) => i);
    for (const i of wanted) {
      if (i < 0 || i >= snags.length) throw new AppError('Snag not found on this submission', 404, 'SNAG_NOT_FOUND');
    }
    const existing = await tx.retentionDefectTicket.findMany({
      where: { sourceHandoverSubmissionId: submission.id },
      select: { sourceSnagIndex: true },
    });
    const done = new Set(existing.map((e) => e.sourceSnagIndex));
    const contractorId = await liableContractorId(tx, projectId);
    let created = 0;
    for (const i of [...new Set(wanted)]) {
      if (done.has(i)) continue;
      const snag = snags[i];
      await createTicketInTx(tx, pushes, {
        projectId,
        viewer,
        raisedByUserId: webUser.userId,
        title: snag.title,
        description: snag.description || snag.title,
        severity: input.severity,
        projectContractorId: contractorId,
        location: snag.location,
        dueDate: input.dueDate ?? null,
        assign: true,
        source: { submissionId: submission.id, snagIndex: i },
      });
      created += 1;
    }
    return { created, skipped: new Set(wanted).size - created };
  });
  await flushDefectPushes(pushes);
  return result;
}

/** defect-reminders job body for one project: a staff summary of every overdue ticket. */
export async function sendOverdueDefectReminders(projectId: string, codePrefix: string, today: string, now: Date): Promise<number> {
  const overdue = await prisma.retentionDefectTicket.findMany({
    where: { projectId, status: { in: ['OPEN', 'ASSIGNED'] }, dueDate: { lt: today } },
    select: { id: true, ticketNumber: true },
    orderBy: { dueDate: 'asc' },
  });
  if (overdue.length === 0) return 0;
  const shown = overdue.slice(0, 5).map((t) => reference(t.ticketNumber));
  const refs = `${shown.join(', ')}${overdue.length > shown.length ? ` and ${overdue.length - shown.length} more` : ''}`;
  await prisma.$transaction(async (tx) => {
    await createWebNotification(tx, {
      projectId,
      targetPermissionKey: MANAGE,
      category: 'DEFECT_TICKET',
      title: `${codePrefix}: ${overdue.length} defect(s) overdue`,
      description: `${refs} are past their due date and not yet fixed.`,
      actionUrl: `/app/projects/${projectId}/completion?tab=defects`,
      metadata: { overdueCount: overdue.length, day: today },
      createdAt: now,
    });
  });
  return overdue.length;
}

/** For the retention summary and the executive view. */
export async function openDefectCount(db: Db, projectId: string) {
  return db.retentionDefectTicket.count({ where: { projectId, status: { in: OPEN_DEFECT_STATUSES } } });
}
