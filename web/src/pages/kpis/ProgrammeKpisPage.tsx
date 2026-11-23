import React, { useEffect, useMemo, useState } from "react";
import { Download, Info, X } from "lucide-react";
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
import { countText, KPI_STATUS_META, KpiSparkline, KpiStatusChip, targetText } from "../../components/kpis/KpiDisplay";
import { displayTimeZone } from "../../lib/formatters";

/**
 * Phase 16: Programme KPIs (kpis:view). Every catalogue KPI over the projects the user can see,
 * grouped by process stage, against the targets set per project type. Filters by project type,
 * region and owning organisation; a period of a month, a quarter or a custom range. Clicking a
 * KPI opens the contributing projects (the table view of every figure); the CSV export holds the
 * same rows for every KPI.
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

function KpiTile({ kpi, selected, onSelect }: { kpi: KpiDashboardKpi; selected: boolean; onSelect: () => void }) {
  const def = KPI_BY_KEY[kpi.key];
  const tracked = kpi.status !== "NOT_TRACKED";
  const showBreakdown = kpi.byProjectType.length > 1 && tracked;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`text-left bg-white rounded-2xl border p-4 shadow-sm flex flex-col gap-2 transition hover:border-brand-primary ${
        selected ? "border-brand-primary ring-2 ring-brand-primary/20" : "border-slate-200/80"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold text-slate-800 leading-snug">{def.label}</span>
        <KpiStatusChip status={kpi.status} />
      </div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className={`text-2xl font-bold tabular-nums ${tracked ? "text-slate-900" : "text-slate-400"}`}>
            {tracked ? formatKpiValue(def, kpi.value) : "Not tracked"}
          </div>
          <div className="text-[11px] text-slate-500">
            {tracked ? countText(def, kpi.numerator, kpi.denominator) : "No project in view has this configured"}
            {!def.periodBased && tracked && " · current value"}
          </div>
        </div>
        {tracked && <KpiSparkline def={def} points={kpi.trend} />}
      </div>
      <div className="text-[11px] text-slate-600">{targetText(def, kpi.target, kpi.targetVaries)}</div>
      {showBreakdown && (
        <ul className="border-t border-slate-100 pt-2 space-y-1">
          {kpi.byProjectType.map((b) => (
            <li key={b.projectTypeId ?? "none"} className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
              <span className="truncate">{b.projectTypeName}</span>
              <span className="flex items-center gap-2 shrink-0">
                <span className="tabular-nums font-semibold text-slate-800">{b.status === "NOT_TRACKED" ? "–" : formatKpiValue(def, b.value)}</span>
                <span className="text-slate-400">{b.target === null ? "" : `target ${formatKpiValue(def, b.target)}`}</span>
                <KpiStatusChip status={b.status} label={KPI_STATUS_META[b.status].label} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </button>
  );
}

type DrillRow = KpiDashboardDto["projects"][number];

function DrillDown({ data, kpiKey, onClose, onOpenProject }: { data: KpiDashboardDto; kpiKey: KpiKey; onClose: () => void; onOpenProject: (id: string) => void }) {
  const def = KPI_BY_KEY[kpiKey];
  const rows = data.projects.filter((p) => p.values[kpiKey]);
  const notTracking = data.projects.length - rows.length;
  const columns: TableColumnDef<DrillRow>[] = [
    { id: "code", header: "Project", cell: (p) => (
      <div>
        <div className="text-xs font-semibold text-slate-900">{p.codePrefix}</div>
        <div className="text-[11px] text-slate-500 truncate max-w-[260px]">{p.name}</div>
      </div>
    ) },
    { id: "type", header: "Project type", cell: (p) => <span className="text-xs text-slate-700">{p.projectTypeName ?? "–"}</span> },
    { id: "owner", header: "Owner · region", cell: (p) => <span className="text-xs text-slate-700">{[p.owningOrganizationName, p.regionName].filter(Boolean).join(" · ") || "–"}</span> },
    { id: "value", header: "Value", align: "right", cell: (p) => <span className="text-xs font-semibold tabular-nums text-slate-900">{formatKpiValue(def, p.values[kpiKey].value)}</span> },
    { id: "count", header: `${def.numerator} / ${def.denominator}`, align: "right", cell: (p) => <span className="text-xs tabular-nums text-slate-600">{countText(def, p.values[kpiKey].numerator, p.values[kpiKey].denominator)}</span> },
    { id: "target", header: "Target", align: "right", cell: (p) => <span className="text-xs text-slate-600">{p.values[kpiKey].target === null ? "–" : formatKpiValue(def, p.values[kpiKey].target)}</span> },
    { id: "status", header: "Status", cell: (p) => <KpiStatusChip status={p.values[kpiKey].status} /> },
  ];
  return (
    <StandardTable<DrillRow>
      title={`${def.label}: contributing projects`}
      subtitle={`${def.description} ${notTracking ? `${notTracking} project${notTracking === 1 ? "" : "s"} in view do not track it.` : ""}`}
      headerActions={
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      }
      columns={columns}
      data={rows}
      keyExtractor={(p) => p.projectId}
      onRowClick={(p) => onOpenProject(p.projectId)}
      minWidth="min-w-[760px]"
      emptyState={{ title: "No project in view tracks this KPI", description: "Its inputs are not configured on any project in the current filters." }}
    />
  );
}

export function ProgrammeKpisPage({ onOpenProject }: { onOpenProject: (projectId: string) => void }) {
  // The tenant's calendar day, so the presets match the server's periods (Tenant.timezone).
  const today = useMemo(() => zonedCalendarDate(new Date(), displayTimeZone()), []);
  const [filters, setFilters] = useState<ProjectListFilters>({});
  const [preset, setPreset] = useState<Preset>("THIS_QUARTER");
  const [custom, setCustom] = useState(() => presetPeriod("THIS_MONTH", today));
  const period = preset === "CUSTOM" ? custom : presetPeriod(preset, today);
  const { data, isLoading, isError, isFetching } = useKpiDashboardQuery({ ...filters, ...period });
  const [selected, setSelected] = useState<KpiKey | null>(null);
  const [ownersSeen, setOwnersSeen] = useState<Array<{ id: string; name: string }>>([]);

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
    if (selected) document.getElementById("kpi-drilldown")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selected]);

  if (isLoading) {
    return (
      <div className="flex justify-center p-10">
        <Loader />
      </div>
    );
  }
  if (isError || !data) {
    return <div className="bg-white rounded-2xl border border-rose-200 p-6 text-sm text-rose-700">The KPIs could not be loaded. Try again in a moment.</div>;
  }
  const selectedKpi = selected && data.kpis.some((k) => k.key === selected) ? selected : null;
  const customInvalid = preset === "CUSTOM" && custom.from > custom.to;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
          <div>
            <h1 className="text-base font-bold text-slate-900">Programme KPIs</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {data.projectCount} project{data.projectCount === 1 ? "" : "s"} in view · {formatDay(data.period.from)} to {formatDay(data.period.to)} ({timeZoneAbbreviation(data.timeZone)})
              {isFetching && " · updating…"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-40">
              <CustomSelect value={preset} onChange={(v) => setPreset(v as Preset)} options={PRESETS} />
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
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
          </div>
        </div>
        <DeliveryModelFilters filters={filters} onChange={setFilters} owners={ownersSeen} />
        {customInvalid && <p className="text-xs text-rose-700">The period must start before it ends.</p>}
        <p className="flex items-start gap-1.5 text-[11px] text-slate-500">
          <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
          Period-based KPIs count what fell due, was held, issued or decided in the period; the others show today's value. A KPI is "not
          tracked" when no project in view has its inputs configured; that is never counted as 0%. Targets are set per project type in
          Settings → Project types, regions &amp; documents.
        </p>
      </div>

      {selectedKpi && (
        <div id="kpi-drilldown" className="scroll-mt-4">
          <DrillDown data={data} kpiKey={selectedKpi} onClose={() => setSelected(null)} onOpenProject={onOpenProject} />
        </div>
      )}

      {byStage.map(({ stage, kpis }) => (
        <section key={stage} className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 px-1">{KPI_STAGE_META[stage].label}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {kpis.map((k) => (
              <KpiTile key={k.key} kpi={k} selected={selectedKpi === k.key} onSelect={() => setSelected(selectedKpi === k.key ? null : k.key)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
