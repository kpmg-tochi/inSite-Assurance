import type { WorkdayReportStatus } from "@insite/shared";
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
  /** Server-side status filter (Phase 7), e.g. PENDING_APPROVAL. */
  status?: WorkdayReportStatus,
) {
  return useQuery({
    // The status sits after the project id so invalidating ["project-workday-reports", projectId] covers it.
    queryKey: status ? ["project-workday-reports", projectId, { status }] : ["project-workday-reports", projectId],
    queryFn: () => getProjectWorkdayReports(projectId!, status ? { status } : undefined),
    enabled: Boolean(projectId && enabled),
  });
}

