import React, { useMemo, useState } from "react";
import { CONTRACT_MILESTONE_ANCHOR_META, ProjectContractStepSchema, type ContractMilestoneAnchor, type ProjectContractStep } from "@insite/shared";
import { useAuth } from "../../../../lib/auth-context";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import { useTenantSettingsQuery } from "../../../../queries/organizations/useOrganizationQueries";
import { useMilestonesQuery } from "../../../../queries/contracts/useContractQueries";
import { apiErrorCode } from "../../../../api/process/processApi";
import { DaysLeft, MILESTONE_STATUS_META, StatusChip } from "../../../../components/contracts/contractUi";
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

/**
 * "Contract and kick-off" (Phase 13): contract reference, award and signed dates, contract sum and
 * the planned kick-off date. The project type's milestones count from these dates; a live project
 * needs a reason (and milestones:manage) to move them.
 */

const FIELD_FOR_ANCHOR: Partial<Record<ContractMilestoneAnchor, "contractAwardDate" | "contractSignedDate" | "kickoffDate">> = {
  CONTRACT_AWARD: "contractAwardDate",
  CONTRACT_SIGNED: "contractSignedDate",
  KICKOFF: "kickoffDate",
};

export function ContractStep({ projectId, setup, readOnly }: StepProps) {
  const { hasPermission } = useAuth();
  const settings = useTenantSettingsQuery();
  const currency = settings.data?.defaultCurrency ?? "NGN";
  const c = setup.contract;
  const live = setup.status !== "DRAFT";
  const initial = useMemo(
    () => ({
      contractReference: c.contractReference ?? "",
      contractAwardDate: c.contractAwardDate ?? "",
      contractSignedDate: c.contractSignedDate ?? "",
      contractSum: c.contractSumNgn === null ? "" : String(c.contractSumNgn),
      kickoffDate: c.kickoffDate ?? "",
    }),
    [c]
  );
  const [state, setState] = useState(initial);
  const [changeReason, setChangeReason] = useState("");
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const save = useSaveSetupStepMutation(projectId);
  const dirty = JSON.stringify(state) !== JSON.stringify(initial);
  const required = new Set(c.requiredAnchors.map((a) => FIELD_FOR_ANCHOR[a]).filter(Boolean));
  const datesMoved =
    state.contractAwardDate !== initial.contractAwardDate ||
    state.contractSignedDate !== initial.contractSignedDate ||
    state.kickoffDate !== initial.kickoffDate;
  const needsReason = live && datesMoved;
  const canMoveDates = !live || hasPermission("milestones:manage");
  const set = (patch: Partial<typeof state>) => setState((s) => ({ ...s, ...patch }));

  useRegisterStep(dirty, async (opts) => {
    if (!dirty) return true;
    const fields: Record<string, string> = {};
    const sum = state.contractSum.trim() ? parseNumberInput(state.contractSum) : null;
    if (state.contractSum.trim() && (sum === null || sum <= 0)) fields.contractSumNgn = "Enter an amount above zero";
    if (needsReason && changeReason.trim().length < 5) fields.changeReason = "Say why the dates move (at least 5 characters)";
    const body: ProjectContractStep = {
      contractReference: state.contractReference.trim() || null,
      contractAwardDate: state.contractAwardDate || null,
      contractSignedDate: state.contractSignedDate || null,
      contractSumNgn: sum,
      kickoffDate: state.kickoffDate || null,
      ...(needsReason ? { changeReason: changeReason.trim() } : {}),
    };
    const parsed = ProjectContractStepSchema.safeParse(body);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".");
        if (key && !fields[key]) fields[key] = issue.message;
      }
    }
    if (Object.keys(fields).length > 0) {
      setErrors({ fields, general: "Some fields need attention." });
      return false;
    }
    try {
      await save.mutateAsync({ stepId: "contract", body, silent: opts?.silent });
      setErrors(NO_ERRORS);
      setChangeReason("");
      return true;
    } catch (err) {
      const { code } = apiErrorCode(err);
      if (code === "CHANGE_REASON_REQUIRED") {
        setErrors({ fields: { changeReason: "Say why the dates move" }, general: "Moving a date on a live project needs a reason." });
        return false;
      }
      setErrors(extractErrors(err));
      return false;
    }
  });

  const dateField = (key: "contractAwardDate" | "contractSignedDate" | "kickoffDate", label: string, help?: string) => (
    <div>
      <label className={labelClass} htmlFor={`contract-${key}`}>
        {label} {required.has(key) && <span className="text-red-500">*</span>}
      </label>
      <input
        id={`contract-${key}`}
        type="date"
        className={inputClass(Boolean(errors.fields[key]))}
        value={state[key]}
        onChange={(e) => set({ [key]: e.target.value } as Partial<typeof state>)}
        disabled={readOnly || !canMoveDates}
      />
      {help && <p className="mt-1 text-[11px] text-slate-500">{help}</p>}
      <FieldError message={errors.fields[key]} />
    </div>
  );

  return (
    <div className="space-y-5">
      <StepSection
        title="Contract and kick-off"
        description={
          c.milestoneTemplateCount > 0
            ? `The project type has ${c.milestoneTemplateCount} contract milestone(s), dated from these fields. Fields marked * are needed before activation.`
            : "Contract details for the record. The project type has no contract milestones."
        }
      >
        {errors.general && <p className="text-xs font-medium text-red-600">{errors.general}</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass} htmlFor="contract-ref">
              Contract reference
            </label>
            <input
              id="contract-ref"
              className={inputClass(Boolean(errors.fields.contractReference))}
              value={state.contractReference}
              maxLength={120}
              onChange={(e) => set({ contractReference: e.target.value })}
              disabled={readOnly}
            />
            <FieldError message={errors.fields.contractReference} />
          </div>
          <div>
            <label className={labelClass} htmlFor="contract-sum">
              Contract sum ({currency})
            </label>
            <input
              id="contract-sum"
              inputMode="decimal"
              className={inputClass(Boolean(errors.fields.contractSumNgn))}
              value={state.contractSum}
              onChange={(e) => set({ contractSum: e.target.value })}
              disabled={readOnly}
            />
            <FieldError message={errors.fields.contractSumNgn} />
          </div>
          {dateField("contractAwardDate", "Contract award date")}
          {dateField("contractSignedDate", "Contract signed date", "On or after the award date.")}
          {dateField("kickoffDate", "Planned kick-off date", "On or after the contract dates. Mobilisation deadlines count from it.")}
          {c.kickoffHeldAt && (
            <p className="self-end text-[11px] text-slate-600">
              The kick-off was held on {new Date(c.kickoffHeldAt).toLocaleDateString()}.
            </p>
          )}
        </div>
        {live && !canMoveDates && (
          <p className="text-[11px] text-slate-500">Moving these dates on a live project needs the "Manage contract milestones" permission.</p>
        )}
        {needsReason && (
          <div>
            <label className={labelClass} htmlFor="contract-reason">
              Why the dates move <span className="text-red-500">*</span>
            </label>
            <input
              id="contract-reason"
              className={inputClass(Boolean(errors.fields.changeReason))}
              value={changeReason}
              maxLength={500}
              onChange={(e) => setChangeReason(e.target.value)}
              disabled={readOnly}
            />
            <p className="mt-1 text-[11px] text-slate-500">Pending milestones counted from a moved date are re-dated. Completed ones keep their dates. Recorded in the audit ledger.</p>
            <FieldError message={errors.fields.changeReason} />
          </div>
        )}
      </StepSection>

      <MilestonePreview projectId={projectId} requiredAnchors={c.requiredAnchors} />
    </div>
  );
}

/** Read-only list of the project's contract milestones (they exist once the project type is applied). */
function MilestonePreview({ projectId, requiredAnchors }: { projectId: string; requiredAnchors: ContractMilestoneAnchor[] }) {
  const q = useMilestonesQuery(projectId);
  const rows = [...(q.data?.milestones ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <StepSection
      title="Contract milestones"
      description={
        requiredAnchors.length
          ? `Counted from: ${requiredAnchors.map((a) => CONTRACT_MILESTONE_ANCHOR_META[a].label.toLowerCase()).join(", ")}. Dates update after you save.`
          : "Dates update after you save."
      }
    >
      {q.isLoading ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : q.isError ? (
        <p className="text-xs text-slate-500">The milestones could not be loaded.</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-500">No milestones yet. They are created when a project type with contract milestones is applied.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
              <span className="min-w-0">
                <span className="font-semibold text-slate-900">{m.label}</span>
                <span className="text-slate-500">
                  {m.contractorName ? ` · ${m.contractorName}` : ""} · {m.anchorLabel}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums text-slate-700">{m.dueDate ?? "No date yet"}</span>
                {m.status !== "DONE" && m.status !== "WAIVED" && m.dueDate && <DaysLeft daysLeft={m.daysLeft} />}
                <StatusChip label={MILESTONE_STATUS_META[m.status].label} cls={MILESTONE_STATUS_META[m.status].cls} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </StepSection>
  );
}
