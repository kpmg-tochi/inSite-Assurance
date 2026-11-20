import React, { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  formatMoney,
  TRANCHE_COMPLETION_RULE_META,
  TRANCHE_PAYMENT_BASIS_META,
  type ProjectFacilityStep,
  type TrancheCompletionRule,
  type TranchePaymentBasis,
} from "@insite/shared";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import { useTenantSettingsQuery } from "../../../../queries/organizations/useOrganizationQueries";
import { useTerm } from "../../../../lib/auth-context";
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

interface CpRow {
  key: string;
  id?: string;
  referenceCode: string;
  description: string;
  isMandatoryForRelease: boolean;
  status: string;
}
interface TrancheRow {
  key: string;
  id?: string;
  name: string;
  amount: string;
  targetPct: string;
  isReleased: boolean;
  cps: CpRow[];
  /** Phase 12: payment basis and completion rule. */
  basis: TranchePaymentBasis;
  rule: TrancheCompletionRule;
  /** Fixed amount; empty = the allocation. */
  fixedAmount: string;
  requiredItemPct: string;
}

let seq = 0;
const k = () => `k${++seq}`;

export function FacilityStep({ projectId, setup, readOnly }: StepProps) {
  const settings = useTenantSettingsQuery();
  const term = useTerm();
  const currency = settings.data?.defaultCurrency ?? "NGN";
  const budget = setup.basics.totalBudgetNgn ?? 0;
  const initial = useMemo<TrancheRow[]>(
    () =>
      setup.facility.tranches.map((t) => ({
        key: t.id,
        id: t.id,
        name: t.name,
        amount: String(t.allocatedAmountNgn),
        targetPct: String(t.targetCompletionPct),
        isReleased: t.isReleased,
        basis: t.paymentBasis,
        rule: t.completionRule ?? "ALL_ITEMS_COMPLETE",
        fixedAmount: t.fixedReleaseAmountNgn === null ? "" : String(t.fixedReleaseAmountNgn),
        requiredItemPct: String(t.completionRequiredItemPct),
        cps: t.conditionsPrecedent.map((cp) => ({
          key: cp.id,
          id: cp.id,
          referenceCode: cp.referenceCode,
          description: cp.description,
          isMandatoryForRelease: cp.isMandatoryForRelease,
          status: cp.status,
        })),
      })),
    [setup.facility]
  );
  const [rows, setRows] = useState(initial);
  // Phase 12: new payment milestones start with the project type's basis; fixed needs direct verification.
  const paymentDefaults = setup.facility.paymentDefaults;
  const directMode = setup.process.config.disbursementMechanism === "MILESTONE_DIRECT_DISBURSEMENT";
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const save = useSaveSetupStepMutation(projectId);
  const strip = (r: TrancheRow[]) => r.map(({ key: _k, cps, ...t }) => ({ ...t, cps: cps.map(({ key: _c, ...c }) => c) }));
  // Phase 10: retention settings, shown and saved only with the retention module on.
  const retentionOn = setup.process.config.enableRetentionModule;
  const r0 = setup.facility.retention;
  const initialRetention = useMemo(
    () => ({
      pct: r0.retentionPercentage === null ? "" : String(r0.retentionPercentage),
      months: r0.retentionDurationMonths === null ? "" : String(r0.retentionDurationMonths),
      completionPct: String(r0.retentionReleaseAtCompletionPct),
    }),
    [r0]
  );
  const [retention, setRetention] = useState(initialRetention);
  const retentionDirty = retentionOn && JSON.stringify(retention) !== JSON.stringify(initialRetention);
  const dirty = JSON.stringify(strip(rows)) !== JSON.stringify(strip(initial)) || retentionDirty;

  const total = rows.reduce((s, r) => s + (parseNumberInput(r.amount) ?? 0), 0);
  const over = budget > 0 && total > budget + 0.005;
  const under = budget > 0 && total < budget - 0.005 && rows.length > 0;

  const update = (key: string, patch: Partial<TrancheRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const updateCp = (tKey: string, cpKey: string, patch: Partial<CpRow>) =>
    setRows((rs) => rs.map((r) => (r.key === tKey ? { ...r, cps: r.cps.map((c) => (c.key === cpKey ? { ...c, ...patch } : c)) } : r)));

  useRegisterStep(dirty, async (opts) => {
    if (!dirty) return true;
    const fields: Record<string, string> = {};
    rows.forEach((r, i) => {
      if (r.name.trim().length < 2) fields[`tranches.${i}.name`] = "Enter a name";
      const amt = parseNumberInput(r.amount);
      if (amt === null || amt <= 0) fields[`tranches.${i}.allocatedAmountNgn`] = "Enter an amount above zero";
      const pct = parseNumberInput(r.targetPct);
      if (pct === null || pct < 0 || pct > 100) fields[`tranches.${i}.targetCompletionPct`] = "0 to 100";
      if (r.basis === "FIXED_ON_COMPLETION") {
        const fixed = r.fixedAmount.trim() === "" ? null : parseNumberInput(r.fixedAmount);
        if (r.fixedAmount.trim() !== "" && (fixed === null || fixed <= 0)) fields[`tranches.${i}.fixedReleaseAmountNgn`] = "Enter an amount above zero";
        if (fixed !== null && amt !== null && fixed > amt + 0.005) fields[`tranches.${i}.fixedReleaseAmountNgn`] = "At most the allocation";
        const req = parseNumberInput(r.requiredItemPct);
        if (r.rule === "ALL_ITEMS_COMPLETE" && (req === null || req < 1 || req > 100)) fields[`tranches.${i}.completionRequiredItemPct`] = "1 to 100";
        if (!directMode) fields[`tranches.${i}.paymentBasis`] = "A fixed amount needs direct milestone verification (see the Process step).";
      }
      r.cps.forEach((cp, j) => {
        if (!cp.referenceCode.trim()) fields[`tranches.${i}.conditionsPrecedent.${j}.referenceCode`] = "Required";
        if (cp.description.trim().length < 4) fields[`tranches.${i}.conditionsPrecedent.${j}.description`] = "At least 4 characters";
      });
    });
    if (over) fields.tranches = `${term("tranche")} allocations add up to more than the project budget.`;
    const pctValue = retention.pct.trim() === "" ? null : parseNumberInput(retention.pct);
    const monthsValue = retention.months.trim() === "" ? null : parseNumberInput(retention.months);
    const completionValue = parseNumberInput(retention.completionPct) ?? 0;
    if (retentionOn) {
      if (pctValue !== null && (pctValue < 0 || pctValue > 20)) fields["retention.retentionPercentage"] = "0 to 20";
      if (pctValue && !monthsValue) fields["retention.retentionDurationMonths"] = "Set the liability period";
      if (monthsValue !== null && (!Number.isInteger(monthsValue) || monthsValue < 1 || monthsValue > 60)) fields["retention.retentionDurationMonths"] = "1 to 60 months";
      if (completionValue < 0 || completionValue > 100) fields["retention.retentionReleaseAtCompletionPct"] = "0 to 100";
    }
    if (Object.keys(fields).length > 0) {
      setErrors({ fields, general: "Some fields need attention." });
      return false;
    }
    const body: ProjectFacilityStep = {
      tranches: rows.map((r, i) => ({
        ...(r.id ? { id: r.id } : {}),
        trancheNumber: i + 1,
        name: r.name.trim(),
        allocatedAmountNgn: parseNumberInput(r.amount)!,
        targetCompletionPct: parseNumberInput(r.targetPct)!,
        paymentBasis: r.basis,
        completionRule: r.basis === "FIXED_ON_COMPLETION" ? r.rule : null,
        fixedReleaseAmountNgn: r.basis === "FIXED_ON_COMPLETION" && r.fixedAmount.trim() !== "" ? parseNumberInput(r.fixedAmount) : null,
        ...(r.basis === "FIXED_ON_COMPLETION" ? { completionRequiredItemPct: parseNumberInput(r.requiredItemPct) ?? 100 } : {}),
        conditionsPrecedent: r.cps.map((cp) => ({
          ...(cp.id ? { id: cp.id } : {}),
          referenceCode: cp.referenceCode.trim(),
          description: cp.description.trim(),
          isMandatoryForRelease: cp.isMandatoryForRelease,
          status: "PENDING" as const,
        })),
      })),
      ...(retentionOn
        ? {
            retention: {
              retentionPercentage: pctValue,
              retentionDurationMonths: monthsValue,
              retentionReleaseAtCompletionPct: completionValue,
            },
          }
        : {}),
    };
    try {
      await save.mutateAsync({ stepId: "facility", body, silent: opts?.silent });
      setErrors(NO_ERRORS);
      return true;
    } catch (err) {
      setErrors(extractErrors(err));
      return false;
    }
  });

  return (
    <StepSection
      title={`Facility ${term("tranche", { plural: true, lower: true })}`}
      description="How the budget is released. Allocations may not add up to more than the project budget."
      actions={
        !readOnly && (
          <button
            type="button"
            onClick={() =>
              setRows((rs) => [
                ...rs,
                {
                  key: k(),
                  name: `Tranche ${rs.length + 1}`,
                  amount: "",
                  targetPct: "",
                  isReleased: false,
                  cps: [],
                  basis: directMode ? paymentDefaults.defaultBasis : "MEASURED",
                  rule: paymentDefaults.defaultCompletionRule ?? "ALL_ITEMS_COMPLETE",
                  fixedAmount: "",
                  requiredItemPct: "100",
                },
              ])
            }
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Plus className="w-3.5 h-3.5" /> Add {term("tranche", { lower: true })}
          </button>
        )
      }
    >
      {!setup.process.config.enableTranchesAndCps && (
        <p className="rounded-xl border border-brand-primary/25 bg-brand-primary/5 px-4 py-2.5 text-[11px] text-brand-navy">
          {term("tranche", { plural: true })} and {term("conditionPrecedent", { plural: true, lower: true })} are off in this project's process settings. {term("tranche", { plural: true })} are optional: with none,
          activation creates one {term("tranche", { lower: true })} for the whole budget, and {term("conditionPrecedent", { plural: true, lower: true })} are not checked at release.
        </p>
      )}
      <div
        className={`rounded-xl px-4 py-2.5 text-xs font-medium ${
          over ? "bg-rose-50 text-rose-700" : under ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-700"
        }`}
      >
        Allocated {formatMoney(total, { currency })} of {budget > 0 ? formatMoney(budget, { currency }) : "—"}
        {over && " — more than the budget."}
        {under && " — less than the budget (allowed)."}
      </div>
      {errors.general && <p className="text-xs font-medium text-red-600">{errors.general}</p>}
      <FieldError message={errors.fields.tranches} />
      {rows.length === 0 && <p className="text-xs text-slate-500">No {term("tranche", { plural: true, lower: true })} yet. Add at least one.</p>}

      <div className="space-y-4">
        {rows.map((r, i) => (
          <div key={r.key} className="rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-6">
                <label className={labelClass}>{term("tranche")} {i + 1} name</label>
                <input className={inputClass(Boolean(errors.fields[`tranches.${i}.name`]))} value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} disabled={readOnly} />
                <FieldError message={errors.fields[`tranches.${i}.name`]} />
              </div>
              <div className="md:col-span-3">
                <label className={labelClass}>Allocation ({currency})</label>
                <input inputMode="decimal" className={inputClass(Boolean(errors.fields[`tranches.${i}.allocatedAmountNgn`]))} value={r.amount} onChange={(e) => update(r.key, { amount: e.target.value })} disabled={readOnly} />
                <FieldError message={errors.fields[`tranches.${i}.allocatedAmountNgn`]} />
              </div>
              <div className="md:col-span-2">
                <label className={labelClass}>Target progress %</label>
                <input inputMode="decimal" className={inputClass(Boolean(errors.fields[`tranches.${i}.targetCompletionPct`]))} value={r.targetPct} onChange={(e) => update(r.key, { targetPct: e.target.value })} disabled={readOnly} />
                <FieldError message={errors.fields[`tranches.${i}.targetCompletionPct`]} />
              </div>
              <div className="md:col-span-1 flex md:justify-end md:pt-6">
                {!readOnly && !r.isReleased && (
                  <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="text-rose-600" aria-label={`Remove ${term("tranche", { lower: true })} ${i + 1}`}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 rounded-lg bg-slate-50 p-3">
              <div className="md:col-span-4">
                <label className={labelClass}>Payment basis</label>
                <select
                  className={inputClass(Boolean(errors.fields[`tranches.${i}.paymentBasis`]))}
                  value={r.basis}
                  onChange={(e) => update(r.key, { basis: e.target.value as TranchePaymentBasis })}
                  disabled={readOnly || r.isReleased}
                >
                  {(["MEASURED", "FIXED_ON_COMPLETION"] as const).map((b) => (
                    <option key={b} value={b} disabled={b === "FIXED_ON_COMPLETION" && !directMode}>
                      {TRANCHE_PAYMENT_BASIS_META[b].label}
                    </option>
                  ))}
                </select>
                <FieldError message={errors.fields[`tranches.${i}.paymentBasis`]} />
                <p className="text-[11px] text-slate-500 mt-1">{TRANCHE_PAYMENT_BASIS_META[r.basis].description}</p>
              </div>
              {r.basis === "FIXED_ON_COMPLETION" && (
                <>
                  <div className="md:col-span-3">
                    <label className={labelClass}>Completion rule</label>
                    <select className={inputClass(false)} value={r.rule} onChange={(e) => update(r.key, { rule: e.target.value as TrancheCompletionRule })} disabled={readOnly}>
                      {(["ALL_ITEMS_COMPLETE", "WEIGHTED_PROGRESS_REACHED"] as const).map((rule) => (
                        <option key={rule} value={rule}>
                          {TRANCHE_COMPLETION_RULE_META[rule].label}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-slate-500 mt-1">
                      {r.rule === "WEIGHTED_PROGRESS_REACHED"
                        ? "Uses the target progress % above."
                        : TRANCHE_COMPLETION_RULE_META[r.rule].description}
                    </p>
                  </div>
                  {r.rule === "ALL_ITEMS_COMPLETE" && (
                    <div className="md:col-span-2">
                      <label className={labelClass}>Each item at least (%)</label>
                      <input inputMode="decimal" className={inputClass(Boolean(errors.fields[`tranches.${i}.completionRequiredItemPct`]))} value={r.requiredItemPct} onChange={(e) => update(r.key, { requiredItemPct: e.target.value })} disabled={readOnly} />
                      <FieldError message={errors.fields[`tranches.${i}.completionRequiredItemPct`]} />
                    </div>
                  )}
                  <div className="md:col-span-3">
                    <label className={labelClass}>Fixed amount ({currency})</label>
                    <input
                      inputMode="decimal"
                      placeholder={r.amount ? `${r.amount} (the allocation)` : "The allocation"}
                      className={inputClass(Boolean(errors.fields[`tranches.${i}.fixedReleaseAmountNgn`]))}
                      value={r.fixedAmount}
                      onChange={(e) => update(r.key, { fixedAmount: e.target.value })}
                      disabled={readOnly}
                    />
                    <FieldError message={errors.fields[`tranches.${i}.fixedReleaseAmountNgn`]} />
                  </div>
                </>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-slate-600">{term("conditionPrecedent", { plural: true })}</p>
              {r.cps.length === 0 && <p className="text-[11px] text-slate-400">None.</p>}
              {r.cps.map((cp, j) => (
                <div key={cp.key} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start">
                  <div className="md:col-span-2">
                    <input className={inputClass(Boolean(errors.fields[`tranches.${i}.conditionsPrecedent.${j}.referenceCode`]))} value={cp.referenceCode} placeholder="CP-01" onChange={(e) => updateCp(r.key, cp.key, { referenceCode: e.target.value })} disabled={readOnly} />
                  </div>
                  <div className="md:col-span-6">
                    <input className={inputClass(Boolean(errors.fields[`tranches.${i}.conditionsPrecedent.${j}.description`]))} value={cp.description} placeholder="What must be in place before release" onChange={(e) => updateCp(r.key, cp.key, { description: e.target.value })} disabled={readOnly} />
                    <FieldError message={errors.fields[`tranches.${i}.conditionsPrecedent.${j}.description`]} />
                  </div>
                  <label className="md:col-span-2 inline-flex items-center gap-2 text-[11px] text-slate-700 md:pt-2">
                    <input type="checkbox" checked={cp.isMandatoryForRelease} onChange={(e) => updateCp(r.key, cp.key, { isMandatoryForRelease: e.target.checked })} disabled={readOnly} />
                    Blocks release
                  </label>
                  <div className="md:col-span-2 flex items-center justify-between md:pt-2">
                    <span className="text-[11px] text-slate-500">{cp.id ? cp.status.toLowerCase() : "pending"}</span>
                    {!readOnly && (
                      <button type="button" onClick={() => update(r.key, { cps: r.cps.filter((c) => c.key !== cp.key) })} className="text-rose-600" aria-label="Remove condition">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() =>
                    update(r.key, {
                      cps: [...r.cps, { key: k(), referenceCode: `CP-${String(r.cps.length + 1).padStart(2, "0")}`, description: "", isMandatoryForRelease: true, status: "PENDING" }],
                    })
                  }
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-primary hover:underline"
                >
                  <Plus className="w-3 h-3" /> Add condition
                </button>
              )}
              <p className="text-[11px] text-slate-400">New conditions start as pending. Mark them satisfied or waived from the project once evidence is in.</p>
            </div>
          </div>
        ))}
      </div>
      {retentionOn && (
        <div className="space-y-3 rounded-xl border border-slate-200 p-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">{term("retention")}</p>
            <p className="text-[11px] text-slate-500">
              A percentage held back from every release until the defects liability period ends. A change applies to later releases only
              {r0.heldNgn > 0 ? ` (${formatMoney(r0.heldNgn, { currency })} is already held)` : ""}.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={labelClass}>{term("retention")} (%)</label>
              <input inputMode="decimal" placeholder="e.g. 5" className={inputClass(Boolean(errors.fields["retention.retentionPercentage"]))} value={retention.pct} onChange={(e) => setRetention((x) => ({ ...x, pct: e.target.value }))} disabled={readOnly} />
              <FieldError message={errors.fields["retention.retentionPercentage"]} />
            </div>
            <div>
              <label className={labelClass}>Defects liability period (months)</label>
              <input inputMode="numeric" placeholder="e.g. 12" className={inputClass(Boolean(errors.fields["retention.retentionDurationMonths"]))} value={retention.months} onChange={(e) => setRetention((x) => ({ ...x, months: e.target.value }))} disabled={readOnly} />
              <FieldError message={errors.fields["retention.retentionDurationMonths"]} />
            </div>
            <div>
              <label className={labelClass}>Released at practical completion (%)</label>
              <input inputMode="decimal" className={inputClass(Boolean(errors.fields["retention.retentionReleaseAtCompletionPct"]))} value={retention.completionPct} onChange={(e) => setRetention((x) => ({ ...x, completionPct: e.target.value }))} disabled={readOnly} />
              <FieldError message={errors.fields["retention.retentionReleaseAtCompletionPct"]} />
            </div>
          </div>
          <p className="text-[11px] text-slate-400">0% at practical completion means everything is released at the end of the period (the default).</p>
        </div>
      )}
    </StepSection>
  );
}
