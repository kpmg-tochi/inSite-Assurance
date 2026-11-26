import React from "react";
import { AlertTriangle, CalendarRange, CheckCircle2, Clock, Info } from "lucide-react";
import type { ProjectScopeDto } from "@insite/shared";
import { formatDateShort, formatNaira } from "../../lib/formatters";
import { ScopeWorkbookToolbar, quietButton } from "./ScopeWorkbookToolbar";
import { ProgressMeter, formatProgressPct } from "./ProgressMeter";
import { countOf } from "./ScopeUnitsTable";

/**
 * Design refinement (2026-11-26): the head of BoQ & work phases. Three figures side by side (BoQ
 * total against the budget, project % complete on live projects, where the work phases stand), the
 * needs assessment and work phase tools as quiet buttons, and one short line about the audit ledger.
 */

function Figure({ label, value, children }: { label: string; value: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <p className="mt-0.5 text-2xl font-bold tracking-tight tabular-nums text-slate-900">{value}</p>
      {children}
    </div>
  );
}

export function ScopeSummary({
  projectId,
  scope,
  live,
  readOnly,
  onEditSprints,
  onShowSprints,
}: {
  projectId: string;
  scope: ProjectScopeDto;
  live: boolean;
  readOnly: boolean;
  onEditSprints: () => void;
  /** Opens the Work phases tab (the "to verify" link). */
  onShowSprints: () => void;
}) {
  const sprints = scope.sprints;

  // WEB-DEMO1-09: progress on live projects only (on a draft every figure is 0).
  const latestProgressAsOf = scope.units.reduce<string | null>(
    (max, u) => (u.progressAsOf && (!max || u.progressAsOf > max) ? u.progressAsOf : max),
    null,
  );
  const progressNote =
    scope.totals.lineCount === 0
      ? scope.progressPct > 0
        ? "Reported at import"
        : "No BoQ lines yet"
      : latestProgressAsOf
        ? `As of the monitoring visit of ${formatDateShort(latestProgressAsOf)}`
        : "No monitoring report accepted yet";

  // Work phases at a glance.
  const active = sprints.find((s) => s.status === "ACTIVE") ?? null;
  const next = sprints.find((s) => s.status === "UPCOMING") ?? null;
  const toVerify = sprints.filter((s) => s.status === "ENDED" && !s.verificationOutcome).length;
  const late = sprints.filter((s) => s.status === "LATE").length;
  const verified = sprints.filter((s) => s.status === "VERIFIED").length;
  const span = sprints.length ? `${formatDateShort(sprints[0].startDate)} – ${formatDateShort(sprints[sprints.length - 1].endDate)}` : null;

  let phaseLabel = "Work phases";
  let phaseValue: React.ReactNode = sprints.length ? String(sprints.length) : "None yet";
  let phaseNote: string | null = span ?? "Add the work phases to plan the units";
  if (live && sprints.length) {
    if (active) {
      phaseLabel = "Current work phase";
      phaseValue = `${active.number} of ${sprints.length}`;
      phaseNote = `${active.name} · ends ${formatDateShort(active.endDate)}`;
    } else if (next && next.number === 1) {
      phaseValue = "Not started";
      phaseNote = `Work phase 1 starts ${formatDateShort(next.startDate)}`;
    } else if (next) {
      phaseValue = "Between phases";
      phaseNote = `Work phase ${next.number} starts ${formatDateShort(next.startDate)}`;
    } else {
      phaseValue = verified === sprints.length ? "All verified" : "All ended";
      phaseNote = span;
    }
  }

  const budgetNote =
    scope.budgetNgn === null ? null : scope.budgetNgn === scope.totals.amountNgn ? "Matches the budget" : `Budget ${formatNaira(scope.budgetNgn)}`;

  return (
    <section aria-label="BoQ summary" className="rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <div className={`grid gap-x-6 gap-y-5 px-5 py-4 sm:grid-cols-2 ${live ? "xl:grid-cols-[1fr_1fr_1fr_auto]" : "lg:grid-cols-[1fr_1fr_auto]"}`}>
        <Figure label="BoQ total" value={formatNaira(scope.totals.amountNgn)}>
          {budgetNote && <p className="mt-1 text-xs text-slate-600">{budgetNote}</p>}
          <p className="mt-0.5 text-xs text-slate-600">
            {countOf(scope.totals.unitCount, "facility unit")} · {countOf(scope.totals.lineCount, "BoQ line")}
          </p>
        </Figure>

        {live && (
          <Figure
            label="Project % complete"
            value={
              <>
                {formatProgressPct(scope.progressPct)}
                {scope.progressPct >= 100 && <span className="ml-2 text-sm font-semibold text-emerald-700">Complete</span>}
              </>
            }
          >
            <ProgressMeter pct={scope.progressPct} label="Project % complete" size="lg" showText={false} className="mt-1.5 max-w-[16rem]" />
            <p className="mt-1 text-[11px] text-slate-600" title="Weighted by line amount">
              {progressNote}
            </p>
          </Figure>
        )}

        <Figure label={phaseLabel} value={phaseValue}>
          {phaseNote && <p className="mt-1 truncate text-xs text-slate-600" title={phaseNote}>{phaseNote}</p>}
          {live && (toVerify > 0 || late > 0 || verified > 0) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold">
              {late > 0 && (
                <button type="button" onClick={onShowSprints} className="inline-flex items-center gap-1 rounded text-rose-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> {late} late to verify
                </button>
              )}
              {toVerify > 0 && (
                <button type="button" onClick={onShowSprints} className="inline-flex items-center gap-1 rounded text-amber-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" /> {toVerify} to verify
                </button>
              )}
              {verified > 0 && (
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {verified} verified
                </span>
              )}
            </div>
          )}
        </Figure>

        <div className="flex flex-wrap items-start gap-2 sm:col-span-2 lg:col-span-1 lg:flex-col lg:items-stretch xl:col-span-1">
          <ScopeWorkbookToolbar projectId={projectId} scope={scope} canEdit={!readOnly} />
          {!readOnly && (
            <button type="button" className={quietButton} onClick={onEditSprints}>
              <CalendarRange className="h-3.5 w-3.5" aria-hidden="true" /> Edit work phases
            </button>
          )}
        </div>
      </div>
      {(readOnly || live) && (
        <p className="flex items-center gap-1.5 border-t border-slate-100 px-5 py-2 text-[11px] text-slate-600">
          <Info className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
          {readOnly ? "View only: changing the scope needs scope editing rights." : "Every change is recorded in the audit ledger."}
        </p>
      )}
    </section>
  );
}
