import React, { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { formatMoney, type ProjectFacilityStep } from "@insite/shared";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import { useTenantSettingsQuery } from "../../../../queries/organizations/useOrganizationQueries";
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
}

let seq = 0;
const k = () => `k${++seq}`;

export function FacilityStep({ projectId, setup, readOnly }: StepProps) {
  const settings = useTenantSettingsQuery();
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
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const save = useSaveSetupStepMutation(projectId);
  const strip = (r: TrancheRow[]) => r.map(({ key: _k, cps, ...t }) => ({ ...t, cps: cps.map(({ key: _c, ...c }) => c) }));
  const dirty = JSON.stringify(strip(rows)) !== JSON.stringify(strip(initial));

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
      r.cps.forEach((cp, j) => {
        if (!cp.referenceCode.trim()) fields[`tranches.${i}.conditionsPrecedent.${j}.referenceCode`] = "Required";
        if (cp.description.trim().length < 4) fields[`tranches.${i}.conditionsPrecedent.${j}.description`] = "At least 4 characters";
      });
    });
    if (over) fields.tranches = "Tranche allocations add up to more than the project budget.";
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
        conditionsPrecedent: r.cps.map((cp) => ({
          ...(cp.id ? { id: cp.id } : {}),
          referenceCode: cp.referenceCode.trim(),
          description: cp.description.trim(),
          isMandatoryForRelease: cp.isMandatoryForRelease,
          status: "PENDING" as const,
        })),
      })),
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
      title="Facility tranches"
      description="How the budget is released. Allocations may not add up to more than the project budget."
      actions={
        !readOnly && (
          <button
            type="button"
            onClick={() => setRows((rs) => [...rs, { key: k(), name: `Tranche ${rs.length + 1}`, amount: "", targetPct: "", isReleased: false, cps: [] }])}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Plus className="w-3.5 h-3.5" /> Add tranche
          </button>
        )
      }
    >
      {!setup.process.config.enableTranchesAndCps && (
        <p className="rounded-xl border border-brand-primary/25 bg-brand-primary/5 px-4 py-2.5 text-[11px] text-brand-navy">
          Tranches and conditions precedent are off in this project's process settings. Tranches are optional: with none,
          activation creates one tranche for the whole budget, and conditions precedent are not checked at release.
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
      {rows.length === 0 && <p className="text-xs text-slate-500">No tranches yet. Add at least one.</p>}

      <div className="space-y-4">
        {rows.map((r, i) => (
          <div key={r.key} className="rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-6">
                <label className={labelClass}>Tranche {i + 1} name</label>
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
                  <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="text-rose-600" aria-label={`Remove tranche ${i + 1}`}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-slate-600">Conditions precedent</p>
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
    </StepSection>
  );
}
