import { registerCadenceJobs } from './cadenceJobs';
import { registerMobilizationJobs } from './mobilizationJobs';
import { registerScheduleJobs } from './scheduleJobs';
import { registerCloseoutJobs } from './closeoutJobs';
import { registerContractJobs } from './contractJobs';
import { registerKpiJobs } from './kpiJobs';
import { registeredJobs, runJobOnce, startJobRunner } from './runner';

let registered = false;

/** Registers every scheduled job once (Phase 8). */
export function registerAllJobs(): void {
  if (registered) return;
  registerCadenceJobs();
  registerMobilizationJobs();
  registerScheduleJobs();
  registerCloseoutJobs();
  registerContractJobs(); // Phase 13
  registerKpiJobs(); // Phase 16
  registered = true;
}

export { registeredJobs, runJobOnce, startJobRunner };
