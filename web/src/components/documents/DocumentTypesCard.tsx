import { useMemo, useState } from "react";
import { z } from "zod";
import { Controller } from "react-hook-form";
import { Plus } from "lucide-react";
import {
  DOCUMENT_MIME_TYPES,
  DOCUMENT_TYPE_CODE_REGEX,
  SaveDocumentTypeRequestSchema,
  SYSTEM_PERMISSIONS_CATALOG,
  type DocumentTypeDto,
  type SaveDocumentTypeRequestInput,
} from "@insite/shared";
import { useAuth } from "../../lib/auth-context";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../lib/forms";
import { useDocumentTypesQuery } from "../../queries/contracts/useContractQueries";
import { useSaveDocumentTypeMutation } from "../../mutations/contracts/useContractMutations";
import { StandardTable, TableActionButton, TableBadge, type TableColumnDef } from "../table";
import { CustomSelect } from "../common";
import { ModalShell } from "../common/ModalShell";
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

/** The editor's inputs; the request built from them is checked against SaveDocumentTypeRequestSchema. */
const DocumentTypeFormSchema = z
  .object({
    id: z.string().nullable(),
    code: z
      .string()
      .trim()
      .refine((v) => DOCUMENT_TYPE_CODE_REGEX.test(v.toUpperCase()), "Code: 2 to 40 capital letters, digits or underscores, e.g. SITE_PLAN."),
    name: z.string().trim().min(2, "Enter a name (at least 2 characters).").max(120, "Name is too long (at most 120 characters)."),
    description: z.string().trim().max(500, "Description is too long (at most 500 characters)."),
    visibleToContractors: z.boolean(),
    requiresSignOff: z.boolean(),
    signOffPermissionKey: z.string(),
    allowedMimeTypes: z.array(z.string()),
  })
  .superRefine((v, ctx) => {
    const contract = SaveDocumentTypeRequestSchema.safeParse(toBody(v));
    if (!contract.success) {
      for (const issue of contract.error.issues) ctx.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message });
    }
  });

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
  const form = useZodForm(DocumentTypeFormSchema, { defaultValues: initial });
  const { register } = form;
  const s = form.watch();
  const submit = form.handleSubmit((values) => onSave(values));

  return (
    <ModalShell title={initial.id ? `Edit ${initial.name}` : "Add a document type"} onClose={onClose} maxWidth="max-w-lg">
      <form onSubmit={submit} noValidate className="p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="dt-code">
              Code
            </label>
            <input
              id="dt-code"
              className={`${smallInput} font-mono uppercase read-only:bg-slate-50 read-only:text-slate-500 ${invalidClass(form, "code")}`}
              maxLength={40}
              readOnly={Boolean(initial.id)}
              aria-disabled={Boolean(initial.id) || undefined}
              placeholder="SITE_PLAN"
              {...register("code", { setValueAs: (v: string) => v.toUpperCase() })}
              {...fieldA11y(form, "code")}
            />
            <FieldError form={form} name="code" />
            {initial.id && <p className="mt-1 text-[11px] text-slate-500">Codes do not change: project types refer to them.</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="dt-name">
              Name
            </label>
            <input id="dt-name" className={`${smallInput} ${invalidClass(form, "name")}`} maxLength={120} {...register("name")} {...fieldA11y(form, "name")} />
            <FieldError form={form} name="name" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="dt-desc">
            Description (optional)
          </label>
          <input
            id="dt-desc"
            className={`${smallInput} ${invalidClass(form, "description")}`}
            maxLength={500}
            {...register("description")}
            {...fieldA11y(form, "description")}
          />
          <FieldError form={form} name="description" />
        </div>
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input type="checkbox" className="mt-0.5" {...register("visibleToContractors")} />
            <span>
              <span className="font-semibold">Shared with contractors</span>
              <span className="block text-[11px] text-slate-500">Contractor users see documents of this type tied to their organisation.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input type="checkbox" className="mt-0.5" {...register("requiresSignOff")} />
            <span>
              <span className="font-semibold">Needs a sign-off</span>
              <span className="block text-[11px] text-slate-500">A document of this type is not complete evidence until someone signs off its current version.</span>
            </span>
          </label>
        </div>
        {s.requiresSignOff && (
          <Controller
            control={form.control}
            name="signOffPermissionKey"
            render={({ field }) => (
              <CustomSelect label="Who may sign off" value={field.value} onChange={field.onChange} options={PERMISSION_OPTIONS} searchable size="sm" />
            )}
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
                    form.setValue(
                      "allowedMimeTypes",
                      e.target.checked ? [...s.allowedMimeTypes, m] : s.allowedMimeTypes.filter((x) => x !== m),
                      { shouldDirty: true, shouldValidate: true }
                    )
                  }
                />
                {MIME_LABEL[m]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" className={secondaryButton} onClick={onClose}>
            Cancel
          </button>
          <SubmitButton form={form} pending={pending} pendingLabel="Saving…" className={primaryButton}>
            Save type
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}
