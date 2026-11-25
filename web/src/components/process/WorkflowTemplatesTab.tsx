import { useState } from "react";
import { z } from "zod";
import { ArrowLeft, Pencil, Plus, Star, Trash2 } from "lucide-react";
import {
  SaveWorkflowTemplateRequestSchema,
  type SaveWorkflowTemplateRequest,
  type WorkflowTemplateDto,
} from "@insite/shared";
import { formatDateShort } from "../../lib/formatters";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../lib/forms";
import { StandardTable, TableActionButton, TableBadge, type TableColumnDef } from "../table";
import { useWorkflowTemplatesQuery } from "../../queries/process/useProcessQueries";
import {
  useDeleteWorkflowTemplateMutation,
  useSaveWorkflowTemplateMutation,
} from "../../mutations/process/useProcessMutations";
import { ProcessEditor } from "./ProcessEditor";
import { useConfirmDialog } from "./ConfirmDialog";
import { useRoleOptions } from "./useRoleOptions";
import { defaultProcessDraft, draftFromTemplate, validateProcessDraft, type ProcessDraft } from "./processState";

const inputCls =
  "w-full rounded-xl border border-slate-300 px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:border-brand-primary";

function toRequest(t: WorkflowTemplateDto, patch: Partial<SaveWorkflowTemplateRequest> = {}): SaveWorkflowTemplateRequest {
  return { name: t.name, description: t.description, isDefault: t.isDefault, config: t.config, ...patch };
}

/** The template's own fields; the process draft is checked with the same validator as the server. */
const TemplateFieldsSchema = z.object({
  name: z.string().trim().min(3, "Name the template (3 to 120 characters).").max(120, "Name the template (3 to 120 characters)."),
  description: z.string().trim().max(1000, "Description is too long (at most 1000 characters)."),
  isDefault: z.boolean(),
});
type TemplateFields = z.input<typeof TemplateFieldsSchema>;

const templateRequest = (v: TemplateFields, draft: ProcessDraft) => ({
  name: v.name,
  description: v.description.trim() || null,
  isDefault: v.isDefault,
  config: { process: draft.config, reportChain: draft.reportChain },
});

function TemplateEditor({
  template,
  onDone,
}: {
  template: WorkflowTemplateDto | null;
  onDone: () => void;
}) {
  const form = useZodForm(TemplateFieldsSchema, {
    defaultValues: { name: template?.name ?? "", description: template?.description ?? "", isDefault: template?.isDefault ?? false },
  });
  const [draft, setDraft] = useState<ProcessDraft>(template ? draftFromTemplate(template.config) : defaultProcessDraft());
  const [error, setError] = useState<string | null>(null);
  const roles = useRoleOptions();
  const saveMutation = useSaveWorkflowTemplateMutation();
  const issues = validateProcessDraft(draft);
  // The whole request against the contract, so the button stays off while anything would be refused.
  const contract = SaveWorkflowTemplateRequestSchema.safeParse(templateRequest(form.watch(), draft));
  const blockedReason =
    issues.count > 0
      ? "Fix the approval chain issues shown below."
      : !contract.success && form.formState.isValid
        ? contract.error.issues[0]?.message ?? "Check the process settings."
        : null;

  const submit = form.handleSubmit(async (values) => {
    if (issues.count > 0) {
      setError("Fix the approval chain issues shown below.");
      return;
    }
    const parsed = SaveWorkflowTemplateRequestSchema.safeParse(templateRequest(values, draft));
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      setError(first.path[0] === "name" ? "Name the template (3 to 120 characters)." : first.message);
      return;
    }
    setError(null);
    try {
      await saveMutation.mutateAsync({ templateId: template?.id, body: parsed.data });
      onDone();
    } catch {
      // Toast from the mutation hook.
    }
  });

  return (
    <form onSubmit={submit} noValidate className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm space-y-5">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <button type="button" onClick={onDone} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-primary hover:underline">
            <ArrowLeft className="w-3.5 h-3.5" /> All templates
          </button>
          <h2 className="mt-1 text-sm font-bold text-slate-900">{template ? `Edit "${template.name}"` : "New workflow template"}</h2>
          <p className="text-[11px] text-slate-500">
            Applying a template copies it into the project. Editing a template later does not change projects that used it.
          </p>
        </div>
      </div>
      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="tpl-name">
            Name
          </label>
          <input id="tpl-name" className={`${inputCls} ${invalidClass(form, "name")}`} maxLength={120} {...form.register("name")} {...fieldA11y(form, "name")} />
          <FieldError form={form} name="name" />
        </div>
        <label className="flex items-center gap-2 self-end text-xs text-slate-700">
          <input type="checkbox" className="h-4 w-4 accent-brand-primary" {...form.register("isDefault")} />
          Default for new projects
        </label>
        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="tpl-desc">
            Description
          </label>
          <textarea id="tpl-desc" rows={2} className={`${inputCls} ${invalidClass(form, "description")}`} maxLength={1000} {...form.register("description")} {...fieldA11y(form, "description")} />
          <FieldError form={form} name="description" />
        </div>
      </div>
      <ProcessEditor draft={draft} onChange={setDraft} issues={issues} roles={roles} />
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <button type="button" onClick={onDone} className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          Cancel
        </button>
        <span className="inline-flex flex-col items-end gap-1">
          <SubmitButton
            form={form}
            pending={saveMutation.isPending}
            blocked={Boolean(blockedReason)}
            pendingLabel="Saving…"
            hint="Name the template to save it."
            className="rounded-xl bg-brand-primary px-4 py-2 text-xs font-semibold text-white hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-primary"
          >
            Save template
          </SubmitButton>
          {blockedReason && <span className="text-[11px] text-slate-500">{blockedReason}</span>}
        </span>
      </div>
    </form>
  );
}

/** Settings → Workflow templates (templates:manage_workflows). */
export function WorkflowTemplatesTab() {
  const templatesQuery = useWorkflowTemplatesQuery();
  const saveMutation = useSaveWorkflowTemplateMutation();
  const deleteMutation = useDeleteWorkflowTemplateMutation();
  const { ask, dialog } = useConfirmDialog();
  const [editing, setEditing] = useState<WorkflowTemplateDto | "new" | null>(null);

  if (editing) {
    return <TemplateEditor key={editing === "new" ? "new" : editing.id} template={editing === "new" ? null : editing} onDone={() => setEditing(null)} />;
  }

  const columns: TableColumnDef<WorkflowTemplateDto>[] = [
    {
      id: "name",
      header: "Template",
      width: "w-80",
      cell: (t) => (
        <div>
          <div className="flex items-center gap-2 font-bold text-slate-900">
            {t.name} {t.isDefault && <TableBadge variant="info">Default</TableBadge>}
          </div>
          {t.description && <div className="text-[11px] text-slate-500 line-clamp-2">{t.description}</div>}
        </div>
      ),
    },
    {
      id: "chains",
      header: "Chains",
      width: "w-48",
      cell: (t) => (
        <span className="text-[11px] text-slate-600">
          {t.config.process.requireReportApproval ? `Visit reports: ${t.config.reportChain.length} step(s)` : "Report approval off"}
        </span>
      ),
    },
    {
      id: "updated",
      header: "Updated",
      width: "w-28",
      cell: (t) => <span className="text-[11px] text-slate-500">{formatDateShort(t.updatedAt)}</span>,
    },
    {
      id: "actions",
      header: "",
      align: "right",
      width: "w-64",
      cell: (t) => (
        <div className="flex justify-end gap-1.5">
          {!t.isDefault && (
            <TableActionButton
              icon={<Star className="w-3.5 h-3.5" />}
              disabled={saveMutation.isPending}
              onClick={() =>
                saveMutation.mutate({
                  templateId: t.id,
                  body: toRequest(t, { isDefault: true }),
                  successMessage: `"${t.name}" is now the default for new projects.`,
                })
              }
            >
              Set default
            </TableActionButton>
          )}
          <TableActionButton icon={<Pencil className="w-3.5 h-3.5" />} onClick={() => setEditing(t)}>
            Edit
          </TableActionButton>
          <TableActionButton
            variant="danger"
            icon={<Trash2 className="w-3.5 h-3.5" />}
            onClick={async () => {
              const ok = await ask({
                title: `Delete "${t.name}"?`,
                message: "Projects that used this template keep their own copy of its settings.",
                confirmLabel: "Delete",
                danger: true,
              });
              if (ok) deleteMutation.mutate(t.id);
            }}
          >
            Delete
          </TableActionButton>
        </div>
      ),
    },
  ];

  return (
    <>
      {dialog}
      <StandardTable
        title="Workflow templates"
        subtitle="Starting points for a project's process switches and approval chains."
        headerActions={
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-brand-navy hover:bg-slate-100"
          >
            <Plus className="w-3.5 h-3.5" /> New template
          </button>
        }
        columns={columns}
        data={templatesQuery.data ?? []}
        keyExtractor={(t) => t.id}
        loading={templatesQuery.isLoading}
        emptyState={{ title: "No templates", description: "Create a template to reuse a process across projects." }}
      />
    </>
  );
}
