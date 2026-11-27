import React, { useRef, useState } from "react";
import { z } from "zod";
import { FileUp } from "lucide-react";
import { CYCLE_DOCUMENT_KIND_META, NEEDS_DOCUMENT_UPLOAD_POLICY, RegisterCycleDocumentRequestSchema, type CycleDocumentKind } from "@insite/shared";
import { ModalShell } from "../../common/ModalShell";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../../lib/forms";
import { mimeTypeOf } from "../../../api/needsPipeline";
import { useAddCycleDocumentMutation } from "../../../mutations/needs/useNeedsMutations";
import { DOCUMENT_FILE_ACCEPT, formatBytes, inputCls, labelCls } from "../needsUi";

/**
 * Needs pipeline wave 3 (C5): upload the signed copy of a generated cycle report. It is an ordinary
 * cycle document of the same kind (`generated: false`), covering the same proposed projects, listed
 * beside the generated files; a later signed copy supersedes the earlier one.
 */

const FormSchema = z.object({ title: RegisterCycleDocumentRequestSchema.shape.title });

export function SignedCopyDialog({
  cycleId,
  kind,
  proposalIds,
  supersedesId,
  onClose,
}: {
  cycleId: string;
  kind: CycleDocumentKind;
  proposalIds: string[];
  /** The signed copy it replaces, if any. */
  supersedesId: string | null;
  onClose: () => void;
}) {
  const add = useAddCycleDocumentMutation();
  const label = CYCLE_DOCUMENT_KIND_META[kind].label;
  const form = useZodForm(FormSchema, { defaultValues: { title: `${label} (signed)` } });
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const submit = form.handleSubmit((v) => {
    if (!file) return;
    add.mutate({ cycleId, file, kind, title: v.title, supersedesId, proposalIds }, { onSuccess: () => onClose() });
  });

  return (
    <ModalShell title="Upload the signed copy" subtitle={label} onClose={onClose}>
      <form className="space-y-3 p-5" noValidate onSubmit={submit}>
        <p className="text-xs text-slate-700">
          Scan or photograph the signed report and upload it here. It is kept beside the generated files{supersedesId ? " and replaces the earlier signed copy" : ""}.
        </p>
        <div>
          <label className={labelCls} htmlFor="signed-copy-title">
            Title <span className="text-rose-600">*</span>
          </label>
          <input id="signed-copy-title" className={`${inputCls} ${invalidClass(form, "title")}`} {...form.register("title")} {...fieldA11y(form, "title")} />
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
            aria-label="Signed copy file"
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
          <SubmitButton form={form} pending={add.isPending} pendingLabel="Uploading…" blocked={!file} hint={file ? undefined : "Choose the file."}>
            Upload signed copy
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}
