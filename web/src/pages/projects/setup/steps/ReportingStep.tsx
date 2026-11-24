import React, { useMemo, useState } from "react";
import {
  describeCadence,
  ISO_WEEKDAY_LABELS,
  ISO_WEEKDAY_SHORT,
  ReportingCadenceEnum,
  zonedCalendarDate,
  type ReportingCadence,
} from "@insite/shared";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import { useCadenceOverviewQuery } from "../../../../queries/cadence/useCadenceQueries";
import { ReportingStreamsEditor } from "../../../../components/inspections/ReportingStreamsEditor";
import {
  extractErrors,
  FieldError,
  inputClass,
  labelClass,
  NO_ERRORS,
  StepSection,
  useRegisterStep,
  type FormErrors,
  type StepProps,
} from "../setupContext";

const CADENCE_TEXT: Record<ReportingCadence, { label: string; description: string }> = {
  DAILY: { label: "Daily", description: "One report per scheduled WBS item each working day." },
  WEEKLY: { label: "Weekly", description: "One report per scheduled item each week, due on the last working day." },
  BI_WEEKLY: { label: "Every two weeks", description: "One report per item every 14 days, counted from a start date." },
  MONTHLY: { label: "Monthly", description: "One report per item each calendar month, due on its last working day." },
  CUSTOM_INTERVAL: { label: "Custom period", description: "Periods of a set number of days from a start date." },
  QUARTERLY: { label: "Quarterly", description: "One report per item each calendar quarter, due on its last working day." },
  INSPECTION_ONLY: { label: "Inspections only", description: "Reports at inspection visits. Nothing is due and nothing is late." },
};

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function ReportingStep({ projectId, setup, readOnly }: StepProps) {
  const initial = useMemo(() => {
    const r = setup.reporting;
    return {
      reportingCadence: r.reportingCadence,
      workdayStartTime: r.workdayStartTime,
      workdayEndTime: r.workdayEndTime,
      workWeekDays: r.workWeekDays,
      periodStartDayOfWeek: r.periodStartDayOfWeek,
      customIntervalDays: r.customIntervalDays,
      reportDueTime: r.reportDueTime,
      reportGraceMinutes: r.reportGraceMinutes,
      cadenceAnchorDate: r.cadenceAnchorDate,
      cadenceQuarterAnchorMonth: r.cadenceQuarterAnchorMonth ?? 1,
    };
  }, [setup.reporting]);
  const [state, setState] = useState(initial);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const save = useSaveSetupStepMutation(projectId);
  // Live projects: a change to the period shape waits for the next period (shown below).
  const overview = useCadenceOverviewQuery(projectId, setup.status !== "DRAFT");
  const savedOnce = setup.steps.find((s) => s.stepId === "reporting")?.saved ?? false;
  // A step with defaults still has to be reviewed and saved once in a draft.
  const dirty = JSON.stringify(state) !== JSON.stringify(initial) || (!savedOnce && setup.status === "DRAFT");
  const set = <K extends keyof typeof state>(key: K, value: (typeof state)[K]) => setState((s) => ({ ...s, [key]: value }));

  const usesAnchor = state.reportingCadence === "BI_WEEKLY" || state.reportingCadence === "CUSTOM_INTERVAL";
  const usesWeekStart = state.reportingCadence === "WEEKLY" || (state.reportingCadence === "BI_WEEKLY" && !state.cadenceAnchorDate);
  const hasPeriods = state.reportingCadence !== "INSPECTION_ONLY";
  const timezone = setup.site.timezone || "Africa/Lagos";

  const preview = useMemo(() => {
    if (state.workWeekDays.length === 0) return "Pick at least one working day.";
    if (state.reportingCadence === "CUSTOM_INTERVAL" && !(state.customIntervalDays && state.customIntervalDays > 0)) {
      return "Set how many days a period lasts.";
    }
    return describeCadence({ ...state, timezone }, zonedCalendarDate(new Date(), timezone));
  }, [state, timezone]);

  useRegisterStep(dirty, async (opts) => {
    if (!dirty) return true;
    const fields: Record<string, string> = {};
    if (state.workdayStartTime >= state.workdayEndTime) fields.workdayEndTime = "The working day must end after it starts";
    if (state.workWeekDays.length === 0) fields.workWeekDays = "Pick at least one working day";
    if (state.reportingCadence === "CUSTOM_INTERVAL" && !(state.customIntervalDays && state.customIntervalDays > 0)) {
      fields.customIntervalDays = "Set how many days a period lasts";
    }
    if (Object.keys(fields).length > 0) {
      setErrors({ fields, general: null });
      return false;
    }
    try {
      await save.mutateAsync({ stepId: "reporting", body: state, silent: opts?.silent });
      setErrors(NO_ERRORS);
      return true;
    } catch (err) {
      setErrors(extractErrors(err));
      return false;
    }
  });

  const toggleDay = (d: number) =>
    set("workWeekDays", state.workWeekDays.includes(d) ? state.workWeekDays.filter((x) => x !== d) : [...state.workWeekDays, d].sort((a, b) => a - b));

  return (
    <>
    <StepSection title="Reporting" description={`How often field reports are due and when the working day runs. Times are in ${timezone}.`}>
      {errors.general && <p className="text-xs font-medium text-red-600">{errors.general}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" role="radiogroup" aria-label="Reporting cadence">
        {ReportingCadenceEnum.options.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={state.reportingCadence === c}
            disabled={readOnly}
            onClick={() => set("reportingCadence", c)}
            className={`text-left rounded-xl border p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary ${
              state.reportingCadence === c ? "border-brand-primary bg-brand-primary/5" : "border-slate-200 hover:border-slate-300"
            }`}
          >
            <p className="text-xs font-bold text-slate-900">{CADENCE_TEXT[c].label}</p>
            <p className="mt-1 text-[11px] text-slate-500">{CADENCE_TEXT[c].description}</p>
          </button>
        ))}
      </div>

      <fieldset>
        <legend className={labelClass}>Working days</legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((d) => {
            const on = state.workWeekDays.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-label={ISO_WEEKDAY_LABELS[d]}
                disabled={readOnly}
                onClick={() => toggleDay(d)}
                className={`w-12 rounded-lg border px-2 py-1.5 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary ${
                  on ? "border-brand-primary bg-brand-primary text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"
                }`}
              >
                {ISO_WEEKDAY_SHORT[d]}
              </button>
            );
          })}
        </div>
        <FieldError message={errors.fields.workWeekDays} />
      </fieldset>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <label className={labelClass} htmlFor="workday-start">Working day starts</label>
          <input id="workday-start" type="time" className={inputClass()} value={state.workdayStartTime} onChange={(e) => set("workdayStartTime", e.target.value)} disabled={readOnly} />
          <p className="mt-1 text-[11px] text-slate-500">Each reporting period opens at this time on its first working day.</p>
        </div>
        <div>
          <label className={labelClass} htmlFor="workday-end">Working day ends</label>
          <input id="workday-end" type="time" className={inputClass(Boolean(errors.fields.workdayEndTime))} value={state.workdayEndTime} onChange={(e) => set("workdayEndTime", e.target.value)} disabled={readOnly} />
          <FieldError message={errors.fields.workdayEndTime} />
        </div>
        {hasPeriods && (
          <>
            <div>
              <label className={labelClass} htmlFor="due-time">Report due at</label>
              <input
                id="due-time"
                type="time"
                className={inputClass()}
                value={state.reportDueTime ?? state.workdayEndTime}
                onChange={(e) => set("reportDueTime", e.target.value === state.workdayEndTime ? null : e.target.value)}
                disabled={readOnly}
              />
              <p className="mt-1 text-[11px] text-slate-500">On the last working day of the period.</p>
            </div>
            <div>
              <label className={labelClass} htmlFor="grace">Grace (minutes)</label>
              <input
                id="grace"
                type="number"
                min={0}
                max={1440}
                className={inputClass()}
                value={state.reportGraceMinutes}
                onChange={(e) => set("reportGraceMinutes", Math.max(0, Number(e.target.value) || 0))}
                disabled={readOnly}
              />
              <p className="mt-1 text-[11px] text-slate-500">Reports after due time plus grace are flagged late.</p>
            </div>
          </>
        )}
      </div>

      {state.reportingCadence === "QUARTERLY" && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className={labelClass} htmlFor="quarter-anchor">Quarters start in</label>
            <select
              id="quarter-anchor"
              className={inputClass()}
              value={state.cadenceQuarterAnchorMonth}
              onChange={(e) => set("cadenceQuarterAnchorMonth", Number(e.target.value))}
              disabled={readOnly}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-500">January gives Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec.</p>
          </div>
        </div>
      )}

      {(usesWeekStart || usesAnchor || state.reportingCadence === "CUSTOM_INTERVAL") && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {usesWeekStart && (
            <div>
              <label className={labelClass} htmlFor="period-start">Week starts on</label>
              <select
                id="period-start"
                className={inputClass()}
                value={state.periodStartDayOfWeek}
                onChange={(e) => set("periodStartDayOfWeek", Number(e.target.value))}
                disabled={readOnly}
              >
                {WEEKDAYS.map((d) => (
                  <option key={d} value={d}>{ISO_WEEKDAY_LABELS[d]}</option>
                ))}
              </select>
            </div>
          )}
          {state.reportingCadence === "CUSTOM_INTERVAL" && (
            <div>
              <label className={labelClass} htmlFor="interval">Days per period</label>
              <input
                id="interval"
                type="number"
                min={1}
                max={92}
                className={inputClass(Boolean(errors.fields.customIntervalDays))}
                value={state.customIntervalDays ?? ""}
                onChange={(e) => set("customIntervalDays", e.target.value ? Number(e.target.value) : null)}
                disabled={readOnly}
              />
              <FieldError message={errors.fields.customIntervalDays} />
            </div>
          )}
          {usesAnchor && (
            <div>
              <label className={labelClass} htmlFor="anchor">First period starts</label>
              <input
                id="anchor"
                type="date"
                className={inputClass()}
                value={state.cadenceAnchorDate ?? ""}
                onChange={(e) => set("cadenceAnchorDate", e.target.value || null)}
                disabled={readOnly}
              />
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3" aria-live="polite">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Preview</p>
        <p className="mt-1 text-xs text-slate-800">{preview}</p>
        {setup.status !== "DRAFT" && (
          <p className="mt-1 text-[11px] text-slate-500">
            {overview.data?.pendingChange
              ? `A saved change takes effect on ${overview.data.pendingChange.effectiveFrom}, when the current period ends.`
              : "On a live project, a change to the cadence or working days takes effect when the current period ends. Reports already due keep their due time."}
          </p>
        )}
      </div>
    </StepSection>
    {/* Phase 14: reporting streams (each with its own cadence and owners) */}
    <ReportingStreamsEditor projectId={projectId} setup={setup} readOnly={readOnly} />
    </>
  );
}
