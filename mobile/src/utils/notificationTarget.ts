import { ProjectAlertKeyEnum, type MobileNotificationDto, type ProjectAlertKey } from "@insite/shared";

/**
 * Where a notification in the notification centre leads (pure, Node-tested). UBEC IRL: an
 * early-warning alert (STALLED, SITE_UPDATE_OVERDUE) is a project broadcast with action NONE and
 * `metadata.alertKey`; it opens the project.
 */

export type NotificationTarget =
  | { screen: "Visit"; visitId: string }
  | { screen: "Defects"; projectId: string }
  | { screen: "Project"; projectId: string };

type NotificationLike = Pick<MobileNotificationDto, "actionType" | "projectId" | "metadata">;

/** The early-warning alert a notification is about, or null. */
export function projectAlertOf(n: Pick<MobileNotificationDto, "metadata">): ProjectAlertKey | null {
  const parsed = ProjectAlertKeyEnum.safeParse(n.metadata?.alertKey);
  return parsed.success ? parsed.data : null;
}

/** The screen to open, or null when tapping only marks the notification read. */
export function notificationTarget(n: NotificationLike): NotificationTarget | null {
  if (n.actionType === "OPEN_VISIT" && n.metadata?.visitId) return { screen: "Visit", visitId: n.metadata.visitId };
  if (n.actionType === "OPEN_DEFECTS") return { screen: "Defects", projectId: n.projectId };
  if (projectAlertOf(n)) return { screen: "Project", projectId: n.projectId };
  return null;
}

/** Badge text for an alert notification. */
export const PROJECT_ALERT_BADGE: Record<ProjectAlertKey, string> = {
  DELAYED: "Delayed",
  STALLED: "Stalled",
  SITE_UPDATE_OVERDUE: "Monitoring overdue",
  SPEND_AHEAD_OF_PROGRESS: "Paid ahead of work done",
};
