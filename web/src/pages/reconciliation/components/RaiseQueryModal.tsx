import React, { useState } from "react";
import type { IpcClaimDto, IpcLineItemDto, MediaType } from "@insite/shared";
import { useCreateMonitorQueryMutation } from "../../../mutations/reconciliation/useReconciliationMutations";
import { BlockedNotice, ModalActions, ModalShell, inputClass } from "./ModalShell";

const PROOF_OPTIONS: Array<{ value: MediaType; label: string }> = [
  { value: "SITE_PHOTO", label: "Site photo" },
  { value: "VOICE_NOTE", label: "Voice note" },
  { value: "WAYBILL_DOCUMENT", label: "Waybill" },
  { value: "LAB_CUBE_TEST_CERT", label: "Lab / cube test certificate" },
  { value: "MILL_CERTIFICATE", label: "Mill certificate" },
];

export function RaiseQueryModal({
  projectId,
  ipc,
  lineItem,
  onClose,
}: {
  projectId: string;
  ipc: IpcClaimDto;
  lineItem: IpcLineItemDto;
  onClose: () => void;
}) {
  const createMutation = useCreateMonitorQueryMutation(projectId);
  const [reason, setReason] = useState("");
  const [proofs, setProofs] = useState<MediaType[]>(["SITE_PHOTO"]);
  const reopening = ipc.status === "MONITOR_CERTIFIED";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMutation.mutateAsync({
        ipcId: ipc.id,
        body: { ipcLineItemId: lineItem.id, queryReason: reason.trim(), requestedProofTypes: proofs },
      });
      onClose();
    } catch {
      // toasted by the mutation hook
    }
  };

  return (
    <ModalShell title="Raise a query" subtitle={`WBS ${lineItem.boqItem.wbsCode}: ${lineItem.boqItem.description}`} onClose={onClose} maxWidth="max-w-lg">
      <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
        {!ipc.actions.raiseQuery.allowed && <BlockedNotice>{ipc.actions.raiseQuery.reason}</BlockedNotice>}
        {reopening && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
            This IPC is certified. Raising a query reopens it; it must be certified again before the lender can decide.
          </div>
        )}
        <label className="block font-medium text-slate-700">
          What needs clarifying
          <textarea rows={4} required minLength={5} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} className={`${inputClass} mt-1`} />
        </label>
        <fieldset className="space-y-1">
          <legend className="font-medium text-slate-700 mb-1">Requested proof</legend>
          {PROOF_OPTIONS.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-slate-700">
              <input
                type="checkbox"
                checked={proofs.includes(o.value)}
                onChange={(e) =>
                  setProofs((prev) => (e.target.checked ? [...prev, o.value] : prev.filter((p) => p !== o.value)))
                }
              />
              {o.label}
            </label>
          ))}
        </fieldset>
        <ModalActions
          onCancel={onClose}
          submitLabel={reopening ? "Reopen and send query" : "Send query"}
          pendingLabel="Sending..."
          isPending={createMutation.isPending}
          disabled={!ipc.actions.raiseQuery.allowed || reason.trim().length < 5}
        />
      </form>
    </ModalShell>
  );
}
