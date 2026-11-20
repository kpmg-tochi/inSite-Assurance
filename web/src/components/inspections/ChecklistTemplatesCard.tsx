import React, { useState } from "react";
import { Archive, ChevronDown, ChevronUp, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  CHECKLIST_RESPONSE_TYPE_LABELS,
  ChecklistResponseTypeEnum,
  INSPECTION_VISIT_TYPE_LABELS,
  InspectionVisitTypeEnum,
  type ChecklistItemInput,
  type InspectionChecklistTemplateDto,
  type InspectionVisitType,
} from "@insite/shared";
import { useChecklistTemplatesQuery } from "../../queries/inspections/useInspectionQueries";
import { useArchiveChecklistTemplateMutation, useSaveChecklistTemplateMutation } from "../../mutations/inspections/useInspectionMutations";
import { useAuth } from "../../lib/auth-context";

/**
 * Phase 14: tenant checklist templates for site inspections. Saving a template that inspections
 * already used creates a new version (those inspections keep theirs); an unused one is edited in
 * place. Each item has a response type and rules: required, photo required, photo required on fail.
 */

type EditorSection = { key: string; title: string; items: Array<Required<Pick<ChecklistItemInput, "key" | "label" | "responseType">> & ChecklistItemInput> };
interface EditorState {
  existingCode: string | null;
  code: string;
  name: string;
  visitTypes: InspectionVisitType[];
  sections: EditorSection[];
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "item";

const blank = (): EditorState => ({
  existingCode: null,
  code: "",
  name: "",
  visitTypes: ["ROUTINE"],
  sections: [{ key: "section-1", title: "", items: [{ key: "item-1", label: "", responseType: "PASS_FAIL_NA", required: true, photoRequired: false, photoRequiredOnFail: true }] }],
});

const fromTemplate = (t: InspectionChecklistTemplateDto): EditorState => ({
  existingCode: t.code,
  code: t.code,
  name: t.name,
  visitTypes: t.visitTypes,
  sections: t.sections.map((s) => ({ key: s.key, title: s.title, items: s.items.map((i) => ({ ...i })) })),
});

/** Keys for new sections and items come from their text, made unique. */
function withKeys(state: EditorState): EditorState {
  const used = new Set<string>();
  const unique = (base: string) => {
    let k = base;
    let n = 2;
    while (used.has(k)) k = `${base}-${n++}`;
    used.add(k);
    return k;
  };
  const sectionKeys = new Set<string>();
  return {
    ...state,
    sections: state.sections.map((s, si) => {
      let sk = s.key.startsWith("section-") && s.title ? slug(s.title) : s.key;
      while (sectionKeys.has(sk)) sk = `${sk}-${si}`;
      sectionKeys.add(sk);
      return { ...s, key: sk, items: s.items.map((i) => ({ ...i, key: unique(i.key.startsWith("item-") && i.label ? slug(i.label) : i.key) })) };
    }),
  };
}

export function ChecklistTemplatesCard() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("inspections:manage_templates");
  const [showArchived, setShowArchived] = useState(false);
  const q = useChecklistTemplatesQuery(showArchived);
  const save = useSaveChecklistTemplateMutation();
  const archive = useArchiveChecklistTemplateMutation();
  const [editor, setEditor] = useState<EditorState | null>(null);

  const submit = async () => {
    if (!editor) return;
    const s = withKeys(editor);
    await save.mutateAsync({ existingCode: s.existingCode, body: { code: s.code, name: s.name, visitTypes: s.visitTypes, sections: s.sections } }).then(() => setEditor(null)).catch(() => undefined);
  };

  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Inspection checklists</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">Checklists for site visits. Project types choose one per visit type. Inspections keep the version they used.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
          </label>
          {canManage && !editor && (
            <button type="button" onClick={() => setEditor(blank())} className="inline-flex items-center gap-1 rounded-xl bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white">
              <Plus className="w-3.5 h-3.5" /> New checklist
            </button>
          )}
        </div>
      </div>

      {editor ? (
        <TemplateEditor state={editor} onChange={setEditor} onCancel={() => setEditor(null)} onSave={submit} saving={save.isPending} />
      ) : (
        <ul className="divide-y divide-slate-100">
          {(q.data ?? []).map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 py-3 text-xs">
              <div>
                <p className="font-semibold text-slate-900">
                  {t.name} <span className="text-slate-400">· {t.code} v{t.version}</span>
                  {t.isArchived && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">archived</span>}
                </p>
                <p className="text-[11px] text-slate-500">
                  {t.visitTypes.map((v) => INSPECTION_VISIT_TYPE_LABELS[v]).join(", ")} · {t.sections.length} section(s),{" "}
                  {t.sections.reduce((n, s) => n + s.items.length, 0)} item(s) · used by {t.usageCount} inspection(s)
                </p>
              </div>
              {canManage && (
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setEditor(fromTemplate(t))} className="inline-flex items-center gap-1 text-brand-primary font-semibold">
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => archive.mutate({ code: t.code, archived: !t.isArchived })}
                    className="inline-flex items-center gap-1 text-slate-600 font-semibold"
                  >
                    {t.isArchived ? <RotateCcw className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />} {t.isArchived ? "Restore" : "Archive"}
                  </button>
                </div>
              )}
            </li>
          ))}
          {!q.isLoading && (q.data ?? []).length === 0 && <li className="py-3 text-xs text-slate-500">No checklists yet.</li>}
        </ul>
      )}
    </section>
  );
}

function TemplateEditor({
  state,
  onChange,
  onCancel,
  onSave,
  saving,
}: {
  state: EditorState;
  onChange: (s: EditorState) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const input = "w-full rounded-xl border border-slate-300 px-3 py-1.5 text-xs focus:outline-none focus:border-brand-primary";
  const setSection = (si: number, patch: Partial<EditorSection>) => onChange({ ...state, sections: state.sections.map((s, i) => (i === si ? { ...s, ...patch } : s)) });
  const setItem = (si: number, ii: number, patch: Partial<EditorSection["items"][number]>) =>
    setSection(si, { items: state.sections[si].items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) });
  const move = <T,>(list: T[], from: number, to: number) => {
    if (to < 0 || to >= list.length) return list;
    const next = [...list];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    return next;
  };
  const valid = state.code.trim().length >= 2 && state.name.trim().length >= 3 && state.visitTypes.length > 0 && state.sections.every((s) => s.title.trim().length >= 2 && s.items.length > 0 && s.items.every((i) => i.label.trim().length >= 2));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Code</label>
          <input className={input} value={state.code} disabled={Boolean(state.existingCode)} onChange={(e) => onChange({ ...state, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") })} placeholder="ROUTINE_VISIT" />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-slate-700 mb-1">Name</label>
          <input className={input} value={state.name} onChange={(e) => onChange({ ...state, name: e.target.value })} placeholder="Routine monitoring visit" />
        </div>
      </div>
      <fieldset>
        <legend className="block text-xs font-semibold text-slate-700 mb-1">Visit types</legend>
        <div className="flex flex-wrap gap-2">
          {InspectionVisitTypeEnum.options.map((v) => {
            const on = state.visitTypes.includes(v);
            return (
              <button
                key={v}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ ...state, visitTypes: on ? state.visitTypes.filter((x) => x !== v) : [...state.visitTypes, v] })}
                className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${on ? "border-brand-primary bg-brand-primary text-white" : "border-slate-200 text-slate-600"}`}
              >
                {INSPECTION_VISIT_TYPE_LABELS[v]}
              </button>
            );
          })}
        </div>
      </fieldset>

      {state.sections.map((s, si) => (
        <div key={si} className="rounded-xl border border-slate-200 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <input className={input} value={s.title} onChange={(e) => setSection(si, { title: e.target.value })} placeholder={`Section ${si + 1} title`} aria-label="Section title" />
            <button type="button" aria-label="Move section up" onClick={() => onChange({ ...state, sections: move(state.sections, si, si - 1) })} className="text-slate-500">
              <ChevronUp className="w-4 h-4" />
            </button>
            <button type="button" aria-label="Move section down" onClick={() => onChange({ ...state, sections: move(state.sections, si, si + 1) })} className="text-slate-500">
              <ChevronDown className="w-4 h-4" />
            </button>
            <button type="button" aria-label="Remove section" onClick={() => onChange({ ...state, sections: state.sections.filter((_, i) => i !== si) })} className="text-red-600">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          {s.items.map((it, ii) => (
            <div key={ii} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center pl-3">
              <input className={`${input} md:col-span-5`} value={it.label} onChange={(e) => setItem(si, ii, { label: e.target.value })} placeholder="Question" aria-label="Item question" />
              <select className={`${input} md:col-span-3`} value={it.responseType} onChange={(e) => setItem(si, ii, { responseType: e.target.value as EditorSection["items"][number]["responseType"] })} aria-label="Response type">
                {ChecklistResponseTypeEnum.options.map((r) => (
                  <option key={r} value={r}>{CHECKLIST_RESPONSE_TYPE_LABELS[r]}</option>
                ))}
              </select>
              <div className="md:col-span-3 flex flex-wrap gap-2 text-[11px] text-slate-600">
                <label className="inline-flex items-center gap-1">
                  <input type="checkbox" checked={it.required ?? true} onChange={(e) => setItem(si, ii, { required: e.target.checked })} /> Required
                </label>
                <label className="inline-flex items-center gap-1">
                  <input type="checkbox" checked={it.photoRequired ?? false} onChange={(e) => setItem(si, ii, { photoRequired: e.target.checked })} /> Photo
                </label>
                <label className="inline-flex items-center gap-1">
                  <input type="checkbox" checked={it.photoRequiredOnFail ?? false} onChange={(e) => setItem(si, ii, { photoRequiredOnFail: e.target.checked })} /> Photo on fail
                </label>
              </div>
              <button type="button" aria-label="Remove item" onClick={() => setSection(si, { items: s.items.filter((_, j) => j !== ii) })} className="md:col-span-1 text-red-600 justify-self-end">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setSection(si, { items: [...s.items, { key: `item-${Date.now()}`, label: "", responseType: "PASS_FAIL_NA", required: true, photoRequired: false, photoRequiredOnFail: true }] })}
            className="ml-3 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-primary"
          >
            <Plus className="w-3 h-3" /> Add item
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange({ ...state, sections: [...state.sections, { key: `section-${Date.now()}`, title: "", items: [{ key: `item-${Date.now()}`, label: "", responseType: "PASS_FAIL_NA", required: true, photoRequired: false, photoRequiredOnFail: true }] }] })}
        className="inline-flex items-center gap-1 rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
      >
        <Plus className="w-3.5 h-3.5" /> Add section
      </button>
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
        <button type="button" onClick={onCancel} className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700">
          Cancel
        </button>
        <button type="button" disabled={!valid || saving} onClick={onSave} className="rounded-xl bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
          {saving ? "Saving…" : "Save checklist"}
        </button>
      </div>
    </div>
  );
}
