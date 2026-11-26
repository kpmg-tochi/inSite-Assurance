import React, { useMemo, useState } from "react";
import { z } from "zod";
import {
  CONTRACT_MILESTONE_ANCHOR_META,
  ProjectContractStepSchema,
  type ContractMilestoneAnchor,
  type ProjectSetupDto,
} from "@insite/shared";
import { FieldError, visibleError } from "../../../../lib/forms";
import { useAuth } from "../../../../lib/auth-context";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import { useTenantSettingsQuery } from "../../../../queries/organizations/useOrganizationQueries";
import { useMilestonesQuery } from "../../../../queries/contracts/useContractQueries";
import { apiErrorCode } from "../../../../api/process/processApi";
import { formatDateShort } from "../../../../lib/formatters";
import { DaysLeft, MILESTONE_STATUS_META, StatusChip } from "../../../../components/contracts/contractUi";
import {
  inputClass,
  labelClass,
  numberOrNull,
  setField,
  StepSection,
  textOrNull,
  textProps,
  useLatestSetup,
  useRegisterSection,
  useSectionForm,
  type StepProps,
} from "../setupContext";

/**
 * Section `contract` (step 2 "Contract"; Phase 13): contract reference, award and signed dates,
 * contract sum and the planned kick-off date. The project type's milestones count from these dates
 * (the preview below shows them, e.g. the acceptance letter due date); a live project needs a reason
 * (and milestones:manage) to move them.
 */

const FIELD_FOR_ANCHOR: Partial<Record<ContractMilestoneAnchor, "contractAwardDate" | "contractSignedDate" | "kickoffDate">> = {
  CONTRACT_AWARD: "contractAwardDate",
  CONTRACT_SIGNED: "contractSignedDate",
  KICKOFF: "kickoffDate",
};

function contractFrom(setup: ProjectSetupDto) {
  const c = setup.contract;
  return {
    contractReference: c.contractReference ?? "",
    contractAwardDate: c.contractAwardDate ?? "",
    contractSignedDate: c.contractSignedDate ?? "",
    contractSumNgn: c.contractSumNgn === null ? "" : String(c.contractSumNgn),
    kickoffDate: c.kickoffDate ?? "",
    changeReason: "",
  };
}
type ContractValues = ReturnType<typeof contractFrom>;

const K = ProjectContractStepSchema.innerType().innerType().shape;
const DATE_KEYS = ["contractAwardDate", "contractSignedDate", "kickoffDate"] as const;

/**
 * Form schema: text inputs → `ProjectContractStepSchema` (date order: signed on or after award,
 * kick-off on or after both). On a live project, moving a date needs a reason (at least 5
 * characters); the reason is sent only then.
 */
function contractFormSchema(opts: { live: boolean; saved: Pick<ContractValues, (typeof DATE_KEYS)[number]> }) {
  const moved = (v: Pick<ContractValues, (typeof DATE_KEYS)[number]>) => DATE_KEYS.some((k) => (v[k] || "") !== (opts.saved[k] || ""));
  return z
    .object({
      contractReference: textOrNull().pipe(K.contractReference),
      contractAwardDate: textOrNull().pipe(K.contractAwardDate),
      contractSignedDate: textOrNull().pipe(K.contractSignedDate),
      contractSumNgn: numberOrNull("Contract sum").pipe(K.contractSumNgn),
      kickoffDate: textOrNull().pipe(K.kickoffDate),
      changeReason: z.string(),
    })
    .superRefine((v, ctx) => {
      const dates = { contractAwardDate: v.contractAwardDate ?? "", contractSignedDate: v.contractSignedDate ?? "", kickoffDate: v.kickoffDate ?? "" };
      if (opts.live && moved(dates) && v.changeReason.trim().length < 5) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["changeReason"], message: "Say why the dates move (at least 5 characters)" });
      }
    })
    .transform(({ changeReason, ...v }) => {
      const dates = { contractAwardDate: v.contractAwardDate ?? "", contractSignedDate: v.contractSignedDate ?? "", kickoffDate: v.kickoffDate ?? "" };
      return { ...v, ...(opts.live && moved(dates) ? { changeReason: changeReason.trim() } : {}) };
    })
    .pipe(ProjectContractStepSchema);
}

export function ContractSection({ projectId, setup, readOnly }: StepProps) {
  const { hasPermission } = useAuth();
  const settings = useTenantSettingsQuery();
  const currency = settings.data?.defaultCurrency ?? "NGN";
  const c = setup.contract;
  const live = setup.status !== "DRAFT";
  const initial = useMemo(() => contractFrom(setup), [setup]);
  const savedDates = useMemo(
    () => ({ contractAwardDate: initial.contractAwardDate, contractSignedDate: initial.contractSignedDate, kickoffDate: initial.kickoffDate }),
    [initial.contractAwardDate, initial.contractSignedDate, initial.kickoffDate]
  );
  const schema = useMemo(() => contractFormSchema({ live, saved: savedDates }), [live, savedDates]);
  // The reason is not part of the saved values: typing one alone does not make the section dirty.
  const section = useSectionForm(schema, initial, ({ changeReason: _r, ...v }) => JSON.stringify(v));
  const { form, dirty } = section;
  const state = section.values as ContractValues;
  const [general, setGeneral] = useState<string | null>(null);
  const save = useSaveSetupStepMutation(projectId);
  const latest = useLatestSetup(projectId, setup);
  const err = (name: string) => visibleError(form, name);
  const required = new Set(c.requiredAnchors.map((a) => FIELD_FOR_ANCHOR[a]).filter(Boolean));
  const datesMoved =
    state.contractAwardDate !== initial.contractAwardDate ||
    state.contractSignedDate !== initial.contractSignedDate ||
    state.kickoffDate !== initial.kickoffDate;
  const needsReason = live && datesMoved;
  const canMoveDates = !live || hasPermission("milestones:manage");

  useRegisterSection(
    "contract",
    dirty,
    async (opts) => {
      if (!dirty && !opts?.force) return true;
      const body = await section.submit(dirty ? undefined : contractFrom(latest()));
      if (!body) return false;
      try {
        await save.mutateAsync({ sectionId: "contract", body, silent: opts?.silent });
        section.reset(contractFrom(latest()));
        setGeneral(null);
        return true;
      } catch (error) {
        const { code } = apiErrorCode(error);
        if (code === "CHANGE_REASON_REQUIRED") {
          form.setError("changeReason", { type: "server", message: "Say why the dates move" });
          setGeneral("Moving a date on a live project needs a reason.");
          return false;
        }
        setGeneral(section.showServerErrors(error));
        return false;
      }
    },
    section
  );

  const dateField = (key: "contractAwardDate" | "contractSignedDate" | "kickoffDate", label: string, help?: string) => (
    <div>
      <label className={labelClass} htmlFor={`contract-${key}`}>
        {label} {required.has(key) && <span className="text-red-500">*</span>}
      </label>
      <input
        id={`contract-${key}`}
        type="date"
        className={inputClass(Boolean(err(key)))}
        {...textProps(form, key)}
        onChange={(e) => setField(form, key, e.target.value, true)}
        disabled={readOnly || !canMoveDates}
      />
      {help && <p className="mt-1 text-[11px] text-slate-500">{help}</p>}
      <FieldError form={form} name={key} />
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
        {general && <p className="text-xs font-medium text-red-600">{general}</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass} htmlFor="contract-ref">
              Contract reference
            </label>
            <input
              id="contract-ref"
              className={inputClass(Boolean(err("contractReference")))}
              maxLength={120}
              {...textProps(form, "contractReference")}
              disabled={readOnly}
            />
            <FieldError form={form} name="contractReference" />
          </div>
          <div>
            <label className={labelClass} htmlFor="contract-sum">
              Contract sum ({currency})
            </label>
            <input
              id="contract-sum"
              inputMode="decimal"
              className={inputClass(Boolean(err("contractSumNgn")))}
              {...textProps(form, "contractSumNgn")}
              disabled={readOnly}
            />
            <FieldError form={form} name="contractSumNgn" />
          </div>
          {dateField("contractAwardDate", "Contract award date")}
          {dateField("contractSignedDate", "Contract signed date", "On or after the award date.")}
          {dateField("kickoffDate", "Planned kick-off date", "On or after the contract dates. Mobilisation deadlines count from it.")}
          {c.kickoffHeldAt && (
            <p className="self-end text-[11px] text-slate-600">
              The kick-off was held on {formatDateShort(c.kickoffHeldAt)}.
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
              className={inputClass(Boolean(err("changeReason")))}
              maxLength={500}
              {...textProps(form, "changeReason")}
              disabled={readOnly}
            />
            <p className="mt-1 text-[11px] text-slate-500">Pending milestones counted from a moved date are re-dated. Completed ones keep their dates. Recorded in the audit ledger.</p>
            <FieldError form={form} name="changeReason" />
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
