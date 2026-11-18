import React, { useState } from "react";
import type { ConditionPrecedentDto, IpcClaimDto, LenderDecisionType } from "@insite/shared";
import { CustomSelect, type CustomSelectOption } from "../../../components/common";
import { useAuth } from "../../../lib/auth-context";
import { IS_DEMO_MODE } from "../../../config/demoMode";
import { formatNaira } from "../../../lib/formatters";
import {
  useDecideTrancheMutation,
  useReverseDecisionMutation,
  useUpdateConditionStatusMutation,
  useWaiveConditionMutation,
} from "../../../mutations/reconciliation/useReconciliationMutations";
import { BlockedNotice, ModalActions, ModalShell, inputClass } from "./ModalShell";

const DECISION_OPTIONS: CustomSelectOption<LenderDecisionType>[] = [
  {
    value: "APPROVE_FULL",
    label: "Approve the recommended release",
    description: "Releases exactly the monitor's recommended amount",
  },
  {
    value: "APPROVE_WITH_HOLDBACK",
    label: "Approve a lower amount",
    description: "You enter the amount, at most the recommended release",
  },
  { value: "HOLD", label: "Hold", description: "Release nothing" },
];

const CP_CHIP: Record<ConditionPrecedentDto["status"], string> = {
  SATISFIED: "bg-emerald-50 text-emerald-800 border-emerald-200",
  WAIVED: "bg-sky-50 text-sky-800 border-sky-200",
  PENDING: "bg-amber-50 text-amber-800 border-amber-200",
  BREACHED: "bg-rose-50 text-rose-700 border-rose-200",
};

function ConditionRow({ projectId, trancheId, cp }: { projectId: string; trancheId: string; cp: ConditionPrecedentDto }) {
  const { hasPermission } = useAuth();
  const waiveMutation = useWaiveConditionMutation(projectId);
  const statusMutation = useUpdateConditionStatusMutation(projectId);
  const [waiving, setWaiving] = useState(false);
  const [reason, setReason] = useState("");
  const open = cp.status === "PENDING" || cp.status === "BREACHED";
  const canWaive = hasPermission("tranche:approve_disbursement");
  const canSetStatus = canWaive || hasPermission("ipc:certify_valuation");

  return (
    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-900">
            <span className="text-brand-primary mr-1.5">{cp.referenceCode}</span>
            {cp.description}
          </div>
          <div className="text-[11px] text-slate-400">
            {cp.isMandatoryForRelease ? "Mandatory for release" : "Advisory"}
            {cp.waiverReason ? ` · Waived: ${cp.waiverReason}` : ""}
          </div>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ${CP_CHIP[cp.status]}`}>{cp.status}</span>
      </div>
      {open && (canWaive || canSetStatus) && !waiving && (
        <div className="flex gap-2">
          {canSetStatus && (
            <button
              type="button"
              disabled={statusMutation.isPending}
              onClick={() => statusMutation.mutate({ trancheId, conditionId: cp.id, body: { status: "SATISFIED" } })}
              className="px-2 py-0.5 rounded border border-emerald-300 bg-white text-emerald-800 text-[11px] font-semibold"
            >
              Mark satisfied
            </button>
          )}
          {canWaive && (
            <button type="button" onClick={() => setWaiving(true)} className="px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-700 text-[11px] font-semibold">
              Waive
            </button>
          )}
        </div>
      )}
      {waiving && (
        <div className="space-y-1.5">
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for the waiver (recorded in the ledger)"
            className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setWaiving(false)} className="text-[11px] text-slate-600">Cancel</button>
            <button
              type="button"
              disabled={reason.trim().length < 10 || waiveMutation.isPending}
              onClick={() =>
                waiveMutation.mutate(
                  { trancheId, conditionId: cp.id, body: { reason: reason.trim() } },
                  { onSuccess: () => setWaiving(false) },
                )
              }
              className="px-2.5 py-1 rounded-lg bg-brand-primary text-white text-[11px] font-semibold disabled:opacity-50"
            >
              Confirm waiver
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function LenderDecisionModal({ projectId, ipc, onClose }: { projectId: string; ipc: IpcClaimDto; onClose: () => void }) {
  const decideMutation = useDecideTrancheMutation(projectId);
  const report = ipc.valuationReport;
  const [decision, setDecision] = useState<LenderDecisionType>("APPROVE_FULL");
  const [amount, setAmount] = useState("");
  const [creditRef, setCreditRef] = useState(IS_DEMO_MODE ? "IC-CC-2026-Q4-019" : "");
  const [notes, setNotes] = useState("");

  if (!report) return null;
  const cps = ipc.tranche.conditionsPrecedent ?? [];
  const blocking = cps.filter((cp) => cp.isMandatoryForRelease && (cp.status === "PENDING" || cp.status === "BREACHED"));
  const remaining = ipc.tranche.allocatedAmountNgn - ipc.tranche.releasedAmountNgn;
  const maxApprovable = Math.min(report.recommendedReleaseAmountNgn, remaining);
  const amountNum = Number(amount);
  const amountBad = decision === "APPROVE_WITH_HOLDBACK" && (amount === "" || !(amountNum > 0) || amountNum > maxApprovable);
  const cpBlocked = decision !== "HOLD" && blocking.length > 0;
  const fullBlocked =
    decision === "APPROVE_FULL" && (report.recommendedReleaseAmountNgn <= 0 || report.recommendedReleaseAmountNgn > remaining);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cpBlocked || amountBad || fullBlocked) return;
    try {
      await decideMutation.mutateAsync({
        trancheId: ipc.trancheId,
        body: {
          valuationReportId: report.id,
          decision,
          ...(decision === "APPROVE_WITH_HOLDBACK" ? { approvedDisbursementAmountNgn: amountNum } : {}),
          creditCommitteeReference: creditRef.trim() || undefined,
          approverNotes: notes.trim() || undefined,
        },
      });
      onClose();
    } catch {
      // toasted by the mutation hook
    }
  };

  return (
    <ModalShell title="Tranche disbursement decision" subtitle={`${ipc.tranche.name} · valuation revision ${report.revisionNumber}`} onClose={onClose} maxWidth="max-w-2xl">
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        {!ipc.actions.decide.allowed && <BlockedNotice>{ipc.actions.decide.reason}</BlockedNotice>}

        <dl className="bg-slate-50 rounded-xl p-3 border border-slate-200 text-xs grid grid-cols-2 gap-y-1">
          <dt className="text-slate-500">Certified by</dt>
          <dd className="text-right font-medium">{report.certifierFullName}</dd>
          <dt className="text-slate-500">Recommended release</dt>
          <dd className="text-right font-bold text-emerald-700">{formatNaira(report.recommendedReleaseAmountNgn)}</dd>
          <dt className="text-slate-500">Recommended holdback</dt>
          <dd className="text-right font-bold text-amber-700">{formatNaira(report.recommendedHoldbackAmountNgn)}</dd>
          <dt className="text-slate-500">Tranche unreleased allocation</dt>
          <dd className="text-right font-medium">{formatNaira(remaining)}</dd>
        </dl>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-700">Conditions precedent</div>
          {cps.length === 0 ? (
            <p className="text-xs text-slate-500">No conditions precedent on this tranche.</p>
          ) : (
            cps.map((cp) => <ConditionRow key={cp.id} projectId={projectId} trancheId={ipc.trancheId} cp={cp} />)
          )}
        </div>

        <CustomSelect label="Decision" value={decision} onChange={setDecision} options={DECISION_OPTIONS} />

        {decision === "APPROVE_WITH_HOLDBACK" && (
          <label className="block text-xs font-medium text-slate-700">
            Amount to release (NGN), at most {formatNaira(maxApprovable)}
            <input type="number" min={0.01} max={maxApprovable} step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputClass} mt-1`} />
          </label>
        )}

        {cpBlocked && (
          <BlockedNotice>
            Release is blocked by unmet mandatory conditions precedent: {blocking.map((c) => c.referenceCode).join(", ")}. Mark them satisfied or waive them with a reason, or record HOLD.
          </BlockedNotice>
        )}
        {fullBlocked && (
          <BlockedNotice>
            {report.recommendedReleaseAmountNgn <= 0
              ? "The monitor recommended no release. Record HOLD."
              : "The recommended release exceeds the tranche's unreleased allocation. Approve a lower amount instead."}
          </BlockedNotice>
        )}

        <label className="block text-xs font-medium text-slate-700">
          Credit committee reference
          <input type="text" maxLength={120} value={creditRef} onChange={(e) => setCreditRef(e.target.value)} className={`${inputClass} mt-1`} />
        </label>
        <label className="block text-xs font-medium text-slate-700">
          Approver notes
          <textarea rows={3} maxLength={1500} value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inputClass} mt-1`} />
        </label>

        <ModalActions
          onCancel={onClose}
          submitLabel="Record decision"
          pendingLabel="Recording..."
          isPending={decideMutation.isPending}
          disabled={!ipc.actions.decide.allowed || cpBlocked || amountBad || fullBlocked}
        />
      </form>
    </ModalShell>
  );
}

export function ReverseDecisionModal({ projectId, ipc, onClose }: { projectId: string; ipc: IpcClaimDto; onClose: () => void }) {
  const reverseMutation = useReverseDecisionMutation(projectId);
  const [reason, setReason] = useState("");
  const decision = ipc.activeDecision;
  if (!decision) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await reverseMutation.mutateAsync({ decisionId: decision.id, body: { reason: reason.trim() } });
      onClose();
    } catch {
      // toasted by the mutation hook
    }
  };

  return (
    <ModalShell title="Reverse tranche decision" subtitle={`IPC #${ipc.ipcNumber}`} onClose={onClose} maxWidth="max-w-lg">
      <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
        <p className="text-slate-700">
          This records a linked reversal of <strong>{decision.decision}</strong> ({formatNaira(decision.approvedDisbursementAmountNgn)} released).
          The original decision is kept; the released amount is reduced by the same figure and the IPC returns to
          certified, so a corrected decision can be recorded.
        </p>
        <label className="block font-medium text-slate-700">
          Reason
          <textarea rows={3} required minLength={10} maxLength={1500} value={reason} onChange={(e) => setReason(e.target.value)} className={`${inputClass} mt-1`} />
        </label>
        <ModalActions onCancel={onClose} submitLabel="Record reversal" pendingLabel="Reversing..." isPending={reverseMutation.isPending} disabled={reason.trim().length < 10} />
      </form>
    </ModalShell>
  );
}
