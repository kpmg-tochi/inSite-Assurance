import React from "react";
import { ReportingCadenceEnum, type ReportingCadence } from "@insite/shared";
import { CustomSelect } from "../common";

/**
 * Phase 16: the cadence fields shared by a project type's reporting defaults and its reporting
 * streams: cadence, working days, period start, custom length, quarter start month, due time and
 * grace. Values are passed through as stored; blank optional fields are null.
 */

export const CADENCE_LABELS: Record<ReportingCadence, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  BI_WEEKLY: "Every two weeks",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  CUSTOM_INTERVAL: "Custom period",
  INSPECTION_ONLY: "No periods (inspections only)",
};

export const WEEKDAYS = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [7, "Sun"],
] as const;

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export interface CadenceValue {
  reportingCadence: ReportingCadence;
  workWeekDays?: number[];
  periodStartDayOfWeek?: number;
  customIntervalDays?: number | null;
  reportDueTime?: string | null;
  reportGraceMinutes?: number;
  /** Streams call it quarterAnchorMonth, the reporting defaults cadenceQuarterAnchorMonth. */
  quarterMonth?: number | null;
}

const inputCls = "w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-brand-primary";
const label = "text-xs font-medium text-slate-700 mb-1 block";

export function CadenceFields({
  value,
  onChange,
  maxCustomDays = 92,
  maxGraceMinutes = 24 * 60,
}: {
  value: CadenceValue;
  onChange: (patch: Partial<CadenceValue>) => void;
  maxCustomDays?: number;
  maxGraceMinutes?: number;
}) {
  const days = value.workWeekDays ?? [1, 2, 3, 4, 5, 6];
  const periodic = value.reportingCadence !== "INSPECTION_ONLY" && value.reportingCadence !== "DAILY";
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <span className={label}>Cadence</span>
          <CustomSelect
            value={value.reportingCadence}
            onChange={(v) => onChange({ reportingCadence: v as ReportingCadence })}
            options={ReportingCadenceEnum.options.map((c) => ({ value: c, label: CADENCE_LABELS[c] }))}
          />
        </div>
        {value.reportingCadence === "CUSTOM_INTERVAL" && (
          <label className={label}>
            Days per period
            <input
              type="number"
              min={1}
              max={maxCustomDays}
              className={inputCls}
              value={value.customIntervalDays ?? ""}
              onChange={(e) => onChange({ customIntervalDays: e.target.value ? Number(e.target.value) : null })}
            />
          </label>
        )}
        {value.reportingCadence === "QUARTERLY" && (
          <div>
            <span className={label}>Quarters start in</span>
            <CustomSelect
              value={String(value.quarterMonth ?? 1)}
              onChange={(v) => onChange({ quarterMonth: Number(v) })}
              options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
            />
          </div>
        )}
        {periodic && (
          <div>
            <span className={label}>Periods start on</span>
            <CustomSelect
              value={String(value.periodStartDayOfWeek ?? 1)}
              onChange={(v) => onChange({ periodStartDayOfWeek: Number(v) })}
              options={WEEKDAYS.map(([n, d]) => ({ value: String(n), label: d }))}
            />
          </div>
        )}
      </div>
      <fieldset>
        <legend className={label}>Working days</legend>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map(([n, d]) => {
            const on = days.includes(n);
            return (
              <button
                key={n}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ workWeekDays: on ? days.filter((x) => x !== n) : [...days, n].sort((a, b) => a - b) })}
                className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${on ? "border-brand-primary bg-brand-primary text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
              >
                {d}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className={label}>
          Report due at (blank: end of the working day)
          <input
            type="time"
            className={inputCls}
            value={value.reportDueTime ?? ""}
            onChange={(e) => onChange({ reportDueTime: e.target.value || null })}
          />
        </label>
        <label className={label}>
          Grace before late (minutes)
          <input
            type="number"
            min={0}
            max={maxGraceMinutes}
            className={inputCls}
            value={value.reportGraceMinutes ?? 0}
            onChange={(e) => onChange({ reportGraceMinutes: Math.min(maxGraceMinutes, Math.max(0, Math.trunc(Number(e.target.value) || 0))) })}
          />
        </label>
      </div>
    </div>
  );
}
