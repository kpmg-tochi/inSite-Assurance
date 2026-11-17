import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createWorkdayReportQuery } from "../../api/telemetry/telemetryApi";

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
        queryKey: ["project-audit", projectId],
      });
    },
  });
}
