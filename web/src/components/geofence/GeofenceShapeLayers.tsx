import React, { useMemo } from 'react';
import { Circle, Polygon, Polyline } from 'react-leaflet';
import type { PathOptions } from 'leaflet';
import type { ProjectGeofence } from '@insite/shared';
import { bufferLine, offsetRing, openRingLonLat, toLatLng, type LonLat } from './geofenceGeometry';

const BRAND = 'var(--hex-brand-primary)';

const SHAPE: PathOptions = {
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

interface GeofenceShapeLayersProps {
  geofence: ProjectGeofence;
  /** Dashed band drawn this far outside the boundary when > 0. */
  toleranceMeters?: number;
  /** Editing view: perimeter closing edge is dashed so the user can see where the ring closes. */
  editing?: boolean;
}

/** Draws a geofence (and its tolerance band) on a react-leaflet map. Not interactive. */
export function GeofenceShapeLayers({ geofence, toleranceMeters = 0, editing = false }: GeofenceShapeLayersProps) {
  const tolerance = Math.max(0, toleranceMeters);

  const corridor = useMemo(() => {
    if (geofence.mode !== 'LINEAR_CORRIDOR') return null;
    const line = geofence.centerlineCoordinates as LonLat[];
    return {
      centreline: line.map(toLatLng),
      buffer: bufferLine(line, geofence.corridorHalfWidthMeters),
      toleranceBuffer: tolerance > 0 ? bufferLine(line, geofence.corridorHalfWidthMeters + tolerance) : [],
    };
  }, [geofence, tolerance]);

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

  if (corridor) {
    return (
      <>
        {corridor.toleranceBuffer.length > 0 && <Polygon positions={corridor.toleranceBuffer} pathOptions={TOLERANCE} />}
        {corridor.buffer.length > 0 && (
          <Polygon positions={corridor.buffer} pathOptions={{ ...SHAPE, weight: 1, opacity: 0.6 }} />
        )}
        <Polyline
          positions={corridor.centreline}
          pathOptions={{ color: BRAND, weight: 3, opacity: 0.9, dashArray: '8 6', interactive: false }}
        />
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
