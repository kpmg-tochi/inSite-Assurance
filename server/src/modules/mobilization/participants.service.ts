import { Prisma } from '@prisma/client';
import {
  CreateExpectedParticipantRequest,
  DEFAULT_REMINDER_OFFSETS_DAYS,
  ExpectedParticipantDto,
  MobilizationStatus,
  ProjectReminderSettings,
  UpdateExpectedParticipantRequest,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import type { WebJwtPayload } from '../../middleware/auth.middleware';
import { hasWebPermission } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

/**
 * Expected participants (Phase 8 Step 5): who is expected on a project and when. A participant is
 * linked to an existing account (provisioned roles) or described by name plus email or phone
 * (join-code roles). Sessions are linked to participants as people register; the status follows.
 */

export const PARTICIPANT_INCLUDE = {
  role: { select: { name: true, onboardingMode: true } },
  projectContractor: { select: { organization: { select: { name: true } } } },
  project: { select: { workdayStartTime: true, mobilizationReminderOffsetsDays: true } },
} satisfies Prisma.ExpectedProjectParticipantInclude;

export type ParticipantRow = Prisma.ExpectedProjectParticipantGetPayload<{ include: typeof PARTICIPANT_INCLUDE }>;

export function effectiveReminderOffsets(row: Pick<ParticipantRow, 'usesProjectReminderSchedule' | 'reminderOffsetsDays' | 'project'>): number[] {
  return row.usesProjectReminderSchedule ? row.project.mobilizationReminderOffsetsDays : row.reminderOffsetsDays;
}

export function effectiveCheckInTime(row: Pick<ParticipantRow, 'expectedCheckInTime' | 'project'>): string {
  return row.expectedCheckInTime || row.project.workdayStartTime || '08:00';
}

export function serializeParticipant(row: ParticipantRow): ExpectedParticipantDto {
  return {
    id: row.id,
    projectId: row.projectId,
    projectContractorId: row.projectContractorId,
    contractorName: row.projectContractor?.organization.name ?? null,
    roleId: row.roleId,
    roleName: row.role.name,
    onboardingMode: row.role.onboardingMode,
    userId: row.userId,
    fullName: row.fullName,
    email: row.email,
    phoneNumber: row.phoneNumber,
    plannedMobilizationDate: row.plannedMobilizationDate,
    expectedCheckInTime: effectiveCheckInTime(row),
    checkInGraceMinutes: row.checkInGraceMinutes,
    reminderOffsetsDays: effectiveReminderOffsets(row),
    usesProjectReminderSchedule: row.usesProjectReminderSchedule,
    lastReminderSentAt: row.lastReminderSentAt?.toISOString() ?? null,
    linkedFieldSessionId: row.linkedFieldSessionId,
    mobilizationStatus: row.mobilizationStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

function actorName(webUser: WebJwtPayload) {
  return `${webUser.fullName} (${webUser.roleName})`;
}

/** Last ten digits; enough to match "+234 803 ..." against "0803 ...". */
export function normalizePhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-10) : null;
}

async function assertRoleAndLinks(
  db: Db,
  projectId: string,
  tenantId: string,
  input: { roleId?: string; userId?: string | null; projectContractorId?: string | null }
) {
  let role: { id: string; onboardingMode: string; fieldPersonaType: string; surface: string } | null = null;
  if (input.roleId) {
    role = await db.role.findFirst({
      where: { id: input.roleId, tenantId },
      select: { id: true, onboardingMode: true, fieldPersonaType: true, surface: true },
    });
    if (!role || role.surface === 'WEB' || role.fieldPersonaType === 'NONE') {
      throw new AppError('Pick a mobile field role for the participant', 400, 'INVALID_PARTICIPANT_ROLE');
    }
  }
  if (input.userId) {
    const user = await db.user.findFirst({ where: { id: input.userId, tenantId, isActive: true }, select: { id: true } });
    if (!user) throw new AppError('That account was not found in this organisation', 400, 'INVALID_PARTICIPANT_USER');
  }
  if (input.projectContractorId) {
    const pc = await db.projectContractor.findFirst({ where: { id: input.projectContractorId, projectId }, select: { id: true } });
    if (!pc) throw new AppError('That contractor is not on this project', 400, 'INVALID_PARTICIPANT_CONTRACTOR');
  }
  return role;
}

export async function listParticipants(projectId: string): Promise<ExpectedParticipantDto[]> {
  const rows = await prisma.expectedProjectParticipant.findMany({
    where: { projectId },
    include: PARTICIPANT_INCLUDE,
    orderBy: [{ plannedMobilizationDate: 'asc' }, { fullName: 'asc' }],
  });
  return rows.map(serializeParticipant);
}

export async function createParticipant(params: {
  projectId: string;
  webUser: WebJwtPayload;
  input: CreateExpectedParticipantRequest;
}): Promise<ExpectedParticipantDto> {
  const { projectId, webUser, input } = params;
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { tenantId: true } });
  const role = await assertRoleAndLinks(prisma, projectId, project.tenantId, input);
  if (role?.onboardingMode === 'PROVISIONED_ACCOUNT' && !input.userId) {
    throw new AppError('This role signs in with an account: link the participant to a user', 400, 'PARTICIPANT_USER_REQUIRED');
  }
  if (input.reminderOffsetsDays && !hasWebPermission(webUser, 'mobilization:configure_reminders')) {
    throw new AppError('Changing the reminder schedule requires mobilization:configure_reminders', 403, 'FORBIDDEN_PERMISSION');
  }
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.expectedProjectParticipant.create({
      data: {
        projectId,
        roleId: input.roleId,
        projectContractorId: input.projectContractorId ?? null,
        userId: input.userId ?? null,
        fullName: input.fullName,
        email: input.email ?? null,
        phoneNumber: input.phoneNumber ?? null,
        plannedMobilizationDate: input.plannedMobilizationDate,
        expectedCheckInTime: input.expectedCheckInTime ?? null,
        checkInGraceMinutes: input.checkInGraceMinutes ?? 120,
        usesProjectReminderSchedule: !input.reminderOffsetsDays,
        reminderOffsetsDays: input.reminderOffsetsDays ?? DEFAULT_REMINDER_OFFSETS_DAYS,
        createdByUserId: webUser.userId,
      },
    });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'PARTICIPANT_PREREGISTERED',
      summaryText: `Pre-registered ${input.fullName} as expected on site from ${input.plannedMobilizationDate}.`,
      payload: { participantId: row.id, roleId: input.roleId, plannedMobilizationDate: input.plannedMobilizationDate, linkedUserId: input.userId ?? null },
    });
    await linkExistingSessions(tx, row.id);
    return row;
  });
  return serializeParticipant(
    await prisma.expectedProjectParticipant.findUniqueOrThrow({ where: { id: created.id }, include: PARTICIPANT_INCLUDE })
  );
}

export async function updateParticipant(params: {
  projectId: string;
  participantId: string;
  webUser: WebJwtPayload;
  input: UpdateExpectedParticipantRequest;
}): Promise<ExpectedParticipantDto> {
  const { projectId, participantId, webUser, input } = params;
  const existing = await prisma.expectedProjectParticipant.findFirst({ where: { id: participantId, projectId } });
  if (!existing) throw new AppError('Participant not found', 404, 'PARTICIPANT_NOT_FOUND');
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { tenantId: true } });
  await assertRoleAndLinks(prisma, projectId, project.tenantId, input);
  if (input.reminderOffsetsDays !== undefined && !hasWebPermission(webUser, 'mobilization:configure_reminders')) {
    throw new AppError('Changing the reminder schedule requires mobilization:configure_reminders', 403, 'FORBIDDEN_PERMISSION');
  }
  const data: Prisma.ExpectedProjectParticipantUncheckedUpdateInput = {};
  for (const key of ['roleId', 'projectContractorId', 'userId', 'fullName', 'email', 'phoneNumber', 'plannedMobilizationDate', 'expectedCheckInTime', 'checkInGraceMinutes'] as const) {
    if (input[key] !== undefined) (data as Record<string, unknown>)[key] = input[key];
  }
  if (input.reminderOffsetsDays !== undefined) {
    data.usesProjectReminderSchedule = input.reminderOffsetsDays === null;
    if (input.reminderOffsetsDays) data.reminderOffsetsDays = input.reminderOffsetsDays;
  }
  if (input.withdrawn === true) data.mobilizationStatus = 'WITHDRAWN';
  if (input.withdrawn === false && existing.mobilizationStatus === 'WITHDRAWN') data.mobilizationStatus = 'INVITED';
  await prisma.$transaction(async (tx) => {
    await tx.expectedProjectParticipant.update({ where: { id: participantId }, data });
    if (input.withdrawn === false || input.userId || input.phoneNumber) await linkExistingSessions(tx, participantId);
  });
  return serializeParticipant(
    await prisma.expectedProjectParticipant.findUniqueOrThrow({ where: { id: participantId }, include: PARTICIPANT_INCLUDE })
  );
}

export async function deleteParticipant(projectId: string, participantId: string): Promise<void> {
  const existing = await prisma.expectedProjectParticipant.findFirst({ where: { id: participantId, projectId }, select: { id: true } });
  if (!existing) throw new AppError('Participant not found', 404, 'PARTICIPANT_NOT_FOUND');
  const alerts = await prisma.siteAttendanceAlert.count({ where: { participantId } });
  if (alerts > 0) {
    throw new AppError('This participant has attendance alerts; withdraw them instead of deleting', 409, 'PARTICIPANT_HAS_ALERTS');
  }
  await prisma.expectedProjectParticipant.delete({ where: { id: participantId } });
}

export async function saveReminderSettings(params: {
  projectId: string;
  webUser: WebJwtPayload;
  input: ProjectReminderSettings;
}): Promise<{ reminderOffsetsDays: number[] }> {
  await prisma.$transaction(async (tx) => {
    await tx.project.update({
      where: { id: params.projectId },
      data: { mobilizationReminderOffsetsDays: params.input.reminderOffsetsDays },
    });
    await recordAuditEvent(tx, {
      projectId: params.projectId,
      actorType: 'WEB_USER',
      actorId: params.webUser.userId,
      actorDisplayName: actorName(params.webUser),
      action: 'PROJECT_SETUP_STEP_SAVED',
      summaryText: `Set mobilization reminders to ${params.input.reminderOffsetsDays.join(', ') || 'none'} day(s) before the planned date.`,
      payload: { step: 'mobilization-reminders', reminderOffsetsDays: params.input.reminderOffsetsDays },
    });
  });
  return { reminderOffsetsDays: params.input.reminderOffsetsDays };
}

// ---------------------------------------------------------------------------
// Linking sessions to participants
// ---------------------------------------------------------------------------

/** Status a participant moves to from its sessions' state. On-site and withdrawn are sticky. */
function nextStatus(current: MobilizationStatus, assurance: string | null): MobilizationStatus {
  if (current === 'WITHDRAWN' || current === 'MOBILIZED_ON_SITE') return current;
  if (assurance === 'APPROVED') return current === 'NO_SHOW_FLAGGED' ? current : 'READY_FOR_MOBILIZATION';
  if (assurance) return current === 'NO_SHOW_FLAGGED' ? current : 'REGISTERED_PENDING_ASSURANCE';
  return current;
}

/** Field sessions that belong to a participant (all devices of a provisioned account). */
export async function participantSessionIds(
  db: Db,
  p: { projectId: string; userId: string | null; linkedFieldSessionId: string | null; phoneNumber: string | null }
): Promise<string[]> {
  const ids = new Set<string>();
  if (p.linkedFieldSessionId) ids.add(p.linkedFieldSessionId);
  if (p.userId) {
    for (const s of await db.fieldAgentSession.findMany({ where: { projectId: p.projectId, userId: p.userId }, select: { id: true } })) ids.add(s.id);
  }
  const phone = normalizePhone(p.phoneNumber);
  if (phone) {
    const candidates = await db.fieldAgentSession.findMany({
      where: { projectId: p.projectId, origin: 'JOIN_CODE' },
      select: { id: true, agentPhoneNumber: true },
    });
    for (const s of candidates) if (normalizePhone(s.agentPhoneNumber) === phone) ids.add(s.id);
  }
  return [...ids];
}

/** Links a participant to any session that already exists for it and refreshes its status. */
export async function linkExistingSessions(tx: Tx, participantId: string): Promise<void> {
  const p = await tx.expectedProjectParticipant.findUniqueOrThrow({ where: { id: participantId } });
  const ids = await participantSessionIds(tx, p);
  if (ids.length === 0) return;
  const sessions = await tx.fieldAgentSession.findMany({
    where: { id: { in: ids }, isActive: true },
    select: { id: true, assuranceStatus: true },
    orderBy: { createdAt: 'desc' },
  });
  const best = sessions.find((s) => s.assuranceStatus === 'APPROVED') ?? sessions[0];
  if (!best) return;
  await tx.expectedProjectParticipant.update({
    where: { id: participantId },
    data: {
      linkedFieldSessionId: p.linkedFieldSessionId ?? best.id,
      mobilizationStatus: nextStatus(p.mobilizationStatus, best.assuranceStatus),
    },
  });
}

/**
 * Called when a session is created or its assurance changes: links it to the matching participant
 * (same account, or same phone number for join-code sessions) and advances the participant.
 */
export async function syncParticipantForSession(db: Db, sessionId: string): Promise<void> {
  const session = await db.fieldAgentSession.findUnique({
    where: { id: sessionId },
    select: { id: true, projectId: true, userId: true, origin: true, agentPhoneNumber: true, assuranceStatus: true, isActive: true },
  });
  if (!session || !session.isActive) return;
  const candidates = await db.expectedProjectParticipant.findMany({
    where: {
      projectId: session.projectId,
      mobilizationStatus: { not: 'WITHDRAWN' },
      OR: [
        { linkedFieldSessionId: session.id },
        ...(session.userId ? [{ userId: session.userId }] : []),
        ...(session.origin === 'JOIN_CODE' ? [{ phoneNumber: { not: null } }] : []),
      ],
    },
  });
  const phone = normalizePhone(session.agentPhoneNumber);
  const matches = candidates.filter(
    (p) =>
      p.linkedFieldSessionId === session.id ||
      (session.userId && p.userId === session.userId) ||
      (session.origin === 'JOIN_CODE' && phone && normalizePhone(p.phoneNumber) === phone)
  );
  for (const p of matches) {
    await db.expectedProjectParticipant.update({
      where: { id: p.id },
      data: {
        linkedFieldSessionId: p.linkedFieldSessionId ?? session.id,
        mobilizationStatus: nextStatus(p.mobilizationStatus, session.assuranceStatus),
      },
    });
  }
}

/** An in-geofence presence ping from a session marks its participants as on site. */
export async function markParticipantsOnSite(db: Db, sessionId: string): Promise<void> {
  const session = await db.fieldAgentSession.findUnique({
    where: { id: sessionId },
    select: { projectId: true, userId: true, origin: true, agentPhoneNumber: true },
  });
  if (!session) return;
  const candidates = await db.expectedProjectParticipant.findMany({
    where: {
      projectId: session.projectId,
      mobilizationStatus: { in: ['INVITED', 'REGISTERED_PENDING_ASSURANCE', 'READY_FOR_MOBILIZATION', 'NO_SHOW_FLAGGED'] },
    },
  });
  const phone = normalizePhone(session.agentPhoneNumber);
  for (const p of candidates) {
    const mine =
      p.linkedFieldSessionId === sessionId ||
      (session.userId && p.userId === session.userId) ||
      (session.origin === 'JOIN_CODE' && phone && normalizePhone(p.phoneNumber) === phone);
    if (!mine) continue;
    await db.expectedProjectParticipant.update({
      where: { id: p.id },
      data: { mobilizationStatus: 'MOBILIZED_ON_SITE', linkedFieldSessionId: p.linkedFieldSessionId ?? sessionId },
    });
  }
}
