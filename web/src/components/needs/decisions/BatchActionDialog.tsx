import React, { useMemo } from "react";
import { z } from "zod";
import { ProposalBatchActionRequestSchema, type NeedsDecisionResultDto, type ProposalBatchAction } from "@insite/shared";
import { ModalShell } from "../../common/ModalShell";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../../lib/forms";
import { useProposalBatchActionMutation } from "../../../mutations/needs/useDecisionMutations";
import { inputCls, labelCls } from "../needsUi";
import { BatchProblemsList, batchProblemsOf } from "./decisionUi";

/**
 * Needs pipeline wave 3 (C1): submit, resubmit or withdraw one or more proposed projects
 * (`POST /cycles/:cycleId/proposal-actions`). All or nothing: when the server refuses, each refused
 * proposal is listed with its reason and nothing is changed.
 */

const COPY: Record<ProposalBatchAction, { title: string; button: string; pending: string; intro: string }> = {
  SUBMIT: {
    title: "Submit proposed projects",
    button: "Submit",
    pending: "Submitting…",
    intro: "Each moves to the next stage once its current version has the fields that stage needs.",
  },
  RESUBMIT: {
    title: "Resubmit proposed projects",
    button: "Resubmit",
    pending: "Resubmitting…",
    intro: "Each goes back to the stage that returned it, ready for its actor again.",
  },
  WITHDRAW: {
    title: "Withdraw proposed projects",
    button: "Withdraw",
    pending: "Withdrawing…",
    intro: "A withdrawn proposed project is closed and leaves the cycle. This cannot be undone.",
  },
};

export function BatchActionDialog({
  cycleId,
  action,
  proposals,
  onClose,
  onDone,
}: {
  cycleId: string;
  action: ProposalBatchAction;
  proposals: Array<{ id: string; reference: string; title: string }>;
  onClose: () => void;
  onDone?: (result: NeedsDecisionResultDto) => void;
}) {
  const mutation = useProposalBatchActionMutation(cycleId);
  const copy = COPY[action];
  const schema = useMemo(
    () =>
      z.object({
        reason:
          action === "WITHDRAW"
            ? z.string().trim().min(5, "Give the reason for withdrawing").max(2000, "At most 2,000 characters")
            : z.string().trim().max(2000, "At most 2,000 characters"),
      }),
    [action]
  );
  const form = useZodForm(schema, { defaultValues: { reason: "" } });
  const problems = batchProblemsOf(mutation.error);

  const submit = form.handleSubmit((values) => {
    const body = ProposalBatchActionRequestSchema.parse({ action, proposalIds: proposals.map((p) => p.id), reason: values.reason || null });
    mutation.mutate(body, {
      onSuccess: (result) => {
        onDone?.(result);
        onClose();
      },
    });
  });

  return (
    <ModalShell title={copy.title} subtitle={`${proposals.length} selected`} onClose={onClose}>
      <form className="space-y-3 p-5" noValidate onSubmit={submit}>
        <p className="text-xs text-slate-700">{copy.intro}</p>
        <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-xl border border-slate-200 p-2 text-xs">
          {proposals.map((p) => (
            <li key={p.id}>
              <span className="font-semibold text-slate-900">{p.reference}</span> · {p.title}
            </li>
          ))}
        </ul>
        <div>
          <label className={labelCls} htmlFor="batch-reason">
            Reason {action === "WITHDRAW" ? <span className="text-rose-600">*</span> : <span className="font-normal text-slate-500">(optional)</span>}
          </label>
          <textarea id="batch-reason" rows={3} className={`${inputCls} ${invalidClass(form, "reason")}`} {...form.register("reason")} {...fieldA11y(form, "reason")} />
          <FieldError form={form} name="reason" />
        </div>
        <BatchProblemsList problems={problems} />
        <div className="flex flex-wrap items-start justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">
            Cancel
          </button>
          <SubmitButton
            form={form}
            pending={mutation.isPending}
            pendingLabel={copy.pending}
            hint={action === "WITHDRAW" ? "Give the reason for withdrawing." : undefined}
            className={
              action === "WITHDRAW"
                ? "inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-700 px-4 py-2 text-xs font-semibold text-white transition hover:bg-rose-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                : undefined
            }
          >
            {copy.button} {proposals.length === 1 ? "" : `${proposals.length} proposed projects`}
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}
