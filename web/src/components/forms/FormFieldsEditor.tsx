import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import {
  assembleVisitForm,
  FORM_CHOICE_TYPES,
  FORM_FIELD_TYPE_LABELS,
  FORM_MAX_FIELDS_PER_COMPONENT,
  FORM_MAX_RULES_PER_FIELD,
  FORM_NUMERIC_TYPES,
  FORM_PLACEHOLDERS,
  FORM_SIGNAL_LABELS,
  FORM_SUBFORM_SOFT_FIELD_LIMIT,
  FormFieldSchema,
  FormFieldTypeEnum,
  FormSignalKindEnum,
  PHOTO_MODE_LABELS,
  PhotoModeEnum,
  VISIT_KIND_META,
  VisitKindEnum,
  validateFormFields,
  type FacilityArchetype,
  type FormCondition,
  type FormField,
  type FormFieldRule,
  type FormFieldType,
  type FormSignalKind,
  type PhotoMode,
  type VisitKind,
} from "@insite/shared";
import { CustomSelect } from "../common";
import { smallInput } from "../contracts/contractUi";
import { FormSnapshotView } from "./FormSnapshotView";

/**
 * Redesign R3: the field editor shared by fixed sections and facility sub-forms. Keys are derived from
 * the label while a field is new and never change after it has been saved (D-R3.12). Issues come from
 * the same shared `validateFormFields` the server runs. The preview assembles the fields with the real
 * `assembleVisitForm` over sample units (three toilets, or one supply unit of 120).
 */

export interface EditorField extends FormField {
  uid: string;
  /** Not saved yet: the key still follows the label. */
  isNew: boolean;
}

let uidSeq = 0;
const nextUid = () => `f${++uidSeq}`;

export const toEditorFields = (fields: FormField[]): EditorField[] => fields.map((f) => ({ ...f, uid: nextUid(), isNew: false }));
export const fromEditorFields = (fields: EditorField[]): FormField[] => fields.map(({ uid: _u, isNew: _n, ...f }) => f);

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/\{[^}]*\}/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "question";

function withDerivedKeys(fields: EditorField[]): EditorField[] {
  const fixed = new Set(fields.filter((f) => !f.isNew).map((f) => f.key));
  const used = new Set<string>(fixed);
  return fields.map((f) => {
    if (!f.isNew) return f;
    const base = slug(f.label);
    let k = base;
    let n = 2;
    while (used.has(k)) k = `${base}-${n++}`;
    used.add(k);
    return { ...f, key: k };
  });
}

const newField = (type: FormFieldType = "YES_NO"): EditorField => ({
  ...FormFieldSchema.parse({ key: "question", label: "New question", type, ...(type === "PHOTO" ? { photo: {} } : {}) }),
  uid: nextUid(),
  isNew: true,
});

/** Settings that only apply to some types are cleared when the type changes. */
function retype(f: EditorField, type: FormFieldType): EditorField {
  return {
    ...f,
    type,
    options: FORM_CHOICE_TYPES.includes(type) ? (f.options.length >= 2 ? f.options : [{ key: "option-1", label: "Option 1" }, { key: "option-2", label: "Option 2" }]) : [],
    minSelected: null,
    maxSelected: null,
    unit: type === "NUMBER" ? f.unit : null,
    min: type === "NUMBER" ? f.min : null,
    max: type === "NUMBER" ? f.max : null,
    allowNa: type === "YES_NO" ? f.allowNa : false,
    photo: type === "PHOTO" ? (f.photo ?? { mode: "AT_LEAST_N", minCount: 1, maxCount: 10, geotagRequired: true }) : null,
    boundedByPlannedQuantity: type === "NUMBER" ? f.boundedByPlannedQuantity : false,
    rules: [],
    signal: null,
  };
}

const FACILITY_KINDS = VisitKindEnum.options.filter((k) => VISIT_KIND_META[k].facilityRule !== "NONE");

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

type ConditionMode = "equals" | "anyOf" | "atMost" | "atLeast";

function valuesFor(f: FormField): Array<{ value: string; label: string }> {
  if (f.type === "YES_NO") return [{ value: "YES", label: "Yes" }, { value: "NO", label: "No" }, ...(f.allowNa ? [{ value: "NA", label: "N/A" }] : [])];
  return f.options.map((o) => ({ value: o.key, label: o.label }));
}

function defaultCondition(f: FormField): FormCondition {
  if (FORM_NUMERIC_TYPES.includes(f.type)) return { atMost: f.type === "RATING_1_5" ? 2 : 0 };
  return { equals: valuesFor(f)[f.type === "YES_NO" ? 1 : 0]?.value ?? "NO" };
}

function ConditionEditor({ field, value, onChange }: { field: FormField; value: FormCondition; onChange: (c: FormCondition) => void }) {
  const numeric = FORM_NUMERIC_TYPES.includes(field.type);
  const mode: ConditionMode = "equals" in value ? "equals" : "anyOf" in value ? "anyOf" : "atMost" in value ? "atMost" : "atLeast";
  const values = valuesFor(field);
  const modes: Array<{ value: ConditionMode; label: string }> = numeric
    ? [
        { value: "atMost", label: "is at most" },
        { value: "atLeast", label: "is at least" },
      ]
    : [
        { value: "equals", label: "is" },
        { value: "anyOf", label: "is one of" },
      ];
  const setMode = (m: ConditionMode) =>
    onChange(m === "equals" ? { equals: values[0]?.value ?? "" } : m === "anyOf" ? { anyOf: values.slice(0, 1).map((v) => v.value) } : m === "atMost" ? { atMost: 0 } : { atLeast: 0 });
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-slate-500">When the answer</span>
      <select className={`${smallInput} !w-auto !py-1`} value={mode} onChange={(e) => setMode(e.target.value as ConditionMode)}>
        {modes.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      {"equals" in value && (
        <select className={`${smallInput} !w-auto !py-1`} value={value.equals} onChange={(e) => onChange({ equals: e.target.value })}>
          {values.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </select>
      )}
      {"anyOf" in value &&
        values.map((v) => (
          <label key={v.value} className="inline-flex items-center gap-1 text-[11px] text-slate-700">
            <input
              type="checkbox"
              checked={value.anyOf.includes(v.value)}
              onChange={(e) => {
                const next = e.target.checked ? [...value.anyOf, v.value] : value.anyOf.filter((x) => x !== v.value);
                onChange({ anyOf: next.length ? next : [v.value] });
              }}
            />
            {v.label}
          </label>
        ))}
      {"atMost" in value && (
        <input type="number" className={`${smallInput} !w-20 !py-1`} value={value.atMost} onChange={(e) => onChange({ atMost: Number(e.target.value) })} />
      )}
      {"atLeast" in value && (
        <>
          {value.atLeast !== "PLANNED" && (
            <input type="number" className={`${smallInput} !w-20 !py-1`} value={value.atLeast} onChange={(e) => onChange({ atLeast: Number(e.target.value) })} />
          )}
          {field.boundedByPlannedQuantity && (
            <label className="inline-flex items-center gap-1 text-[11px] text-slate-700">
              <input type="checkbox" checked={value.atLeast === "PLANNED"} onChange={(e) => onChange({ atLeast: e.target.checked ? "PLANNED" : 0 })} /> the planned quantity
            </label>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One field
// ---------------------------------------------------------------------------

function FieldSettings({ f, context, onChange }: { f: EditorField; context: "SECTION" | "SUBFORM"; onChange: (patch: Partial<EditorField>) => void }) {
  const sub = context === "SUBFORM";
  const choice = FORM_CHOICE_TYPES.includes(f.type);
  const capture = f.type === "PHOTO" || f.type === "VOICE_NOTE";
  const insert = (token: string) => onChange({ label: `${f.label}${f.label.endsWith(" ") || !f.label ? "" : " "}{${token}}` });
  const signalKinds = FormSignalKindEnum.options.filter((k) =>
    sub ? ["UNIT_COMPLETE", "PERCENT_COMPLETE", "QUANTITY_DELIVERED"].includes(k) : ["CONTRACTOR_ON_SITE", "OVERALL_FINDING"].includes(k)
  );
  const conditional = (k: FormSignalKind) => k === "UNIT_COMPLETE" || k === "CONTRACTOR_ON_SITE";
  const setRule = (i: number, patch: Partial<FormFieldRule>) => onChange({ rules: f.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  return (
    <div className="space-y-3 border-t border-slate-100 pt-3">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-slate-700 mb-1">Question</label>
          <input className={smallInput} value={f.label} maxLength={300} onChange={(e) => onChange({ label: e.target.value })} />
          {sub && (
            <div className="mt-1 flex flex-wrap gap-1">
              {FORM_PLACEHOLDERS.map((p) => (
                <button key={p} type="button" onClick={() => insert(p)} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 hover:bg-slate-200">
                  {`{${p}}`}
                </button>
              ))}
            </div>
          )}
        </div>
        <CustomSelect
          label="Type"
          value={f.type}
          size="sm"
          onChange={(v) => onChange(retype(f, v as FormFieldType))}
          options={FormFieldTypeEnum.options.map((t) => ({ value: t, label: FORM_FIELD_TYPE_LABELS[t] }))}
        />
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-slate-700 mb-1">Guidance (optional)</label>
        <input className={smallInput} value={f.guidance ?? ""} maxLength={1000} onChange={(e) => onChange({ guidance: e.target.value || null })} />
      </div>
      <div className="flex flex-wrap gap-4 text-[11px] text-slate-700">
        <span className="font-mono text-slate-500">key: {f.key}{f.isNew ? " (from the question)" : " (fixed)"}</span>
        {f.type !== "PHOTO" && (
          <label className="inline-flex items-center gap-1">
            <input type="checkbox" checked={f.required} onChange={(e) => onChange({ required: e.target.checked })} /> Required
          </label>
        )}
        {f.type === "YES_NO" && (
          <label className="inline-flex items-center gap-1">
            <input type="checkbox" checked={f.allowNa} onChange={(e) => onChange({ allowNa: e.target.checked })} /> Offer N/A
          </label>
        )}
        {sub && (
          <label className="inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={f.scope === "PER_UNIT"}
              onChange={(e) => onChange({ scope: e.target.checked ? "PER_UNIT" : "WHOLE_FACILITY" })}
            />{" "}
            Ask per unit (repeats for each unit)
          </label>
        )}
      </div>

      {choice && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-slate-700">Options</p>
          {f.options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className={smallInput}
                value={o.label}
                onChange={(e) =>
                  onChange({ options: f.options.map((x, j) => (j === i ? { label: e.target.value, key: x.key.startsWith("option-") ? slug(e.target.value) : x.key } : x)) })
                }
              />
              <span className="font-mono text-[10px] text-slate-400 w-28 truncate">{o.key}</span>
              <button type="button" className="text-slate-400 hover:text-rose-600" onClick={() => onChange({ options: f.options.filter((_, j) => j !== i) })} aria-label="Remove option">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-[11px] font-semibold text-brand-primary"
            onClick={() => onChange({ options: [...f.options, { key: `option-${f.options.length + 1}`, label: `Option ${f.options.length + 1}` }] })}
          >
            + Add option
          </button>
          {f.type === "MULTI_CHOICE" && (
            <div className="flex gap-3">
              <label className="text-[11px] text-slate-700">
                Pick at least{" "}
                <input type="number" min={0} className={`${smallInput} !w-16 !py-1`} value={f.minSelected ?? ""} onChange={(e) => onChange({ minSelected: e.target.value === "" ? null : Number(e.target.value) })} />
              </label>
              <label className="text-[11px] text-slate-700">
                at most{" "}
                <input type="number" min={1} className={`${smallInput} !w-16 !py-1`} value={f.maxSelected ?? ""} onChange={(e) => onChange({ maxSelected: e.target.value === "" ? null : Number(e.target.value) })} />
              </label>
            </div>
          )}
        </div>
      )}

      {f.type === "NUMBER" && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[11px] text-slate-700">
            Unit
            <input className={`${smallInput} !w-24`} value={f.unit ?? ""} maxLength={30} onChange={(e) => onChange({ unit: e.target.value || null })} />
          </label>
          <label className="text-[11px] text-slate-700">
            Min
            <input type="number" className={`${smallInput} !w-24`} value={f.min ?? ""} onChange={(e) => onChange({ min: e.target.value === "" ? null : Number(e.target.value) })} />
          </label>
          <label className="text-[11px] text-slate-700">
            Max
            <input type="number" className={`${smallInput} !w-24`} value={f.max ?? ""} onChange={(e) => onChange({ max: e.target.value === "" ? null : Number(e.target.value) })} />
          </label>
          {sub && (
            <label className="inline-flex items-center gap-1 text-[11px] text-slate-700 pb-2">
              <input type="checkbox" checked={f.boundedByPlannedQuantity} onChange={(e) => onChange({ boundedByPlannedQuantity: e.target.checked })} /> Bounded by the planned
              quantity (above it needs a comment)
            </label>
          )}
        </div>
      )}

      {f.type === "PHOTO" && f.photo && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-52">
            <CustomSelect
              label="Photos"
              size="sm"
              value={f.photo.mode}
              onChange={(v) => onChange({ photo: { ...f.photo!, mode: v as PhotoMode } })}
              options={PhotoModeEnum.options.filter((m) => sub || m === "AT_LEAST_N").map((m) => ({ value: m, label: PHOTO_MODE_LABELS[m] }))}
            />
          </div>
          {f.photo.mode === "AT_LEAST_N" && (
            <label className="text-[11px] text-slate-700">
              At least
              <input type="number" min={0} max={20} className={`${smallInput} !w-16`} value={f.photo.minCount} onChange={(e) => onChange({ photo: { ...f.photo!, minCount: Number(e.target.value) } })} />
            </label>
          )}
          <label className="text-[11px] text-slate-700">
            At most{f.photo.mode === "AT_LEAST_N" ? "" : " per unit"}
            <input type="number" min={1} max={20} className={`${smallInput} !w-16`} value={f.photo.maxCount} onChange={(e) => onChange({ photo: { ...f.photo!, maxCount: Number(e.target.value) } })} />
          </label>
          <label className="inline-flex items-center gap-1 text-[11px] text-slate-700 pb-2">
            <input type="checkbox" checked={f.photo.geotagRequired} onChange={(e) => onChange({ photo: { ...f.photo!, geotagRequired: e.target.checked } })} /> Geotag required
          </label>
        </div>
      )}

      {sub && (
        <div>
          <p className="text-[11px] font-semibold text-slate-700 mb-1">Asked on</p>
          <div className="flex flex-wrap gap-3">
            {FACILITY_KINDS.map((k) => {
              const all = f.visitKinds === null;
              const checked = all || f.visitKinds!.includes(k);
              return (
                <label key={k} className="inline-flex items-center gap-1 text-[11px] text-slate-700">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const current = all ? [...FACILITY_KINDS] : [...f.visitKinds!];
                      const next = e.target.checked ? [...current, k] : current.filter((x) => x !== k);
                      onChange({ visitKinds: next.length === FACILITY_KINDS.length ? null : next.length ? (next as VisitKind[]) : [k] });
                    }}
                  />
                  {VISIT_KIND_META[k].label}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {!capture && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-slate-700">Rules</p>
          {f.rules.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-50 p-2">
              <ConditionEditor field={f} value={r.when} onChange={(when) => setRule(i, { when })} />
              <span className="text-[11px] text-slate-500">then</span>
              <select
                className={`${smallInput} !w-auto !py-1`}
                value={r.then}
                onChange={(e) => setRule(i, { then: e.target.value as FormFieldRule["then"], severity: e.target.value === "RAISE_FINDING" ? (r.severity ?? "MAJOR") : null })}
              >
                <option value="REQUIRE_PHOTO">require a photo</option>
                <option value="REQUIRE_COMMENT">require a comment</option>
                <option value="RAISE_FINDING">raise a finding</option>
              </select>
              {r.then === "RAISE_FINDING" && (
                <select className={`${smallInput} !w-auto !py-1`} value={r.severity ?? "MAJOR"} onChange={(e) => setRule(i, { severity: e.target.value as FormFieldRule["severity"] })}>
                  <option value="MINOR">Minor</option>
                  <option value="MAJOR">Major</option>
                  <option value="CRITICAL">Critical</option>
                </select>
              )}
              <button type="button" className="ml-auto text-slate-400 hover:text-rose-600" onClick={() => onChange({ rules: f.rules.filter((_, j) => j !== i) })} aria-label="Remove rule">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {f.rules.length < FORM_MAX_RULES_PER_FIELD && (
            <button
              type="button"
              className="text-[11px] font-semibold text-brand-primary"
              onClick={() => onChange({ rules: [...f.rules, { when: defaultCondition(f), then: "REQUIRE_COMMENT", severity: null }] })}
            >
              + Add rule
            </button>
          )}
        </div>
      )}

      {!capture && signalKinds.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-semibold text-slate-700">Signal</p>
            <select
              className={`${smallInput} !w-auto !py-1`}
              value={f.signal?.kind ?? ""}
              onChange={(e) => {
                const kind = e.target.value as FormSignalKind | "";
                onChange({ signal: kind ? { kind, when: conditional(kind) ? defaultCondition(f) : null } : null });
              }}
            >
              <option value="">None</option>
              {signalKinds.map((k) => (
                <option key={k} value={k}>
                  {FORM_SIGNAL_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          {f.signal?.when && <ConditionEditor field={f} value={f.signal.when} onChange={(when) => onChange({ signal: { ...f.signal!, when } })} />}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview over sample units
// ---------------------------------------------------------------------------

const SAMPLE_IDS = Array.from({ length: 8 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);

function SamplePreview({ fields, context, facility }: { fields: FormField[]; context: "SECTION" | "SUBFORM"; facility: { name: string; pluralName?: string | null; archetype: FacilityArchetype } }) {
  const [kind, setKind] = useState<VisitKind>("ROUTINE");
  const result = useMemo(() => {
    try {
      const supply = facility.archetype === "SUPPLY_INSTALLATION";
      const units = (supply ? [{ label: `${facility.name}: classroom set`, qty: 120 }] : [
        { label: `Ground floor male ${facility.name.toLowerCase()}`, qty: null },
        { label: `Ground floor female ${facility.name.toLowerCase()}`, qty: null },
        { label: `Teachers' lounge ${facility.name.toLowerCase()}`, qty: null },
      ]).map((u, i) => ({
        id: SAMPLE_IDS[i + 3],
        code: `U0${i + 1}`,
        label: u.label,
        facilityId: SAMPLE_IDS[1],
        plannedQuantity: u.qty,
        quantityUnit: u.qty ? "nr" : null,
        startSprintNumber: 1,
        endSprintNumber: 1,
        sortOrder: i,
      }));
      const visitKind: VisitKind = context === "SECTION" ? "AD_HOC" : kind;
      return assembleVisitForm({
        projectId: SAMPLE_IDS[0],
        visitKind,
        visitDate: "2026-01-15",
        builtAt: "preview",
        template: {
          id: SAMPLE_IDS[2],
          code: "PREVIEW",
          version: 1,
          name: "Preview",
          visitKind,
          blocks: context === "SECTION" ? [{ type: "SECTION", sectionCode: "PREVIEW" }] : [{ type: "FACILITIES" }],
        },
        sections: context === "SECTION" ? [{ id: SAMPLE_IDS[7], code: "PREVIEW", version: 1, title: "Preview", description: null, fields }] : [],
        subForms: context === "SUBFORM" ? [{ id: SAMPLE_IDS[6], subjectKey: "PREVIEW", version: 1, fields }] : [],
        facilities: [{ id: SAMPLE_IDS[1], code: "PREVIEW", name: facility.name, pluralName: facility.pluralName ?? null, archetype: facility.archetype, sortOrder: 0, subFormId: SAMPLE_IDS[6] }],
        units,
        sprints: [{ id: SAMPLE_IDS[2], number: 1, name: "Sprint 1", startDate: "2026-01-01", endDate: "2026-01-31", deliverables: "" }],
        pickedFacilityIds: [SAMPLE_IDS[1]],
      }).snapshot;
    } catch {
      return null;
    }
  }, [fields, context, facility, kind]);
  return (
    <div className="space-y-2">
      {context === "SUBFORM" && (
        <div className="flex flex-wrap gap-1.5">
          {FACILITY_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${kind === k ? "bg-brand-primary text-white" : "bg-slate-100 text-slate-600"}`}
            >
              {VISIT_KIND_META[k].label}
            </button>
          ))}
        </div>
      )}
      {result ? <FormSnapshotView snapshot={result} showHeader={false} /> : <p className="text-[11px] text-slate-500">Fix the issues to see a preview.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export function FormFieldsEditor({
  fields,
  onChange,
  context,
  previewFacility,
}: {
  fields: EditorField[];
  onChange: (fields: EditorField[]) => void;
  context: "SECTION" | "SUBFORM";
  /** Sub-forms: the facility (or archetype) the preview uses. */
  previewFacility?: { name: string; pluralName?: string | null; archetype: FacilityArchetype };
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const plain = useMemo(() => fromEditorFields(fields), [fields]);
  const issues = useMemo(() => validateFormFields(plain, { context }), [plain, context]);
  const set = (next: EditorField[]) => onChange(withDerivedKeys(next));
  const update = (uid: string, patch: Partial<EditorField>) => set(fields.map((f) => (f.uid === uid ? { ...f, ...patch } : f)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...fields];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    set(next);
  };

  return (
    <div className="space-y-2">
      {context === "SUBFORM" && fields.length > FORM_SUBFORM_SOFT_FIELD_LIMIT && (
        <p className="text-[11px] text-amber-700">
          {fields.length} questions: sub-forms work best with 1–3 per visit kind, because each repeats for every facility in the visit.
        </p>
      )}
      {fields.map((f, i) => {
        const fieldIssues = issues.filter((x) => x.index === i);
        const expanded = open === f.uid;
        return (
          <div key={f.uid} className={`rounded-xl border p-3 ${fieldIssues.length ? "border-rose-300" : "border-slate-200"}`}>
            <div className="flex items-center gap-2">
              <button type="button" className="flex-1 text-left" onClick={() => setOpen(expanded ? null : f.uid)}>
                <p className="text-xs font-semibold text-slate-900">
                  {i + 1}. {f.label || "Untitled question"}
                </p>
                <p className="text-[10px] text-slate-500">
                  {FORM_FIELD_TYPE_LABELS[f.type]}
                  {f.scope === "PER_UNIT" ? " · per unit" : ""}
                  {f.photo ? ` · ${PHOTO_MODE_LABELS[f.photo.mode].toLowerCase()}` : ""}
                  {f.rules.length ? ` · ${f.rules.length} rule${f.rules.length > 1 ? "s" : ""}` : ""}
                  {f.signal ? ` · ${FORM_SIGNAL_LABELS[f.signal.kind].toLowerCase()}` : ""}
                  {f.visitKinds ? ` · ${f.visitKinds.map((k) => VISIT_KIND_META[k].label).join(", ")}` : ""}
                </p>
              </button>
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" aria-label="Move up">
                <ChevronUp className="w-4 h-4" />
              </button>
              <button type="button" disabled={i === fields.length - 1} onClick={() => move(i, 1)} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" aria-label="Move down">
                <ChevronDown className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => set(fields.filter((x) => x.uid !== f.uid))} className="p-1 text-slate-400 hover:text-rose-600" aria-label="Remove question">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            {fieldIssues.map((x, j) => (
              <p key={j} className="mt-1 text-[11px] text-rose-600">
                {x.message}
              </p>
            ))}
            {expanded && <FieldSettings f={f} context={context} onChange={(patch) => update(f.uid, patch)} />}
          </div>
        );
      })}
      <div className="flex items-center gap-3">
        {fields.length < FORM_MAX_FIELDS_PER_COMPONENT && (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-primary"
            onClick={() => {
              const f = newField();
              set([...fields, f]);
              setOpen(f.uid);
            }}
          >
            <Plus className="w-3.5 h-3.5" /> Add question
          </button>
        )}
        <button type="button" className="ml-auto text-xs font-semibold text-slate-600" onClick={() => setShowPreview((v) => !v)}>
          {showPreview ? "Hide preview" : "Show preview"}
        </button>
      </div>
      {showPreview && (
        <div className="rounded-xl bg-slate-50 p-3">
          <SamplePreview fields={plain} context={context} facility={previewFacility ?? { name: "Toilet", archetype: "BUILDING_WORKS" }} />
        </div>
      )}
    </div>
  );
}

/** Whether the fields pass the shared checks (and the schema) and can be saved. */
export function fieldsAreValid(fields: EditorField[], context: "SECTION" | "SUBFORM"): boolean {
  const plain = fromEditorFields(fields);
  return plain.length > 0 && validateFormFields(plain, { context }).length === 0 && plain.every((f) => FormFieldSchema.safeParse(f).success);
}
