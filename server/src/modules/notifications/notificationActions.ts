import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Phase 5 Step 8: an action-required notification is "actioned" once anyone completes the action
 * it asks for. It then shows as done for every field session ("Answered by {name}") and stops
 * counting as unread or action-required. This is the one place that maps each action-required
 * notification to the event that completes it.
 *
 * | Notification                                   | Completed by                           |
 * | ---------------------------------------------- | -------------------------------------- |
 * | REPORT_QUERY with `monitorQueryId` (broadcast) | monitor query responded or resolved    |
 * | REPORT_QUERY with `reportQueryId`              | report query resubmitted or resolved   |
 * | ASSURANCE_REJECTED (personal)                  | identity resubmitted                   |
 */
export type NotificationActionEvent =
  | { kind: 'MONITOR_QUERY_ANSWERED'; monitorQueryId: string }
  | { kind: 'REPORT_QUERY_ANSWERED'; reportQueryId: string };

export interface NotificationActor {
  sessionId?: string | null;
  userId?: string | null;
  name: string;
}

function whereFor(event: NotificationActionEvent): Prisma.MobileNotificationWhereInput {
  switch (event.kind) {
    case 'MONITOR_QUERY_ANSWERED':
      return { type: 'REPORT_QUERY', metadata: { path: ['monitorQueryId'], equals: event.monitorQueryId } };
    case 'REPORT_QUERY_ANSWERED':
      return { type: 'REPORT_QUERY', metadata: { path: ['reportQueryId'], equals: event.reportQueryId } };
  }
}

function actionedData(actor: NotificationActor) {
  return {
    actionedAt: new Date(),
    actionedBySessionId: actor.sessionId ?? null,
    actionedByUserId: actor.userId ?? null,
    actionedByName: actor.name,
  };
}

/** Marks every open action-required notification completed by `event`. Returns how many. */
export async function markNotificationsActioned(
  db: Db,
  projectId: string,
  event: NotificationActionEvent,
  actor: NotificationActor
): Promise<number> {
  const result = await db.mobileNotification.updateMany({
    where: { projectId, requiresAction: true, actionedAt: null, ...whereFor(event) },
    data: actionedData(actor),
  });
  return result.count;
}

/** One notification completed from the app's notification centre (the `/resolve` route). */
export async function markNotificationActionedById(
  db: Db,
  notificationId: string,
  actor: NotificationActor
): Promise<void> {
  await db.mobileNotification.updateMany({
    where: { id: notificationId, requiresAction: true, actionedAt: null },
    data: actionedData(actor),
  });
}
