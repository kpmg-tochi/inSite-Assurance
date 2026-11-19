import React, { useMemo, useState } from "react";
import { ReportingCadenceEnum, type ReportingCadence } from "@insite/shared";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
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
  DAILY: { label: "Daily", description: "A report per active WBS item every working day." },
  WEEKLY: { label: "Weekly", description: "A report per active WBS item each week." },
  BI_WEEKLY: { label: "Every two weeks", description: "A report per active WBS item every other week." },
  INSPECTION_ONLY: { label: "Inspections only", description: "Reports at inspection visits; no fixed rhythm." },
};

export function ReportingStep({ projectId, setup, readOnly }: StepProps) {
  const initial = useMemo(() => ({ ...setup.reporting }), [setup.reporting]);
  const [state, setState] = useState(initial);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const save = useSaveSetupStepMutation(projectId);
  const savedOnce = setup.steps.find((s) => s.stepId === "reporting")?.saved ?? false;
  // A step with defaults still has to be reviewed and saved once in a draft.
  const dirty = JSON.stringify(state) !== JSON.stringify(initial) || (!savedOnce && setup.status === "DRAFT");

  useRegisterStep(dirty, async (opts) => {
    if (!dirty) return true;
    if (state.workdayStartTime >= state.workdayEndTime) {
      setErrors({ fields: { workdayEndTime: "The working day must end after it starts" }, general: null });
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

  return (
    <StepSection title="Reporting" description="How often field reports are expected and when the working day runs (project time zone).">
      {errors.general && <p className="text-xs font-medium text-red-600">{errors.general}</p>}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3" role="radiogroup" aria-label="Reporting cadence">
        {ReportingCadenceEnum.options.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={state.reportingCadence === c}
            disabled={readOnly}
            onClick={() => setState((s) => ({ ...s, reportingCadence: c }))}
            className={`text-left rounded-xl border p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary ${
              state.reportingCadence === c ? "border-brand-primary bg-brand-primary/5" : "border-slate-200 hover:border-slate-300"
            }`}
          >
            <p className="text-xs font-bold text-slate-900">{CADENCE_TEXT[c].label}</p>
            <p className="mt-1 text-[11px] text-slate-500">{CADENCE_TEXT[c].description}</p>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <label className={labelClass} htmlFor="workday-start">
            Working day starts
          </label>
          <input id="workday-start" type="time" className={inputClass()} value={state.workdayStartTime} onChange={(e) => setState((s) => ({ ...s, workdayStartTime: e.target.value }))} disabled={readOnly} />
        </div>
        <div>
          <label className={labelClass} htmlFor="workday-end">
            Working day ends
          </label>
          <input id="workday-end" type="time" className={inputClass(Boolean(errors.fields.workdayEndTime))} value={state.workdayEndTime} onChange={(e) => setState((s) => ({ ...s, workdayEndTime: e.target.value }))} disabled={readOnly} />
          <FieldError message={errors.fields.workdayEndTime} />
        </div>
        <p className="col-span-2 self-end text-[11px] text-slate-500">Times are in {setup.site.timezone}.</p>
      </div>
    </StepSection>
  );
}
