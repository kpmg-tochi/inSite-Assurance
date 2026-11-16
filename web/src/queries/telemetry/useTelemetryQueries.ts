import { useQuery } from "@tanstack/react-query";
import {
  getProjectTelemetryPings,
  getProjectWorkdayReports,
} from "../../api/telemetry/telemetryApi";

export function useProjectTelemetryQuery(
  projectId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: ["project-telemetry", projectId],
    queryFn: () => getProjectTelemetryPings(projectId!),
    enabled: Boolean(projectId && enabled),
  });
}

export function useProjectWorkdayReportsQuery(
  projectId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: ["project-workday-reports", projectId],
    queryFn: () => getProjectWorkdayReports(projectId!),
    enabled: Boolean(projectId && enabled),
  });
}

