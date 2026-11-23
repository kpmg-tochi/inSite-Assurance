import { zonedCalendarDate } from '@insite/shared';
import { prisma } from '../config/prisma';
import { sendOverdueDefectReminders } from '../modules/closeout/defects.service';
import { JobContext, registerJob, runUnit } from './runner';
import { sweepClosurePacks } from '../modules/completion/closurePack.service';

/**
 * defect-reminders (Phase 10 Step 6): once a day per project in handover or its defects liability
 * period (keyed on the project's calendar day). The monitoring side gets one summary of every
 * overdue ticket; each liable contractor gets a reminder about its own overdue tickets only (its
 * web users and the field sessions joined through its join codes). Projects with the retention
 * module off are skipped.
 */
export async function runDefectReminders({ now }: JobContext): Promise<void> {
  const projects = await prisma.project.findMany({
    where: {
      status: 'ACTIVE',
      constructionPhase: { in: ['HANDOVER_IN_PROGRESS', 'RETENTION_PERIOD'] },
      tenant: { status: { not: 'SUSPENDED' } },
      processConfig: { enableRetentionModule: true },
    },
    select: { id: true, codePrefix: true, timezone: true },
  });
  for (const p of projects) {
    const today = zonedCalendarDate(now, p.timezone);
    await runUnit('defect-reminders', `${p.id}:${today}`, async () => {
      const count = await sendOverdueDefectReminders(p.id, p.codePrefix, today, now);
      return count === 0 ? 'none overdue' : `${count} overdue`;
    });
  }
}

export function registerCloseoutJobs(): void {
  registerJob({ name: 'defect-reminders', intervalMs: 60 * 60 * 1000, run: runDefectReminders });
  // Phase 15: closure packs left queued (e.g. by a restart) run; stuck ones are failed.
  registerJob({
    name: 'closure-packs',
    intervalMs: 5 * 60 * 1000,
    run: async ({ now }) => {
      await runUnit('closure-packs', now.toISOString().slice(0, 16), () => sweepClosurePacks(now));
    },
  });
}
