import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import {
  addDays,
  formatKpiValue,
  timeZoneAbbreviation,
  KPI_BY_KEY,
  KPI_STAGE_META,
  KpiStageEnum,
  zonedCalendarDate,
  type KpiDashboardDto,
  type KpiDashboardKpi,
  type KpiKey,
  type ProjectListFilters,
} from "@insite/shared";
import { useKpiDashboardQuery } from "../../queries/kpis/useKpiQueries";
import { DeliveryModelFilters } from "../../components/projects/DeliveryModelFilters";
import { CustomSelect } from "../../components/common";
import { StandardTable, type TableColumnDef } from "../../components/table";
import Loader from "../../components/Loader";
import { countText, KPI_STATUS_META, KpiSparkline, targetText } from "../../components/kpis/KpiDisplay";
import { displayTimeZone } from "../../lib/formatters";
import { shortOrganisationName } from "../../components/BrandLogo";

/**
 * Phase 16, simplified for the UBEC rebrand: programme KPIs (kpis:view) over the projects the user
 * can see, against the targets set per project type. The overview is a grid of plain tiles (the KPI
 * and its value); selecting one opens its detail (target, counts, trend, split by project type)
 * above the table of contributing projects. The selected KPI lives in `?kpi=` so Back works. The
 * CSV export holds the same rows for every KPI.
 */

type Preset = "THIS_MONTH" | "LAST_MONTH" | "THIS_QUARTER" | "LAST_QUARTER" | "CUSTOM";

const PRESETS: Array<{ value: Preset; label: string }> = [
  { value: "THIS_MONTH", label: "This month" },
  { value: "LAST_MONTH", label: "Last month" },
  { value: "THIS_QUARTER", label: "This quarter" },
  { value: "LAST_QUARTER", label: "Last quarter" },
  { value: "CUSTOM", label: "Custom range" },
];

const monthStart = (y: number, m: number) => new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);

function presetPeriod(preset: Exclude<Preset, "CUSTOM">, today: string): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number);
  const mi = m - 1;
  switch (preset) {
    case "THIS_MONTH":
      return { from: monthStart(y, mi), to: today };
    case "LAST_MONTH":
      return { from: monthStart(y, mi - 1), to: addDays(monthStart(y, mi), -1) };
    case "THIS_QUARTER": {
      const q = Math.floor(mi / 3) * 3;
      return { from: monthStart(y, q), to: today };
    }
    case "LAST_QUARTER": {
      const q = Math.floor(mi / 3) * 3;
      return { from: monthStart(y, q - 3), to: addDays(monthStart(y, q), -1) };
    }
  }
}

const formatDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per project and KPI (plus the programme totals), for pivoting in a spreadsheet. */
function exportCsv(data: KpiDashboardDto) {
  const header = ["Project code", "Project", "Project type", "Region", "Owner", "Stage", "KPI", "Value", "Unit", "Numerator", "Denominator", "Target", "Status"];
  const lines = [header.join(",")];
  for (const k of data.kpis) {
    const def = KPI_BY_KEY[k.key];
    lines.push(
      ["ALL", "All projects in view", "", "", "", KPI_STAGE_META[def.stage].label, def.label, k.value, def.unit, k.numerator, k.denominator, k.target, KPI_STATUS_META[k.status].label]
        .map(csvCell)
        .join(",")
    );
    for (const p of data.projects) {
      const c = p.values[k.key];
      lines.push(
        [p.codePrefix, p.name, p.projectTypeName, p.regionName, p.owningOrganizationName, KPI_STAGE_META[def.stage].label, def.label, c?.value ?? "", def.unit, c?.numerator ?? "", c?.denominator ?? "", c?.target ?? "", c ? KPI_STATUS_META[c.status].label : "Not tracked"]
          .map(csvCell)
          .join(",")
      );
    }
  }
  const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `programme-kpis_${data.period.from}_${data.period.to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Status as an icon whose shape carries the meaning (check, triangle, cross…), named for screen readers and on hover. */
function StatusIcon({ status, className = "w-4 h-4" }: { status: KpiDashboardKpi["status"]; className?: string }) {
  const meta = KPI_STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span title={meta.label} className="inline-flex shrink-0">
      <Icon className={className} style={{ color: meta.color }} aria-hidden="true" />
      <span className="sr-only">{meta.label}</span>
    </span>
  );
}

/** A tile: the KPI's name and its value. Everything else is one click away. */
function KpiTile({ kpi, onSelect }: { kpi: KpiDashboardKpi; onSelect: () => void }) {
  const def = KPI_BY_KEY[kpi.key];
  const tracked = kpi.status !== "NOT_TRACKED";
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="group w-full h-full text-left bg-white rounded-xl border border-slate-200/80 px-4 py-3.5 transition hover:border-brand-primary/60 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
      >
        <span className="block text-sm text-slate-700 leading-snug line-clamp-2 min-h-[2.5rem] group-hover:text-slate-900">{def.label}</span>
        <span className="mt-2 flex items-center gap-2">
          <span className={tracked ? "text-2xl font-bold tracking-tight tabular-nums text-slate-900" : "text-base font-semibold text-slate-400 leading-8"}>
            {tracked ? formatKpiValue(def, kpi.value) : "Not tracked"}
          </span>
          {tracked && <StatusIcon status={kpi.status} />}
        </span>
      </button>
    </li>
  );
}

type DrillRow = KpiDashboardDto["projects"][number];

/** The selected KPI: what it measures and how it stands, then the projects behind the figure. */
function KpiDetail({
  data,
  kpi,
  onBack,
  onOpenProject,
}: {
  data: KpiDashboardDto;
  kpi: KpiDashboardKpi;
  onBack: () => void;
  onOpenProject: (id: string) => void;
}) {
  const def = KPI_BY_KEY[kpi.key];
  const tracked = kpi.status !== "NOT_TRACKED";
  const rows = data.projects.filter((p) => p.values[kpi.key]);
  const notTracking = data.projects.length - rows.length;
  const columns: TableColumnDef<DrillRow>[] = [
    {
      id: "project",
      header: "Project",
      cell: (p) => (
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-slate-500 tabular-nums">{p.codePrefix}</div>
          <div className="text-sm font-semibold text-slate-900 truncate max-w-[300px]">{p.name}</div>
        </div>
      ),
    },
    { id: "type", header: "Type", cell: (p) => <span className="text-slate-700">{p.projectTypeName ?? "–"}</span> },
    {
      id: "owner",
      header: "Owner",
      cell: (p) => (
        <span className="text-slate-700 whitespace-nowrap" title={p.owningOrganizationName ?? undefined}>
          {[shortOrganisationName(p.owningOrganizationName), p.regionName].filter(Boolean).join(" · ") || "–"}
        </span>
      ),
    },
    { id: "value", header: "Value", align: "right", cell: (p) => <span className="font-semibold tabular-nums text-slate-900">{formatKpiValue(def, p.values[kpi.key].value)}</span> },
    { id: "count", header: "Count", tooltip: `${def.numerator} of ${def.denominator}`, align: "right", cell: (p) => <span className="tabular-nums text-slate-600">{countText(def, p.values[kpi.key].numerator, p.values[kpi.key].denominator)}</span> },
    { id: "target", header: "Target", align: "right", cell: (p) => <span className="text-slate-600">{p.values[kpi.key].target === null ? "–" : formatKpiValue(def, p.values[kpi.key].target)}</span> },
    {
      id: "status",
      header: "Status",
      cell: (p) => (
        <span className="inline-flex items-center gap-1.5 text-slate-700 whitespace-nowrap">
          <StatusIcon status={p.values[kpi.key].status} className="w-3.5 h-3.5" />
          {KPI_STATUS_META[p.values[kpi.key].status].label}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary">
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> All KPIs
      </button>

      <section aria-labelledby="kpi-detail-title" className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 lg:p-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 space-y-3">
            <div>
              <p className="text-xs text-slate-500">{KPI_STAGE_META[def.stage].label}</p>
              <h2 id="kpi-detail-title" className="text-lg font-bold text-slate-900 leading-snug">
                {def.label}
              </h2>
              <p className="mt-1 text-sm text-slate-600 max-w-prose">{def.description}</p>
            </div>
            <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
              <div>
                <p className={`text-4xl font-bold tracking-tight tabular-nums ${tracked ? "text-slate-900" : "text-slate-400"}`}>
                  {tracked ? formatKpiValue(def, kpi.value) : "Not tracked"}
                </p>
                {tracked && (
                  <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-slate-700">
                    <StatusIcon status={kpi.status} />
                    {KPI_STATUS_META[kpi.status].label}
                  </p>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                <div>
                  <dt className="text-slate-500">Target</dt>
                  <dd className="font-semibold text-slate-900">{targetText(def, kpi.target, kpi.targetVaries)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">{def.unit === "DAYS" ? "Items" : "Count"}</dt>
                  <dd className="font-semibold text-slate-900 tabular-nums">{tracked ? countText(def, kpi.numerator, kpi.denominator) : "–"}</dd>
                  {def.unit !== "DAYS" && (
                    <dd className="mt-0.5 max-w-[22rem] text-xs text-slate-500">
                      {def.numerator} of {def.denominator.charAt(0).toLowerCase() + def.denominator.slice(1)}
                    </dd>
                  )}
                </div>
              </dl>
            </div>
            <p className="text-xs text-slate-500">
              {def.periodBased ? `Counted over ${formatDay(data.period.from)} to ${formatDay(data.period.to)}.` : "Today's value; the period does not change it."}
              {!tracked && " No project in view has this KPI's inputs configured, so it is not counted as 0."}
            </p>
          </div>

          {tracked && (
            <div className="space-y-4 lg:border-l lg:border-slate-100 lg:pl-6 lg:min-w-[280px]">
              <div>
                <p className="text-xs font-medium text-slate-600 mb-1.5">Monthly trend</p>
                <KpiSparkline def={def} points={kpi.trend} width={260} height={56} />
              </div>
              {kpi.byProjectType.length > 1 && (
                <div>
                  <p className="text-xs font-medium text-slate-600 mb-1.5">By project type</p>
                  <ul className="space-y-1.5">
                    {kpi.byProjectType.map((b) => (
                      <li key={b.projectTypeId ?? "none"} className="flex items-center justify-between gap-4 text-sm">
                        <span className="text-slate-700 truncate">{b.projectTypeName}</span>
                        <span className="inline-flex items-center gap-1.5 shrink-0">
                          <span className="font-semibold text-slate-900 tabular-nums">{b.status === "NOT_TRACKED" ? "–" : formatKpiValue(def, b.value)}</span>
                          <StatusIcon status={b.status} className="w-3.5 h-3.5" />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <StandardTable<DrillRow>
        title="Projects behind this figure"
        subtitle={notTracking ? `${notTracking} project${notTracking === 1 ? " does" : "s do"} not track this KPI and ${notTracking === 1 ? "is" : "are"} left out.` : "Select a project to open it."}
        columns={columns}
        data={rows}
        keyExtractor={(p) => p.projectId}
        onRowClick={(p) => onOpenProject(p.projectId)}
        minWidth="min-w-[860px]"
        emptyState={{ title: "No project in view tracks this KPI", description: "Its inputs are not configured on any project under the current filters." }}
      />
    </div>
  );
}

export function ProgrammeKpisPage({ onOpenProject }: { onOpenProject: (projectId: string) => void }) {
  // The tenant's calendar day, so the presets match the server's periods (Tenant.timezone).
  const today = useMemo(() => zonedCalendarDate(new Date(), displayTimeZone()), []);
  const [filters, setFilters] = useState<ProjectListFilters>({});
  const [preset, setPreset] = useState<Preset>("THIS_QUARTER");
  const [custom, setCustom] = useState(() => presetPeriod("THIS_MONTH", today));
  const period = preset === "CUSTOM" ? custom : presetPeriod(preset, today);
  const { data, isLoading, isError, isFetching, refetch } = useKpiDashboardQuery({ ...filters, ...period });
  const [params, setParams] = useSearchParams();
  const selected = params.get("kpi") as KpiKey | null;
  const [ownersSeen, setOwnersSeen] = useState<Array<{ id: string; name: string }>>([]);

  const select = (key: KpiKey | null) => {
    const next = new URLSearchParams(params);
    if (key) next.set("kpi", key);
    else next.delete("kpi");
    setParams(next);
  };

  useEffect(() => {
    const found = (data?.projects ?? [])
      .filter((p) => p.owningOrganizationId && p.owningOrganizationName)
      .map((p) => ({ id: p.owningOrganizationId!, name: p.owningOrganizationName! }));
    const fresh = found.filter((o, i) => !ownersSeen.some((s) => s.id === o.id) && found.findIndex((x) => x.id === o.id) === i);
    if (fresh.length) setOwnersSeen((prev) => [...prev, ...fresh]);
  }, [data, ownersSeen]);

  const byStage = useMemo(() => {
    const groups = KpiStageEnum.options.map((stage) => ({ stage, kpis: (data?.kpis ?? []).filter((k) => KPI_BY_KEY[k.key].stage === stage) }));
    return groups.filter((g) => g.kpis.length > 0);
  }, [data]);

  useEffect(() => {
    if (selected) window.scrollTo({ top: 0 });
  }, [selected]);

  if (isLoading) {
    return (
      <div className="flex justify-center p-10">
        <Loader />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="bg-white rounded-2xl border border-rose-200 p-6 text-sm text-rose-700 flex flex-wrap items-center justify-between gap-3">
        <span>The KPIs could not be loaded. Check your connection, then try again.</span>
        <button type="button" onClick={() => refetch()} className="rounded-xl border border-rose-300 px-3 py-1.5 text-xs font-semibold hover:bg-rose-50">
          Try again
        </button>
      </div>
    );
  }
  const selectedKpi = selected ? data.kpis.find((k) => k.key === selected) ?? null : null;
  const customInvalid = preset === "CUSTOM" && custom.from > custom.to;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">
          {data.projectCount} project{data.projectCount === 1 ? "" : "s"} in view, {formatDay(data.period.from)} to {formatDay(data.period.to)} ({timeZoneAbbreviation(data.timeZone)})
          {isFetching && <span className="text-slate-400"> · updating</span>}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <DeliveryModelFilters filters={filters} onChange={setFilters} owners={ownersSeen} />
          <div className="w-40">
            <CustomSelect value={preset} onChange={(v) => setPreset(v as Preset)} options={PRESETS} size="sm" />
          </div>
          {preset === "CUSTOM" && (
            <div className="flex items-center gap-1 text-xs text-slate-600">
              <input type="date" aria-label="From" className="rounded-xl border border-slate-300 px-2 py-1.5 text-xs" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} />
              <span>to</span>
              <input type="date" aria-label="To" className="rounded-xl border border-slate-300 px-2 py-1.5 text-xs" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} />
            </div>
          )}
          <button
            type="button"
            onClick={() => exportCsv(data)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" /> Export CSV
          </button>
        </div>
      </div>
      {customInvalid && <p className="text-xs text-rose-700">The period must start before it ends.</p>}

      {selectedKpi ? (
        <KpiDetail data={data} kpi={selectedKpi} onBack={() => select(null)} onOpenProject={onOpenProject} />
      ) : (
        <>
          {byStage.map(({ stage, kpis }) => (
            <section key={stage} aria-labelledby={`kpi-stage-${stage}`} className="space-y-2">
              <h2 id={`kpi-stage-${stage}`} className="text-sm font-semibold text-slate-900">
                {KPI_STAGE_META[stage].label}
              </h2>
              <ul className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2.5">
                {kpis.map((k) => (
                  <KpiTile key={k.key} kpi={k} onSelect={() => select(k.key)} />
                ))}
              </ul>
            </section>
          ))}
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer font-medium text-slate-600 hover:text-slate-900">How these figures are counted</summary>
            <p className="mt-1.5 max-w-prose">
              KPIs marked as period-based count what fell due, was held, issued or decided in the period; the others show today's value. A KPI is
              "not tracked" when no project in view has its inputs configured, and is never counted as 0%. Targets are set per project type in
              Settings, Project types.
            </p>
          </details>
        </>
      )}
    </div>
  );
}
