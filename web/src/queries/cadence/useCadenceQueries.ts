import { useQuery } from "@tanstack/react-query";
import { getCadenceOverview, getReportingObligations } from "../../api/cadence/cadenceApi";

export function useCadenceOverviewQuery(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["project-cadence", projectId],
    queryFn: () => getCadenceOverview(projectId!),
    enabled: Boolean(projectId && enabled),
  });
}

/** PENDING, LATE and MISSED obligations across periods ("Due and overdue"). */
export function useDueObligationsQuery(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["project-obligations", projectId, "due"],
    queryFn: () => getReportingObligations(projectId!, { view: "due" }),
    enabled: Boolean(projectId && enabled),
  });
}
