import React, { useMemo } from 'react';
import { Circle, Polygon, Polyline } from 'react-leaflet';
import type { PathOptions } from 'leaflet';
import type { ProjectGeofence } from '@insite/shared';
import { offsetRing, openRingLonLat, toLatLng, type LonLat } from './geofenceGeometry';

const BRAND = 'var(--hex-brand-primary)';

const PROJECT_SHAPE: PathOptions = {
  color: BRAND,
  fillColor: BRAND,
  fillOpacity: 0.1,
  weight: 2,
  interactive: false,
};

const TOLERANCE: PathOptions = {
  color: BRAND,
  weight: 1.5,
  opacity: 0.7,
  dashArray: '6 6',
  fill: false,
  interactive: false,
};

/** A site's boundary inside a project map: lighter and thinner than the project's own boundary. */
const SITE_SHAPE: PathOptions = {
  color: 'var(--hex-brand-medium)',
  fillColor: 'var(--hex-brand-medium)',
  fillOpacity: 0.18,
  opacity: 0.9,
  weight: 2,
  interactive: false,
};

interface GeofenceShapeLayersProps {
  geofence: ProjectGeofence;
  /** Dashed band drawn this far outside the boundary when > 0. */
  toleranceMeters?: number;
  /** Editing view: perimeter closing edge is dashed so the user can see where the ring closes. */
  editing?: boolean;
  /** `site`: a site's boundary drawn beside the project's own (lighter style). Default `project`. */
  variant?: 'project' | 'site';
}

/** Draws a geofence (and its tolerance band) on a react-leaflet map. Not interactive. */
export function GeofenceShapeLayers({
  geofence,
  toleranceMeters = 0,
  editing = false,
  variant = 'project',
}: GeofenceShapeLayersProps) {
  const tolerance = Math.max(0, toleranceMeters);
  const SHAPE = variant === 'site' ? SITE_SHAPE : PROJECT_SHAPE;

  const perimeter = useMemo(() => {
    if (geofence.mode !== 'PERIMETER') return null;
    const open = openRingLonLat(geofence.perimeterCoordinates as LonLat[]);
    return {
      ring: open.map(toLatLng),
      toleranceRing: tolerance > 0 ? offsetRing(open, tolerance) : [],
    };
  }, [geofence, tolerance]);

  if (geofence.mode === 'RADIAL') {
    const center: [number, number] = [geofence.center.latitude, geofence.center.longitude];
    return (
      <>
        {tolerance > 0 && <Circle center={center} radius={geofence.radiusMeters + tolerance} pathOptions={TOLERANCE} />}
        <Circle center={center} radius={geofence.radiusMeters} pathOptions={SHAPE} />
      </>
    );
  }

  if (perimeter) {
    const { ring } = perimeter;
    return (
      <>
        {perimeter.toleranceRing.length > 0 && <Polygon positions={perimeter.toleranceRing} pathOptions={TOLERANCE} />}
        {editing ? (
          <>
            <Polygon positions={ring} pathOptions={{ ...SHAPE, stroke: false }} />
            <Polyline positions={ring} pathOptions={{ color: BRAND, weight: 2, interactive: false }} />
            <Polyline
              positions={[ring[ring.length - 1], ring[0]]}
              pathOptions={{ color: BRAND, weight: 2, dashArray: '4 6', interactive: false }}
            />
          </>
        ) : (
          <Polygon positions={ring} pathOptions={SHAPE} />
        )}
      </>
    );
  }

  return null;
}
