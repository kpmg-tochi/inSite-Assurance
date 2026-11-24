import React, { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip, useMap } from "react-leaflet";
import type { PortfolioOverviewProject, ScheduleStatusValue } from "@insite/shared";
import { NEUTRAL_BOUNDS, type LatLngTuple } from "../../components/geofence/geofenceGeometry";

/** Marker colour per schedule status. On track and complete differ in hue and in the legend's words. */
export const MAP_STATUS: Record<"ON_TRACK" | "BEHIND" | "COMPLETE" | "OTHER", { color: string; label: string }> = {
  ON_TRACK: { color: "#12915c", label: "On track" },
  BEHIND: { color: "#e11d48", label: "Behind schedule" },
  COMPLETE: { color: "#122f2a", label: "Complete" },
  OTHER: { color: "#94a3b8", label: "Not scheduled yet" },
};

export function mapStatusOf(p: Pick<PortfolioOverviewProject, "scheduleVariance">) {
  const s: ScheduleStatusValue | undefined = p.scheduleVariance?.status;
  if (s === "ON_TRACK" || s === "AHEAD") return MAP_STATUS.ON_TRACK;
  if (s === "BEHIND") return MAP_STATUS.BEHIND;
  if (s === "COMPLETE") return MAP_STATUS.COMPLETE;
  return MAP_STATUS.OTHER;
}

/** Fits the map to the visible pins whenever they change. */
function FitToPins({ points }: { points: LatLngTuple[] }) {
  const map = useMap();
  const key = points.map((p) => p.join(",")).join("|");
  useEffect(() => {
    if (points.length === 0) map.fitBounds(NEUTRAL_BOUNDS);
    else if (points.length === 1) map.setView(points[0], 12);
    else map.fitBounds(points, { padding: [40, 40], maxZoom: 13 });
    // key captures the point list; map is stable.
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Every project in view with a site boundary, as a pin; a pin's popup opens the project. */
export function PortfolioMap({ projects, onOpenProject }: { projects: PortfolioOverviewProject[]; onOpenProject: (projectId: string) => void }) {
  const pinned = useMemo(() => projects.filter((p) => p.point), [projects]);
  const points = useMemo<LatLngTuple[]>(() => pinned.map((p) => [p.point!.latitude, p.point!.longitude]), [pinned]);
  const unpinned = projects.length - pinned.length;

  return (
    <section aria-label="Project map" className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
      <div className="h-[380px] lg:h-[440px]">
        <MapContainer bounds={NEUTRAL_BOUNDS} className="h-full w-full" scrollWheelZoom={false}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitToPins points={points} />
          {pinned.map((p) => {
            const style = mapStatusOf(p);
            return (
              <CircleMarker
                key={p.id}
                center={[p.point!.latitude, p.point!.longitude]}
                radius={8}
                pathOptions={{ color: "#ffffff", weight: 2, fillColor: style.color, fillOpacity: 0.95 }}
              >
                <Tooltip direction="top" offset={[0, -6]}>
                  {p.codePrefix} · {p.name}
                </Tooltip>
                <Popup>
                  <div className="min-w-[200px] space-y-1.5 font-sans">
                    <p className="text-[11px] font-semibold text-slate-500 tabular-nums">{p.codePrefix}</p>
                    <p className="text-sm font-semibold text-slate-900 leading-snug">{p.name}</p>
                    <p className="text-xs text-slate-600">
                      {style.label} · {Math.round(p.certifiedProgressPct)}% complete
                    </p>
                    <button
                      type="button"
                      onClick={() => onOpenProject(p.id)}
                      className="mt-1 w-full rounded-lg bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-hover"
                    >
                      Open project
                    </button>
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 px-4 py-2 text-xs text-slate-600">
        {Object.values(MAP_STATUS).map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} aria-hidden="true" />
            {s.label}
          </span>
        ))}
        {unpinned > 0 && (
          <span className="text-slate-500 sm:ml-auto">
            {unpinned} project{unpinned === 1 ? " has" : "s have"} no site boundary yet and {unpinned === 1 ? "is" : "are"} only in the table.
          </span>
        )}
      </div>
    </section>
  );
}
