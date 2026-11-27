import React, { useMemo } from "react";
import { z } from "zod";
import {
  AssignNeedsVerificationRequestSchema,
  CancelNeedsVerificationRequestSchema,
  NEEDS_VERIFICATION_PURPOSE_LABELS,
  addDays,
  type NeedsVerificationDto,
  type NeedsVerificationPurpose,
} from "@insite/shared";
import { ModalShell } from "../../common/ModalShell";
import { CustomSelect } from "../../common/CustomSelect";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../../lib/forms";
import { useVerificationOfficersQuery } from "../../../queries/needs/useVerificationQueries";
import { useAssignVerificationMutation, useCancelVerificationMutation } from "../../../mutations/needs/useVerificationMutations";
import { inputCls, labelCls, plural, todayInTenant } from "../needsUi";
import { sitesText } from "./verificationUi";

/**
 * Needs pipeline wave 5 (N8): assign a field verification of a proposed project to an officer with a
 * field app sign-in (`POST /needs/proposals/:id/verifications`), and cancel one. The officer list comes
 * from the server (`verification-officers`, with each officer's open verifications). All sites are
 * ticked by default; ticking all sends an empty list (= every site of the current version).
 */

export type AssignSite = { siteNumber: number; schoolName: string };

const AssignFormSchema = z
  .object({
    officerUserId: z.string().min(1, "Choose the officer"),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the due date"),
    siteNumbers: z.array(z.number()).min(1, "Tick at least one site"),
    allSites: z.number(),
    instructions: z.string().max(2000, "At most 2,000 characters"),
  })
  .superRefine((v, ctx) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v.dueDate) && v.dueDate < todayInTenant()) ctx.addIssue({ code: "custom", path: ["dueDate"], message: "The due date cannot be in the past" });
  })
  .transform((v) => ({
    officerUserId: v.officerUserId,
    dueDate: v.dueDate,
    siteNumbers: v.siteNumbers.length === v.allSites ? [] : [...v.siteNumbers].sort((a, b) => a - b),
    instructions: v.instructions.trim() || null,
  }));

export function AssignVerificationDialog({
  proposal,
  purpose,
  sites,
  onClose,
}: {
  proposal: { id: string; reference: string; title: string };
  purpose: NeedsVerificationPurpose;
  /** The sites of the current needs assessment version. */
  sites: AssignSite[];
  onClose: () => void;
}) {
  const officersQuery = useVerificationOfficersQuery(proposal.id, purpose);
  const assign = useAssignVerificationMutation(proposal.id);
  const schema = useMemo(() => AssignFormSchema.transform((v) => ({ ...v, purpose })).pipe(AssignNeedsVerificationRequestSchema), [purpose]);
  const form = useZodForm(schema, {
    defaultValues: {
      officerUserId: "",
      dueDate: addDays(todayInTenant(), 7),
      siteNumbers: sites.map((s) => s.siteNumber),
      allSites: sites.length,
      instructions: "",
    },
  });
  const officerId = form.watch("officerUserId");
  const ticked = form.watch("siteNumbers");
  const officers = officersQuery.data ?? [];
  const options = officers.map((o) => ({
    value: o.userId,
    label: o.name,
    description: [o.roleName, o.organizationName, o.openVerifications ? `${plural(o.openVerifications, "open verification")}` : "No open verification"].filter(Boolean).join(" · "),
  }));
  const touch = { shouldValidate: true, shouldDirty: true, shouldTouch: true } as const;

  return (
    <ModalShell title={purpose === "BEAP_REVIEW" ? "Assign a BEAP site visit" : "Assign a field verification"} subtitle={`${proposal.reference} · ${proposal.title}`} onClose={onClose} maxWidth="max-w-lg">
      <form className="space-y-4 p-5" noValidate onSubmit={form.handleSubmit((body) => assign.mutate(body, { onSuccess: () => onClose() }))}>
        <p className="text-xs text-slate-600">
          {NEEDS_VERIFICATION_PURPOSE_LABELS[purpose]}. The officer gets the form on the field app: a location and the answers at each site, then a count and condition for each
          facility of the needs assessment, with photos. You review it here when it is submitted.
        </p>

        <div>
          <p className={labelCls}>
            Officer <span className="text-rose-600">*</span>
          </p>
          {officersQuery.isError ? (
            <p role="alert" className="text-xs font-medium text-rose-700">
              The officers could not be loaded.
            </p>
          ) : !officersQuery.isLoading && officers.length === 0 ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Nobody can be assigned: the officer needs a field app sign-in in the right organisation. Ask the administrator to set one up.
            </p>
          ) : (
            <CustomSelect
              ariaLabel="Officer"
              value={officerId}
              placeholder={officersQuery.isLoading ? "Loading…" : "Choose the officer"}
              onChange={(v) => form.setValue("officerUserId", v, touch)}
              options={options}
              searchable={options.length > 8}
              size="sm"
            />
          )}
          <FieldError form={form} name="officerUserId" />
        </div>

        <div>
          <label className={labelCls} htmlFor="verification-due">
            Due date <span className="text-rose-600">*</span>
          </label>
          <input id="verification-due" type="date" min={todayInTenant()} className={`${inputCls} ${invalidClass(form, "dueDate")}`} {...form.register("dueDate")} {...fieldA11y(form, "dueDate")} />
          <FieldError form={form} name="dueDate" />
        </div>

        <fieldset>
          <legend className={labelCls}>
            Sites to visit <span className="text-rose-600">*</span>
          </legend>
          {sites.length === 0 ? (
            <p className="text-xs text-slate-500">The current needs assessment version lists no site.</p>
          ) : (
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
              {sites.map((s) => (
                <label key={s.siteNumber} className="flex items-start gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={ticked.includes(s.siteNumber)}
                    onChange={(e) =>
                      form.setValue("siteNumbers", e.target.checked ? [...ticked, s.siteNumber] : ticked.filter((n) => n !== s.siteNumber), touch)
                    }
                  />
                  <span>
                    <span className="font-semibold text-slate-900">Site {s.siteNumber}</span> · {s.schoolName}
                  </span>
                </label>
              ))}
            </div>
          )}
          <FieldError form={form} name="siteNumbers" />
        </fieldset>

        <div>
          <label className={labelCls} htmlFor="verification-instructions">
            Instructions <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <textarea
            id="verification-instructions"
            rows={3}
            className={`${inputCls} ${invalidClass(form, "instructions")}`}
            placeholder="What to look at closely, who to meet at the school…"
            {...form.register("instructions")}
            {...fieldA11y(form, "instructions")}
          />
          <FieldError form={form} name="instructions" />
        </div>

        <div className="flex flex-wrap items-start justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">
            Cancel
          </button>
          <SubmitButton form={form} pending={assign.isPending} pendingLabel="Assigning…" blocked={sites.length === 0} hint="Choose the officer, the due date and at least one site.">
            Assign
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}

export function CancelVerificationDialog({ verification, onClose }: { verification: NeedsVerificationDto; onClose: () => void }) {
  const cancel = useCancelVerificationMutation();
  const form = useZodForm(CancelNeedsVerificationRequestSchema, { defaultValues: { reason: "" } });
  return (
    <ModalShell title="Cancel the field verification" subtitle={`${verification.reference} · ${verification.officer.name}`} onClose={onClose} maxWidth="max-w-md">
      <form
        className="space-y-3 p-5"
        noValidate
        onSubmit={form.handleSubmit((body) => cancel.mutate({ verificationId: verification.id, body }, { onSuccess: () => onClose() }))}
      >
        <p className="text-xs text-slate-700">
          {sitesText(verification.sites)}. It leaves {verification.officer.name}'s field app at the next sync; anything not yet submitted is not kept.
        </p>
        <div>
          <label className={labelCls} htmlFor="verification-cancel-reason">
            Reason <span className="text-rose-600">*</span>
          </label>
          <textarea id="verification-cancel-reason" rows={3} className={`${inputCls} ${invalidClass(form, "reason")}`} {...form.register("reason")} {...fieldA11y(form, "reason")} />
          <FieldError form={form} name="reason" />
        </div>
        <div className="flex flex-wrap items-start justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">
            Keep it
          </button>
          <SubmitButton form={form} pending={cancel.isPending} pendingLabel="Cancelling…" hint="Give a reason.">
            Cancel the verification
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}
