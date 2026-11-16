import { prisma } from '../config/prisma';
import {
  generateDailyDispatchForProject,
  getTodayWatDateString,
} from '../modules/morning-briefs/morningBrief.service';

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // Every 15 minutes

function getCurrentWatMinutes(): number {
  const watNow = new Date(Date.now() + 60 * 60 * 1000);
  return watNow.getUTCHours() * 60 + watNow.getUTCMinutes();
}

function parseHhMmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((n) => Number(n));
  if (Number.isNaN(h) || Number.isNaN(m)) return 8 * 60;
  return h * 60 + m;
}

export async function runMorningBriefCronTick(): Promise<void> {
  try {
    const nowWatMinutes = getCurrentWatMinutes();
    const todayWat = getTodayWatDateString();

    const projects = await prisma.project.findMany({
      select: { id: true, name: true, workdayStartTime: true },
    });

    for (const project of projects) {
      const startMinutes = parseHhMmToMinutes(project.workdayStartTime || '08:00');
      // Dispatch once current WAT time has reached workdayStartTime (within 15-min window or catch-up)
      if (nowWatMinutes >= startMinutes) {
        const existingCount = await prisma.morningDeliverableBrief.count({
          where: { projectId: project.id, workdayDate: todayWat },
        });
        if (existingCount === 0) {
          await generateDailyDispatchForProject(project.id, todayWat);
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

