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

type PrismaTransactionOrClient = Prisma.TransactionClient | typeof prisma;

function serializeNotification(row: {
  id: string;
  projectId: string;
  fieldSessionId: string | null;
  type: string;
  actionType: string;
  requiresAction: boolean;
  title: string;
  message: string;
  metadata: unknown;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}): MobileNotificationDto {
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
    isRead: row.isRead,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Creates a persisted notification record in PostgreSQL inside any transaction or standalone call.
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
  const created = await db.mobileNotification.create({
    data: {
      projectId: input.projectId,
      fieldSessionId: input.fieldSessionId ?? null,
      type: input.type,
      actionType: input.actionType,
      requiresAction: input.requiresAction ?? false,
      title: input.title,
      message: input.message,
      metadata: (input.metadata ?? {}) as unknown as Prisma.InputJsonValue,
      isRead: input.isRead ?? false,
      readAt: input.readAt ?? null,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  });

  return serializeNotification(created);
}

/**
 * Lists notifications for a project (scoped to the caller's field session + project-wide broadcasts),
 * ordered unread-first, then most recent first.
 */
export async function listProjectNotifications(
  projectId: string,
  fieldSessionId: string
): Promise<MobileNotificationDto[]> {
  const rows = await prisma.mobileNotification.findMany({
    where: {
      projectId,
      OR: [{ fieldSessionId: null }, { fieldSessionId }],
    },
    orderBy: [{ isRead: 'asc' }, { createdAt: 'desc' }],
    take: 100,
  });

  return rows.map(serializeNotification);
}

/**
 * Marks a notification as read on tap (only permitted when requiresAction is false),
 * or resolves an action-required notification once the required action has completed.
 */
export async function markNotificationRead(params: {
  projectId: string;
  fieldSessionId: string;
  notificationId: string;
  resolvedByAction?: boolean;
}): Promise<MobileNotificationDto> {
  // A field agent may only touch notifications addressed to their session or broadcast to
  // their project.
  const existing = await prisma.mobileNotification.findFirst({
    where: {
      id: params.notificationId,
      projectId: params.projectId,
      OR: [{ fieldSessionId: null }, { fieldSessionId: params.fieldSessionId }],
    },
  });

  if (!existing) {
    throw new AppError(
      'Notification not found for this project',
      404,
      'NOTIFICATION_NOT_FOUND'
    );
  }

  if (existing.requiresAction && !params.resolvedByAction) {
    throw new AppError(
      'This notification requires completing its action before it can be marked as read.',
      400,
      'NOTIFICATION_ACTION_REQUIRED'
    );
  }

  if (existing.isRead) {
    return serializeNotification(existing);
  }

  const updated = await prisma.mobileNotification.update({
    where: { id: existing.id },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });

  return serializeNotification(updated);
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
  }
): Promise<WebNotificationDto> {
  const created = await db.webNotification.create({
    data: {
      projectId: input.projectId,
      targetPermissionKey: input.targetPermissionKey ?? 'reports:view_all',
      targetRoleId: input.targetRoleId ?? null,
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
    OR: [
      { targetRoleId: webUser.roleId },
      {
        targetRoleId: null,
        targetPermissionKey: { in: webUser.permissions },
      },
    ],
  };
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
      projectId: params.projectId,
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
      projectId: params.projectId,
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
      projectId: params.projectId,
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
