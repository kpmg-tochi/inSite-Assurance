import { z } from "zod";
import { ActOnDefaultCaseRequestSchema, DEFAULT_CASE_OUTCOME_META, DefaultCaseOutcomeEnum, type ActOnDefaultCaseRequest, type ContractorDefaultCaseDto } from "@insite/shared";
import { ModalShell } from "../common/ModalShell";
import { ApprovalProgressBar } from "../process/ApprovalProgressBar";
import { useConfirmDialog } from "../process/ConfirmDialog";
import Loader from "../Loader";
import { formatDateTimeShort } from "../../lib/formatters";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../lib/forms";
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

const DecisionFormSchema = z
  .object({
    decision: z.enum(["APPROVE", "RETURN"]),
    outcome: DefaultCaseOutcomeEnum.nullable(),
    newDueDate: z.string(),
    notes: z.string().trim().max(2000, "Notes are too long (at most 2000 characters)"),
  })
  .superRefine((v, ctx) => {
    if (v.decision === "APPROVE") {
      if (!v.outcome) ctx.addIssue({ code: "custom", path: ["outcome"], message: "Choose an outcome" });
      const needsDate = v.outcome === "CURE_PERIOD" || v.outcome === "EXTENSION_GRANTED";
      if (needsDate && !/^\d{4}-\d{2}-\d{2}$/.test(v.newDueDate)) ctx.addIssue({ code: "custom", path: ["newDueDate"], message: "Set the new date" });
    } else if (v.notes.length < 5) {
      ctx.addIssue({ code: "custom", path: ["notes"], message: "Say why the case is returned (at least 5 characters)" });
    }
  })
  .transform((v): ActOnDefaultCaseRequest => {
    if (v.decision === "RETURN") return { decision: "RETURN", notes: v.notes };
    const needsDate = v.outcome === "CURE_PERIOD" || v.outcome === "EXTENSION_GRANTED";
    return { decision: "APPROVE", outcome: v.outcome ?? undefined, notes: v.notes || null, ...(needsDate ? { newDueDate: v.newDueDate } : {}) };
  })
  .pipe(ActOnDefaultCaseRequestSchema);

function DecisionForm({ projectId, c }: { projectId: string; c: ContractorDefaultCaseDto }) {
  const act = useActOnDefaultCaseMutation(projectId);
  const { ask, dialog } = useConfirmDialog();
  const form = useZodForm(DecisionFormSchema, { defaultValues: { decision: "APPROVE", outcome: null, newDueDate: "", notes: "" } });
  const returning = form.watch("decision") === "RETURN";
  const outcome = form.watch("outcome");
  const needsDate = outcome === "CURE_PERIOD" || outcome === "EXTENSION_GRANTED";
  const setReturning = (on: boolean) => form.setValue("decision", on ? "RETURN" : "APPROVE", { shouldValidate: true });

  const submit = form.handleSubmit(async (body) => {
    if (body.decision === "APPROVE" && body.outcome === "TERMINATED") {
      const ok = await ask({
        title: `Terminate the contract with ${c.contractorName}?`,
        message: (
          <div className="space-y-2">
            <p>This ends the contractor's contract on this project and waives its open milestones.</p>
            <p>Its monitoring visits, payments, progress, retention and open defects stay on record.</p>
          </div>
        ),
        confirmLabel: "Terminate the contract",
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await act.mutateAsync({ caseId: c.id, body });
      if (body.decision === "RETURN") setReturning(false);
    } catch {
      // The mutation hook shows the error.
    }
  });

  return (
    <form onSubmit={submit} noValidate className="rounded-xl border border-brand-primary/25 bg-brand-primary/5 p-4 space-y-3">
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
              onClick={() => form.setValue("outcome", o, { shouldValidate: true, shouldTouch: true })}
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
          <input id="case-new-date" type="date" className={`${smallInput} ${invalidClass(form, "newDueDate")}`} {...form.register("newDueDate")} {...fieldA11y(form, "newDueDate")} />
          <FieldError form={form} name="newDueDate" />
        </div>
      )}
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="case-notes">
          {returning ? "Why it is returned (required)" : "Notes (optional)"}
        </label>
        <textarea id="case-notes" rows={3} maxLength={2000} className={`${smallInput} ${invalidClass(form, "notes")}`} {...form.register("notes")} {...fieldA11y(form, "notes")} />
        <FieldError form={form} name="notes" />
      </div>
      <div className="flex flex-wrap items-start gap-2">
        {returning ? (
          <>
            <SubmitButton form={form} pending={act.isPending} className={primaryButton} hint="Say why the case is returned.">
              Return to the first step
            </SubmitButton>
            <button type="button" className={secondaryButton} onClick={() => setReturning(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <SubmitButton
              form={form}
              pending={act.isPending}
              pendingLabel="Saving…"
              hint={!outcome ? "Choose an outcome." : "Set the new date."}
              className={
                outcome === "TERMINATED"
                  ? "inline-flex items-center rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  : primaryButton
              }
            >
              Record decision
            </SubmitButton>
            <button type="button" className={secondaryButton} onClick={() => setReturning(true)}>
              Return instead
            </button>
          </>
        )}
      </div>
    </form>
  );
}
