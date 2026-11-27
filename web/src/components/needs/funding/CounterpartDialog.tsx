import React, { useState } from "react";
import { z } from "zod";
import { RecordCounterpartRequestSchema, type NeedsSubmissionDto } from "@insite/shared";
import { ModalShell } from "../../common/ModalShell";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm, zNumberText } from "../../../lib/forms";
import { useRecordCounterpartMutation } from "../../../mutations/needs/useFundingMutations";
import { inputCls, labelCls } from "../needsUi";
import { DocumentFileField } from "./fundingUi";

/**
 * Needs pipeline wave 4 (C2, A5): record the State's counterpart funds on its BEAP (amount and
 * evidence), also after approval. A Matching Grants project cannot be activated until it is recorded.
 * With evidence already on the BEAP, a new file is optional (the amount can be corrected alone).
 */

const FormSchema = z.object({ counterpartDeclaredNgn: zNumberText("Amount", { min: 1 }).pipe(RecordCounterpartRequestSchema.shape.counterpartDeclaredNgn) });

export function CounterpartDialog({ cycleId, beap, interventionYear, onClose }: { cycleId: string; beap: NeedsSubmissionDto; interventionYear: number; onClose: () => void }) {
  const record = useRecordCounterpartMutation(cycleId);
  const existing = beap.counterpartEvidenceDocumentId;
  const form = useZodForm(FormSchema, {
    defaultValues: { counterpartDeclaredNgn: beap.counterpartDeclaredNgn ? String(beap.counterpartDeclaredNgn) : "" },
  });
  const [file, setFile] = useState<File | null>(null);

  const submit = form.handleSubmit(({ counterpartDeclaredNgn }) => {
    const evidence = file ? { file, title: `Counterpart funding evidence ${interventionYear}` } : existing ? { documentId: existing } : null;
    if (!evidence) return;
    record.mutate({ counterpartDeclaredNgn, evidence }, { onSuccess: () => onClose() });
  });

  return (
    <ModalShell title="Record counterpart evidence" subtitle="The State's counterpart funds for this BEAP" onClose={onClose}>
      <form className="space-y-3 p-5" noValidate onSubmit={submit}>
        <p className="text-xs text-slate-700">
          No project from this BEAP can be activated until the counterpart evidence is recorded. Upload the release letter, bank statement or similar proof.
        </p>
        <div>
          <label className={labelCls} htmlFor="counterpart-amount">
            Counterpart funds (₦) <span className="text-rose-600">*</span>
          </label>
          <input
            id="counterpart-amount"
            inputMode="decimal"
            className={`${inputCls} ${invalidClass(form, "counterpartDeclaredNgn")}`}
            {...form.register("counterpartDeclaredNgn")}
            {...fieldA11y(form, "counterpartDeclaredNgn")}
          />
          <FieldError form={form} name="counterpartDeclaredNgn" />
        </div>
        <DocumentFileField
          id="counterpart-evidence"
          label="Evidence"
          required={!existing}
          file={file}
          onChange={setFile}
          hint={existing ? "Evidence is already on file: choose a file only to replace it." : undefined}
        />
        <div className="flex flex-wrap items-start justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">
            Cancel
          </button>
          <SubmitButton
            form={form}
            pending={record.isPending}
            pendingLabel={file ? "Uploading…" : "Saving…"}
            blocked={!file && !existing}
            hint={!file && !existing ? "Enter the amount and choose the evidence file." : undefined}
          >
            Record counterpart
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}
