import React, { useMemo } from "react";
import {
  EXISTING_CONDITION_LABELS,
  FACILITY_CRITICALITY_LABELS,
  INTERVENTION_ACTION_LABELS,
  breakdownShortfall,
  groupBreakdownByFacility,
  type FacilityBreakdownRow,
  type FacilityUnitDto,
} from "@insite/shared";
import { formatDateShort } from "../../../lib/formatters";
import { useFacilitiesQuery } from "../../../queries/facilities/useFacilityQueries";
import { useProjectSitesQuery } from "../../../queries/sites";
import { ProgressMeter } from "../../scope/ProgressMeter";
import { EmptyPanel } from "../needsUi";

/**
 * Needs pipeline wave 4 (C5): the "Facilities" tab of BoQ & work phases on a project that came from a
 * needs assessment. The current version's facilities breakdown, grouped by facility with one row per
 * site (what exists, what is needed, what this project provides, the shortfall, criticality and the
 * justification), beside each unit's live % complete (the unit whose code is the row's unit ID).
 */

const th = "px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500";
const td = "px-2 py-1.5 align-top text-xs text-slate-700";
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export function FacilitiesBreakdownTab({
  projectId,
  rows,
  units,
  live,
}: {
  projectId: string;
  rows: FacilityBreakdownRow[];
  units: FacilityUnitDto[];
  /** Progress is shown on live projects only. */
  live: boolean;
}) {
  const facilitiesQuery = useFacilitiesQuery(true);
  const sitesQuery = useProjectSitesQuery(projectId);
  const groups = useMemo(() => groupBreakdownByFacility(rows), [rows]);
  const unitByCode = useMemo(() => new Map(units.map((u) => [u.code.toUpperCase(), u])), [units]);
  const facilityName = useMemo(() => {
    const names = new Map((facilitiesQuery.data ?? []).map((f) => [f.code.toUpperCase(), f.name]));
    for (const u of units) names.set(u.facility.code.toUpperCase(), u.facility.name);
    return (code: string) => names.get(code.toUpperCase()) ?? code;
  }, [facilitiesQuery.data, units]);
  const siteName = useMemo(() => new Map((sitesQuery.data?.sites ?? []).map((s) => [s.siteNumber, s.schoolName])), [sitesQuery.data]);

  if (rows.length === 0) {
    return (
      <EmptyPanel title="No facilities breakdown">
        The needs assessment this project came from has no facilities breakdown (older template), so there is nothing to show beside the units.
      </EmptyPanel>
    );
  }

  return (
    <div
      className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
      tabIndex={0}
      role="region"
      aria-label="Facilities breakdown from the needs assessment"
    >
      <table className="w-full min-w-[1240px]">
        <caption className="px-4 py-3 text-left">
          <span className="block text-sm font-bold text-slate-900">Facilities from the needs assessment</span>
          <span className="block text-[11px] font-normal text-slate-500">
            Each facility, with one row per site. The unit ID ties a row to the facility unit it became; % complete comes from accepted monitoring visits.
          </span>
        </caption>
        <thead className="bg-slate-50">
          <tr>
            <th scope="col" className={th}>Facility / site</th>
            <th scope="col" className={th}>Unit ID</th>
            <th scope="col" className={th}>Action</th>
            <th scope="col" className={`${th} text-right`}>Existing</th>
            <th scope="col" className={th}>Condition</th>
            <th scope="col" className={`${th} text-right`}>Required</th>
            <th scope="col" className={`${th} text-right`}>Proposed</th>
            <th scope="col" className={`${th} text-right`}>Shortfall</th>
            <th scope="col" className={th}>Criticality</th>
            <th scope="col" className={th}>Justification</th>
            <th scope="col" className={`${th} w-44`}>% complete</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.facilityCode} className="border-t border-slate-200">
            <tr className="bg-slate-50/60">
              <th scope="rowgroup" colSpan={11} className="px-2 py-1.5 text-left text-xs font-bold text-slate-900">
                {facilityName(g.facilityCode)} <span className="font-normal text-slate-500">· {g.facilityCode}</span>
              </th>
            </tr>
            {g.rows.map((r) => {
              const unit = unitByCode.get(r.unitId.toUpperCase()) ?? null;
              const shortfall = breakdownShortfall(r);
              return (
                <tr key={r.unitId} className="border-t border-slate-100">
                  <th scope="row" className={`${td} font-normal`}>
                    Site {r.siteNumber}
                    {siteName.get(r.siteNumber) && <span className="block text-[11px] text-slate-500">{siteName.get(r.siteNumber)}</span>}
                  </th>
                  <td className={`${td} tabular-nums`}>{r.unitId}</td>
                  <td className={td}>{INTERVENTION_ACTION_LABELS[r.interventionAction]}</td>
                  <td className={`${td} text-right tabular-nums`}>{num(r.existingQuantity)}</td>
                  <td className={td}>{EXISTING_CONDITION_LABELS[r.existingCondition]}</td>
                  <td className={`${td} text-right tabular-nums`}>{num(r.requiredQuantity)}</td>
                  <td className={`${td} text-right tabular-nums`}>
                    {num(r.proposedQuantity)} <span className="text-slate-500">{r.unitOfMeasure}</span>
                  </td>
                  <td className={`${td} text-right tabular-nums ${shortfall > 0 ? "font-semibold text-amber-800" : ""}`}>{shortfall > 0 ? num(shortfall) : "–"}</td>
                  <td className={td}>{FACILITY_CRITICALITY_LABELS[r.criticality]}</td>
                  <td className={`${td} max-w-[260px]`}>
                    <span className="line-clamp-3" title={r.technicalJustification}>
                      {r.technicalJustification}
                    </span>
                  </td>
                  <td className={td}>
                    <UnitProgress row={r} unit={unit} live={live} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function UnitProgress({ row, unit, live }: { row: FacilityBreakdownRow; unit: FacilityUnitDto | null; live: boolean }) {
  if (row.proposedQuantity === 0) return <span className="text-slate-500">No work proposed</span>;
  if (!unit) return <span className="text-slate-500">No unit {row.unitId} on the project</span>;
  if (!live) return <span className="text-slate-500">From activation</span>;
  if (unit.progressPct === null) return <span className="text-slate-500">No accepted monitoring visit yet</span>;
  return (
    <div>
      <ProgressMeter pct={unit.progressPct} label={`${unit.code} ${unit.label} % complete`} />
      {unit.progressAsOf && <span className="text-[11px] text-slate-500">as of {formatDateShort(unit.progressAsOf)}</span>}
    </div>
  );
}
