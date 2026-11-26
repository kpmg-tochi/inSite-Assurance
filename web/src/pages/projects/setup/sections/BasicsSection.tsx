import React, { useEffect, useMemo, useState } from "react";
import { useWatch } from "react-hook-form";
import { z } from "zod";
import {
  findLgaByName,
  findStateByName,
  formatLotBatch,
  formatMoney,
  formatProjectCode,
  FUNDING_SOURCES,
  fundingSourceCodeFromText,
  LOT_TITLE_MAX,
  PROJECT_CODE_PREFIX_REGEX,
  ProjectBasicsStepSchema,
  type CreateProjectDraftRequest,
  type FundingSourceCode,
  type LotChoice,
  type ProjectLotListDto,
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
import { useProjectLotsQuery } from "../../../../queries/projectLots";
import { CustomSelect } from "../../../../components/common";
import { AdminAreaSelect } from "../../../../components/common/AdminAreaSelect";
import { ApprovedListRowPicker } from "../../../../components/approvedLists/ApprovedListRowPicker";
import { useTerm } from "../../../../lib/auth-context";
import { FieldError, visibleError, type AnyForm, type ZodForm } from "../../../../lib/forms";
import {
  applyServerErrors,
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

/** The lot select's value for "create the next lot of this year". */
export const NEW_LOT = "new";

/**
 * What the basics form asks for (client demo updates C1, C3, C4):
 * - create: a new project. The intervention year and a lot are required; the server assigns the
 *   code `{year}-LOT-{lot}-BATCH-{batch}`.
 * - lotPicker: the lot can be chosen (a new project, or a draft without a lot).
 * - codeEditable: a draft without a lot keeps its older code (`AAA-999`), editable while no lot is chosen.
 * - stateRequired: new projects and projects that already have a state code; older projects that
 *   only recorded free text may be saved without one.
 * - yearLocked: the project has a lot (the year is part of its code).
 */
export interface BasicsFormRules {
  create: boolean;
  lotPicker: boolean;
  codeEditable: boolean;
  stateRequired: boolean;
  yearLocked: boolean;
}

export const CREATE_RULES: BasicsFormRules = {
  create: true,
  lotPicker: true,
  codeEditable: false,
  stateRequired: true,
  yearLocked: false,
};

/**
 * The basics form schema: the inputs hold text, the output is the request body
 * (`ProjectBasicsStepSchema`, which the server validates again). A tenant with project types must
 * give a new draft one (Phase 11).
 */
export function basicsFormSchema(opts: { typeRequired: boolean; rules: BasicsFormRules }) {
  const { rules } = opts;
  return z
    .object({
      name: S.name,
      /** Older `AAA-999` code: only read when `rules.codeEditable` and no lot is chosen. */
      codePrefix: z.string(),
      /** "" = not chosen. */
      stateCode: rules.stateRequired ? z.string().min(1, "Choose the state") : z.string(),
      lgaCode: z.string(),
      description: textOrNull().pipe(S.description),
      totalBudgetNgn: numberOrNull("Total budget").pipe(S.totalBudgetNgn),
      /** Phase 11: "" = no type (only when the tenant has none). */
      projectTypeId: opts.typeRequired
        ? z.string().min(1, "Choose the delivery model").pipe(S.projectTypeId)
        : choiceOrNull().pipe(S.projectTypeId),
      /** Phase 11: "" = no region. */
      regionId: choiceOrNull().pipe(S.regionId),
      /** A select's value; required for a new project. */
      interventionYear: rules.create
        ? z.string().min(1, "Choose the intervention year").pipe(numberOrNull("Intervention year")).pipe(S.interventionYear)
        : numberOrNull("Intervention year").pipe(S.interventionYear),
      /** "" = no lot (drafts keeping their older code), a lot id, or NEW_LOT. */
      lotId: z.string(),
      newLotTitle: z.string(),
      /** "" = not set. */
      fundingSourceCode: z.string(),
      /** The partner's name, or what "Other" is. */
      fundingDetail: z.string(),
      externalReference: textOrNull().pipe(S.externalReference),
    })
    .superRefine((v, ctx) => {
      if (rules.lotPicker && rules.create && !v.lotId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lotId"], message: "Choose a lot, or New lot" });
      }
      if (rules.lotPicker && v.lotId === NEW_LOT) {
        const title = v.newLotTitle.trim();
        if (title.length < 3) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["newLotTitle"], message: "Enter the lot title, e.g. Renovation of Public Schools" });
        } else if (title.length > LOT_TITLE_MAX) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["newLotTitle"], message: `At most ${LOT_TITLE_MAX} characters` });
        }
      }
      if (rules.codeEditable && !v.lotId && !PROJECT_CODE_PREFIX_REGEX.test(v.codePrefix.trim().toUpperCase())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["codePrefix"], message: "Format must be e.g. LKK-402 or ABJ-105" });
      }
      const funding = FUNDING_SOURCES.find((f) => f.code === v.fundingSourceCode);
      if (funding?.needsDetail) {
        const d = v.fundingDetail.trim();
        if (d.length < 2) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["fundingDetail"],
            message: funding.code === "DEVELOPMENT_PARTNER" ? "Name the development partner" : "Say what the funding source is",
          });
        } else if (d.length > 90) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fundingDetail"], message: "At most 90 characters" });
        }
      }
    })
    .transform((v): CreateProjectDraftRequest => {
      const lotChoice: LotChoice | undefined =
        rules.lotPicker && v.lotId
          ? v.lotId === NEW_LOT
            ? { newLotTitle: v.newLotTitle.trim() }
            : { lotId: v.lotId }
          : undefined;
      const funding = FUNDING_SOURCES.find((f) => f.code === v.fundingSourceCode);
      return {
        name: v.name,
        ...(rules.codeEditable && !lotChoice ? { codePrefix: v.codePrefix.trim().toUpperCase() } : {}),
        ...(lotChoice ? { lotChoice } : {}),
        stateCode: v.stateCode || null,
        lgaCode: v.lgaCode || null,
        description: v.description,
        totalBudgetNgn: v.totalBudgetNgn,
        projectTypeId: v.projectTypeId,
        regionId: v.regionId,
        interventionYear: v.interventionYear,
        fundingSourceCode: (funding?.code ?? null) as FundingSourceCode | null,
        // The server stores the text (label, or "label: detail"); only the detail is sent.
        ...(funding ? { fundingSource: funding.needsDetail ? v.fundingDetail.trim() : undefined } : {}),
        externalReference: v.externalReference,
      };
    });
}
export type BasicsSchema = ReturnType<typeof basicsFormSchema>;
export type BasicsValues = z.input<BasicsSchema>;

export const EMPTY_BASICS: BasicsValues = {
  name: "",
  codePrefix: "",
  stateCode: "",
  lgaCode: "",
  description: "",
  totalBudgetNgn: "",
  projectTypeId: "",
  regionId: "",
  interventionYear: "",
  lotId: "",
  newLotTitle: "",
  fundingSourceCode: "",
  fundingDetail: "",
  externalReference: "",
};

/** The basics schema for this tenant: the delivery model is required when it has project types. */
export function useBasicsSchema(typeLocked: boolean, rules: BasicsFormRules) {
  const types = useProjectTypesQuery(false).data ?? NO_TYPES;
  const typeRequired = !typeLocked && types.length > 0;
  const { create, lotPicker, codeEditable, stateRequired, yearLocked } = rules;
  return useMemo(
    () => basicsFormSchema({ typeRequired, rules: { create, lotPicker, codeEditable, stateRequired, yearLocked } }),
    [typeRequired, create, lotPicker, codeEditable, stateRequired, yearLocked]
  );
}

/** Server error codes that belong to one field (client demo updates C1, C3; UBEC IRL). */
const ERROR_CODE_FIELD: Record<string, string> = {
  INTERVENTION_YEAR_NOT_ALLOWED: "interventionYear",
  INTERVENTION_YEAR_REQUIRED: "interventionYear",
  LGA_NOT_IN_STATE: "lgaCode",
  LOT_NOT_FOUND: "lotId",
  PROJECT_CODE_REQUIRED: "lotId",
  EXTERNAL_REFERENCE_TAKEN: "externalReference",
};

/** Request paths that differ from the form's field names. */
function basicsFieldFor(path: string): string | null {
  if (path === "lotChoice.newLotTitle") return "newLotTitle";
  if (path.startsWith("lotChoice")) return "lotId";
  if (path === "stateLocation") return "stateCode";
  if (path === "lgaLocation") return "lgaCode";
  if (path === "fundingSource") return "fundingDetail";
  return path;
}

/**
 * A failed create or save: a coded error next to its field, Zod issues on their fields. Returns the
 * message for the form (null when it went on a field).
 */
export function showBasicsServerErrors(form: AnyForm, err: unknown): string | null {
  const body = (err as { response?: { data?: { error?: { code?: string; message?: string } } } })?.response?.data?.error;
  const field = body?.code ? ERROR_CODE_FIELD[body.code] : undefined;
  if (field) {
    form.setError(field, { type: "server", message: body?.message || "Check this field" }, { shouldFocus: false });
    return null;
  }
  return applyServerErrors(form, err, basicsFieldFor);
}

/** What an existing project shows read-only beside the form (older free text, its lot and code). */
export interface BasicsContext {
  codePrefix: string;
  lot: ProjectSetupDto["basics"]["lot"];
  stateLocation: string | null;
  lgaLocation: string | null;
  fundingSource: string | null;
  interventionYearOptions?: number[];
  interventionYear: number | null;
}

/** The basics form, shared by the "new project" page and the basics step. */
export function BasicsForm({
  form,
  general,
  disabled,
  codePrefixLocked,
  rules = CREATE_RULES,
  context,
}: {
  form: ZodForm<BasicsSchema>;
  /** Section-level message (a failed save). */
  general?: string | null;
  disabled?: boolean;
  codePrefixLocked?: boolean;
  rules?: BasicsFormRules;
  /** Left out for a new project. */
  context?: BasicsContext;
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
  // Client demo updates C3: lots and allowed years (the saved year is added for older drafts).
  const needLots = rules.lotPicker || !context?.interventionYearOptions;
  const lotsQuery = useProjectLotsQuery(context?.interventionYear ?? null, needLots);
  useEffect(() => {
    if (values.projectTypeId || typeLocked || types.length === 0) return;
    const preferred = types.find((t) => t.isDefault) ?? types[0];
    setField(form, "projectTypeId", preferred.id);
  }, [types, values.projectTypeId, typeLocked, form]);
  // A new project starts in the current fiscal year (the first allowed year); the person can pick the next.
  const firstAllowedYear = lotsQuery.data?.allowedInterventionYears[0];
  useEffect(() => {
    if (!rules.create || values.interventionYear || !firstAllowedYear) return;
    setField(form, "interventionYear", String(firstAllowedYear));
  }, [rules.create, values.interventionYear, firstAllowedYear, form]);
  const regionOptions = useMemo(() => {
    const top = regions
      .filter((r) => !r.parentRegionId)
      .sort((a, b) => a.name.localeCompare(b.name));
    return [
      { value: "", label: "None" },
      ...top.flatMap((r) => [
        { value: r.id, label: r.name },
        ...regions
          .filter((a) => a.parentRegionId === r.id)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((a) => ({ value: a.id, label: `${r.name} › ${a.name}` })),
      ]),
    ];
  }, [regions]);
  const yearOptions = useMemo(() => {
    const years = new Set<number>(context?.interventionYearOptions ?? lotsQuery.data?.allowedInterventionYears ?? []);
    if (context?.interventionYear) years.add(context.interventionYear);
    const sorted = [...years].sort((a, b) => a - b).map((y) => ({ value: String(y), label: String(y) }));
    return rules.create || context?.interventionYear ? sorted : [{ value: "", label: "Not set" }, ...sorted];
  }, [context?.interventionYearOptions, context?.interventionYear, lotsQuery.data, rules.create]);
  const err = (name: string) => visibleError(form, name);
  const term = useTerm();
  const funding = FUNDING_SOURCES.find((f) => f.code === values.fundingSourceCode);
  const showCodeInput = rules.codeEditable && !values.lotId;

  return (
    <StepSection
      title="Delivery model and project details"
      description="The delivery model first: it pre-fills the owner, funder and retention. Then what the project is, its intervention year and lot, where it is, and its budget."
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
                    <span className="mt-1 block text-[11px] text-slate-600">
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
          <p className={labelClass} id="basics-intervention-year-label">
            Intervention year {rules.create && <span className="text-red-500">*</span>}
          </p>
          <CustomSelect
            value={values.interventionYear ?? ""}
            onChange={(v) => {
              setField(form, "interventionYear", v, true);
              // A lot belongs to one year: choosing another year drops an existing lot.
              if (values.lotId && values.lotId !== NEW_LOT) setField(form, "lotId", "", true);
            }}
            options={yearOptions}
            placeholder={lotsQuery.isLoading ? "Loading…" : "Choose the year"}
            ariaLabel="Intervention year"
            disabled={disabled || rules.yearLocked}
            error={err("interventionYear")}
          />
          {rules.yearLocked && <Note message="Part of the project code." />}
        </div>
        {rules.lotPicker ? (
          <LotPicker
            form={form}
            values={values}
            lots={lotsQuery.data}
            loading={lotsQuery.isLoading}
            failed={lotsQuery.isError}
            required={rules.create}
            disabled={disabled}
            showCodeInput={showCodeInput}
            codePrefixLocked={codePrefixLocked}
          />
        ) : (
          <ProjectCodeReadOnly context={context} codePrefixLocked={codePrefixLocked} />
        )}
        <AdminAreaSelect
          idPrefix="basics"
          stateCode={values.stateCode ?? ""}
          lgaCode={values.lgaCode ?? ""}
          onStateChange={(v) => setField(form, "stateCode", v, true)}
          onLgaChange={(v) => setField(form, "lgaCode", v, true)}
          stateError={err("stateCode")}
          lgaError={err("lgaCode")}
          disabled={disabled}
          stateRequired={rules.stateRequired}
          legacyStateText={context?.stateLocation}
          legacyLgaText={context?.lgaLocation}
        />
        {regions.length > 0 && (
          <div className="md:col-span-2">
            <CustomSelect
              label="Workspace zone (for KPI filters)"
              hint="The workspace's own grouping, used by portfolio filters and KPIs. It is not the geopolitical Zone, which follows the State."
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
        <div className="md:col-span-2">
          <CustomSelect
            label="Funding source"
            value={values.fundingSourceCode ?? ""}
            onChange={(v) => setField(form, "fundingSourceCode", v, true)}
            options={[{ value: "", label: "Not set" }, ...FUNDING_SOURCES.map((f) => ({ value: f.code, label: f.label }))]}
            disabled={disabled}
            error={err("fundingSourceCode")}
          />
          {!values.fundingSourceCode && context?.fundingSource && (
            <p className="mt-1 text-[11px] text-slate-500">Recorded as “{context.fundingSource}”.</p>
          )}
        </div>
        {funding?.needsDetail && (
          <div className="md:col-span-2">
            <label className={labelClass} htmlFor="basics-funding-detail">
              {funding.code === "DEVELOPMENT_PARTNER" ? "Development partner" : "Funding source details"}{" "}
              <span className="text-red-500">*</span>
            </label>
            <input
              id="basics-funding-detail"
              maxLength={90}
              placeholder={funding.code === "DEVELOPMENT_PARTNER" ? "e.g. World Bank (BESDA)" : undefined}
              className={inputClass(Boolean(err("fundingDetail")))}
              {...textProps(form, "fundingDetail")}
              disabled={disabled}
            />
            <FieldError form={form} name="fundingDetail" />
          </div>
        )}
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

/**
 * Client demo updates C3: choose a lot of the intervention year, or start the next one, with a
 * preview of the code the server will assign. A draft without a lot may keep its older code.
 */
function LotPicker({
  form,
  values,
  lots,
  loading,
  failed,
  required,
  disabled,
  showCodeInput,
  codePrefixLocked,
}: {
  form: ZodForm<BasicsSchema>;
  values: BasicsValues;
  lots: ProjectLotListDto | undefined;
  loading: boolean;
  failed: boolean;
  required: boolean;
  disabled?: boolean;
  showCodeInput: boolean;
  codePrefixLocked?: boolean;
}) {
  const err = (name: string) => visibleError(form, name);
  const year = values.interventionYear ? Number(values.interventionYear) : null;
  const yearDto = year ? lots?.years.find((y) => y.interventionYear === year) : undefined;
  const options = useMemo(
    () => [
      ...(required ? [] : [{ value: "", label: "No lot (keep the current code)" }]),
      ...(yearDto?.lots ?? []).map((l) => ({
        value: l.id,
        label: `LOT ${l.number} · ${l.title} · ${l.projectCount} ${l.projectCount === 1 ? "project" : "projects"}`,
      })),
      { value: NEW_LOT, label: "New lot…" },
    ],
    [required, yearDto]
  );
  const chosen = yearDto?.lots.find((l) => l.id === values.lotId);
  const preview = !year
    ? null
    : chosen
      ? formatLotBatch(chosen.number, chosen.nextBatchNumber)
      : values.lotId === NEW_LOT && yearDto
        ? formatLotBatch(yearDto.nextLotNumber, 1)
        : null;

  return (
    <>
      <div className="md:col-span-2">
        <p className={labelClass} id="basics-lot-label">
          Lot {required && <span className="text-red-500">*</span>}
        </p>
        <CustomSelect
          value={values.lotId ?? ""}
          onChange={(v) => setField(form, "lotId", v, true)}
          options={options}
          placeholder={!year ? "Choose the intervention year first" : loading ? "Loading…" : "Choose a lot"}
          ariaLabel="Lot"
          searchable={(yearDto?.lots.length ?? 0) > 8}
          disabled={disabled || !year || loading}
          error={err("lotId")}
        />
        {failed && <Note message="The lots could not be loaded. Reload the page to try again." />}
        {!err("lotId") && preview && (
          <p className="mt-1 text-[11px] text-slate-600" aria-live="polite">
            Will be <span className="font-bold text-slate-900">{preview}</span> · Intervention year {year}. The number is given when the project is saved.
          </p>
        )}
      </div>
      {values.lotId === NEW_LOT ? (
        <div className="md:col-span-2">
          <label className={labelClass} htmlFor="basics-new-lot-title">
            Lot title <span className="text-red-500">*</span>
          </label>
          <input
            id="basics-new-lot-title"
            maxLength={LOT_TITLE_MAX}
            placeholder="e.g. Renovation, Equipment and Furnishings of Public Schools"
            className={inputClass(Boolean(err("newLotTitle")))}
            {...textProps(form, "newLotTitle")}
            disabled={disabled}
          />
          <FieldError form={form} name="newLotTitle" />
        </div>
      ) : showCodeInput ? (
        <div className="md:col-span-2">
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
          {!err("codePrefix") && <Note message="Choose a lot to give the project a lot and batch code instead." />}
        </div>
      ) : (
        <div className="hidden md:block md:col-span-2" aria-hidden="true" />
      )}
    </>
  );
}

/** A project whose code can no longer change: the code as people read it, and its lot. */
function ProjectCodeReadOnly({ context, codePrefixLocked }: { context?: BasicsContext; codePrefixLocked?: boolean }) {
  if (!context) return null;
  return (
    <div className="md:col-span-4">
      <p className={labelClass}>Project code</p>
      <p className="text-sm font-bold text-slate-900 tabular-nums">{formatProjectCode(context.codePrefix)}</p>
      {context.lot && (
        <p className="mt-0.5 text-[11px] text-slate-600">
          LOT {context.lot.number} · {context.lot.title} · Intervention year {context.lot.interventionYear}
        </p>
      )}
      {codePrefixLocked && <Note message="Fixed once the project is active." />}
    </div>
  );
}

/** The detail part of a stored funding text ("Development partner: World Bank" → "World Bank"). */
function fundingDetailOf(code: FundingSourceCode | null, text: string | null): string {
  const option = FUNDING_SOURCES.find((f) => f.code === code);
  if (!option?.needsDetail || !text) return "";
  const t = text.trim();
  if (t.toLowerCase().startsWith(`${option.label.toLowerCase()}:`)) return t.slice(option.label.length + 1).trim();
  return t.toLowerCase() === option.label.toLowerCase() ? "" : t;
}

function basicsFrom(setup: ProjectSetupDto): BasicsValues {
  const b = setup.basics;
  // Older projects recorded free text: preselect the codes when the text names a known state, LGA or fund.
  const stateCode = b.stateCode ?? findStateByName(b.stateLocation)?.code ?? "";
  const lgaCode = b.lgaCode ?? (stateCode ? findLgaByName(stateCode, b.lgaLocation)?.code : undefined) ?? "";
  const fundingSourceCode = b.fundingSourceCode ?? fundingSourceCodeFromText(b.fundingSource);
  return {
    name: b.name,
    codePrefix: b.codePrefix,
    stateCode,
    lgaCode,
    description: b.description ?? "",
    totalBudgetNgn: b.totalBudgetNgn === null ? "" : String(b.totalBudgetNgn),
    projectTypeId: b.projectType?.id ?? "",
    regionId: b.region?.id ?? "",
    interventionYear: b.interventionYear === null ? "" : String(b.interventionYear),
    lotId: "",
    newLotTitle: "",
    fundingSourceCode: fundingSourceCode ?? "",
    fundingDetail: fundingDetailOf(fundingSourceCode, b.fundingSource),
    externalReference: b.externalReference ?? "",
  };
}

/** The form's rules for a saved project. */
function rulesFor(setup: ProjectSetupDto, codePrefixLocked: boolean): BasicsFormRules {
  const b = setup.basics;
  const hasLot = Boolean(b.lot);
  const lotPicker = !codePrefixLocked && !hasLot;
  return {
    create: false,
    lotPicker,
    codeEditable: lotPicker,
    stateRequired: Boolean(b.stateCode) || !b.stateLocation,
    yearLocked: hasLot,
  };
}

/**
 * Leaves out what an older project only has as text and the person did not set: an empty state,
 * LGA or funding select there means "not chosen", not "clear it".
 */
function keepOlderValues(body: CreateProjectDraftRequest, saved: ProjectSetupDto["basics"]): CreateProjectDraftRequest {
  const out = { ...body };
  if (out.stateCode === null && !saved.stateCode) delete out.stateCode;
  if (out.lgaCode === null && !saved.lgaCode) delete out.lgaCode;
  if (out.fundingSourceCode === null && !saved.fundingSourceCode) {
    delete out.fundingSourceCode;
    delete out.fundingSource;
  } else if (out.fundingSourceCode === null) {
    out.fundingSource = null;
  }
  return out;
}

/** Section `basics` (step 1 "Project"): delivery model first, then name, year, lot, location and budget. */
export function BasicsSection({ projectId, setup, mode, readOnly }: StepProps) {
  const initial = useMemo(() => basicsFrom(setup), [setup]);
  const codePrefixLocked = mode === "settings" || setup.status !== "DRAFT";
  const rules = useMemo(() => rulesFor(setup, codePrefixLocked), [setup, codePrefixLocked]);
  const schema = useBasicsSchema(codePrefixLocked, rules);
  const section = useSectionForm(schema, initial);
  const { dirty } = section;
  const [general, setGeneral] = useState<string | null>(null);
  const save = useSaveSetupStepMutation(projectId);
  const latest = useLatestSetup(projectId, setup);
  const b = setup.basics;
  const context: BasicsContext = {
    codePrefix: b.codePrefix,
    lot: b.lot ?? null,
    stateLocation: b.stateCode ? null : b.stateLocation,
    lgaLocation: b.lgaCode ? null : b.lgaLocation,
    fundingSource: b.fundingSourceCode ? null : b.fundingSource,
    interventionYearOptions: b.interventionYearOptions,
    interventionYear: b.interventionYear,
  };

  useRegisterSection(
    "basics",
    dirty,
    async (opts) => {
      if (!dirty && !opts?.force) return true;
      const parsed = await section.submit(dirty ? undefined : basicsFrom(latest()));
      if (!parsed) return false;
      const body = keepOlderValues(parsed, latest().basics);
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
        setGeneral(showBasicsServerErrors(section.form as unknown as AnyForm, err));
        return false;
      }
    },
    section,
  );

  const needs = [
    { label: "Site address", value: b.siteAddress },
    {
      label: "Strategic justification",
      value: b.strategicJustification,
    },
    { label: "Assumptions", value: b.assumptions },
  ].filter((n) => n.value);
  return (
    <>
      <BasicsForm
        form={section.form}
        general={general}
        disabled={readOnly}
        codePrefixLocked={codePrefixLocked}
        rules={rules}
        context={context}
      />
      {/* Client demo updates E3 (wave 3): the approved list row, saved on its own (not with the section). */}
      <StepSection
        title="Approved list"
        description="The row of the annual approved list (Direct Intervention schedule or the state's BEAP) this project implements. The budget is checked against its estimate."
      >
        <ApprovedListRowPicker projectId={projectId} interventionYear={b.interventionYear} readOnly={readOnly} />
      </StepSection>
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
