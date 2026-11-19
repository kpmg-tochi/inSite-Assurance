import React, { useMemo, useState } from "react";
import { formatMoney, PROJECT_CODE_PREFIX_REGEX, type ProjectBasicsStep } from "@insite/shared";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import { useTenantSettingsQuery } from "../../../../queries/organizations/useOrganizationQueries";
import {
  extractErrors,
  FieldError,
  inputClass,
  labelClass,
  NO_ERRORS,
  parseNumberInput,
  StepSection,
  useRegisterStep,
  type FormErrors,
  type StepProps,
} from "../setupContext";

export interface BasicsValues {
  name: string;
  codePrefix: string;
  stateLocation: string;
  lgaLocation: string;
  description: string;
  totalBudget: string;
}

export const EMPTY_BASICS: BasicsValues = {
  name: "",
  codePrefix: "",
  stateLocation: "",
  lgaLocation: "",
  description: "",
  totalBudget: "",
};

/** Client-side checks that mirror the server schema, so errors show before a round trip. */
export function validateBasics(v: BasicsValues): { body: ProjectBasicsStep | null; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const budget = parseNumberInput(v.totalBudget);
  if (v.name.trim().length < 3) fields.name = "Enter at least 3 characters";
  if (!PROJECT_CODE_PREFIX_REGEX.test(v.codePrefix.trim().toUpperCase())) fields.codePrefix = "Format must be e.g. LKK-402";
  if (v.stateLocation.trim().length < 2) fields.stateLocation = "Enter the state or region";
  if (budget === null) fields.totalBudgetNgn = "Enter the total budget";
  else if (budget <= 0) fields.totalBudgetNgn = "Budget must be above zero";
  if (Object.keys(fields).length > 0) return { body: null, fields };
  return {
    body: {
      name: v.name.trim(),
      codePrefix: v.codePrefix.trim().toUpperCase(),
      stateLocation: v.stateLocation.trim(),
      lgaLocation: v.lgaLocation.trim() || null,
      description: v.description.trim() || null,
      totalBudgetNgn: budget!,
    },
    fields,
  };
}

/** The basics form, shared by the "new project" page and the basics step. */
export function BasicsForm({
  values,
  onChange,
  errors,
  disabled,
  codePrefixLocked,
}: {
  values: BasicsValues;
  onChange: (next: BasicsValues) => void;
  errors: FormErrors;
  disabled?: boolean;
  codePrefixLocked?: boolean;
}) {
  const settings = useTenantSettingsQuery();
  const currency = settings.data?.defaultCurrency ?? "NGN";
  const budget = parseNumberInput(values.totalBudget);
  const set = (key: keyof BasicsValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onChange({ ...values, [key]: key === "codePrefix" ? e.target.value.toUpperCase() : e.target.value });

  return (
    <StepSection title="Project basics" description="What the project is, where it is, and its total budget.">
      {errors.general && <p className="text-xs font-medium text-red-600">{errors.general}</p>}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-3">
          <label className={labelClass} htmlFor="basics-name">
            Project name <span className="text-red-500">*</span>
          </label>
          <input id="basics-name" className={inputClass(Boolean(errors.fields.name))} value={values.name} onChange={set("name")} disabled={disabled} />
          <FieldError message={errors.fields.name} />
        </div>
        <div>
          <label className={labelClass} htmlFor="basics-code">
            Project code <span className="text-red-500">*</span>
          </label>
          <input
            id="basics-code"
            className={`${inputClass(Boolean(errors.fields.codePrefix))} uppercase font-bold`}
            value={values.codePrefix}
            onChange={set("codePrefix")}
            maxLength={7}
            placeholder="ABC-123"
            disabled={disabled || codePrefixLocked}
          />
          <FieldError
            message={errors.fields.codePrefix ?? (codePrefixLocked ? "Fixed once the project is active." : null)}
          />
        </div>
        <div className="md:col-span-2">
          <label className={labelClass} htmlFor="basics-state">
            State or region <span className="text-red-500">*</span>
          </label>
          <input id="basics-state" className={inputClass(Boolean(errors.fields.stateLocation))} value={values.stateLocation} onChange={set("stateLocation")} disabled={disabled} />
          <FieldError message={errors.fields.stateLocation} />
        </div>
        <div className="md:col-span-2">
          <label className={labelClass} htmlFor="basics-lga">
            Local government area
          </label>
          <input id="basics-lga" className={inputClass(Boolean(errors.fields.lgaLocation))} value={values.lgaLocation} onChange={set("lgaLocation")} disabled={disabled} />
        </div>
        <div className="md:col-span-2">
          <label className={labelClass} htmlFor="basics-budget">
            Total budget ({currency}) <span className="text-red-500">*</span>
          </label>
          <input
            id="basics-budget"
            inputMode="decimal"
            className={inputClass(Boolean(errors.fields.totalBudgetNgn))}
            value={values.totalBudget}
            onChange={set("totalBudget")}
            disabled={disabled}
          />
          {budget !== null && budget > 0 && (
            <p className="mt-1 text-[11px] text-slate-500">{formatMoney(budget, { currency })}</p>
          )}
          <FieldError message={errors.fields.totalBudgetNgn} />
        </div>
        <div className="md:col-span-4">
          <label className={labelClass} htmlFor="basics-description">
            Description
          </label>
          <textarea
            id="basics-description"
            rows={3}
            className={inputClass(Boolean(errors.fields.description))}
            value={values.description}
            onChange={set("description")}
            disabled={disabled}
          />
        </div>
      </div>
    </StepSection>
  );
}

export function BasicsStep({ projectId, setup, mode, readOnly }: StepProps) {
  const initial = useMemo<BasicsValues>(
    () => ({
      name: setup.basics.name,
      codePrefix: setup.basics.codePrefix,
      stateLocation: setup.basics.stateLocation ?? "",
      lgaLocation: setup.basics.lgaLocation ?? "",
      description: setup.basics.description ?? "",
      totalBudget: setup.basics.totalBudgetNgn === null ? "" : String(setup.basics.totalBudgetNgn),
    }),
    [setup.basics]
  );
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const save = useSaveSetupStepMutation(projectId);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);

  useRegisterStep(dirty, async (opts) => {
    if (!dirty) return true;
    const { body, fields } = validateBasics(values);
    if (!body) {
      setErrors({ fields, general: "Some fields need attention." });
      return false;
    }
    try {
      await save.mutateAsync({ stepId: "basics", body, silent: opts?.silent });
      setErrors(NO_ERRORS);
      return true;
    } catch (err) {
      setErrors(extractErrors(err));
      return false;
    }
  });

  return (
    <BasicsForm
      values={values}
      onChange={setValues}
      errors={errors}
      disabled={readOnly}
      codePrefixLocked={mode === "settings" || setup.status !== "DRAFT"}
    />
  );
}
