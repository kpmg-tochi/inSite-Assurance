import React, { useMemo, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import {
  NEEDS_DOCUMENT_UPLOAD_POLICY,
  NeedsApprovalActionRequestSchema,
  type NeedsApprovalActionRequestInput,
  type NeedsSubmissionDto,
} from "@insite/shared";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm, visibleError } from "../../../lib/forms";
import { formatDateTimeShort } from "../../../lib/formatters";
import { getCycleDocumentLink, mimeTypeOf } from "../../../api/needsPipeline";
import { useNeedsCycleQuery } from "../../../queries/needs/useNeedsQueries";
import { useOpenNeedsFileMutation } from "../../../mutations/needs/useNeedsMutations";
import { useUploadApprovalMemoMutation } from "../../../mutations/needs/useApprovalMutations";
import { DOCUMENT_FILE_ACCEPT, cardCls, formatBytes, inputCls, labelCls, money } from "../needsUi";
import { isLastStep } from "./submissionUi";

/**
 * Needs pipeline wave 4 (C1): the decision at the current step of a cycle chain, for the person the
 * server says may act (`canAct`). Approve or return (a return needs notes). On the portfolio, approving
 * may exclude more proposed projects (each with a reason), and the last step needs the signed approval
 * memo: choose one already on the cycle or upload it here.
 */

export function ApprovalDecisionForm({
  submission,
  cycleId,
  portfolio,
  pending,
  onDecide,
}: {
  submission: NeedsSubmissionDto;
  cycleId: string;
  /** Portfolio / State approval: extra exclusions and the memo on the last step. */
  portfolio: boolean;
  pending: boolean;
  onDecide: (body: NeedsApprovalActionRequestInput, done: () => void) => void;
}) {
  const form = useZodForm(NeedsApprovalActionRequestSchema, {
    defaultValues: { decision: "APPROVE", notes: "", exclusions: [], memoDocumentId: null },
  });
  const decision = form.watch("decision");
  const exclusions = form.watch("exclusions") ?? [];
  const memoDocumentId = form.watch("memoDocumentId") ?? null;
  const lastStep = isLastStep(submission);
  const needsMemo = portfolio && lastStep && decision === "APPROVE";
  const currentStep = submission.steps.find((s) => s.state === "CURRENT");
  const included = submission.items.filter((i) => i.included);

  const setDecision = (d: "APPROVE" | "RETURN") => {
    form.setValue("decision", d, { shouldValidate: true, shouldDirty: true });
    if (d === "RETURN") form.setValue("exclusions", [], { shouldValidate: true });
    form.trigger("notes");
  };

  const setExclusions = (next: Array<{ proposalId: string; reason: string }>) =>
    form.setValue("exclusions", next, { shouldValidate: true, shouldDirty: true, shouldTouch: true });

  const toggleExclusion = (proposalId: string, on: boolean) =>
    setExclusions(on ? [...exclusions, { proposalId, reason: "" }] : exclusions.filter((e) => e.proposalId !== proposalId));

  const submit = form.handleSubmit((v) => {
    onDecide(
      {
        decision: v.decision,
        notes: v.notes ? v.notes : null,
        exclusions: v.decision === "APPROVE" ? v.exclusions : [],
        memoDocumentId: v.decision === "APPROVE" ? v.memoDocumentId : null,
      },
      () => form.reset({ decision: "APPROVE", notes: "", exclusions: [], memoDocumentId: null })
    );
  });

  const excludedTotal = included.filter((i) => exclusions.some((e) => e.proposalId === i.proposalId)).reduce((s, i) => s + (i.amountNgn ?? 0), 0);

  return (
    <form className={`${cardCls} space-y-4`} noValidate onSubmit={submit} aria-labelledby="approval-decision-heading">
      <div>
        <h3 id="approval-decision-heading" className="text-sm font-bold text-slate-900">
          Your decision{currentStep ? `: ${currentStep.label}` : ""}
        </h3>
        <p className="text-[11px] text-slate-500">
          {lastStep ? "This is the final approval." : "Approving passes it to the next step."} A return sends it back to the submitter to revise and resubmit.
        </p>
      </div>

      <fieldset>
        <legend className={labelCls}>Decision</legend>
        <div className="flex flex-wrap gap-2">
          {(["APPROVE", "RETURN"] as const).map((d) => (
            <label
              key={d}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
                decision === d ? "border-brand-primary bg-brand-primary/5 text-brand-primary" : "border-slate-300 text-slate-700"
              }`}
            >
              <input type="radio" name="approval-decision" className="sr-only" checked={decision === d} onChange={() => setDecision(d)} />
              {d === "APPROVE" ? (lastStep ? "Approve" : "Approve and pass on") : "Return for revision"}
            </label>
          ))}
        </div>
      </fieldset>

      {portfolio && decision === "APPROVE" && included.length > 0 && (
        <fieldset>
          <legend className={labelCls}>
            Exclude more proposed projects <span className="font-normal text-slate-500">(optional, each with a reason)</span>
          </legend>
          <ul className="max-h-72 space-y-1.5 overflow-y-auto rounded-xl border border-slate-200 p-2">
            {included.map((item) => {
              const index = exclusions.findIndex((e) => e.proposalId === item.proposalId);
              const on = index >= 0;
              const name = `exclusions.${index}.reason`;
              return (
                <li key={item.proposalId} className="text-xs">
                  <label className="flex items-start gap-2">
                    <input type="checkbox" className="mt-0.5" checked={on} onChange={(e) => toggleExclusion(item.proposalId, e.target.checked)} />
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold text-slate-900">{item.reference}</span> <span className="text-slate-600">· {item.title}</span>
                      <span className="ml-1 tabular-nums text-slate-500">· {money(item.amountNgn)}</span>
                    </span>
                  </label>
                  {on && (
                    <div className="ml-6 mt-1">
                      <label className="sr-only" htmlFor={`exclude-reason-${item.proposalId}`}>
                        Reason for excluding {item.reference}
                      </label>
                      <input
                        id={`exclude-reason-${item.proposalId}`}
                        className={`${inputCls} ${visibleError(form, name) ? "border-rose-400" : ""}`}
                        placeholder="Reason for the exclusion (required)"
                        value={exclusions[index].reason}
                        onChange={(e) => setExclusions(exclusions.map((x, n) => (n === index ? { ...x, reason: e.target.value } : x)))}
                        {...fieldA11y(form, name)}
                      />
                      <FieldError form={form} name={name} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {exclusions.length > 0 && (
            <p className="mt-1 text-[11px] text-slate-600">
              Excluding {exclusions.length} ({money(excludedTotal)}). They will be marked not selected and carried forward to the next cycle.
            </p>
          )}
        </fieldset>
      )}

      {needsMemo && (
        <MemoPicker
          cycleId={cycleId}
          selectedId={memoDocumentId}
          onSelect={(id) => form.setValue("memoDocumentId", id, { shouldValidate: true, shouldDirty: true })}
        />
      )}

      <div>
        <label className={labelCls} htmlFor="approval-notes">
          Notes {decision === "RETURN" ? <span className="text-rose-600">*</span> : <span className="font-normal text-slate-500">(optional)</span>}
        </label>
        <textarea
          id="approval-notes"
          rows={3}
          className={`${inputCls} ${invalidClass(form, "notes")}`}
          placeholder={decision === "RETURN" ? "Say what must change before it comes back" : "e.g. Approved at the management meeting of 30 October"}
          {...form.register("notes")}
          {...fieldA11y(form, "notes")}
        />
        <FieldError form={form} name="notes" />
      </div>

      <div className="flex justify-end">
        <SubmitButton
          form={form}
          pending={pending}
          pendingLabel="Recording…"
          blocked={needsMemo && !memoDocumentId}
          hint={decision === "RETURN" ? "Say what must change." : "Give a reason for every exclusion."}
        >
          {decision === "RETURN" ? "Return for revision" : lastStep ? "Approve" : "Approve and pass on"}
        </SubmitButton>
      </div>
      {needsMemo && !memoDocumentId && <p className="text-right text-[11px] text-slate-500">Choose or upload the signed approval memo to approve.</p>}
    </form>
  );
}

/** The signed approval memo: one already on the cycle (newest first), or a new upload (selected once uploaded). */
function MemoPicker({ cycleId, selectedId, onSelect }: { cycleId: string; selectedId: string | null; onSelect: (id: string) => void }) {
  const cycleQuery = useNeedsCycleQuery(cycleId);
  const upload = useUploadApprovalMemoMutation(cycleId);
  const openFile = useOpenNeedsFileMutation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const memos = useMemo(() => {
    const docs = cycleQuery.data?.documents ?? [];
    const superseded = new Set(docs.map((d) => d.supersedesId).filter(Boolean));
    return docs.filter((d) => d.kind === "APPROVAL_MEMO" && !superseded.has(d.id)).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }, [cycleQuery.data]);

  return (
    <fieldset>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <legend className={labelCls}>
          Signed approval memo <span className="text-rose-600">*</span>
        </legend>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-primary hover:underline disabled:opacity-50"
          disabled={upload.isPending}
          onClick={() => fileRef.current?.click()}
        >
          <FileUp className="h-3.5 w-3.5" aria-hidden="true" /> {upload.isPending ? "Uploading…" : "Upload the memo"}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={DOCUMENT_FILE_ACCEPT}
        className="hidden"
        aria-label="Approval memo file"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = "";
          if (!f) return;
          const problem =
            f.size > NEEDS_DOCUMENT_UPLOAD_POLICY.maxBytes
              ? `The file is larger than ${Math.round(NEEDS_DOCUMENT_UPLOAD_POLICY.maxBytes / 1024 / 1024)} MB.`
              : !NEEDS_DOCUMENT_UPLOAD_POLICY.mimeTypes.includes(mimeTypeOf(f))
                ? "Choose a PDF, photo, Word, Excel or text file."
                : null;
          setFileError(problem);
          if (!problem) upload.mutate({ file: f, title: "Approval memo (signed)" }, { onSuccess: (doc) => onSelect(doc.id) });
        }}
      />
      {fileError && <p className="mt-1 text-xs font-medium text-rose-700">{fileError}</p>}
      {memos.length === 0 ? (
        <p className="text-xs text-slate-500">No memo on the cycle yet. Scan the signed memo and upload it.</p>
      ) : (
        <div className="space-y-1 rounded-xl border border-slate-200 p-2">
          {memos.map((d) => (
            <div key={d.id} className="flex flex-wrap items-start justify-between gap-2 text-xs">
              <label className="flex min-w-0 items-start gap-2 text-slate-700">
                <input type="radio" name="approval-memo" className="mt-0.5" checked={selectedId === d.id} onChange={() => onSelect(d.id)} />
                <span className="min-w-0">
                  <span className="font-semibold text-slate-900">{d.title}</span>
                  <span className="block text-[11px] text-slate-500">
                    {d.fileName} · {formatBytes(d.byteSize)} · {d.uploadedByName}, {formatDateTimeShort(d.uploadedAt)}
                  </span>
                </span>
              </label>
              <button
                type="button"
                className="text-[11px] font-semibold text-brand-primary hover:underline disabled:opacity-50"
                disabled={openFile.isPending}
                onClick={() => openFile.mutate(() => getCycleDocumentLink(cycleId, d.id))}
              >
                Open
              </button>
            </div>
          ))}
        </div>
      )}
    </fieldset>
  );
}
