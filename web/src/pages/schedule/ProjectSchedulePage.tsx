import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarClock, CalendarRange, Gauge, History, TrendingUp } from "lucide-react";
import type { ProjectSummaryDto } from "../../api/types";
import { useAuth } from "../../lib/auth-context";
import { useProjectScheduleQuery, useScheduleRevisionsQuery } from "../../queries/schedule/useScheduleQueries";
import { KpiCard } from "../../components/common";
import Loader from "../../components/Loader";
import { ScheduleTimeline } from "../../components/schedule/ScheduleTimeline";
import { ScheduleVariancePill } from "../../components/schedule/ScheduleVarianceBadge";
import { CatchUpWizard } from "../../components/schedule/CatchUpWizard";
import { RevisionHistory } from "../../components/schedule/RevisionHistory";
import { ProgrammeOfWorksPanel } from "../../components/schedule/ProgrammeOfWorksPanel";

/**
 * Project schedule (Phase 9): planned, original and actual dates per BOQ item, variance in working
 * weeks on certified progress (reported progress beside it), the "Catch Project Up" wizard and the
 * revision history with approvals.
 */
export function ProjectSchedulePage({ project }: { project: ProjectSummaryDto }) {
  const { hasPermission } = useAuth();
  const [searchParams] = useSearchParams();
  const canViewVariance = hasPermission("schedule:view_variance");
  const scheduleQuery = useProjectScheduleQuery(project.id, canViewVariance);
  const revisionsQuery = useScheduleRevisionsQuery(project.id, canViewVariance);
  const [wizardOpen, setWizardOpen] = useState(false);
  const schedule = scheduleQuery.data;

  // Phase 13: contractors propose the programme of works; monitors accept or return it.
  const programme = <ProgrammeOfWorksPanel project={project} schedule={schedule ?? null} />;

  if (canViewVariance && scheduleQuery.isLoading) return <Loader />;
  if (!canViewVariance) return <div className="space-y-5">{programme}</div>;
  if (scheduleQuery.isError || !schedule) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
          Could not load the schedule. {(scheduleQuery.error as Error | null)?.message}
        </div>
        {programme}
      </div>
    );
  }

  const s = schedule.summary;
  const canEditBaseline = hasPermission("projects:edit_baseline");
  const canCatchUp =
    hasPermission("schedule:catch_up_refactor") && schedule.projectStatus === "ACTIVE" && s.hasBaseline && !schedule.pendingRevision;

  if (!s.hasBaseline) {
    return (
      <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center space-y-2">
        <CalendarRange className="mx-auto h-8 w-8 text-slate-300" />
        <p className="text-sm font-bold text-slate-900">No schedule yet</p>
        <p className="text-xs text-slate-500">Set project and item dates to see how far ahead or behind the project is.</p>
        {canEditBaseline && (
          <Link
            to={`/app/projects/${project.id}/settings/schedule`}
            className="inline-block rounded-xl bg-brand-primary px-4 py-2 text-xs font-semibold text-white"
          >
            Set the schedule
          </Link>
        )}
      </div>
      {programme}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Schedule</h1>
          <p className="text-xs text-slate-500">
            {project.codePrefix} · planned {s.plannedStartDate} to {s.plannedEndDate} · working days{" "}
            {schedule.workWeekDays.length} per week · today {schedule.today}
          </p>
        </div>
        <div className="flex gap-2">
          {canEditBaseline && (
            <Link
              to={`/app/projects/${project.id}/settings/schedule`}
              className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Baseline and dependencies
            </Link>
          )}
          {hasPermission("schedule:catch_up_refactor") && (
            <button
              type="button"
              disabled={!canCatchUp}
              onClick={() => setWizardOpen(true)}
              title={schedule.pendingRevision ? "A revision is waiting for approval" : undefined}
              className="rounded-xl bg-brand-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
            >
              Catch Project Up
            </button>
          )}
        </div>
      </div>

      {schedule.pendingRevision && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          Revision {schedule.pendingRevision.revisionNumber} by {schedule.pendingRevision.initiatedByName} is waiting for approval: it moves
          the projected end from {schedule.pendingRevision.previousProjectedEndDate} to {schedule.pendingRevision.newProjectedEndDate}.
          {schedule.pendingRevision.canDecide
            ? " Review it in the history below."
            : schedule.pendingRevision.canWithdraw
              ? " Someone else with approval rights must decide. You can withdraw it from the history below if it is no longer needed."
              : " Someone with approval rights, other than the proposer, must decide."}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Variance (certified)"
          icon={<Gauge className="h-4 w-4" />}
          iconVariant={s.status === "BEHIND" ? "rose" : "emerald"}
          value={<ScheduleVariancePill status={s.status} label={s.varianceLabel} varianceWorkdays={s.varianceWorkdays} />}
          subtitle="Budget-weighted, rounded to half weeks. Certified progress lags field work by design."
        />
        <KpiCard
          title="Variance (reported)"
          icon={<TrendingUp className="h-4 w-4" />}
          iconVariant="slate"
          value={<ScheduleVariancePill status={s.reportedStatus} label={s.reportedVarianceLabel} varianceWorkdays={s.reportedVarianceWorkdays} />}
          subtitle="From approved or confirmed field reports not yet certified."
        />
        <KpiCard
          title="Progress"
          icon={<CalendarClock className="h-4 w-4" />}
          value={`${s.certifiedProgressPct.toFixed(1)}%`}
          subtitle={`certified · ${s.reportedProgressPct.toFixed(1)}% reported`}
        />
        <KpiCard
          title="End dates"
          icon={<CalendarRange className="h-4 w-4" />}
          value={<span className="tabular-nums">{s.currentProjectedEndDate ?? "–"}</span>}
          subtitle={
            <span>
              Original {s.originalPlannedEndDate ?? "–"} · forecast {s.forecastEndDate ?? "–"}
              {s.forecastSlipWorkdays ? ` (${s.forecastSlipWorkdays > 0 ? "+" : ""}${s.forecastSlipWorkdays} days)` : ""}
            </span>
          }
        />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-bold text-slate-900">Timeline</h2>
          {s.unscheduledItemCount > 0 && <p className="text-[11px] text-slate-500">{s.unscheduledItemCount} item(s) have no dates</p>}
        </div>
        <ScheduleTimeline schedule={schedule} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <History className="h-4 w-4 text-slate-400" /> Revision history
        </h2>
        {revisionsQuery.isLoading ? (
          <Loader />
        ) : (
          <RevisionHistory projectId={project.id} revisions={revisionsQuery.data ?? []} initiallyOpenId={searchParams.get("revision")} />
        )}
      </section>

      {programme}

      {wizardOpen && <CatchUpWizard projectId={project.id} schedule={schedule} onClose={() => setWizardOpen(false)} />}
    </div>
  );
}
