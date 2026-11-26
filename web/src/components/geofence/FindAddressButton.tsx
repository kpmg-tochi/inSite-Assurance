import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, MapPinned, X } from 'lucide-react';
import { GEOCODE_MATCH_QUALITY_LABELS, stateByCode, type GeocodeMatchQuality, type GeocodeResult } from '@insite/shared';
import { useGeocodeSearchMutation, useGeocodeStatusQuery } from '../../api/geocode';

/** True when the workspace has the address lookup (a Google key on the server). */
export function useAddressLookupEnabled(): boolean {
  return useGeocodeStatusQuery().data?.enabled === true;
}

const QUALITY_TONE: Record<GeocodeMatchQuality, string> = {
  PLACE: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  STREET: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  AREA: 'bg-amber-50 text-amber-900 border-amber-200',
  TOWN: 'bg-amber-50 text-amber-900 border-amber-200',
};

export function MatchQualityChip({ quality }: { quality: GeocodeMatchQuality }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${QUALITY_TONE[quality]}`}>
      {GEOCODE_MATCH_QUALITY_LABELS[quality]}
    </span>
  );
}

/** What was found, how precise it is, and (for an area or town) to drag the pin to the school. */
export function FoundAddressNote({ result, moved = false }: { result: GeocodeResult; moved?: boolean }) {
  const coarse = result.quality === 'AREA' || result.quality === 'TOWN';
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600" role="status">
      <MatchQualityChip quality={result.quality} />
      <span>
        Found {result.name ? `${result.name}, ` : ''}
        {result.formattedAddress}.
      </span>
      {moved ? (
        <span className="text-slate-500">The pin was then moved by hand.</span>
      ) : coarse ? (
        <span className="font-medium text-amber-900">
          This is only the {result.quality === 'TOWN' ? 'town' : 'area'}: drag the pin to the school.
        </span>
      ) : (
        <span className="text-slate-500">Drag the pin if it is not on the school.</span>
      )}
    </p>
  );
}

export interface FindAddressButtonProps {
  /** The text to look up (school name, address, LGA, State as available). */
  query: string;
  /** The project's State: added to the text and used to keep only matches in it. */
  stateCode?: string | null;
  onPick: (result: GeocodeResult) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Client demo updates D3: "Find address". Looks the typed address up on the server (Google, Nigeria
 * only). One match fills it at once; several show a short pick list. Not shown at all when the
 * workspace has no address lookup.
 */
export function FindAddressButton({ query, stateCode = null, onPick, disabled = false, className = '' }: FindAddressButtonProps) {
  const enabled = useAddressLookupEnabled();
  const search = useGeocodeSearchMutation();
  const [choices, setChoices] = useState<GeocodeResult[] | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!choices) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setChoices(null);
    };
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setChoices(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [choices]);

  if (!enabled) return null;

  const text = query.trim();
  const run = () => {
    if (text.length < 3) {
      toast.info('Type the school name or the address first.');
      return;
    }
    setChoices(null);
    search.mutate(
      { address: text.slice(0, 300), ...(stateCode ? { stateCode } : {}) },
      {
        onSuccess: ({ results }) => {
          if (results.length === 0) {
            const where = stateByCode(stateCode)?.name;
            toast.info(
              `No match found${where ? ` in ${where}` : ''}. Paste a Google Maps link or type the coordinates instead.`
            );
          } else if (results.length === 1) {
            onPick(results[0]);
          } else {
            setChoices(results);
          }
        },
      }
    );
  };

  return (
    <div className={`relative inline-block ${className}`} ref={panelRef}>
      <button
        type="button"
        onClick={run}
        disabled={disabled || search.isPending}
        title={text ? `Look up "${text}"` : 'Type the school name or the address first'}
        className="inline-flex items-center gap-1 rounded-lg border border-brand-primary/40 bg-white px-2.5 py-1 text-xs font-semibold text-brand-primary hover:bg-brand-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {search.isPending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <MapPinned className="w-3.5 h-3.5" aria-hidden="true" />
        )}
        Find address
      </button>
      {choices && (
        <div
          role="dialog"
          aria-label="Choose the matching place"
          className="absolute left-0 z-[500] mt-1 w-[min(26rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
        >
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-[11px] font-semibold text-slate-700">{choices.length} matches: choose one</span>
            <button
              type="button"
              onClick={() => setChoices(null)}
              aria-label="Close the matches"
              className="rounded p-0.5 text-slate-500 hover:bg-slate-100"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
          <ul className="max-h-64 overflow-y-auto">
            {choices.map((r, i) => (
              <li key={`${r.latitude},${r.longitude},${i}`}>
                <button
                  type="button"
                  onClick={() => {
                    setChoices(null);
                    onPick(r);
                  }}
                  className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-slate-900">{r.name ?? r.formattedAddress}</span>
                    <MatchQualityChip quality={r.quality} />
                  </span>
                  {r.name && <span className="block truncate text-[11px] text-slate-500">{r.formattedAddress}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
