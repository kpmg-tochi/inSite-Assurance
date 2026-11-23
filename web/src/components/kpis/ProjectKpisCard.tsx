import React from "react";
import { Link } from "react-router-dom";
import { formatKpiValue, KPI_BY_KEY, KPI_STAGE_META, KpiStageEnum } from "@insite/shared";
import { useProjectKpisQuery } from "../../queries/kpis/useKpiQueries";
import { countText, KpiStatusChip, targetText } from "./KpiDisplay";

/**
 * Phase 16: the project's KPIs for the current month (period-based) or today (the others), against
 * its project type's targets. Only tracked KPIs are listed; the rest are counted underneath.
 */
export function ProjectKpisCard({ projectId }: { projectId: string }) {
  const { data, isLoading, isError } = useProjectKpisQuery(projectId);
  if (isLoading || isError || !data) return null;
  const tracked = data.kpis.filter((k) => k.status !== "NOT_TRACKED");
  const notTracked = data.kpis.length - tracked.length;

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-bold text-slate-900">KPIs</div>
          <p className="text-[11px] text-slate-500 mt-0.5">This month, against the project type's targets.</p>
        </div>
        <Link to="/app/kpis" className="text-[11px] font-semibold text-brand-primary hover:underline">
          Programme KPIs
        </Link>
      </div>
      {tracked.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">No KPI applies to this project yet.</p>
      ) : (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-3">
          {KpiStageEnum.options.map((stage) => {
            const list = tracked.filter((k) => KPI_BY_KEY[k.key].stage === stage);
            if (list.length === 0) return null;
            return (
              <div key={stage}>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">{KPI_STAGE_META[stage].label}</div>
                <ul className="space-y-1.5">
                  {list.map((k) => {
                    const def = KPI_BY_KEY[k.key];
                    return (
                      <li key={k.key} className="flex items-center justify-between gap-2" title={`${def.description} ${targetText(def, k.target)}.`}>
                        <span className="min-w-0">
                          <span className="block text-xs text-slate-700 truncate">{def.label}</span>
                          <span className="block text-[10px] text-slate-400">{countText(def, k.numerator, k.denominator)}</span>
                        </span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-semibold tabular-nums text-slate-900">{formatKpiValue(def, k.value)}</span>
                          <KpiStatusChip status={k.status} />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
      {notTracked > 0 && (
        <p className="mt-3 text-[10px] text-slate-400">
          {notTracked} KPI{notTracked === 1 ? "" : "s"} not tracked here (their inputs are not configured on this project).
        </p>
      )}
    </div>
  );
}
