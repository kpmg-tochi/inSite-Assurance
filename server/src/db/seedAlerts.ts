import { prisma } from "../config/prisma";
import { LIVE_PROJECT_WHERE } from "../jobs/cadenceJobs";
import { VISIT_PROJECT_WHERE } from "../jobs/visitJobs";
import { describeAlertSync, syncProjectAlerts } from "../modules/alerts/projectAlerts.service";
import { refreshScheduleBadge } from "../modules/schedule/schedule.service";

/**
 * UBEC IRL early-warning alerts (runs last). Runs what the `schedule-variance` and `project-alerts`
 * jobs would do today, through the same services, so the seeded projects show the alerts their
 * data calls for (stalled, site update overdue, spend ahead of progress, delayed) with their
 * notifications. No JobRun rows are written, so the jobs still run normally on the server and in
 * tests.
 */
export async function seedAlerts(now: Date = new Date()): Promise<void> {
  const live = await prisma.project.findMany({ where: LIVE_PROJECT_WHERE, select: { id: true } });
  for (const p of live) await refreshScheduleBadge(p.id, now);
  const projects = await prisma.project.findMany({ where: VISIT_PROJECT_WHERE, select: { id: true, codePrefix: true }, orderBy: { codePrefix: "asc" } });
  const lines: string[] = [];
  for (const p of projects) {
    const r = await syncProjectAlerts(p.id, now);
    if (r.active.length) lines.push(`${p.codePrefix} (${describeAlertSync(r)})`);
  }
  console.log(`   • Early-warning alerts: ${lines.length ? lines.join("; ") : "none"}`);
}
