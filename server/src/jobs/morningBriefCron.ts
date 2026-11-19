import { calendarDateInTimeZone, timeZoneOffsetMinutes } from '@insite/shared';
import { prisma } from '../config/prisma';
import { briefPersonasForProject, generateDailyDispatchForProject } from '../modules/morning-briefs/morningBrief.service';

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // Every 15 minutes

/** Minutes since local midnight in the project's IANA zone. */
function minutesNowInZone(timeZone: string, now = new Date()): number {
  const local = new Date(now.getTime() + timeZoneOffsetMinutes(timeZone, now) * 60_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

function parseHhMmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((n) => Number(n));
  if (Number.isNaN(h) || Number.isNaN(m)) return 8 * 60;
  return h * 60 + m;
}

export async function runMorningBriefCronTick(): Promise<void> {
  try {
    const now = new Date();
    // Scheduled jobs only ever touch live projects (Phase 6).
    const projects = await prisma.project.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, workdayStartTime: true, timezone: true },
    });

    for (const project of projects) {
      const startMinutes = parseHhMmToMinutes(project.workdayStartTime || '08:00');
      const today = calendarDateInTimeZone(now, project.timezone);
      // Dispatch once the project's local time has reached workdayStartTime (or catch up later).
      if (minutesNowInZone(project.timezone, now) >= startMinutes) {
        // Phase 7: one dispatch per persona that reports on the project.
        for (const persona of await briefPersonasForProject(project.id)) {
          const existingCount = await prisma.morningDeliverableBrief.count({
            where: { projectId: project.id, workdayDate: today, targetPersona: persona },
          });
          if (existingCount === 0) {
            await generateDailyDispatchForProject(project.id, today, [persona]);
          }
        }
      }
    }
  } catch (err) {
    console.warn('MorningBriefCron tick skipped:', err);
  }
}

export function startMorningBriefCron(): () => void {
  const timer = setInterval(() => {
    runMorningBriefCronTick().catch(() => {});
  }, CHECK_INTERVAL_MS);

  return () => clearInterval(timer);
}

