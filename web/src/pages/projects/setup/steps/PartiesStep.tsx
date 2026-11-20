import React, { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  BENEFICIARY_TYPE_META,
  BeneficiaryTypeEnum,
  CONTRACTOR_EXECUTION_MODE_META,
  TRADE_CODE_REGEX,
  type BeneficiaryType,
  type ContractorExecutionMode,
  type OrganizationRef,
  type ProjectPartiesStep,
} from "@insite/shared";
import { OrganizationInput } from "../../../../components/organizations/OrganizationInput";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import { useOrganizationsQuery, useTenantSettingsQuery } from "../../../../queries/organizations/useOrganizationQueries";
import { CustomSelect } from "../../../../components/common";
import { useTerm } from "../../../../lib/auth-context";
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

interface ContractorRow {
  key: string;
  id?: string;
  organization: OrganizationRef | null;
  organizationName: string | null;
  tradeCategory: string;
  tradeCode: string;
  isMainContractor: boolean;
  allocatedBudget: string;
  allowFieldReporting: boolean;
  plannedMobilizationDate: string;
  hasActivity: boolean;
}

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

const MODES: ContractorExecutionMode[] = ["SINGLE_CONTRACTOR", "MAIN_PLUS_SUBS_UNIFIED_IPC", "MULTI_PRIME_SEPARATE_IPC"];

let rowSeq = 0;
const newKey = () => `row-${++rowSeq}`;

export function PartiesStep({ projectId, setup, readOnly }: StepProps) {
  const settings = useTenantSettingsQuery();
  const currency = settings.data?.defaultCurrency ?? "NGN";
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
  const initial = useMemo(
    () => ({
      owner: setup.parties.owningOrganization?.id ?? "",
      beneficiaries: setup.parties.beneficiaries.map<BeneficiaryRow>((b) => ({
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
      monitor: (setup.parties.monitorOrganization ? { id: setup.parties.monitorOrganization.id } : null) as OrganizationRef | null,
      monitorName: setup.parties.monitorOrganization?.name ?? null,
      lender: (setup.parties.lenderOrganization ? { id: setup.parties.lenderOrganization.id } : null) as OrganizationRef | null,
      lenderName: setup.parties.lenderOrganization?.name ?? null,
      mode: setup.parties.contractorExecutionMode,
      contractors: setup.parties.contractors.map<ContractorRow>((c) => ({
        key: c.id,
        id: c.id,
        organization: { id: c.organizationId },
        organizationName: c.organizationName,
        tradeCategory: c.tradeCategory,
        tradeCode: c.tradeCode,
        isMainContractor: c.isMainContractor,
        allocatedBudget: c.allocatedBudgetNgn === null ? "" : String(c.allocatedBudgetNgn),
        allowFieldReporting: c.allowFieldReporting,
        plannedMobilizationDate: c.plannedMobilizationDate ?? "",
        hasActivity: c.hasActivity,
      })),
    }),
    [setup.parties]
  );
  const [state, setState] = useState(initial);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const save = useSaveSetupStepMutation(projectId);
  const dirty = JSON.stringify(strip(state)) !== JSON.stringify(strip(initial));

  const mode = state.mode;
  const multiPrime = mode === "MULTI_PRIME_SEPARATE_IPC";
  const unified = mode === "MAIN_PLUS_SUBS_UNIFIED_IPC";
  const single = mode === "SINGLE_CONTRACTOR";

  const setRow = (key: string, patch: Partial<ContractorRow>) =>
    setState((s) => ({
      ...s,
      contractors: s.contractors.map((c) => {
        if (c.key === key) return { ...c, ...patch };
        // Only one main contractor.
        if (patch.isMainContractor) return { ...c, isMainContractor: false };
        return c;
      }),
    }));

  const addRow = () =>
    setState((s) => ({
      ...s,
      contractors: [
        ...s.contractors,
        {
          key: newKey(),
          organization: null,
          organizationName: null,
          tradeCategory: s.contractors.length === 0 && s.mode !== "MULTI_PRIME_SEPARATE_IPC" ? "General works" : "",
          tradeCode: s.contractors.length === 0 && s.mode !== "MULTI_PRIME_SEPARATE_IPC" ? "GEN" : "",
          isMainContractor: s.contractors.length === 0,
          allocatedBudget: "",
          allowFieldReporting: true,
          plannedMobilizationDate: "",
          hasActivity: false,
        },
      ],
    }));

  const removeRow = (key: string) => setState((s) => ({ ...s, contractors: s.contractors.filter((c) => c.key !== key) }));

  const setBeneficiary = (key: string, patch: Partial<BeneficiaryRow>) =>
    setState((s) => ({
      ...s,
      beneficiaries: s.beneficiaries.map((b) => {
        if (b.key === key) return { ...b, ...patch };
        if (patch.isPrimary) return { ...b, isPrimary: false };
        return b;
      }),
    }));
  const addBeneficiary = () =>
    setState((s) => ({
      ...s,
      beneficiaries: [
        ...s.beneficiaries,
        {
          key: newKey(),
          name: "",
          beneficiaryType: "SCHOOL" as BeneficiaryType,
          contactName: "",
          contactEmail: "",
          contactPhone: "",
          address: "",
          isPrimary: s.beneficiaries.length === 0,
        },
      ],
    }));
  const removeBeneficiary = (key: string) =>
    setState((s) => {
      const rest = s.beneficiaries.filter((b) => b.key !== key);
      // Keep one primary.
      if (rest.length && !rest.some((b) => b.isPrimary)) rest[0] = { ...rest[0], isPrimary: true };
      return { ...s, beneficiaries: rest };
    });

  const buildBody = (): { body: ProjectPartiesStep | null; fields: Record<string, string> } => {
    const fields: Record<string, string> = {};
    state.contractors.forEach((c, i) => {
      if (!c.organization) fields[`contractors.${i}.organization`] = "Choose or enter the contractor";
      if (c.tradeCategory.trim().length < 2) fields[`contractors.${i}.tradeCategory`] = "Enter the trade";
      if (!TRADE_CODE_REGEX.test(c.tradeCode.trim().toUpperCase())) {
        fields[`contractors.${i}.tradeCode`] = "2 to 6 letters or digits";
      }
      if (c.allocatedBudget.trim() && (parseNumberInput(c.allocatedBudget) ?? -1) < 0) {
        fields[`contractors.${i}.allocatedBudgetNgn`] = "Enter an amount";
      }
    });
    state.beneficiaries.forEach((b, i) => {
      if (b.name.trim().length < 2) fields[`beneficiaries.${i}.name`] = "Enter the name";
      if (b.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.contactEmail.trim())) {
        fields[`beneficiaries.${i}.contactEmail`] = "Enter an email address";
      }
    });
    if (Object.keys(fields).length > 0) return { body: null, fields };
    return {
      body: {
        owningOrganizationId: state.owner || null,
        beneficiaries: state.beneficiaries.map((b) => ({
          ...(b.id ? { id: b.id } : {}),
          name: b.name.trim(),
          beneficiaryType: b.beneficiaryType,
          contactName: b.contactName.trim() || null,
          contactEmail: b.contactEmail.trim() || null,
          contactPhone: b.contactPhone.trim() || null,
          address: b.address.trim() || null,
          isPrimary: b.isPrimary,
        })),
        monitorOrganization: state.monitor,
        lenderOrganization: state.lender,
        contractorExecutionMode: state.mode,
        contractors: state.contractors.map((c) => ({
          ...(c.id ? { id: c.id } : {}),
          organization: c.organization!,
          tradeCategory: c.tradeCategory.trim(),
          tradeCode: c.tradeCode.trim().toUpperCase(),
          isMainContractor: single ? true : c.isMainContractor,
          allocatedBudgetNgn: c.allocatedBudget.trim() ? parseNumberInput(c.allocatedBudget) : null,
          allowFieldReporting: c.allowFieldReporting,
          plannedMobilizationDate: c.plannedMobilizationDate || null,
          plannedCompletionDate: null,
        })),
      },
      fields,
    };
  };

  useRegisterStep(dirty, async (opts) => {
    if (!dirty) return true;
    const { body, fields } = buildBody();
    if (!body) {
      setErrors({ fields, general: "Some fields need attention." });
      return false;
    }
    try {
      await save.mutateAsync({ stepId: "parties", body, silent: opts?.silent });
      setErrors(NO_ERRORS);
      return true;
    } catch (err) {
      setErrors(extractErrors(err));
      return false;
    }
  });

  return (
    <div className="space-y-5">
      <StepSection
        title={`Owner, ${term("monitorParty", { lower: true })} and ${term("funderParty", { lower: true })}`}
        description={`The owning organisation is accountable for delivery; the ${term("monitorParty", { lower: true })} certifies progress; the ${term("funderParty", { lower: true })} approves releases.`}
      >
        {errors.general && <p className="text-xs font-medium text-red-600">{errors.general}</p>}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <p className={labelClass}>
              Owning organisation {rules.owningOrganizationRequired && <span className="text-red-500">*</span>}
            </p>
            <CustomSelect
              value={state.owner}
              onChange={(v) => setState((s) => ({ ...s, owner: v }))}
              options={ownerOptions}
              searchable={ownerOptions.length > 8}
              disabled={readOnly}
            />
            <FieldError message={errors.fields.owningOrganizationId} />
          </div>
          <OrganizationInput
            label={`${term("monitorParty")} organisation${rules.monitorRequired ? "" : " (optional)"}`}
            tag="ADVISORY_MONITOR"
            value={state.monitor}
            selectedName={state.monitorName}
            onChange={(v) => setState((s) => ({ ...s, monitor: v, monitorName: null }))}
            error={errors.fields.monitorOrganization}
            disabled={readOnly}
          />
          <OrganizationInput
            label={`${term("funderParty")}${rules.funderRequired ? "" : " (optional)"}`}
            tag="FINANCIER_LENDER"
            value={state.lender}
            selectedName={state.lenderName}
            onChange={(v) => setState((s) => ({ ...s, lender: v, lenderName: null }))}
            error={errors.fields.lenderOrganization}
            disabled={readOnly}
          />
        </div>
      </StepSection>

      <StepSection
        title={`${term("beneficiary", { plural: true })}${rules.beneficiaryRequired ? "" : " (optional)"}`}
        description={`Who the project is for. The primary ${term("beneficiary", { lower: true })} pre-fills the handover link recipient.`}
        actions={
          !readOnly && (
            <button
              type="button"
              onClick={addBeneficiary}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Plus className="w-3.5 h-3.5" /> Add {term("beneficiary", { lower: true })}
            </button>
          )
        }
      >
        {state.beneficiaries.length === 0 && <p className="text-xs text-slate-500">None yet.</p>}
        <div className="space-y-3">
          {state.beneficiaries.map((b, i) => (
            <div key={b.key} className="rounded-xl border border-slate-200 p-3 grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
              <div className="md:col-span-4">
                <label className={labelClass}>Name</label>
                <input
                  className={inputClass(Boolean(errors.fields[`beneficiaries.${i}.name`]))}
                  value={b.name}
                  maxLength={200}
                  onChange={(e) => setBeneficiary(b.key, { name: e.target.value })}
                  disabled={readOnly}
                />
                <FieldError message={errors.fields[`beneficiaries.${i}.name`]} />
              </div>
              <div className="md:col-span-2">
                <p className={labelClass}>Type</p>
                <CustomSelect
                  value={b.beneficiaryType}
                  onChange={(v) => setBeneficiary(b.key, { beneficiaryType: v as BeneficiaryType })}
                  options={BeneficiaryTypeEnum.options.map((t) => ({ value: t, label: BENEFICIARY_TYPE_META[t].label }))}
                  size="sm"
                  disabled={readOnly}
                />
              </div>
              <div className="md:col-span-3">
                <label className={labelClass}>Contact name</label>
                <input className={inputClass(false)} value={b.contactName} maxLength={160} onChange={(e) => setBeneficiary(b.key, { contactName: e.target.value })} disabled={readOnly} />
              </div>
              <div className="md:col-span-3">
                <label className={labelClass}>Contact email</label>
                <input
                  type="email"
                  className={inputClass(Boolean(errors.fields[`beneficiaries.${i}.contactEmail`]))}
                  value={b.contactEmail}
                  maxLength={200}
                  onChange={(e) => setBeneficiary(b.key, { contactEmail: e.target.value })}
                  disabled={readOnly}
                />
                <FieldError message={errors.fields[`beneficiaries.${i}.contactEmail`]} />
              </div>
              <div className="md:col-span-3">
                <label className={labelClass}>Contact phone</label>
                <input className={inputClass(false)} value={b.contactPhone} maxLength={32} onChange={(e) => setBeneficiary(b.key, { contactPhone: e.target.value })} disabled={readOnly} />
              </div>
              <div className="md:col-span-6">
                <label className={labelClass}>Address</label>
                <input className={inputClass(false)} value={b.address} maxLength={400} onChange={(e) => setBeneficiary(b.key, { address: e.target.value })} disabled={readOnly} />
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
          ))}
        </div>
        <FieldError message={errors.fields.beneficiaries} />
      </StepSection>

      <StepSection title="Contractor model" description={`Who submits payment claims (${term("ipc", { plural: true })}), and for which BOQ items.`}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3" role="radiogroup" aria-label="Contractor model">
          {MODES.map((m) => {
            const selected = mode === m;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={readOnly}
                onClick={() => setState((s) => ({ ...s, mode: m }))}
                className={`text-left rounded-xl border p-4 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary ${
                  selected ? "border-brand-primary bg-brand-primary/5" : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <p className="text-xs font-bold text-slate-900">{CONTRACTOR_EXECUTION_MODE_META[m].label}</p>
                <p className="mt-1 text-[11px] text-slate-500">{CONTRACTOR_EXECUTION_MODE_META[m].description}</p>
              </button>
            );
          })}
        </div>
        <FieldError message={errors.fields.contractorExecutionMode} />
      </StepSection>

      <StepSection
        title="Contractors"
        description={
          multiPrime
            ? "Each contractor owns a package of BOQ items, identified by its trade code."
            : unified
              ? `Mark the main contractor; only the main contractor submits ${term("ipc", { plural: true })}.`
              : "One contractor delivers the project."
        }
        actions={
          !readOnly && (
            <button
              type="button"
              onClick={addRow}
              disabled={!mode || (single && state.contractors.length >= 1)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" /> Add contractor
            </button>
          )
        }
      >
        {!mode && <p className="text-xs text-slate-500">Choose the contractor model first.</p>}
        {mode && state.contractors.length === 0 && <p className="text-xs text-slate-500">No contractors yet.</p>}
        {single && state.contractors.length > 1 && (
          <p className="text-xs font-medium text-red-600">The single-contractor model allows one contractor.</p>
        )}
        <div className="space-y-3">
          {state.contractors.map((c, i) => (
            <div key={c.key} className="rounded-xl border border-slate-200 p-3 grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
              <div className="md:col-span-4">
                <OrganizationInput
                  label="Contractor"
                  tag="CONTRACTOR"
                  value={c.organization}
                  selectedName={c.organizationName}
                  onChange={(v) => setRow(c.key, { organization: v, organizationName: null })}
                  error={errors.fields[`contractors.${i}.organization`]}
                  disabled={readOnly || c.hasActivity}
                />
              </div>
              <div className="md:col-span-3">
                <label className={labelClass}>Trade</label>
                <input
                  className={inputClass(Boolean(errors.fields[`contractors.${i}.tradeCategory`]))}
                  value={c.tradeCategory}
                  placeholder="e.g. Electrical works"
                  onChange={(e) => setRow(c.key, { tradeCategory: e.target.value })}
                  disabled={readOnly}
                />
                <FieldError message={errors.fields[`contractors.${i}.tradeCategory`]} />
              </div>
              <div className="md:col-span-2">
                <label className={labelClass}>Trade code</label>
                <input
                  className={`${inputClass(Boolean(errors.fields[`contractors.${i}.tradeCode`]))} uppercase font-semibold`}
                  value={c.tradeCode}
                  maxLength={6}
                  placeholder="ELEC"
                  onChange={(e) => setRow(c.key, { tradeCode: e.target.value.toUpperCase() })}
                  disabled={readOnly}
                />
                <FieldError message={errors.fields[`contractors.${i}.tradeCode`]} />
              </div>
              {multiPrime && (
                <div className="md:col-span-3">
                  <label className={labelClass}>Package budget ({currency})</label>
                  <input
                    inputMode="decimal"
                    className={inputClass(Boolean(errors.fields[`contractors.${i}.allocatedBudgetNgn`]))}
                    value={c.allocatedBudget}
                    onChange={(e) => setRow(c.key, { allocatedBudget: e.target.value })}
                    disabled={readOnly}
                  />
                  <FieldError message={errors.fields[`contractors.${i}.allocatedBudgetNgn`]} />
                </div>
              )}
              <div className={`${multiPrime ? "md:col-span-12" : "md:col-span-3"} flex flex-wrap items-center gap-4 pt-1 md:pt-6`}>
                {unified && (
                  <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="radio"
                      name="main-contractor"
                      checked={c.isMainContractor}
                      onChange={() => setRow(c.key, { isMainContractor: true })}
                      disabled={readOnly}
                    />
                    Main contractor
                  </label>
                )}
                <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={c.allowFieldReporting}
                    onChange={(e) => setRow(c.key, { allowFieldReporting: e.target.checked })}
                    disabled={readOnly}
                  />
                  Field reporting
                </label>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => removeRow(c.key)}
                    disabled={c.hasActivity}
                    title={c.hasActivity ? "This contractor has field sessions or claims and cannot be removed" : "Remove"}
                    className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <FieldError message={errors.fields.contractors} />
      </StepSection>
    </div>
  );
}

/** Compares form state without display-only fields. */
function strip(s: { owner: string; beneficiaries: BeneficiaryRow[]; monitor: unknown; lender: unknown; mode: unknown; contractors: ContractorRow[] }) {
  return {
    owner: s.owner,
    beneficiaries: s.beneficiaries.map(({ key: _k, ...rest }) => rest),
    monitor: s.monitor,
    lender: s.lender,
    mode: s.mode,
    contractors: s.contractors.map(({ key: _k, organizationName: _n, hasActivity: _h, ...rest }) => rest),
  };
}
