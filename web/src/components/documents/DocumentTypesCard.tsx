import React, { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import {
  DOCUMENT_MIME_TYPES,
  DOCUMENT_TYPE_CODE_REGEX,
  SYSTEM_PERMISSIONS_CATALOG,
  type DocumentTypeDto,
  type SaveDocumentTypeRequestInput,
} from "@insite/shared";
import { useAuth } from "../../lib/auth-context";
import { useDocumentTypesQuery } from "../../queries/contracts/useContractQueries";
import { useSaveDocumentTypeMutation } from "../../mutations/contracts/useContractMutations";
import { StandardTable, TableActionButton, TableBadge, type TableColumnDef } from "../table";
import { CustomSelect } from "../common";
import { ModalShell } from "../../pages/reconciliation/components/ModalShell";
import { primaryButton, secondaryButton, smallInput } from "../contracts/contractUi";

/**
 * Phase 13: tenant document types for the project register. Codes are stable (project types and
 * milestones refer to them), so a code is set once; a type in use is archived, never deleted.
 */

const MIME_LABEL: Record<(typeof DOCUMENT_MIME_TYPES)[number], string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/webp": "WebP",
  "image/heic": "HEIC",
  "image/heif": "HEIF",
  "application/msword": "Word (.doc)",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word (.docx)",
  "text/plain": "Plain text",
};

const PERMISSION_OPTIONS = [
  { value: "", label: "Anyone who can view the document" },
  ...SYSTEM_PERMISSIONS_CATALOG.filter((p) => p.surface !== "MOBILE").map((p) => ({ value: p.key, label: p.name, description: p.key })),
];

interface EditorState {
  id: string | null;
  code: string;
  name: string;
  description: string;
  visibleToContractors: boolean;
  requiresSignOff: boolean;
  signOffPermissionKey: string;
  allowedMimeTypes: string[];
}

const blank = (): EditorState => ({
  id: null,
  code: "",
  name: "",
  description: "",
  visibleToContractors: false,
  requiresSignOff: false,
  signOffPermissionKey: "",
  allowedMimeTypes: [],
});

const toBody = (s: EditorState, isArchived?: boolean): SaveDocumentTypeRequestInput => ({
  code: s.code.trim().toUpperCase(),
  name: s.name.trim(),
  description: s.description.trim() || null,
  visibleToContractors: s.visibleToContractors,
  requiresSignOff: s.requiresSignOff,
  signOffPermissionKey: s.signOffPermissionKey || null,
  allowedMimeTypes: s.allowedMimeTypes as SaveDocumentTypeRequestInput["allowedMimeTypes"],
  ...(isArchived === undefined ? {} : { isArchived }),
});

const fromDto = (t: DocumentTypeDto): EditorState => ({
  id: t.id,
  code: t.code,
  name: t.name,
  description: t.description ?? "",
  visibleToContractors: t.visibleToContractors,
  requiresSignOff: t.requiresSignOff,
  signOffPermissionKey: t.signOffPermissionKey ?? "",
  allowedMimeTypes: t.allowedMimeTypes,
});

export function DocumentTypesCard() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("documents:manage_types");
  const [showArchived, setShowArchived] = useState(false);
  const q = useDocumentTypesQuery(true, canManage);
  const save = useSaveDocumentTypeMutation();
  const [editing, setEditing] = useState<EditorState | null>(null);
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (q.data ?? [])
      .filter((t) => showArchived || !t.isArchived)
      .filter((t) => !term || t.name.toLowerCase().includes(term) || t.code.toLowerCase().includes(term));
  }, [q.data, showArchived, search]);

  if (!canManage) return null;

  const columns: TableColumnDef<DocumentTypeDto>[] = [
    {
      id: "name",
      header: "Type",
      cell: (t) => (
        <div>
          <p className="text-xs font-bold text-slate-900">{t.name}</p>
          <p className="text-[11px] text-slate-500 font-mono">{t.code}</p>
        </div>
      ),
    },
    {
      id: "rules",
      header: "Rules",
      cell: (t) => (
        <div className="flex flex-wrap gap-1">
          {t.requiresSignOff && <TableBadge variant="info">Needs sign-off</TableBadge>}
          {t.visibleToContractors && <TableBadge variant="neutral">Shared with contractors</TableBadge>}
          {t.isArchived && <TableBadge variant="warning">Archived</TableBadge>}
        </div>
      ),
    },
    {
      id: "files",
      header: "File types",
      width: "w-48",
      cell: (t) => (
        <span className="text-[11px] text-slate-600">
          {t.allowedMimeTypes.length === 0 ? "Any document type" : t.allowedMimeTypes.map((m) => MIME_LABEL[m as keyof typeof MIME_LABEL] ?? m).join(", ")}
        </span>
      ),
    },
    { id: "count", header: "Documents", width: "w-24", align: "center", cell: (t) => <span className="text-xs tabular-nums">{t.documentCount}</span> },
    {
      id: "actions",
      header: "",
      width: "w-44",
      align: "right",
      cell: (t) => (
        <div className="flex justify-end gap-1.5">
          <TableActionButton onClick={() => setEditing(fromDto(t))}>Edit</TableActionButton>
          <TableActionButton
            variant={t.isArchived ? "default" : "danger"}
            disabled={save.isPending}
            onClick={() =>
              save.mutate({
                id: t.id,
                body: toBody(fromDto(t), !t.isArchived),
                successMessage: t.isArchived ? `"${t.name}" restored.` : `"${t.name}" archived. Existing documents keep it.`,
              })
            }
          >
            {t.isArchived ? "Restore" : "Archive"}
          </TableActionButton>
        </div>
      ),
    },
  ];

  return (
    <>
      <StandardTable<DocumentTypeDto>
        title="Document types"
        subtitle="Types for the project document register: who must sign them off, which files they accept and whether contractors see them."
        search={{ value: search, onChange: setSearch, placeholder: "Search types" }}
        filters={
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
          </label>
        }
        headerActions={
          <button
            type="button"
            onClick={() => setEditing(blank())}
            className="inline-flex items-center gap-1 rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-brand-navy hover:bg-slate-100"
          >
            <Plus className="w-3.5 h-3.5" /> Add type
          </button>
        }
        columns={columns}
        data={rows}
        keyExtractor={(t) => t.id}
        loading={q.isLoading}
        minWidth="min-w-[760px]"
        emptyState={{ title: "No document types" }}
      />
      {editing && (
        <DocumentTypeEditor
          initial={editing}
          pending={save.isPending}
          onClose={() => setEditing(null)}
          onSave={(s) => save.mutate({ id: s.id ?? undefined, body: toBody(s) }, { onSuccess: () => setEditing(null) })}
        />
      )}
    </>
  );
}

function DocumentTypeEditor({
  initial,
  pending,
  onClose,
  onSave,
}: {
  initial: EditorState;
  pending: boolean;
  onClose: () => void;
  onSave: (s: EditorState) => void;
}) {
  const [s, setS] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<EditorState>) => setS((x) => ({ ...x, ...patch }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!DOCUMENT_TYPE_CODE_REGEX.test(s.code.trim().toUpperCase())) return setError("Code: 2 to 40 capital letters, digits or underscores, e.g. SITE_PLAN.");
    if (s.name.trim().length < 2) return setError("Enter a name.");
    setError(null);
    onSave(s);
  };

  return (
    <ModalShell title={s.id ? `Edit ${initial.name}` : "Add a document type"} onClose={onClose} maxWidth="max-w-lg">
      <form onSubmit={submit} className="p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="dt-code">
              Code
            </label>
            <input
              id="dt-code"
              className={`${smallInput} font-mono uppercase`}
              value={s.code}
              maxLength={40}
              disabled={Boolean(s.id)}
              placeholder="SITE_PLAN"
              onChange={(e) => set({ code: e.target.value.toUpperCase() })}
            />
            {s.id && <p className="mt-1 text-[11px] text-slate-500">Codes do not change: project types refer to them.</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="dt-name">
              Name
            </label>
            <input id="dt-name" className={smallInput} value={s.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="dt-desc">
            Description (optional)
          </label>
          <input id="dt-desc" className={smallInput} value={s.description} maxLength={500} onChange={(e) => set({ description: e.target.value })} />
        </div>
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={s.visibleToContractors} onChange={(e) => set({ visibleToContractors: e.target.checked })} />
            <span>
              <span className="font-semibold">Shared with contractors</span>
              <span className="block text-[11px] text-slate-500">Contractor users see documents of this type tied to their organisation.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={s.requiresSignOff} onChange={(e) => set({ requiresSignOff: e.target.checked })} />
            <span>
              <span className="font-semibold">Needs a sign-off</span>
              <span className="block text-[11px] text-slate-500">A document of this type is not complete evidence until someone signs off its current version.</span>
            </span>
          </label>
        </div>
        {s.requiresSignOff && (
          <CustomSelect
            label="Who may sign off"
            value={s.signOffPermissionKey}
            onChange={(v) => set({ signOffPermissionKey: v })}
            options={PERMISSION_OPTIONS}
            searchable
            size="sm"
          />
        )}
        <fieldset>
          <legend className="text-xs font-semibold text-slate-700 mb-1">Accepted files</legend>
          <p className="text-[11px] text-slate-500 mb-2">Leave all unticked to accept every document file type.</p>
          <div className="grid grid-cols-2 gap-1.5">
            {DOCUMENT_MIME_TYPES.map((m) => (
              <label key={m} className="inline-flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={s.allowedMimeTypes.includes(m)}
                  onChange={(e) =>
                    set({ allowedMimeTypes: e.target.checked ? [...s.allowedMimeTypes, m] : s.allowedMimeTypes.filter((x) => x !== m) })
                  }
                />
                {MIME_LABEL[m]}
              </label>
            ))}
          </div>
        </fieldset>
        {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" className={secondaryButton} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={primaryButton} disabled={pending}>
            {pending ? "Saving…" : "Save type"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
