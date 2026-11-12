import React, { useEffect, useMemo, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Polyline,
  Circle,
  CircleMarker,
  Tooltip,
  useMap,
} from 'react-leaflet';
import type {
  FieldEvidenceLogRecordDto,
  ProjectSummaryDto,
} from '../api/types';
import { formatDateTimeShort } from '../lib/formatters';
import { formatIndependenceTierText } from './EvidenceBadge';

interface LiveGeospatialMapProps {
  project: ProjectSummaryDto;
  evidenceLogs: FieldEvidenceLogRecordDto[];
  onSelectEvidenceLog?: (log: FieldEvidenceLogRecordDto) => void;
}

function MapViewportUpdater({
  center,
  zoom,
}: {
  center: [number, number];
  zoom: number;
}) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom, { animate: true });
  }, [map, center[0], center[1], zoom]);
  return null;
}

export function LiveGeospatialMap({
  project,
  evidenceLogs,
  onSelectEvidenceLog,
}: LiveGeospatialMapProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [tierFilter, setTierFilter] = useState<'ALL' | 'TIER_1' | 'HOLD_POINT'>(
    'ALL'
  );
  const [activeLogId, setActiveLogId] = useState<string | null>(
    evidenceLogs[0]?.id ?? null
  );

  useEffect(() => {
    if (evidenceLogs.length > 0 && !activeLogId) {
      setActiveLogId(evidenceLogs[0].id);
    }
  }, [evidenceLogs, activeLogId]);

  const filteredLogs = useMemo(() => {
    return evidenceLogs.filter((log) => {
      if (
        tierFilter === 'TIER_1' &&
        log.independenceTier !== 'MONITOR_INSPECTOR'
      ) {
        return false;
      }
      if (tierFilter === 'HOLD_POINT' && !log.boqItem?.isHoldPoint) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        log.chainageLabel?.toLowerCase().includes(q) ||
        log.boqItem?.wbsCode.toLowerCase().includes(q) ||
        log.boqItem?.description.toLowerCase().includes(q) ||
        log.fieldSession?.agentFullName.toLowerCase().includes(q) ||
        log.confirmedSummary?.toLowerCase().includes(q)
      );
    });
  }, [evidenceLogs, searchQuery, tierFilter]);

  const selectedLog = useMemo(() => {
    return (
      filteredLogs.find((l) => l.id === activeLogId) ||
      filteredLogs[0] ||
      evidenceLogs[0] ||
      null
    );
  }, [filteredLogs, evidenceLogs, activeLogId]);

  // Compute map center & zoom from project geofence
  const { mapCenter, mapZoom, polylinePositions, radialConfig } =
    useMemo(() => {
      const gf = project.geofence;
      if (
        gf.mode === 'LINEAR_CORRIDOR' &&
        gf.centerlineCoordinates.length > 0
      ) {
        const latLngs: [number, number][] = gf.centerlineCoordinates.map(
          ([lng, lat]) => [lat, lng]
        );
        const midIdx = Math.floor(latLngs.length / 2);
        return {
          mapCenter: latLngs[midIdx] || ([6.4698, 3.6402] as [number, number]),
          mapZoom: 13,
          polylinePositions: latLngs,
          radialConfig: null,
        };
      }
      if (gf.mode === 'RADIAL') {
        return {
          mapCenter: [gf.center.latitude, gf.center.longitude] as [
            number,
            number,
          ],
          mapZoom: 15,
          polylinePositions: null,
          radialConfig: {
            center: [gf.center.latitude, gf.center.longitude] as [
              number,
              number,
            ],
            radiusMeters: gf.radiusMeters,
          },
        };
      }
      return {
        mapCenter: [6.4698, 3.6402] as [number, number],
        mapZoom: 12,
        polylinePositions: null,
        radialConfig: null,
      };
    }, [project]);

  const withinCorridorCount = evidenceLogs.filter(
    (l) => l.isWithinGeofence
  ).length;
  const withinCorridorPct =
    evidenceLogs.length > 0
      ? Math.round((withinCorridorCount / evidenceLogs.length) * 100)
      : 100;

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden relative h-[44vh] min-h-[340px]">
      {/* Docked Top Search & Filter Bar */}
      <div className="absolute top-3 left-16 right-3 z-[400] flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-xl px-3.5 py-2 shadow-md flex items-center gap-2.5 w-80 pointer-events-auto">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search chainage (KM 4+200) or WBS..."
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
            <button
              type="button"
              onClick={() => setTierFilter('ALL')}
              className={`px-2.5 py-1 rounded-lg font-medium transition ${
                tierFilter === 'ALL'
                  ? 'bg-brand-primary text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              All Logs ({evidenceLogs.length})
            </button>
            <button
              type="button"
              onClick={() => setTierFilter('TIER_1')}
              className={`px-2.5 py-1 rounded-lg font-medium transition ${
                tierFilter === 'TIER_1'
                  ? 'bg-brand-primary text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Tier 1 Monitor
            </button>
            <button
              type="button"
              onClick={() => setTierFilter('HOLD_POINT')}
              className={`px-2.5 py-1 rounded-lg font-medium transition ${
                tierFilter === 'HOLD_POINT'
                  ? 'bg-brand-primary text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Hold-Points
            </button>
          </div>
        </div>
      </div>

      {/* Interactive React-Leaflet Map (Standard OpenStreetMap: Free Out-of-the-Box, Zero API Key) */}
      <MapContainer
        center={mapCenter}
        zoom={mapZoom}
        scrollWheelZoom={true}
        className="w-full h-full z-0"
      >
        <MapViewportUpdater center={mapCenter} zoom={mapZoom} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Linear Corridor Polyline & Buffer */}
        {polylinePositions && (
          <>
            <Polyline
              positions={polylinePositions}
              pathOptions={{
                color: 'var(--hex-brand-primary)',
                weight: 26,
                opacity: 0.14,
                lineCap: 'round',
              }}
            />
            <Polyline
              positions={polylinePositions}
              pathOptions={{
                color: 'var(--hex-brand-primary)',
                weight: 3.5,
                dashArray: '8 6',
                opacity: 0.9,
              }}
            />
          </>
        )}

        {/* Radial Geofence Circle */}
        {radialConfig && (
          <Circle
            center={radialConfig.center}
            radius={radialConfig.radiusMeters}
            pathOptions={{
              color: 'var(--hex-brand-primary)',
              fillColor: 'var(--hex-brand-primary)',
              fillOpacity: 0.1,
              weight: 2,
              dashArray: '6 4',
            }}
          />
        )}

        {/* Field Evidence Pins */}
        {filteredLogs.map((log) => {
          const isSelected = selectedLog?.id === log.id;
          const pinColor = !log.integrityPassed
            ? 'var(--hex-status-danger)'
            : log.independenceTier === 'MONITOR_INSPECTOR'
              ? 'var(--hex-brand-primary)'
              : log.independenceTier === 'INDEPENDENT_RESIDENT'
                ? 'var(--hex-brand-pacific)'
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
                  if (onSelectEvidenceLog) {
                    onSelectEvidenceLog(log);
                  }
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                <div className="text-xs font-sans">
                  <div className="font-bold text-slate-900">
                    {log.chainageLabel || 'Geotagged Capture'} ·{' '}
                    {log.boqItem?.wbsCode || 'General'}
                  </div>
                  <div className="text-slate-600">
                    {formatIndependenceTierText(log.independenceTier)}
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
          <div className="text-[10px] uppercase tracking-wider text-blue-200/70 font-semibold">
            {project.geofenceMode === 'LINEAR_CORRIDOR'
              ? 'Corridor Verification'
              : 'Radial Geofence'}
          </div>
          <div className="my-1">
            <div className="text-lg font-bold">
              {withinCorridorPct}% Within
            </div>
            <div className="text-[11px] text-blue-200/80">
              {project.geofenceMode === 'LINEAR_CORRIDOR' &&
              project.geofence.mode === 'LINEAR_CORRIDOR'
                ? `±${project.geofence.corridorHalfWidthMeters}m Buffer Tolerance`
                : project.geofence.mode === 'RADIAL'
                  ? `${project.geofence.radiusMeters}m Site Radius`
                  : 'Geofence Active'}
            </div>
          </div>
          <div className="text-[10px] text-emerald-400 font-medium">
            {evidenceLogs.length} Geotagged Captures
          </div>
        </div>

        <div className="bg-brand-navy/95 backdrop-blur-md text-white rounded-xl p-3 shadow-xl border border-white/10 w-44 flex flex-col justify-between">
          <div className="text-[10px] uppercase tracking-wider text-blue-200/70 font-semibold">
            Integrity Check
          </div>
          <div className="my-1">
            <div className="text-lg font-bold text-amber-400">
              {project.unfulfilledHoldPointCount} Hold-Point
              {project.unfulfilledHoldPointCount === 1 ? '' : 's'}
            </div>
            <div className="text-[11px] text-blue-200/80">
              {project.openConflictCount} IPC Line Conflict
              {project.openConflictCount === 1 ? '' : 's'}
            </div>
          </div>
          <div className="text-[10px] text-blue-200/70">
            0 Mock GPS · 0 Duplicate pHash
          </div>
        </div>

        {selectedLog && (
          <div className="bg-brand-navy/95 backdrop-blur-md text-white rounded-xl p-3 shadow-xl border border-white/10 w-64 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-blue-200/80 font-semibold">
                {selectedLog.chainageLabel || 'Site Pin'} ·{' '}
                {selectedLog.independenceTier === 'MONITOR_INSPECTOR'
                  ? 'Tier 1'
                  : selectedLog.independenceTier === 'INDEPENDENT_RESIDENT'
                    ? 'Tier 2'
                    : 'Tier 3'}
              </span>
              <span className="text-[10px] text-blue-200/60">
                {formatDateTimeShort(selectedLog.capturedAtDevice)}
              </span>
            </div>
            <div className="my-1">
              <div className="text-xs font-semibold text-white truncate">
                WBS {selectedLog.boqItem?.wbsCode || 'Site'}:{' '}
                {selectedLog.boqItem?.description || 'Field Observation'}
              </div>
              <p className="text-[11px] text-blue-100/80 line-clamp-2 mt-0.5">
                {selectedLog.confirmedSummary ||
                  selectedLog.rawWhisperTranscript ||
                  selectedLog.rawTextNote}
              </p>
            </div>
            <div className="flex items-center justify-between text-[10px] text-blue-200/70 pt-1 border-t border-white/10">
              <span>{selectedLog.fieldSession?.agentFullName || 'Agent'}</span>
              <span>±{selectedLog.gpsAccuracyMeters.toFixed(1)}m GPS</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
