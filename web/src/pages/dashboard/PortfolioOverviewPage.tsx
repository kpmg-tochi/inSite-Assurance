import React, { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from "react-leaflet";
import { Activity, AlertTriangle, Clock, Landmark, MapPinOff, ShieldCheck, Wallet, Wrench } from "lucide-react";
import {
  PORTFOLIO_QUIET_SITE_DAYS,
  type PortfolioHealth,
  type PortfolioOverviewProject,
  type ProjectListFilters,
} from "@insite/shared";
import { usePortfolioOverviewQuery } from "../../queries/projects/useContractorVerificationQueries";
import { DeliveryModelFilters, ProjectTypeChip } from "../../components/projects/DeliveryModelFilters";
import { KpiCard } from "../../components/common";
import { ScheduleBadge } from "../../components/schedule/ScheduleVarianceBadge";
import Loader from "../../components/Loader";
import { formatCompactNaira, formatDateTimeShort } from "../../lib/formatters";
import { useTerm } from "../../lib/auth-context";
import { NEUTRAL_BOUNDS, type LatLngTuple } from "../../components/geofence/geofenceGeometry";

/** Marker colour per evidence health (same meaning as the directory badges). */
const HEALTH_STYLE: Record<PortfolioHealth, { color: string; label: string }> = {
  EVIDENCE_SUPPORTED: { color: "#059669", label: "Evidence supported" },
  EVIDENCE_PARTIAL: { color: "#d97706", label: "Evidence partial" },
  EVIDENCE_CONFLICT: { color: "#e11d48", label: "Evidence conflict" },
};

/** Fits the map to the visible pins whenever they change. */
function FitToPins({ points }: { points: LatLngTuple[] }) {
  const map = useMap();
  const key = points.map((p) => p.join(",")).join("|");
  useEffect(() => {
    if (points.length === 0) {
      map.fitBounds(NEUTRAL_BOUNDS);
    } else if (points.length === 1) {
      map.setView(points[0], 12);
    } else {
      map.fitBounds(points, { padding: [40, 40], maxZoom: 13 });
    }
    // key captures the point list; map is stable.
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * The portfolio dashboard (projects:view_portfolio): every live project the user can see on one
 * map, with portfolio KPI cards. Visibility follows the directory (assignment, organisation tree or
 * whole tenant); filters run on the server so the KPIs follow them.
 */
export function PortfolioOverviewPage({ onOpenProject }: { onOpenProject: (projectId: string) => void }) {
  const term = useTerm();
  const [filters, setFilters] = useState<ProjectListFilters>({});
  const { data, isLoading, isError } = usePortfolioOverviewQuery(filters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ownersSeen, setOwnersSeen] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    const found = (data?.projects ?? [])
      .map((p) => p.owningOrganization)
      .filter((o): o is { id: string; name: string } => Boolean(o));
    if (found.some((o) => !ownersSeen.some((s) => s.id === o.id))) {
      setOwnersSeen((prev) => [...prev, ...found.filter((o) => !prev.some((s) => s.id === o.id))]);
    }
  }, [data, ownersSeen]);

  const pinned = useMemo(() => (data?.projects ?? []).filter((p) => p.point), [data]);
  const unpinned = useMemo(() => (data?.projects ?? []).filter((p) => !p.point), [data]);
  const points = useMemo<LatLngTuple[]>(() => pinned.map((p) => [p.point!.latitude, p.point!.longitude]), [pinned]);

  if (isLoading) {
    return (
      <div className="flex justify-center p-10">
        <Loader />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="bg-white rounded-2xl border border-rose-200 p-6 text-sm text-rose-700">
        The portfolio could not be loaded. Try again in a moment.
      </div>
    );
  }

  const { kpis } = data;
  const selected = data.projects.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-base font-bold text-slate-900">Portfolio dashboard</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Every live project you can see, on one map. Figures follow the filters.
          </p>
        </div>
        <DeliveryModelFilters filters={filters} onChange={setFilters} owners={ownersSeen} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={<Landmark className="w-4 h-4" />}
          iconVariant="blue"
          title="Total commitment"
          value={formatCompactNaira(kpis.totalCommitmentNgn)}
          subtitle={`${kpis.projectCount} live project${kpis.projectCount === 1 ? "" : "s"}`}
        />
        <KpiCard
          icon={<Wallet className="w-4 h-4" />}
          iconVariant="emerald"
          title="Disbursed"
          value={formatCompactNaira(kpis.totalDisbursedNgn)}
          subtitle={`${kpis.disbursedPct}% of commitment`}
        />
        <KpiCard
          icon={<Activity className="w-4 h-4" />}
          iconVariant="indigo"
          title="Certified progress"
          value={`${kpis.weightedProgressPct}%`}
          subtitle="Weighted by budget"
        />
        <KpiCard
          icon={<ShieldCheck className="w-4 h-4" />}
          iconVariant={kpis.healthCounts.conflict > 0 ? "rose" : "emerald"}
          title="Evidence health"
          value={`${kpis.healthCounts.supported} / ${kpis.projectCount}`}
          subtitle={`${kpis.healthCounts.partial} partial · ${kpis.healthCounts.conflict} conflict`}
        />
        <KpiCard
          icon={<Clock className="w-4 h-4" />}
          iconVariant={kpis.behindScheduleCount > 0 ? "amber" : "slate"}
          title="Behind schedule"
          value={kpis.behindScheduleCount}
          subtitle="Projects past their planned progress"
        />
        <KpiCard
          icon={<AlertTriangle className="w-4 h-4" />}
          iconVariant={kpis.openConflictLineCount + kpis.unfulfilledHoldPointCount > 0 ? "rose" : "slate"}
          title="Open issues"
          value={kpis.openConflictLineCount + kpis.unfulfilledHoldPointCount}
          subtitle={`${kpis.openConflictLineCount} conflicting lines · ${kpis.unfulfilledHoldPointCount} unmet ${term("holdPoint", { plural: true, lower: true })}`}
        />
        <KpiCard
          icon={<MapPinOff className="w-4 h-4" />}
          iconVariant={kpis.quietSiteCount > 0 ? "amber" : "slate"}
          title="Quiet sites"
          value={kpis.quietSiteCount}
          subtitle={`No field capture in ${PORTFOLIO_QUIET_SITE_DAYS} days`}
        />
        <KpiCard
          icon={<Wrench className="w-4 h-4" />}
          iconVariant="purple"
          title="Handover and defects"
          value={kpis.closeoutCount}
          subtitle={`${term("retention")} held ${formatCompactNaira(kpis.retentionHeldNgn)}`}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="h-[460px]">
            <MapContainer bounds={NEUTRAL_BOUNDS} className="h-full w-full" scrollWheelZoom>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <FitToPins points={points} />
              {pinned.map((p) => {
                const style = HEALTH_STYLE[p.portfolioHealth];
                const isSelected = p.id === selectedId;
                return (
                  <CircleMarker
                    key={p.id}
                    center={[p.point!.latitude, p.point!.longitude]}
                    radius={isSelected ? 11 : 8}
                    pathOptions={{ color: "#ffffff", weight: 2, fillColor: style.color, fillOpacity: 0.95 }}
                    eventHandlers={{ click: () => setSelectedId(p.id) }}
                  >
                    <Tooltip direction="top" offset={[0, -6]}>
                      <span className="font-semibold">{p.codePrefix}</span> · {p.name}
                      <br />
                      {style.label} · {p.certifiedProgressPct}% certified
                    </Tooltip>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          </div>
          <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-600">
            {Object.values(HEALTH_STYLE).map((s) => (
              <span key={s.label} className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
            {unpinned.length > 0 && <span className="text-slate-500">{unpinned.length} project(s) have no site boundary and are not on the map.</span>}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm flex flex-col max-h-[500px]">
          {selected ? (
            <ProjectDetail project={selected} onOpen={() => onOpenProject(selected.id)} onBack={() => setSelectedId(null)} />
          ) : (
            <>
              <div className="px-4 py-3 border-b border-slate-100">
                <h2 className="text-sm font-bold text-slate-900">Projects</h2>
                <p className="text-[11px] text-slate-500">Select a project here or on the map.</p>
              </div>
              {data.projects.length === 0 ? (
                <p className="p-4 text-xs text-slate-500">No live projects match.</p>
              ) : (
                <ul className="overflow-y-auto divide-y divide-slate-100">
                  {data.projects.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(p.id)}
                        className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-start gap-2"
                      >
                        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: HEALTH_STYLE[p.portfolioHealth].color }} />
                        <span className="min-w-0">
                          <span className="block text-xs font-semibold text-slate-900 truncate">
                            {p.codePrefix} · {p.name}
                          </span>
                          <span className="block text-[11px] text-slate-500 truncate">
                            {p.region?.path ?? p.stateLocation} · {p.certifiedProgressPct}% certified
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectDetail({ project: p, onOpen, onBack }: { project: PortfolioOverviewProject; onOpen: () => void; onBack: () => void }) {
  const term = useTerm();
  const style = HEALTH_STYLE[p.portfolioHealth];
  return (
    <div className="p-4 space-y-3 overflow-y-auto">
      <button type="button" onClick={onBack} className="text-[11px] font-semibold text-slate-500 hover:text-slate-800">
        ← All projects
      </button>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-2 py-0.5 rounded-md bg-brand-navy text-white text-[11px] font-bold">{p.codePrefix}</span>
          <ProjectTypeChip type={p.projectType} />
        </div>
        <h3 className="text-sm font-bold text-slate-900">{p.name}</h3>
        <p className="text-[11px] text-slate-500">
          {p.region?.path ?? p.stateLocation}
          {p.lgaLocation ? ` · ${p.lgaLocation}` : ""}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-slate-500">Budget</dt>
          <dd className="font-semibold text-slate-900">{formatCompactNaira(p.totalBudgetNgn)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Disbursed</dt>
          <dd className="font-semibold text-slate-900">{formatCompactNaira(p.disbursedToDateNgn)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Certified progress</dt>
          <dd className="font-semibold text-slate-900">{p.certifiedProgressPct}%</dd>
        </div>
        <div>
          <dt className="text-slate-500">Evidence</dt>
          <dd className="font-semibold" style={{ color: style.color }}>
            {style.label}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Schedule</dt>
          <dd>{p.scheduleVariance ? <ScheduleBadge badge={p.scheduleVariance} /> : <span className="text-slate-400">No baseline</span>}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Last field capture</dt>
          <dd className="text-slate-900">{p.lastFieldCaptureAt ? formatDateTimeShort(p.lastFieldCaptureAt) : "None yet"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Owner</dt>
          <dd className="text-slate-900">{p.owningOrganization?.name ?? "Not set"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Open issues</dt>
          <dd className="text-slate-900">
            {p.openConflictCount} conflicts · {p.unfulfilledHoldPointCount} {term("holdPoint", { plural: true, lower: true })}
          </dd>
        </div>
      </dl>
      <button
        type="button"
        onClick={onOpen}
        className="w-full rounded-xl bg-brand-primary px-4 py-2 text-xs font-semibold text-white hover:bg-brand-hover"
      >
        Open project dashboard
      </button>
    </div>
  );
}
