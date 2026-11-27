import React, { useRef, useState } from "react";
import { z } from "zod";
import { FileUp } from "lucide-react";
import {
  NEEDS_DOCUMENT_UPLOAD_POLICY,
  PROPOSAL_DOCUMENT_KIND_LABELS,
  RegisterProposalDocumentRequestSchema,
  type ProposalDocumentKind,
} from "@insite/shared";
import { ModalShell } from "../../common/ModalShell";
import { CustomSelect } from "../../common/CustomSelect";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../../lib/forms";
import { mimeTypeOf } from "../../../api/needsPipeline";
import { useUploadOutOfCycleDocumentMutation } from "../../../mutations/needs/useApprovalMutations";
import { DOCUMENT_FILE_ACCEPT, formatBytes, inputCls, labelCls } from "../needsUi";

/**
 * Needs pipeline wave 4 (C4): add a document to an out-of-cycle request: the authorising document
 * (required before submitting) or a supporting one (drawing, photo, site report, …).
 */

const KINDS: ProposalDocumentKind[] = ["AUTHORISING_DOCUMENT", "DRAWING", "SPECIFICATION", "PHOTO", "SITE_REPORT", "OTHER"];
const DEFAULT_TITLES: Partial<Record<ProposalDocumentKind, string>> = { AUTHORISING_DOCUMENT: "Authorising document" };

const FormSchema = z.object({ title: RegisterProposalDocumentRequestSchema.shape.title });

export function OutOfCycleDocumentDialog({ proposalId, initialKind, onClose }: { proposalId: string; initialKind: ProposalDocumentKind; onClose: () => void }) {
  const upload = useUploadOutOfCycleDocumentMutation(proposalId);
  const [kind, setKind] = useState<ProposalDocumentKind>(initialKind);
  const form = useZodForm(FormSchema, { defaultValues: { title: DEFAULT_TITLES[initialKind] ?? "" } });
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const submit = form.handleSubmit((v) => {
    if (!file) return;
    upload.mutate({ file, kind, title: v.title }, { onSuccess: () => onClose() });
  });

  return (
    <ModalShell title="Add a document" subtitle="To the out-of-cycle request" onClose={onClose}>
      <form className="space-y-3 p-5" noValidate onSubmit={submit}>
        <div>
          <label className={labelCls} htmlFor="ooc-doc-kind">
            Kind <span className="text-rose-600">*</span>
          </label>
          <CustomSelect
            id="ooc-doc-kind"
            value={kind}
            onChange={(v) => {
              setKind(v);
              if (!form.getValues("title") && DEFAULT_TITLES[v]) form.setValue("title", DEFAULT_TITLES[v]!, { shouldValidate: true });
            }}
            options={KINDS.map((k) => ({ value: k, label: PROPOSAL_DOCUMENT_KIND_LABELS[k] }))}
            size="sm"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="ooc-doc-title">
            Title <span className="text-rose-600">*</span>
          </label>
          <input id="ooc-doc-title" className={`${inputCls} ${invalidClass(form, "title")}`} {...form.register("title")} {...fieldA11y(form, "title")} />
          <FieldError form={form} name="title" />
        </div>
        <div>
          <p className={labelCls}>
            File <span className="text-rose-600">*</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              onClick={() => fileRef.current?.click()}
            >
              <FileUp className="h-3.5 w-3.5" aria-hidden="true" /> {file ? "Choose another file" : "Choose file"}
            </button>
            {file && (
              <span className="text-xs text-slate-700">
                {file.name} <span className="text-slate-500">· {formatBytes(file.size)}</span>
              </span>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={DOCUMENT_FILE_ACCEPT}
            className="hidden"
            aria-label="Document file"
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
              setFile(problem ? null : f);
            }}
          />
          {fileError && <p className="mt-1 text-xs font-medium text-rose-700">{fileError}</p>}
        </div>
        <div className="flex flex-wrap items-start justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">
            Cancel
          </button>
          <SubmitButton form={form} pending={upload.isPending} pendingLabel="Uploading…" blocked={!file} hint={file ? undefined : "Choose the file."}>
            Upload
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}
