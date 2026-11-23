import React, { useMemo, useState } from "react";
import { Upload } from "lucide-react";
import { CustomSelect } from "../common";
import { useAuth } from "../../lib/auth-context";
import { useProjectDocumentsQuery } from "../../queries/contracts/useContractQueries";
import { DocumentUploadDialog } from "./DocumentUploadDialog";

/**
 * Phase 13: picks a document from the project register (optionally of one type), with "Upload new"
 * inline. Used for CP evidence, the kick-off agenda and minutes.
 */
export function DocumentPicker({
  projectId,
  value,
  onChange,
  typeCode,
  label = "Document",
  hint,
  disabled,
  allowNone = true,
  currentTitle,
}: {
  projectId: string;
  value: string | null;
  onChange: (documentId: string | null, title: string | null) => void;
  /** Only documents of this type; also the type of a new upload. */
  typeCode?: string;
  label?: string;
  hint?: string;
  disabled?: boolean;
  allowNone?: boolean;
  /** Title to show when the chosen document is not in the list (e.g. archived or not visible). */
  currentTitle?: string | null;
}) {
  const { hasPermission } = useAuth();
  const canView = hasPermission("documents:view");
  const canUpload = hasPermission("documents:upload");
  const [uploading, setUploading] = useState(false);
  const docs = useProjectDocumentsQuery(projectId, typeCode ? { typeCode } : {}, canView);

  const options = useMemo(() => {
    const list = (docs.data ?? [])
      .filter((d) => !d.isArchived)
      .map((d) => ({
        value: d.id,
        label: d.title,
        description: `${d.documentType.name} · v${d.currentVersion}${d.contractorName ? ` · ${d.contractorName}` : ""}`,
      }));
    if (value && !list.some((o) => o.value === value)) list.unshift({ value, label: currentTitle ?? "Chosen document", description: "" });
    return allowNone ? [{ value: "", label: "No document", description: "" }, ...list] : list;
  }, [docs.data, value, currentTitle, allowNone]);

  return (
    <div className="space-y-1">
      <div className="flex items-end gap-2">
        <div className="flex-1 min-w-0">
          <CustomSelect
            label={label}
            value={value ?? ""}
            onChange={(v) => {
              const doc = docs.data?.find((d) => d.id === v);
              onChange(v || null, doc?.title ?? null);
            }}
            options={options}
            placeholder={!canView ? "You cannot view the register" : docs.isLoading ? "Loading documents…" : "Choose a document"}
            searchable={options.length > 8}
            size="sm"
            disabled={disabled || !canView}
          />
        </div>
        {canUpload && !disabled && (
          <button
            type="button"
            onClick={() => setUploading(true)}
            className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Upload className="w-3.5 h-3.5" /> Upload new
          </button>
        )}
      </div>
      {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
      {canView && !docs.isLoading && (docs.data ?? []).length === 0 && (
        <p className="text-[11px] text-slate-500">No documents{typeCode ? " of this type" : ""} in the register yet.</p>
      )}
      {uploading && (
        <DocumentUploadDialog
          projectId={projectId}
          defaultTypeCode={typeCode}
          lockType={Boolean(typeCode)}
          onClose={() => setUploading(false)}
          onUploaded={(doc) => onChange(doc.id, doc.title)}
        />
      )}
    </div>
  );
}
