import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createWorkdayReportQuery, resolveReportQuery, reviewWorkdayReport } from "../../api/workdayReports/workdayReportsApi";

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

/** Approve or return a report on its approval chain (Phase 7). RETURN needs notes (5+ characters). */
export function useReviewWorkdayReportMutation(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { reportId: string; decision: "APPROVE" | "RETURN"; notes: string | null }) =>
      reviewWorkdayReport({
        projectId: projectId!,
        reportId: params.reportId,
        body: { decision: params.decision, notes: params.notes },
      }),
    onSuccess: (report, params) => {
      queryClient.invalidateQueries({ queryKey: ["project-workday-reports", projectId] });
      queryClient.invalidateQueries({ queryKey: ["audit-trail", projectId] });
      queryClient.invalidateQueries({ queryKey: ["web-notifications"] });
      if (params.decision === "RETURN") {
        toast.success("Report returned", { description: "The reporter has a query to answer with a revision." });
      } else if (report.status === "APPROVED_COMPLETED") {
        toast.success("Report approved", { description: "Every step has approved; it now counts as evidence." });
      } else {
        toast.success("Step approved", { description: "The report moves to the next step of the chain." });
      }
    },
    onError: (err) => {
      toast.error("Could not record the review", {
        description: (err as { message?: string })?.message,
      });
    },
  });
}
