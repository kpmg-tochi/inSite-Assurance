import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { divIcon, latLng, latLngBounds, type LeafletEvent, type Marker as LeafletMarker } from 'leaflet';
import { CircleDot, ClipboardPaste, Hexagon, Maximize2, Trash2, Undo2 } from 'lucide-react';
import {
  GEOFENCE_MODE_META,
  PERIMETER_MAX_VERTICES,
  ProjectGeofenceSchema,
  type GeocodeResult,
  type GeofenceMode,
  type ProjectGeofence,
  type ProjectGeofenceInput,
} from '@insite/shared';
import { GeofenceShapeLayers } from './GeofenceShapeLayers';
import {
  NEUTRAL_BOUNDS,
  openRingLonLat,
  paddedGeofenceBounds,
  pointEastOf,
  toLatLng,
  type LatLngTuple,
  type LonLat,
} from './geofenceGeometry';
import { formatCoordinateLines, parseCoordinates } from './parseCoordinates';
import { FindAddressButton, FoundAddressNote, useAddressLookupEnabled } from './FindAddressButton';

export interface GeofenceEditorProps {
  value: ProjectGeofenceInput | null;
  onChange: (next: ProjectGeofenceInput | null) => void;
  /** Tenant setting; only these mode cards are selectable. */
  enabledModes: GeofenceMode[];
  /** The project's saved mode, kept selectable even if the tenant disabled it later. */
  lockedMode?: GeofenceMode | null;
  /** Draw a dashed tolerance band around the shape when > 0. */
  toleranceMeters?: number;
  /** Workspace default radius: a new radial boundary starts with it (the project can change it). */
  defaultRadiusMeters?: number;
  disabled?: boolean;
  /** Server or field error shown under the editor. */
  error?: string | null;
  /**
   * Client demo updates D3: "Find address" above the map, pre-filled with this text (editable).
   * Shown only when the workspace has the address lookup.
   */
  findAddress?: { query: string; stateCode: string | null };
}

// Redesign: linear corridors were removed; a site is radial or a perimeter.
const MODE_ORDER: GeofenceMode[] = ['RADIAL', 'PERIMETER'];
const MODE_ICON: Record<GeofenceMode, React.ComponentType<{ className?: string }>> = {
  RADIAL: CircleDot,
  PERIMETER: Hexagon,
};

/** Editing state. Numbers stay as typed text so an empty field is empty, not 0. */
interface Draft {
  mode: GeofenceMode | null;
  center: LonLat | null;
  radius: string;
  points: LonLat[];
  label: string;
}

const numText = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? String(n) : '');
const toNumber = (s: string) => (s.trim() === '' ? Number.NaN : Number(s));

function emptyDraft(mode: GeofenceMode | null, label = '', defaultRadius?: number): Draft {
  return { mode, center: null, radius: mode === 'RADIAL' && defaultRadius ? String(defaultRadius) : '', points: [], label };
}

function draftFromValue(value: ProjectGeofenceInput | null, fallbackMode: GeofenceMode | null, defaultRadius?: number): Draft {
  if (!value) return emptyDraft(fallbackMode, '', defaultRadius);
  switch (value.mode) {
    case 'RADIAL':
      return {
        ...emptyDraft('RADIAL', value.siteLabel ?? ''),
        center: value.center ? [value.center.longitude, value.center.latitude] : null,
        radius: numText(value.radiusMeters),
      };
    case 'PERIMETER':
      return {
        ...emptyDraft('PERIMETER', value.siteLabel ?? ''),
        points: openRingLonLat((value.perimeterCoordinates ?? []) as LonLat[]),
      };
    default:
      return emptyDraft(fallbackMode, '', defaultRadius);
  }
}

/** The value handed to the parent: null until a point exists. It may still fail the schema. */
function draftToInput(d: Draft): ProjectGeofenceInput | null {
  const label = d.label.trim();
  switch (d.mode) {
    case 'RADIAL':
      if (!d.center) return null;
      return {
        mode: 'RADIAL',
        center: { latitude: d.center[1], longitude: d.center[0] },
        radiusMeters: toNumber(d.radius),
        ...(label ? { siteLabel: label } : {}),
      };
    case 'PERIMETER':
      if (d.points.length === 0) return null;
      return {
        mode: 'PERIMETER',
        perimeterCoordinates: d.points,
        ...(label ? { siteLabel: label } : {}),
      };
    default:
      return null;
  }
}

const hasShape = (d: Draft) => d.center !== null || d.points.length > 0;

type SafeParseFailure = Extract<ReturnType<typeof ProjectGeofenceSchema.safeParse>, { success: false }>;
type Issue = SafeParseFailure['error']['issues'][number];

const FIELD_NAMES: Record<string, { name: string; unit?: string }> = {
  radiusMeters: { name: 'radius', unit: 'm' },
};

/** First schema issue in plain words. */
function describeIssue(issue: Issue): string {
  const key = String(issue.path[0] ?? '');
  const field = FIELD_NAMES[key];
  if (field) {
    if (issue.code === 'invalid_type') return `Enter the ${field.name} in metres.`;
    if (issue.code === 'too_small') {
      return `The ${field.name} must be at least ${Number(issue.minimum).toLocaleString()} ${field.unit}.`;
    }
    if (issue.code === 'too_big') {
      return `The ${field.name} can be at most ${Number(issue.maximum).toLocaleString()} ${field.unit}.`;
    }
  }
  if (key === 'siteLabel') {
    return issue.code === 'too_big' ? 'The label can be at most 120 characters.' : 'The label cannot be empty.';
  }
  if (key === 'center' || key === 'perimeterCoordinates') {
    if (issue.code === 'custom') return issue.message;
    return 'A point is outside the valid range (latitude -90 to 90, longitude -180 to 180).';
  }
  return issue.message;
}

// Handles are div icons so they do not depend on Leaflet's image assets.
const handle = (fill: string, size: number, ring = '#ffffff') =>
  divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${fill};border:2px solid ${ring};box-shadow:0 1px 3px rgba(15,23,42,.45)"></div>`,
  });
const CENTRE_ICON = handle('var(--hex-brand-primary)', 16);
const RADIUS_ICON = handle('#ffffff', 14, 'var(--hex-brand-primary)');
const VERTEX_ICON = handle('var(--hex-brand-primary)', 12);
const FIRST_VERTEX_ICON = handle('#ffffff', 14, 'var(--hex-brand-primary)');

function MapClicks({ onClick, enabled }: { onClick: (p: LonLat) => void; enabled: boolean }) {
  useMapEvents({
    click(e) {
      if (!enabled) return;
      const p = e.latlng.wrap();
      onClick([Number(p.lng.toFixed(7)), Number(p.lat.toFixed(7))]);
    },
  });
  return null;
}

function FitView({ bounds, fitKey }: { bounds: [LatLngTuple, LatLngTuple] | null; fitKey: number }) {
  const map = useMap();
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  useEffect(() => {
    if (fitKey === 0 || !boundsRef.current) return;
    map.fitBounds(boundsRef.current, { padding: [28, 28], maxZoom: 17 });
  }, [map, fitKey]);
  return null;
}

const markerLonLat = (e: LeafletEvent): LonLat => {
  const p = (e.target as LeafletMarker).getLatLng().wrap();
  return [Number(p.lng.toFixed(7)), Number(p.lat.toFixed(7))];
};

const inputClass =
  'w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-brand-primary disabled:bg-slate-50 disabled:text-slate-500';
const labelClass = 'block text-[11px] font-semibold text-slate-700 mb-1';
const toolButton =
  'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent';

export function GeofenceEditor({
  value,
  onChange,
  enabledModes,
  lockedMode = null,
  toleranceMeters = 0,
  defaultRadiusMeters,
  disabled = false,
  error = null,
  findAddress,
}: GeofenceEditorProps): JSX.Element {
  const selectable = (m: GeofenceMode) => enabledModes.includes(m) || m === lockedMode;
  const initialMode = (): GeofenceMode | null =>
    value?.mode ?? lockedMode ?? (enabledModes.length === 1 ? enabledModes[0] : null);

  const [draft, setDraft] = useState<Draft>(() => draftFromValue(value, initialMode(), defaultRadiusMeters));
  const draftRef = useRef(draft);
  const lastEmitted = useRef(JSON.stringify(value ?? null));
  const [fitKey, setFitKey] = useState(0);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  /** Where the radius handle is while being dragged, so the map does not fight the drag. */
  const [radiusDragPos, setRadiusDragPos] = useState<LatLngTuple | null>(null);
  /** D3: the text to look up (follows the suggested text until the user edits it). */
  const lookupEnabled = useAddressLookupEnabled();
  const [lookupText, setLookupText] = useState<string | null>(null);
  const [found, setFound] = useState<{ result: GeocodeResult; moved: boolean } | null>(null);
  /** Where to fit the map after a lookup on a perimeter (the shape is left alone). */
  const [focusBounds, setFocusBounds] = useState<[LatLngTuple, LatLngTuple] | null>(null);

  // Adopt a value set from outside (e.g. loaded from the server); ignore our own echoes.
  useEffect(() => {
    const s = JSON.stringify(value ?? null);
    if (s === lastEmitted.current) return;
    lastEmitted.current = s;
    const next = draftFromValue(value, draftRef.current.mode, defaultRadiusMeters);
    draftRef.current = next;
    setDraft(next);
    setFitKey((k) => k + 1);
  }, [value, defaultRadiusMeters]);

  const commit = (update: (d: Draft) => Draft) => {
    const next = update(draftRef.current);
    draftRef.current = next;
    setDraft(next);
    const out = draftToInput(next);
    lastEmitted.current = JSON.stringify(out);
    onChange(out);
  };

  const input = useMemo(() => draftToInput(draft), [draft]);
  const parsed = useMemo(() => (input ? ProjectGeofenceSchema.safeParse(input) : null), [input]);
  const validShape: ProjectGeofence | null = parsed?.success ? parsed.data : null;
  const issueText = parsed && !parsed.success ? describeIssue(parsed.error.issues[0]) : null;
  const tolerance = Math.max(0, toleranceMeters || 0);

  /** Enough geometry to draw the shape, even if the schema still rejects it (e.g. a crossing). */
  const drawable: ProjectGeofence | null = useMemo(() => {
    if (validShape) return validShape;
    const radius = toNumber(draft.radius);
    if (draft.mode === 'RADIAL' && draft.center && radius > 0) {
      return { mode: 'RADIAL', center: { latitude: draft.center[1], longitude: draft.center[0] }, radiusMeters: radius };
    }
    if (draft.mode === 'PERIMETER' && draft.points.length >= 3) {
      return { mode: 'PERIMETER', perimeterCoordinates: draft.points };
    }
    return null;
  }, [validShape, draft]);

  const viewBounds = useMemo((): [LatLngTuple, LatLngTuple] | null => {
    if (validShape) return paddedGeofenceBounds(validShape, tolerance);
    const pts: LonLat[] = draft.center ? [draft.center] : draft.points;
    if (pts.length === 0) return null;
    const b = latLngBounds(pts.map(toLatLng));
    // A single point: show roughly a kilometre around it.
    const padded = pts.length === 1 ? b.getCenter().toBounds(1000) : b;
    return [
      [padded.getSouth(), padded.getWest()],
      [padded.getNorth(), padded.getEast()],
    ];
  }, [validShape, draft, tolerance]);

  const [initialBounds] = useState<[LatLngTuple, LatLngTuple]>(() => viewBounds ?? NEUTRAL_BOUNDS);

  const selectMode = (mode: GeofenceMode) => {
    if (disabled || mode === draft.mode || !selectable(mode)) return;
    if (hasShape(draft)) {
      const ok = window.confirm(
        `Switch to ${GEOFENCE_MODE_META[mode].label}? The shape you have drawn will be cleared.`
      );
      if (!ok) return;
    }
    setPasteOpen(false);
    setPasteError(null);
    commit((d) => emptyDraft(mode, d.label, defaultRadiusMeters));
  };

  const handleMapClick = (p: LonLat) => {
    if (draftRef.current.mode === 'RADIAL') markMoved();
    setFocusBounds(null);
    commit((d) => {
      if (d.mode === 'RADIAL') {
        if (d.center && d.radius.trim() === '') {
          // Second click sets the edge of the circle.
          const r = Math.round(latLng(d.center[1], d.center[0]).distanceTo(latLng(p[1], p[0])));
          return { ...d, radius: String(Math.max(1, r)) };
        }
        return { ...d, center: p };
      }
      if (d.mode === 'PERIMETER' && d.points.length >= PERIMETER_MAX_VERTICES) return d;
      return { ...d, points: [...d.points, p] };
    });
  };

  const movePoint = (index: number, p: LonLat) =>
    commit((d) => ({ ...d, points: d.points.map((q, i) => (i === index ? p : q)) }));
  const removePoint = (index: number) => commit((d) => ({ ...d, points: d.points.filter((_, i) => i !== index) }));
  const undoLast = () => {
    if (draftRef.current.mode === 'RADIAL') setFound(null);
    commit((d) => (d.mode === 'RADIAL' ? { ...d, center: null } : { ...d, points: d.points.slice(0, -1) }));
  };
  const clearShape = () => {
    if (!hasShape(draftRef.current)) return;
    if (!window.confirm('Clear the shape you have drawn?')) return;
    setFound(null);
    commit((d) => ({ ...emptyDraft(d.mode, d.label), radius: d.radius }));
  };

  const openPaste = () => {
    const pts = draft.center ? [draft.center] : draft.points;
    setPasteText(formatCoordinateLines(pts));
    setPasteError(null);
    setPasteOpen(true);
  };

  const applyPaste = () => {
    const result = parseCoordinates(pasteText);
    if (!result.ok) {
      setPasteError(result.error);
      return;
    }
    if (draft.mode === 'RADIAL' && result.points.length !== 1) {
      setPasteError('A radial geofence needs exactly one centre point.');
      return;
    }
    if (draft.mode === 'PERIMETER' && openRingLonLat(result.points).length > PERIMETER_MAX_VERTICES) {
      setPasteError(`A perimeter can have at most ${PERIMETER_MAX_VERTICES} points.`);
      return;
    }
    commit((d) =>
      d.mode === 'RADIAL'
        ? { ...d, center: result.points[0] }
        : { ...d, points: d.mode === 'PERIMETER' ? openRingLonLat(result.points) : result.points }
    );
    setPasteError(null);
    setPasteOpen(false);
    setFitKey((k) => k + 1);
  };

  /**
   * D3: a found address. A radial boundary (or none yet) gets its centre there at the current radius
   * (the workspace default when empty), and an empty label takes the place's name; a perimeter keeps
   * its corners and the map moves there so they can be drawn around the school.
   */
  const pickAddress = (r: GeocodeResult) => {
    const center: LonLat = [r.longitude, r.latitude];
    const useRadial = draftRef.current.mode === 'RADIAL' || (draftRef.current.mode === null && selectable('RADIAL'));
    if (useRadial) {
      commit((d) => ({
        ...d,
        mode: 'RADIAL',
        center,
        points: [],
        radius: d.radius.trim() !== '' ? d.radius : defaultRadiusMeters ? String(defaultRadiusMeters) : '',
        label: d.label.trim() !== '' ? d.label : (r.name ?? r.formattedAddress).slice(0, 120),
      }));
      setFocusBounds(null);
    } else {
      const b = latLng(r.latitude, r.longitude).toBounds(1000);
      setFocusBounds([
        [b.getSouth(), b.getWest()],
        [b.getNorth(), b.getEast()],
      ]);
    }
    setFound({ result: r, moved: false });
    setFitKey((k) => k + 1);
  };
  const markMoved = () => setFound((f) => (f && !f.moved ? { ...f, moved: true } : f));
  const lookupQuery = lookupText ?? findAddress?.query ?? '';

  const mode = draft.mode;
  const pointCount = mode === 'RADIAL' ? (draft.center ? 1 : 0) : draft.points.length;

  const hint = (() => {
    if (!mode) return 'Choose a geofence type to start.';
    if (mode === 'RADIAL') {
      if (!draft.center) {
        return draft.radius.trim() !== ''
          ? `Click the map to place the site centre. The radius starts at ${draft.radius} m${
              defaultRadiusMeters !== undefined && toNumber(draft.radius) === defaultRadiusMeters ? ' (the workspace default)' : ''
            }; change it below.`
          : 'Click the map to place the site centre.';
      }
      if (draft.radius.trim() === '') return 'Click the map again to set the edge of the circle, or type the radius below.';
      return 'Drag the centre or the edge handle to adjust. Clicking the map moves the centre.';
    }
    if (draft.points.length === 0) return 'Click the map to place the first corner of the site boundary.';
    if (draft.points.length < 3) {
      const left = 3 - draft.points.length;
      return `Click to add ${left} more corner${left === 1 ? '' : 's'}.`;
    }
    if (draft.points.length >= PERIMETER_MAX_VERTICES) return `Maximum of ${PERIMETER_MAX_VERTICES} corners reached.`;
    return 'Keep clicking to add corners. The dashed edge closes the boundary. Drag a corner to move it; right-click to remove it.';
  })();

  const noModesAvailable = MODE_ORDER.every((m) => !selectable(m));
  const radiusValue = toNumber(draft.radius);

  return (
    <div className="space-y-3">
      {/* Mode cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3" role="radiogroup" aria-label="Geofence type">
        {MODE_ORDER.map((m) => {
          const meta = GEOFENCE_MODE_META[m];
          const Icon = MODE_ICON[m];
          const active = mode === m;
          const canPick = selectable(m) && !disabled;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={!canPick && !active}
              onClick={() => selectMode(m)}
              className={`p-4 rounded-xl border text-left transition flex items-start gap-3 ${
                active
                  ? 'border-brand-primary bg-brand-primary/5'
                  : canPick
                    ? 'border-slate-200 hover:bg-slate-50'
                    : 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed'
              }`}
            >
              <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${active ? 'text-brand-primary' : 'text-slate-400'}`} />
              <div>
                <div className="text-xs font-bold text-slate-900">{meta.label}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{meta.description}</div>
                {!selectable(m) && (
                  <div className="text-[10px] text-slate-400 mt-1">Not enabled for your organisation</div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {noModesAvailable && (
        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          No geofence types are enabled for your organisation. An administrator can enable them in organisation
          settings.
        </p>
      )}

      {/* D3: Find address (only with the workspace address lookup) */}
      {findAddress && lookupEnabled && !disabled && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[14rem] flex-1">
              <label className={labelClass} htmlFor="geofence-lookup">
                Address to look up
              </label>
              <input
                id="geofence-lookup"
                type="text"
                maxLength={300}
                value={lookupQuery}
                onChange={(e) => setLookupText(e.target.value)}
                placeholder="School name, street, town, LGA"
                className={inputClass}
              />
            </div>
            <FindAddressButton query={lookupQuery} stateCode={findAddress.stateCode} onPick={pickAddress} />
          </div>
          {found && <FoundAddressNote result={found.result} moved={found.moved} />}
          {found && mode === 'PERIMETER' && (
            <p className="text-[11px] text-slate-500">The map moved to the address: draw the corners around the school.</p>
          )}
        </div>
      )}

      {/* Map */}
      <div className="relative rounded-xl border border-slate-200 overflow-hidden h-[380px] bg-slate-100">
        <MapContainer
          bounds={initialBounds}
          scrollWheelZoom
          className={`w-full h-full z-0 ${mode && !disabled ? '[&.leaflet-container]:cursor-crosshair' : ''}`}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapClicks onClick={handleMapClick} enabled={!!mode && !disabled} />
          <FitView bounds={focusBounds ?? viewBounds} fitKey={fitKey} />

          {drawable && <GeofenceShapeLayers geofence={drawable} toleranceMeters={tolerance} editing />}

          {/* Partial lines before the shape can be drawn */}
          {!drawable && mode !== 'RADIAL' && draft.points.length >= 2 && (
            <Polyline
              positions={draft.points.map(toLatLng)}
              pathOptions={{ color: 'var(--hex-brand-primary)', weight: 2.5, interactive: false }}
            />
          )}

          {mode === 'RADIAL' && draft.center && (
            <>
              <Marker
                position={toLatLng(draft.center)}
                icon={CENTRE_ICON}
                draggable={!disabled}
                title="Site centre"
                eventHandlers={{
                  drag: (e) => commit((d) => ({ ...d, center: markerLonLat(e) })),
                  dragend: markMoved,
                }}
              />
              {radiusValue > 0 && (
                <Marker
                  position={
                    radiusDragPos ?? pointEastOf({ latitude: draft.center[1], longitude: draft.center[0] }, radiusValue)
                  }
                  icon={RADIUS_ICON}
                  draggable={!disabled}
                  title="Drag to set the radius"
                  eventHandlers={{
                    drag: (e) =>
                      commit((d) => {
                        if (!d.center) return d;
                        const p = (e.target as LeafletMarker).getLatLng();
                        setRadiusDragPos([p.lat, p.lng]);
                        const r = Math.round(latLng(d.center[1], d.center[0]).distanceTo(p));
                        return { ...d, radius: String(Math.max(1, r)) };
                      }),
                    // Snap the handle back due east of the centre.
                    dragend: () => setRadiusDragPos(null),
                  }}
                />
              )}
            </>
          )}

          {mode !== 'RADIAL' &&
            draft.points.map((p, i) => (
              <Marker
                key={i}
                position={toLatLng(p)}
                icon={mode === 'PERIMETER' && i === 0 ? FIRST_VERTEX_ICON : VERTEX_ICON}
                draggable={!disabled}
                title={`${mode === 'PERIMETER' ? 'Corner' : 'Point'} ${i + 1}`}
                eventHandlers={{
                  drag: (e) => movePoint(i, markerLonLat(e)),
                  contextmenu: () => {
                    if (!disabled) removePoint(i);
                  },
                }}
              />
            ))}
        </MapContainer>

        {/* Hint and tools */}
        <div className="absolute top-2 left-14 right-2 z-[400] flex flex-wrap items-start justify-between gap-2 pointer-events-none">
          <div className="bg-white/95 border border-slate-200 rounded-lg px-2.5 py-1.5 shadow-sm text-[11px] text-slate-700 max-w-md pointer-events-auto">
            {hint}
          </div>
          {mode && (
            <div className="bg-white/95 border border-slate-200 rounded-lg p-0.5 shadow-sm flex items-center gap-0.5 pointer-events-auto">
              <button type="button" className={toolButton} onClick={undoLast} disabled={disabled || pointCount === 0}>
                <Undo2 className="w-3.5 h-3.5" />
                {mode === 'RADIAL' ? 'Remove centre' : 'Undo last point'}
              </button>
              <button type="button" className={toolButton} onClick={clearShape} disabled={disabled || pointCount === 0}>
                <Trash2 className="w-3.5 h-3.5" />
                Clear
              </button>
              <button
                type="button"
                className={toolButton}
                onClick={() => {
                  setFocusBounds(null);
                  setFitKey((k) => k + 1);
                }}
                disabled={!viewBounds}
                title="Zoom to the shape"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                Fit
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Fields */}
      {mode && (
        <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {mode === 'RADIAL' && (
              <div>
                <label className={labelClass} htmlFor="geofence-radius">
                  Radius (m)
                </label>
                <input
                  id="geofence-radius"
                  type="number"
                  min={20}
                  max={50000}
                  step={1}
                  value={draft.radius}
                  disabled={disabled}
                  onChange={(e) => commit((d) => ({ ...d, radius: e.target.value }))}
                  placeholder="20 to 50,000"
                  className={inputClass}
                />
              </div>
            )}
            <div className="md:col-span-2">
              <label className={labelClass} htmlFor="geofence-label">
                Site label (optional)
              </label>
              <input
                id="geofence-label"
                type="text"
                maxLength={120}
                value={draft.label}
                disabled={disabled}
                onChange={(e) => commit((d) => ({ ...d, label: e.target.value }))}
                placeholder="e.g. Main school compound"
                className={inputClass}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="text-slate-500">
              {mode === 'RADIAL'
                ? draft.center
                  ? `Centre ${draft.center[1].toFixed(6)}, ${draft.center[0].toFixed(6)} (latitude, longitude)`
                  : 'No centre placed'
                : `${pointCount} corner${pointCount === 1 ? '' : 's'}`}
              {tolerance > 0 ? ` · Dashed line shows the ${tolerance.toLocaleString()} m tolerance band` : ''}
            </span>
            {!pasteOpen && (
              <button
                type="button"
                onClick={openPaste}
                disabled={disabled}
                className="inline-flex items-center gap-1 font-semibold text-brand-primary hover:underline disabled:opacity-50 disabled:no-underline"
              >
                <ClipboardPaste className="w-3.5 h-3.5" />
                Type or paste coordinates
              </button>
            )}
          </div>

          {pasteOpen && (
            <div className="space-y-2">
              <label className={labelClass} htmlFor="geofence-coordinates">
                {mode === 'RADIAL' ? 'Centre point' : 'Boundary corners'}
              </label>
              <p className="text-[11px] text-slate-500">
                {mode === 'RADIAL' ? 'One line' : 'One line per point'} as <strong>latitude, longitude</strong> (for
                example <span className="font-mono">9.057900, 7.495100</span>), or a JSON array in GeoJSON order{' '}
                <strong>[longitude, latitude]</strong>
                {mode === 'RADIAL' ? '' : ', for example '}
                {mode !== 'RADIAL' && <span className="font-mono">[[7.4951, 9.0579], [7.5012, 9.0611]]</span>}.
                {mode === 'PERIMETER' ? ' The boundary closes automatically.' : ''}
              </p>
              <textarea
                id="geofence-coordinates"
                rows={mode === 'RADIAL' ? 2 : 6}
                value={pasteText}
                onChange={(e) => {
                  setPasteText(e.target.value);
                  setPasteError(null);
                }}
                className={`${inputClass} font-mono`}
                spellCheck={false}
              />
              {pasteError && <p className="text-[11px] text-rose-700">{pasteError}</p>}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={applyPaste}
                  className="px-3 py-1.5 rounded-lg bg-brand-primary text-white text-xs font-semibold hover:bg-brand-hover transition"
                >
                  Use these coordinates
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPasteOpen(false);
                    setPasteError(null);
                  }}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Live validation */}
      {issueText && (
        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">{issueText}</p>
      )}
      {validShape && !error && (
        <p className="text-[11px] text-emerald-800">The boundary is complete.</p>
      )}
      {error && (
        <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default GeofenceEditor;
