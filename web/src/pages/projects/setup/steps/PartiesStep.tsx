import React, { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  CONTRACTOR_EXECUTION_MODE_META,
  TRADE_CODE_REGEX,
  type ContractorExecutionMode,
  type OrganizationRef,
  type ProjectPartiesStep,
} from "@insite/shared";
import { OrganizationInput } from "../../../../components/organizations/OrganizationInput";
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

const MODES: ContractorExecutionMode[] = ["SINGLE_CONTRACTOR", "MAIN_PLUS_SUBS_UNIFIED_IPC", "MULTI_PRIME_SEPARATE_IPC"];

let rowSeq = 0;
const newKey = () => `row-${++rowSeq}`;

export function PartiesStep({ projectId, setup, readOnly }: StepProps) {
  const settings = useTenantSettingsQuery();
  const currency = settings.data?.defaultCurrency ?? "NGN";
  const initial = useMemo(
    () => ({
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
    if (Object.keys(fields).length > 0) return { body: null, fields };
    return {
      body: {
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
      <StepSection title="Monitor and lender" description="The independent monitor certifies progress; the lender approves releases.">
        {errors.general && <p className="text-xs font-medium text-red-600">{errors.general}</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <OrganizationInput
            label="Monitor organisation"
            tag="ADVISORY_MONITOR"
            value={state.monitor}
            selectedName={state.monitorName}
            onChange={(v) => setState((s) => ({ ...s, monitor: v, monitorName: null }))}
            error={errors.fields.monitorOrganization}
            disabled={readOnly}
          />
          <OrganizationInput
            label="Lender organisation"
            tag="FINANCIER_LENDER"
            value={state.lender}
            selectedName={state.lenderName}
            onChange={(v) => setState((s) => ({ ...s, lender: v, lenderName: null }))}
            error={errors.fields.lenderOrganization}
            disabled={readOnly}
          />
        </div>
      </StepSection>

      <StepSection title="Contractor model" description="Who submits payment claims (IPCs), and for which BOQ items.">
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
              ? "Mark the main contractor; only the main contractor submits IPCs."
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
function strip(s: { monitor: unknown; lender: unknown; mode: unknown; contractors: ContractorRow[] }) {
  return {
    monitor: s.monitor,
    lender: s.lender,
    mode: s.mode,
    contractors: s.contractors.map(({ key: _k, organizationName: _n, hasActivity: _h, ...rest }) => rest),
  };
}
