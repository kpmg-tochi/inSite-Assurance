import { useState } from "react";
import { z } from "zod";
import { Plus } from "lucide-react";
import { FORM_CODE_REGEX, FORM_GUIDANCE_MAX, SaveFormSectionRequestSchema, type FormField, type FormSectionDto } from "@insite/shared";
import { FieldError, fieldA11y, invalidClass, useZodForm } from "../../lib/forms";
import { useAuth } from "../../lib/auth-context";
import { useFormLibraryQuery } from "../../queries/forms/useFormQueries";
import { useArchiveFormSectionMutation, useSaveFormSectionMutation } from "../../mutations/forms/useFormMutations";
import { StandardTable, TableActionButton, TableBadge, type TableColumnDef } from "../table";
import { smallInput } from "../contracts/contractUi";
import { FieldsEditorModal, VersionsModal } from "./FormEditorModals";

/**
 * Redesign R3: fixed sections ("Health & safety"), reusable across visit form templates. A section a
 * built form used is never edited: saving creates a new version. A section listed by a live template
 * cannot be archived.
 */

/** The section's own inputs (code, title, description); the fields are checked by the editor modal. */
const SectionHeaderSchema = z
  .object({
    isNew: z.boolean(),
    code: z.string(),
    title: z.string().trim().min(2, "Enter the section title (at least 2 characters).").max(160, "Title is too long (at most 160 characters)."),
    description: z.string().trim().max(FORM_GUIDANCE_MAX, `Description is too long (at most ${FORM_GUIDANCE_MAX} characters).`),
  })
  .superRefine((v, ctx) => {
    if (v.isNew && !FORM_CODE_REGEX.test(v.code.trim().toUpperCase())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["code"], message: "Code: 2 to 40 capital letters, digits or underscores, starting with a letter." });
    }
  });

interface Editing {
  existing: FormSectionDto | null;
}

export function FormSectionsCard() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("forms:manage");
  const q = useFormLibraryQuery(canManage);
  const save = useSaveFormSectionMutation();
  const archive = useArchiveFormSectionMutation();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [versions, setVersions] = useState<FormSectionDto | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const headerForm = useZodForm(SectionHeaderSchema, { defaultValues: { isNew: true, code: "", title: "", description: "" } });
  const { code, title, description } = headerForm.watch();

  if (!canManage) return null;
  const rows = (q.data?.sections ?? []).filter((s) => showArchived || !s.isArchived);

  const open = (s: FormSectionDto | null) => {
    headerForm.reset({ isNew: !s, code: s?.code ?? "", title: s?.title ?? "", description: s?.description ?? "" });
    setEditing({ existing: s });
  };

  const columns: TableColumnDef<FormSectionDto>[] = [
    {
      id: "title",
      header: "Section",
      cell: (s) => (
        <div>
          <p className="text-xs font-bold text-slate-900">{s.title}</p>
          <p className="text-[11px] text-slate-500 font-mono">{s.code}</p>
        </div>
      ),
    },
    { id: "fields", header: "Questions", width: "w-24", align: "center", cell: (s) => <span className="text-xs tabular-nums">{s.fields.length}</span> },
    {
      id: "templates",
      header: "Used in templates",
      cell: (s) => <span className="text-xs text-slate-600">{s.usedByTemplateCodes.length ? s.usedByTemplateCodes.join(", ") : "–"}</span>,
    },
    {
      id: "version",
      header: "Version",
      width: "w-40",
      cell: (s) => (
        <span className="text-xs text-slate-600">
          v{s.version} · {s.usageCount ? `used by ${s.usageCount}` : "not used yet"}
          {s.isArchived && (
            <>
              {" "}
              <TableBadge variant="warning">Archived</TableBadge>
            </>
          )}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      width: "w-56",
      align: "right",
      cell: (s) => (
        <div className="flex justify-end gap-1.5">
          <TableActionButton onClick={() => open(s)} disabled={s.isArchived}>
            Edit
          </TableActionButton>
          <TableActionButton onClick={() => setVersions(s)}>Versions</TableActionButton>
          <TableActionButton
            variant={s.isArchived ? "default" : "danger"}
            disabled={archive.isPending || (!s.isArchived && s.usedByTemplateCodes.length > 0)}
            onClick={() => archive.mutate({ code: s.code, archived: !s.isArchived })}
          >
            {s.isArchived ? "Restore" : "Archive"}
          </TableActionButton>
        </div>
      ),
    },
  ];

  const existing = editing?.existing ?? null;
  const sectionBody = (fields: FormField[]) => ({
    code: existing?.code ?? code.trim().toUpperCase(),
    title: title.trim(),
    description: description.trim() || null,
    fields,
  });
  const header = (
    <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-3">
      <label className="text-[11px] font-semibold text-slate-700">
        Code
        <input
          className={`${smallInput} font-mono uppercase read-only:bg-slate-50 read-only:text-slate-500 ${invalidClass(headerForm, "code")}`}
          readOnly={Boolean(existing)}
          aria-disabled={Boolean(existing) || undefined}
          maxLength={40}
          placeholder="SITE_SECURITY"
          {...headerForm.register("code", { setValueAs: (v: string) => v.toUpperCase() })}
          {...fieldA11y(headerForm, "code")}
        />
        <FieldError form={headerForm} name="code" className="font-normal" />
      </label>
      <label className="text-[11px] font-semibold text-slate-700">
        Title
        <input
          className={`${smallInput} ${invalidClass(headerForm, "title")}`}
          maxLength={160}
          {...headerForm.register("title")}
          {...fieldA11y(headerForm, "title")}
        />
        <FieldError form={headerForm} name="title" className="font-normal" />
      </label>
      <label className="sm:col-span-2 text-[11px] font-semibold text-slate-700">
        Description (optional)
        <input
          className={`${smallInput} ${invalidClass(headerForm, "description")}`}
          maxLength={1000}
          {...headerForm.register("description")}
          {...fieldA11y(headerForm, "description")}
        />
        <FieldError form={headerForm} name="description" className="font-normal" />
      </label>
    </div>
  );

  return (
    <>
      <StandardTable<FormSectionDto>
        title="Fixed sections"
        subtitle="Reusable sections (Health & safety, Materials…). Visit form templates list them by code."
        filters={
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
          </label>
        }
        headerActions={
          <button
            type="button"
            onClick={() => open(null)}
            className="inline-flex items-center gap-1 rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-brand-navy hover:bg-slate-100"
          >
            <Plus className="w-3.5 h-3.5" /> Add section
          </button>
        }
        columns={columns}
        data={rows}
        keyExtractor={(s) => s.id}
        loading={q.isLoading}
        minWidth="min-w-[760px]"
        emptyState={{ title: "No sections" }}
      />
      {editing && (
        <FieldsEditorModal
          title={existing ? `Edit ${existing.title}` : "Add a section"}
          context="SECTION"
          initialFields={existing?.fields ?? []}
          header={header}
          headerValid={headerForm.formState.isValid}
          headerIssue={Object.values(headerForm.formState.errors)[0]?.message?.toString() ?? "Enter the section code and title."}
          headerDirty={!existing || title !== existing.title || description !== (existing.description ?? "")}
          requestIssues={(fields) => {
            const parsed = SaveFormSectionRequestSchema.safeParse(sectionBody(fields));
            return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
          }}
          usageCount={existing?.usageCount ?? 0}
          pending={save.isPending}
          onClose={() => setEditing(null)}
          onSave={(fields) =>
            save
              .mutateAsync({
                body: sectionBody(fields),
                existingCode: existing?.code ?? null,
              })
              .then(() => setEditing(null))
          }
        />
      )}
      {versions && <VersionsModal kind="sections" componentKey={versions.code} title={versions.title} onClose={() => setVersions(null)} />}
    </>
  );
}
