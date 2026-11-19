import {
  addDays,
  addWorkdays,
  validateScheduleBaseline,
  windowEnd,
  workWeekLength,
  zonedCalendarDate,
} from "@insite/shared";
import { prisma } from "../config/prisma";
import type { WebJwtPayload } from "../middleware/auth.middleware";
import { refreshScheduleBadge, saveScheduleBaseline } from "../modules/schedule/schedule.service";
import { createScheduleRevision } from "../modules/schedule/scheduleRevision.service";

/**
 * Phase 9 seed, relative to today so the badges stay meaningful whenever the seed runs:
 * - ABJ-108 on schedule: each item's planned window is placed so that its certified progress is
 *   exactly what the plan expects today (complete items finished on their planned end).
 * - LKK-402 four working weeks behind: every item's window opened four weeks (24 working days on
 *   its Monday to Saturday week) earlier than its progress justifies, with a pending "Catch Project
 *   Up" revision proposed by the monitor and waiting for the lender.
 * Baselines and the revision go through the real services, so validation and audit apply.
 */

const ITEM_DURATION_WORKDAYS = 60;

async function webUserPayload(email: string): Promise<WebJwtPayload> {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { role: true } });
  return {
    tokenType: "WEB_USER",
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    tenantId: user.tenantId,
    isPlatformSuperAdmin: false,
    roleId: user.roleId,
    roleCode: user.role.code,
    roleName: user.role.name,
    permissions: [],
    organizationId: user.organizationId,
    mustChangePassword: false,
  };
}

/**
 * Dates for one item so that, at `today`, it is `behindWorkdays` behind given `progressPct`:
 * working days elapsed before today = progress x duration + behind.
 */
function windowFor(today: string, progressPct: number, behindWorkdays: number, week: number[]) {
  const elapsed = Math.round((progressPct / 100) * ITEM_DURATION_WORKDAYS) + behindWorkdays;
  const start = elapsed > 0 ? addWorkdays(today, -elapsed, week) : addWorkdays(today, 5, week);
  return { start, end: windowEnd(start, ITEM_DURATION_WORKDAYS, week) };
}

async function seedProjectSchedule(params: {
  codePrefix: string;
  behindWeeks: number;
  monitor: WebJwtPayload;
}) {
  const project = await prisma.project.findFirst({
    where: { codePrefix: params.codePrefix, tenantId: params.monitor.tenantId },
    select: { id: true, timezone: true, workWeekDays: true },
  });
  if (!project) return null;
  const week = project.workWeekDays;
  const today = zonedCalendarDate(new Date(), project.timezone);
  const items = await prisma.boqItem.findMany({
    where: { projectId: project.id },
    orderBy: { wbsCode: "asc" },
    select: { id: true, wbsCode: true, cumulativeCertifiedPct: true },
  });
  const behind = params.behindWeeks * workWeekLength(week);
  const dated = items.map((i) => {
    const pct = Number(i.cumulativeCertifiedPct);
    // Complete items on an on-schedule project finished on their planned end (yesterday at the latest).
    const w = pct >= 100 && behind === 0 ? windowFor(today, 100, 1, week) : windowFor(today, pct, behind, week);
    return { id: i.id, label: `WBS ${i.wbsCode}`, plannedStartDate: w.start, plannedEndDate: w.end, pct };
  });
  const projectStart = dated.map((d) => d.plannedStartDate).sort()[0];
  const projectEnd = dated.map((d) => d.plannedEndDate).sort().reverse()[0];
  // Finish-to-start links between consecutive items where the dates allow one.
  const dependencies = [];
  for (let k = 1; k < dated.length; k++) {
    const dep = { predecessorId: dated[k - 1].id, successorId: dated[k].id, lagWorkdays: 0 };
    const ok =
      validateScheduleBaseline({
        plannedStartDate: projectStart,
        plannedEndDate: projectEnd,
        items: dated,
        dependencies: [dep],
        workWeekDays: week,
      }).length === 0;
    if (ok) dependencies.push(dep);
  }
  await saveScheduleBaseline(project.id, params.monitor, {
    plannedStartDate: projectStart,
    plannedEndDate: projectEnd,
    items: dated.map((d) => ({ boqItemId: d.id, plannedStartDate: d.plannedStartDate, plannedEndDate: d.plannedEndDate })),
    dependencies: dependencies.map((d) => ({
      predecessorBoqItemId: d.predecessorId,
      successorBoqItemId: d.successorId,
      lagWorkdays: d.lagWorkdays,
    })),
  });

  // Actual dates: the first counted report on an item, else its planned start once work is certified.
  for (const d of dated) {
    const first = await prisma.workdayReport.findFirst({
      where: { wbsItemId: d.id, status: { in: ["CONFIRMED", "APPROVED_COMPLETED"] } },
      orderBy: { workdayDate: "asc" },
      select: { workdayDate: true },
    });
    const actualStart = first?.workdayDate ?? (d.pct > 0 ? d.plannedStartDate : null);
    await prisma.boqItem.update({
      where: { id: d.id },
      data: {
        actualStartDate: actualStart,
        actualCompletionDate: d.pct >= 100 ? (d.plannedEndDate < today ? d.plannedEndDate : addDays(today, -1)) : null,
      },
    });
  }
  const starts = (
    await prisma.boqItem.findMany({ where: { projectId: project.id, actualStartDate: { not: null } }, select: { actualStartDate: true } })
  )
    .map((i) => i.actualStartDate!)
    .sort();
  await prisma.project.update({ where: { id: project.id }, data: { actualStartDate: starts[0] ?? null } });
  await refreshScheduleBadge(project.id);
  return { projectId: project.id, items: dated };
}

export async function seedPhase9() {
  const monitor = await webUserPayload("monitor@insite.ng");
  await seedProjectSchedule({ codePrefix: "ABJ-108", behindWeeks: 0, monitor });
  const lkk = await seedProjectSchedule({ codePrefix: "LKK-402", behindWeeks: 4, monitor });
  if (!lkk) return;

  // Pending revision: absorb the four-week delay on the least advanced item (and everything after it).
  const target = [...lkk.items].filter((i) => i.pct < 100).sort((a, b) => a.pct - b.pct)[0];
  if (target) {
    await createScheduleRevision(lkk.projectId, monitor, {
      changes: [{ boqItemId: target.id, shiftWorkdays: 24 }],
      reason:
        "Culvert works held for four weeks by the late approval of the revised drainage design. Re-baseline the downstream works; daily production targets are unchanged.",
    });
  }
}
