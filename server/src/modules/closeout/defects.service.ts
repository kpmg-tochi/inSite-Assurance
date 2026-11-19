import { Prisma } from '@prisma/client';
import {
  AssignDefectTicketRequest,
  ConvertSnagsRequest,
  CreateDefectTicketRequest,
  DefectCaptureDto,
  DefectTicketDto,
  OPEN_DEFECT_STATUSES,
  RectifyDefectTicketRequest,
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
import { getProcessConfig } from '../process/processConfig.service';
import { contractorForWebUser } from '../projects/contractors.service';
import { assertModuleOn, projectToday } from './closeoutGate';

/**
 * Defect tickets for the defects liability period (Phase 10 Step 6).
 *
 * Two sides, told apart by organisation (never by role code): a web user whose organisation is a
 * contractor on the project, or a field session of the CONTRACTOR_EXECUTOR persona, is the liable
 * party and sees and updates only its own tickets (mark rectified). Everyone else with
 * retention:manage_defects is on the monitoring side: raise, assign, verify and close or reopen,
 * reject as not a defect. Rectification and verification photos are Phase 4 captures, linked by
 * their clientCaptureId.
 *
 * Field evidence follows the project's reporting set-up. When contractors report from site, the
 * contractor's repair photos come with "mark fixed". When only the monitoring side reports
 * (allowContractorFieldReporting off), the verifier captures the evidence: a verifier may close a
 * ticket straight from Open/Assigned after seeing the repair on site, and closing needs their photos.
 *
 * Notifications are aimed: contractor-facing ones reach only the liable contractor (its
 * organisation's web users, and field sessions joined through that contractor's join codes);
 * monitoring-side ones are hidden from every contractor on the project.
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

const MANAGE = 'retention:manage_defects';

export type DefectViewer =
  | { kind: 'monitor'; label: string; userId: string | null; canAct: boolean; channel: 'web' | 'field' }
  | { kind: 'contractor'; contractorId: string; label: string; userId: string | null; canAct: boolean; channel: 'web' | 'field' };

export async function defectViewerFor(
  projectId: string,
  principal: { webUser?: WebJwtPayload; fieldAgent?: FieldAgentJwtPayload }
): Promise<DefectViewer> {
  if (principal.webUser) {
    const u = principal.webUser;
    const canAct = u.permissions.includes(MANAGE) || u.isPlatformSuperAdmin;
    const own = await contractorForWebUser(prisma, projectId, u);
    const label = `${u.fullName} (${u.roleName})`;
    if (own) return { kind: 'contractor', contractorId: own.id, label, userId: u.userId, canAct, channel: 'web' };
    return { kind: 'monitor', label, userId: u.userId, canAct, channel: 'web' };
  }
  const f = principal.fieldAgent!;
  const canAct = f.permissions.includes(MANAGE);
  const label = `${f.agentFullName} (${f.roleName}, field)`;
  if (f.fieldPersonaType === 'CONTRACTOR_EXECUTOR') {
    const session = await prisma.fieldAgentSession.findUniqueOrThrow({
      where: { id: f.sessionId },
      select: { projectContractorId: true },
    });
    const contractorId = session.projectContractorId ?? (await mainContractorId(prisma, projectId));
    if (!contractorId) throw new AppError('This project has no contractor', 409, 'NO_CONTRACTOR');
    return { kind: 'contractor', contractorId, label, userId: f.userId, canAct, channel: 'field' };
  }
  return { kind: 'monitor', label, userId: f.userId, canAct, channel: 'field' };
}

async function mainContractorId(db: Db, projectId: string): Promise<string | null> {
  const main = await db.projectContractor.findFirst({
    where: { projectId },
    orderBy: [{ isMainContractor: 'desc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  return main?.id ?? null;
}

/** The liable contractor: the named one (must be on the project), or the main contractor in the unified model. */
export async function liableContractorId(db: Db, projectId: string, requested: string | null | undefined): Promise<string> {
  if (requested) {
    const c = await db.projectContractor.findFirst({ where: { id: requested, projectId }, select: { id: true } });
    if (!c) throw new AppError('Contractor not found on this project', 404, 'CONTRACTOR_NOT_FOUND');
    return c.id;
  }
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { contractorExecutionMode: true } });
  if (project.contractorExecutionMode === 'MULTI_PRIME_SEPARATE_IPC') {
    throw new AppError('Choose the contractor responsible for this defect', 422, 'CONTRACTOR_REQUIRED');
  }
  const main = await mainContractorId(db, projectId);
  if (!main) throw new AppError('This project has no contractor', 409, 'NO_CONTRACTOR');
  return main;
}

async function assertDefectPhase(db: Db, projectId: string) {
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { constructionPhase: true } });
  if (project.constructionPhase !== 'HANDOVER_IN_PROGRESS' && project.constructionPhase !== 'RETENTION_PERIOD') {
    throw new AppError('Defect tickets are raised during handover and the defects liability period.', 409, 'PROJECT_PHASE_NOT_DEFECTS');
  }
}

/** True when only the monitoring side reports from site, so it captures the repair evidence. */
async function monitorCapturesEvidence(projectId: string, db: Db = prisma): Promise<boolean> {
  const config = await getProcessConfig(projectId, db === prisma ? undefined : db);
  return !config.allowContractorFieldReporting;
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

/**
 * Field sessions of the liable contractor: CONTRACTOR_EXECUTOR sessions whose join code bound them
 * to this contractor, plus project-wide contractor sessions when it is the main contractor.
 */
async function contractorSessionIds(db: Db, projectId: string, contractorId: string): Promise<string[]> {
  const contractor = await db.projectContractor.findUniqueOrThrow({ where: { id: contractorId }, select: { isMainContractor: true } });
  const sessions = await db.fieldAgentSession.findMany({
    where: {
      projectId,
      isActive: true,
      fieldPersonaType: 'CONTRACTOR_EXECUTOR',
      OR: [{ projectContractorId: contractorId }, ...(contractor.isMainContractor ? [{ projectContractorId: null }] : [])],
    },
    select: { id: true },
  });
  return sessions.map((s) => s.id);
}

/** Field sessions on the monitoring side whose role may verify defects. */
async function verifierSessionIds(db: Db, projectId: string): Promise<string[]> {
  const sessions = await db.fieldAgentSession.findMany({
    where: {
      projectId,
      isActive: true,
      fieldPersonaType: { not: 'CONTRACTOR_EXECUTOR' },
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

/** Contractor-facing: only the liable contractor's web users and its field sessions. */
async function notifyContractor(
  tx: Tx,
  pushes: PushQueue,
  params: { projectId: string; contractorId: string; ticketId: string; title: string; description: string }
) {
  const contractor = await tx.projectContractor.findUniqueOrThrow({ where: { id: params.contractorId }, select: { organizationId: true } });
  await createWebNotification(tx, {
    projectId: params.projectId,
    targetPermissionKey: MANAGE,
    targetOrganizationId: contractor.organizationId,
    category: 'DEFECT_TICKET',
    title: params.title,
    description: params.description,
    actionUrl: `/app/projects/${params.projectId}/retention?ticket=${params.ticketId}`,
    metadata: { defectTicketId: params.ticketId },
  });
  const sessions = await contractorSessionIds(tx, params.projectId, params.contractorId);
  await notifySessions(tx, pushes, params.projectId, sessions, params.title, params.description, params.ticketId);
}

/** Monitoring side: hidden from every contractor on the project; optionally the verifiers' devices too. */
async function notifyMonitors(
  tx: Tx,
  pushes: PushQueue,
  params: { projectId: string; ticketId: string; title: string; description: string; toVerifierDevices: boolean }
) {
  await createWebNotification(tx, {
    projectId: params.projectId,
    targetPermissionKey: MANAGE,
    hideFromProjectContractors: true,
    category: 'DEFECT_TICKET',
    title: params.title,
    description: params.description,
    actionUrl: `/app/projects/${params.projectId}/retention?ticket=${params.ticketId}`,
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
  today: string,
  monitorEvidence: boolean
): Promise<DefectTicketDto[]> {
  const captureIds = rows.flatMap((r) => [...ids(r.rectificationCaptureIds), ...ids(r.verificationCaptureIds)]);
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
    const monitorSide = viewer.kind === 'monitor' && viewer.canAct;
    const ownTicket = viewer.kind === 'contractor' && viewer.contractorId === t.projectContractorId && viewer.canAct;
    const gate = (checks: Array<[boolean, string]>) => {
      const failed = checks.find(([ok]) => !ok);
      return { allowed: !failed, reason: failed ? failed[1] : null };
    };
    const awaiting = t.status === 'RECTIFIED_PENDING_VERIFICATION';
    const openOrAssigned = t.status === 'OPEN' || t.status === 'ASSIGNED';
    const item = t.boqItemId ? itemById.get(t.boqItemId) : null;
    // Snag photos are stakeholder uploads; only the monitoring side sees them.
    const snagPhotoKeys = viewer.kind === 'monitor' ? ids(t.snagPhotoKeys) : [];
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
      snagPhotoKeys,
      raisedByName: nameById.get(t.raisedByUserId) ?? null,
      rectificationNotes: t.rectificationNotes,
      rectificationCaptures: toCaptures(ids(t.rectificationCaptureIds)),
      rectifiedAt: t.rectifiedAt?.toISOString() ?? null,
      verificationNotes: t.verificationNotes,
      verificationCaptures: toCaptures(ids(t.verificationCaptureIds)),
      verifiedByName: t.verifiedByLabel ?? (t.verifiedByUserId ? nameById.get(t.verifiedByUserId) ?? null : null),
      verifiedAt: t.verifiedAt?.toISOString() ?? null,
      resolutionReason: t.resolutionReason,
      reopenCount: t.reopenCount,
      evidenceCapturedBy: monitorEvidence ? 'MONITOR' : 'CONTRACTOR',
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      actions: {
        assign: gate([
          [monitorSide, 'Only the monitoring side assigns defects.'],
          [openOrAssigned, 'Only an open ticket can be assigned.'],
        ]),
        rectify: gate([
          [ownTicket, 'Only the responsible contractor marks a defect as fixed.'],
          [openOrAssigned, 'Only an open ticket can be marked as fixed.'],
        ]),
        verify: gate([
          [monitorSide, 'Only the monitoring side verifies repairs.'],
          [awaiting || (monitorEvidence && openOrAssigned), 'Nothing is waiting for verification.'],
          // With monitor-captured evidence, closing needs site photos: that happens in the field app.
          [!(monitorEvidence && openOrAssigned && viewer.channel === 'web'), 'Close it from the field app with photos of the repair.'],
        ]),
        reject: gate([
          [monitorSide, 'Only the monitoring side can reject a ticket.'],
          [openOrAssigned, 'Only an open ticket can be rejected.'],
        ]),
      },
    };
  });
}

async function loadVisibleTicket(db: Db, projectId: string, ticketId: string, viewer: DefectViewer) {
  const ticket = await db.retentionDefectTicket.findFirst({ where: { id: ticketId, projectId }, include: TICKET_INCLUDE });
  // A contractor never learns that another contractor's ticket exists.
  if (!ticket || (viewer.kind === 'contractor' && ticket.projectContractorId !== viewer.contractorId)) {
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
    where: { projectId, ...(viewer.kind === 'contractor' ? { projectContractorId: viewer.contractorId } : {}) },
    include: TICKET_INCLUDE,
    orderBy: [{ ticketNumber: 'desc' }],
  });
  return serializeTickets(prisma, rows, viewer, await todayFor(prisma, projectId), await monitorCapturesEvidence(projectId));
}

export async function getDefectTicket(projectId: string, ticketId: string, viewer: DefectViewer): Promise<DefectTicketDto> {
  await assertModuleOn(projectId, 'retention');
  const row = await loadVisibleTicket(prisma, projectId, ticketId, viewer);
  return (await serializeTickets(prisma, [row], viewer, await todayFor(prisma, projectId), await monitorCapturesEvidence(projectId)))[0];
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

function requireMonitorSide(viewer: DefectViewer) {
  if (viewer.kind !== 'monitor' || !viewer.canAct) {
    throw new AppError('Only the monitoring side can do this', 403, 'FORBIDDEN_DEFECT_ACTION');
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
    source?: { submissionId: string; snagIndex: number; photoKeys: string[] };
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
      snagPhotoKeys: (params.source?.photoKeys ?? []) as Prisma.InputJsonValue,
    },
    include: TICKET_INCLUDE,
  });
  await audit(
    tx,
    params.projectId,
    params.viewer,
    'DEFECT_TICKET_RAISED',
    `Raised ${reference(ticketNumber)} "${ticket.title}" (${ticket.severity}) against ${ticket.projectContractor.organization.name}` +
      (params.source ? ' from a stakeholder handover snag.' : '.'),
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
  if (params.assign) {
    await notifyContractor(tx, pushes, {
      projectId: params.projectId,
      contractorId: ticket.projectContractorId,
      ticketId: ticket.id,
      title: `${reference(ticketNumber)} assigned: ${ticket.title}`,
      description: `A defect was assigned to ${ticket.projectContractor.organization.name}${ticket.dueDate ? `, due ${ticket.dueDate}` : ''}.`,
    });
  }
  return ticket;
}

/** POST /projects/:projectId/defects */
export async function createDefectTicket(projectId: string, viewer: DefectViewer, input: CreateDefectTicketRequest) {
  await assertModuleOn(projectId, 'retention');
  requireMonitorSide(viewer);
  const pushes: PushQueue = [];
  const id = await prisma.$transaction(async (tx) => {
    await assertDefectPhase(tx, projectId);
    const contractorId = await liableContractorId(tx, projectId, input.projectContractorId);
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

/** POST /projects/:projectId/defects/:ticketId/assign */
export async function assignDefectTicket(projectId: string, ticketId: string, viewer: DefectViewer, input: AssignDefectTicketRequest) {
  await assertModuleOn(projectId, 'retention');
  requireMonitorSide(viewer);
  const pushes: PushQueue = [];
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "retention_defect_tickets" WHERE id = ${ticketId}::uuid FOR UPDATE`;
    const ticket = await loadVisibleTicket(tx, projectId, ticketId, viewer);
    if (ticket.status !== 'OPEN' && ticket.status !== 'ASSIGNED') {
      throw new AppError('Only an open ticket can be assigned', 409, 'DEFECT_TICKET_NOT_OPEN');
    }
    const contractorId = await liableContractorId(tx, projectId, input.projectContractorId);
    const updated = await tx.retentionDefectTicket.update({
      where: { id: ticket.id },
      data: {
        projectContractorId: contractorId,
        status: 'ASSIGNED',
        assignedAt: new Date(),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      },
      include: TICKET_INCLUDE,
    });
    await audit(tx, projectId, viewer, 'DEFECT_TICKET_UPDATED', `Assigned ${reference(ticket.ticketNumber)} to ${updated.projectContractor.organization.name}.`, {
      defectTicketId: ticket.id,
      from: ticket.status,
      to: 'ASSIGNED',
      projectContractorId: contractorId,
      previousProjectContractorId: ticket.projectContractorId,
      dueDate: updated.dueDate,
    });
    await notifyContractor(tx, pushes, {
      projectId,
      contractorId,
      ticketId: ticket.id,
      title: `${reference(ticket.ticketNumber)} assigned: ${ticket.title}`,
      description: `A defect was assigned to ${updated.projectContractor.organization.name}${updated.dueDate ? `, due ${updated.dueDate}` : ''}.`,
    });
  });
  await flushDefectPushes(pushes);
  return getDefectTicket(projectId, ticketId, viewer);
}

/** POST /projects/:projectId/defects/:ticketId/rectify: the liable contractor reports the repair. */
export async function rectifyDefectTicket(projectId: string, ticketId: string, viewer: DefectViewer, input: RectifyDefectTicketRequest) {
  await assertModuleOn(projectId, 'retention');
  if (viewer.kind !== 'contractor' || !viewer.canAct) {
    throw new AppError('Only the responsible contractor marks a defect as fixed', 403, 'FORBIDDEN_DEFECT_ACTION');
  }
  const pushes: PushQueue = [];
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "retention_defect_tickets" WHERE id = ${ticketId}::uuid FOR UPDATE`;
    const ticket = await loadVisibleTicket(tx, projectId, ticketId, viewer);
    if (ticket.status !== 'OPEN' && ticket.status !== 'ASSIGNED') {
      throw new AppError('Only an open ticket can be marked as fixed', 409, 'DEFECT_TICKET_NOT_OPEN');
    }
    await assertCapturesInProject(tx, projectId, input.captureIds);
    await tx.retentionDefectTicket.update({
      where: { id: ticket.id },
      data: {
        status: 'RECTIFIED_PENDING_VERIFICATION',
        rectificationCaptureIds: [...new Set(input.captureIds)],
        rectificationNotes: input.notes ? sanitizeHandoverText(input.notes, 2000) : null,
        rectifiedAt: new Date(),
        rectifiedByLabel: viewer.label,
      },
    });
    await audit(tx, projectId, viewer, 'DEFECT_TICKET_UPDATED', `Marked ${reference(ticket.ticketNumber)} as fixed (${input.captureIds.length} photo(s)); awaiting verification.`, {
      defectTicketId: ticket.id,
      from: ticket.status,
      to: 'RECTIFIED_PENDING_VERIFICATION',
      captureIds: input.captureIds,
    });
    await notifyMonitors(tx, pushes, {
      projectId,
      ticketId: ticket.id,
      title: `${reference(ticket.ticketNumber)} fixed: verify the repair`,
      description: `${ticket.projectContractor.organization.name} reports "${ticket.title}" as fixed.`,
      toVerifierDevices: true,
    });
  });
  await flushDefectPushes(pushes);
  return getDefectTicket(projectId, ticketId, viewer);
}

/**
 * POST /projects/:projectId/defects/:ticketId/verify: close, or reopen with a reason. When the
 * monitoring side captures the evidence (contractor field reporting off), a verifier may also close
 * an Open/Assigned ticket after seeing the repair, and closing needs their photos.
 */
export async function verifyDefectTicket(projectId: string, ticketId: string, viewer: DefectViewer, input: VerifyDefectTicketRequest) {
  await assertModuleOn(projectId, 'retention');
  requireMonitorSide(viewer);
  const monitorEvidence = await monitorCapturesEvidence(projectId);
  const pushes: PushQueue = [];
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "retention_defect_tickets" WHERE id = ${ticketId}::uuid FOR UPDATE`;
    const ticket = await loadVisibleTicket(tx, projectId, ticketId, viewer);
    const close = input.decision === 'CLOSE';
    const awaiting = ticket.status === 'RECTIFIED_PENDING_VERIFICATION';
    const directClose = monitorEvidence && close && (ticket.status === 'OPEN' || ticket.status === 'ASSIGNED');
    if (!awaiting && !directClose) {
      throw new AppError('Nothing is waiting for verification on this ticket', 409, 'DEFECT_TICKET_NOT_RECTIFIED');
    }
    if (close && monitorEvidence && input.captureIds.length === 0) {
      throw new AppError(
        'Only the monitoring side reports from site on this project, so closing a defect needs your photos of the repair.',
        422,
        'VERIFICATION_EVIDENCE_REQUIRED'
      );
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
        ? `Verified the repair and closed ${reference(ticket.ticketNumber)}${directClose ? ' (repair seen on site; evidence captured by the monitoring side)' : ''}.`
        : `Reopened ${reference(ticket.ticketNumber)}: ${input.notes}`,
      {
        defectTicketId: ticket.id,
        from: ticket.status,
        to: close ? 'VERIFIED_CLOSED' : 'ASSIGNED',
        captureIds: input.captureIds,
        notes: input.notes || null,
        evidenceCapturedBy: monitorEvidence ? 'MONITOR' : 'CONTRACTOR',
      }
    );
    await notifyContractor(tx, pushes, {
      projectId,
      contractorId: ticket.projectContractorId,
      ticketId: ticket.id,
      title: close ? `${reference(ticket.ticketNumber)} closed` : `${reference(ticket.ticketNumber)} reopened`,
      description: close ? `The repair of "${ticket.title}" was verified.` : `The repair of "${ticket.title}" was not accepted: ${input.notes}`,
    });
  });
  await flushDefectPushes(pushes);
  return getDefectTicket(projectId, ticketId, viewer);
}

/** POST /projects/:projectId/defects/:ticketId/reject: not a defect, with a reason. */
export async function rejectDefectTicket(projectId: string, ticketId: string, viewer: DefectViewer, input: RejectDefectTicketRequest) {
  await assertModuleOn(projectId, 'retention');
  requireMonitorSide(viewer);
  const pushes: PushQueue = [];
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "retention_defect_tickets" WHERE id = ${ticketId}::uuid FOR UPDATE`;
    const ticket = await loadVisibleTicket(tx, projectId, ticketId, viewer);
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
    await notifyContractor(tx, pushes, {
      projectId,
      contractorId: ticket.projectContractorId,
      ticketId: ticket.id,
      title: `${reference(ticket.ticketNumber)} closed as not a defect`,
      description: `"${ticket.title}" needs no repair: ${input.reason}`,
    });
  });
  await flushDefectPushes(pushes);
  return getDefectTicket(projectId, ticketId, viewer);
}

/**
 * Turns a handover submission's snags into tickets in one action (Phase 10 Step 2). Snags that
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
  if (!hasWebPermission(webUser, MANAGE)) {
    throw new AppError(`Access requires permission(s): ${MANAGE}`, 403, 'FORBIDDEN_PERMISSION');
  }
  const viewer = await defectViewerFor(projectId, { webUser });
  requireMonitorSide(viewer);
  const pushes: PushQueue = [];
  const result = await prisma.$transaction(async (tx) => {
    await assertDefectPhase(tx, projectId);
    const submission = await tx.handoverSubmission.findFirst({ where: { id: submissionId, projectId } });
    if (!submission) throw new AppError('Handover submission not found', 404, 'HANDOVER_SUBMISSION_NOT_FOUND');
    const snags = Array.isArray(submission.snagsJson)
      ? (submission.snagsJson as Array<{ title: string; location: string | null; description: string | null; photos: Array<{ objectKey: string }> }>)
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
    const contractorId = await liableContractorId(tx, projectId, input.projectContractorId);
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
        source: { submissionId: submission.id, snagIndex: i, photoKeys: snag.photos.map((p) => p.objectKey) },
      });
      created += 1;
    }
    return { created, skipped: new Set(wanted).size - created };
  });
  await flushDefectPushes(pushes);
  return result;
}

/**
 * defect-reminders job body for one project: a monitoring-side summary of every overdue ticket,
 * and one reminder per liable contractor about its own overdue tickets only.
 */
export async function sendOverdueDefectReminders(projectId: string, codePrefix: string, today: string, now: Date): Promise<number> {
  const overdue = await prisma.retentionDefectTicket.findMany({
    where: { projectId, status: { in: ['OPEN', 'ASSIGNED'] }, dueDate: { lt: today } },
    select: { id: true, ticketNumber: true, projectContractorId: true },
    orderBy: { dueDate: 'asc' },
  });
  if (overdue.length === 0) return 0;
  const refs = (list: typeof overdue) => {
    const shown = list.slice(0, 5).map((t) => reference(t.ticketNumber));
    return `${shown.join(', ')}${list.length > shown.length ? ` and ${list.length - shown.length} more` : ''}`;
  };
  const pushes: PushQueue = [];
  await prisma.$transaction(async (tx) => {
    await createWebNotification(tx, {
      projectId,
      targetPermissionKey: MANAGE,
      hideFromProjectContractors: true,
      category: 'DEFECT_TICKET',
      title: `${codePrefix}: ${overdue.length} defect(s) overdue`,
      description: `${refs(overdue)} are past their due date and not yet fixed.`,
      actionUrl: `/app/projects/${projectId}/retention`,
      metadata: { overdueCount: overdue.length, day: today },
      createdAt: now,
    });
    const byContractor = new Map<string, typeof overdue>();
    for (const t of overdue) byContractor.set(t.projectContractorId, [...(byContractor.get(t.projectContractorId) ?? []), t]);
    for (const [contractorId, list] of byContractor) {
      await notifyContractor(tx, pushes, {
        projectId,
        contractorId,
        ticketId: list[0].id,
        title: `${codePrefix}: ${list.length} of your defect(s) overdue`,
        description: `${refs(list)} are past their due date. Fix them and mark them as fixed.`,
      });
    }
  });
  await flushDefectPushes(pushes);
  return overdue.length;
}

/** For the retention summary and the executive view. */
export async function openDefectCount(db: Db, projectId: string) {
  return db.retentionDefectTicket.count({ where: { projectId, status: { in: OPEN_DEFECT_STATUSES } } });
}
