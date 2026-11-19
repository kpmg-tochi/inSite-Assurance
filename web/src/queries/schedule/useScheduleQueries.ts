import { useQuery } from "@tanstack/react-query";
import { getProjectSchedule, getScheduleRevisions } from "../../api/schedule/scheduleApi";

export const projectScheduleKey = (projectId: string | undefined) => ["project-schedule", projectId] as const;
export const scheduleRevisionsKey = (projectId: string | undefined) => ["project-schedule-revisions", projectId] as const;

export function useProjectScheduleQuery(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: projectScheduleKey(projectId),
    queryFn: () => getProjectSchedule(projectId!),
    enabled: Boolean(projectId && enabled),
  });
}

export function useScheduleRevisionsQuery(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: scheduleRevisionsKey(projectId),
    queryFn: () => getScheduleRevisions(projectId!),
    enabled: Boolean(projectId && enabled),
  });
}
