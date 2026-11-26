import React from "react";
import { Marker, Tooltip } from "react-leaflet";
import { divIcon } from "leaflet";
import { ProjectGeofenceSchema, SITE_STATUS_LABELS, type ProjectGeofence, type ProjectSiteDto, type SiteStatus } from "@insite/shared";
import { GeofenceShapeLayers } from "../geofence/GeofenceShapeLayers";
import { paddedGeofenceBounds, type LatLngTuple } from "../geofence/geofenceGeometry";
import { SITE_STATUS_COLOR, SiteStatusChip, sitePercentText } from "./siteStatus";

/** A located site ready to draw: its boundary and where its numbered marker goes. */
export interface MapSite {
  site: ProjectSiteDto;
  geofence: ProjectGeofence;
  position: LatLngTuple;
}

/**
 * The sites that can be drawn: a valid saved boundary, else a radial boundary of the workspace
 * default radius around the site's coordinates. Sites with neither are left out (not located yet).
 */
export function mapSitesOf(sites: ProjectSiteDto[], defaultRadiusMeters: number): MapSite[] {
  const out: MapSite[] = [];
  for (const site of sites) {
    const parsed = site.boundary ? ProjectGeofenceSchema.safeParse(site.boundary) : null;
    const hasPoint = site.latitude !== null && site.longitude !== null;
    let geofence: ProjectGeofence | null = parsed?.success ? parsed.data : null;
    if (!geofence && hasPoint && defaultRadiusMeters > 0) {
      geofence = {
        mode: "RADIAL",
        center: { latitude: site.latitude as number, longitude: site.longitude as number },
        radiusMeters: defaultRadiusMeters,
      } as ProjectGeofence;
    }
    if (!geofence) continue;
    let position: LatLngTuple;
    if (hasPoint) position = [site.latitude as number, site.longitude as number];
    else if (geofence.mode === "RADIAL") position = [geofence.center.latitude, geofence.center.longitude];
    else {
      const [[s, w], [n, e]] = paddedGeofenceBounds(geofence);
      position = [(s + n) / 2, (w + e) / 2];
    }
    out.push({ site, geofence, position });
  }
  return out;
}

// Div icons so the markers do not depend on Leaflet's image assets (as in SitePinMap).
const ICONS = new Map<string, ReturnType<typeof divIcon>>();
const siteIcon = (siteNumber: number, status: SiteStatus) => {
  const key = `${siteNumber}:${status}`;
  const cached = ICONS.get(key);
  if (cached) return cached;
  const label = String(siteNumber);
  const width = label.length > 1 ? 28 : 24;
  // A pin whose tip sits on the site, so the site boundary below it stays visible at any zoom.
  const color = SITE_STATUS_COLOR[status];
  const icon = divIcon({
    className: "",
    iconSize: [width, 32],
    iconAnchor: [width / 2, 32],
    tooltipAnchor: [0, -28],
    html: `<div style="display:flex;flex-direction:column;align-items:center;width:${width}px;height:32px;filter:drop-shadow(0 1px 2px rgba(15,23,42,.45))"><div style="box-sizing:border-box;width:${width}px;height:24px;border-radius:9999px;background:#ffffff;border:3px solid ${color};display:flex;align-items:center;justify-content:center;font:700 11px/1 Inter,system-ui,sans-serif;color:#122f2a">${label}</div><div style="width:0;height:0;margin-top:-1px;border-left:5px solid transparent;border-right:5px solid transparent;border-top:9px solid ${color}"></div></div>`,
  });
  ICONS.set(key, icon);
  return icon;
};

/** "Site 2: Kofar Mata Primary School, Kano Municipal LGA, 42% complete, Behind" (marker title for screen readers). */
const siteTitle = (s: ProjectSiteDto) =>
  [
    `Site ${s.siteNumber}: ${s.schoolName}`,
    s.lgaName ? `${s.lgaName} LGA` : null,
    s.progressPct === null ? "no BoQ lines yet" : `${sitePercentText(s.progressPct)} complete`,
    SITE_STATUS_LABELS[s.status],
  ]
    .filter(Boolean)
    .join(", ");

/**
 * Client demo updates C2: each located site's boundary (lighter than the project's own) with a
 * numbered marker; the tooltip gives the school, LGA, % complete and the status in words.
 */
export function SiteBoundaryLayers({ sites }: { sites: MapSite[] }) {
  return (
    <>
      {sites.map(({ site, geofence }) => (
        <GeofenceShapeLayers key={`shape-${site.id}`} geofence={geofence} variant="site" />
      ))}
      {sites.map(({ site, position }) => (
        <Marker key={`marker-${site.id}`} position={position} icon={siteIcon(site.siteNumber, site.status)} title={siteTitle(site)}>
          <Tooltip direction="top" opacity={0.97}>
            <div className="font-sans text-xs">
              <div className="font-bold text-slate-900">
                Site {site.siteNumber} · {site.schoolName}
              </div>
              {site.lgaName && <div className="text-slate-600">{site.lgaName} LGA</div>}
              <div className="mt-0.5 flex items-center gap-2 text-slate-600">
                <span>{site.progressPct === null ? "No BoQ lines yet" : `${sitePercentText(site.progressPct)} complete`}</span>
                <SiteStatusChip status={site.status} />
              </div>
            </div>
          </Tooltip>
        </Marker>
      ))}
    </>
  );
}
