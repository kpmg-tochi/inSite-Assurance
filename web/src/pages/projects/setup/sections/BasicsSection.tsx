import React, { useEffect, useMemo, useState } from "react";
import { useWatch } from "react-hook-form";
import { z } from "zod";
import {
  formatMoney,
  FUNDING_SOURCE_SUGGESTIONS,
  ProjectBasicsStepSchema,
  type ProjectSetupDto,
  type ProjectTypeDto,
  type RegionDto,
} from "@insite/shared";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import { useTenantSettingsQuery } from "../../../../queries/organizations/useOrganizationQueries";
import {
  useProjectTypesQuery,
  useRegionsQuery,
} from "../../../../queries/deliveryModels/useDeliveryModelQueries";
import { CustomSelect } from "../../../../components/common";
import { useTerm } from "../../../../lib/auth-context";
import { FieldError, visibleError, type ZodForm } from "../../../../lib/forms";
import {
  choiceOrNull,
  FieldError as Note,
  inputClass,
  labelClass,
  numberOrNull,
  parseNumberInput,
  setField,
  StepSection,
  textOrNull,
  textProps,
  useLatestSetup,
  useRegisterSection,
  useSectionForm,
  type StepProps,
} from "../setupContext";

const NO_TYPES: ProjectTypeDto[] = [];
const NO_REGIONS: RegionDto[] = [];

const S = ProjectBasicsStepSchema.shape;

/**
 * The basics form schema: the inputs hold text, the output is the request body
 * (`ProjectBasicsStepSchema`, which the server validates again). A tenant with project types must
 * give a new draft one (Phase 11).
 */
export function basicsFormSchema(opts: { typeRequired: boolean }) {
  return z.object({
    name: S.name,
    codePrefix: S.codePrefix,
    stateLocation: S.stateLocation,
    lgaLocation: textOrNull().pipe(S.lgaLocation),
    description: textOrNull().pipe(S.description),
    totalBudgetNgn: numberOrNull("Total budget").pipe(S.totalBudgetNgn),
    /** Phase 11: "" = no type (only when the tenant has none). */
    projectTypeId: opts.typeRequired
      ? z.string().min(1, "Choose the delivery model").pipe(S.projectTypeId)
      : choiceOrNull().pipe(S.projectTypeId),
    /** Phase 11: "" = no region. */
    regionId: choiceOrNull().pipe(S.regionId),
    /** UBEC IRL register fields: "" clears (null). */
    interventionYear: numberOrNull("Intervention year").pipe(S.interventionYear),
    fundingSource: textOrNull().pipe(S.fundingSource),
    externalReference: textOrNull().pipe(S.externalReference),
  });
}
export type BasicsSchema = ReturnType<typeof basicsFormSchema>;
export type BasicsValues = z.input<BasicsSchema>;

export const EMPTY_BASICS: BasicsValues = {
  name: "",
  codePrefix: "",
  stateLocation: "",
  lgaLocation: "",
  description: "",
  totalBudgetNgn: "",
  projectTypeId: "",
  regionId: "",
  interventionYear: "",
  fundingSource: "",
  externalReference: "",
};

/** The basics schema for this tenant: the delivery model is required when it has project types. */
export function useBasicsSchema(typeLocked: boolean) {
  const types = useProjectTypesQuery(false).data ?? NO_TYPES;
  const typeRequired = !typeLocked && types.length > 0;
  return useMemo(() => basicsFormSchema({ typeRequired }), [typeRequired]);
}

/** The basics form, shared by the "new project" page and the basics step. */
export function BasicsForm({
  form,
  general,
  disabled,
  codePrefixLocked,
}: {
  form: ZodForm<BasicsSchema>;
  /** Section-level message (a failed save). */
  general?: string | null;
  disabled?: boolean;
  codePrefixLocked?: boolean;
}) {
  const settings = useTenantSettingsQuery();
  const currency = settings.data?.defaultCurrency ?? "NGN";
  const values = useWatch({ control: form.control }) as BasicsValues;
  const budget = parseNumberInput(values.totalBudgetNgn ?? "");
  // Phase 11: the delivery model comes first; a tenant with types must pick one.
  const typesQuery = useProjectTypesQuery(false);
  const regionsQuery = useRegionsQuery(false);
  const types = typesQuery.data ?? NO_TYPES;
  const regions = regionsQuery.data ?? NO_REGIONS;
  const typeLocked = Boolean(codePrefixLocked);
  useEffect(() => {
    if (values.projectTypeId || typeLocked || types.length === 0) return;
    const preferred = types.find((t) => t.isDefault) ?? types[0];
    setField(form, "projectTypeId", preferred.id);
  }, [types, values.projectTypeId, typeLocked, form]);
  const regionOptions = useMemo(() => {
    const top = regions
      .filter((r) => !r.parentRegionId)
      .sort((a, b) => a.name.localeCompare(b.name));
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
  const err = (name: string) => visibleError(form, name);
  const term = useTerm();

  return (
    <StepSection
      title="Delivery model and project details"
      description="The delivery model first: it pre-fills the owner, funder and retention. Then what the project is, where it is, and its budget."
    >
      {general && (
        <p className="text-xs font-medium text-red-600">{general}</p>
      )}
      {types.length > 0 && (
        <div>
          <p className={labelClass} id="basics-type-label">
            Delivery model <span className="text-red-500">*</span>
          </p>
          <div
            className="grid grid-cols-1 md:grid-cols-2 gap-2"
            role="radiogroup"
            aria-labelledby="basics-type-label"
            aria-invalid={err("projectTypeId") ? true : undefined}
          >
            {types.map((t) => {
              const selected = values.projectTypeId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled || typeLocked}
                  onClick={() => setField(form, "projectTypeId", t.id, true)}
                  className={`text-left rounded-xl border p-3 transition disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary ${
                    selected
                      ? "border-brand-primary bg-brand-primary/5 ring-2 ring-brand-primary/20"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: t.colour ?? "#94a3b8" }}
                    />
                    {t.name}
                  </span>
                  {t.description && (
                    <span className="mt-1 block text-[11px] text-slate-500">
                      {t.description}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <FieldError form={form} name="projectTypeId" />
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-3">
          <label className={labelClass} htmlFor="basics-name">
            Project name <span className="text-red-500">*</span>
          </label>
          <input
            id="basics-name"
            className={inputClass(Boolean(err("name")))}
            maxLength={200}
            {...textProps(form, "name")}
            disabled={disabled}
          />
          <FieldError form={form} name="name" />
        </div>
        <div>
          <label className={labelClass} htmlFor="basics-code">
            Project code <span className="text-red-500">*</span>
          </label>
          <input
            id="basics-code"
            className={`${inputClass(Boolean(err("codePrefix")))} uppercase font-bold`}
            {...textProps(form, "codePrefix", (v) => v.toUpperCase())}
            maxLength={7}
            placeholder="ABC-123"
            disabled={disabled || codePrefixLocked}
          />
          <FieldError form={form} name="codePrefix" />
          {!err("codePrefix") && codePrefixLocked && (
            <Note message="Fixed once the project is active." />
          )}
        </div>
        <div className="md:col-span-2">
          <label className={labelClass} htmlFor="basics-state">
            State or region <span className="text-red-500">*</span>
          </label>
          <input
            id="basics-state"
            className={inputClass(Boolean(err("stateLocation")))}
            maxLength={80}
            {...textProps(form, "stateLocation")}
            disabled={disabled}
          />
          <FieldError form={form} name="stateLocation" />
        </div>
        <div className="md:col-span-2">
          <label className={labelClass} htmlFor="basics-lga">
            Local government area
          </label>
          <input
            id="basics-lga"
            className={inputClass(Boolean(err("lgaLocation")))}
            maxLength={120}
            {...textProps(form, "lgaLocation")}
            disabled={disabled}
          />
          <FieldError form={form} name="lgaLocation" />
        </div>
        {regions.length > 0 && (
          <div className="md:col-span-2">
            <CustomSelect
              label="Region"
              value={values.regionId ?? ""}
              onChange={(v) => setField(form, "regionId", v, true)}
              options={regionOptions}
              searchable={regions.length > 8}
              disabled={disabled}
              error={err("regionId")}
            />
          </div>
        )}
        <div className="md:col-span-2">
          <label className={labelClass} htmlFor="basics-budget">
            Total budget ({currency}) <span className="text-red-500">*</span>
          </label>
          <input
            id="basics-budget"
            inputMode="decimal"
            className={inputClass(Boolean(err("totalBudgetNgn")))}
            {...textProps(form, "totalBudgetNgn")}
            disabled={disabled}
          />
          {budget !== null && budget > 0 && (
            <p className="mt-1 text-[11px] text-slate-500">
              {formatMoney(budget, { currency })}
            </p>
          )}
          <FieldError form={form} name="totalBudgetNgn" />
        </div>
        <div className="md:col-span-2">
          <label className={labelClass} htmlFor="basics-external-reference">
            {term("externalReference")}
          </label>
          <input
            id="basics-external-reference"
            className={inputClass(Boolean(err("externalReference")))}
            maxLength={60}
            {...textProps(form, "externalReference")}
            disabled={disabled}
          />
          <FieldError form={form} name="externalReference" />
        </div>
        <div>
          <label className={labelClass} htmlFor="basics-intervention-year">
            Intervention year
          </label>
          <input
            id="basics-intervention-year"
            inputMode="numeric"
            maxLength={4}
            placeholder="e.g. 2025"
            className={inputClass(Boolean(err("interventionYear")))}
            {...textProps(form, "interventionYear")}
            disabled={disabled}
          />
          <FieldError form={form} name="interventionYear" />
        </div>
        <div>
          <label className={labelClass} htmlFor="basics-funding-source">
            Funding source
          </label>
          <input
            id="basics-funding-source"
            list="basics-funding-source-options"
            maxLength={120}
            className={inputClass(Boolean(err("fundingSource")))}
            {...textProps(form, "fundingSource")}
            disabled={disabled}
          />
          <datalist id="basics-funding-source-options">
            {FUNDING_SOURCE_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <FieldError form={form} name="fundingSource" />
        </div>
        <div className="md:col-span-4">
          <label className={labelClass} htmlFor="basics-description">
            Description
          </label>
          <textarea
            id="basics-description"
            rows={3}
            maxLength={1000}
            className={inputClass(Boolean(err("description")))}
            {...textProps(form, "description")}
            disabled={disabled}
          />
          <FieldError form={form} name="description" />
        </div>
      </div>
    </StepSection>
  );
}

function basicsFrom(setup: ProjectSetupDto): BasicsValues {
  return {
    name: setup.basics.name,
    codePrefix: setup.basics.codePrefix,
    stateLocation: setup.basics.stateLocation ?? "",
    lgaLocation: setup.basics.lgaLocation ?? "",
    description: setup.basics.description ?? "",
    totalBudgetNgn:
      setup.basics.totalBudgetNgn === null
        ? ""
        : String(setup.basics.totalBudgetNgn),
    projectTypeId: setup.basics.projectType?.id ?? "",
    regionId: setup.basics.region?.id ?? "",
    interventionYear: setup.basics.interventionYear === null ? "" : String(setup.basics.interventionYear),
    fundingSource: setup.basics.fundingSource ?? "",
    externalReference: setup.basics.externalReference ?? "",
  };
}

/** Section `basics` (step 1 "Project"): delivery model first, then name, code, location and budget. */
export function BasicsSection({ projectId, setup, mode, readOnly }: StepProps) {
  const initial = useMemo(() => basicsFrom(setup), [setup]);
  const codePrefixLocked = mode === "settings" || setup.status !== "DRAFT";
  const schema = useBasicsSchema(codePrefixLocked);
  const section = useSectionForm(schema, initial);
  const { dirty } = section;
  const [general, setGeneral] = useState<string | null>(null);
  const save = useSaveSetupStepMutation(projectId);
  const latest = useLatestSetup(projectId, setup);

  useRegisterSection(
    "basics",
    dirty,
    async (opts) => {
      if (!dirty && !opts?.force) return true;
      const body = await section.submit(dirty ? undefined : basicsFrom(latest()));
      if (!body) return false;
      try {
        await save.mutateAsync({
          sectionId: "basics",
          body,
          silent: opts?.silent,
        });
        section.reset(basicsFrom(latest()));
        setGeneral(null);
        return true;
      } catch (err) {
        const message = section.showServerErrors(err);
        // UBEC IRL: the client project ID is unique in the workspace.
        if ((err as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code === "EXTERNAL_REFERENCE_TAKEN") {
          section.form.setError("externalReference", { type: "server", message: message ?? "Another project already has this ID." });
          setGeneral(null);
          return false;
        }
        setGeneral(message);
        return false;
      }
    },
    section,
  );

  const needs = [
    { label: "Site address", value: setup.basics.siteAddress },
    {
      label: "Strategic justification",
      value: setup.basics.strategicJustification,
    },
    { label: "Assumptions", value: setup.basics.assumptions },
  ].filter((n) => n.value);
  return (
    <>
      <BasicsForm
        form={section.form}
        general={general}
        disabled={readOnly}
        codePrefixLocked={codePrefixLocked}
      />
      {needs.length > 0 && (
        // Redesign R2c: filled from the needs-assessment workbook; read-only for now.
        <StepSection
          title="Needs assessment"
          description="From the needs assessment."
        >
          <dl className="space-y-3">
            {needs.map((n) => (
              <div key={n.label}>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {n.label}
                </dt>
                <dd className="text-xs text-slate-800 whitespace-pre-wrap">
                  {n.value}
                </dd>
              </div>
            ))}
          </dl>
        </StepSection>
      )}
    </>
  );
}
