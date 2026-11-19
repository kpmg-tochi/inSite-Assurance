import type {
  CreateScheduleRevisionRequest,
  PreviewScheduleRevisionRequest,
  ProposeScheduleDatesRequest,
  SaveScheduleBaselineRequest,
} from "@insite/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createScheduleRevision,
  decideScheduleRevision,
  previewScheduleRevision,
  proposeScheduleDates,
  saveScheduleBaseline,
} from "../../api/schedule/scheduleApi";
import { projectScheduleKey, scheduleRevisionsKey } from "../../queries/schedule/useScheduleQueries";
import { projectSetupKey } from "../../queries/projects/useProjectSetupQueries";

const errorMessage = (err: unknown) => (err as { message?: string })?.message;

function useInvalidateSchedule(projectId: string | undefined) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: projectScheduleKey(projectId) });
    qc.invalidateQueries({ queryKey: scheduleRevisionsKey(projectId) });
    qc.invalidateQueries({ queryKey: ["projects"] });
    qc.invalidateQueries({ queryKey: ["portfolio-executive-summary"] });
    qc.invalidateQueries({ queryKey: ["audit-trail", projectId] });
    qc.invalidateQueries({ queryKey: ["boq", projectId] });
  };
}

/** Saves the baseline. `silent` skips the success toast (wizard autosave on step change). */
export function useSaveScheduleBaselineMutation(projectId: string | undefined) {
  const invalidate = useInvalidateSchedule(projectId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { body: SaveScheduleBaselineRequest; silent?: boolean }) => saveScheduleBaseline(projectId!, p.body),
    onSuccess: (_data, p) => {
      if (!p.silent) toast.success("Schedule saved");
      invalidate();
      qc.invalidateQueries({ queryKey: projectSetupKey(projectId) });
    },
    // The step shows field-level problems inline; the toast gives the first one.
    onError: (err) => toast.error("Could not save the schedule", { description: errorMessage(err) }),
  });
}

export function useProposeScheduleDatesMutation(projectId: string | undefined) {
  return useMutation({
    mutationFn: (body: ProposeScheduleDatesRequest) => proposeScheduleDates(projectId!, body),
    onSuccess: (data) =>
      toast.success(`Suggested dates for ${data.items.length} item(s)`, { description: "Review and adjust them, then save." }),
    onError: (err) => toast.error("Could not suggest dates", { description: errorMessage(err) }),
  });
}

/** Preview errors are shown inside the wizard, so this hook does not toast. */
export function usePreviewScheduleRevisionMutation(projectId: string | undefined) {
  return useMutation({
    mutationFn: (body: PreviewScheduleRevisionRequest) => previewScheduleRevision(projectId!, body),
  });
}

export function useCreateScheduleRevisionMutation(projectId: string | undefined) {
  const invalidate = useInvalidateSchedule(projectId);
  return useMutation({
    mutationFn: (body: CreateScheduleRevisionRequest) => createScheduleRevision(projectId!, body),
    onSuccess: (r) => {
      if (r.status === "APPLIED") {
        toast.success(`Revision ${r.revisionNumber} applied`, { description: "The projected end did not move, so no approval was needed." });
      } else {
        toast.success(`Revision ${r.revisionNumber} sent for approval`, {
          description: "It moves the projected end date, so a second person must approve it.",
        });
      }
      invalidate();
    },
    onError: (err) => toast.error("Could not submit the revision", { description: errorMessage(err) }),
  });
}

export function useDecideScheduleRevisionMutation(projectId: string | undefined) {
  const invalidate = useInvalidateSchedule(projectId);
  return useMutation({
    mutationFn: (p: { revisionId: string; decision: "approve" | "reject" | "withdraw"; notes?: string }) =>
      decideScheduleRevision({ projectId: projectId!, revisionId: p.revisionId, decision: p.decision, body: { notes: p.notes } }),
    onSuccess: (r) => {
      toast.success(
        r.status === "APPLIED"
          ? `Revision ${r.revisionNumber} approved and applied`
          : r.status === "WITHDRAWN"
            ? `Revision ${r.revisionNumber} withdrawn`
            : `Revision ${r.revisionNumber} rejected`,
      );
      invalidate();
    },
    onError: (err) => toast.error("Could not record the decision", { description: errorMessage(err) }),
  });
}
