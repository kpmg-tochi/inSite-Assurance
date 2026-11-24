import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { TRADE_CODE_REGEX, type OrganizationRef, type ProjectContractorSection, type ProjectSetupDto } from "@insite/shared";
import { OrganizationInput } from "../../../../components/organizations/OrganizationInput";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import { useAuth } from "../../../../lib/auth-context";
import { useDefaultCasesQuery } from "../../../../queries/contracts/useContractQueries";
import { DEFAULT_CASE_VIEW_PERMISSIONS, StatusChip } from "../../../../components/contracts/contractUi";
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

/** Redesign R1d (decision T): a project has one contractor. */
interface ContractorRow {
  id?: string;
  organization: OrganizationRef | null;
  organizationName: string | null;
  tradeCategory: string;
  tradeCode: string;
  /** Kept as stored; not edited here (D-R6.7: the contract sum and the mobilisation milestone replace them). */
  allocatedBudgetNgn: number | null;
  plannedMobilizationDate: string | null;
  plannedCompletionDate: string;
  hasActivity: boolean;
  /** Phase 13: a terminated contractor is read-only and keeps its history. */
  terminated: boolean;
}

/** D-R6.7: the trade is pre-filled and shown collapsed. */
const DEFAULT_TRADE = { tradeCategory: "Main contract", tradeCode: "MAIN" };

function contractorFrom(setup: ProjectSetupDto): ContractorRow | null {
  const c = setup.parties.contractors[0];
  if (!c) return null;
  return {
    id: c.id,
    organization: { id: c.organizationId },
    organizationName: c.organizationName,
    tradeCategory: c.tradeCategory,
    tradeCode: c.tradeCode,
    allocatedBudgetNgn: c.allocatedBudgetNgn,
    plannedMobilizationDate: c.plannedMobilizationDate,
    plannedCompletionDate: c.plannedCompletionDate ?? "",
    hasActivity: c.hasActivity,
    terminated: c.contractStatus === "TERMINATED",
  };
}

const contractorKey = (c: ContractorRow | null) =>
  JSON.stringify(c ? (({ organizationName: _n, hasActivity: _h, terminated: _t, ...rest }) => rest)(c) : null);

function buildBody(c: ContractorRow | null): { body: ProjectContractorSection | null; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  if (c) {
    if (!c.organization) fields["contractors.0.organization"] = "Choose or enter the contractor";
    if (c.tradeCategory.trim().length < 2) fields["contractors.0.tradeCategory"] = "Enter the trade";
    if (!TRADE_CODE_REGEX.test(c.tradeCode.trim().toUpperCase())) fields["contractors.0.tradeCode"] = "2 to 6 letters or digits";
    if (c.plannedMobilizationDate && c.plannedCompletionDate && c.plannedCompletionDate < c.plannedMobilizationDate) {
      fields["contractors.0.plannedCompletionDate"] = "Must be on or after the planned mobilisation date";
    }
  }
  if (Object.keys(fields).length > 0) return { body: null, fields };
  return {
    body: {
      contractors: c
        ? [
            {
              ...(c.id ? { id: c.id } : {}),
              organization: c.organization!,
              tradeCategory: c.tradeCategory.trim(),
              tradeCode: c.tradeCode.trim().toUpperCase(),
              allocatedBudgetNgn: c.allocatedBudgetNgn,
              plannedMobilizationDate: c.plannedMobilizationDate,
              plannedCompletionDate: c.plannedCompletionDate || null,
            },
          ]
        : [],
    },
    fields,
  };
}

/**
 * Section `contractor` (step 2 "Contract"; redesign R6a, D-R6.4 and D-R6.7): the one contractor
 * that delivers the project and its planned completion date.
 */
export function ContractorSection({ projectId, setup, readOnly }: StepProps) {
  const { hasAnyPermission } = useAuth();
  // Phase 13: open default cases (live projects only).
  const casesQuery = useDefaultCasesQuery(
    projectId,
    { openOnly: true },
    setup.status !== "DRAFT" && hasAnyPermission(...DEFAULT_CASE_VIEW_PERMISSIONS)
  );
  const initial = useMemo(() => contractorFrom(setup), [setup]);
  const [row, setRow, dirty] = useSyncedState(initial, contractorKey);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const save = useSaveSetupStepMutation(projectId);
  const latest = useLatestSetup(projectId, setup);

  const patch = (p: Partial<ContractorRow>) => setRow((c) => (c ? { ...c, ...p } : c));
  const add = () =>
    setRow({
      organization: null,
      organizationName: null,
      ...DEFAULT_TRADE,
      allocatedBudgetNgn: null,
      plannedMobilizationDate: null,
      plannedCompletionDate: "",
      hasActivity: false,
      terminated: false,
    });

  useRegisterSection("contractor", dirty, async (opts) => {
    if (!dirty && !opts?.force) return true;
    const { body, fields } = buildBody(dirty ? row : contractorFrom(latest()));
    if (!body) {
      setErrors({ fields, general: "Some fields need attention." });
      return false;
    }
    try {
      await save.mutateAsync({ sectionId: "contractor", body, silent: opts?.silent });
      setRow(contractorFrom(latest()));
      setErrors(NO_ERRORS);
      return true;
    } catch (err) {
      setErrors(extractErrors(err));
      return false;
    }
  });

  const c = row;
  const locked = readOnly || Boolean(c?.terminated);
  const openCase = c?.id ? casesQuery.data?.find((x) => x.projectContractorId === c.id) : undefined;

  return (
    <StepSection
      title="Contractor"
      description="The one contractor that delivers the project. Its planned completion should not be before the last sprint ends."
      actions={
        !readOnly &&
        !c && (
          <button
            type="button"
            onClick={add}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Plus className="w-3.5 h-3.5" /> Add contractor
          </button>
        )
      }
    >
      {errors.general && <p className="text-xs font-medium text-red-600">{errors.general}</p>}
      {!c && <p className="text-xs text-slate-500">No contractor yet.</p>}
      {c && (
        <div className={`rounded-xl border p-3 space-y-3 ${c.terminated ? "border-rose-200 bg-rose-50/30" : "border-slate-200"}`}>
          {(c.terminated || openCase) && (
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              {c.terminated && <StatusChip label="Terminated" cls="bg-rose-50 text-rose-700 border-rose-200" title="Read-only: its history stays on the project" />}
              {openCase && (
                <Link to={`/app/projects/${projectId}/kickoff?tab=milestones&case=${openCase.id}`} className="font-semibold text-rose-700 hover:underline">
                  Open default case
                </Link>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
            <div className="md:col-span-6">
              <OrganizationInput
                label="Contractor"
                tag="CONTRACTOR"
                value={c.organization}
                selectedName={c.organizationName}
                onChange={(v) => patch({ organization: v, organizationName: null })}
                error={errors.fields["contractors.0.organization"]}
                disabled={locked || c.hasActivity}
              />
            </div>
            <div className="md:col-span-3">
              <label className={labelClass} htmlFor="contractor-completion">Planned completion</label>
              <input
                id="contractor-completion"
                type="date"
                className={inputClass(Boolean(errors.fields["contractors.0.plannedCompletionDate"]))}
                value={c.plannedCompletionDate}
                onChange={(e) => patch({ plannedCompletionDate: e.target.value })}
                disabled={locked}
                aria-describedby={errors.fields["contractors.0.plannedCompletionDate"] ? "contractor-completion-error" : undefined}
              />
              <FieldError id="contractor-completion-error" message={errors.fields["contractors.0.plannedCompletionDate"]} />
            </div>
            {!readOnly && (
              <div className="md:col-span-3 flex items-center pt-1 md:pt-6">
                <button
                  type="button"
                  onClick={() => setRow(null)}
                  disabled={c.hasActivity || c.terminated}
                  title={c.terminated ? "A terminated contractor stays on record" : c.hasActivity ? "Work is recorded against this contractor; it cannot be removed" : "Remove"}
                  className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:underline disabled:opacity-40 disabled:no-underline"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </button>
              </div>
            )}
          </div>
          <details
            className="rounded-xl border border-slate-200 px-3 py-2"
            open={Boolean(errors.fields["contractors.0.tradeCategory"] || errors.fields["contractors.0.tradeCode"])}
          >
            <summary className="cursor-pointer text-xs font-semibold text-slate-700">
              Trade: {c.tradeCategory || "not set"} ({c.tradeCode || "–"})
            </summary>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor="contractor-trade">Trade</label>
                <input
                  id="contractor-trade"
                  className={inputClass(Boolean(errors.fields["contractors.0.tradeCategory"]))}
                  value={c.tradeCategory}
                  onChange={(e) => patch({ tradeCategory: e.target.value })}
                  disabled={locked}
                />
                <FieldError message={errors.fields["contractors.0.tradeCategory"]} />
              </div>
              <div>
                <label className={labelClass} htmlFor="contractor-trade-code">Trade code</label>
                <input
                  id="contractor-trade-code"
                  className={`${inputClass(Boolean(errors.fields["contractors.0.tradeCode"]))} uppercase font-semibold`}
                  value={c.tradeCode}
                  maxLength={6}
                  onChange={(e) => patch({ tradeCode: e.target.value.toUpperCase() })}
                  disabled={locked}
                />
                <FieldError message={errors.fields["contractors.0.tradeCode"]} />
              </div>
            </div>
          </details>
        </div>
      )}
      <FieldError message={errors.fields.contractors} />
    </StepSection>
  );
}
