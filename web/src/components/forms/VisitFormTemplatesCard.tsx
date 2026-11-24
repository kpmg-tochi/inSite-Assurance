import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import {
  FORM_CODE_REGEX,
  FORM_MAX_TEMPLATE_BLOCKS,
  VISIT_KIND_META,
  VisitKindEnum,
  type VisitFormBlock,
  type VisitFormTemplateDto,
  type VisitKind,
} from "@insite/shared";
import { useAuth } from "../../lib/auth-context";
import { useLeaveGuard } from "../../lib/navigationGuard";
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
    { id: "kind", header: "Visit kind", width: "w-40", cell: (t) => <span className="text-xs text-slate-700">{VISIT_KIND_META[t.visitKind].label}</span> },
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
        title="Visit form templates"
        subtitle="One per visit kind: the fixed sections in order and where the facility sub-forms go. A project type picks the template for each kind."
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
              .mutateAsync({ body: { code: s.code.trim().toUpperCase(), name: s.name.trim(), visitKind: s.visitKind, blocks: s.blocks }, existingCode: s.existingCode })
              .then(() => setEditing(null))
          }
        />
      )}
      {versions && <VersionsModal kind="templates" componentKey={versions.code} title={versions.name} onClose={() => setVersions(null)} />}
    </>
  );
}

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
  const [s, setS] = useState(initial);
  const [adding, setAdding] = useState("");
  const set = (patch: Partial<EditorState>) => setS((x) => ({ ...x, ...patch }));
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);
  const facilitiesAllowed = VISIT_KIND_META[s.visitKind].facilityRule !== "NONE";
  const hasFacilities = s.blocks.some((b) => b.type === "FACILITIES");
  const listed = useMemo(() => new Set(s.blocks.flatMap((b) => (b.type === "SECTION" ? [b.sectionCode] : []))), [s.blocks]);
  const error = !s.existingCode && !FORM_CODE_REGEX.test(s.code.trim().toUpperCase())
    ? "Code: 2 to 40 capital letters, digits or underscores."
    : s.name.trim().length < 3
      ? "Enter a name (at least 3 characters)."
      : s.blocks.length === 0
        ? "Add at least one block."
        : hasFacilities && !facilitiesAllowed
          ? `${VISIT_KIND_META[s.visitKind].label} visits have no facility sub-forms: remove that block.`
          : null;
  const submit = async () => {
    if (error) return false;
    try {
      await onSave(s);
      return true;
    } catch {
      return false;
    }
  };
  useLeaveGuard(dirty ? { label: "Visit form template", save: submit } : null);
  const close = () => {
    if (dirty && !window.confirm("Discard the unsaved changes?")) return;
    onClose();
  };
  const move = (i: number, d: -1 | 1) => {
    const next = [...s.blocks];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    set({ blocks: next });
  };

  return (
    <ModalShell title={s.existingCode ? `Edit ${initial.name}` : "Add a visit form template"} onClose={close} maxWidth="max-w-2xl">
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-[11px] font-semibold text-slate-700">
            Code
            <input
              className={`${smallInput} font-mono uppercase`}
              value={s.code}
              disabled={Boolean(s.existingCode)}
              maxLength={40}
              onChange={(e) => set({ code: e.target.value.toUpperCase() })}
            />
          </label>
          <label className="text-[11px] font-semibold text-slate-700">
            Name
            <input className={smallInput} value={s.name} maxLength={160} onChange={(e) => set({ name: e.target.value })} />
          </label>
        </div>
        <CustomSelect
          label="Visit kind"
          size="sm"
          value={s.visitKind}
          disabled={Boolean(s.existingCode)}
          onChange={(v) => set({ visitKind: v as VisitKind })}
          options={VisitKindEnum.options.map((k) => ({ value: k, label: VISIT_KIND_META[k].label, description: VISIT_KIND_META[k].description }))}
        />
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-slate-700">Blocks, in order</p>
          <p className="text-[11px] text-slate-500">Header first (from the visit), then these blocks, then any re-check items, then the summary.</p>
          {s.blocks.map((b, i) => (
            <div key={b.type === "SECTION" ? b.sectionCode : "facilities"} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
              <span className={`flex-1 text-xs ${b.type === "FACILITIES" ? "font-bold text-brand-primary" : "text-slate-800"}`}>
                {b.type === "FACILITIES" ? "Facility sub-forms (one per facility in the visit)" : titleOf(b.sectionCode)}
              </span>
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="p-1 text-slate-400 disabled:opacity-30" aria-label="Move up">
                <ChevronUp className="w-4 h-4" />
              </button>
              <button type="button" disabled={i === s.blocks.length - 1} onClick={() => move(i, 1)} className="p-1 text-slate-400 disabled:opacity-30" aria-label="Move down">
                <ChevronDown className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => set({ blocks: s.blocks.filter((_, j) => j !== i) })} className="p-1 text-slate-400 hover:text-rose-600" aria-label="Remove block">
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
                    if (v) set({ blocks: [...s.blocks, { type: "SECTION", sectionCode: v }] });
                    setAdding("");
                  }}
                  options={sectionOptions.filter((o) => !listed.has(o.value))}
                  searchable
                />
              </div>
              {facilitiesAllowed && !hasFacilities && (
                <button type="button" className="text-xs font-semibold text-brand-primary" onClick={() => set({ blocks: [...s.blocks, { type: "FACILITIES" }] })}>
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
          <button type="button" className={primaryButton} disabled={pending || Boolean(error) || !dirty} onClick={() => void submit()}>
            {pending ? "Saving…" : "Save template"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
