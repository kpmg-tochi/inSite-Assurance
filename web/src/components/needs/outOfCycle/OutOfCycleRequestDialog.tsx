import React, { useEffect, useMemo } from "react";
import { z } from "zod";
import {
  OUT_OF_CYCLE_REASON_LABELS,
  OutOfCycleReasonEnum,
  OutOfCycleRequestSchema,
  type NeedsOptionsDto,
  type NeedsOutOfCycleDto,
  type OutOfCycleReason,
} from "@insite/shared";
import { ModalShell } from "../../common/ModalShell";
import { CustomSelect } from "../../common/CustomSelect";
import { stateOptions as allStateOptions } from "../../common/AdminAreaSelect";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm, zChoice, zNumberText } from "../../../lib/forms";
import { useCreateOutOfCycleMutation } from "../../../mutations/needs/useApprovalMutations";
import { stateName } from "../../approvedLists/approvedListUi";
import { inputCls, labelCls } from "../needsUi";

/**
 * Needs pipeline wave 4 (C4, D-N.14): ask for a project outside the annual cycle (replaces "Start
 * without one"). Programme, intervention year, the State for a State-level programme (Matching
 * Grants), title, reason, why it cannot wait and the amount asked for. The request is created as a
 * draft; the authorising document (required) and an optional needs assessment are added on its page,
 * then it is submitted to the programme's out-of-cycle approval chain.
 */

const FormSchema = z
  .object({
    projectTypeId: zChoice("Programme"),
    interventionYear: zNumberText("Intervention year", { min: 2000, max: 2100, int: true }),
    stateCode: z.string(),
    title: OutOfCycleRequestSchema.shape.title,
    reason: zChoice("Reason"),
    reasonDetails: OutOfCycleRequestSchema.shape.reasonDetails,
    requestedAmount: zNumberText("Amount requested", { min: 1 }),
  })
  .transform((v) => ({
    projectTypeId: v.projectTypeId,
    interventionYear: v.interventionYear,
    stateCode: v.stateCode || null,
    title: v.title,
    reason: v.reason as OutOfCycleReason,
    reasonDetails: v.reasonDetails,
    requestedAmountNgn: v.requestedAmount,
  }));

const REASON_OPTIONS = OutOfCycleReasonEnum.options.map((r) => ({ value: r, label: OUT_OF_CYCLE_REASON_LABELS[r] }));

export function OutOfCycleRequestDialog({
  options,
  initial,
  onClose,
  onCreated,
}: {
  options: NeedsOptionsDto;
  /** Preselected from the cycle the user is looking at. */
  initial?: { projectTypeId: string; interventionYear: number; stateCode: string | null } | null;
  onClose: () => void;
  onCreated: (request: NeedsOutOfCycleDto) => void;
}) {
  const programmes = options.programmes;
  const create = useCreateOutOfCycleMutation();
  const form = useZodForm(FormSchema, {
    defaultValues: {
      projectTypeId: initial?.projectTypeId ?? (programmes.length === 1 ? programmes[0].projectTypeId : ""),
      interventionYear: String(initial?.interventionYear ?? options.suggestedInterventionYear),
      stateCode: initial?.stateCode ?? "",
      title: "",
      reason: "",
      reasonDetails: "",
      requestedAmount: "",
    },
  });
  const projectTypeId = form.watch("projectTypeId");
  const stateCode = form.watch("stateCode");
  const reason = form.watch("reason");
  const programme = programmes.find((p) => p.projectTypeId === projectTypeId) ?? null;
  const isState = programme?.cycleScope === "STATE";

  // A State-level programme: the user's own State when there is just one; national programmes have none.
  useEffect(() => {
    if (!programme) return;
    if (!isState) form.setValue("stateCode", "", { shouldValidate: true });
    else if (!form.getValues("stateCode") && programme.openableStateCodes.length === 1) form.setValue("stateCode", programme.openableStateCodes[0], { shouldValidate: true });
  }, [programme, isState, form]);

  const stateChoices = useMemo(
    () =>
      programme && programme.openableStateCodes.length > 0
        ? programme.openableStateCodes.map((c) => ({ value: c, label: stateName(c) }))
        : allStateOptions(),
    [programme]
  );
  const stateMissing = isState && !stateCode;

  const submit = form.handleSubmit((v) => {
    if (stateMissing) return;
    create.mutate({ ...v, stateCode: isState ? v.stateCode : null }, { onSuccess: (r) => onCreated(r) });
  });

  return (
    <ModalShell title="Out-of-cycle project" subtitle="A project that cannot wait for the annual needs assessment cycle" onClose={onClose} maxWidth="max-w-2xl">
      <form className="space-y-3 p-5" noValidate onSubmit={submit}>
        <p className="text-xs text-slate-700">
          The request needs an authorising document (for example the directive, the supplementary budget or the funder's letter) and goes through the programme's
          out-of-cycle approval. A needs assessment file is optional but helps the approvers. Once approved it becomes a draft project.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="ooc-programme">
              Programme <span className="text-rose-600">*</span>
            </label>
            <CustomSelect
              id="ooc-programme"
              value={projectTypeId}
              onChange={(v) => form.setValue("projectTypeId", v, { shouldValidate: true, shouldDirty: true })}
              options={programmes.map((p) => ({ value: p.projectTypeId, label: p.projectTypeName }))}
              placeholder="Choose the programme"
              size="sm"
            />
            <FieldError form={form} name="projectTypeId" />
          </div>
          <div>
            <label className={labelCls} htmlFor="ooc-year">
              Intervention year <span className="text-rose-600">*</span>
            </label>
            <input id="ooc-year" inputMode="numeric" className={`${inputCls} ${invalidClass(form, "interventionYear")}`} {...form.register("interventionYear")} {...fieldA11y(form, "interventionYear")} />
            <FieldError form={form} name="interventionYear" />
          </div>
          {isState && (
            <div>
              <label className={labelCls} htmlFor="ooc-state">
                State <span className="text-rose-600">*</span>
              </label>
              <CustomSelect
                id="ooc-state"
                value={stateCode}
                onChange={(v) => form.setValue("stateCode", v, { shouldValidate: true, shouldDirty: true })}
                options={stateChoices}
                placeholder="Choose the State"
                size="sm"
                searchable={stateChoices.length > 8}
              />
            </div>
          )}
          <div className={isState ? "" : "sm:col-span-2"}>
            <label className={labelCls} htmlFor="ooc-amount">
              Amount requested (₦) <span className="text-rose-600">*</span>
            </label>
            <input id="ooc-amount" inputMode="decimal" placeholder="e.g. 45,000,000" className={`${inputCls} ${invalidClass(form, "requestedAmount")}`} {...form.register("requestedAmount")} {...fieldA11y(form, "requestedAmount")} />
            <FieldError form={form} name="requestedAmount" />
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor="ooc-title">
            Title <span className="text-rose-600">*</span>
          </label>
          <input id="ooc-title" placeholder="e.g. Emergency classroom repair, Gwale Primary School" className={`${inputCls} ${invalidClass(form, "title")}`} {...form.register("title")} {...fieldA11y(form, "title")} />
          <FieldError form={form} name="title" />
        </div>
        <div>
          <label className={labelCls} htmlFor="ooc-reason">
            Reason <span className="text-rose-600">*</span>
          </label>
          <CustomSelect
            id="ooc-reason"
            value={reason}
            onChange={(v) => form.setValue("reason", v, { shouldValidate: true, shouldDirty: true })}
            options={REASON_OPTIONS}
            placeholder="Choose the reason"
            size="sm"
          />
          <FieldError form={form} name="reason" />
        </div>
        <div>
          <label className={labelCls} htmlFor="ooc-details">
            Why it cannot wait for the annual cycle <span className="text-rose-600">*</span>
          </label>
          <textarea id="ooc-details" rows={4} className={`${inputCls} ${invalidClass(form, "reasonDetails")}`} {...form.register("reasonDetails")} {...fieldA11y(form, "reasonDetails")} />
          <FieldError form={form} name="reasonDetails" />
        </div>
        <div className="flex flex-wrap items-start justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">
            Cancel
          </button>
          <SubmitButton form={form} pending={create.isPending} pendingLabel="Creating…" blocked={stateMissing} hint={stateMissing ? "Choose the State." : undefined}>
            Create the request
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}
