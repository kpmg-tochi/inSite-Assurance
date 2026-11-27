import React, { useMemo, useRef, useState } from "react";
import { z } from "zod";
import { FileUp } from "lucide-react";
import {
  CYCLE_DOCUMENT_KIND_META,
  CycleDocumentKindEnum,
  NEEDS_DOCUMENT_UPLOAD_POLICY,
  PROPOSAL_DOCUMENT_KIND_LABELS,
  ProposalDocumentKindEnum,
  RegisterCycleDocumentRequestSchema,
  type CycleDocumentKind,
  type ProposalDocumentKind,
} from "@insite/shared";
import { ModalShell } from "../common/ModalShell";
import { CustomSelect } from "../common/CustomSelect";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm, zChoice } from "../../lib/forms";
import { mimeTypeOf } from "../../api/needsPipeline";
import { useAddCycleDocumentMutation, useAddProposalDocumentMutation } from "../../mutations/needs/useNeedsMutations";
import { DOCUMENT_FILE_ACCEPT, formatBytes, inputCls, labelCls } from "./needsUi";

/**
 * Needs pipeline wave 2: add a cycle document (kind, title, the proposed projects it covers, file)
 * or a proposal document (kind, title, file). With `supersedes` it uploads a new version of that
 * document (same kind). The file goes up through the cycle's presign, then it is registered; the
 * server reads its size, type and sha256 from storage.
 */

const FormSchema = z.object({
  kind: zChoice("Kind"),
  title: RegisterCycleDocumentRequestSchema.shape.title,
});

export type NeedsDocumentDialogProps =
  | {
      target: "cycle";
      cycleId: string;
      /** Proposed projects of the cycle the document may cover. */
      proposals: Array<{ id: string; reference: string; title: string }>;
      supersedes?: { id: string; kind: CycleDocumentKind; title: string; proposalIds: string[] } | null;
      onClose: () => void;
    }
  | {
      target: "proposal";
      cycleId: string;
      proposalId: string;
      supersedes?: { id: string; kind: ProposalDocumentKind; title: string } | null;
      onClose: () => void;
    };

function fileProblem(file: File): string | null {
  if (file.size > NEEDS_DOCUMENT_UPLOAD_POLICY.maxBytes) return `The file is larger than ${Math.round(NEEDS_DOCUMENT_UPLOAD_POLICY.maxBytes / 1024 / 1024)} MB.`;
  if (!NEEDS_DOCUMENT_UPLOAD_POLICY.mimeTypes.includes(mimeTypeOf(file))) return "Choose a PDF, photo, Word, Excel or text file.";
  return null;
}

export function NeedsDocumentDialog(props: NeedsDocumentDialogProps) {
  const { onClose, supersedes } = props;
  const addCycle = useAddCycleDocumentMutation();
  const addProposal = useAddProposalDocumentMutation();
  const pending = addCycle.isPending || addProposal.isPending;
  const form = useZodForm(FormSchema, { defaultValues: { kind: supersedes?.kind ?? "", title: supersedes?.title ?? "" } });
  const kind = form.watch("kind");
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [covered, setCovered] = useState<string[]>(props.target === "cycle" ? props.supersedes?.proposalIds ?? [] : []);

  const kindOptions = useMemo(
    () =>
      props.target === "cycle"
        ? CycleDocumentKindEnum.options.map((k) => ({
            value: k,
            label: CYCLE_DOCUMENT_KIND_META[k].label,
            description: CYCLE_DOCUMENT_KIND_META[k].generated ? "Produced by the platform; upload a signed copy here" : undefined,
          }))
        : ProposalDocumentKindEnum.options.map((k) => ({ value: k, label: PROPOSAL_DOCUMENT_KIND_LABELS[k] })),
    [props.target]
  );

  const submit = form.handleSubmit((values) => {
    if (!file) return;
    const done = { onSuccess: () => onClose() };
    if (props.target === "cycle") {
      addCycle.mutate(
        {
          cycleId: props.cycleId,
          file,
          kind: values.kind as CycleDocumentKind,
          title: values.title,
          supersedesId: supersedes?.id ?? null,
          proposalIds: covered,
        },
        done
      );
    } else {
      addProposal.mutate(
        {
          cycleId: props.cycleId,
          proposalId: props.proposalId,
          file,
          kind: values.kind as ProposalDocumentKind,
          title: values.title,
          supersedesId: supersedes?.id ?? null,
        },
        done
      );
    }
  });

  const title = supersedes ? "Upload new version" : props.target === "cycle" ? "Add cycle document" : "Add document";
  return (
    <ModalShell title={title} subtitle={supersedes ? `Replaces "${supersedes.title}"; the earlier version stays in the history` : undefined} onClose={onClose}>
      <form className="space-y-3 p-5" noValidate onSubmit={submit}>
        <div>
          <p className={labelCls} id="needs-doc-kind">
            Kind <span className="text-rose-600">*</span>
          </p>
          <CustomSelect
            ariaLabel="Kind"
            value={kind}
            onChange={(v) => form.setValue("kind", v, { shouldValidate: true, shouldDirty: true, shouldTouch: true })}
            options={kindOptions}
            placeholder="Choose the kind"
            disabled={Boolean(supersedes)}
            error={form.formState.touchedFields.kind ? form.formState.errors.kind?.message : undefined}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="needs-doc-title">
            Title <span className="text-rose-600">*</span>
          </label>
          <input id="needs-doc-title" className={`${inputCls} ${invalidClass(form, "title")}`} {...form.register("title")} {...fieldA11y(form, "title")} />
          <FieldError form={form} name="title" />
        </div>

        {props.target === "cycle" && props.proposals.length > 0 && (
          <fieldset>
            <legend className={labelCls}>Proposed projects it covers</legend>
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
              {props.proposals.map((p) => (
                <label key={p.id} className="flex items-start gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={covered.includes(p.id)}
                    onChange={(e) => setCovered((prev) => (e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id)))}
                  />
                  <span>
                    <span className="font-semibold text-slate-900">{p.reference}</span> · {p.title}
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">Leave all unticked for a document about the whole cycle.</p>
          </fieldset>
        )}

        <div>
          <p className={labelCls}>
            File <span className="text-rose-600">*</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => fileRef.current?.click()}>
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
              const problem = fileProblem(f);
              setFileError(problem);
              setFile(problem ? null : f);
              if (!problem && !form.getValues("title")) form.setValue("title", f.name.replace(/\.[^.]+$/, "").slice(0, 200), { shouldValidate: true, shouldTouch: true });
            }}
          />
          {fileError && <p className="mt-1 text-xs font-medium text-rose-700">{fileError}</p>}
          <p className="mt-1 text-[11px] text-slate-500">PDF, photo, Word, Excel or text, up to {Math.round(NEEDS_DOCUMENT_UPLOAD_POLICY.maxBytes / 1024 / 1024)} MB.</p>
        </div>

        <div className="flex flex-wrap items-start justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">
            Cancel
          </button>
          <SubmitButton form={form} pending={pending} pendingLabel="Uploading…" blocked={!file} hint={file ? undefined : "Choose the kind, a title and the file."}>
            {supersedes ? "Upload new version" : "Add document"}
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}
