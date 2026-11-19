import { registerCadenceJobs } from './cadenceJobs';
import { registerMobilizationJobs } from './mobilizationJobs';
import { registerScheduleJobs } from './scheduleJobs';
import { registeredJobs, runJobOnce, startJobRunner } from './runner';

let registered = false;

/** Registers every scheduled job once (Phase 8). */
export function registerAllJobs(): void {
  if (registered) return;
  registerCadenceJobs();
  registerMobilizationJobs();
  registerScheduleJobs();
  registered = true;
}

export { registeredJobs, runJobOnce, startJobRunner };
