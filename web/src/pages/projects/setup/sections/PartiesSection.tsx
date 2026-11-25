import React, { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import {
  BENEFICIARY_TYPE_META,
  BeneficiaryTypeEnum,
  OrganizationRefSchema,
  ProjectBeneficiaryInputSchema,
  ProjectPartiesStepSchema,
  type BeneficiaryType,
  type OrganizationRef,
  type ProjectSetupDto,
} from "@insite/shared";
import { FieldError, visibleError } from "../../../../lib/forms";
import { OrganizationInput } from "../../../../components/organizations/OrganizationInput";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import { useOrganizationsQuery } from "../../../../queries/organizations/useOrganizationQueries";
import { CustomSelect } from "../../../../components/common";
import { useTerm } from "../../../../lib/auth-context";
import {
  choiceOrNull,
  inputClass,
  labelClass,
  setField,
  StepSection,
  textOrNull,
  textProps,
  useLatestSetup,
  useRegisterSection,
  useSectionForm,
  type StepProps,
} from "../setupContext";

/** Phase 11: a beneficiary row (exactly one primary when there are any). */
interface BeneficiaryRow {
  key: string;
  id?: string;
  name: string;
  beneficiaryType: BeneficiaryType;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  isPrimary: boolean;
}

interface PartiesValues {
  owner: string;
  beneficiaries: BeneficiaryRow[];
  monitor: OrganizationRef | null;
  monitorName: string | null;
  lender: OrganizationRef | null;
  lenderName: string | null;
}

let rowSeq = 0;
const newKey = () => `row-${++rowSeq}`;

const B = ProjectBeneficiaryInputSchema.shape;

/**
 * Form schema: the rows hold text; the output is the request body (`ProjectPartiesStepSchema`: one
 * primary, names, a valid contact email). Display-only fields (row key, organisation names) are
 * dropped. `contractors` is never sent: the contractor section owns it (D-R6.4).
 */
const PartiesFormSchema = z
  .object({
    owner: choiceOrNull().pipe(ProjectPartiesStepSchema.shape.owningOrganizationId),
    beneficiaries: z.array(
      z.object({
        key: z.string(),
        id: B.id,
        name: B.name,
        beneficiaryType: B.beneficiaryType,
        contactName: textOrNull().pipe(B.contactName),
        contactEmail: textOrNull().pipe(z.string().email("Enter an email address").max(200).nullable()),
        contactPhone: textOrNull().pipe(B.contactPhone),
        address: textOrNull().pipe(B.address),
        isPrimary: z.boolean(),
      })
    ),
    monitor: OrganizationRefSchema.nullable(),
    monitorName: z.string().nullable(),
    lender: OrganizationRefSchema.nullable(),
    lenderName: z.string().nullable(),
  })
  .transform((v) => ({
    owningOrganizationId: v.owner,
    beneficiaries: v.beneficiaries.map(({ key: _k, ...b }) => b),
    monitorOrganization: v.monitor,
    lenderOrganization: v.lender,
  }))
  .pipe(ProjectPartiesStepSchema);

/** Server paths → form fields. */
const partiesPath = (path: string) =>
  path === "owningOrganizationId"
    ? "owner"
    : path.startsWith("monitorOrganization")
      ? "monitor"
      : path.startsWith("lenderOrganization")
        ? "lender"
        : path;

function partiesFrom(setup: ProjectSetupDto): PartiesValues {
  const p = setup.parties;
  return {
    owner: p.owningOrganization?.id ?? "",
    beneficiaries: p.beneficiaries.map<BeneficiaryRow>((b) => ({
      key: b.id,
      id: b.id,
      name: b.name,
      beneficiaryType: b.beneficiaryType,
      contactName: b.contactName ?? "",
      contactEmail: b.contactEmail ?? "",
      contactPhone: b.contactPhone ?? "",
      address: b.address ?? "",
      isPrimary: b.isPrimary,
    })),
    monitor: p.monitorOrganization ? { id: p.monitorOrganization.id } : null,
    monitorName: p.monitorOrganization?.name ?? null,
    lender: p.lenderOrganization ? { id: p.lenderOrganization.id } : null,
    lenderName: p.lenderOrganization?.name ?? null,
  };
}

/** Compares form state without display-only fields. */
const partiesKey = (s: PartiesValues) =>
  JSON.stringify({
    owner: s.owner,
    beneficiaries: s.beneficiaries.map(({ key: _k, ...rest }) => rest),
    monitor: s.monitor,
    lender: s.lender,
  });

/**
 * Section `parties` (step 1 "Project"): the school (primary beneficiary, others below it) and the
 * organisations (owner, monitor, funder; pre-filled by the delivery model). Redesign R6a: the
 * contractor moved to its own section on step 2, so this section never sends `contractors`.
 */
export function PartiesSection({ projectId, setup, readOnly }: StepProps) {
  const term = useTerm();
  const rules = setup.parties.rules;
  const orgsQuery = useOrganizationsQuery({});
  const ownerOptions = useMemo(() => {
    const allowed = rules.allowedOwningOrganizationIds;
    const list = (orgsQuery.data ?? []).filter((o) => !allowed || allowed.includes(o.id));
    const current = setup.parties.owningOrganization;
    const options = [{ value: "", label: "Not set" }, ...list.map((o) => ({ value: o.id, label: o.name }))];
    if (current && !options.some((o) => o.value === current.id)) options.push({ value: current.id, label: current.name });
    return options;
  }, [orgsQuery.data, rules.allowedOwningOrganizationIds, setup.parties.owningOrganization]);
  const initial = useMemo(() => partiesFrom(setup), [setup]);
  const section = useSectionForm(PartiesFormSchema, initial, partiesKey);
  const { form, dirty } = section;
  const state = section.values as PartiesValues;
  const [general, setGeneral] = useState<string | null>(null);
  const save = useSaveSetupStepMutation(projectId);
  const latest = useLatestSetup(projectId, setup);
  const err = (name: string) => visibleError(form, name);

  const setBeneficiaries = (next: BeneficiaryRow[], touch = false) => setField(form, "beneficiaries", next, touch);
  const setBeneficiary = (key: string, patch: Partial<BeneficiaryRow>) =>
    setBeneficiaries(
      state.beneficiaries.map((b) => {
        if (b.key === key) return { ...b, ...patch };
        if (patch.isPrimary) return { ...b, isPrimary: false };
        return b;
      })
    );
  const addBeneficiary = () =>
    setBeneficiaries([
      ...state.beneficiaries,
      {
        key: newKey(),
        name: "",
        beneficiaryType: "SCHOOL" as BeneficiaryType,
        contactName: "",
        contactEmail: "",
        contactPhone: "",
        address: "",
        isPrimary: state.beneficiaries.length === 0,
      },
    ]);
  const removeBeneficiary = (key: string) => {
    const rest = state.beneficiaries.filter((b) => b.key !== key);
    // Keep one primary.
    if (rest.length && !rest.some((b) => b.isPrimary)) rest[0] = { ...rest[0], isPrimary: true };
    setBeneficiaries(rest, true);
  };

  useRegisterSection(
    "parties",
    dirty,
    async (opts) => {
      if (!dirty && !opts?.force) return true;
      const body = await section.submit(dirty ? undefined : partiesFrom(latest()));
      if (!body) return false;
      try {
        await save.mutateAsync({ sectionId: "parties", body, silent: opts?.silent });
        section.reset(partiesFrom(latest()));
        setGeneral(null);
        return true;
      } catch (error) {
        setGeneral(section.showServerErrors(error, partiesPath));
        return false;
      }
    },
    section
  );

  const beneficiaryWord = term("beneficiary", { lower: true });
  return (
    <div className="space-y-5">
      <StepSection
        title={`${term("beneficiary")}${rules.beneficiaryRequired ? "" : " (optional)"}`}
        description={`Who the project is for. The primary ${beneficiaryWord} comes first and pre-fills the handover response; others are listed below it.`}
        actions={
          !readOnly && (
            <button
              type="button"
              onClick={addBeneficiary}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Plus className="w-3.5 h-3.5" /> Add {beneficiaryWord}
            </button>
          )
        }
      >
        {general && <p className="text-xs font-medium text-red-600">{general}</p>}
        {state.beneficiaries.length === 0 && <p className="text-xs text-slate-500">None yet.</p>}
        <div className="space-y-3">
          {[...state.beneficiaries]
            .map((b, i) => ({ b, i }))
            .sort((x, y) => Number(y.b.isPrimary) - Number(x.b.isPrimary))
            .map(({ b, i }) => {
              const fid = (f: string) => `beneficiary-${b.key}-${f}`;
              return (
                <div key={b.key} className={`rounded-xl border p-3 grid grid-cols-1 md:grid-cols-12 gap-3 items-start ${b.isPrimary ? "border-brand-primary/40 bg-brand-primary/5" : "border-slate-200"}`}>
                  <div className="md:col-span-4">
                    <label className={labelClass} htmlFor={fid("name")}>
                      Name {b.isPrimary && <span className="font-normal text-brand-primary">(primary)</span>}
                    </label>
                    <input
                      id={fid("name")}
                      className={inputClass(Boolean(err(`beneficiaries.${i}.name`)))}
                      maxLength={200}
                      {...textProps(form, `beneficiaries.${i}.name`)}
                      disabled={readOnly}
                    />
                    <FieldError form={form} name={`beneficiaries.${i}.name`} />
                  </div>
                  <div className="md:col-span-2">
                    <CustomSelect
                      label="Type"
                      value={b.beneficiaryType}
                      onChange={(v) => setBeneficiary(b.key, { beneficiaryType: v as BeneficiaryType })}
                      options={BeneficiaryTypeEnum.options.map((t) => ({ value: t, label: BENEFICIARY_TYPE_META[t].label }))}
                      size="sm"
                      disabled={readOnly}
                    />
                  </div>
                  <div className="md:col-span-3">
                    <label className={labelClass} htmlFor={fid("contact")}>Contact name</label>
                    <input id={fid("contact")} className={inputClass(Boolean(err(`beneficiaries.${i}.contactName`)))} maxLength={160} {...textProps(form, `beneficiaries.${i}.contactName`)} disabled={readOnly} />
                    <FieldError form={form} name={`beneficiaries.${i}.contactName`} />
                  </div>
                  <div className="md:col-span-3">
                    <label className={labelClass} htmlFor={fid("email")}>Contact email</label>
                    <input
                      id={fid("email")}
                      type="email"
                      className={inputClass(Boolean(err(`beneficiaries.${i}.contactEmail`)))}
                      maxLength={200}
                      {...textProps(form, `beneficiaries.${i}.contactEmail`)}
                      disabled={readOnly}
                    />
                    <FieldError form={form} name={`beneficiaries.${i}.contactEmail`} />
                  </div>
                  <div className="md:col-span-3">
                    <label className={labelClass} htmlFor={fid("phone")}>Contact phone</label>
                    <input id={fid("phone")} className={inputClass(Boolean(err(`beneficiaries.${i}.contactPhone`)))} maxLength={32} {...textProps(form, `beneficiaries.${i}.contactPhone`)} disabled={readOnly} />
                    <FieldError form={form} name={`beneficiaries.${i}.contactPhone`} />
                  </div>
                  <div className="md:col-span-6">
                    <label className={labelClass} htmlFor={fid("address")}>Address</label>
                    <input id={fid("address")} className={inputClass(Boolean(err(`beneficiaries.${i}.address`)))} maxLength={400} {...textProps(form, `beneficiaries.${i}.address`)} disabled={readOnly} />
                    <FieldError form={form} name={`beneficiaries.${i}.address`} />
                  </div>
                  <div className="md:col-span-3 flex items-center gap-4 pt-1 md:pt-6">
                    <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                      <input type="radio" name="primary-beneficiary" checked={b.isPrimary} onChange={() => setBeneficiary(b.key, { isPrimary: true })} disabled={readOnly} />
                      Primary
                    </label>
                    {!readOnly && (
                      <button type="button" onClick={() => removeBeneficiary(b.key)} className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:underline">
                        <Trash2 className="w-3.5 h-3.5" /> Remove
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
        <FieldError form={form} name="beneficiaries" />
      </StepSection>

      <StepSection
        title="Organisations"
        description={`The owning organisation is accountable for delivery; the ${term("monitorParty", { lower: true })} certifies progress; the ${term("funderParty", { lower: true })} funds the project. The delivery model pre-fills them.`}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <CustomSelect
              label={`Owning organisation${rules.owningOrganizationRequired ? " *" : ""}`}
              value={state.owner}
              onChange={(v) => setField(form, "owner", v, true)}
              options={ownerOptions}
              searchable={ownerOptions.length > 8}
              disabled={readOnly}
              error={err("owner")}
            />
          </div>
          <OrganizationInput
            label={`${term("monitorParty")} organisation${rules.monitorRequired ? "" : " (optional)"}`}
            tag="ADVISORY_MONITOR"
            value={state.monitor}
            selectedName={state.monitorName}
            onChange={(v) => {
              form.setValue("monitorName", null);
              setField(form, "monitor", v, true);
            }}
            error={err("monitor")}
            disabled={readOnly}
          />
          <OrganizationInput
            label={`${term("funderParty")}${rules.funderRequired ? "" : " (optional)"}`}
            tag="FINANCIER_LENDER"
            value={state.lender}
            selectedName={state.lenderName}
            onChange={(v) => {
              form.setValue("lenderName", null);
              setField(form, "lender", v, true);
            }}
            error={err("lender")}
            disabled={readOnly}
          />
        </div>
      </StepSection>
    </div>
  );
}
