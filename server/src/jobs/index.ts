import { registerMessageJobs } from './messageJobs';
import { registerScheduleJobs } from './scheduleJobs';
import { registerCloseoutJobs } from './closeoutJobs';
import { registerContractJobs } from './contractJobs';
import { registerKpiJobs } from './kpiJobs';
import { registerVisitJobs } from './visitJobs';
import { registerAlertJobs } from './alertJobs';
import { registerContractorRatingsJobs } from './contractorRatingsJobs';
import { registerContractorFlagsJobs } from './contractorFlagsJobs';
import { registeredJobs, runJobOnce, startJobRunner } from './runner';

let registered = false;

/** Registers every scheduled job once (Phase 8). */
export function registerAllJobs(): void {
  if (registered) return;
  registerMessageJobs();
  registerScheduleJobs();
  registerCloseoutJobs();
  registerContractJobs(); // Phase 13
  registerKpiJobs(); // Phase 16
  registerVisitJobs(); // Redesign R4
  registerAlertJobs(); // UBEC IRL early-warning alerts
  registerContractorRatingsJobs(); // Client demo updates F.3
  registerContractorFlagsJobs(); // Client demo updates F.4
  registered = true;
}

export { registeredJobs, runJobOnce, startJobRunner };
