import {
  MobileNotificationDto,
  MobileNotificationMetadata,
  MobileNotificationType,
  NotificationActionType,
  WebNotificationCategory,
  WebNotificationDto,
} from '@insite/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { markNotificationActionedById } from './notificationActions';
import { ALL_PROJECTS_SENTINEL, buildProjectVisibilityWhere } from '../../utils/accessControl';

type PrismaTransactionOrClient = Prisma.TransactionClient | typeof prisma;

type MobileNotificationRow = Prisma.MobileNotificationGetPayload<object> & {
  /** Reads by the viewing session only (0 or 1 row). */
  reads?: Array<{ readAt: Date }>;
};

/** Read state is per field session: `isRead` means "read by the viewer". */
function serializeNotification(row: MobileNotificationRow): MobileNotificationDto {
  const readAt = row.reads && row.reads.length > 0 ? row.reads[0].readAt : null;
  return {
    id: row.id,
    projectId: row.projectId,
    fieldSessionId: row.fieldSessionId,
    type: row.type as MobileNotificationType,
    actionType: row.actionType as NotificationActionType,
    requiresAction: row.requiresAction,
    title: row.title,
    message: row.message,
    metadata: (row.metadata as MobileNotificationMetadata) ?? {},
    isRead: readAt !== null || row.actionedAt !== null,
    readAt: readAt ? readAt.toISOString() : null,
    actionedAt: row.actionedAt ? row.actionedAt.toISOString() : null,
    actionedByName: row.actionedByName,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Creates a notification. `isRead` (seed and history only) records it as read by its addressee;
 * it has no effect on a broadcast, which starts unread for every session.
 */
export async function createMobileNotification(
  db: PrismaTransactionOrClient,
  input: {
    projectId: string;
    fieldSessionId?: string | null;
    type: MobileNotificationType;
    actionType: NotificationActionType;
    requiresAction?: boolean;
    title: string;
    message: string;
    metadata?: MobileNotificationMetadata;
    isRead?: boolean;
    readAt?: Date | null;
    createdAt?: Date;
  }
): Promise<MobileNotificationDto> {
  const fieldSessionId = input.fieldSessionId ?? null;
  const markRead = Boolean(input.isRead && fieldSessionId);
  const created = await db.mobileNotification.create({
    data: {
      projectId: input.projectId,
      fieldSessionId,
      type: input.type,
      actionType: input.actionType,
      requiresAction: input.requiresAction ?? false,
      title: input.title,
      message: input.message,
      metadata: (input.metadata ?? {}) as unknown as Prisma.InputJsonValue,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      ...(markRead
        ? { reads: { create: { fieldSessionId: fieldSessionId!, readAt: input.readAt ?? new Date() } } }
        : {}),
    },
    include: { reads: true },
  });
  return serializeNotification(created);
}

/** Marks the given notifications read for one session (idempotent). */
export async function markNotificationsReadForSession(
  db: PrismaTransactionOrClient,
  fieldSessionId: string,
  notificationIds: string[]
): Promise<void> {
  if (notificationIds.length === 0) return;
  await db.mobileNotificationRead.createMany({
    data: notificationIds.map((notificationId) => ({ notificationId, fieldSessionId })),
    skipDuplicates: true,
  });
}

/**
 * Notifications for the caller's session plus project-wide broadcasts, unread first, newest first.
 * Read state is the caller's own.
 */
export async function listProjectNotifications(
  projectId: string,
  fieldSessionId: string
): Promise<MobileNotificationDto[]> {
  const rows = await prisma.mobileNotification.findMany({
    where: { projectId, OR: [{ fieldSessionId: null }, { fieldSessionId }] },
    include: { reads: { where: { fieldSessionId }, select: { readAt: true }, take: 1 } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return rows.map(serializeNotification).sort((a, b) => Number(a.isRead) - Number(b.isRead));
}

/** Resolving an action-required notification from the app completes it for everyone. */
export async function markNotificationActionedFromApp(params: {
  projectId: string;
  fieldSessionId: string;
  agentFullName: string;
  notificationId: string;
}): Promise<MobileNotificationDto> {
  const dto = await markNotificationRead({ ...params, resolvedByAction: true });
  if (dto.requiresAction) {
    await markNotificationActionedById(prisma, dto.id, {
      sessionId: params.fieldSessionId,
      name: params.agentFullName,
    });
  }
  const row = await prisma.mobileNotification.findUniqueOrThrow({
    where: { id: dto.id },
    include: { reads: { where: { fieldSessionId: params.fieldSessionId }, select: { readAt: true }, take: 1 } },
  });
  return serializeNotification(row);
}

/**
 * Marks a notification read for the caller (only when no action is required), or records that
 * an action-required notification was resolved by completing its action.
 */
export async function markNotificationRead(params: {
  projectId: string;
  fieldSessionId: string;
  notificationId: string;
  resolvedByAction?: boolean;
}): Promise<MobileNotificationDto> {
  const existing = await prisma.mobileNotification.findFirst({
    where: {
      id: params.notificationId,
      projectId: params.projectId,
      OR: [{ fieldSessionId: null }, { fieldSessionId: params.fieldSessionId }],
    },
  });
  if (!existing) {
    throw new AppError('Notification not found for this project', 404, 'NOTIFICATION_NOT_FOUND');
  }
  if (existing.requiresAction && !params.resolvedByAction) {
    throw new AppError(
      'This notification requires completing its action before it can be marked as read.',
      400,
      'NOTIFICATION_ACTION_REQUIRED'
    );
  }
  await markNotificationsReadForSession(prisma, params.fieldSessionId, [existing.id]);
  const row = await prisma.mobileNotification.findUniqueOrThrow({
    where: { id: existing.id },
    include: { reads: { where: { fieldSessionId: params.fieldSessionId }, select: { readAt: true }, take: 1 } },
  });
  return serializeNotification(row);
}

type WebNotificationRow = Prisma.WebNotificationGetPayload<object> & {
  reads?: Array<{ readAt: Date }>;
};

function serializeWebNotification(row: WebNotificationRow): WebNotificationDto {
  const readAt = row.reads && row.reads.length > 0 ? row.reads[0].readAt : null;
  return {
    id: row.id,
    projectId: row.projectId,
    targetPermissionKey: row.targetPermissionKey,
    targetRoleId: row.targetRoleId,
    category: row.category as WebNotificationCategory,
    title: row.title,
    description: row.description,
    actionUrl: row.actionUrl,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    isRead: readAt !== null,
    readAt: readAt ? readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createWebNotification(
  db: PrismaTransactionOrClient,
  input: {
    projectId: string;
    targetPermissionKey?: string;
    targetRoleId?: string | null;
    category: WebNotificationCategory;
    title: string;
    description: string;
    actionUrl?: string | null;
    metadata?: Record<string, unknown>;
    createdAt?: Date;
    /** Phase 10: only this organisation's users (e.g. the contractor a defect is assigned to). */
    targetOrganizationId?: string | null;
    /** Phase 10: monitoring side only; hidden from users whose organisation is a project contractor. */
    hideFromProjectContractors?: boolean;
  }
): Promise<WebNotificationDto> {
  const created = await db.webNotification.create({
    data: {
      projectId: input.projectId,
      targetPermissionKey: input.targetPermissionKey ?? 'reports:view_all',
      targetRoleId: input.targetRoleId ?? null,
      targetOrganizationId: input.targetOrganizationId ?? null,
      hideFromProjectContractors: input.hideFromProjectContractors ?? false,
      category: input.category,
      title: input.title,
      description: input.description,
      actionUrl: input.actionUrl ?? null,
      metadata: (input.metadata ?? {}) as unknown as Prisma.InputJsonValue,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  });
  return serializeWebNotification(created);
}

function buildWebNotificationFilter(webUser: WebJwtPayload): Prisma.WebNotificationWhereInput {
  if (webUser.isPlatformSuperAdmin) {
    return {};
  }
  return {
    AND: [
      {
        OR: [
          { targetRoleId: webUser.roleId },
          {
            targetRoleId: null,
            targetPermissionKey: { in: webUser.permissions },
          },
        ],
      },
      // Phase 10: organisation targeting (contractor-facing) and monitoring-side-only notifications.
      { OR: [{ targetOrganizationId: null }, { targetOrganizationId: webUser.organizationId }] },
      {
        OR: [
          { hideFromProjectContractors: false },
          { project: { contractors: { none: { organizationId: webUser.organizationId } } } },
        ],
      },
    ],
  };
}

/**
 * The project part of a web-notification query. 'all' (the cross-project bell) means every live
 * or archived project the user can see, through the same visibility rule as the directory.
 */
function webNotificationProjectScope(projectId: string, webUser: WebJwtPayload): Prisma.WebNotificationWhereInput {
  if (projectId === ALL_PROJECTS_SENTINEL) {
    return { project: buildProjectVisibilityWhere(webUser, undefined, { statuses: ['ACTIVE', 'ARCHIVED'] }) };
  }
  return { projectId };
}

function readsForUser(userId: string) {
  return { where: { userId }, select: { readAt: true }, take: 1 } as const;
}

export async function listWebNotifications(params: {
  projectId: string;
  webUser: WebJwtPayload;
}): Promise<WebNotificationDto[]> {
  const rows = await prisma.webNotification.findMany({
    where: {
      ...webNotificationProjectScope(params.projectId, params.webUser),
      ...buildWebNotificationFilter(params.webUser),
    },
    include: { reads: readsForUser(params.webUser.userId) },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  // Unread first, newest first within each group.
  return rows
    .map(serializeWebNotification)
    .sort((a, b) => Number(a.isRead) - Number(b.isRead));
}

export async function markWebNotificationRead(params: {
  projectId: string;
  notificationId: string;
  webUser: WebJwtPayload;
}): Promise<WebNotificationDto> {
  const existing = await prisma.webNotification.findFirst({
    where: {
      id: params.notificationId,
      ...webNotificationProjectScope(params.projectId, params.webUser),
      ...buildWebNotificationFilter(params.webUser),
    },
  });
  if (!existing) {
    throw new AppError('Web notification not found', 404, 'NOTIFICATION_NOT_FOUND');
  }
  await prisma.webNotificationRead.upsert({
    where: {
      notificationId_userId: { notificationId: existing.id, userId: params.webUser.userId },
    },
    create: { notificationId: existing.id, userId: params.webUser.userId },
    update: {},
  });
  const refreshed = await prisma.webNotification.findUniqueOrThrow({
    where: { id: existing.id },
    include: { reads: readsForUser(params.webUser.userId) },
  });
  return serializeWebNotification(refreshed);
}

export async function markAllWebNotificationsRead(params: {
  projectId: string;
  webUser: WebJwtPayload;
}): Promise<{ count: number }> {
  const unread = await prisma.webNotification.findMany({
    where: {
      ...webNotificationProjectScope(params.projectId, params.webUser),
      ...buildWebNotificationFilter(params.webUser),
      reads: { none: { userId: params.webUser.userId } },
    },
    select: { id: true },
  });
  if (unread.length === 0) {
    return { count: 0 };
  }
  const result = await prisma.webNotificationRead.createMany({
    data: unread.map((n) => ({ notificationId: n.id, userId: params.webUser.userId })),
    skipDuplicates: true,
  });
  return { count: result.count };
}
