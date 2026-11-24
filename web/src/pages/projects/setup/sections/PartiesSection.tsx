import React, { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  BENEFICIARY_TYPE_META,
  BeneficiaryTypeEnum,
  type BeneficiaryType,
  type OrganizationRef,
  type ProjectPartiesStep,
  type ProjectSetupDto,
} from "@insite/shared";
import { OrganizationInput } from "../../../../components/organizations/OrganizationInput";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import { useOrganizationsQuery } from "../../../../queries/organizations/useOrganizationQueries";
import { CustomSelect } from "../../../../components/common";
import { useTerm } from "../../../../lib/auth-context";
import {
  extractErrors,
  FieldError,
  inputClass,
  labelClass,
  NO_ERRORS,
  StepSection,
  useLatestSetup,
  useRegisterSection,
  useSyncedState,
  type FormErrors,
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
  const [state, setState, dirty] = useSyncedState(initial, partiesKey);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const save = useSaveSetupStepMutation(projectId);
  const latest = useLatestSetup(projectId, setup);

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

  const buildBody = (v: PartiesValues): { body: ProjectPartiesStep | null; fields: Record<string, string> } => {
    const fields: Record<string, string> = {};
    v.beneficiaries.forEach((b, i) => {
      if (b.name.trim().length < 2) fields[`beneficiaries.${i}.name`] = "Enter the name";
      if (b.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.contactEmail.trim())) {
        fields[`beneficiaries.${i}.contactEmail`] = "Enter an email address";
      }
    });
    if (Object.keys(fields).length > 0) return { body: null, fields };
    return {
      body: {
        owningOrganizationId: v.owner || null,
        beneficiaries: v.beneficiaries.map((b) => ({
          ...(b.id ? { id: b.id } : {}),
          name: b.name.trim(),
          beneficiaryType: b.beneficiaryType,
          contactName: b.contactName.trim() || null,
          contactEmail: b.contactEmail.trim() || null,
          contactPhone: b.contactPhone.trim() || null,
          address: b.address.trim() || null,
          isPrimary: b.isPrimary,
        })),
        monitorOrganization: v.monitor,
        lenderOrganization: v.lender,
        // `contractors` omitted: the contractor section owns it (D-R6.4).
      },
      fields,
    };
  };

  useRegisterSection("parties", dirty, async (opts) => {
    if (!dirty && !opts?.force) return true;
    const { body, fields } = buildBody(dirty ? state : partiesFrom(latest()));
    if (!body) {
      setErrors({ fields, general: "Some fields need attention." });
      return false;
    }
    try {
      await save.mutateAsync({ sectionId: "parties", body, silent: opts?.silent });
      setState(partiesFrom(latest()));
      setErrors(NO_ERRORS);
      return true;
    } catch (err) {
      setErrors(extractErrors(err));
      return false;
    }
  });

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
        {errors.general && <p className="text-xs font-medium text-red-600">{errors.general}</p>}
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
                      className={inputClass(Boolean(errors.fields[`beneficiaries.${i}.name`]))}
                      value={b.name}
                      maxLength={200}
                      onChange={(e) => setBeneficiary(b.key, { name: e.target.value })}
                      disabled={readOnly}
                    />
                    <FieldError message={errors.fields[`beneficiaries.${i}.name`]} />
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
                    <input id={fid("contact")} className={inputClass(false)} value={b.contactName} maxLength={160} onChange={(e) => setBeneficiary(b.key, { contactName: e.target.value })} disabled={readOnly} />
                  </div>
                  <div className="md:col-span-3">
                    <label className={labelClass} htmlFor={fid("email")}>Contact email</label>
                    <input
                      id={fid("email")}
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
                    <label className={labelClass} htmlFor={fid("phone")}>Contact phone</label>
                    <input id={fid("phone")} className={inputClass(false)} value={b.contactPhone} maxLength={32} onChange={(e) => setBeneficiary(b.key, { contactPhone: e.target.value })} disabled={readOnly} />
                  </div>
                  <div className="md:col-span-6">
                    <label className={labelClass} htmlFor={fid("address")}>Address</label>
                    <input id={fid("address")} className={inputClass(false)} value={b.address} maxLength={400} onChange={(e) => setBeneficiary(b.key, { address: e.target.value })} disabled={readOnly} />
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
        <FieldError message={errors.fields.beneficiaries} />
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
    </div>
  );
}
