import React, { useMemo, useState } from "react";
import { documentMimeAllowed, type ProjectDocumentDetailDto } from "@insite/shared";
import { ModalShell } from "../common/ModalShell";
import { CustomSelect } from "../common";
import { useDocumentTypesQuery } from "../../queries/contracts/useContractQueries";
import { useProjectsQuery } from "../../queries/projects/useProjectsQueries";
import { useAddDocumentVersionMutation, useUploadDocumentMutation } from "../../mutations/contracts/useContractMutations";
import { MAX_DOCUMENT_BYTES } from "../../api/contracts/contractsApi";
import { formatBytes, primaryButton, secondaryButton, smallInput } from "../contracts/contractUi";

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

  const [typeId, setTypeId] = useState<string>("");
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [contractorId, setContractorId] = useState<string>(defaultContractorId ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effectiveTypeId = typeId || (defaultTypeCode ? types.find((t) => t.code === defaultTypeCode)?.id ?? "" : "");
  const type = types.find((t) => t.id === effectiveTypeId) ?? null;
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!file) return setError("Choose a file.");
    if (fileProblem) return setError(fileProblem);
    setProgress(0);
    try {
      if (newVersionOf) {
        const doc = await addVersion.mutateAsync({ documentId: newVersionOf.id, file, note: note.trim() || null, onProgress: setProgress });
        onUploaded?.(doc);
      } else {
        if (!type) return setError("Choose the document type.");
        if (title.trim().length < 2) return setError("Give the document a title.");
        const doc = await upload.mutateAsync({
          file,
          onProgress: setProgress,
          body: {
            documentTypeId: type.id,
            title: title.trim(),
            note: note.trim() || null,
            projectContractorId: contractorId || null,
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
  };

  return (
    <ModalShell
      title={newVersionOf ? "Upload a new version" : "Add a document"}
      subtitle={newVersionOf ? `${newVersionOf.title} · becomes version ${newVersionOf.currentVersion + 1}` : "Stored in the project register"}
      onClose={() => !pending && onClose()}
      maxWidth="max-w-lg"
    >
      <form onSubmit={submit} className="p-5 space-y-4">
        {!newVersionOf && (
          <>
            <div>
              <CustomSelect
                label="Document type"
                value={effectiveTypeId}
                onChange={(v) => setTypeId(v)}
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
              />
              {type?.description && <p className="mt-1 text-[11px] text-slate-500">{type.description}</p>}
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="doc-title">
                Title
              </label>
              <input id="doc-title" className={smallInput} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} disabled={pending} />
            </div>
            {contractors.length > 0 && (
              <CustomSelect
                label="Contractor (optional)"
                value={contractorId}
                onChange={(v) => setContractorId(v)}
                options={[{ value: "", label: "Not tied to a contractor" }, ...contractors.map((c) => ({ value: c.id, label: `${c.organizationName} (${c.tradeCode})` }))]}
                hint="A document tied to a contractor is visible to that contractor's users when its type is shared."
                disabled={pending}
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
              if (f && !newVersionOf && !title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ""));
            }}
            disabled={pending}
          />
          {file && <p className="mt-1 text-[11px] text-slate-500">{file.name} · {formatBytes(file.size)}</p>}
          {fileProblem && <p className="mt-1 text-[11px] font-medium text-rose-600">{fileProblem}</p>}
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="doc-note">
            Note (optional)
          </label>
          <input id="doc-note" className={smallInput} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} disabled={pending} />
        </div>
        {progress !== null && (
          <div className="space-y-1" aria-live="polite">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-brand-primary transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <p className="text-[11px] text-slate-500">{progress < 1 ? `Uploading… ${Math.round(progress * 100)}%` : "Registering…"}</p>
          </div>
        )}
        {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" className={secondaryButton} onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className={primaryButton} disabled={pending || !file || Boolean(fileProblem)}>
            {pending ? "Uploading…" : newVersionOf ? "Upload version" : "Add document"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
