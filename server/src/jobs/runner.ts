import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';

/**
 * Scheduled job runner (Phase 8 Step 2).
 *
 * Jobs run inside the API process. Two guards make this safe with several API instances:
 * 1. Each tick takes a transaction-level `pg_try_advisory_xact_lock` for the job, held on one
 *    pooled connection for the tick; an instance that does not get the lock skips the tick.
 * 2. Each unit of work claims a `JobRun` row (unique on jobName + scopeKey) before doing anything,
 *    so a unit runs once even if two ticks overlap. A FAILED unit can be claimed again.
 *
 * A future worker process can own the jobs by setting JOBS_ENABLED=false on the API instances.
 * Job code does not depend on how it is scheduled: `runJobOnce(name)` runs one tick directly.
 */

export interface JobContext {
  now: Date;
}

export interface JobDefinition {
  name: string;
  intervalMs: number;
  run: (ctx: JobContext) => Promise<void>;
}

const registry = new Map<string, JobDefinition>();

export function registerJob(job: JobDefinition): void {
  registry.set(job.name, job);
}

export function registeredJobs(): JobDefinition[] {
  return [...registry.values()];
}

function lockKeys(name: string): [number, number] {
  const digest = crypto.createHash('sha256').update(`job:${name}`).digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

/**
 * Runs `fn` while holding the advisory lock for `name`. Returns false (and does not run) when
 * another instance holds it. The lock lives as long as an interactive transaction that wraps the
 * tick (job code itself uses the normal client, so the pool needs at least two connections).
 */
export async function withJobLock(name: string, fn: () => Promise<void>): Promise<boolean> {
  const [k1, k2] = lockKeys(name);
  let acquired = false;
  await prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(${k1}::int, ${k2}::int) AS locked`;
      acquired = Boolean(rows[0]?.locked);
      if (!acquired) return;
      await fn();
    },
    { timeout: 10 * 60 * 1000, maxWait: 10_000 }
  );
  return acquired;
}

/**
 * Claims one unit of work. Returns false when it already ran (or is running elsewhere).
 * A unit that FAILED earlier is re-claimed.
 */
export async function claimJobRun(jobName: string, scopeKey: string): Promise<boolean> {
  try {
    await prisma.jobRun.create({ data: { jobName, scopeKey } });
    return true;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    const retried = await prisma.jobRun.updateMany({
      where: { jobName, scopeKey, status: 'FAILED' },
      data: { status: 'RUNNING', startedAt: new Date(), finishedAt: null, detail: null },
    });
    return retried.count > 0;
  }
}

export async function finishJobRun(jobName: string, scopeKey: string, status: 'DONE' | 'FAILED', detail?: string) {
  await prisma.jobRun.update({
    where: { jobName_scopeKey: { jobName, scopeKey } },
    data: { status, finishedAt: new Date(), detail: detail?.slice(0, 2000) ?? null },
  });
}

/**
 * Claims a unit, runs it and records the outcome. Returns 'skipped' when already claimed.
 * Errors are recorded on the JobRun and logged, never thrown, so one bad unit does not stop a loop.
 */
export async function runUnit(
  jobName: string,
  scopeKey: string,
  work: () => Promise<string | void>
): Promise<'done' | 'skipped' | 'failed'> {
  if (!(await claimJobRun(jobName, scopeKey))) return 'skipped';
  try {
    const detail = await work();
    await finishJobRun(jobName, scopeKey, 'DONE', detail ?? undefined);
    return 'done';
  } catch (error) {
    console.warn(`[jobs] ${jobName} ${scopeKey} failed:`, error);
    await finishJobRun(jobName, scopeKey, 'FAILED', error instanceof Error ? error.message : String(error)).catch(() => {});
    return 'failed';
  }
}

/** Runs one tick of a registered job under its lock. Returns false if the lock was busy. */
export async function runJobOnce(name: string, now: Date = new Date()): Promise<boolean> {
  const job = registry.get(name);
  if (!job) throw new Error(`Unknown job: ${name}`);
  return withJobLock(name, () => job.run({ now }));
}

/** Starts every registered job on its interval. Returns a stop function. */
export function startJobRunner(options: { enabled: boolean }): () => void {
  if (!options.enabled) {
    console.log('[jobs] Scheduled jobs are disabled in this process (JOBS_ENABLED=false).');
    return () => {};
  }
  const timers: NodeJS.Timeout[] = [];
  const running = new Set<string>();
  for (const job of registry.values()) {
    const tick = () => {
      if (running.has(job.name)) return; // previous tick still going in this process
      running.add(job.name);
      runJobOnce(job.name)
        .catch((error) => console.warn(`[jobs] ${job.name} tick failed:`, error))
        .finally(() => running.delete(job.name));
    };
    timers.push(setInterval(tick, job.intervalMs));
    // First tick shortly after start so a restart does not wait a whole interval.
    timers.push(setTimeout(tick, 5_000 + Math.floor(Math.random() * 5_000)));
  }
  return () => timers.forEach((t) => clearTimeout(t));
}
