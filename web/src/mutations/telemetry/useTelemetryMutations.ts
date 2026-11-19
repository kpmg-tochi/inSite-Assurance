import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createWorkdayReportQuery, resolveReportQuery } from "../../api/telemetry/telemetryApi";

export function useCreateWorkdayReportQueryMutation(
  projectId: string | undefined,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { reportId: string; queryText: string }) =>
      createWorkdayReportQuery({
        projectId: projectId!,
        reportId: params.reportId,
        body: { queryText: params.queryText },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["project-workday-reports", projectId],
      });
      queryClient.invalidateQueries({
        queryKey: ["audit-trail", projectId],
      });
    },
  });
}

/** Monitor resolves a workday-report query. After this the report cannot be revised again. */
export function useResolveReportQueryMutation(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { queryId: string; resolutionNote?: string }) =>
      resolveReportQuery({
        projectId: projectId!,
        queryId: params.queryId,
        body: params.resolutionNote ? { resolutionNote: params.resolutionNote } : {},
      }),
    onSuccess: () => {
      toast.success("Query resolved", { description: "The reporter has been notified." });
      queryClient.invalidateQueries({ queryKey: ["project-workday-reports", projectId] });
      queryClient.invalidateQueries({ queryKey: ["audit-trail", projectId] });
    },
    onError: (err) => {
      toast.error("Could not resolve the query", {
        description: (err as { message?: string })?.message,
      });
    },
  });
}
