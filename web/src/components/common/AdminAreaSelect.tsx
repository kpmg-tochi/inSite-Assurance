import React, { useMemo } from "react";
import {
  lgasOfState,
  NIGERIA_STATES,
  NIGERIA_ZONES,
  statesOfZone,
  zoneName,
  zoneOfState,
  type NigeriaZoneCode,
} from "@insite/shared";
import { CustomSelect, type CustomSelectOption } from "./CustomSelect";

/**
 * Client demo updates C1: Nigeria's zones, states and LGAs as selects (national reference data in
 * `@insite/shared`). The zone is never chosen for a project: it follows the state.
 */

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/** The six geopolitical zones; `allLabel` adds an "all" option with value "". */
export function zoneOptions(allLabel?: string): CustomSelectOption[] {
  return [...(allLabel ? [{ value: "", label: allLabel }] : []), ...NIGERIA_ZONES.map((z) => ({ value: z.code, label: z.name }))];
}

/** The states (of one zone when given), by name, with the zone as the description. */
export function stateOptions(zone?: NigeriaZoneCode | null, allLabel?: string): CustomSelectOption[] {
  const states = zone ? statesOfZone(zone) : [...NIGERIA_STATES];
  return [
    ...(allLabel ? [{ value: "", label: allLabel }] : []),
    ...[...states].sort(byName).map((s) => ({ value: s.code, label: s.name, description: zoneName(s.zone) ?? undefined })),
  ];
}

/** The LGAs of a state (FCT: area councils), by name. Empty without a state. */
export function lgaOptions(stateCode: string | null | undefined, allLabel?: string): CustomSelectOption[] {
  const lgas = stateCode ? lgasOfState(stateCode) : [];
  return [...(allLabel ? [{ value: "", label: allLabel }] : []), ...[...lgas].sort(byName).map((l) => ({ value: l.code, label: l.name }))];
}

const labelClass = "block text-xs font-semibold text-slate-700 mb-1";

/**
 * State and LGA selects for a project, with the zone shown read-only beside the state. Changing the
 * state clears the LGA. `legacyStateText` / `legacyLgaText`: what an older project recorded as free
 * text, shown under an empty select.
 */
export function AdminAreaSelect({
  stateCode,
  lgaCode,
  onStateChange,
  onLgaChange,
  stateError,
  lgaError,
  disabled,
  stateRequired = false,
  legacyStateText,
  legacyLgaText,
  idPrefix = "admin-area",
}: {
  stateCode: string;
  lgaCode: string;
  onStateChange: (stateCode: string) => void;
  onLgaChange: (lgaCode: string) => void;
  stateError?: string;
  lgaError?: string;
  disabled?: boolean;
  stateRequired?: boolean;
  legacyStateText?: string | null;
  legacyLgaText?: string | null;
  idPrefix?: string;
}) {
  const states = useMemo(() => stateOptions(null, stateRequired ? undefined : "No state"), [stateRequired]);
  const lgas = useMemo(() => lgaOptions(stateCode, "No LGA"), [stateCode]);
  const zone = zoneName(zoneOfState(stateCode));

  return (
    <>
      <div className="md:col-span-2">
        <p className={labelClass} id={`${idPrefix}-state-label`}>
          State {stateRequired && <span className="text-red-500">*</span>}
        </p>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <CustomSelect
              value={stateCode}
              onChange={(v) => {
                onStateChange(v);
                if (v !== stateCode) onLgaChange("");
              }}
              options={states}
              placeholder="Choose the state"
              ariaLabel="State"
              searchable
              disabled={disabled}
              error={stateError}
            />
          </div>
          <div className="shrink-0 w-32" aria-live="polite">
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Zone</span>
            <span className="block text-xs font-medium text-slate-800">{zone ?? "–"}</span>
          </div>
        </div>
        {!stateCode && legacyStateText && (
          <p className="mt-1 text-[11px] text-slate-500">Recorded as “{legacyStateText}”. Choose the state to file it by state and zone.</p>
        )}
      </div>
      <div className="md:col-span-2">
        <p className={labelClass} id={`${idPrefix}-lga-label`}>
          Local government area
        </p>
        <CustomSelect
          value={lgaCode}
          onChange={onLgaChange}
          options={lgas}
          placeholder={stateCode ? "Choose the LGA" : "Choose the state first"}
          ariaLabel="Local government area"
          searchable
          disabled={disabled || !stateCode}
          error={lgaError}
        />
        {!lgaCode && legacyLgaText && <p className="mt-1 text-[11px] text-slate-500">Recorded as “{legacyLgaText}”.</p>}
      </div>
    </>
  );
}
