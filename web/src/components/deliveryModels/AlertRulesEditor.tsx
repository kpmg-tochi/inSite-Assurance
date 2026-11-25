import React from "react";
import { DEFAULT_PROJECT_ALERTS_CONFIG, PROJECT_ALERT_META, type ProjectAlertsConfigInput } from "@insite/shared";

/**
 * UBEC IRL: the type's `monitoring.alerts` (early-warning alerts). One switch per alert and its
 * threshold. The `project-alerts` job reads them from each project's type snapshot, so projects keep
 * the thresholds of the type version they were created with.
 */

const inputCls = "w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-brand-primary disabled:bg-slate-50 disabled:text-slate-400";
const label = "text-xs font-medium text-slate-700 mb-1 block";

type AlertSection = "delayed" | "stalled" | "siteUpdateOverdue" | "spendAheadOfProgress";

const ROWS: Array<{
  section: AlertSection;
  alert: keyof typeof PROJECT_ALERT_META;
  rule: string;
  threshold?: { field: "days" | "percentagePoints"; label: string; min: number; max: number };
  recipients: string;
}> = [
  {
    section: "delayed",
    alert: "DELAYED",
    rule: "The schedule badge is Behind: a facility unit due by a work phase that has ended is not complete (execution and handover).",
    recipients: "Users who see work phase status.",
  },
  {
    section: "stalled",
    alert: "STALLED",
    rule: "In execution, no accepted visit has raised a unit's progress for this many days since the first work phase started.",
    threshold: { field: "days", label: "Days without progress", min: 7, max: 365 },
    recipients: "Users who receive escalations, and the project's field officers (phone).",
  },
  {
    section: "siteUpdateOverdue",
    alert: "SITE_UPDATE_OVERDUE",
    rule: "In mobilisation or execution, no visit has been accepted for this many days (from activation until the first).",
    threshold: { field: "days", label: "Days without an accepted visit", min: 3, max: 180 },
    recipients: "Users who plan visits, and the project's field officers (phone).",
  },
  {
    section: "spendAheadOfProgress",
    alert: "SPEND_AHEAD_OF_PROGRESS",
    rule: "Net paid as a % of the contract sum is ahead of % complete by more than this many points (needs a contract sum and a recorded payment).",
    threshold: { field: "percentagePoints", label: "Percentage points ahead", min: 1, max: 100 },
    recipients: "Users who see payments.",
  },
];

export function AlertRulesEditor({ value, onChange }: { value: ProjectAlertsConfigInput | undefined; onChange: (next: ProjectAlertsConfigInput) => void }) {
  const current = value ?? {};
  const set = (section: AlertSection, patch: Record<string, unknown>) => onChange({ ...current, [section]: { ...(current[section] ?? {}), ...patch } });
  return (
    <div className="space-y-2">
      <div>
        <h4 className="text-xs font-bold text-slate-900">Early-warning alerts</h4>
        <p className="text-[11px] text-slate-500">
          Checked once a day. Each alert is sent once when it starts (web notification; field alerts also reach the phone) and shows on the project until the condition clears. Days are calendar days.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {ROWS.map((row) => {
          const section = (current[row.section] ?? {}) as { enabled?: boolean; days?: number; percentagePoints?: number };
          const defaults = DEFAULT_PROJECT_ALERTS_CONFIG[row.section] as { enabled: boolean; days?: number; percentagePoints?: number };
          const enabled = section.enabled ?? defaults.enabled;
          const id = `alert-${row.section}`;
          return (
            <div key={row.section} className="rounded-xl border border-slate-200 p-3 space-y-2">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800" htmlFor={`${id}-enabled`}>
                <input id={`${id}-enabled`} type="checkbox" checked={enabled} onChange={(e) => set(row.section, { enabled: e.target.checked })} />
                {PROJECT_ALERT_META[row.alert].label}
              </label>
              <p className="text-[11px] text-slate-600">{row.rule}</p>
              {row.threshold && (
                <label htmlFor={`${id}-threshold`} className="block">
                  <span className={label}>
                    {row.threshold.label} ({row.threshold.min}–{row.threshold.max})
                  </span>
                  <input
                    id={`${id}-threshold`}
                    className={inputCls}
                    inputMode="numeric"
                    disabled={!enabled}
                    value={String(section[row.threshold.field] ?? defaults[row.threshold.field] ?? "")}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      const n = Math.round(Number(raw));
                      if (raw !== "" && !Number.isFinite(n)) return;
                      set(row.section, { [row.threshold!.field]: raw === "" ? undefined : n });
                    }}
                  />
                </label>
              )}
              <p className="text-[10px] text-slate-500">Sent to: {row.recipients}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
