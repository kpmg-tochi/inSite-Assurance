import React, { useState } from "react";
import { Search } from "lucide-react";
import { ConflictDeclarationRequestSchema } from "@insite/shared";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../../lib/forms";
import { useDeclareConflictsMutation } from "../../../mutations/needs/useCommitteeMutations";
import { inputCls, labelCls } from "../needsUi";

export interface DeclarableProposal {
  id: string;
  reference: string;
  title: string;
}

/**
 * D2: a member's conflict-of-interest declaration, required before scoring (D-N.10). "No conflict"
 * names no proposed project; a conflict names the proposed projects and may carry a statement. The
 * member is recused from the ones they name.
 */
export function DeclarationForm({
  cycleId,
  proposals,
  initial,
  onDone,
  onCancel,
}: {
  cycleId: string;
  proposals: readonly DeclarableProposal[];
  initial?: { conflictedProposalIds: string[]; statement: string | null } | null;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const declare = useDeclareConflictsMutation(cycleId);
  const [filter, setFilter] = useState("");
  const form = useZodForm(ConflictDeclarationRequestSchema, {
    defaultValues: {
      hasConflict: Boolean(initial?.conflictedProposalIds.length),
      conflictedProposalIds: initial?.conflictedProposalIds ?? [],
      statement: initial?.statement ?? "",
    },
  });
  const hasConflict = form.watch("hasConflict");
  const conflicted = form.watch("conflictedProposalIds") ?? [];
  const opts = { shouldValidate: true, shouldDirty: true, shouldTouch: true } as const;

  const q = filter.trim().toLowerCase();
  const shown = q ? proposals.filter((p) => `${p.reference} ${p.title}`.toLowerCase().includes(q)) : proposals;

  const submit = form.handleSubmit((values) =>
    declare.mutate(
      {
        hasConflict: values.hasConflict,
        conflictedProposalIds: values.hasConflict ? values.conflictedProposalIds : [],
        statement: values.statement?.trim() ? values.statement.trim() : null,
      },
      { onSuccess: () => onDone?.() }
    )
  );

  return (
    <form className="space-y-3" noValidate onSubmit={submit} aria-labelledby="declaration-heading">
      <div>
        <h3 id="declaration-heading" className="text-sm font-bold text-slate-900">
          Declare conflicts of interest
        </h3>
        <p className="mt-0.5 text-xs text-slate-600">
          Required before you score. You will not score a proposed project you have a conflict with, nor one you uploaded, validated or costed.
        </p>
      </div>

      <fieldset>
        <legend className={labelCls}>Do you have a conflict of interest with any proposed project in this cycle?</legend>
        <div className="space-y-1.5">
          <label className="flex items-start gap-2 rounded-xl border border-slate-200 p-2.5 text-xs text-slate-800 has-[:checked]:border-brand-primary has-[:checked]:bg-brand-primary/5">
            <input
              type="radio"
              name="hasConflict"
              className="mt-0.5"
              checked={!hasConflict}
              onChange={() => {
                form.setValue("hasConflict", false, opts);
                form.setValue("conflictedProposalIds", [], opts);
              }}
            />
            <span>
              <span className="font-semibold">No conflict of interest</span>
              <span className="block text-[11px] text-slate-500">I have no personal, financial or family interest in any proposed project of this cycle.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-xl border border-slate-200 p-2.5 text-xs text-slate-800 has-[:checked]:border-brand-primary has-[:checked]:bg-brand-primary/5">
            <input type="radio" name="hasConflict" className="mt-0.5" checked={hasConflict} onChange={() => form.setValue("hasConflict", true, opts)} />
            <span>
              <span className="font-semibold">I have a conflict with some proposed projects</span>
              <span className="block text-[11px] text-slate-500">Name them below. You will be recused from scoring them.</span>
            </span>
          </label>
        </div>
        <FieldError form={form} name="hasConflict" />
      </fieldset>

      {hasConflict && (
        <fieldset>
          <legend className={labelCls}>
            Proposed projects you have a conflict with <span className="text-rose-600">*</span>
          </legend>
          {proposals.length > 8 && (
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              <input className={`${inputCls} pl-8`} placeholder="Search by reference or title" aria-label="Search proposed projects" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
          )}
          {proposals.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 p-3 text-xs text-slate-600">This cycle has no proposed projects to name yet.</p>
          ) : (
            <div className="max-h-60 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2" {...fieldA11y(form, "conflictedProposalIds")}>
              {shown.map((p) => (
                <label key={p.id} className="flex items-start gap-2 rounded-lg px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={conflicted.includes(p.id)}
                    onChange={(e) => form.setValue("conflictedProposalIds", e.target.checked ? [...conflicted, p.id] : conflicted.filter((id) => id !== p.id), opts)}
                  />
                  <span>
                    <span className="font-semibold text-slate-900">{p.reference}</span> · {p.title}
                  </span>
                </label>
              ))}
              {shown.length === 0 && <p className="p-2 text-xs text-slate-500">Nothing matches the search.</p>}
            </div>
          )}
          <FieldError form={form} name="conflictedProposalIds" />
        </fieldset>
      )}

      <div>
        <label className={labelCls} htmlFor="declaration-statement">
          Statement {hasConflict ? "(what the conflict is)" : "(optional)"}
        </label>
        <textarea
          id="declaration-statement"
          rows={3}
          className={`${inputCls} ${invalidClass(form, "statement")}`}
          {...form.register("statement")}
          {...fieldA11y(form, "statement")}
        />
        <FieldError form={form} name="statement" />
      </div>

      <div className="flex flex-wrap items-start justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">
            Cancel
          </button>
        )}
        <SubmitButton form={form} pending={declare.isPending} pendingLabel="Saving…" hint={hasConflict ? "Name at least one proposed project." : undefined}>
          Save declaration
        </SubmitButton>
      </div>
    </form>
  );
}
