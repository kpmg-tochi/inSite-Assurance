import React, { useState } from "react";
import { z } from "zod";
import { RecordBudgetSubmissionRequestSchema } from "@insite/shared";
import { ModalShell } from "../../common/ModalShell";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm, zDateText, zNumberText, zOptionalText } from "../../../lib/forms";
import { useRecordBudgetSubmissionMutation } from "../../../mutations/needs/useFundingMutations";
import { inputCls, labelCls, todayInTenant } from "../needsUi";
import { DocumentFileField } from "./fundingUi";

/**
 * Needs pipeline wave 4 (C3): record that the approved portfolio went into the budget (Direct
 * Intervention): date, amount, and the acknowledgement from the budget office (optional; uploaded
 * first and named on the record), with a note.
 */

const FormSchema = z
  .object({
    submittedOn: zDateText("Submission date"),
    amountNgn: zNumberText("Amount", { min: 1 }),
    note: zOptionalText(2000),
  })
  .transform((v) => ({ submittedOn: v.submittedOn, amountNgn: v.amountNgn, note: v.note ?? null }))
  .pipe(RecordBudgetSubmissionRequestSchema.omit({ acknowledgementDocumentId: true }));

export function BudgetSubmissionDialog({ cycleId, suggestedAmountNgn, onClose }: { cycleId: string; suggestedAmountNgn: number | null; onClose: () => void }) {
  const record = useRecordBudgetSubmissionMutation(cycleId);
  const today = todayInTenant();
  const form = useZodForm(FormSchema, {
    defaultValues: { submittedOn: today, amountNgn: suggestedAmountNgn ? String(Math.round(suggestedAmountNgn)) : "", note: "" },
  });
  const [file, setFile] = useState<File | null>(null);

  const submit = form.handleSubmit((body) =>
    record.mutate(
      { body, acknowledgement: file ? { file, title: `Budget submission acknowledgement ${body.submittedOn}` } : null },
      { onSuccess: () => onClose() }
    )
  );

  return (
    <ModalShell title="Record budget submission" subtitle="The approved portfolio as submitted for the appropriation" onClose={onClose}>
      <form className="space-y-3 p-5" noValidate onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="budget-submitted-on">
              Submitted on <span className="text-rose-600">*</span>
            </label>
            <input
              id="budget-submitted-on"
              type="date"
              max={today}
              className={`${inputCls} ${invalidClass(form, "submittedOn")}`}
              {...form.register("submittedOn")}
              {...fieldA11y(form, "submittedOn")}
            />
            <FieldError form={form} name="submittedOn" />
          </div>
          <div>
            <label className={labelCls} htmlFor="budget-amount">
              Amount submitted (₦) <span className="text-rose-600">*</span>
            </label>
            <input
              id="budget-amount"
              inputMode="decimal"
              className={`${inputCls} ${invalidClass(form, "amountNgn")}`}
              {...form.register("amountNgn")}
              {...fieldA11y(form, "amountNgn")}
            />
            <FieldError form={form} name="amountNgn" />
            {suggestedAmountNgn !== null && <p className="mt-1 text-[11px] text-slate-500">Filled with the approved total; change it if the submission differs.</p>}
          </div>
        </div>
        <DocumentFileField
          id="budget-acknowledgement"
          label="Acknowledgement"
          file={file}
          onChange={setFile}
          hint="The budget office's acknowledgement, if you have it (PDF, photo, Word, Excel or text). It can also be added later on Cycle documents."
        />
        <div>
          <label className={labelCls} htmlFor="budget-note">
            Note
          </label>
          <textarea id="budget-note" rows={2} className={`${inputCls} ${invalidClass(form, "note")}`} {...form.register("note")} {...fieldA11y(form, "note")} />
          <FieldError form={form} name="note" />
        </div>
        <div className="flex flex-wrap items-start justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">
            Cancel
          </button>
          <SubmitButton form={form} pending={record.isPending} pendingLabel={file ? "Uploading…" : "Saving…"}>
            Record submission
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}
