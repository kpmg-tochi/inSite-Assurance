import { z } from 'zod';

/**
 * The project schedule badge. Phase 9's baseline, earned-schedule variance and revisions were
 * removed in redesign R2d: the badge is computed from sprints by the schedule-variance job
 * (`sprintScheduleStatus` in utils/scope.ts) and shown on the directory, dashboard and portfolio.
 */

export const ScheduleStatusEnum = z.enum(['NOT_STARTED', 'ON_TRACK', 'AHEAD', 'BEHIND', 'COMPLETE', 'UNSCHEDULED']);
export type ScheduleStatusValue = z.infer<typeof ScheduleStatusEnum>;

export const SCHEDULE_STATUS_META: Record<ScheduleStatusValue, { label: string; tone: 'positive' | 'neutral' | 'warning' | 'critical' | 'muted' }> = {
  NOT_STARTED: { label: 'Not started', tone: 'neutral' },
  ON_TRACK: { label: 'On track', tone: 'positive' },
  // Legacy value (earned schedule); sprints never produce it.
  AHEAD: { label: 'Ahead', tone: 'positive' },
  BEHIND: { label: 'Behind', tone: 'critical' },
  COMPLETE: { label: 'Complete', tone: 'positive' },
  UNSCHEDULED: { label: 'No work phases', tone: 'muted' },
};

/** The badge shown on the directory, dashboard and portfolio map. */
export const ScheduleVarianceBadgeSchema = z.object({
  status: ScheduleStatusEnum,
  /** e.g. "On track", "Behind: 2 units late". */
  label: z.string(),
  computedAt: z.string().nullable(),
});
export type ScheduleVarianceBadge = z.infer<typeof ScheduleVarianceBadgeSchema>;
