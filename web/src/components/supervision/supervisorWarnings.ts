import type { SupervisorWorkloadDto } from "@insite/shared";

/** The workload warnings of one supervisor, in plain words ("4 sites, above the limit of 2"). */
export function supervisorWarnings(w: SupervisorWorkloadDto): string[] {
  const out: string[] = [];
  if (w.overSiteLimit) out.push(`${w.activeProjectCount} sites, above the limit of ${w.maxSitesPerSupervisor}`);
  if (w.overSpread) out.push(`sites ${w.spreadKm} km apart, above ${w.maxSpreadKm} km`);
  return out;
}
