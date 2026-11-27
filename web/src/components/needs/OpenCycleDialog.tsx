import React, { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { FileUp } from "lucide-react";
import { NEEDS_DOCUMENT_UPLOAD_POLICY, type NeedsDeadline, type NeedsOptionsDto } from "@insite/shared";
import { ModalShell } from "../common/ModalShell";
import { CustomSelect } from "../common/CustomSelect";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm, zChoice, zNumberText } from "../../lib/forms";
import { formatDateShort } from "../../lib/formatters";
import { mimeTypeOf } from "../../api/needsPipeline";
import { useCarryForwardQuery } from "../../queries/needs/useNeedsQueries";
import { useAddCycleDocumentMutation, useOpenNeedsCycleMutation } from "../../mutations/needs/useNeedsMutations";
import { stateName } from "../approvedLists/approvedListUi";
import { DOCUMENT_FILE_ACCEPT, formatBytes, inputCls, labelCls, locationText, money, plural } from "./needsUi";

/**
 * Needs pipeline wave 2 (C3): open an annual cycle. Programme (only those the user may open), the
 * intervention year (default: the year a cycle opened today is for), the State for a State-level
 * programme (Matching Grants), an indicative ceiling, the deadlines (the programme's calendar,
 * editable; only changed dates are sent), the previous cycle's not-selected proposals to carry
 * forward, and, for a State-level programme, the circular: uploaded as a CIRCULAR cycle document
 * once the cycle exists (it can also be added later under Cycle documents).
 */

const FormSchema = z
  .object({
    projectTypeId: zChoice("Programme"),
    interventionYear: zNumberText("Intervention year", { min: 2000, max: 2100, int: true }),
    stateCode: z.string(),
    ceiling: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\d+(\.\d+)?$/.test(v.replace(/,/g, "")), "Enter the ceiling in naira, or leave it empty"),
  })
  .transform((v) => ({
    projectTypeId: v.projectTypeId,
    interventionYear: v.interventionYear,
    stateCode: v.stateCode || null,
    indicativeCeilingNgn: v.ceiling === "" ? null : Number(v.ceiling.replace(/,/g, "")),
  }));

/** The same calendar date `years` later (29 Feb becomes 28 Feb in a common year). */
function shiftYears(date: string, years: number): string {
  if (years === 0) return date;
  const [y, m, d] = date.split("-").map(Number);
  const year = y + years;
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${year}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export function OpenCycleDialog({
  options,
  onClose,
  onOpened,
}: {
  options: NeedsOptionsDto;
  onClose: () => void;
  onOpened: (cycleId: string) => void;
}) {
  const programmes = useMemo(() => options.programmes.filter((p) => p.canOpen), [options.programmes]);
  const form = useZodForm(FormSchema, {
    defaultValues: {
      projectTypeId: programmes.length === 1 ? programmes[0].projectTypeId : "",
      interventionYear: String(options.suggestedInterventionYear),
      stateCode: "",
      ceiling: "",
    },
  });
  const open = useOpenNeedsCycleMutation();
  const addDocument = useAddCycleDocumentMutation();
  const projectTypeId = form.watch("projectTypeId");
  const yearText = form.watch("interventionYear");
  const stateCode = form.watch("stateCode");
  const programme = programmes.find((p) => p.projectTypeId === projectTypeId) ?? null;
  const isState = programme?.cycleScope === "STATE";
  const year = /^\d{4}$/.test(yearText.trim()) ? Number(yearText.trim()) : null;

  // A State-level programme: the user's own State is preselected when there is only one.
  useEffect(() => {
    if (!programme) return;
    if (programme.cycleScope !== "STATE") form.setValue("stateCode", "", { shouldValidate: true });
    else if (programme.openableStateCodes.length === 1) form.setValue("stateCode", programme.openableStateCodes[0], { shouldValidate: true });
  }, [programme, form]);

  // Deadlines: the programme's calendar for the chosen year, with the user's changes on top.
  const [edited, setEdited] = useState<Record<string, string>>({});
  useEffect(() => setEdited({}), [projectTypeId]);
  const defaults: NeedsDeadline[] = useMemo(() => {
    if (!programme || year === null) return [];
    const shift = year - options.suggestedInterventionYear;
    return programme.defaultDeadlines.map((d) => ({ ...d, date: shiftYears(d.date, shift) }));
  }, [programme, year, options.suggestedInterventionYear]);

  const carry = useCarryForwardQuery(
    programme && year !== null && (!isState || stateCode) ? { projectTypeId: programme.projectTypeId, interventionYear: year, stateCode: isState ? stateCode : null } : null
  );
  const [carried, setCarried] = useState<string[]>([]);
  useEffect(() => setCarried([]), [projectTypeId, year, stateCode]);

  const circularRef = useRef<HTMLInputElement>(null);
  const [circular, setCircular] = useState<File | null>(null);
  const [circularError, setCircularError] = useState<string | null>(null);

  const stateMissing = isState && !stateCode;
  const badDate = Object.values(edited).some((v) => !/^\d{4}-\d{2}-\d{2}$/.test(v));

  const submit = form.handleSubmit((values) => {
    if (!programme || stateMissing) return;
    const overrides = defaults.filter((d) => edited[d.key] && edited[d.key] !== d.date).map((d) => ({ key: d.key, date: edited[d.key] }));
    open.mutate(
      {
        projectTypeId: values.projectTypeId,
        interventionYear: values.interventionYear,
        stateCode: isState ? values.stateCode : null,
        indicativeCeilingNgn: values.indicativeCeilingNgn,
        deadlines: overrides,
        carryForwardProposalIds: carried,
      },
      {
        onSuccess: (cycle) => {
          if (isState && circular) {
            addDocument.mutate(
              { cycleId: cycle.id, file: circular, kind: "CIRCULAR", title: `Circular for the ${cycle.interventionYear} cycle` },
              { onSettled: () => onOpened(cycle.id) }
            );
          } else onOpened(cycle.id);
        },
      }
    );
  });

  const programmeOptions = programmes.map((p) => ({
    value: p.projectTypeId,
    label: p.projectTypeName,
    description: p.cycleScope === "STATE" ? "One cycle per State" : "One national cycle",
  }));
  const stateOptions = (programme?.openableStateCodes ?? []).map((c) => ({ value: c, label: stateName(c) }));
  const candidates = carry.data ?? [];

  return (
    <ModalShell title="Open a needs assessment cycle" subtitle="Proposed projects for one intervention year are uploaded, checked and decided in the cycle" onClose={onClose} maxWidth="max-w-3xl">
      <form className="space-y-4 p-5" noValidate onSubmit={submit}>
        {programmes.length === 0 && (
          <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            You cannot open a cycle for any programme: a cycle is opened by the owning organisation (UBEC for Direct Intervention, the State's SUBEB for
            Matching Grants).
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <p className={labelCls}>
              Programme <span className="text-rose-600">*</span>
            </p>
            <CustomSelect
              ariaLabel="Programme"
              value={projectTypeId}
              onChange={(v) => form.setValue("projectTypeId", v, { shouldValidate: true, shouldDirty: true, shouldTouch: true })}
              options={programmeOptions}
              placeholder="Choose the programme"
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="open-cycle-year">
              Intervention year <span className="text-rose-600">*</span>
            </label>
            <input
              id="open-cycle-year"
              inputMode="numeric"
              className={`${inputCls} ${invalidClass(form, "interventionYear")}`}
              {...form.register("interventionYear")}
              {...fieldA11y(form, "interventionYear")}
            />
            <FieldError form={form} name="interventionYear" />
            <p className="mt-1 text-[11px] text-slate-500">The cycle for year Y runs during Y − 1.</p>
          </div>
          {isState && (
            <div>
              <p className={labelCls}>
                State <span className="text-rose-600">*</span>
              </p>
              <CustomSelect
                ariaLabel="State"
                value={stateCode}
                onChange={(v) => form.setValue("stateCode", v, { shouldValidate: true, shouldDirty: true })}
                options={stateOptions}
                placeholder={stateOptions.length ? "Choose the State" : "No State you can open a cycle for"}
                disabled={stateOptions.length === 0}
              />
            </div>
          )}
          <div>
            <label className={labelCls} htmlFor="open-cycle-ceiling">
              Indicative ceiling (₦)
            </label>
            <input
              id="open-cycle-ceiling"
              inputMode="decimal"
              placeholder="Optional"
              className={`${inputCls} ${invalidClass(form, "ceiling")}`}
              {...form.register("ceiling")}
              {...fieldA11y(form, "ceiling")}
            />
            <FieldError form={form} name="ceiling" />
            <p className="mt-1 text-[11px] text-slate-500">The funding line for prioritisation. It can be changed later.</p>
          </div>
        </div>

        {defaults.length > 0 && (
          <fieldset>
            <legend className={labelCls}>Deadlines</legend>
            <p className="mb-1 text-[11px] text-slate-500">From the programme's calendar. Change a date only when this year's process differs.</p>
            <div className="overflow-x-auto rounded-xl border border-slate-200" role="region" aria-label="Deadlines" tabIndex={0}>
              <table className="w-full min-w-[460px] text-xs">
                <thead className="bg-slate-50">
                  <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                    <th scope="col" className="px-3 py-1.5">Step</th>
                    <th scope="col" className="px-3 py-1.5">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {defaults.map((d) => {
                    const value = edited[d.key] ?? d.date;
                    const changed = value !== d.date;
                    return (
                      <tr key={d.key}>
                        <td className="px-3 py-1.5 text-slate-800">
                          {d.label}
                          {changed && <span className="block text-[10px] text-amber-800">Changed from {formatDateShort(d.date)}</span>}
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="date"
                            aria-label={`${d.label} date`}
                            className={`${inputCls} w-40`}
                            value={value}
                            onChange={(e) => setEdited((prev) => ({ ...prev, [d.key]: e.target.value }))}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {badDate && <p className="mt-1 text-xs font-medium text-rose-700">Enter every date, or set it back.</p>}
          </fieldset>
        )}

        {programme && year !== null && (!isState || stateCode) && (
          <fieldset>
            <legend className={labelCls}>Carry forward from {year - 1}</legend>
            {carry.isLoading ? (
              <p className="text-xs text-slate-500">Looking for proposed projects not selected last year…</p>
            ) : candidates.length === 0 ? (
              <p className="text-xs text-slate-500">No proposed project from the {year - 1} cycle is waiting to be carried forward.</p>
            ) : (
              <>
                <p className="mb-1 text-[11px] text-slate-500">
                  Proposed projects not selected last year. Ticked ones come into this cycle at Identification with their last version.
                </p>
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
                  {candidates.map((c) => (
                    <label key={c.proposalId} className="flex items-start gap-2 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={carried.includes(c.proposalId)}
                        onChange={(e) => setCarried((prev) => (e.target.checked ? [...prev, c.proposalId] : prev.filter((id) => id !== c.proposalId)))}
                      />
                      <span>
                        <span className="font-semibold text-slate-900">{c.reference}</span> · {c.title}
                        <span className="block text-[11px] text-slate-500">
                          {c.statusLabel}
                          {c.statusReason ? `: ${c.statusReason}` : ""} · {plural(c.siteCount, "site")} · {locationText(null, c.lgaCodes)} ·{" "}
                          {money(c.costedAmountNgn ?? c.preliminaryCostNgn)}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </fieldset>
        )}

        {isState && (
          <div>
            <p className={labelCls}>Circular</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => circularRef.current?.click()}
              >
                <FileUp className="h-3.5 w-3.5" aria-hidden="true" /> {circular ? "Choose another file" : "Choose the circular"}
              </button>
              {circular && (
                <span className="text-xs text-slate-700">
                  {circular.name} <span className="text-slate-500">· {formatBytes(circular.size)}</span>
                </span>
              )}
            </div>
            <input
              ref={circularRef}
              type="file"
              accept={DOCUMENT_FILE_ACCEPT}
              className="hidden"
              aria-label="Circular file"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                e.target.value = "";
                if (!f) return;
                const problem =
                  f.size > NEEDS_DOCUMENT_UPLOAD_POLICY.maxBytes
                    ? `The file is larger than ${Math.round(NEEDS_DOCUMENT_UPLOAD_POLICY.maxBytes / 1024 / 1024)} MB.`
                    : NEEDS_DOCUMENT_UPLOAD_POLICY.mimeTypes.includes(mimeTypeOf(f))
                      ? null
                      : "Choose a PDF, photo, Word, Excel or text file.";
                setCircularError(problem);
                setCircular(problem ? null : f);
              }}
            />
            {circularError && <p className="mt-1 text-xs font-medium text-rose-700">{circularError}</p>}
            <p className="mt-1 text-[11px] text-slate-500">Saved as the cycle's Circular once the cycle is open. You can also add it later under Cycle documents.</p>
          </div>
        )}

        <div className="flex flex-wrap items-start justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">
            Cancel
          </button>
          <SubmitButton
            form={form}
            pending={open.isPending || addDocument.isPending}
            pendingLabel={addDocument.isPending ? "Uploading the circular…" : "Opening…"}
            blocked={stateMissing || badDate || !programme}
            hint="Choose the programme, the year and, for Matching Grants, the State."
          >
            Open cycle
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}
