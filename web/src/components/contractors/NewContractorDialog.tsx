import React, { useMemo, useState } from "react";
import { z } from "zod";
import {
  CONTRACTOR_STATUS_LABELS,
  CreateContractorRequestSchema,
  RC_NUMBER_REGEX,
  type ContractorDuplicateCandidate,
} from "@insite/shared";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../lib/forms";
import { ModalShell } from "../common/ModalShell";
import { CustomSelect } from "../common/CustomSelect";
import { stateOptions } from "../common/AdminAreaSelect";
import { duplicateCandidatesOf } from "../../api/contractors";
import { useCreateContractorMutation } from "../../mutations/contractors";

const optionalText = (max: number) => z.string().trim().max(max, `At most ${max} characters`);

/** Text inputs → the create request (empty → null). */
const NewContractorFormSchema = z
  .object({
    name: CreateContractorRequestSchema.shape.name,
    registrationNumber: z
      .string()
      .trim()
      .refine((v) => v === "" || RC_NUMBER_REGEX.test(v), "Use the CAC number, e.g. RC 1234567"),
    contactPhone: optionalText(40),
    contactEmail: z
      .string()
      .trim()
      .refine((v) => v === "" || z.string().email().safeParse(v).success, "Enter a valid email"),
    stateCode: z.string(),
  })
  .transform((v) => ({
    name: v.name,
    registrationNumber: v.registrationNumber || null,
    contactPhone: v.contactPhone || null,
    contactEmail: v.contactEmail || null,
    stateCode: v.stateCode || null,
  }));

type Created = { id: string; name: string };

const inputBase =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary";
const labelClass = "block text-xs font-semibold text-slate-700 mb-1";

/**
 * Client demo updates F.2: "+ New contractor" from the picker. Creates the contractor INACTIVE
 * (until its signed contract is on file). A 409 CONTRACTOR_DUPLICATE lists the existing records:
 * pick one, or (close name matches only) confirm it is a different company.
 */
export function NewContractorDialog({
  initialName = "",
  onClose,
  onSelect,
}: {
  initialName?: string;
  onClose: () => void;
  onSelect: (contractor: Created) => void;
}) {
  const form = useZodForm(NewContractorFormSchema, {
    defaultValues: { name: initialName, registrationNumber: "", contactPhone: "", contactEmail: "", stateCode: "" },
  });
  const create = useCreateContractorMutation();
  const [candidates, setCandidates] = useState<ContractorDuplicateCandidate[] | null>(null);
  const states = useMemo(() => stateOptions(null, "No state"), []);
  const stateCode = form.watch("stateCode");
  const exact = candidates?.some((c) => c.match === "EXACT_RC") ?? false;

  const submit = (confirmNotDuplicate: boolean) =>
    form.handleSubmit((body) =>
      create.mutate(
        { ...body, ...(confirmNotDuplicate ? { confirmNotDuplicate: true } : {}) },
        {
          onSuccess: (c) => onSelect({ id: c.id, name: c.name }),
          onError: (err) => setCandidates(duplicateCandidatesOf(err)),
        }
      )
    )();

  return (
    <ModalShell title="New contractor" subtitle="Added inactive until its signed contract is on file" onClose={onClose}>
      <form
        className="space-y-3 p-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
      >
        <div>
          <label className={labelClass} htmlFor="new-contractor-name">
            Registered name <span className="text-red-500">*</span>
          </label>
          <input
            id="new-contractor-name"
            className={`${inputBase} ${invalidClass(form, "name")}`}
            {...form.register("name", { onChange: () => setCandidates(null) })}
            {...fieldA11y(form, "name")}
          />
          <FieldError form={form} name="name" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="new-contractor-rc">
              CAC registration number
            </label>
            <input
              id="new-contractor-rc"
              placeholder="RC 1234567"
              className={`${inputBase} ${invalidClass(form, "registrationNumber")}`}
              {...form.register("registrationNumber", { onChange: () => setCandidates(null) })}
              {...fieldA11y(form, "registrationNumber")}
            />
            <FieldError form={form} name="registrationNumber" />
          </div>
          <div>
            <p className={labelClass} id="new-contractor-state-label">
              State
            </p>
            <CustomSelect
              value={stateCode}
              onChange={(v) => form.setValue("stateCode", v, { shouldValidate: true, shouldDirty: true })}
              options={states}
              placeholder="Choose the state"
              ariaLabel="State"
              searchable
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="new-contractor-phone">
              Phone
            </label>
            <input id="new-contractor-phone" className={`${inputBase} ${invalidClass(form, "contactPhone")}`} {...form.register("contactPhone")} {...fieldA11y(form, "contactPhone")} />
            <FieldError form={form} name="contactPhone" />
          </div>
          <div>
            <label className={labelClass} htmlFor="new-contractor-email">
              Email
            </label>
            <input
              id="new-contractor-email"
              type="email"
              className={`${inputBase} ${invalidClass(form, "contactEmail")}`}
              {...form.register("contactEmail")}
              {...fieldA11y(form, "contactEmail")}
            />
            <FieldError form={form} name="contactEmail" />
          </div>
        </div>

        {candidates && candidates.length > 0 && (
          <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900" role="alert">
            <p className="font-semibold">
              {exact ? "This registration number is already on the register." : "Contractors with a similar name are already on the register."}
            </p>
            <ul className="space-y-1">
              {candidates.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/70 px-2 py-1.5">
                  <span>
                    <span className="font-semibold text-slate-900">{c.name}</span>
                    <span className="text-slate-500"> · {c.registrationNumber ?? "no RC number"} · {CONTRACTOR_STATUS_LABELS[c.status]}</span>
                  </span>
                  {c.status === "SUSPENDED" ? (
                    <span className="text-[11px] text-rose-700">Suspended: cannot be named</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelect({ id: c.id, name: c.name })}
                      className="rounded-lg border border-brand-primary px-2 py-1 text-[11px] font-semibold text-brand-primary hover:bg-brand-primary/5"
                    >
                      Use this contractor
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {!exact && (
              <button
                type="button"
                onClick={() => submit(true)}
                disabled={create.isPending}
                className="text-[11px] font-semibold text-amber-900 underline disabled:opacity-50"
              >
                It is a different company: add it anyway
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-start justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">
            Cancel
          </button>
          <SubmitButton form={form} pending={create.isPending} pendingLabel="Adding…" blocked={Boolean(candidates?.length)}>
            Add contractor
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}
