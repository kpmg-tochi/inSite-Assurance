import { Prisma } from '@prisma/client';
import {
  daysBetween,
  KickoffInviteeInput,
  KickoffMeetingDto,
  KickoffNoticeStatus,
  kickoffQuorumMet,
  KickoffStakeholderGroup,
  ProjectKickoffDto,
  RecordKickoffHeldRequest,
  resolveProjectTypeConfig,
  SaveKickoffMeetingRequest,
  zonedCalendarDate,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { sendMessage } from '../../integrations/messaging';
import { recordAuditEvent } from '../audit/audit.service';
import { assertProjectDocument } from '../documents/documents.service';
import { autoCompleteMilestones, recomputeAndAudit, webActor } from './milestones.service';

/**
 * Phase 13: the kick-off meeting. One meeting per project: invitees by stakeholder group, a notice
 * sent through the platform (an OutboundMessage per invitee; the platform never claims it was
 * read), the record of the meeting (attendance, quorum against the type's required groups, minutes)
 * and the automatic kick-off milestones.
 */

type Tx = Prisma.TransactionClient;

function actorName(webUser: WebJwtPayload) {
  return `${webUser.fullName} (${webUser.roleName})`;
}

const MEETING_INCLUDE = {
  invitees: { orderBy: { createdAt: 'asc' } },
  agendaDocument: { select: { id: true, title: true } },
  minutesDocument: { select: { id: true, title: true } },
} satisfies Prisma.KickoffMeetingInclude;

type MeetingRow = Prisma.KickoffMeetingGetPayload<{ include: typeof MEETING_INCLUDE }>;

async function loadProject(projectId: string) {
  return prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      id: true,
      tenantId: true,
      name: true,
      codePrefix: true,
      timezone: true,
      kickoffDate: true,
      owningOrganizationId: true,
      lenderOrganizationId: true,
      monitorOrganizationId: true,
      projectTypeSnapshotJson: true,
    },
  });
}

function kickoffRules(snapshot: unknown) {
  const k = resolveProjectTypeConfig(snapshot)?.kickoff;
  return { requiredStakeholderGroups: k?.requiredStakeholderGroups ?? [], noticeLeadDays: k?.noticeLeadDays ?? 7 };
}

async function serializeMeeting(m: MeetingRow, rules: ReturnType<typeof kickoffRules>): Promise<KickoffMeetingDto> {
  const orgIds = [...new Set(m.invitees.map((i) => i.organizationId).filter((v): v is string => Boolean(v)))];
  const msgIds = m.invitees.map((i) => i.outboundMessageId).filter((v): v is string => Boolean(v));
  const [orgs, messages] = await Promise.all([
    orgIds.length ? prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [],
    msgIds.length ? prisma.outboundMessage.findMany({ where: { id: { in: msgIds } }, select: { id: true, status: true, sentAt: true } }) : [],
  ]);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const msg = new Map(messages.map((x) => [x.id, x]));
  const held = Boolean(m.heldAt);
  return {
    id: m.id,
    scheduledAt: m.scheduledAt.toISOString(),
    location: m.location,
    virtualLink: m.virtualLink,
    agendaDocumentId: m.agendaDocument?.id ?? null,
    agendaDocumentTitle: m.agendaDocument?.title ?? null,
    minutesDocumentId: m.minutesDocument?.id ?? null,
    minutesDocumentTitle: m.minutesDocument?.title ?? null,
    noticeSentAt: m.noticeSentAt?.toISOString() ?? null,
    noticeLeadDays: rules.noticeLeadDays,
    noticeWaivedReason: m.noticeWaivedReason,
    heldAt: m.heldAt?.toISOString() ?? null,
    quorumMet: m.quorumMet,
    quorumWaivedReason: m.quorumWaivedReason,
    requiredStakeholderGroups: rules.requiredStakeholderGroups,
    quorum: rules.requiredStakeholderGroups.map((group) => {
      const inGroup = m.invitees.filter((i) => i.stakeholderGroup === group);
      return { group, invitedCount: inGroup.length, attendedCount: held ? inGroup.filter((i) => i.attended).length : null };
    }),
    invitees: m.invitees.map((i) => {
      const message = i.outboundMessageId ? msg.get(i.outboundMessageId) : undefined;
      let noticeStatus: KickoffNoticeStatus = 'NOT_SENT';
      if (m.noticeSentAt) noticeStatus = !i.email ? 'NO_EMAIL' : message ? (message.status as KickoffNoticeStatus) : 'FAILED';
      return {
        id: i.id,
        stakeholderGroup: i.stakeholderGroup as KickoffStakeholderGroup,
        name: i.name,
        email: i.email,
        phone: i.phone,
        organizationId: i.organizationId,
        organizationName: i.organizationId ? orgName.get(i.organizationId) ?? null : null,
        userId: i.userId,
        attended: i.attended,
        noticeStatus,
        noticeSentAt: message?.sentAt?.toISOString() ?? null,
      };
    }),
  };
}

/** Invitees from the parties, beneficiaries and assigned users, grouped by stakeholder group. */
export async function suggestedKickoffInvitees(projectId: string): Promise<KickoffInviteeInput[]> {
  const project = await loadProject(projectId);
  const [contractors, beneficiaries, assignments] = await Promise.all([
    prisma.projectContractor.findMany({
      where: { projectId, contractStatus: 'ACTIVE' },
      select: { organizationId: true, organization: { select: { name: true } } },
    }),
    prisma.projectBeneficiary.findMany({ where: { projectId }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] }),
    prisma.userProjectAssignment.findMany({
      where: { projectId, user: { isActive: true } },
      select: { user: { select: { id: true, fullName: true, email: true, organizationId: true } } },
    }),
  ]);
  const contractorOrgs = new Set(contractors.map((c) => c.organizationId));
  const groupOf = (orgId: string): KickoffStakeholderGroup =>
    orgId === project.owningOrganizationId
      ? 'OWNER'
      : contractorOrgs.has(orgId)
        ? 'CONTRACTOR'
        : orgId === project.monitorOrganizationId
          ? 'MONITOR'
          : orgId === project.lenderOrganizationId
            ? 'FUNDER'
            : 'OTHER';
  const out: KickoffInviteeInput[] = assignments.map(({ user }) => ({
    stakeholderGroup: groupOf(user.organizationId),
    name: user.fullName,
    email: user.email,
    phone: null,
    organizationId: user.organizationId,
    userId: user.id,
  }));
  // A party with nobody assigned still appears (by organisation) so it is not forgotten.
  const covered = new Set(assignments.map((a) => a.user.organizationId));
  const parties: Array<[string | null, KickoffStakeholderGroup]> = [
    [project.owningOrganizationId, 'OWNER'],
    [project.lenderOrganizationId, 'FUNDER'],
    [project.monitorOrganizationId, 'MONITOR'],
    ...contractors.map((c) => [c.organizationId, 'CONTRACTOR'] as [string, KickoffStakeholderGroup]),
  ];
  const seen = new Set<string>();
  for (const [orgId, group] of parties) {
    if (!orgId || covered.has(orgId) || seen.has(orgId)) continue;
    seen.add(orgId);
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } });
    if (org) out.push({ stakeholderGroup: group, name: org.name, email: null, phone: null, organizationId: orgId, userId: null });
  }
  for (const b of beneficiaries) {
    out.push({
      stakeholderGroup: 'BENEFICIARY',
      name: b.contactName ? `${b.contactName} (${b.name})` : b.name,
      email: b.contactEmail,
      phone: b.contactPhone,
      organizationId: null,
      userId: null,
    });
  }
  return out;
}

export async function getProjectKickoff(projectId: string): Promise<ProjectKickoffDto> {
  const project = await loadProject(projectId);
  const rules = kickoffRules(project.projectTypeSnapshotJson);
  const meeting = await prisma.kickoffMeeting.findUnique({ where: { projectId }, include: MEETING_INCLUDE });
  return {
    meeting: meeting ? await serializeMeeting(meeting, rules) : null,
    plannedKickoffDate: project.kickoffDate,
    requiredStakeholderGroups: rules.requiredStakeholderGroups,
    noticeLeadDays: rules.noticeLeadDays,
    suggestedInvitees: meeting ? [] : await suggestedKickoffInvitees(projectId),
  };
}

async function lockMeeting(tx: Tx, projectId: string) {
  await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId}::uuid FOR UPDATE`;
  return tx.kickoffMeeting.findUnique({ where: { projectId }, include: { invitees: true } });
}

export async function saveKickoffMeeting(projectId: string, webUser: WebJwtPayload, input: SaveKickoffMeetingRequest) {
  const project = await loadProject(projectId);
  await prisma.$transaction(async (tx) => {
    const existing = await lockMeeting(tx, projectId);
    if (existing?.heldAt) throw new AppError('The kick-off has been held; its record cannot change.', 409, 'KICKOFF_ALREADY_HELD');
    if (input.agendaDocumentId) await assertProjectDocument(tx, projectId, input.agendaDocumentId);
    const orgIds = [...new Set(input.invitees.map((i) => i.organizationId).filter((v): v is string => Boolean(v)))];
    if (orgIds.length) {
      const found = await tx.organization.count({ where: { id: { in: orgIds }, tenantId: project.tenantId } });
      if (found !== orgIds.length) throw new AppError('Organisation not found in this workspace', 404, 'ORGANIZATION_NOT_FOUND');
    }
    const userIds = [...new Set(input.invitees.map((i) => i.userId).filter((v): v is string => Boolean(v)))];
    if (userIds.length) {
      const found = await tx.user.count({ where: { id: { in: userIds }, tenantId: project.tenantId } });
      if (found !== userIds.length) throw new AppError('User not found in this workspace', 404, 'USER_NOT_FOUND');
    }
    const scheduledAt = new Date(input.scheduledAt);
    const moved = existing && existing.scheduledAt.getTime() !== scheduledAt.getTime();
    const data = {
      scheduledAt,
      location: input.location ?? null,
      virtualLink: input.virtualLink ?? null,
      agendaDocumentId: input.agendaDocumentId ?? null,
      // A new date needs a new notice.
      ...(moved ? { noticeSentAt: null, noticeWaivedReason: null } : {}),
    };
    const meeting = existing
      ? await tx.kickoffMeeting.update({ where: { id: existing.id }, data })
      : await tx.kickoffMeeting.create({ data: { projectId, ...data } });
    const known = new Map((existing?.invitees ?? []).map((i) => [i.id, i]));
    for (const i of input.invitees) if (i.id && !known.has(i.id)) throw new AppError('Invitee not found', 404, 'INVITEE_NOT_FOUND');
    const keep = new Set(input.invitees.map((i) => i.id).filter((v): v is string => Boolean(v)));
    const removed = [...known.keys()].filter((id) => !keep.has(id));
    if (removed.length) await tx.kickoffInvitee.deleteMany({ where: { id: { in: removed } } });
    for (const i of input.invitees) {
      const fields = {
        stakeholderGroup: i.stakeholderGroup,
        name: i.name,
        email: i.email ?? null,
        phone: i.phone ?? null,
        organizationId: i.organizationId ?? null,
        userId: i.userId ?? null,
        ...(moved ? { outboundMessageId: null } : {}),
      };
      if (i.id) await tx.kickoffInvitee.update({ where: { id: i.id }, data: fields });
      else await tx.kickoffInvitee.create({ data: { meetingId: meeting.id, ...fields } });
    }
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'KICKOFF_SCHEDULED',
      summaryText: `${existing ? 'Updated' : 'Scheduled'} the kick-off meeting for ${scheduledAt.toISOString()} with ${input.invitees.length} invitee(s)${moved ? '; the notice must be sent again' : ''}.`,
      payload: { meetingId: meeting.id, scheduledAt: scheduledAt.toISOString(), inviteeCount: input.invitees.length, rescheduled: Boolean(moved) },
    });
  });
  return getProjectKickoff(projectId);
}

function whenText(at: Date, timeZone: string) {
  const text = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
  return `${text} (${timeZone})`;
}

export async function sendKickoffNotice(projectId: string, webUser: WebJwtPayload, waiveLeadTimeReason?: string, now: Date = new Date()) {
  const project = await loadProject(projectId);
  const rules = kickoffRules(project.projectTypeSnapshotJson);
  const meeting = await prisma.kickoffMeeting.findUnique({ where: { projectId }, include: MEETING_INCLUDE });
  if (!meeting) throw new AppError('Schedule the kick-off meeting first.', 409, 'KICKOFF_NOT_SCHEDULED');
  if (meeting.heldAt) throw new AppError('The kick-off has already been held.', 409, 'KICKOFF_ALREADY_HELD');
  if (meeting.noticeSentAt) throw new AppError('The notice has already been sent for this date.', 409, 'NOTICE_ALREADY_SENT');
  const daysLeft = daysBetween(zonedCalendarDate(now, project.timezone), zonedCalendarDate(meeting.scheduledAt, project.timezone));
  if (daysLeft < rules.noticeLeadDays && !waiveLeadTimeReason) {
    throw new AppError(
      `The notice should go out at least ${rules.noticeLeadDays} day(s) before the meeting; ${daysLeft} remain. Give a reason to send it anyway.`,
      422,
      'NOTICE_LEAD_TIME_SHORT',
      { daysLeft, noticeLeadDays: rules.noticeLeadDays }
    );
  }
  const documentsUrl = `${env.WEB_APP_BASE_URL}/app/projects/${projectId}/documents`;
  // Messages are recorded and delivered by the messaging service (outside the transaction).
  const sent: Array<{ inviteeId: string; messageId: string | null; status: string }> = [];
  for (const i of meeting.invitees) {
    if (!i.email) {
      sent.push({ inviteeId: i.id, messageId: null, status: 'NO_EMAIL' });
      continue;
    }
    const outcome = await sendMessage({
      tenantId: project.tenantId,
      projectId,
      channel: 'EMAIL',
      to: i.email,
      templateKey: 'KICKOFF_NOTICE',
      data: {
        recipientName: i.name,
        projectName: project.name,
        projectCode: project.codePrefix,
        whenText: whenText(meeting.scheduledAt, project.timezone),
        location: meeting.location,
        virtualLink: meeting.virtualLink,
        agendaTitle: meeting.agendaDocument?.title ?? null,
        documentsUrl: i.userId ? documentsUrl : null,
      },
    });
    sent.push({ inviteeId: i.id, messageId: 'messageId' in outcome ? outcome.messageId : null, status: outcome.status });
  }
  await prisma.$transaction(async (tx) => {
    for (const s of sent) {
      if (s.messageId) await tx.kickoffInvitee.update({ where: { id: s.inviteeId }, data: { outboundMessageId: s.messageId } });
    }
    await tx.kickoffMeeting.update({
      where: { id: meeting.id },
      data: { noticeSentAt: now, noticeWaivedReason: daysLeft < rules.noticeLeadDays ? waiveLeadTimeReason ?? null : null },
    });
    const counts = sent.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.status]: (acc[s.status] ?? 0) + 1 }), {});
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'KICKOFF_NOTICE_SENT',
      summaryText: `Sent the kick-off notice to ${counts.SENT ?? 0} invitee(s) (${counts.QUEUED ?? 0} queued, ${counts.FAILED ?? 0} failed, ${counts.NO_EMAIL ?? 0} without an email address), ${daysLeft} day(s) before the meeting${daysLeft < rules.noticeLeadDays ? ` (lead time waived: ${waiveLeadTimeReason})` : ''}.`,
      payload: { meetingId: meeting.id, daysLeft, noticeLeadDays: rules.noticeLeadDays, counts, waiveLeadTimeReason: waiveLeadTimeReason ?? null },
    });
    await autoCompleteMilestones(tx, {
      projectId,
      mode: 'AUTO_KICKOFF_NOTICE_SENT',
      at: now,
      notes: `Kick-off notice sent to ${meeting.invitees.length} invitee(s) for ${meeting.scheduledAt.toISOString().slice(0, 10)}.`,
      actor: webActor(webUser),
    });
  });
  return getProjectKickoff(projectId);
}

export async function recordKickoffHeld(projectId: string, webUser: WebJwtPayload, input: RecordKickoffHeldRequest) {
  const project = await loadProject(projectId);
  const rules = kickoffRules(project.projectTypeSnapshotJson);
  const minutesRecipients: Array<{ name: string; email: string }> = [];
  let minutesTitle: string | null = null;
  await prisma.$transaction(async (tx) => {
    const meeting = await lockMeeting(tx, projectId);
    if (!meeting) throw new AppError('Schedule the kick-off meeting first.', 409, 'KICKOFF_NOT_SCHEDULED');
    if (meeting.heldAt) throw new AppError('The kick-off has already been recorded as held.', 409, 'KICKOFF_ALREADY_HELD');
    const byId = new Map(meeting.invitees.map((i) => [i.id, i]));
    for (const a of input.attendance) if (!byId.has(a.inviteeId)) throw new AppError('Invitee not found', 404, 'INVITEE_NOT_FOUND');
    const attended = new Set(input.attendance.filter((a) => a.attended).map((a) => a.inviteeId));
    const groups = meeting.invitees.filter((i) => attended.has(i.id)).map((i) => i.stakeholderGroup as KickoffStakeholderGroup);
    const quorumMet = kickoffQuorumMet(rules.requiredStakeholderGroups, groups);
    if (!quorumMet && !input.quorumWaivedReason) {
      const missing = rules.requiredStakeholderGroups.filter((g) => !groups.includes(g));
      throw new AppError(
        `No attendee from: ${missing.join(', ')}. Record a waiver reason to hold the kick-off without quorum.`,
        422,
        'QUORUM_NOT_MET',
        { missingGroups: missing }
      );
    }
    if (input.minutesDocumentId) minutesTitle = (await assertProjectDocument(tx, projectId, input.minutesDocumentId)).title;
    const heldAt = new Date(input.heldAt);
    for (const i of meeting.invitees) {
      await tx.kickoffInvitee.update({ where: { id: i.id }, data: { attended: attended.has(i.id) } });
    }
    await tx.kickoffMeeting.update({
      where: { id: meeting.id },
      data: {
        heldAt,
        quorumMet,
        quorumWaivedReason: quorumMet ? null : input.quorumWaivedReason ?? null,
        minutesDocumentId: input.minutesDocumentId ?? null,
      },
    });
    const heldDate = zonedCalendarDate(heldAt, project.timezone);
    const moveAnchor = input.moveKickoffAnchor && heldDate !== project.kickoffDate;
    await tx.project.update({
      where: { id: projectId },
      data: { kickoffHeldAt: heldAt, ...(moveAnchor ? { kickoffDate: heldDate } : {}) },
    });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'KICKOFF_HELD',
      summaryText: `Recorded the kick-off as held on ${heldDate} with ${attended.size} of ${meeting.invitees.length} invitee(s) present; quorum ${quorumMet ? 'met' : `not met (waived: ${input.quorumWaivedReason})`}.`,
      payload: {
        meetingId: meeting.id,
        heldAt: heldAt.toISOString(),
        attendedCount: attended.size,
        quorumMet,
        quorumWaivedReason: quorumMet ? null : input.quorumWaivedReason ?? null,
        minutesDocumentId: input.minutesDocumentId ?? null,
        kickoffDateMovedFrom: moveAnchor ? project.kickoffDate : null,
      },
    });
    const actor = webActor(webUser);
    if (moveAnchor) {
      await recomputeAndAudit(tx, projectId, actor, `the kick-off was held on ${heldDate} instead of ${project.kickoffDate ?? 'an unset date'}.`);
    }
    await autoCompleteMilestones(tx, {
      projectId,
      mode: 'AUTO_KICKOFF_QUORUM',
      at: heldAt,
      notes: quorumMet ? 'Kick-off held with quorum.' : `Kick-off held without quorum (waived: ${input.quorumWaivedReason}).`,
      actor,
    });
    if (input.minutesDocumentId) {
      for (const i of meeting.invitees) {
        if (attended.has(i.id) && i.userId && i.email) minutesRecipients.push({ name: i.name, email: i.email });
      }
    }
  });
  // Sign-off requests to attendees with accounts (after commit; messaging records its own rows).
  for (const r of minutesRecipients) {
    await sendMessage({
      tenantId: project.tenantId,
      projectId,
      channel: 'EMAIL',
      to: r.email,
      templateKey: 'MINUTES_SIGN_OFF',
      data: {
        recipientName: r.name,
        projectName: project.name,
        projectCode: project.codePrefix,
        minutesTitle: minutesTitle ?? 'Kick-off minutes',
        documentsUrl: `${env.WEB_APP_BASE_URL}/app/projects/${projectId}/documents`,
      },
    });
  }
  return getProjectKickoff(projectId);
}
