import React, { useEffect, useMemo, useState } from "react";
import { formatMoney, PROJECT_CODE_PREFIX_REGEX, type ProjectBasicsStep, type ProjectTypeDto, type RegionDto } from "@insite/shared";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import { useTenantSettingsQuery } from "../../../../queries/organizations/useOrganizationQueries";
import { useProjectTypesQuery, useRegionsQuery } from "../../../../queries/deliveryModels/useDeliveryModelQueries";
import { CustomSelect } from "../../../../components/common";
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

const NO_TYPES: ProjectTypeDto[] = [];
const NO_REGIONS: RegionDto[] = [];

export interface BasicsValues {
  name: string;
  codePrefix: string;
  stateLocation: string;
  lgaLocation: string;
  description: string;
  totalBudget: string;
  /** Phase 11: "" = no type (only when the tenant has none). */
  projectTypeId: string;
  /** Phase 11: "" = no region. */
  regionId: string;
}

export const EMPTY_BASICS: BasicsValues = {
  name: "",
  codePrefix: "",
  stateLocation: "",
  lgaLocation: "",
  description: "",
  totalBudget: "",
  projectTypeId: "",
  regionId: "",
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
      projectTypeId: v.projectTypeId || null,
      regionId: v.regionId || null,
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
  // Phase 11: the delivery model comes first; a tenant with types must pick one.
  const typesQuery = useProjectTypesQuery(false);
  const regionsQuery = useRegionsQuery(false);
  const types = typesQuery.data ?? NO_TYPES;
  const regions = regionsQuery.data ?? NO_REGIONS;
  const typeLocked = Boolean(codePrefixLocked);
  useEffect(() => {
    if (values.projectTypeId || typeLocked || types.length === 0) return;
    const preferred = types.find((t) => t.isDefault) ?? types[0];
    onChange({ ...values, projectTypeId: preferred.id });
  }, [types, values, typeLocked, onChange]);
  const regionOptions = useMemo(() => {
    const top = regions.filter((r) => !r.parentRegionId).sort((a, b) => a.name.localeCompare(b.name));
    return [
      { value: "", label: "No region" },
      ...top.flatMap((r) => [
        { value: r.id, label: r.name },
        ...regions
          .filter((a) => a.parentRegionId === r.id)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((a) => ({ value: a.id, label: `${r.name} › ${a.name}` })),
      ]),
    ];
  }, [regions]);
  const set = (key: keyof BasicsValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onChange({ ...values, [key]: key === "codePrefix" ? e.target.value.toUpperCase() : e.target.value });

  return (
    <StepSection title="Project basics" description="What the project is, where it is, and its total budget.">
      {errors.general && <p className="text-xs font-medium text-red-600">{errors.general}</p>}
      {types.length > 0 && (
        <div>
          <p className={labelClass}>
            Project type <span className="text-red-500">*</span>
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {types.map((t) => {
              const selected = values.projectTypeId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  disabled={disabled || typeLocked}
                  onClick={() => onChange({ ...values, projectTypeId: t.id })}
                  className={`text-left rounded-xl border p-3 transition disabled:cursor-not-allowed ${
                    selected ? "border-brand-primary bg-brand-primary/5 ring-2 ring-brand-primary/20" : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.colour ?? "#94a3b8" }} />
                    {t.name}
                  </span>
                  {t.description && <span className="mt-1 block text-[11px] text-slate-500">{t.description}</span>}
                </button>
              );
            })}
          </div>
          <FieldError
            message={
              errors.fields.projectTypeId ??
              (typeLocked
                ? "Fixed once the project is active."
                : "Choosing a type applies its workflow and defaults. Values you already saved are kept.")
            }
          />
        </div>
      )}
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
        {regions.length > 0 && (
          <div className="md:col-span-2">
            <p className={labelClass}>Region</p>
            <CustomSelect
              value={values.regionId}
              onChange={(v) => onChange({ ...values, regionId: v })}
              options={regionOptions}
              searchable={regions.length > 8}
              disabled={disabled}
            />
            <FieldError message={errors.fields.regionId} />
          </div>
        )}
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
      projectTypeId: setup.basics.projectType?.id ?? "",
      regionId: setup.basics.region?.id ?? "",
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

  const needs = [
    { label: "Site address", value: setup.basics.siteAddress },
    { label: "Strategic justification", value: setup.basics.strategicJustification },
    { label: "Assumptions", value: setup.basics.assumptions },
  ].filter((n) => n.value);
  return (
    <>
      <BasicsForm
        values={values}
        onChange={setValues}
        errors={errors}
        disabled={readOnly}
        codePrefixLocked={mode === "settings" || setup.status !== "DRAFT"}
      />
      {needs.length > 0 && (
        // Redesign R2c: filled from the needs-assessment workbook; read-only for now.
        <StepSection title="Needs assessment" description="From the needs-assessment workbook.">
          <dl className="space-y-3">
            {needs.map((n) => (
              <div key={n.label}>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{n.label}</dt>
                <dd className="text-xs text-slate-800 whitespace-pre-wrap">{n.value}</dd>
              </div>
            ))}
          </dl>
        </StepSection>
      )}
    </>
  );
}
