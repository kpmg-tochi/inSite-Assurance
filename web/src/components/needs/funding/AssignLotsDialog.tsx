import React from "react";
import { z } from "zod";
import { LOT_TITLE_MAX, type AssignLotsRequest, type NeedsProcurementPlanDto, type NeedsProcurementPlanRow } from "@insite/shared";
import { ModalShell } from "../../common/ModalShell";
import { CustomSelect } from "../../common/CustomSelect";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../../lib/forms";
import { useAssignLotsMutation } from "../../../mutations/needs/useFundingMutations";
import { inputCls, labelCls, money, plural } from "../needsUi";

/**
 * Needs pipeline wave 4 (C3): put the selected converted drafts in one lot of the cycle's year: an
 * existing lot, or a new lot with its title. The server numbers the batches in the order listed and
 * gives each project its code (`<year>-LOT-<n>-BATCH-<m>`).
 */

const NEW_LOT = "new";

const FormSchema = z
  .object({ lotId: z.string().min(1, "Choose a lot, or New lot"), newLotTitle: z.string() })
  .superRefine((v, ctx) => {
    if (v.lotId !== NEW_LOT) return;
    const t = v.newLotTitle.trim();
    if (t.length < 3) ctx.addIssue({ code: "custom", path: ["newLotTitle"], message: "Enter the lot title, e.g. Renovation of Public Schools" });
    else if (t.length > LOT_TITLE_MAX) ctx.addIssue({ code: "custom", path: ["newLotTitle"], message: `At most ${LOT_TITLE_MAX} characters` });
  });

export function AssignLotsDialog({
  cycleId,
  plan,
  rows,
  onClose,
  onAssigned,
}: {
  cycleId: string;
  plan: NeedsProcurementPlanDto;
  /** The selected drafts, in table order (batch order). */
  rows: NeedsProcurementPlanRow[];
  onClose: () => void;
  onAssigned: () => void;
}) {
  const assign = useAssignLotsMutation(cycleId);
  const form = useZodForm(FormSchema, { defaultValues: { lotId: plan.lots.length ? "" : NEW_LOT, newLotTitle: "" } });
  const lotId = form.watch("lotId");
  const total = rows.reduce((s, r) => s + (r.budgetNgn ?? 0), 0);

  const options = [
    ...[...plan.lots]
      .sort((a, b) => a.number - b.number)
      .map((l) => ({ value: l.id, label: `Lot ${l.number} · ${l.title}`, description: plural(l.batchCount, "batch", "batches") })),
    { value: NEW_LOT, label: "New lot", description: `The next lot number of ${plan.interventionYear}` },
  ];

  const submit = form.handleSubmit((v) => {
    const lotChoice = v.lotId === NEW_LOT ? { newLotTitle: v.newLotTitle.trim() } : { lotId: v.lotId };
    const body: AssignLotsRequest = { items: rows.map((r) => ({ projectId: r.projectId, lotChoice })) };
    assign.mutate(body, {
      onSuccess: () => {
        onAssigned();
        onClose();
      },
    });
  });

  return (
    <ModalShell title="Assign to a lot" subtitle={`${plural(rows.length, "project")} · ${money(total)}`} onClose={onClose}>
      <form className="space-y-3 p-5" noValidate onSubmit={submit}>
        <ul className="max-h-40 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 text-xs">
          {rows.map((r, i) => (
            <li key={r.projectId} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-1.5">
              <span>
                <span className="text-slate-500">Batch {i + 1}: </span>
                <span className="font-semibold text-slate-900">{r.reference}</span> · {r.title}
              </span>
              <span className="tabular-nums text-slate-700">{money(r.budgetNgn)}</span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-slate-500">
          Batches follow this order after the lot's existing batches. Each project's code becomes its lot and batch, e.g. LOT 3 BATCH 2.
        </p>
        <div>
          <p className={labelCls} id="assign-lot-label">
            Lot <span className="text-rose-600">*</span>
          </p>
          <CustomSelect
            ariaLabel="Lot"
            value={lotId}
            onChange={(v) => form.setValue("lotId", v, { shouldValidate: true, shouldDirty: true, shouldTouch: true })}
            options={options}
            placeholder="Choose the lot"
            error={form.formState.touchedFields.lotId ? form.formState.errors.lotId?.message : undefined}
          />
        </div>
        {lotId === NEW_LOT && (
          <div>
            <label className={labelCls} htmlFor="assign-new-lot">
              New lot title <span className="text-rose-600">*</span>
            </label>
            <input
              id="assign-new-lot"
              className={`${inputCls} ${invalidClass(form, "newLotTitle")}`}
              placeholder="e.g. Renovation of Public Schools"
              {...form.register("newLotTitle")}
              {...fieldA11y(form, "newLotTitle")}
            />
            <FieldError form={form} name="newLotTitle" />
          </div>
        )}
        <div className="flex flex-wrap items-start justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">
            Cancel
          </button>
          <SubmitButton form={form} pending={assign.isPending} pendingLabel="Assigning…" hint="Choose the lot (and a title for a new one).">
            Assign {plural(rows.length, "project")}
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}
