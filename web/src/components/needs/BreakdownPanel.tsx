import React, { useMemo } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  EXISTING_CONDITION_LABELS,
  FACILITY_CRITICALITY_LABELS,
  INTERVENTION_ACTION_LABELS,
  breakdownShortfall,
  breakdownTotals,
  essentialFacilityGaps,
  groupBreakdownByFacility,
  type EssentialFacilityGroup,
  type FacilityBreakdownRow,
  type ProposalFlagDto,
  type ProposalSite,
} from "@insite/shared";
import { EmptyPanel, money } from "./needsUi";

/**
 * Needs pipeline wave 2 (C5): the intervention and facilities breakdown of the current version (plan
 * 6.3), grouped by facility with one sub-row per site (`groupBreakdownByFacility`), the shortfall
 * (required − proposed) and, per site, the essential facility check (D-N.17: a proposed row or an
 * existing Functional one in each essential group) worked out here from the cycle's groups.
 */

const th = "px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500";
const td = "px-2 py-1.5 align-top text-xs text-slate-700";
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export function BreakdownPanel({
  rows,
  sites,
  essentialGroups,
  facilityName,
  flags,
}: {
  rows: FacilityBreakdownRow[];
  sites: ProposalSite[];
  essentialGroups: EssentialFacilityGroup[];
  facilityName: (code: string) => string;
  flags: ProposalFlagDto[];
}) {
  const groups = useMemo(() => groupBreakdownByFacility(rows), [rows]);
  const totals = useMemo(() => breakdownTotals(rows), [rows]);
  const siteName = useMemo(() => new Map(sites.map((s) => [s.siteNumber, s.schoolName])), [sites]);
  const gaps = useMemo(() => essentialFacilityGaps(rows, sites, essentialGroups), [rows, sites, essentialGroups]);
  const gapFlag = flags.find((f) => f.kind === "ESSENTIAL_FACILITY_GAP");

  if (rows.length === 0) {
    return (
      <EmptyPanel title="No intervention and facilities breakdown">
        This version has no breakdown rows. Files made from the older template carry none; upload a new version from the current template to add them.
      </EmptyPanel>
    );
  }

  return (
    <div className="space-y-4">
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <Fact label="Facilities" value={String(totals.facilityCount)} />
        <Fact label="Sites" value={String(totals.siteCount)} />
        <Fact label="Rows" value={String(totals.rowCount)} />
        <Fact label="Rows with work" value={String(totals.proposedRowCount)} />
        <Fact label="Rows with a shortfall" value={String(totals.rowsWithShortfall)} />
        <Fact label="Preliminary cost" value={money(totals.preliminaryCostNgn)} />
      </dl>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary" tabIndex={0} role="region" aria-label="Intervention and facilities breakdown">
        <table className="w-full min-w-[1200px]">
          <caption className="sr-only">Facilities, each with one row per site</caption>
          <thead className="bg-slate-50">
            <tr>
              <th scope="col" className={th}>Facility / site</th>
              <th scope="col" className={th}>Action</th>
              <th scope="col" className={`${th} text-right`}>Existing</th>
              <th scope="col" className={th}>Condition</th>
              <th scope="col" className={`${th} text-right`}>Required</th>
              <th scope="col" className={`${th} text-right`}>Proposed</th>
              <th scope="col" className={`${th} text-right`}>Shortfall</th>
              <th scope="col" className={th}>Unit</th>
              <th scope="col" className={`${th} text-right`}>Preliminary cost</th>
              <th scope="col" className={th}>Criticality</th>
              <th scope="col" className={th}>Justification</th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.facilityCode} className="border-t border-slate-200">
              <tr className="bg-slate-50/60">
                <th scope="rowgroup" colSpan={2} className="px-2 py-1.5 text-left text-xs font-bold text-slate-900">
                  {facilityName(g.facilityCode)}
                  <span className="ml-1 font-normal text-slate-500">
                    · {g.facilityCode} · {g.siteCount} site{g.siteCount === 1 ? "" : "s"}
                  </span>
                </th>
                <td className={`${td} text-right font-semibold tabular-nums text-slate-900`}>{num(g.existingQuantity)}</td>
                <td className={td} />
                <td className={`${td} text-right font-semibold tabular-nums text-slate-900`}>{num(g.requiredQuantity)}</td>
                <td className={`${td} text-right font-semibold tabular-nums text-slate-900`}>{num(g.proposedQuantity)}</td>
                <td className={`${td} text-right font-semibold tabular-nums ${g.shortfall > 0 ? "text-amber-800" : "text-slate-900"}`}>{num(g.shortfall)}</td>
                <td className={td} />
                <td className={`${td} text-right font-semibold tabular-nums text-slate-900`}>{money(g.preliminaryCostNgn)}</td>
                <td className={td} colSpan={2} />
              </tr>
              {g.rows.map((r) => {
                const shortfall = breakdownShortfall(r);
                return (
                  <tr key={r.unitId} className="border-t border-slate-100">
                    <td className={`${td} pl-5`}>
                      <span className="font-medium text-slate-900">Site {r.siteNumber}</span>
                      {siteName.get(r.siteNumber) && <span className="block text-[11px] text-slate-500">{siteName.get(r.siteNumber)}</span>}
                      <span className="block text-[10px] text-slate-400">Unit {r.unitId}</span>
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{INTERVENTION_ACTION_LABELS[r.interventionAction]}</td>
                    <td className={`${td} text-right tabular-nums`}>{num(r.existingQuantity)}</td>
                    <td className={`${td} whitespace-nowrap`}>{EXISTING_CONDITION_LABELS[r.existingCondition]}</td>
                    <td className={`${td} text-right tabular-nums`}>{num(r.requiredQuantity)}</td>
                    <td className={`${td} text-right tabular-nums`}>{num(r.proposedQuantity)}</td>
                    <td className={`${td} text-right tabular-nums ${shortfall > 0 ? "font-semibold text-amber-800" : ""}`}>{num(shortfall)}</td>
                    <td className={td}>{r.unitOfMeasure}</td>
                    <td className={`${td} text-right tabular-nums whitespace-nowrap`}>{money(r.preliminaryCostNgn)}</td>
                    <td className={`${td} whitespace-nowrap`}>{FACILITY_CRITICALITY_LABELS[r.criticality]}</td>
                    <td className={`${td} min-w-[220px]`}>
                      {r.technicalJustification}
                      {r.supportingEvidence && <span className="block text-[11px] text-slate-500">Evidence: {r.supportingEvidence}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>

      {essentialGroups.length > 0 && (
        <section aria-labelledby="essential-check" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 id="essential-check" className="text-sm font-bold text-slate-900">
            Essential facilities at every site
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Each site needs work proposed, or an existing facility in Functional condition, in every essential group.
            {gapFlag && (gapFlag.resolved ? ` The flag was resolved${gapFlag.resolutionReason ? `: ${gapFlag.resolutionReason}` : ""}.` : " The gap is flagged for validation.")}
          </p>
          <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label="Essential facility check by site">
            <table className="w-full min-w-[480px]">
              <thead>
                <tr>
                  <th scope="col" className={th}>Site</th>
                  {essentialGroups.map((g) => (
                    <th key={g.label} scope="col" className={th}>
                      {g.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sites.map((s) => (
                  <tr key={s.siteNumber}>
                    <th scope="row" className={`${td} text-left font-medium text-slate-900`}>
                      Site {s.siteNumber} · {s.schoolName}
                    </th>
                    {essentialGroups.map((g) => {
                      const missing = gaps.some((gap) => gap.siteNumber === s.siteNumber && gap.groupLabel === g.label);
                      return (
                        <td key={g.label} className={td}>
                          {missing ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-amber-800">
                              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Missing
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-emerald-800">
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Covered
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}
