import React from "react";
import { Link } from "react-router-dom";
import { EyeOff } from "lucide-react";
import { INTERVENTION_ACTION_LABELS, PROPOSAL_FLAG_RESOLUTION_LABELS, type InterventionAction, type ProposalFlagDto } from "@insite/shared";
import { formatDateTimeShort } from "../../../lib/formatters";
import { money } from "../needsUi";

/**
 * Needs pipeline wave 3 (Track C): the facts a flag carries (`details`, shapes from
 * `needsFlags.service.ts`), read defensively. A duplicate match the viewer cannot open arrives
 * redacted (`hidden: true`, no code) with a `label` that is shown instead (wave 2 R2).
 */

const asRecords = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object") : []);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const MATCH_REASON: Record<string, string> = {
  SAME_SCHOOL_AND_NEARBY: "same school name, nearby",
  SAME_SCHOOL: "same school name",
  NEARBY: "nearby",
};

/** The duplicate matches: our site → the other proposal or project site (or its label when hidden). */
export function DuplicateMatches({ flag }: { flag: ProposalFlagDto }) {
  const matches = asRecords(flag.details.matches);
  if (matches.length === 0) return null;
  return (
    <ul className="mt-1.5 space-y-1 text-xs text-slate-700">
      {matches.map((m, i) => {
        const hidden = m.hidden === true;
        const id = str(m.id);
        const reference = str(m.reference);
        const isProposal = m.kind === "PROPOSAL";
        const distance = numOrNull(m.distanceMeters);
        const target = hidden ? (
          <span className="inline-flex items-center gap-1 italic text-slate-600">
            <EyeOff className="h-3 w-3" aria-hidden="true" />
            {str(m.label) ?? (isProposal ? "a proposed project you cannot open" : "a project you cannot open")}
          </span>
        ) : id && reference ? (
          <Link
            className="font-semibold text-brand-primary hover:underline"
            to={isProposal ? `/app/needs-assessment/proposals/${id}` : `/app/projects/${id}/dashboard`}
          >
            {isProposal ? reference : `project ${reference}`}
          </Link>
        ) : (
          <span>{reference ?? "another record"}</span>
        );
        return (
          <li key={i} className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="font-medium text-slate-900">
              Site {numOrNull(m.siteNumber) ?? "?"}
              {str(m.schoolName) ? ` (${str(m.schoolName)})` : ""}
            </span>
            <span>matches</span>
            {target}
            {!hidden && str(m.matchedSchoolName) && <span className="text-slate-500">· {str(m.matchedSchoolName)}</span>}
            <span className="text-slate-500">
              · {MATCH_REASON[String(m.reason)] ?? "possible match"}
              {distance !== null ? `, ${Math.round(distance)} m apart` : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Essential groups missing per site. */
export function EssentialGaps({ flag }: { flag: ProposalFlagDto }) {
  const gaps = asRecords(flag.details.gaps);
  if (gaps.length === 0) return null;
  const bySite = new Map<string, string[]>();
  for (const g of gaps) {
    const site = `Site ${numOrNull(g.siteNumber) ?? "?"}${str(g.schoolName) ? ` (${str(g.schoolName)})` : ""}`;
    bySite.set(site, [...(bySite.get(site) ?? []), str(g.groupLabel) ?? "a group"]);
  }
  return (
    <ul className="mt-1.5 space-y-0.5 text-xs text-slate-700">
      {[...bySite.entries()].map(([site, groups]) => (
        <li key={site}>
          <span className="font-medium text-slate-900">{site}</span>: {groups.join(", ")} missing
        </li>
      ))}
    </ul>
  );
}

/** Lines whose rate is outside the tolerance (as stored on the flag). */
export function RateVarianceList({ flag }: { flag: ProposalFlagDto }) {
  const variances = asRecords(flag.details.variances);
  if (variances.length === 0) return null;
  const tolerance = numOrNull(flag.details.tolerancePct);
  return (
    <div className="mt-1.5 text-xs text-slate-700">
      {tolerance !== null && <p className="text-slate-500">Tolerance ±{tolerance}% of the standard's rate for the zone.</p>}
      <ul className="mt-1 space-y-0.5">
        {variances.map((v, i) => {
          const pct = numOrNull(v.variancePct);
          return (
            <li key={i} className="tabular-nums">
              <span className="font-medium text-slate-900">Item {str(v.wbsCode) ?? "?"}</span> ({str(v.itemCode) ?? "–"}): {money(numOrNull(v.rateNgn))} against{" "}
              {money(numOrNull(v.standardRateNgn))}
              {pct !== null && (
                <span className="font-semibold text-amber-800">
                  {" "}
                  ({pct > 0 ? "+" : ""}
                  {pct}%)
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Units whose cost per unit is above the standard's ceiling. */
export function CeilingBreachList({ flag, facilityName }: { flag: ProposalFlagDto; facilityName: (code: string) => string }) {
  const breaches = asRecords(flag.details.breaches);
  if (breaches.length === 0) return null;
  return (
    <ul className="mt-1.5 space-y-0.5 text-xs text-slate-700">
      {breaches.map((b, i) => {
        const action = str(b.interventionAction) as InterventionAction | null;
        return (
          <li key={i} className="tabular-nums">
            <span className="font-medium text-slate-900">
              Unit {str(b.unitId) ?? "?"} · {facilityName(str(b.facilityCode) ?? "")}
            </span>
            {action && INTERVENTION_ACTION_LABELS[action] ? ` (${INTERVENTION_ACTION_LABELS[action]})` : ""}: {money(numOrNull(b.costPerUnitNgn))} a unit against a
            ceiling of {money(numOrNull(b.ceilingNgn))}
            {numOrNull(b.excessPct) !== null && <span className="font-semibold text-amber-800"> (+{numOrNull(b.excessPct)}%)</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** "Resolved as Not a duplicate by Ada, 27 Nov 2026: reason" or "Open since …". */
export function FlagResolutionText({ flag }: { flag: ProposalFlagDto }) {
  if (!flag.resolved) return <span className="text-amber-800">Open since {formatDateTimeShort(flag.raisedAt)}</span>;
  return (
    <span className="text-slate-600">
      {flag.resolution ? PROPOSAL_FLAG_RESOLUTION_LABELS[flag.resolution] : "Resolved"}
      {flag.resolvedByName ? ` by ${flag.resolvedByName}` : ""}
      {flag.resolvedAt ? `, ${formatDateTimeShort(flag.resolvedAt)}` : ""}
      {flag.resolutionReason ? `: ${flag.resolutionReason}` : ""}
    </span>
  );
}
