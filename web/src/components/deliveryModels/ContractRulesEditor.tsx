import React, { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import {
  APPROVAL_ORGANIZATION_SCOPE_META,
  CONTRACT_MILESTONE_ANCHOR_META,
  ContractMilestoneAnchorEnum,
  describeMilestoneAnchor,
  KICKOFF_STAKEHOLDER_GROUP_META,
  KickoffStakeholderGroupEnum,
  MILESTONE_COMPLETION_MODE_META,
  MilestoneCompletionModeEnum,
  MilestoneResponsibleScopeEnum,
  SYSTEM_PERMISSIONS_CATALOG,
  type ContractMilestoneAnchor,
  type ContractMilestoneTemplateInput,
  type KickoffStakeholderGroup,
  type MilestoneCompletionMode,
  type MilestoneOffsetUnit,
  type MilestoneResponsibleScope,
} from "@insite/shared";
import { CustomSelect } from "../common";
import { useDocumentTypesQuery } from "../../queries/contracts/useContractQueries";
import { useTenantRolesQuery } from "../../queries/rbac/useRbacQueries";

/**
 * Phase 13: the contract milestones and kick-off rules of a project type. Milestones are dated
 * obligations created on each new project of the type, counted from its contract dates, kick-off,
 * activation or another milestone. Saving the type writes a new version: projects already created
 * keep the milestones of the version they were created with.
 */

export interface ContractRules {
  milestones: ContractMilestoneTemplateInput[];
  kickoff: { requiredStakeholderGroups: KickoffStakeholderGroup[]; noticeLeadDays: number };
}

const inputCls =
  "w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-brand-primary";
const sectionCls = "rounded-2xl border border-slate-200 bg-white p-4 space-y-3";
const iconButton = "rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-800 disabled:opacity-30";

const SCOPE_LABELS: Record<MilestoneResponsibleScope, string> = {
  ...Object.fromEntries(Object.entries(APPROVAL_ORGANIZATION_SCOPE_META).map(([k, v]) => [k, v.label])),
  MONITOR: "Monitor organisation",
  CONTRACTOR: "The contractor",
} as Record<MilestoneResponsibleScope, string>;

/** "Kick-off held" → "kickoff-held", unique among `taken`. */
function keyFromLabel(label: string, taken: string[]): string {
  let base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (!/^[a-z]/.test(base)) base = `m-${base}`;
  if (base.length < 2) base = "milestone";
  let key = base;
  for (let n = 2; taken.includes(key); n += 1) key = `${base}-${n}`;
  return key;
}

function newMilestone(taken: string[]): ContractMilestoneTemplateInput {
  return {
    key: keyFromLabel("milestone", taken),
    label: "",
    anchor: "KICKOFF",
    anchorMilestoneKey: null,
    offsetValue: 0,
    offsetUnit: "CALENDAR_DAYS",
    completionMode: "MANUAL",
    requiredDocumentTypeCodes: [],
    signOffPermissionKey: null,
    responsibleRoleCode: null,
    responsibleScope: "ANY",
    perContractor: false,
  };
}

export function ContractRulesEditor({ value, onChange }: { value: ContractRules; onChange: (next: ContractRules) => void }) {
  const { data: docTypes = [] } = useDocumentTypesQuery(false);
  const { data: roles = [] } = useTenantRolesQuery();
  // Keys follow the label until someone edits the key (per row index of this editing session).
  const [keyTouched, setKeyTouched] = useState<Set<number>>(new Set(value.milestones.map((_, i) => i)));

  const milestones = value.milestones;
  const setMilestones = (next: ContractMilestoneTemplateInput[]) => onChange({ ...value, milestones: next });
  const update = (index: number, patch: Partial<ContractMilestoneTemplateInput>) =>
    setMilestones(milestones.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  const move = (index: number, by: number) => {
    const next = [...milestones];
    const [row] = next.splice(index, 1);
    next.splice(index + by, 0, row);
    setMilestones(next);
    setKeyTouched(new Set(next.map((_, i) => i)));
  };
  const remove = (index: number) => {
    const removed = milestones[index].key;
    // Milestones that counted from the removed one fall back to the kick-off.
    setMilestones(
      milestones
        .filter((_, i) => i !== index)
        .map((m) => (m.anchor === "MILESTONE" && m.anchorMilestoneKey === removed ? { ...m, anchor: "KICKOFF", anchorMilestoneKey: null } : m))
    );
    setKeyTouched(new Set(milestones.slice(0, -1).map((_, i) => i)));
  };

  const docOptions = useMemo(() => docTypes.map((t) => ({ value: t.code, label: t.name, description: t.code })), [docTypes]);
  const roleOptions = useMemo(() => [{ value: "", label: "No specific role" }, ...roles.map((r) => ({ value: r.code, label: r.name, description: r.code }))], [roles]);
  const permissionOptions = useMemo(
    () => [{ value: "", label: "Anyone who can view it" }, ...SYSTEM_PERMISSIONS_CATALOG.map((p) => ({ value: p.key, label: p.name, description: p.key }))],
    []
  );
  const labelOf = (key: string) => milestones.find((m) => m.key === key)?.label || key;

  return (
    <>
      <section className={sectionCls} aria-label="Contract milestones">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Contract milestones</h3>
            <p className="text-[11px] text-slate-500">
              Dated obligations created on every new project of this type. Each counts from a project date (contract award, contract
              signed, kick-off, activation) or from another milestone being done. A negative number of days is before the date.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            onClick={() => setMilestones([...milestones, newMilestone(milestones.map((m) => m.key))])}
          >
            <Plus className="w-3.5 h-3.5" /> Add milestone
          </button>
        </div>
        {milestones.length === 0 && <p className="text-xs text-slate-500">No contract milestones. Projects of this type will have none.</p>}
        <ol className="space-y-3">
          {milestones.map((m, i) => {
            const mode = (m.completionMode ?? "MANUAL") as MilestoneCompletionMode;
            const anchor = m.anchor as ContractMilestoneAnchor;
            const otherKeys = milestones.filter((_, j) => j !== i).map((x) => x.key);
            return (
              <li key={i} className="rounded-xl border border-slate-200 p-3 space-y-3">
                <div className="flex flex-wrap items-start gap-2">
                  <span className="mt-2 text-[11px] font-bold text-slate-500 tabular-nums w-5">{i + 1}.</span>
                  <label className="flex-1 min-w-[14rem] text-xs font-medium text-slate-700">
                    Label
                    <input
                      className={inputCls}
                      value={m.label}
                      maxLength={160}
                      placeholder="e.g. Mobilised to site"
                      onChange={(e) =>
                        update(i, { label: e.target.value, ...(keyTouched.has(i) ? {} : { key: keyFromLabel(e.target.value, otherKeys) }) })
                      }
                    />
                  </label>
                  <label className="w-52 text-xs font-medium text-slate-700">
                    Key
                    <input
                      className={`${inputCls} font-mono`}
                      value={m.key}
                      maxLength={48}
                      title="Lower-case letters, digits and dashes. Payment milestones and other milestones refer to it."
                      onChange={(e) => {
                        setKeyTouched(new Set([...keyTouched, i]));
                        const next = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
                        // Keep references from other milestones in step with the key.
                        setMilestones(
                          milestones.map((x, j) =>
                            j === i ? { ...x, key: next } : x.anchorMilestoneKey === m.key ? { ...x, anchorMilestoneKey: next } : x
                          )
                        );
                      }}
                    />
                  </label>
                  <div className="mt-5 flex gap-1">
                    <button type="button" className={iconButton} aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" className={iconButton} aria-label="Move down" disabled={i === milestones.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" className={iconButton} aria-label={`Remove ${m.label || m.key}`} onClick={() => remove(i)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <p className="text-xs font-medium text-slate-700 mb-1">Counted from</p>
                    <CustomSelect
                      value={anchor}
                      onChange={(v) => update(i, { anchor: v as ContractMilestoneAnchor, anchorMilestoneKey: v === "MILESTONE" ? otherKeys[0] ?? null : null })}
                      options={ContractMilestoneAnchorEnum.options
                        .filter((a) => a !== "MILESTONE" || otherKeys.length > 0)
                        .map((a) => ({ value: a, label: CONTRACT_MILESTONE_ANCHOR_META[a].label }))}
                    />
                  </div>
                  {anchor === "MILESTONE" && (
                    <div>
                      <p className="text-xs font-medium text-slate-700 mb-1">Milestone</p>
                      <CustomSelect
                        value={m.anchorMilestoneKey ?? ""}
                        onChange={(v) => update(i, { anchorMilestoneKey: v || null })}
                        options={otherKeys.map((k) => ({ value: k, label: labelOf(k), description: k }))}
                        placeholder="Choose"
                      />
                    </div>
                  )}
                  <label className="text-xs font-medium text-slate-700">
                    Days (− before, + after)
                    <input
                      type="number"
                      min={-365}
                      max={730}
                      className={inputCls}
                      value={m.offsetValue}
                      onChange={(e) => update(i, { offsetValue: Math.trunc(Number(e.target.value) || 0) })}
                    />
                  </label>
                  <div>
                    <p className="text-xs font-medium text-slate-700 mb-1">Counting</p>
                    <CustomSelect
                      value={(m.offsetUnit ?? "CALENDAR_DAYS") as MilestoneOffsetUnit}
                      onChange={(v) => update(i, { offsetUnit: v as MilestoneOffsetUnit })}
                      options={[
                        { value: "CALENDAR_DAYS", label: "Calendar days" },
                        { value: "WORKING_DAYS", label: "Working days", description: "The project's work-week" },
                      ]}
                    />
                  </div>
                </div>
                <p className="text-[11px] text-slate-500">
                  Due: {describeMilestoneAnchor({ anchor, anchorMilestoneKey: m.anchorMilestoneKey ?? null, offsetValue: m.offsetValue, offsetUnit: (m.offsetUnit ?? "CALENDAR_DAYS") as MilestoneOffsetUnit }, labelOf)}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs font-medium text-slate-700 mb-1">Done when</p>
                    <CustomSelect
                      value={mode}
                      onChange={(v) => update(i, { completionMode: v as MilestoneCompletionMode })}
                      options={MilestoneCompletionModeEnum.options.map((o) => ({
                        value: o,
                        label: MILESTONE_COMPLETION_MODE_META[o].label,
                        description: MILESTONE_COMPLETION_MODE_META[o].description,
                      }))}
                    />
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-start gap-2 text-xs text-slate-700">
                      <input type="checkbox" className="mt-0.5" checked={Boolean(m.perContractor)} onChange={(e) => update(i, { perContractor: e.target.checked })} />
                      <span>
                        <span className="font-medium">One per contractor</span>
                        <span className="block text-[11px] text-slate-500">e.g. mobilisation: each contractor has its own milestone and deadline.</span>
                      </span>
                    </label>
                  </div>
                </div>

                {mode === "MANUAL" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs font-medium text-slate-700 mb-1">Documents needed to complete it</p>
                      <div className="flex flex-wrap gap-1 mb-1">
                        {(m.requiredDocumentTypeCodes ?? []).map((code) => (
                          <span key={code} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 pl-2 pr-1 py-0.5 text-[10px] text-slate-700">
                            {docTypes.find((t) => t.code === code)?.name ?? code}
                            <button
                              type="button"
                              className="rounded-full px-1 hover:bg-slate-200"
                              aria-label={`Remove ${code}`}
                              onClick={() => update(i, { requiredDocumentTypeCodes: (m.requiredDocumentTypeCodes ?? []).filter((c) => c !== code) })}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                      <CustomSelect
                        value=""
                        onChange={(v) => v && update(i, { requiredDocumentTypeCodes: [...(m.requiredDocumentTypeCodes ?? []), v] })}
                        options={docOptions.filter((o) => !(m.requiredDocumentTypeCodes ?? []).includes(o.value))}
                        placeholder="Add a document type…"
                        searchable
                        size="sm"
                      />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-slate-700 mb-1">Signed off by a holder of</p>
                      <CustomSelect
                        value={m.signOffPermissionKey ?? ""}
                        onChange={(v) => update(i, { signOffPermissionKey: v || null })}
                        options={permissionOptions}
                        searchable
                      />
                      <p className="mt-1 text-[11px] text-slate-500">Document types that need a sign-off always need one; this names who must give it.</p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs font-medium text-slate-700 mb-1">Responsible role (notified)</p>
                    <CustomSelect value={m.responsibleRoleCode ?? ""} onChange={(v) => update(i, { responsibleRoleCode: v || null })} options={roleOptions} searchable />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-700 mb-1">Within</p>
                    <CustomSelect
                      value={(m.responsibleScope ?? "ANY") as MilestoneResponsibleScope}
                      onChange={(v) => update(i, { responsibleScope: v as MilestoneResponsibleScope })}
                      options={MilestoneResponsibleScopeEnum.options.map((s) => ({ value: s, label: SCOPE_LABELS[s] }))}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section className={sectionCls} aria-label="Kick-off rules">
        <h3 className="text-sm font-bold text-slate-900">Kick-off meeting</h3>
        <p className="text-[11px] text-slate-500">
          Quorum: at least one attendee from each group ticked here. Holding the kick-off without quorum needs a recorded waiver.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {KickoffStakeholderGroupEnum.options.map((g) => {
            const checked = value.kickoff.requiredStakeholderGroups.includes(g);
            return (
              <label key={g} className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      kickoff: {
                        ...value.kickoff,
                        requiredStakeholderGroups: e.target.checked
                          ? [...value.kickoff.requiredStakeholderGroups, g]
                          : value.kickoff.requiredStakeholderGroups.filter((x) => x !== g),
                      },
                    })
                  }
                />
                {KICKOFF_STAKEHOLDER_GROUP_META[g].label}
              </label>
            );
          })}
        </div>
        <label className="block max-w-xs text-xs font-medium text-slate-700">
          Notice sent at least (days before the meeting)
          <input
            type="number"
            min={0}
            max={60}
            className={inputCls}
            value={value.kickoff.noticeLeadDays}
            onChange={(e) => onChange({ ...value, kickoff: { ...value.kickoff, noticeLeadDays: Math.max(0, Math.min(60, Math.trunc(Number(e.target.value) || 0))) } })}
          />
        </label>
      </section>
    </>
  );
}
