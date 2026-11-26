import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { Controller } from "react-hook-form";
import { z } from "zod";
import { ExternalLink, X } from "lucide-react";
import {
  CONTRACTOR_FLAG_ACTION_META,
  ContractorFlagActionKindEnum,
  DecideContractorFlagActionRequestSchema,
  LiftContractorFlagActionRequestSchema,
  VISIT_KIND_META,
  formatProjectCode,
  type ContractorFlagActionDto,
  type ContractorFlagActionKind,
  type ContractorFlagDto,
  type DecideContractorFlagActionRequest,
} from "@insite/shared";
import Drawer from "../Drawer";
import { CustomSelect } from "../common/CustomSelect";
import { ModalShell, inputClass } from "../common/ModalShell";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../lib/forms";
import { formatDateTimeShort } from "../../lib/formatters";
import { useContractorFlagQuery } from "../../queries/contractorFlags";
import { useDecideContractorFlagActionMutation, useLiftContractorFlagActionMutation } from "../../mutations/contractorFlags";
import { ActionStatusChip, FlagStatusChip, actionParamsText, fmtCalendarDay } from "./flagUi";

const labelClass = "mb-1 block text-xs font-semibold text-slate-700";

/** Visit kinds offered for extra visits; empty = the server's default (the project's routine visit). */
const EXTRA_VISIT_KINDS = (["ROUTINE", "QUARTERLY_ME", "AD_HOC"] as const).filter((k) => k in VISIT_KIND_META);

/**
 * Client demo updates F.4 (wave 3): one contractor performance flag. The summary and the rule, the
 * monitoring reports it rests on (each opens on the project's Monitoring page), the actions decided
 * so far with their status, and, for a person who may decide (`canDecide`, `contractors:manage`),
 * the form to record one more action with its reason. A payment hold in effect can be lifted.
 */
export function FlagDecisionDrawer({ flagId, initialFlag, onClose }: { flagId: string; initialFlag?: ContractorFlagDto; onClose: () => void }) {
  const query = useContractorFlagQuery(flagId, initialFlag);
  const flag = query.data;
  const titleId = useId();
  const [lifting, setLifting] = useState<ContractorFlagActionDto | null>(null);

  return (
    <Drawer onClick={(e) => e.target === e.currentTarget && onClose()} onClose={() => !lifting && onClose()} labelledBy={titleId}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h3 id={titleId} className="text-sm font-bold text-slate-900">
              Performance flag{flag ? `: ${flag.contractorName}` : ""}
            </h3>
            {flag && (
              <p className="text-[11px] text-slate-500">
                {formatProjectCode(flag.projectCode)} · {flag.projectName}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5 text-xs">
          {!flag ? (
            query.isError ? (
              <p className="text-rose-700">This flag could not be loaded.</p>
            ) : (
              <div className="h-24 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" aria-hidden="true" />
            )
          ) : (
            <>
              <FlagSummary flag={flag} />
              <Evidence flag={flag} />
              <PastActions flag={flag} onLift={setLifting} />
              {flag.status === "OPEN" && flag.canDecide && <DecideForm flag={flag} />}
              {flag.status === "OPEN" && !flag.canDecide && (
                <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-600">
                  Actions on this flag are decided by the people who manage contractors.
                </p>
              )}
            </>
          )}
        </div>
      </div>
      {lifting && flag && <LiftHoldDialog flag={flag} action={lifting} onClose={() => setLifting(null)} />}
    </Drawer>
  );
}

function FlagSummary({ flag }: { flag: ContractorFlagDto }) {
  return (
    <section className="space-y-2 rounded-xl border border-rose-200 bg-rose-50/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <FlagStatusChip status={flag.status} />
        <span className="text-[11px] text-slate-600">Raised {formatDateTimeShort(flag.raisedAt)}</span>
      </div>
      <p className="font-semibold text-rose-800">{flag.summary}</p>
      <p className="text-[11px] text-slate-600">
        Rule: {flag.rule.reportCount} accepted monitoring reports rating workmanship {flag.rule.workmanshipAtOrBelow} of 5 or below within{" "}
        {flag.rule.withinDays} days.
      </p>
      {flag.status === "CLOSED" && (
        <p className="text-[11px] text-slate-700">
          Closed{flag.closedAt ? ` ${formatDateTimeShort(flag.closedAt)}` : ""}
          {flag.closedByName ? ` by ${flag.closedByName}` : ""}
          {flag.closeReason ? `: ${flag.closeReason}` : ""}
        </p>
      )}
    </section>
  );
}

function Evidence({ flag }: { flag: ContractorFlagDto }) {
  return (
    <section aria-labelledby="flag-evidence-heading" className="space-y-2">
      <h4 id="flag-evidence-heading" className="text-xs font-bold text-slate-900">
        Monitoring reports ({flag.evidence.length})
      </h4>
      {flag.evidence.length === 0 ? (
        <p className="text-slate-500">No reports recorded on this flag.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {flag.evidence.map((e) => (
            <li key={e.visitSubmissionId} className="flex items-start justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="font-semibold text-slate-800">{e.label}</p>
                <p className="text-[11px] text-slate-500">
                  {fmtCalendarDay(e.date)} · workmanship <span className="font-semibold text-rose-700">{e.workmanship} of 5</span>
                </p>
              </div>
              <Link
                to={`/app/projects/${flag.projectId}/visits?visitId=${e.visitId}`}
                className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-brand-primary hover:underline"
              >
                Open <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link to={`/app/projects/${flag.projectId}/visits`} className="inline-block text-[11px] font-semibold text-brand-primary hover:underline">
        Monitoring on this project
      </Link>
    </section>
  );
}

function PastActions({ flag, onLift }: { flag: ContractorFlagDto; onLift: (a: ContractorFlagActionDto) => void }) {
  const actions = [...flag.actions].sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
  return (
    <section aria-labelledby="flag-actions-heading" className="space-y-2">
      <h4 id="flag-actions-heading" className="text-xs font-bold text-slate-900">
        Actions decided
      </h4>
      {actions.length === 0 ? (
        <p className="text-slate-500">No action decided yet.</p>
      ) : (
        <ul className="space-y-2">
          {actions.map((a) => {
            const params = actionParamsText(a);
            return (
              <li key={a.id} className="space-y-1 rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">{CONTRACTOR_FLAG_ACTION_META[a.kind].label}</span>
                  <ActionStatusChip status={a.status} />
                </div>
                {params && <p className="text-slate-700">{params}</p>}
                <p className="text-slate-700">{a.reason}</p>
                <p className="text-[11px] text-slate-500">
                  {a.decidedByName} · {formatDateTimeShort(a.decidedAt)}
                </p>
                {a.status === "SENT_TO_LEGAL_REVIEW" && (
                  <p className="text-[11px] text-brand-primary">
                    {a.kind === "SUSPEND_CONTRACTOR"
                      ? "Waiting for Legal review, then the Executive Secretary."
                      : "Waiting for Legal review, then the Executive Secretary or SUBEB Executive Chairman."}
                  </p>
                )}
                {a.liftedAt && (
                  <p className="text-[11px] text-slate-600">
                    Lifted {formatDateTimeShort(a.liftedAt)}
                    {a.liftedByName ? ` by ${a.liftedByName}` : ""}
                    {a.liftReason ? `: ${a.liftReason}` : ""}
                  </p>
                )}
                {a.kind === "PAYMENT_HOLD" && a.status === "IN_EFFECT" && flag.canDecide && (
                  <button
                    type="button"
                    onClick={() => onLift(a)}
                    className="mt-1 rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Lift hold
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const decideFormSchema = z
  .object({
    kind: z.string().min(1, "Choose an action"),
    reason: z.string(),
    visitCount: z.string().trim(),
    visitKind: z.string(),
    deductionAmount: z.string().trim(),
    clause: z.string().trim().max(200, "Too long (at most 200 characters)"),
  })
  .superRefine((v, ctx) => {
    if (v.reason.trim().length < 5) ctx.addIssue({ code: "custom", path: ["reason"], message: "Say why (at least 5 characters)" });
    if (v.reason.trim().length > 1000) ctx.addIssue({ code: "custom", path: ["reason"], message: "Too long (at most 1,000 characters)" });
    if (v.kind === "ADDITIONAL_VISITS") {
      const n = Number(v.visitCount);
      if (!/^\d+$/.test(v.visitCount) || n < 1 || n > 10) ctx.addIssue({ code: "custom", path: ["visitCount"], message: "Enter a whole number from 1 to 10" });
    }
    if (v.kind === "DEDUCTION") {
      const amount = Number(v.deductionAmount.replace(/,/g, ""));
      if (!/^\d+(\.\d+)?$/.test(v.deductionAmount.replace(/,/g, "")) || !(amount > 0)) {
        ctx.addIssue({ code: "custom", path: ["deductionAmount"], message: "Enter the amount (above zero)" });
      }
      if (!v.clause) ctx.addIssue({ code: "custom", path: ["clause"], message: "Name the contract clause (the contractual basis)" });
    }
  })
  .transform((v): DecideContractorFlagActionRequest => {
    const kind = v.kind as ContractorFlagActionKind;
    return {
      kind,
      reason: v.reason.trim(),
      ...(kind === "ADDITIONAL_VISITS" ? { visitCount: Number(v.visitCount), ...(v.visitKind ? { visitKind: v.visitKind } : {}) } : {}),
      ...(kind === "DEDUCTION" ? { deductionAmountNgn: Number(v.deductionAmount.replace(/,/g, "")), clause: v.clause } : {}),
    };
  })
  .pipe(DecideContractorFlagActionRequestSchema);

const DECIDE_DEFAULTS = { kind: "", reason: "", visitCount: "2", visitKind: "", deductionAmount: "", clause: "" };

function DecideForm({ flag }: { flag: ContractorFlagDto }) {
  const decide = useDecideContractorFlagActionMutation(flag.id);
  const form = useZodForm(decideFormSchema, { defaultValues: DECIDE_DEFAULTS });
  const kind = form.watch("kind");
  const groupId = useId();
  const holdInEffect = flag.actions.some((a) => a.kind === "PAYMENT_HOLD" && a.status === "IN_EFFECT");

  const submit = form.handleSubmit(async (body) => {
    try {
      await decide.mutateAsync(body);
      form.reset(DECIDE_DEFAULTS);
    } catch {
      // Toast from the mutation hook.
    }
  });

  return (
    <section aria-labelledby="flag-decide-heading" className="space-y-3 border-t border-slate-100 pt-4">
      <h4 id="flag-decide-heading" className="text-xs font-bold text-slate-900">
        Record an action
      </h4>
      <form onSubmit={submit} noValidate className="space-y-3">
        <fieldset aria-labelledby={groupId} className="space-y-1.5">
          <legend id={groupId} className="sr-only">
            Action
          </legend>
          {ContractorFlagActionKindEnum.options.map((k) => {
            const meta = CONTRACTOR_FLAG_ACTION_META[k];
            const disabled = k === "PAYMENT_HOLD" && holdInEffect;
            return (
              <label
                key={k}
                className={`flex cursor-pointer items-start gap-2 rounded-xl border p-2.5 ${
                  kind === k ? "border-brand-primary bg-brand-primary/5" : "border-slate-200 hover:bg-slate-50"
                } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
              >
                <input type="radio" value={k} disabled={disabled} className="mt-0.5" {...form.register("kind")} />
                <span>
                  <span className="block font-semibold text-slate-900">{meta.label}</span>
                  <span className="block text-[11px] text-slate-600">{disabled ? "A payment hold is already in effect." : meta.description}</span>
                </span>
              </label>
            );
          })}
        </fieldset>

        {kind === "ADDITIONAL_VISITS" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="flag-visit-count" className={labelClass}>
                Number of monitoring visits
              </label>
              <input
                id="flag-visit-count"
                type="number"
                min={1}
                max={10}
                step={1}
                className={`${inputClass} ${invalidClass(form, "visitCount")}`}
                {...form.register("visitCount")}
                {...fieldA11y(form, "visitCount")}
              />
              <FieldError form={form} name="visitCount" />
            </div>
            <Controller
              control={form.control}
              name="visitKind"
              render={({ field }) => (
                <CustomSelect
                  label="Kind of monitoring visit (optional)"
                  value={field.value}
                  onChange={field.onChange}
                  options={[{ value: "", label: "Routine (default)" }, ...EXTRA_VISIT_KINDS.map((k) => ({ value: k, label: VISIT_KIND_META[k].label }))]}
                />
              )}
            />
            <p className="text-[11px] text-slate-500 sm:col-span-2">
              Proposed to the project's monitoring officers. They appear in the monitoring planner to publish.
            </p>
          </div>
        )}

        {kind === "DEDUCTION" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="flag-deduction-amount" className={labelClass}>
                Amount (₦)
              </label>
              <input
                id="flag-deduction-amount"
                inputMode="decimal"
                className={`${inputClass} ${invalidClass(form, "deductionAmount")}`}
                {...form.register("deductionAmount")}
                {...fieldA11y(form, "deductionAmount")}
              />
              <FieldError form={form} name="deductionAmount" />
            </div>
            <div>
              <label htmlFor="flag-deduction-clause" className={labelClass}>
                Contract clause
              </label>
              <input
                id="flag-deduction-clause"
                placeholder="e.g. 14.2 liquidated damages"
                maxLength={200}
                className={`${inputClass} ${invalidClass(form, "clause")}`}
                {...form.register("clause")}
                {...fieldA11y(form, "clause")}
              />
              <FieldError form={form} name="clause" />
            </div>
          </div>
        )}

        <div>
          <label htmlFor="flag-reason" className={labelClass}>
            Reason <span className="text-red-500">*</span>
          </label>
          <textarea
            id="flag-reason"
            rows={3}
            maxLength={1000}
            className={`${inputClass} ${invalidClass(form, "reason")}`}
            {...form.register("reason")}
            {...fieldA11y(form, "reason")}
          />
          <FieldError form={form} name="reason" />
          <p className="mt-1 text-[11px] text-slate-500">Recorded in the audit ledger with your name.</p>
        </div>

        <div className="flex justify-end">
          <SubmitButton form={form} pending={decide.isPending} pendingLabel="Recording…" hint="Choose an action and give the reason.">
            Record action
          </SubmitButton>
        </div>
      </form>
    </section>
  );
}

function LiftHoldDialog({ flag, action, onClose }: { flag: ContractorFlagDto; action: ContractorFlagActionDto; onClose: () => void }) {
  const lift = useLiftContractorFlagActionMutation(flag.id);
  const form = useZodForm(LiftContractorFlagActionRequestSchema, { defaultValues: { reason: "" } });
  const submit = form.handleSubmit(async (body) => {
    try {
      await lift.mutateAsync({ actionId: action.id, body });
      onClose();
    } catch {
      // Toast from the mutation hook.
    }
  });
  return (
    <ModalShell title="Lift payment hold" subtitle={`${flag.contractorName} · since ${formatDateTimeShort(action.decidedAt)}`} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-3 p-5">
        <p className="text-xs text-slate-600">Payments on this project are recorded without an override reason again once the hold is lifted.</p>
        <div>
          <label htmlFor="flag-lift-reason" className={labelClass}>
            Reason <span className="text-red-500">*</span>
          </label>
          <textarea
            id="flag-lift-reason"
            rows={3}
            maxLength={1000}
            className={`${inputClass} ${invalidClass(form, "reason")}`}
            {...form.register("reason")}
            {...fieldA11y(form, "reason")}
          />
          <FieldError form={form} name="reason" />
        </div>
        <div className="flex flex-wrap items-start justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">
            Cancel
          </button>
          <SubmitButton form={form} pending={lift.isPending} pendingLabel="Lifting…">
            Lift hold
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}
