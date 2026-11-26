import React, { useEffect, useMemo, useRef } from "react";
import { CircleMarker, MapContainer, Marker, TileLayer, Tooltip, useMap } from "react-leaflet";
import { divIcon, type LeafletEvent, type Marker as LeafletMarker } from "leaflet";
import type { ProjectGeofence } from "@insite/shared";
import { GeofenceShapeLayers } from "../geofence/GeofenceShapeLayers";
import { NEUTRAL_BOUNDS, paddedGeofenceBounds, type LatLngTuple } from "../geofence/geofenceGeometry";

export interface SitePin {
  key: string;
  latitude: number;
  longitude: number;
  /** Tooltip text (e.g. "Site 2 · Kofar Mata Primary School"). */
  label: string;
  color?: string;
}

/**
 * Fits the map around the pins' boundaries whenever they move, except right after a pin was dragged
 * (the map stays where the user is working).
 */
function FitToPins({ bounds, skipNext }: { bounds: [LatLngTuple, LatLngTuple] | null; skipNext: React.MutableRefObject<boolean> }) {
  const map = useMap();
  const key = bounds ? bounds.flat().join(",") : "none";
  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    map.fitBounds(bounds ?? NEUTRAL_BOUNDS, { padding: [24, 24], maxZoom: 16 });
    // key captures the bounds; map is stable.
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// A div icon so the handle does not depend on Leaflet's image assets (as in GeofenceEditor).
const PIN_ICONS = new Map<string, ReturnType<typeof divIcon>>();
const pinIcon = (fill: string) => {
  const cached = PIN_ICONS.get(fill);
  if (cached) return cached;
  const icon = divIcon({
    className: "",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: `<div style="width:18px;height:18px;border-radius:9999px;background:${fill};border:2px solid #ffffff;box-shadow:0 1px 3px rgba(15,23,42,.45);cursor:grab"></div>`,
  });
  PIN_ICONS.set(fill, icon);
  return icon;
};

const round7 = (n: number) => Number(n.toFixed(7));

/**
 * Client demo updates C2 (wave 2): a small map of site pins, each with the radial boundary it gets
 * when saved (the workspace default radius). Read-only unless `onPinMove` is given (D3): then each
 * pin can be dragged to correct its position.
 */
export function SitePinMap({
  pins,
  radiusMeters,
  className = "h-56",
  onPinMove,
}: {
  pins: SitePin[];
  radiusMeters: number;
  className?: string;
  onPinMove?: (key: string, latitude: number, longitude: number) => void;
}) {
  const skipNextFit = useRef(false);
  const shapes = useMemo(
    () =>
      pins.map((p) => ({
        pin: p,
        geofence: { mode: "RADIAL", center: { latitude: p.latitude, longitude: p.longitude }, radiusMeters } as ProjectGeofence,
      })),
    [pins, radiusMeters]
  );
  const bounds = useMemo<[LatLngTuple, LatLngTuple] | null>(() => {
    if (shapes.length === 0) return null;
    let south = 90;
    let west = 180;
    let north = -90;
    let east = -180;
    for (const s of shapes) {
      const [[s1, w1], [n1, e1]] = paddedGeofenceBounds(s.geofence);
      south = Math.min(south, s1);
      west = Math.min(west, w1);
      north = Math.max(north, n1);
      east = Math.max(east, e1);
    }
    return [
      [south, west],
      [north, east],
    ];
  }, [shapes]);

  const onDragEnd = (key: string) => (e: LeafletEvent) => {
    const p = (e.target as LeafletMarker).getLatLng().wrap();
    skipNextFit.current = true;
    onPinMove?.(key, round7(p.lat), round7(p.lng));
  };

  return (
    <div className={`overflow-hidden rounded-xl border border-slate-200 ${className}`}>
      <MapContainer bounds={bounds ?? NEUTRAL_BOUNDS} scrollWheelZoom={false} className="h-full w-full z-0">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitToPins bounds={bounds} skipNext={skipNextFit} />
        {shapes.map(({ pin, geofence }) => (
          <React.Fragment key={pin.key}>
            <GeofenceShapeLayers geofence={geofence} />
            {onPinMove ? (
              <Marker
                position={[pin.latitude, pin.longitude]}
                icon={pinIcon(pin.color ?? "var(--hex-brand-primary)")}
                draggable
                title={`${pin.label}: drag to move`}
                eventHandlers={{ dragend: onDragEnd(pin.key) }}
              >
                <Tooltip direction="top" offset={[0, -8]}>
                  {pin.label}
                </Tooltip>
              </Marker>
            ) : (
              <CircleMarker
                center={[pin.latitude, pin.longitude]}
                radius={7}
                pathOptions={{ color: "#ffffff", weight: 2, fillColor: pin.color ?? "var(--hex-brand-primary)", fillOpacity: 0.95 }}
              >
                <Tooltip direction="top" offset={[0, -6]}>
                  {pin.label}
                </Tooltip>
              </CircleMarker>
            )}
          </React.Fragment>
        ))}
      </MapContainer>
    </div>
  );
}
