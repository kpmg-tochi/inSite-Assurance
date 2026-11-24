import React, { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  BENEFICIARY_TYPE_META,
  BeneficiaryTypeEnum,
  TRADE_CODE_REGEX,
  type BeneficiaryType,
  type OrganizationRef,
  type ProjectPartiesStep,
} from "@insite/shared";
import { OrganizationInput } from "../../../../components/organizations/OrganizationInput";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import { useOrganizationsQuery, useTenantSettingsQuery } from "../../../../queries/organizations/useOrganizationQueries";
import { CustomSelect } from "../../../../components/common";
import { Link } from "react-router-dom";
import { useAuth, useTerm } from "../../../../lib/auth-context";
import { useDefaultCasesQuery } from "../../../../queries/contracts/useContractQueries";
import { DEFAULT_CASE_VIEW_PERMISSIONS, StatusChip } from "../../../../components/contracts/contractUi";
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

/** Redesign R1d (decision T): a project has one contractor. */
interface ContractorRow {
  id?: string;
  organization: OrganizationRef | null;
  organizationName: string | null;
  tradeCategory: string;
  tradeCode: string;
  allocatedBudget: string;
  plannedMobilizationDate: string;
  plannedCompletionDate: string;
  hasActivity: boolean;
  /** Phase 13: a terminated contractor is read-only and keeps its history. */
  terminated: boolean;
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

let rowSeq = 0;
const newKey = () => `row-${++rowSeq}`;

export function PartiesStep({ projectId, setup, readOnly }: StepProps) {
  const settings = useTenantSettingsQuery();
  const currency = settings.data?.defaultCurrency ?? "NGN";
  const term = useTerm();
  const { hasAnyPermission } = useAuth();
  // Phase 13: open default cases per contractor (live projects only).
  const casesQuery = useDefaultCasesQuery(projectId, { openOnly: true }, setup.status !== "DRAFT" && hasAnyPermission(...DEFAULT_CASE_VIEW_PERMISSIONS));
  const openCaseFor = (contractorId?: string) => (contractorId ? casesQuery.data?.find((c) => c.projectContractorId === contractorId) : undefined);
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
      contractor: ((): ContractorRow | null => {
        const c = setup.parties.contractors[0];
        if (!c) return null;
        return {
          id: c.id,
          organization: { id: c.organizationId },
          organizationName: c.organizationName,
          tradeCategory: c.tradeCategory,
          tradeCode: c.tradeCode,
          allocatedBudget: c.allocatedBudgetNgn === null ? "" : String(c.allocatedBudgetNgn),
          plannedMobilizationDate: c.plannedMobilizationDate ?? "",
          plannedCompletionDate: c.plannedCompletionDate ?? "",
          hasActivity: c.hasActivity,
          terminated: c.contractStatus === "TERMINATED",
        };
      })(),
    }),
    [setup.parties]
  );
  const [state, setState] = useState(initial);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const save = useSaveSetupStepMutation(projectId);
  const dirty = JSON.stringify(strip(state)) !== JSON.stringify(strip(initial));

  const setContractor = (patch: Partial<ContractorRow>) =>
    setState((s) => (s.contractor ? { ...s, contractor: { ...s.contractor, ...patch } } : s));

  const addContractor = () =>
    setState((s) => ({
      ...s,
      contractor: {
        organization: null,
        organizationName: null,
        tradeCategory: "General works",
        tradeCode: "GEN",
        allocatedBudget: "",
        plannedMobilizationDate: "",
        plannedCompletionDate: "",
        hasActivity: false,
        terminated: false,
      },
    }));

  const removeContractor = () => setState((s) => ({ ...s, contractor: null }));

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
    const c = state.contractor;
    if (c) {
      if (!c.organization) fields["contractors.0.organization"] = "Choose or enter the contractor";
      if (c.tradeCategory.trim().length < 2) fields["contractors.0.tradeCategory"] = "Enter the trade";
      if (!TRADE_CODE_REGEX.test(c.tradeCode.trim().toUpperCase())) {
        fields["contractors.0.tradeCode"] = "2 to 6 letters or digits";
      }
      if (c.allocatedBudget.trim() && (parseNumberInput(c.allocatedBudget) ?? -1) < 0) {
        fields["contractors.0.allocatedBudgetNgn"] = "Enter an amount";
      }
      if (c.plannedMobilizationDate && c.plannedCompletionDate && c.plannedCompletionDate < c.plannedMobilizationDate) {
        fields["contractors.0.plannedCompletionDate"] = "Must be on or after the mobilisation date";
      }
    }
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
        contractors: c
          ? [
              {
                ...(c.id ? { id: c.id } : {}),
                organization: c.organization!,
                tradeCategory: c.tradeCategory.trim(),
                tradeCode: c.tradeCode.trim().toUpperCase(),
                allocatedBudgetNgn: c.allocatedBudget.trim() ? parseNumberInput(c.allocatedBudget) : null,
                plannedMobilizationDate: c.plannedMobilizationDate || null,
                plannedCompletionDate: c.plannedCompletionDate || null,
              },
            ]
          : [],
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
        description={`Who the project is for. The primary ${term("beneficiary", { lower: true })} pre-fills the handover response.`}
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

      <StepSection
        title="Contractor"
        description="The one contractor that delivers the project."
        actions={
          !readOnly &&
          !state.contractor && (
            <button
              type="button"
              onClick={addContractor}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Plus className="w-3.5 h-3.5" /> Add contractor
            </button>
          )
        }
      >
        {!state.contractor && <p className="text-xs text-slate-500">No contractor yet.</p>}
        {state.contractor &&
          (() => {
            const c = state.contractor;
            const locked = readOnly || c.terminated;
            const openCase = openCaseFor(c.id);
            return (
              <div className={`rounded-xl border p-3 grid grid-cols-1 md:grid-cols-12 gap-3 items-start ${c.terminated ? "border-rose-200 bg-rose-50/30" : "border-slate-200"}`}>
                {(c.terminated || openCase) && (
                  <div className="md:col-span-12 flex flex-wrap items-center gap-2 text-[11px]">
                    {c.terminated && <StatusChip label="Terminated" cls="bg-rose-50 text-rose-700 border-rose-200" title="Read-only: its history stays on the project" />}
                    {openCase && (
                      <Link to={`/app/projects/${projectId}/milestones?case=${openCase.id}`} className="font-semibold text-rose-700 hover:underline">
                        Open default case
                      </Link>
                    )}
                  </div>
                )}
                <div className="md:col-span-4">
                  <OrganizationInput
                    label="Contractor"
                    tag="CONTRACTOR"
                    value={c.organization}
                    selectedName={c.organizationName}
                    onChange={(v) => setContractor({ organization: v, organizationName: null })}
                    error={errors.fields["contractors.0.organization"]}
                    disabled={locked || c.hasActivity}
                  />
                </div>
                <div className="md:col-span-3">
                  <label className={labelClass} htmlFor="contractor-trade">Trade</label>
                  <input
                    id="contractor-trade"
                    className={inputClass(Boolean(errors.fields["contractors.0.tradeCategory"]))}
                    value={c.tradeCategory}
                    placeholder="e.g. General works"
                    onChange={(e) => setContractor({ tradeCategory: e.target.value })}
                    disabled={locked}
                  />
                  <FieldError message={errors.fields["contractors.0.tradeCategory"]} />
                </div>
                <div className="md:col-span-2">
                  <label className={labelClass} htmlFor="contractor-trade-code">Trade code</label>
                  <input
                    id="contractor-trade-code"
                    className={`${inputClass(Boolean(errors.fields["contractors.0.tradeCode"]))} uppercase font-semibold`}
                    value={c.tradeCode}
                    maxLength={6}
                    placeholder="GEN"
                    onChange={(e) => setContractor({ tradeCode: e.target.value.toUpperCase() })}
                    disabled={locked}
                  />
                  <FieldError message={errors.fields["contractors.0.tradeCode"]} />
                </div>
                <div className="md:col-span-3">
                  <label className={labelClass} htmlFor="contractor-budget">Contract budget ({currency})</label>
                  <input
                    id="contractor-budget"
                    inputMode="decimal"
                    className={inputClass(Boolean(errors.fields["contractors.0.allocatedBudgetNgn"]))}
                    value={c.allocatedBudget}
                    onChange={(e) => setContractor({ allocatedBudget: e.target.value })}
                    disabled={locked}
                  />
                  <FieldError message={errors.fields["contractors.0.allocatedBudgetNgn"]} />
                </div>
                <div className="md:col-span-3">
                  <label className={labelClass} htmlFor="contractor-mobilisation">Planned mobilisation</label>
                  <input
                    id="contractor-mobilisation"
                    type="date"
                    className={inputClass(Boolean(errors.fields["contractors.0.plannedMobilizationDate"]))}
                    value={c.plannedMobilizationDate}
                    onChange={(e) => setContractor({ plannedMobilizationDate: e.target.value })}
                    disabled={locked}
                  />
                  <FieldError message={errors.fields["contractors.0.plannedMobilizationDate"]} />
                </div>
                <div className="md:col-span-3">
                  <label className={labelClass} htmlFor="contractor-completion">Planned completion</label>
                  <input
                    id="contractor-completion"
                    type="date"
                    className={inputClass(Boolean(errors.fields["contractors.0.plannedCompletionDate"]))}
                    value={c.plannedCompletionDate}
                    onChange={(e) => setContractor({ plannedCompletionDate: e.target.value })}
                    disabled={locked}
                  />
                  <FieldError message={errors.fields["contractors.0.plannedCompletionDate"]} />
                </div>
                {!readOnly && (
                  <div className="md:col-span-6 flex items-center pt-1 md:pt-6">
                    <button
                      type="button"
                      onClick={removeContractor}
                      disabled={c.hasActivity || c.terminated}
                      title={c.terminated ? "A terminated contractor stays on record" : c.hasActivity ? "Work is recorded against this contractor; it cannot be removed" : "Remove"}
                      className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:underline disabled:opacity-40 disabled:no-underline"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Remove
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
        <FieldError message={errors.fields.contractors} />
      </StepSection>
    </div>
  );
}

/** Compares form state without display-only fields. */
function strip(s: { owner: string; beneficiaries: BeneficiaryRow[]; monitor: unknown; lender: unknown; contractor: ContractorRow | null }) {
  return {
    owner: s.owner,
    beneficiaries: s.beneficiaries.map(({ key: _k, ...rest }) => rest),
    monitor: s.monitor,
    lender: s.lender,
    contractor: s.contractor
      ? (({ organizationName: _n, hasActivity: _h, terminated: _t, ...rest }) => rest)(s.contractor)
      : null,
  };
}
