import React from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  DEFAULT_VISIT_PLAN,
  VISIT_KIND_META,
  VISIT_PLAN_RULE_KIND_LABELS,
  VisitKindEnum,
  VisitPlanRuleKindEnum,
  type ProjectTypeMonitoringConfigInput,
  type VisitKind,
  type VisitPlanRuleInput,
  type VisitPlanRuleKind,
} from "@insite/shared";
import { CustomSelect } from "../common";

/**
 * Redesign R4 (D-R4.10, D-R4.11): the type's `monitoring` key. The visit plan proposes a project's
 * visits on activation (and on the completion notice and closing); the numbers set the submission
 * deadline, reminders, finding escalation, warnings and the sprint verification period. Projects
 * keep the version they were created with.
 */

const inputCls = "w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-brand-primary";
const sectionCls = "rounded-2xl border border-slate-200 bg-white p-4 space-y-3";
const label = "text-xs font-medium text-slate-700 mb-1 block";

const NUMBERS: Array<{ key: keyof ProjectTypeMonitoringConfigInput; label: string; hint: string; fallback: number }> = [
  { key: "submissionDeadlineDays", label: "Submit within (days)", hint: "Calendar days after the visit date.", fallback: 7 },
  { key: "unconfirmedReminderDays", label: "Remind unconfirmed (days before)", hint: "Officers who have not confirmed get a reminder.", fallback: 2 },
  { key: "findingEscalationDays", label: "Escalate findings after (days)", hint: "Open findings are escalated once.", fallback: 14 },
  { key: "noVisitWarningWeeks", label: "Warn after no visit for (weeks)", hint: "Planner warning only.", fallback: 4 },
  { key: "sprintVerificationDays", label: "Verify sprints within (days)", hint: "After a sprint ends; late after that.", fallback: 7 },
];

function ruleKey(kind: VisitKind, taken: string[]): string {
  const base = kind.toLowerCase().replace(/_/g, "-").slice(0, 28);
  let key = base;
  for (let n = 2; taken.includes(key); n += 1) key = `${base}-${n}`;
  return key;
}

export function MonitoringPlanEditor({ value, onChange }: { value: ProjectTypeMonitoringConfigInput; onChange: (next: ProjectTypeMonitoringConfigInput) => void }) {
  const rules = value.visitPlan ?? [];
  const setRule = (i: number, patch: Partial<VisitPlanRuleInput>) => onChange({ ...value, visitPlan: rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const num = (v: string) => (v.trim() === "" ? undefined : Math.round(Number(v)));
  return (
    <section className={sectionCls}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Visit plan and deadlines</h3>
          <p className="text-[11px] text-slate-500">
            Activation proposes these visits; the M&amp;E manager assigns officers and publishes them. Final and post-closure evaluations are proposed on the completion notice and on closing.
          </p>
        </div>
        {rules.length === 0 && (
          <button type="button" className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700" onClick={() => onChange({ ...value, visitPlan: [...DEFAULT_VISIT_PLAN] })}>
            Use the default plan
          </button>
        )}
      </div>

      <div className="space-y-2">
        {rules.map((r, i) => (
          <div key={i} className="rounded-xl border border-slate-200 p-3 grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
            <div className="md:col-span-2">
              <span className={label}>Visit kind</span>
              <CustomSelect value={r.visitKind} onChange={(v) => setRule(i, { visitKind: v as VisitKind })} options={VisitKindEnum.options.map((k) => ({ value: k, label: VISIT_KIND_META[k].label }))} />
            </div>
            <div className="md:col-span-2">
              <span className={label}>When</span>
              <CustomSelect value={r.kind} onChange={(v) => setRule(i, { kind: v as VisitPlanRuleKind })} options={VisitPlanRuleKindEnum.options.map((k) => ({ value: k, label: VISIT_PLAN_RULE_KIND_LABELS[k] }))} />
            </div>
            <label>
              <span className={label}>Key</span>
              <input className={inputCls} value={r.key} onChange={(e) => setRule(i, { key: e.target.value.trim().toLowerCase() })} />
            </label>
            <div className="flex justify-end">
              <button type="button" aria-label="Remove rule" className="p-2 text-slate-400 hover:text-rose-600" onClick={() => onChange({ ...value, visitPlan: rules.filter((_, j) => j !== i) })}>
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            {r.kind.startsWith("EVERY_N_WEEKS") && (
              <label>
                <span className={label}>Every (weeks)</span>
                <input className={inputCls} inputMode="numeric" value={r.intervalWeeks ?? 2} onChange={(e) => setRule(i, { intervalWeeks: num(e.target.value) ?? 2 })} />
              </label>
            )}
            {r.kind === "EVERY_N_WEEKS_IN_SPRINTS" && (
              <label className="md:col-span-2">
                <span className={label}>Sprint numbers (empty = all)</span>
                <input
                  className={inputCls}
                  value={(r.sprintNumbers ?? []).join(", ")}
                  onChange={(e) =>
                    setRule(i, {
                      sprintNumbers: e.target.value
                        .split(",")
                        .map((x) => Number(x.trim()))
                        .filter((n) => Number.isInteger(n) && n > 0),
                    })
                  }
                />
              </label>
            )}
            {(r.kind === "ONCE_AFTER_START" || r.kind === "ON_COMPLETION_NOTICE" || r.kind === "QUARTERLY") && (
              <label>
                <span className={label}>Working days after</span>
                <input className={inputCls} inputMode="numeric" value={r.offsetWorkdays ?? 5} onChange={(e) => setRule(i, { offsetWorkdays: num(e.target.value) ?? 0 })} />
              </label>
            )}
            {r.kind === "QUARTERLY" && (
              <label>
                <span className={label}>First quarter starts (month 1–12)</span>
                <input className={inputCls} inputMode="numeric" value={r.quarterAnchorMonth ?? 1} onChange={(e) => setRule(i, { quarterAnchorMonth: num(e.target.value) ?? 1 })} />
              </label>
            )}
            {r.kind === "AFTER_PROJECT_CLOSED" && (
              <label className="md:col-span-2">
                <span className={label}>Days after closing (when no evaluation milestone is dated)</span>
                <input className={inputCls} inputMode="numeric" value={r.offsetDays ?? 90} onChange={(e) => setRule(i, { offsetDays: num(e.target.value) ?? 0 })} />
              </label>
            )}
          </div>
        ))}
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-primary hover:underline"
          onClick={() =>
            onChange({
              ...value,
              visitPlan: [...rules, { key: ruleKey("ROUTINE", rules.map((r) => r.key)), visitKind: "ROUTINE", kind: "EVERY_N_WEEKS_DURING_CONSTRUCTION", intervalWeeks: 2 }],
            })
          }
        >
          <Plus className="w-3.5 h-3.5" /> Add a plan rule
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {NUMBERS.map((n) => (
          <label key={n.key}>
            <span className={label}>{n.label}</span>
            <input
              className={inputCls}
              inputMode="numeric"
              value={String((value[n.key] as number | undefined) ?? n.fallback)}
              onChange={(e) => onChange({ ...value, [n.key]: num(e.target.value) ?? n.fallback })}
            />
            <span className="text-[10px] text-slate-500">{n.hint}</span>
          </label>
        ))}
      </div>
      <label className="inline-flex items-center gap-2 text-xs text-slate-700">
        <input type="checkbox" checked={value.emailContractorFindingsSummary ?? true} onChange={(e) => onChange({ ...value, emailContractorFindingsSummary: e.target.checked })} />
        Email the contractor the open findings after each accepted visit
      </label>
    </section>
  );
}
