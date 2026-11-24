import React, { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import { MapPinOff } from 'lucide-react';
import {
  ProjectGeofenceSchema,
  geofenceModeLabel,
  type CaptureListItemDto,
  type ProjectGeofence,
} from '@insite/shared';
import type { ProjectSummaryDto } from '../api/types';
import { formatDateTimeShort } from '../lib/formatters';
import { formatReporterRoleBadge } from './reporterRole';
import { GeofenceShapeLayers } from './geofence/GeofenceShapeLayers';
import { paddedGeofenceBounds, type LatLngTuple } from './geofence/geofenceGeometry';
import { describeGeofenceStatus } from './geofence/geofenceStatus';

interface LiveGeospatialMapProps {
  project: ProjectSummaryDto;
  /** Registered captures (GET /evidence). Only captures with a GPS fix are plotted. */
  evidenceLogs: CaptureListItemDto[];
  onSelectEvidenceLog?: (log: CaptureListItemDto) => void;
}

type LocatedCapture = CaptureListItemDto & { latitude: number; longitude: number };

const isLocated = (c: CaptureListItemDto): c is LocatedCapture =>
  c.locationAvailable && c.latitude !== null && c.longitude !== null;

/** "Photo", "Video", "Voice note": the capture's media type as a label. */
const mediaLabel = (c: CaptureListItemDto): string => {
  const words = c.mediaType.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Refits the map when the project's boundary changes. */
function FitToGeofence({ bounds }: { bounds: [LatLngTuple, LatLngTuple] }) {
  const map = useMap();
  const key = bounds.flat().join(',');
  useEffect(() => {
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 17 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

/** One-line description of the boundary size for the callout. */
function geofenceSizeText(geofence: ProjectGeofence): string {
  switch (geofence.mode) {
    case 'RADIAL':
      return `${geofence.radiusMeters.toLocaleString()} m site radius`;
    case 'PERIMETER': {
      const ring = geofence.perimeterCoordinates;
      const closed =
        ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
      const corners = closed ? ring.length - 1 : ring.length;
      return `Site perimeter, ${corners} corners`;
    }
  }
}

export function LiveGeospatialMap({
  project,
  evidenceLogs,
  onSelectEvidenceLog,
}: LiveGeospatialMapProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [tierFilter, setTierFilter] = useState<'ALL' | 'INDEPENDENT' | 'FLAGGED'>('ALL');
  const located = useMemo(() => evidenceLogs.filter(isLocated), [evidenceLogs]);
  const [activeLogId, setActiveLogId] = useState<string | null>(located[0]?.id ?? null);

  useEffect(() => {
    if (located.length > 0 && !activeLogId) {
      setActiveLogId(located[0].id);
    }
  }, [located, activeLogId]);

  const filteredLogs = useMemo(() => {
    return located.filter((log) => {
      if (tierFilter === 'INDEPENDENT' && log.fieldPersonaType !== 'INDEPENDENT_VERIFIER') {
        return false;
      }
      if (tierFilter === 'FLAGGED' && log.integrityPassed && log.isWithinGeofence !== false) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        log.reporterName.toLowerCase().includes(q) ||
        log.reporterRoleName.toLowerCase().includes(q) ||
        log.caption?.toLowerCase().includes(q)
      );
    });
  }, [located, searchQuery, tierFilter]);

  const selectedLog = useMemo(() => {
    return filteredLogs.find((l) => l.id === activeLogId) || filteredLogs[0] || located[0] || null;
  }, [filteredLogs, located, activeLogId]);

  // Only a boundary that passes the shared schema is drawn; there is no made-up fallback location.
  const geofence = useMemo<ProjectGeofence | null>(() => {
    if (!project.geofence) return null;
    const parsed = ProjectGeofenceSchema.safeParse(project.geofence);
    return parsed.success ? parsed.data : null;
  }, [project.geofence]);
  const tolerance = Math.max(0, project.geofenceToleranceMeters ?? 0);
  const mapBounds = useMemo(
    () => (geofence ? paddedGeofenceBounds(geofence, tolerance) : null),
    [geofence, tolerance]
  );

  // Counted only over captures the server could evaluate; no data means no percentage.
  const evaluated = evidenceLogs.filter((l) => l.isWithinGeofence !== null);
  const withinCount = evaluated.filter((l) => l.isWithinGeofence === true).length;
  const toleranceCount = evaluated.filter((l) => l.geofenceStatus === 'WITHIN_TOLERANCE').length;
  const withinPct = evaluated.length > 0 ? Math.round((withinCount / evaluated.length) * 100) : null;
  const noLocationCount = evidenceLogs.length - located.length;
  const mockCount = evidenceLogs.filter((l) => l.isMockLocation).length;
  const duplicateCount = evidenceLogs.filter((l) =>
    l.integrityFlags.some(
      (f) => f === 'DUPLICATE_PHOTO_SHA256_MATCH' || f === 'RECYCLED_PHOTO_PHASH_SIMILARITY'
    )
  ).length;

  if (!geofence || !mapBounds) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm h-[44vh] min-h-[340px] flex flex-col items-center justify-center text-center px-6">
        <MapPinOff className="w-8 h-8 text-slate-300" />
        <div className="mt-3 text-sm font-bold text-slate-900">
          {project.geofence ? 'The site boundary could not be read' : 'No site boundary set'}
        </div>
        <p className="mt-1 text-xs text-slate-500 max-w-md">
          {project.geofence
            ? 'The saved geofence is incomplete or invalid, so it is not drawn. Redraw it in the project settings.'
            : 'Draw the geofence in the project settings to see the boundary and capture locations on a map.'}
        </p>
        <p className="mt-3 text-[11px] text-slate-400">
          {located.length} capture{located.length === 1 ? '' : 's'} with a GPS fix
          {noLocationCount > 0 ? ` · ${noLocationCount} without` : ''}
        </p>
      </div>
    );
  }

  const selectedStatus = selectedLog
    ? describeGeofenceStatus(selectedLog.geofenceStatus, selectedLog.isWithinGeofence, selectedLog.distanceOutsideMeters)
    : null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden relative h-[44vh] min-h-[340px]">
      {/* Docked Top Search & Filter Bar */}
      <div className="absolute top-3 left-16 right-3 z-[400] flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-xl px-3.5 py-2 shadow-md flex items-center gap-2.5 w-80 pointer-events-auto">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search reporter, role or caption..."
            className="text-xs text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none w-full"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="text-[11px] text-slate-400 hover:text-slate-700 font-medium"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 pointer-events-auto">
          <div className="bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-xl p-1 shadow-md flex items-center gap-1 text-xs">
            {(
              [
                ['ALL', `All Captures (${located.length})`],
                ['INDEPENDENT', 'Independent Monitors'],
                ['FLAGGED', 'Flagged'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTierFilter(key)}
                className={`px-2.5 py-1 rounded-lg font-medium transition ${
                  tierFilter === key ? 'bg-brand-primary text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Interactive React-Leaflet Map (Standard OpenStreetMap: Free Out-of-the-Box, Zero API Key) */}
      <MapContainer bounds={mapBounds} scrollWheelZoom={true} className="w-full h-full z-0">
        <FitToGeofence bounds={mapBounds} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <GeofenceShapeLayers geofence={geofence} toleranceMeters={tolerance} />

        {/* Capture Pins */}
        {filteredLogs.map((log) => {
          const isSelected = selectedLog?.id === log.id;
          const pinColor = !log.integrityPassed
            ? 'var(--hex-status-danger)'
            : log.fieldPersonaType === 'INDEPENDENT_VERIFIER'
              ? log.signatureVerified === true
                ? 'var(--hex-brand-primary)'
                : 'var(--hex-brand-pacific)'
              : 'var(--hex-status-warning)';

          return (
            <CircleMarker
              key={log.id}
              center={[log.latitude, log.longitude]}
              radius={isSelected ? 9 : 7}
              pathOptions={{
                color: '#FFFFFF',
                weight: isSelected ? 3 : 2,
                fillColor: pinColor,
                fillOpacity: 0.95,
              }}
              eventHandlers={{
                click: () => {
                  setActiveLogId(log.id);
                  onSelectEvidenceLog?.(log);
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                <div className="text-xs font-sans">
                  <div className="font-bold text-slate-900">
                    {mediaLabel(log)} · {formatDateTimeShort(log.capturedAt)}
                  </div>
                  <div className="text-slate-600">
                    {formatReporterRoleBadge(log.reporterRoleName, log.fieldPersonaType)}
                  </div>
                  <div className="text-slate-500">
                    {describeGeofenceStatus(log.geofenceStatus, log.isWithinGeofence, log.distanceOutsideMeters).text}
                  </div>
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>

      {/* Floating 3-Pod Dark Navy Callout Cluster (Bottom-Right) */}
      <div className="absolute bottom-3 right-3 z-[400] flex items-stretch gap-2.5 max-w-3xl pointer-events-auto">
        <div className="bg-brand-navy/95 backdrop-blur-md text-white rounded-xl p-3 shadow-xl border border-white/10 w-44 flex flex-col justify-between">
          <div className="text-[10px] uppercase tracking-wider text-white/60 font-semibold">
            {geofenceModeLabel(geofence.mode)}
          </div>
          <div className="my-1">
            <div className="text-lg font-bold">
              {withinPct === null ? 'No data' : `${withinPct}% Within`}
            </div>
            <div className="text-[11px] text-white/70">{geofenceSizeText(geofence)}</div>
            <div className="text-[11px] text-white/70">
              {tolerance > 0 ? `${tolerance.toLocaleString()} m tolerance band` : 'No tolerance band'}
              {toleranceCount > 0 ? ` · ${toleranceCount} within tolerance` : ''}
            </div>
          </div>
          <div className="text-[10px] text-white/70 font-medium">
            {located.length} with GPS fix
            {noLocationCount > 0 ? ` · ${noLocationCount} without` : ''}
          </div>
        </div>

        <div className="bg-brand-navy/95 backdrop-blur-md text-white rounded-xl p-3 shadow-xl border border-white/10 w-44 flex flex-col justify-between">
          <div className="text-[10px] uppercase tracking-wider text-white/60 font-semibold">
            Integrity Check
          </div>
          <div className="my-1">
            <div className="text-lg font-bold text-amber-400">
              {evidenceLogs.length} capture{evidenceLogs.length === 1 ? '' : 's'}
            </div>
            <div className="text-[11px] text-white/70">Checked for location and duplicates</div>
          </div>
          <div className="text-[10px] text-white/60">
            {evidenceLogs.length === 0
              ? 'No captures yet'
              : `${mockCount} mock location · ${duplicateCount} duplicate photo`}
          </div>
        </div>

        {selectedLog && (
          <div className="bg-brand-navy/95 backdrop-blur-md text-white rounded-xl p-3 shadow-xl border border-white/10 w-64 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-white/70 font-semibold">
                Site Pin ·{' '}
                {selectedLog.reporterRoleName ||
                  (selectedLog.fieldPersonaType === 'INDEPENDENT_VERIFIER' ? 'Independent' : 'Field officer')}
              </span>
              <span className="text-[10px] text-white/55">
                {formatDateTimeShort(selectedLog.capturedAt)}
              </span>
            </div>
            <div className="my-1">
              <div className="text-xs font-semibold text-white truncate">
                {mediaLabel(selectedLog)} by {selectedLog.reporterName}
              </div>
              <p className="text-[11px] text-white/80 line-clamp-2 mt-0.5">
                {selectedLog.caption ||
                  (selectedLog.transcriptionStatus === 'DONE' ? selectedLog.transcript : null) ||
                  'No caption'}
              </p>
              <p className="text-[10px] text-white/70 mt-1">
                {selectedStatus?.text}
                {' · '}
                {selectedLog.signatureVerified === true
                  ? 'Signature checked'
                  : selectedLog.signatureVerified === false
                    ? 'Signature invalid'
                    : 'Unsigned'}
                {!selectedLog.integrityPassed ? ' · Failed integrity' : ''}
              </p>
            </div>
            <div className="flex items-center justify-between text-[10px] text-white/60 pt-1 border-t border-white/10">
              <span>{selectedLog.reporterName}</span>
              <span>
                {selectedLog.gpsAccuracyMeters !== null
                  ? `±${selectedLog.gpsAccuracyMeters.toFixed(1)}m GPS`
                  : 'Accuracy unknown'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
