import React, { useEffect, useMemo, useState } from "react";
import { Controller } from "react-hook-form";
import { z } from "zod";
import { documentMimeAllowed, RegisterProjectDocumentRequestSchema, type ProjectDocumentDetailDto } from "@insite/shared";
import { ModalShell } from "../common/ModalShell";
import { CustomSelect } from "../common";
import { useDocumentTypesQuery } from "../../queries/contracts/useContractQueries";
import { useProjectsQuery } from "../../queries/projects/useProjectsQueries";
import { useAddDocumentVersionMutation, useUploadDocumentMutation } from "../../mutations/contracts/useContractMutations";
import { MAX_DOCUMENT_BYTES } from "../../api/contracts/contractsApi";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm, visibleError } from "../../lib/forms";
import { formatBytes, primaryButton, secondaryButton, smallInput } from "../contracts/contractUi";

/**
 * The form: the register fields (type, title, contractor) are checked only when adding a document;
 * a new version needs only the file and an optional note. The file itself is outside the form.
 */
const DocumentUploadFormSchema = z
  .object({
    newVersion: z.boolean(),
    documentTypeId: z.string(),
    title: z.string(),
    projectContractorId: z.string(),
    note: z.string().trim().max(500, "The note is too long (at most 500 characters)"),
  })
  .superRefine((v, ctx) => {
    if (v.newVersion) return;
    if (!v.documentTypeId) ctx.addIssue({ code: "custom", path: ["documentTypeId"], message: "Choose the document type" });
    const title = RegisterProjectDocumentRequestSchema.shape.title.safeParse(v.title);
    if (!title.success) ctx.addIssue({ code: "custom", path: ["title"], message: title.error.issues[0]?.message ?? "Give the document a title" });
  });

/**
 * Phase 13: adds a document to the project register (type, title, optional contractor, file, note)
 * or, with `newVersionOf`, uploads a new version of an existing document. Shows upload progress.
 */
export function DocumentUploadDialog({
  projectId,
  onClose,
  onUploaded,
  defaultTypeCode,
  lockType = false,
  defaultContractorId,
  defaultTitle,
  linkedMilestoneId,
  newVersionOf,
}: {
  projectId: string;
  onClose: () => void;
  onUploaded?: (doc: ProjectDocumentDetailDto) => void;
  defaultTypeCode?: string;
  /** Keep the type fixed to `defaultTypeCode`. */
  lockType?: boolean;
  defaultContractorId?: string | null;
  defaultTitle?: string;
  linkedMilestoneId?: string | null;
  newVersionOf?: { id: string; title: string; currentVersion: number; allowedMimeTypes?: string[] };
}) {
  const typesQuery = useDocumentTypesQuery(false, !newVersionOf);
  const projectsQuery = useProjectsQuery(true);
  const contractors = projectsQuery.data?.find((p) => p.id === projectId)?.contractors ?? [];
  const upload = useUploadDocumentMutation(projectId);
  const addVersion = useAddDocumentVersionMutation(projectId);
  const types = useMemo(() => (typesQuery.data ?? []).filter((t) => !t.isArchived), [typesQuery.data]);

  const form = useZodForm(DocumentUploadFormSchema, {
    defaultValues: {
      newVersion: Boolean(newVersionOf),
      documentTypeId: "",
      title: defaultTitle ?? "",
      projectContractorId: defaultContractorId ?? "",
      note: "",
    },
  });
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  // The default type is known only once the types have loaded.
  useEffect(() => {
    if (newVersionOf || !defaultTypeCode || form.getValues("documentTypeId")) return;
    const match = types.find((t) => t.code === defaultTypeCode);
    if (match) form.setValue("documentTypeId", match.id, { shouldValidate: true });
  }, [types, defaultTypeCode, newVersionOf, form]);

  const typeId = form.watch("documentTypeId");
  const type = types.find((t) => t.id === typeId) ?? null;
  const pending = upload.isPending || addVersion.isPending;

  const fileProblem = (() => {
    if (!file) return null;
    if (file.size > MAX_DOCUMENT_BYTES) return `The file is ${formatBytes(file.size)}; the limit is 25 MB.`;
    const mime = (file.type || "").toLowerCase();
    const allowed = newVersionOf?.allowedMimeTypes ?? type?.allowedMimeTypes;
    if (allowed && !documentMimeAllowed({ allowedMimeTypes: allowed }, mime)) {
      return mime ? `Files of type ${mime} are not accepted${type ? ` for ${type.name}` : ""}.` : "The file type could not be recognised.";
    }
    return null;
  })();

  const submit = form.handleSubmit(async (values) => {
    if (!file || fileProblem) return;
    setProgress(0);
    try {
      if (newVersionOf) {
        const doc = await addVersion.mutateAsync({ documentId: newVersionOf.id, file, note: values.note || null, onProgress: setProgress });
        onUploaded?.(doc);
      } else {
        const doc = await upload.mutateAsync({
          file,
          onProgress: setProgress,
          body: {
            documentTypeId: values.documentTypeId,
            title: values.title.trim(),
            note: values.note || null,
            projectContractorId: values.projectContractorId || null,
            linkedMilestoneId: linkedMilestoneId ?? null,
          },
        });
        onUploaded?.(doc);
      }
      onClose();
    } catch {
      // The mutation hook shows the error.
      setProgress(null);
    }
  });

  return (
    <ModalShell
      title={newVersionOf ? "Upload a new version" : "Add a document"}
      subtitle={newVersionOf ? `${newVersionOf.title} · becomes version ${newVersionOf.currentVersion + 1}` : "Stored in the project register"}
      onClose={() => !pending && onClose()}
      maxWidth="max-w-lg"
    >
      <form onSubmit={submit} noValidate className="p-5 space-y-4">
        {!newVersionOf && (
          <>
            <div>
              <Controller
                control={form.control}
                name="documentTypeId"
                render={({ field }) => (
                  <CustomSelect
                    label="Document type"
                    value={field.value}
                    onChange={(v) => {
                      field.onChange(v);
                      field.onBlur();
                    }}
                    options={types.map((t) => ({
                      value: t.id,
                      label: t.name,
                      description: [t.requiresSignOff ? "Needs sign-off" : null, t.visibleToContractors ? "Shared with contractors" : null]
                        .filter(Boolean)
                        .join(" · ") || undefined,
                    }))}
                    placeholder={typesQuery.isLoading ? "Loading types…" : "Choose a type"}
                    searchable={types.length > 8}
                    disabled={pending || (lockType && Boolean(defaultTypeCode))}
                    error={visibleError(form, "documentTypeId")}
                  />
                )}
              />
              {type?.description && <p className="mt-1 text-[11px] text-slate-500">{type.description}</p>}
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="doc-title">
                Title
              </label>
              <input
                id="doc-title"
                className={`${smallInput} ${invalidClass(form, "title")}`}
                maxLength={200}
                disabled={pending}
                {...form.register("title")}
                {...fieldA11y(form, "title")}
              />
              <FieldError form={form} name="title" />
            </div>
            {contractors.length > 0 && (
              <Controller
                control={form.control}
                name="projectContractorId"
                render={({ field }) => (
                  <CustomSelect
                    label="Contractor (optional)"
                    value={field.value}
                    onChange={field.onChange}
                    options={[{ value: "", label: "Not tied to a contractor" }, ...contractors.map((c) => ({ value: c.id, label: `${c.organizationName} (${c.tradeCode})` }))]}
                    hint="A document tied to a contractor is visible to that contractor's users when its type is shared."
                    disabled={pending}
                  />
                )}
              />
            )}
          </>
        )}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="doc-file">
            File (up to 25 MB)
          </label>
          <input
            id="doc-file"
            type="file"
            className="block w-full text-xs text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-primary/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-primary"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !newVersionOf && !form.getValues("title").trim()) {
                form.setValue("title", f.name.replace(/\.[^.]+$/, ""), { shouldValidate: true, shouldDirty: true, shouldTouch: true });
              }
            }}
            disabled={pending}
            aria-invalid={fileProblem ? true : undefined}
          />
          {file && <p className="mt-1 text-[11px] text-slate-500">{file.name} · {formatBytes(file.size)}</p>}
          {fileProblem && <p className="mt-1 text-[11px] font-medium text-rose-600">{fileProblem}</p>}
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="doc-note">
            Note (optional)
          </label>
          <input
            id="doc-note"
            className={`${smallInput} ${invalidClass(form, "note")}`}
            maxLength={500}
            disabled={pending}
            {...form.register("note")}
            {...fieldA11y(form, "note")}
          />
          <FieldError form={form} name="note" />
        </div>
        {progress !== null && (
          <div className="space-y-1" aria-live="polite">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-brand-primary transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <p className="text-[11px] text-slate-500">{progress < 1 ? `Uploading… ${Math.round(progress * 100)}%` : "Registering…"}</p>
          </div>
        )}
        <div className="flex justify-end items-start gap-2 pt-3 border-t border-slate-100">
          <button type="button" className={secondaryButton} onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <SubmitButton
            form={form}
            pending={pending}
            blocked={!file || Boolean(fileProblem)}
            pendingLabel="Uploading…"
            className={primaryButton}
          >
            {newVersionOf ? "Upload version" : "Add document"}
          </SubmitButton>
        </div>
        {!file && !pending && form.formState.isValid && <p className="text-right text-[11px] text-slate-500">Choose a file to upload.</p>}
      </form>
    </ModalShell>
  );
}
