import { z } from 'zod';

/**
 * UBEC IRL portal output 5: early-warning alerts. A project's active alerts are stored in
 * `Project.alertStateJson` (`{ [alertKey]: ISO time raised }`) by the `project-alerts` job (and the
 * `schedule-variance` job for DELAYED): an alert is sent once when its condition starts and the key
 * is removed when the condition clears, so a later occurrence alerts again. Rules: `utils/projectAlerts.ts`.
 */

export const ProjectAlertKeyEnum = z.enum(['DELAYED', 'STALLED', 'SITE_UPDATE_OVERDUE', 'SPEND_AHEAD_OF_PROGRESS']);
export type ProjectAlertKey = z.infer<typeof ProjectAlertKeyEnum>;
export const PROJECT_ALERT_KEYS: readonly ProjectAlertKey[] = ProjectAlertKeyEnum.options;

export interface ProjectAlertMeta {
  label: string;
  /** One sentence for tooltips and screen readers. */
  description: string;
  /** Web notification category sent when the alert is raised. */
  webCategory: 'SCHEDULE_BEHIND' | 'PROJECT_STALLED' | 'SITE_UPDATE_OVERDUE' | 'SPEND_AHEAD_OF_PROGRESS';
  /** Web users holding this permission on the project get the notification. */
  notifyPermission: string;
  /** Also sent to the project's field officers (mobile notification and push). */
  notifiesFieldOfficers: boolean;
  /** Who may see the alert as a chip (null = anyone who sees the project). */
  viewPermissions: readonly string[] | null;
}

export const PROJECT_ALERT_META: Record<ProjectAlertKey, ProjectAlertMeta> = {
  DELAYED: {
    label: 'Delayed',
    description: 'Behind schedule: a facility unit due by a sprint that has ended is not complete.',
    webCategory: 'SCHEDULE_BEHIND',
    notifyPermission: 'sprints:view_status',
    notifiesFieldOfficers: false,
    viewPermissions: null,
  },
  STALLED: {
    label: 'Stalled',
    description: 'No progress has been recorded by an accepted visit for longer than the type allows.',
    webCategory: 'PROJECT_STALLED',
    notifyPermission: 'findings:receive_escalations',
    notifiesFieldOfficers: true,
    viewPermissions: null,
  },
  SITE_UPDATE_OVERDUE: {
    label: 'Site update overdue',
    description: 'No visit has been accepted for longer than the type allows.',
    webCategory: 'SITE_UPDATE_OVERDUE',
    notifyPermission: 'visits:plan',
    notifiesFieldOfficers: true,
    viewPermissions: null,
  },
  SPEND_AHEAD_OF_PROGRESS: {
    label: 'Spend ahead of progress',
    description: 'The share of the contract sum paid is further ahead of the % complete than the type allows.',
    webCategory: 'SPEND_AHEAD_OF_PROGRESS',
    notifyPermission: 'payments:view',
    notifiesFieldOfficers: false,
    viewPermissions: ['payments:view', 'payments:record'],
  },
};

/** Type key `monitoring.alerts`: one switch per alert and its threshold. Every key is defaulted. */
export const ProjectAlertsConfigSchema = z.object({
  delayed: z
    .object({
      enabled: z.boolean().default(true),
    })
    .default({}),
  stalled: z
    .object({
      enabled: z.boolean().default(true),
      /** Calendar days without an accepted visit that raised unit progress, counted from the first sprint's start. */
      days: z.number().int().min(7).max(365).default(30),
    })
    .default({}),
  siteUpdateOverdue: z
    .object({
      enabled: z.boolean().default(true),
      /** Calendar days without an accepted visit, counted from activation. */
      days: z.number().int().min(3).max(180).default(14),
    })
    .default({}),
  spendAheadOfProgress: z
    .object({
      enabled: z.boolean().default(true),
      /** Percentage points by which paid % of the contract sum may exceed % complete. */
      percentagePoints: z.number().min(1).max(100).default(15),
    })
    .default({}),
});
export type ProjectAlertsConfig = z.infer<typeof ProjectAlertsConfigSchema>;
export type ProjectAlertsConfigInput = z.input<typeof ProjectAlertsConfigSchema>;
export const DEFAULT_PROJECT_ALERTS_CONFIG: ProjectAlertsConfig = ProjectAlertsConfigSchema.parse({});
