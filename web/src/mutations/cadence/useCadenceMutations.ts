import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { excuseReportingObligation } from "../../api/cadence/cadenceApi";

const errorMessage = (err: unknown) => (err as { message?: string })?.message;

export function useExcuseObligationMutation(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { obligationId: string; notes: string }) => excuseReportingObligation({ projectId: projectId!, ...p }),
    onSuccess: () => {
      toast.success("Report excused", { description: "The note is recorded in the audit ledger." });
      qc.invalidateQueries({ queryKey: ["project-obligations", projectId] });
      qc.invalidateQueries({ queryKey: ["project-cadence", projectId] });
      qc.invalidateQueries({ queryKey: ["audit-trail", projectId] });
    },
    onError: (err) => toast.error("Could not excuse the report", { description: errorMessage(err) }),
  });
}
