import React, { useState } from "react";
import { formatKpiValue, KPI_BY_KEY, type KpiValueDto } from "@insite/shared";
import { useProjectKpisQuery } from "../../queries/kpis/useKpiQueries";
import { countText, KPI_STATUS_META, KpiStatusIcon, targetText } from "./KpiDisplay";

/** How many KPIs with data show before "Show all KPIs". */
const FIRST_SHOWN = 6;

const hasData = (k: KpiValueDto) => k.status !== "NOT_TRACKED" && k.status !== "NO_DATA" && k.value !== null;

function KpiTile({ kpi }: { kpi: KpiValueDto }) {
  const def = KPI_BY_KEY[kpi.key];
  return (
    <li
      className="rounded-xl bg-slate-50 px-3.5 py-3"
      title={`${def.description} ${targetText(def, kpi.target)}. ${countText(def, kpi.numerator, kpi.denominator)}.`}
    >
      <span className="flex items-center gap-2">
        <span className="text-xl font-bold tabular-nums tracking-tight text-slate-900">{formatKpiValue(def, kpi.value)}</span>
        <KpiStatusIcon status={kpi.status} />
      </span>
      <span className="mt-1 block text-xs leading-snug text-slate-600 line-clamp-2">{def.label}</span>
    </li>
  );
}

/**
 * Phase 16, UBEC layout: the project's KPIs for the current month (period-based) or today (the
 * others), against its project type's targets. Only KPIs with a value show as tiles (the first six);
 * "Show all KPIs" adds the rest of them and lists the ones without data plainly.
 */
export function ProjectKpisCard({ projectId }: { projectId: string }) {
  const { data, isLoading, isError, refetch } = useProjectKpisQuery(projectId);
  const [showAll, setShowAll] = useState(false);

  const withData = data ? data.kpis.filter(hasData) : [];
  const withoutData = data ? data.kpis.filter((k) => !hasData(k)) : [];
  const tiles = showAll ? withData : withData.slice(0, FIRST_SHOWN);
  const hiddenCount = data ? data.kpis.length - Math.min(withData.length, FIRST_SHOWN) : 0;

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm" aria-labelledby="project-kpis-heading">
      <h2 id="project-kpis-heading" className="text-sm font-bold text-slate-900">
        KPIs
      </h2>
      <p className="mt-0.5 text-xs text-slate-500">This month, against the project type's targets.</p>

      {isLoading ? (
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" />
          ))}
        </div>
      ) : isError || !data ? (
        <p className="mt-3 text-xs text-rose-700">
          The KPIs could not be loaded.{" "}
          <button type="button" onClick={() => refetch()} className="font-semibold underline">
            Try again
          </button>
        </p>
      ) : (
        <>
          {withData.length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">No KPI has data for this project this month yet.</p>
          ) : (
            <ul className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
              {tiles.map((k) => (
                <KpiTile key={k.key} kpi={k} />
              ))}
            </ul>
          )}

          {showAll && withoutData.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold text-slate-700">Without data</h3>
              <ul className="mt-1 divide-y divide-slate-100 text-xs">
                {withoutData.map((k) => (
                  <li key={k.key} className="flex justify-between gap-3 py-1.5">
                    <span className="text-slate-700">{KPI_BY_KEY[k.key].label}</span>
                    <span className="shrink-0 text-slate-500">
                      {k.status === "NOT_TRACKED" ? "Not tracked on this project" : KPI_STATUS_META[k.status].label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hiddenCount > 0 && (
            <button
              type="button"
              aria-expanded={showAll}
              onClick={() => setShowAll((v) => !v)}
              className="mt-3 rounded text-xs font-semibold text-brand-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
            >
              {showAll ? "Show fewer KPIs" : `Show all KPIs (${data.kpis.length})`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
