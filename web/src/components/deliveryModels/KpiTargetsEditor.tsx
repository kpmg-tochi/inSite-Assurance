import React from "react";
import { KPI_CATALOGUE, KPI_STAGE_META, KpiStageEnum, type ProjectTypeKpiTargets } from "@insite/shared";

/**
 * Phase 16: KPI targets of a project type. The catalogue is fixed; per KPI the type chooses a
 * target (blank = no target) and whether the KPI is shown for its projects. Only settings that
 * differ from the catalogue default are stored. Unlike the type's other rules, targets apply to
 * every project of the type as soon as the type is saved (they are reporting settings).
 */

const inputCls = "w-24 rounded-xl border border-slate-300 px-2 py-1.5 text-xs text-slate-900 text-right focus:outline-none focus:border-brand-primary";

/** Drops entries equal to the catalogue default (target and shown). */
export function compactKpiTargets(value: ProjectTypeKpiTargets): ProjectTypeKpiTargets {
  const out: ProjectTypeKpiTargets = {};
  for (const def of KPI_CATALOGUE) {
    const s = value[def.key];
    if (s && (s.target !== def.defaultTarget || !s.shown)) out[def.key] = s;
  }
  return out;
}

export function KpiTargetsEditor({ value, onChange }: { value: ProjectTypeKpiTargets; onChange: (next: ProjectTypeKpiTargets) => void }) {
  const settingOf = (key: string) => {
    const def = KPI_CATALOGUE.find((k) => k.key === key)!;
    return value[key] ?? { target: def.defaultTarget, shown: true };
  };
  const set = (key: string, patch: Partial<{ target: number | null; shown: boolean }>) => onChange({ ...value, [key]: { ...settingOf(key), ...patch } });

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
      <div>
        <h3 className="text-sm font-bold text-slate-900">KPI targets</h3>
        <p className="text-[11px] text-slate-500">
          Targets for the Programme KPIs page and the project KPI card. Leave a target blank for none; untick a KPI to hide it for
          projects of this type. Target changes apply to every project of the type once saved.
        </p>
      </div>
      {KpiStageEnum.options.map((stage) => (
        <div key={stage}>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">{KPI_STAGE_META[stage].label}</div>
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-100">
            {KPI_CATALOGUE.filter((k) => k.stage === stage).map((def) => {
              const s = settingOf(def.key);
              const unit = def.unit === "PERCENT" ? "%" : "days";
              return (
                <div key={def.key} className="flex flex-col md:flex-row md:items-center gap-2 px-3 py-2">
                  <label className="flex items-start gap-2 flex-1 min-w-0 text-xs text-slate-700">
                    <input type="checkbox" className="mt-0.5" checked={s.shown} onChange={(e) => set(def.key, { shown: e.target.checked })} />
                    <span className="min-w-0">
                      <span className="font-medium">{def.label}</span>
                      <span className="block text-[11px] text-slate-500">{def.description}</span>
                    </span>
                  </label>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 shrink-0">
                    <span>{def.direction === "HIGHER_IS_BETTER" ? "At least" : "At most"}</span>
                    <input
                      type="number"
                      min={0}
                      max={def.unit === "PERCENT" ? 100 : 365}
                      step={def.unit === "PERCENT" ? 1 : 0.5}
                      aria-label={`${def.label} target`}
                      disabled={!s.shown}
                      className={inputCls}
                      placeholder="No target"
                      value={s.target ?? ""}
                      onChange={(e) => set(def.key, { target: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                    <span className="w-8">{unit}</span>
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-brand-primary disabled:text-slate-300"
                      disabled={s.target === def.defaultTarget && s.shown}
                      onClick={() => {
                        const next = { ...value };
                        delete next[def.key];
                        onChange(next);
                      }}
                    >
                      Default{def.defaultTarget === null ? "" : ` (${def.defaultTarget})`}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
