import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import {
  OrganizationRefSchema,
  ProjectContractorInputSchema,
  ProjectContractorSectionSchema,
  type OrganizationRef,
  type ProjectSetupDto,
} from "@insite/shared";
import { FieldError, visibleError } from "../../../../lib/forms";
import { OrganizationInput } from "../../../../components/organizations/OrganizationInput";
import { ContractorPicker } from "../../../../components/contractors/ContractorPicker";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import { useAuth } from "../../../../lib/auth-context";
import { useDefaultCasesQuery } from "../../../../queries/contracts/useContractQueries";
import { DEFAULT_CASE_VIEW_PERMISSIONS, StatusChip } from "../../../../components/contracts/contractUi";
import {
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

interface ContractorValues {
  contractor: ContractorRow | null;
}

const valuesFrom = (setup: ProjectSetupDto): ContractorValues => ({ contractor: contractorFrom(setup) });

const contractorKey = ({ contractor: c }: ContractorValues) =>
  JSON.stringify(c ? (({ organizationName: _n, hasActivity: _h, terminated: _t, ...rest }) => rest)(c) : null);

const C = ProjectContractorInputSchema.shape;

/**
 * Form schema: the request body (`ProjectContractorSectionSchema`, at most one contractor) built from
 * the form's one optional row. Planned completion must not be before the planned mobilisation.
 */
const ContractorFormSchema = z
  .object({
    contractor: z
      .object({
        id: C.id,
        organization: OrganizationRefSchema.nullable().refine((v) => v !== null, "Choose or enter the contractor"),
        organizationName: z.string().nullable(),
        tradeCategory: C.tradeCategory,
        tradeCode: C.tradeCode,
        allocatedBudgetNgn: C.allocatedBudgetNgn,
        plannedMobilizationDate: C.plannedMobilizationDate,
        plannedCompletionDate: textOrNull().pipe(C.plannedCompletionDate),
        hasActivity: z.boolean(),
        terminated: z.boolean(),
      })
      .superRefine((c, ctx) => {
        if (c.plannedMobilizationDate && c.plannedCompletionDate && c.plannedCompletionDate < c.plannedMobilizationDate) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["plannedCompletionDate"],
            message: "Must be on or after the planned mobilisation date",
          });
        }
      })
      .nullable(),
  })
  .transform(({ contractor: c }) => ({
    contractors: c
      ? [
          {
            ...(c.id ? { id: c.id } : {}),
            organization: c.organization as OrganizationRef,
            tradeCategory: c.tradeCategory,
            tradeCode: c.tradeCode,
            allocatedBudgetNgn: c.allocatedBudgetNgn,
            plannedMobilizationDate: c.plannedMobilizationDate,
            plannedCompletionDate: c.plannedCompletionDate,
          },
        ]
      : [],
  }))
  .pipe(ProjectContractorSectionSchema);

/** Server paths ("contractors.0.tradeCode") → form fields ("contractor.tradeCode"). */
const contractorPath = (path: string) =>
  path === "contractors" ? "contractor" : path.replace(/^contractors\.0(\.organization)?(\..*)?$/, (_m, org, rest) => (org ? "contractor.organization" : `contractor${rest ?? ""}`));

/**
 * Section `contractor` (step 2 "Contract"; redesign R6a, D-R6.4 and D-R6.7): the one contractor
 * that delivers the project and its planned completion date.
 */
export function ContractorSection({ projectId, setup, readOnly }: StepProps) {
  const { hasAnyPermission } = useAuth();
  // Client demo updates F.2: pick from the contractor register (stars, status) when the user may read it.
  const usesRegister = hasAnyPermission("contractors:view_register", "contractors:manage");
  // Phase 13: open default cases (live projects only).
  const casesQuery = useDefaultCasesQuery(
    projectId,
    { openOnly: true },
    setup.status !== "DRAFT" && hasAnyPermission(...DEFAULT_CASE_VIEW_PERMISSIONS)
  );
  const initial = useMemo(() => valuesFrom(setup), [setup]);
  const section = useSectionForm(ContractorFormSchema, initial, contractorKey);
  const { form, dirty } = section;
  const row = (section.values as ContractorValues).contractor;
  const [general, setGeneral] = useState<string | null>(null);
  const save = useSaveSetupStepMutation(projectId);
  const latest = useLatestSetup(projectId, setup);
  const err = (name: string) => visibleError(form, name);
  // The trade opens on an error and stays open while it is fixed.
  const [tradeOpen, setTradeOpen] = useState(false);

  const setRow = (next: ContractorRow | null) => setField(form, "contractor", next);
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

  useRegisterSection(
    "contractor",
    dirty,
    async (opts) => {
      if (!dirty && !opts?.force) return true;
      const body = await section.submit(dirty ? undefined : valuesFrom(latest()));
      if (!body) return false;
      try {
        await save.mutateAsync({ sectionId: "contractor", body, silent: opts?.silent });
        section.reset(valuesFrom(latest()));
        setGeneral(null);
        return true;
      } catch (error) {
        setGeneral(section.showServerErrors(error, contractorPath));
        return false;
      }
    },
    section
  );

  const c = row;
  const locked = readOnly || Boolean(c?.terminated);
  const openCase = c?.id ? casesQuery.data?.find((x) => x.projectContractorId === c.id) : undefined;

  return (
    <StepSection
      title="Contractor"
      description="The one contractor that delivers the project. Its planned completion should not be before the last work phase ends."
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
      {general && <p className="text-xs font-medium text-red-600">{general}</p>}
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
              {usesRegister ? (
                <>
                  <ContractorPicker
                    value={c.organization?.id ?? null}
                    selectedName={c.organizationName}
                    onChange={(v) => {
                      form.setValue("contractor.organizationName", v?.name ?? null);
                      setField(form, "contractor.organization", v ? { id: v.id } : null, true);
                    }}
                    error={err("contractor.organization")}
                    disabled={locked || c.hasActivity}
                  />
                  <p className="mt-1 text-[11px] text-slate-500">Rating is information from past monitoring; the award follows procurement.</p>
                </>
              ) : (
                <OrganizationInput
                  label="Contractor"
                  tag="CONTRACTOR"
                  value={c.organization}
                  selectedName={c.organizationName}
                  onChange={(v) => {
                    form.setValue("contractor.organizationName", null);
                    setField(form, "contractor.organization", v, true);
                  }}
                  error={err("contractor.organization")}
                  disabled={locked || c.hasActivity}
                />
              )}
            </div>
            <div className="md:col-span-3">
              <label className={labelClass} htmlFor="contractor-completion">Planned completion</label>
              <input
                id="contractor-completion"
                type="date"
                className={inputClass(Boolean(err("contractor.plannedCompletionDate")))}
                {...textProps(form, "contractor.plannedCompletionDate")}
                onChange={(e) => setField(form, "contractor.plannedCompletionDate", e.target.value, true)}
                disabled={locked}
              />
              <FieldError form={form} name="contractor.plannedCompletionDate" />
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
            open={tradeOpen || Boolean(err("contractor.tradeCategory") || err("contractor.tradeCode"))}
            onToggle={(e) => setTradeOpen(e.currentTarget.open)}
          >
            <summary className="cursor-pointer text-xs font-semibold text-slate-700">
              Trade: {c.tradeCategory || "not set"} ({c.tradeCode || "–"})
            </summary>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor="contractor-trade">Trade</label>
                <input
                  id="contractor-trade"
                  className={inputClass(Boolean(err("contractor.tradeCategory")))}
                  maxLength={80}
                  {...textProps(form, "contractor.tradeCategory")}
                  disabled={locked}
                />
                <FieldError form={form} name="contractor.tradeCategory" />
              </div>
              <div>
                <label className={labelClass} htmlFor="contractor-trade-code">Trade code</label>
                <input
                  id="contractor-trade-code"
                  className={`${inputClass(Boolean(err("contractor.tradeCode")))} uppercase font-semibold`}
                  maxLength={6}
                  {...textProps(form, "contractor.tradeCode", (v) => v.toUpperCase())}
                  disabled={locked}
                />
                <FieldError form={form} name="contractor.tradeCode" />
              </div>
            </div>
          </details>
        </div>
      )}
      <FieldError form={form} name="contractor" />
    </StepSection>
  );
}
