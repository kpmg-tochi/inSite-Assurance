import React, { useState } from "react";
import type {
  ConditionPrecedentDto,
  IpcClaimDto,
  LenderDecisionType,
  TrancheDecisionDto,
  ValuationReportDto,
} from "@insite/shared";
import { CustomSelect, type CustomSelectOption } from "../../../components/common";
import { useAuth, useTerm } from "../../../lib/auth-context";
import { IS_DEMO_MODE } from "../../../config/demoMode";
import { formatNaira } from "../../../lib/formatters";
import {
  useDecideTrancheMutation,
  useReverseDecisionMutation,
  useUpdateConditionStatusMutation,
  useWaiveConditionMutation,
} from "../../../mutations/reconciliation/useReconciliationMutations";
import { BlockedNotice, ModalActions, ModalShell, inputClass } from "./ModalShell";
import { retentionWithheldFor, type MilestonePaymentTerms } from "@insite/shared";
import { PaymentTermsBox } from "../../../components/payments/PaymentTermsBox";
import { DocumentPicker } from "../../../components/documents/DocumentPicker";
import { useProjectProcess } from "../../../queries/process/useProcessQueries";
import { useProjectsQuery } from "../../../queries/projects/useProjectsQueries";

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
  WAIVED: "bg-brand-sky/10 text-brand-medium border-brand-sky/30",
  PENDING: "bg-amber-50 text-amber-800 border-amber-200",
  BREACHED: "bg-rose-50 text-rose-700 border-rose-200",
};

/** The tranche a decision releases from; CPs are optional (absent when the module is off). */
export interface DecisionTranche {
  id: string;
  name: string;
  allocatedAmountNgn: number;
  releasedAmountNgn: number;
  conditionsPrecedent?: Array<
    Pick<ConditionPrecedentDto, "id" | "referenceCode" | "description" | "isMandatoryForRelease" | "status"> & {
      waiverReason?: string | null;
      /** Phase 13: evidence document in the register. */
      evidenceDocumentId?: string | null;
      evidenceDocumentTitle?: string | null;
    }
  >;
}

type DecisionCondition = NonNullable<DecisionTranche["conditionsPrecedent"]>[number];

function ConditionRow({ projectId, trancheId, cp }: { projectId: string; trancheId: string; cp: DecisionCondition }) {
  const { hasPermission } = useAuth();
  const waiveMutation = useWaiveConditionMutation(projectId);
  const statusMutation = useUpdateConditionStatusMutation(projectId);
  const [waiving, setWaiving] = useState(false);
  const [reason, setReason] = useState("");
  // Phase 13: "Mark satisfied" picks (or uploads) an evidence document from the register.
  const [satisfying, setSatisfying] = useState(false);
  const [evidenceId, setEvidenceId] = useState<string | null>(cp.evidenceDocumentId ?? null);
  const [evidenceTitle, setEvidenceTitle] = useState<string | null>(cp.evidenceDocumentTitle ?? null);
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
            {cp.evidenceDocumentTitle ? ` · Evidence: ${cp.evidenceDocumentTitle}` : ""}
          </div>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ${CP_CHIP[cp.status]}`}>{cp.status}</span>
      </div>
      {open && (canWaive || canSetStatus) && !waiving && !satisfying && (
        <div className="flex gap-2">
          {canSetStatus && (
            <button
              type="button"
              disabled={statusMutation.isPending}
              onClick={() => setSatisfying(true)}
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
      {satisfying && (
        <div className="space-y-1.5">
          <DocumentPicker
            projectId={projectId}
            typeCode="CP_EVIDENCE"
            label="Evidence document (optional)"
            value={evidenceId}
            currentTitle={evidenceTitle}
            onChange={(id, title) => {
              setEvidenceId(id);
              setEvidenceTitle(title);
            }}
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setSatisfying(false)} className="text-[11px] text-slate-600">Cancel</button>
            <button
              type="button"
              disabled={statusMutation.isPending}
              onClick={() =>
                statusMutation.mutate(
                  { trancheId, conditionId: cp.id, body: { status: "SATISFIED", evidenceDocumentId: evidenceId } },
                  { onSuccess: () => setSatisfying(false) },
                )
              }
              className="px-2.5 py-1 rounded-lg bg-brand-primary text-white text-[11px] font-semibold disabled:opacity-50"
            >
              Confirm satisfied
            </button>
          </div>
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

/**
 * Release decision on a certified valuation. Works for an IPC valuation and for a direct
 * milestone valuation (Phase 7): both go through POST /tranches/:trancheId/decision.
 */
export function TrancheDecisionModal({
  projectId,
  tranche,
  report,
  decide,
  subtitle,
  cpsEnabled = true,
  paymentTerms = null,
  onClose,
}: {
  projectId: string;
  tranche: DecisionTranche;
  report: ValuationReportDto;
  /** Phase 12: a direct milestone verification's payment basis and whether its criteria were met. */
  paymentTerms?: MilestonePaymentTerms | null;
  decide: { allowed: boolean; reason: string | null };
  subtitle: string;
  /** False when the project turned tranches and conditions precedent off. */
  cpsEnabled?: boolean;
  onClose: () => void;
}) {
  const decideMutation = useDecideTrancheMutation(projectId);
  const term = useTerm();
  const [decision, setDecision] = useState<LenderDecisionType>("APPROVE_FULL");
  const [amount, setAmount] = useState("");
  const [creditRef, setCreditRef] = useState(IS_DEMO_MODE ? "IC-CC-2026-Q4-019" : "");
  const [notes, setNotes] = useState("");

  const cps = cpsEnabled ? tranche.conditionsPrecedent ?? [] : [];
  const blocking = cps.filter((cp) => cp.isMandatoryForRelease && (cp.status === "PENDING" || cp.status === "BREACHED"));
  const remaining = tranche.allocatedAmountNgn - tranche.releasedAmountNgn;
  const maxApprovable = Math.min(report.recommendedReleaseAmountNgn, remaining);
  const amountNum = Number(amount);
  const amountBad = decision === "APPROVE_WITH_HOLDBACK" && (amount === "" || !(amountNum > 0) || amountNum > maxApprovable);
  const cpBlocked = decision !== "HOLD" && blocking.length > 0;
  const fullBlocked =
    decision === "APPROVE_FULL" && (report.recommendedReleaseAmountNgn <= 0 || report.recommendedReleaseAmountNgn > remaining);

  // Phase 10: preview of the retention the server will withhold (the server computes the real split).
  const processQuery = useProjectProcess(projectId);
  const projectsQuery = useProjectsQuery();
  const retentionPct =
    report.source !== "RETENTION_RELEASE" && processQuery.data?.config.enableRetentionModule
      ? projectsQuery.data?.find((p) => p.id === projectId)?.retentionPercentage ?? null
      : null;
  const previewApproved = decision === "APPROVE_FULL" ? report.recommendedReleaseAmountNgn : decision === "HOLD" ? 0 : amountNum > 0 ? amountNum : 0;
  const previewRetention = retentionPct ? retentionWithheldFor(previewApproved, retentionPct) : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cpBlocked || amountBad || fullBlocked) return;
    try {
      await decideMutation.mutateAsync({
        trancheId: tranche.id,
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
    <ModalShell title={`${term("tranche")} disbursement decision`} subtitle={subtitle} onClose={onClose} maxWidth="max-w-2xl">
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        {!decide.allowed && <BlockedNotice>{decide.reason}</BlockedNotice>}

        {paymentTerms && <PaymentTermsBox terms={paymentTerms} title="Payment basis (as verified)" />}

        <dl className="bg-slate-50 rounded-xl p-3 border border-slate-200 text-xs grid grid-cols-2 gap-y-1">
          <dt className="text-slate-500">Certified by</dt>
          <dd className="text-right font-medium">{report.certifierFullName}</dd>
          <dt className="text-slate-500">Recommended release</dt>
          <dd className="text-right font-bold text-emerald-700">{formatNaira(report.recommendedReleaseAmountNgn)}</dd>
          <dt className="text-slate-500">Recommended holdback</dt>
          <dd className="text-right font-bold text-amber-700">{formatNaira(report.recommendedHoldbackAmountNgn)}</dd>
          <dt className="text-slate-500">{cpsEnabled ? `${term("tranche")} unreleased allocation` : "Unreleased allocation"}</dt>
          <dd className="text-right font-medium">{formatNaira(remaining)}</dd>
          {retentionPct ? (
            <>
              <dt className="text-slate-500">{term("retention")} withheld ({retentionPct}%)</dt>
              <dd className="text-right font-bold text-sky-700">{formatNaira(previewRetention)}</dd>
              <dt className="text-slate-500">Paid to the {term("contractor", { lower: true })}</dt>
              <dd className="text-right font-bold">{formatNaira(Math.round((previewApproved - previewRetention) * 100) / 100)}</dd>
            </>
          ) : null}
        </dl>

        {cpsEnabled && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-700">{term("conditionPrecedent", { plural: true })}</div>
            {cps.length === 0 ? (
              <p className="text-xs text-slate-500">No {term("conditionPrecedent", { plural: true, lower: true })} on this {term("tranche", { lower: true })}.</p>
            ) : (
              cps.map((cp) => <ConditionRow key={cp.id} projectId={projectId} trancheId={tranche.id} cp={cp} />)
            )}
          </div>
        )}

        <CustomSelect label="Decision" value={decision} onChange={setDecision} options={DECISION_OPTIONS} />

        {decision === "APPROVE_WITH_HOLDBACK" && (
          <label className="block text-xs font-medium text-slate-700">
            Amount to release (NGN), at most {formatNaira(maxApprovable)}
            <input type="number" min={0.01} max={maxApprovable} step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputClass} mt-1`} />
          </label>
        )}

        {cpBlocked && (
          <BlockedNotice>
            Release is blocked by unmet mandatory {term("conditionPrecedent", { plural: true, lower: true })}: {blocking.map((c) => c.referenceCode).join(", ")}. Mark them satisfied or waive them with a reason, or record HOLD.
          </BlockedNotice>
        )}
        {fullBlocked && (
          <BlockedNotice>
            {report.recommendedReleaseAmountNgn <= 0
              ? "The monitor recommended no release. Record HOLD."
              : `The recommended release exceeds the ${term("tranche", { lower: true })}'s unreleased allocation. Approve a lower amount instead.`}
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
          disabled={!decide.allowed || cpBlocked || amountBad || fullBlocked}
        />
      </form>
    </ModalShell>
  );
}

export function LenderDecisionModal({
  projectId,
  ipc,
  cpsEnabled,
  onClose,
}: {
  projectId: string;
  ipc: IpcClaimDto;
  cpsEnabled?: boolean;
  onClose: () => void;
}) {
  const term = useTerm();
  const report = ipc.valuationReport;
  if (!report) return null;
  return (
    <TrancheDecisionModal
      projectId={projectId}
      tranche={ipc.tranche}
      report={report}
      decide={ipc.actions.decide}
      subtitle={`${ipc.tranche.name} · ${term("valuation", { lower: true })} revision ${report.revisionNumber}`}
      cpsEnabled={cpsEnabled}
      onClose={onClose}
    />
  );
}

export function ReverseDecisionModal({ projectId, ipc, onClose }: { projectId: string; ipc: IpcClaimDto; onClose: () => void }) {
  const term = useTerm();
  if (!ipc.activeDecision) return null;
  return (
    <ReverseTrancheDecisionModal
      projectId={projectId}
      decision={ipc.activeDecision}
      subtitle={`${term("ipc")} #${ipc.ipcNumber}`}
      returnsTo={`the ${term("ipc", { lower: true })} returns to certified`}
      onClose={onClose}
    />
  );
}

/** Linked reversal of a final decision (IPC or direct milestone valuation). */
export function ReverseTrancheDecisionModal({
  projectId,
  decision,
  subtitle,
  returnsTo,
  onClose,
}: {
  projectId: string;
  decision: TrancheDecisionDto;
  subtitle: string;
  returnsTo: string;
  onClose: () => void;
}) {
  const reverseMutation = useReverseDecisionMutation(projectId);
  const term = useTerm();
  const [reason, setReason] = useState("");

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
    <ModalShell title={`Reverse ${term("tranche", { lower: true })} decision`} subtitle={subtitle} onClose={onClose} maxWidth="max-w-lg">
      <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
        <p className="text-slate-700">
          This records a linked reversal of <strong>{decision.decision}</strong> ({formatNaira(decision.approvedDisbursementAmountNgn)} released).
          The original decision is kept; the released amount is reduced by the same figure and {returnsTo}, so a
          corrected decision can be recorded.
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
