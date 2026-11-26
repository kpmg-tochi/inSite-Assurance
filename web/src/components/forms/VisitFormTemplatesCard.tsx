import { useMemo, useState } from "react";
import { z } from "zod";
import { Controller } from "react-hook-form";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import {
  FORM_CODE_REGEX,
  FORM_MAX_TEMPLATE_BLOCKS,
  SaveVisitFormTemplateRequestSchema,
  VISIT_KIND_META,
  VisitKindEnum,
  type VisitFormBlock,
  type VisitFormTemplateDto,
  type VisitKind,
} from "@insite/shared";
import { useAuth } from "../../lib/auth-context";
import { useLeaveGuard } from "../../lib/navigationGuard";
import { FieldError, canSubmit, fieldA11y, invalidClass, useZodForm } from "../../lib/forms";
import { useFormLibraryQuery } from "../../queries/forms/useFormQueries";
import { useArchiveVisitFormTemplateMutation, useSaveVisitFormTemplateMutation } from "../../mutations/forms/useFormMutations";
import { StandardTable, TableActionButton, TableBadge, type TableColumnDef } from "../table";
import { CustomSelect } from "../common";
import { ModalShell } from "../common/ModalShell";
import { primaryButton, secondaryButton, smallInput } from "../contracts/contractUi";
import { VersionsModal } from "./FormEditorModals";

/**
 * Redesign R3 (D-R3.3): a visit form template is an ordered list of fixed sections plus, for kinds
 * that include facilities, one slot where the facility sub-forms go. The header and summary come from
 * the visit; re-check items are appended after the last block.
 */

interface EditorState {
  existingCode: string | null;
  code: string;
  name: string;
  visitKind: VisitKind;
  blocks: VisitFormBlock[];
}

/** The request body the editor's values become. */
const templateBody = (s: Omit<EditorState, "existingCode">) => ({ code: s.code.trim().toUpperCase(), name: s.name.trim(), visitKind: s.visitKind, blocks: s.blocks });

export function VisitFormTemplatesCard() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("forms:manage");
  const q = useFormLibraryQuery(canManage);
  const save = useSaveVisitFormTemplateMutation();
  const archive = useArchiveVisitFormTemplateMutation();
  const [editing, setEditing] = useState<EditorState | null>(null);
  const [versions, setVersions] = useState<VisitFormTemplateDto | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  if (!canManage) return null;
  const sections = q.data?.sections ?? [];
  const titleOf = (code: string) => sections.find((s) => s.code === code)?.title ?? code;
  const rows = (q.data?.templates ?? []).filter((t) => showArchived || !t.isArchived);

  const columns: TableColumnDef<VisitFormTemplateDto>[] = [
    {
      id: "name",
      header: "Template",
      cell: (t) => (
        <div>
          <p className="text-xs font-bold text-slate-900">{t.name}</p>
          <p className="text-[11px] text-slate-500 font-mono">{t.code}</p>
        </div>
      ),
    },
    { id: "kind", header: "Monitoring visit kind", width: "w-40", cell: (t) => <span className="text-xs text-slate-700">{VISIT_KIND_META[t.visitKind].label}</span> },
    {
      id: "blocks",
      header: "Blocks",
      cell: (t) => (
        <span className="text-[11px] text-slate-600">{t.blocks.map((b) => (b.type === "FACILITIES" ? "[Facility sub-forms]" : titleOf(b.sectionCode))).join(" → ")}</span>
      ),
    },
    {
      id: "version",
      header: "Version",
      width: "w-36",
      cell: (t) => (
        <span className="text-xs text-slate-600">
          v{t.version} · {t.usageCount ? `used by ${t.usageCount}` : "not used yet"} {t.isArchived && <TableBadge variant="warning">Archived</TableBadge>}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      width: "w-56",
      align: "right",
      cell: (t) => (
        <div className="flex justify-end gap-1.5">
          <TableActionButton
            disabled={t.isArchived}
            onClick={() => setEditing({ existingCode: t.code, code: t.code, name: t.name, visitKind: t.visitKind, blocks: t.blocks })}
          >
            Edit
          </TableActionButton>
          <TableActionButton onClick={() => setVersions(t)}>Versions</TableActionButton>
          <TableActionButton
            variant={t.isArchived ? "default" : "danger"}
            disabled={archive.isPending}
            onClick={() => archive.mutate({ code: t.code, archived: !t.isArchived })}
          >
            {t.isArchived ? "Restore" : "Archive"}
          </TableActionButton>
        </div>
      ),
    },
  ];

  return (
    <>
      <StandardTable<VisitFormTemplateDto>
        title="Monitoring form templates"
        subtitle="One per kind of monitoring visit: the fixed sections in order and where the facility sub-forms go. A project type picks the template for each kind."
        filters={
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
          </label>
        }
        headerActions={
          <button
            type="button"
            onClick={() => setEditing({ existingCode: null, code: "", name: "", visitKind: "AD_HOC", blocks: [{ type: "FACILITIES" }] })}
            className="inline-flex items-center gap-1 rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-brand-navy hover:bg-slate-100"
          >
            <Plus className="w-3.5 h-3.5" /> Add template
          </button>
        }
        columns={columns}
        data={rows}
        keyExtractor={(t) => t.id}
        loading={q.isLoading}
        minWidth="min-w-[860px]"
        emptyState={{ title: "No templates" }}
      />
      {editing && (
        <TemplateEditor
          initial={editing}
          sectionOptions={sections.filter((s) => !s.isArchived).map((s) => ({ value: s.code, label: `${s.title} (${s.code})` }))}
          titleOf={titleOf}
          usageCount={(q.data?.templates ?? []).find((t) => t.code === editing.existingCode)?.usageCount ?? 0}
          pending={save.isPending}
          onClose={() => setEditing(null)}
          onSave={(s) =>
            save
              .mutateAsync({ body: templateBody(s), existingCode: s.existingCode })
              .then(() => setEditing(null))
          }
        />
      )}
      {versions && <VersionsModal kind="templates" componentKey={versions.code} title={versions.name} onClose={() => setVersions(null)} />}
    </>
  );
}

/** The template editor's inputs; the request is then checked against SaveVisitFormTemplateRequestSchema. */
const TemplateFormSchema = z
  .object({
    existingCode: z.string().nullable(),
    code: z.string(),
    name: z.string().trim().min(3, "Enter a name (at least 3 characters).").max(160, "Name is too long (at most 160 characters)."),
    visitKind: VisitKindEnum,
    blocks: z.array(z.custom<VisitFormBlock>()).min(1, "Add at least one block."),
  })
  .superRefine((v, ctx) => {
    if (!v.existingCode && !FORM_CODE_REGEX.test(v.code.trim().toUpperCase())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["code"], message: "Code: 2 to 40 capital letters, digits or underscores, starting with a letter." });
    }
    if (VISIT_KIND_META[v.visitKind].facilityRule === "NONE" && v.blocks.some((b) => b.type === "FACILITIES")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blocks"],
        message: `${VISIT_KIND_META[v.visitKind].label} monitoring visits have no facility sub-forms: remove that block.`,
      });
    }
    const contract = SaveVisitFormTemplateRequestSchema.safeParse(templateBody(v));
    if (!contract.success) {
      for (const issue of contract.error.issues) ctx.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message });
    }
  });

function TemplateEditor({
  initial,
  sectionOptions,
  titleOf,
  usageCount,
  pending,
  onClose,
  onSave,
}: {
  initial: EditorState;
  sectionOptions: Array<{ value: string; label: string }>;
  titleOf: (code: string) => string;
  usageCount: number;
  pending: boolean;
  onClose: () => void;
  onSave: (s: EditorState) => Promise<unknown>;
}) {
  const form = useZodForm(TemplateFormSchema, { defaultValues: initial });
  const s = form.watch() as EditorState;
  const [adding, setAdding] = useState("");
  const setBlocks = (blocks: VisitFormBlock[]) => form.setValue("blocks", blocks, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);
  const facilitiesAllowed = VISIT_KIND_META[s.visitKind].facilityRule !== "NONE";
  const hasFacilities = s.blocks.some((b) => b.type === "FACILITIES");
  const listed = useMemo(() => new Set(s.blocks.flatMap((b) => (b.type === "SECTION" ? [b.sectionCode] : []))), [s.blocks]);
  // The first problem in the form, shown next to Save (field errors also show under their input once touched).
  const errors = form.formState.errors;
  const error = !form.formState.isValid
    ? (errors.code?.message ?? errors.name?.message ?? (errors.blocks as { message?: string } | undefined)?.message ?? errors.visitKind?.message ?? "Complete the template.")
    : null;
  const submit = async () => {
    if (!(await form.trigger())) return false;
    try {
      await onSave(form.getValues() as EditorState);
      return true;
    } catch {
      return false;
    }
  };
  useLeaveGuard(dirty ? { label: "Monitoring form template", save: submit } : null);
  const close = () => {
    if (dirty && !window.confirm("Discard the unsaved changes?")) return;
    onClose();
  };
  const move = (i: number, d: -1 | 1) => {
    const next = [...s.blocks];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setBlocks(next);
  };

  return (
    <ModalShell title={initial.existingCode ? `Edit ${initial.name}` : "Add a monitoring form template"} onClose={close} maxWidth="max-w-2xl">
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-[11px] font-semibold text-slate-700">
            Code
            <input
              className={`${smallInput} font-mono uppercase read-only:bg-slate-50 read-only:text-slate-500 ${invalidClass(form, "code")}`}
              readOnly={Boolean(initial.existingCode)}
              aria-disabled={Boolean(initial.existingCode) || undefined}
              maxLength={40}
              {...form.register("code", { setValueAs: (v: string) => v.toUpperCase() })}
              {...fieldA11y(form, "code")}
            />
            <FieldError form={form} name="code" className="font-normal" />
          </label>
          <label className="text-[11px] font-semibold text-slate-700">
            Name
            <input
              className={`${smallInput} ${invalidClass(form, "name")}`}
              maxLength={160}
              {...form.register("name")}
              {...fieldA11y(form, "name")}
            />
            <FieldError form={form} name="name" className="font-normal" />
          </label>
        </div>
        <Controller
          control={form.control}
          name="visitKind"
          render={({ field }) => (
            <CustomSelect
              label="Kind of monitoring visit"
              size="sm"
              value={field.value}
              disabled={Boolean(initial.existingCode)}
              onChange={(v) => field.onChange(v as VisitKind)}
              options={VisitKindEnum.options.map((k) => ({ value: k, label: VISIT_KIND_META[k].label, description: VISIT_KIND_META[k].description }))}
            />
          )}
        />
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-slate-700">Blocks, in order</p>
          <p className="text-[11px] text-slate-500">Header first (from the monitoring visit), then these blocks, then any follow-up check items, then the summary.</p>
          {s.blocks.map((b, i) => (
            <div key={b.type === "SECTION" ? b.sectionCode : "facilities"} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
              <span className={`flex-1 text-xs ${b.type === "FACILITIES" ? "font-bold text-brand-primary" : "text-slate-800"}`}>
                {b.type === "FACILITIES" ? "Facility sub-forms (one per facility in the monitoring visit)" : titleOf(b.sectionCode)}
              </span>
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="p-1 text-slate-400 disabled:opacity-30" aria-label="Move up">
                <ChevronUp className="w-4 h-4" />
              </button>
              <button type="button" disabled={i === s.blocks.length - 1} onClick={() => move(i, 1)} className="p-1 text-slate-400 disabled:opacity-30" aria-label="Move down">
                <ChevronDown className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => setBlocks(s.blocks.filter((_, j) => j !== i))} className="p-1 text-slate-400 hover:text-rose-600" aria-label="Remove block">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          {s.blocks.length < FORM_MAX_TEMPLATE_BLOCKS && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-72">
                <CustomSelect
                  size="sm"
                  value={adding}
                  placeholder="Add a section…"
                  onChange={(v) => {
                    if (v) setBlocks([...s.blocks, { type: "SECTION", sectionCode: v }]);
                    setAdding("");
                  }}
                  options={sectionOptions.filter((o) => !listed.has(o.value))}
                  searchable
                />
              </div>
              {facilitiesAllowed && !hasFacilities && (
                <button type="button" className="text-xs font-semibold text-brand-primary" onClick={() => setBlocks([...s.blocks, { type: "FACILITIES" }])}>
                  + Facility sub-forms slot
                </button>
              )}
            </div>
          )}
        </div>
        {error && <p className="text-xs text-rose-600">{error}</p>}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
          {usageCount > 0 && <p className="mr-auto text-[11px] text-slate-500">Used by {usageCount} built form(s): saving creates a new version.</p>}
          <button type="button" className={secondaryButton} onClick={close}>
            Cancel
          </button>
          <button type="button" className={primaryButton} disabled={!canSubmit(form, { pending, blocked: !dirty })} onClick={() => void submit()}>
            {pending ? "Saving…" : "Save template"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
