import type { AttendanceAlertStatus } from "@insite/shared";
import { useQuery } from "@tanstack/react-query";
import {
  getAttendanceAlerts,
  getCadenceOverview,
  getParticipants,
  getReportingObligations,
} from "../../api/cadence/cadenceApi";

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

export function useParticipantsQuery(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["project-participants", projectId],
    queryFn: () => getParticipants(projectId!),
    enabled: Boolean(projectId && enabled),
  });
}

export function useAttendanceAlertsQuery(
  projectId: string | undefined,
  filters: { status?: AttendanceAlertStatus[]; type?: string[] } = {},
  enabled = true,
) {
  return useQuery({
    queryKey: ["project-attendance-alerts", projectId, filters],
    queryFn: () => getAttendanceAlerts(projectId!, filters),
    enabled: Boolean(projectId && enabled),
  });
}
