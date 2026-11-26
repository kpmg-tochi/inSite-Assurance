import React from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  CLOSURE_GATE_META,
  CLOSURE_ITEM_KIND_META,
  ClosureChecklistItemKindEnum,
  ClosureGateEnum,
  COC_SIGNATORY_SCOPE_META,
  CocSignatoryScopeEnum,
  CONTRACTOR_RATING_STAGE_META,
  ContractorRatingStageEnum,
  DEFAULT_COC_SIGNATORIES,
  VISIT_KIND_META,
  VisitKindEnum,
  type ClosureChecklistItemKind,
  type ClosureChecklistItemTemplateInput,
  type ClosureGate,
  type CocSignatoryScope,
  type CocSignatorySlotInput,
  type ContractorRatingStage,
  type VisitKind,
  type ProjectTypeClosureConfigInput,
} from "@insite/shared";
import { CustomSelect } from "../common";
import { useDocumentTypesQuery } from "../../queries/contracts/useContractQueries";

/**
 * Phase 15: closure rules of a project type: the Certificate of Completion signatory slots and the
 * gates it controls, the handover ceremony deadline, the two closure checklists and whether ratings
 * are shared with the contractor. Projects keep the version of the type they were created with.
 */

export type ClosureRules = ProjectTypeClosureConfigInput;

const inputCls = "w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-brand-primary";
const sectionCls = "rounded-2xl border border-slate-200 bg-white p-4 space-y-3";
const iconButton = "rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-800";

function keyFrom(label: string, taken: string[], fallback: string): string {
  let base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  if (!/^[a-z]/.test(base)) base = `${fallback}-${base}`.replace(/-+$/, "");
  if (base.length < 2) base = fallback;
  let key = base;
  for (let n = 2; taken.includes(key); n += 1) key = `${base}-${n}`;
  return key;
}

export function ClosureRulesEditor({ value, onChange }: { value: ClosureRules; onChange: (next: ClosureRules) => void }) {
  const { data: docTypes = [] } = useDocumentTypesQuery(false);
  const slots = value.cocSignatories ?? DEFAULT_COC_SIGNATORIES;
  const gates = value.requireCocFor ?? [];
  const set = (patch: Partial<ClosureRules>) => onChange({ ...value, ...patch });
  const setSlot = (i: number, patch: Partial<CocSignatorySlotInput>) => set({ cocSignatories: slots.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  return (
    <section className={sectionCls}>
      <div>
        <h3 className="text-sm font-bold text-slate-900">Completion and closure</h3>
        <p className="text-[11px] text-slate-500">Certificate of Completion signatories and gates, the handover ceremony and the closure checklists.</p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-700">Certificate of Completion signatories</p>
        {slots.map((slot, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 p-2 md:grid-cols-12">
            <input
              className={`${inputCls} md:col-span-4`}
              value={slot.label}
              placeholder="e.g. Director, Physical Planning"
              aria-label={`Signatory ${i + 1}: title`}
              onChange={(e) => setSlot(i, { label: e.target.value })}
              onBlur={() => !slot.key && setSlot(i, { key: keyFrom(slot.label, slots.map((s) => s.key), "slot") })}
            />
            <div className="md:col-span-3">
              <CustomSelect
                value={(slot.organizationScope ?? "PROJECT_OWNER") as CocSignatoryScope}
                onChange={(v) => setSlot(i, { organizationScope: v })}
                disabled={Boolean(slot.isBeneficiary)}
                ariaLabel={`Signatory ${i + 1}: organisation`}
                options={CocSignatoryScopeEnum.options.map((o) => ({ value: o, label: COC_SIGNATORY_SCOPE_META[o].label }))}
              />
            </div>
            <input
              className={`${inputCls} md:col-span-2`}
              value={slot.roleCode ?? ""}
              placeholder="Role code (optional)"
              aria-label={`Signatory ${i + 1}: role code (optional)`}
              disabled={Boolean(slot.isBeneficiary)}
              onChange={(e) => setSlot(i, { roleCode: e.target.value.trim() ? e.target.value.trim().toUpperCase() : null })}
            />
            <label className="flex items-center gap-1.5 text-[11px] text-slate-700 md:col-span-2">
              <input
                type="checkbox"
                checked={Boolean(slot.isBeneficiary)}
                onChange={(e) =>
                  set({ cocSignatories: slots.map((s, j) => (j === i ? { ...s, isBeneficiary: e.target.checked } : e.target.checked ? { ...s, isBeneficiary: false } : s)) })
                }
              />
              Beneficiary
            </label>
            <button type="button" className={`${iconButton} justify-self-end md:col-span-1`} disabled={slots.length <= 1} onClick={() => set({ cocSignatories: slots.filter((_, j) => j !== i) })} aria-label="Remove slot">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-primary hover:underline"
          onClick={() => set({ cocSignatories: [...slots, { key: keyFrom("signatory", slots.map((s) => s.key), "slot"), label: "", organizationScope: "PROJECT_OWNER" }] })}
        >
          <Plus className="h-3.5 w-3.5" /> Add signatory
        </button>
        <p className="text-[11px] text-slate-500">
          Staff slots need completion:sign_certificate (and the role, if named); each slot needs a different person. The beneficiary signs on paper and staff record the signed copy.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-700">An issued certificate is required for</p>
          {ClosureGateEnum.options.map((g: ClosureGate) => (
            <label key={g} className="flex items-start gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={gates.includes(g)}
                onChange={(e) => set({ requireCocFor: e.target.checked ? [...gates, g] : gates.filter((x) => x !== g) })}
              />
              <span>
                <span className="font-medium">{CLOSURE_GATE_META[g].label}</span>
                <span className="block text-[11px] text-slate-500">{CLOSURE_GATE_META[g].description}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={Boolean(value.requireFinalEvaluationBeforeCoc)} onChange={(e) => set({ requireFinalEvaluationBeforeCoc: e.target.checked })} />
            <span className="font-medium">An accepted final evaluation monitoring report is needed before drafting</span>
          </label>
          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={Boolean(value.shareRatingsWithContractor)} onChange={(e) => set({ shareRatingsWithContractor: e.target.checked })} />
            <span className="font-medium">Show contractor ratings to the contractor</span>
          </label>
          <label className="block text-xs text-slate-700">
            <span className="font-medium">Handover ceremony due (days after the certificate)</span>
            <input
              type="number"
              min={0}
              max={90}
              className={`${inputCls} mt-1 max-w-[8rem]`}
              value={value.handoverDueDaysAfterCoc ?? 7}
              onChange={(e) => set({ handoverDueDaysAfterCoc: Math.max(0, Math.min(90, Number(e.target.value) || 0)) })}
            />
          </label>
        </div>
      </div>

      <ChecklistList
        title="Closure checklist: before closing"
        items={value.beforeClose ?? []}
        otherKeys={(value.beforeArchive ?? []).map((i) => i.key)}
        docTypes={docTypes}
        onChange={(beforeClose) => set({ beforeClose })}
      />
      <ChecklistList
        title="Closure checklist: before archiving"
        items={value.beforeArchive ?? []}
        otherKeys={(value.beforeClose ?? []).map((i) => i.key)}
        docTypes={docTypes}
        onChange={(beforeArchive) => set({ beforeArchive })}
      />
    </section>
  );
}

function ChecklistList({
  title,
  items,
  otherKeys,
  docTypes,
  onChange,
}: {
  title: string;
  items: ClosureChecklistItemTemplateInput[];
  otherKeys: string[];
  docTypes: Array<{ code: string; name: string }>;
  onChange: (next: ClosureChecklistItemTemplateInput[]) => void;
}) {
  const setItem = (i: number, patch: Partial<ClosureChecklistItemTemplateInput>) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-slate-700">{title}</p>
      {items.length === 0 && <p className="text-[11px] text-slate-500">No items.</p>}
      {items.map((item, i) => (
        <div key={i} className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 p-2 md:grid-cols-12">
          <input className={`${inputCls} md:col-span-4`} value={item.label} placeholder="e.g. As-built drawings received" onChange={(e) => setItem(i, { label: e.target.value })} />
          <div className="md:col-span-3">
            <CustomSelect
              value={item.kind as ClosureChecklistItemKind}
              onChange={(kind) => setItem(i, { kind })}
              options={ClosureChecklistItemKindEnum.options.map((k) => ({ value: k, label: CLOSURE_ITEM_KIND_META[k].label, description: CLOSURE_ITEM_KIND_META[k].description }))}
            />
          </div>
          <div className="md:col-span-4">
            {item.kind === "DOCUMENT_TYPE" && (
              <div className="space-y-1">
                <CustomSelect
                  value={item.documentTypeCode ?? ""}
                  onChange={(v) => setItem(i, { documentTypeCode: v || null })}
                  placeholder="Document type"
                  options={docTypes.map((d) => ({ value: d.code, label: d.name }))}
                />
                <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
                  <input type="checkbox" checked={item.requireSignOff ?? true} onChange={(e) => setItem(i, { requireSignOff: e.target.checked })} />
                  Needs a sign-off on the current version (when the document type requires one)
                </label>
              </div>
            )}
            {item.kind === "INSPECTION_VISIT_TYPE" && (
              <CustomSelect
                value={(item.inspectionVisitType ?? "") as VisitKind}
                onChange={(v) => setItem(i, { inspectionVisitType: v })}
                placeholder="Kind of monitoring visit"
                options={VisitKindEnum.options.map((v) => ({ value: v, label: VISIT_KIND_META[v].label }))}
              />
            )}
            {item.kind === "CONTRACT_MILESTONE" && (
              <input className={inputCls} value={item.milestoneKey ?? ""} placeholder="Milestone key, e.g. post-closure-evaluation" onChange={(e) => setItem(i, { milestoneKey: e.target.value.trim() || null })} />
            )}
            {item.kind === "CONTRACTOR_RATINGS" && (
              <CustomSelect
                value={(item.ratingStage ?? "COMPLETION") as ContractorRatingStage}
                onChange={(v) => setItem(i, { ratingStage: v })}
                options={ContractorRatingStageEnum.options.map((s) => ({ value: s, label: CONTRACTOR_RATING_STAGE_META[s].label }))}
              />
            )}
            {item.kind === "MANUAL" && (
              <input className={inputCls} value={item.permissionKey ?? ""} placeholder="Permission (default closure:manage_checklist)" onChange={(e) => setItem(i, { permissionKey: e.target.value.trim() || null })} />
            )}
          </div>
          <button type="button" className={`${iconButton} justify-self-end md:col-span-1`} onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remove item">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs font-semibold text-brand-primary hover:underline"
        onClick={() => onChange([...items, { key: keyFrom(`item-${items.length + 1}`, [...items.map((x) => x.key), ...otherKeys], "item"), label: "", kind: "MANUAL" }])}
      >
        <Plus className="h-3.5 w-3.5" /> Add item
      </button>
    </div>
  );
}
