import React, { useState } from "react";
import { DEFAULT_CASE_OUTCOME_META, DefaultCaseOutcomeEnum, type ContractorDefaultCaseDto, type DefaultCaseOutcome } from "@insite/shared";
import { ModalShell } from "../common/ModalShell";
import { ApprovalProgressBar } from "../process/ApprovalProgressBar";
import { useConfirmDialog } from "../process/ConfirmDialog";
import Loader from "../Loader";
import { formatDateTimeShort } from "../../lib/formatters";
import { useDefaultCaseQuery } from "../../queries/contracts/useContractQueries";
import { useActOnDefaultCaseMutation } from "../../mutations/contracts/useContractMutations";
import { DEFAULT_CASE_STATUS_META, primaryButton, secondaryButton, smallInput, StatusChip } from "./contractUi";

/**
 * Phase 13: one contractor default case. Review steps are approved or returned through the
 * approval bar; the decision step chooses the outcome (cure period, extension, termination,
 * closure). Termination asks for confirmation.
 */
export function DefaultCaseModal({ projectId, caseId, onClose }: { projectId: string; caseId: string; onClose: () => void }) {
  const q = useDefaultCaseQuery(projectId, caseId);
  return (
    <ModalShell
      title="Default case"
      subtitle={q.data ? `${q.data.contractorName} (${q.data.tradeCode})` : undefined}
      onClose={onClose}
      maxWidth="max-w-2xl"
    >
      <div className="p-5 space-y-4">
        {q.isLoading ? <Loader /> : q.data ? <CaseDetail projectId={projectId} c={q.data} /> : <p className="text-xs text-slate-500">Could not load the case.</p>}
      </div>
    </ModalShell>
  );
}

function CaseDetail({ projectId, c }: { projectId: string; c: ContractorDefaultCaseDto }) {
  const act = useActOnDefaultCaseMutation(projectId);
  const status = DEFAULT_CASE_STATUS_META[c.status];

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip label={status.label} cls={status.cls} />
        <span className="text-[11px] text-slate-500">
          {c.trigger === "MILESTONE_OVERDUE" ? "Opened automatically: milestone overdue" : `Raised by ${c.openedByName ?? "someone"}`} ·{" "}
          {formatDateTimeShort(c.openedAt)}
        </span>
      </div>
      {c.milestoneLabel && (
        <p className="text-xs text-slate-700">
          Milestone: <span className="font-semibold">{c.milestoneLabel}</span>
        </p>
      )}
      <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-800 whitespace-pre-wrap">{c.summary}</p>
      {(c.outcomeNotes || c.newDueDate || c.decidedAt) && (
        <div className="rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-700 space-y-0.5">
          {c.decidedAt && <p>Decided {formatDateTimeShort(c.decidedAt)}</p>}
          {c.newDueDate && <p>New date: {c.newDueDate}</p>}
          {c.outcomeNotes && <p className="text-slate-600">“{c.outcomeNotes}”</p>}
        </div>
      )}

      <ApprovalProgressBar
        approval={c.approval}
        title="Default case chain"
        isPending={act.isPending}
        hideActions={!c.isOpen || c.atDecisionStep}
        onReview={(decision, notes) => act.mutateAsync({ caseId: c.id, body: { decision, notes } })}
      />

      {c.isOpen && c.atDecisionStep && (
        c.approval.canAct ? (
          <DecisionForm projectId={projectId} c={c} />
        ) : (
          c.approval.cannotActReason && <p className="text-[11px] text-slate-500">{c.approval.cannotActReason}</p>
        )
      )}

      {c.status === "TERMINATED" && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3 text-xs text-slate-700">
          <p>The contract with {c.contractorName} is terminated. Its history, certified progress and retention stay on the project.</p>
        </div>
      )}
    </>
  );
}

function DecisionForm({ projectId, c }: { projectId: string; c: ContractorDefaultCaseDto }) {
  const act = useActOnDefaultCaseMutation(projectId);
  const { ask, dialog } = useConfirmDialog();
  const [outcome, setOutcome] = useState<DefaultCaseOutcome | null>(null);
  const [newDueDate, setNewDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [returning, setReturning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsDate = outcome === "CURE_PERIOD" || outcome === "EXTENSION_GRANTED";

  const decide = async () => {
    if (!outcome) return setError("Choose an outcome.");
    if (needsDate && !newDueDate) return setError("Set the new date.");
    setError(null);
    if (outcome === "TERMINATED") {
      const ok = await ask({
        title: `Terminate the contract with ${c.contractorName}?`,
        message: (
          <div className="space-y-2">
            <p>This ends the contractor's contract on this project and waives its open milestones.</p>
            <p>Its reports, payments, certified progress, retention and open defects stay on record.</p>
          </div>
        ),
        confirmLabel: "Terminate the contract",
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await act.mutateAsync({
        caseId: c.id,
        body: { decision: "APPROVE", outcome, notes: notes.trim() || null, ...(needsDate ? { newDueDate } : {}) },
      });
    } catch {
      // The mutation hook shows the error.
    }
  };

  const sendBack = async () => {
    if (notes.trim().length < 5) return setError("Say why the case is returned (at least 5 characters).");
    setError(null);
    try {
      await act.mutateAsync({ caseId: c.id, body: { decision: "RETURN", notes: notes.trim() } });
      setReturning(false);
    } catch {
      // The mutation hook shows the error.
    }
  };

  return (
    <div className="rounded-xl border border-brand-primary/25 bg-brand-primary/5 p-4 space-y-3">
      {dialog}
      <p className="text-xs font-bold text-slate-900">Decision</p>
      {!returning && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Outcome">
          {DefaultCaseOutcomeEnum.options.map((o) => (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={outcome === o}
              onClick={() => setOutcome(o)}
              className={`text-left rounded-xl border p-3 transition disabled:cursor-not-allowed disabled:opacity-60 ${
                outcome === o ? (o === "TERMINATED" ? "border-rose-400 bg-rose-50" : "border-brand-primary bg-white") : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <p className={`text-xs font-bold ${o === "TERMINATED" ? "text-rose-700" : "text-slate-900"}`}>{DEFAULT_CASE_OUTCOME_META[o].label}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">{DEFAULT_CASE_OUTCOME_META[o].description}</p>
            </button>
          ))}
        </div>
      )}
      {needsDate && !returning && (
        <div className="max-w-xs">
          <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="case-new-date">
            {outcome === "CURE_PERIOD" ? "Remedy by" : "New due date"}
          </label>
          <input id="case-new-date" type="date" className={smallInput} value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} />
        </div>
      )}
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="case-notes">
          {returning ? "Why it is returned (required)" : "Notes (optional)"}
        </label>
        <textarea id="case-notes" rows={3} maxLength={2000} className={smallInput} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {error && <p className="text-[11px] font-medium text-rose-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {returning ? (
          <>
            <button type="button" className={primaryButton} disabled={act.isPending} onClick={sendBack}>
              Return to the first step
            </button>
            <button type="button" className={secondaryButton} onClick={() => setReturning(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={outcome === "TERMINATED" ? "inline-flex items-center rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50" : primaryButton}
              disabled={act.isPending || !outcome}
              onClick={decide}
            >
              {act.isPending ? "Saving…" : "Record decision"}
            </button>
            <button type="button" className={secondaryButton} onClick={() => setReturning(true)}>
              Return instead
            </button>
          </>
        )}
      </div>
    </div>
  );
}
