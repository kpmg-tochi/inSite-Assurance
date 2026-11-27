import React, { useMemo, useRef, useState } from "react";
import { z } from "zod";
import { FileUp } from "lucide-react";
import {
  DESIGN_STANDARD_DOCUMENT_KIND_LABELS,
  DesignStandardDocumentKindEnum,
  NEEDS_DOCUMENT_UPLOAD_POLICY,
  RegisterDesignStandardDocumentRequestSchema,
  type DesignStandardDocumentDto,
  type DesignStandardDocumentKind,
} from "@insite/shared";
import { ModalShell } from "../common/ModalShell";
import { CustomSelect } from "../common/CustomSelect";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm, zChoice } from "../../lib/forms";
import { mimeTypeOf } from "../../api/needsPipeline";
import { useAddDesignDocumentMutation } from "../../mutations/needs/useStandardsMutations";
import { DOCUMENT_FILE_ACCEPT, formatBytes, inputCls, labelCls } from "../needs/needsUi";

/**
 * Needs pipeline wave 2 (C1): add a design standard (standard drawing, specification, guideline) with
 * the facilities it applies to, or upload a new version of one (same kind; the earlier stays listed).
 * File: presign → PUT → register (`standards:manage`).
 */

const FormSchema = z.object({
  kind: zChoice("Kind"),
  title: RegisterDesignStandardDocumentRequestSchema.shape.title,
});

export function DesignDocumentDialog({
  facilities,
  supersedes,
  onClose,
}: {
  facilities: Array<{ code: string; name: string }>;
  supersedes: DesignStandardDocumentDto | null;
  onClose: () => void;
}) {
  const add = useAddDesignDocumentMutation();
  const form = useZodForm(FormSchema, { defaultValues: { kind: supersedes?.kind ?? "", title: supersedes?.title ?? "" } });
  const kind = form.watch("kind");
  const [codes, setCodes] = useState<string[]>(supersedes?.facilityCodes ?? []);
  const [filter, setFilter] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const shownFacilities = useMemo(() => {
    const t = filter.trim().toLowerCase();
    return t ? facilities.filter((f) => f.name.toLowerCase().includes(t) || f.code.toLowerCase().includes(t)) : facilities;
  }, [facilities, filter]);

  const submit = form.handleSubmit((values) => {
    if (!file) return;
    add.mutate(
      { file, kind: values.kind as DesignStandardDocumentKind, title: values.title, facilityCodes: codes, supersedesId: supersedes?.id ?? null },
      { onSuccess: () => onClose() }
    );
  });

  return (
    <ModalShell
      title={supersedes ? "Upload new version" : "Add design standard"}
      subtitle={supersedes ? `Replaces "${supersedes.title}"; the earlier version stays listed` : "A standard drawing, specification or guideline"}
      onClose={onClose}
    >
      <form className="space-y-3 p-5" noValidate onSubmit={submit}>
        <div>
          <p className={labelCls}>
            Kind <span className="text-rose-600">*</span>
          </p>
          <CustomSelect
            ariaLabel="Kind"
            value={kind}
            onChange={(v) => form.setValue("kind", v, { shouldValidate: true, shouldDirty: true, shouldTouch: true })}
            options={DesignStandardDocumentKindEnum.options.map((k) => ({ value: k, label: DESIGN_STANDARD_DOCUMENT_KIND_LABELS[k] }))}
            placeholder="Choose the kind"
            disabled={Boolean(supersedes)}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="design-doc-title">
            Title <span className="text-rose-600">*</span>
          </label>
          <input id="design-doc-title" className={`${inputCls} ${invalidClass(form, "title")}`} {...form.register("title")} {...fieldA11y(form, "title")} />
          <FieldError form={form} name="title" />
        </div>
        <fieldset>
          <legend className={labelCls}>Facilities it applies to</legend>
          <input
            type="search"
            aria-label="Filter facilities"
            placeholder="Filter facilities"
            className={`${inputCls} mb-1`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
            {shownFacilities.map((f) => (
              <label key={f.code} className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={codes.includes(f.code)}
                  onChange={(e) => setCodes((prev) => (e.target.checked ? [...prev, f.code] : prev.filter((c) => c !== f.code)))}
                />
                <span>
                  {f.name} <span className="text-slate-400">· {f.code}</span>
                </span>
              </label>
            ))}
            {shownFacilities.length === 0 && <p className="text-xs text-slate-500">No facility matches.</p>}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            {codes.length === 0 ? "None ticked: a general standard for every facility." : `${codes.length} ticked.`}
          </p>
        </fieldset>
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
            aria-label="Design standard file"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              e.target.value = "";
              if (!f) return;
              const problem =
                f.size > NEEDS_DOCUMENT_UPLOAD_POLICY.maxBytes
                  ? `The file is larger than ${Math.round(NEEDS_DOCUMENT_UPLOAD_POLICY.maxBytes / 1024 / 1024)} MB.`
                  : NEEDS_DOCUMENT_UPLOAD_POLICY.mimeTypes.includes(mimeTypeOf(f))
                    ? null
                    : "Choose a PDF, photo, Word, Excel or text file.";
              setFileError(problem);
              setFile(problem ? null : f);
              if (!problem && !form.getValues("title")) form.setValue("title", f.name.replace(/\.[^.]+$/, "").slice(0, 200), { shouldValidate: true, shouldTouch: true });
            }}
          />
          {fileError && <p className="mt-1 text-xs font-medium text-rose-700">{fileError}</p>}
        </div>
        <div className="flex flex-wrap items-start justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">
            Cancel
          </button>
          <SubmitButton form={form} pending={add.isPending} pendingLabel="Uploading…" blocked={!file}>
            {supersedes ? "Upload new version" : "Add design standard"}
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}
