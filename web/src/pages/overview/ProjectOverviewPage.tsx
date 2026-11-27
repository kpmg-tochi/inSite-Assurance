import type React from "react";
import {
  PROJECT_REGISTER_IMPORT_STATUS_LABELS,
  type CaptureListItemDto,
  type ProjectRegisterImportStatus,
} from "@insite/shared";
import type { ProjectSummaryDto } from "../../api/types";
import { formatDateShort } from "../../lib/formatters";
import { useAuth, useTerm } from "../../lib/auth-context";
import { LiveGeospatialMap } from "../../components/LiveGeospatialMap";
import { ProjectKpisCard } from "../../components/kpis/ProjectKpisCard";
import { OpenDefaultCasesCard } from "../../components/contracts/ContractOverviewCards";
import { DEFAULT_CASE_VIEW_PERMISSIONS, MILESTONE_VIEW_PERMISSIONS } from "../../components/contracts/contractUi";
import { ProjectStageBar } from "../../components/overview/ProjectStageBar";
import { PhaseActions } from "../../components/overview/PhaseActions";
import { OverviewStatRow } from "../../components/overview/OverviewStatRow";
import { ComingUpPanel } from "../../components/overview/ComingUpPanel";
import { PANEL_CLASS } from "../../components/overview/charts/ChartPanel";
import { ProgressCurveChart } from "../../components/overview/charts/ProgressCurveChart";
import { UnitProgressChart } from "../../components/overview/charts/UnitProgressChart";
import { WorkPhasesChart } from "../../components/overview/charts/WorkPhasesChart";
import { VisitsByMonthChart } from "../../components/overview/charts/VisitsByMonthChart";
import { FindingsBySeverityChart } from "../../components/overview/charts/FindingsBySeverityChart";
import { MoneyPanel } from "../../components/overview/charts/MoneyPanel";
import { ProjectAlertChips } from "../../components/alerts/ProjectAlertChips";
import { CloseoutReportPrompt } from "../../components/closure/CloseoutReport";
import { ProjectSitesCard } from "../../components/sites/ProjectSitesCard";
import { ApprovedListLinkCard } from "../../components/approvedLists/ApprovedListLinkCard";
import { ProjectOriginCard } from "../../components/needs/integration/ProjectOriginCard";
import { ProjectContractorFlagCard } from "../../components/contractorFlags/ProjectContractorFlagCard";
import { useProjectOverviewQuery } from "../../queries/projects/useProjectsQueries";
import { useOverviewChartsQuery } from "../../queries/projects/useOverviewChartsQuery";

interface ProjectOverviewPageProps {
  project: ProjectSummaryDto;
  evidenceLogs: CaptureListItemDto[];
}

/**
 * UBEC IRL: the project's register details in one line (client project ID, intervention year,
 * funding source) and, for a project from the register import, when it was imported and what was
 * reported then. Hidden when none is set.
 */
function RegisterDetails({ project }: { project: ProjectSummaryDto }) {
  const term = useTerm();
  const items: Array<{ label: string; value: React.ReactNode }> = [];
  if (project.externalReference) items.push({ label: term("externalReference"), value: project.externalReference });
  if (project.interventionYear !== null) items.push({ label: "Intervention year", value: project.interventionYear });
  if (project.fundingSource) items.push({ label: "Funding source", value: project.fundingSource });
  if (project.importedAt) {
    const status = project.importedStatus
      ? (PROJECT_REGISTER_IMPORT_STATUS_LABELS[project.importedStatus as ProjectRegisterImportStatus] ?? project.importedStatus)
      : null;
    const reported = [status, project.importedProgressPct !== null ? `${Math.round(project.importedProgressPct)}%` : null].filter(Boolean).join(", ");
    items.push({ label: "Imported", value: `${formatDateShort(project.importedAt)}${reported ? ` (reported ${reported.toLowerCase()})` : ""}` });
  }
  if (items.length === 0) return null;
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white px-4 py-2.5 shadow-sm" aria-label="Register details">
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {items.map((i) => (
          <div key={i.label} className="flex gap-1.5">
            <dt className="font-semibold text-slate-500">{i.label}</dt>
            <dd className="text-slate-800">{i.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function PanelSkeleton({ className = "", height = 280 }: { className?: string; height?: number }) {
  return (
    <div className={`${PANEL_CLASS} p-4 sm:p-5 ${className}`} aria-hidden="true">
      <div className="h-3.5 w-48 animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />
      <div className="mt-2 h-3 w-72 max-w-full animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />
      <div style={{ height }} className="mt-4 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" />
    </div>
  );
}

/** Two panels side by side (7 + 5 columns at xl); one alone takes the full row; none renders nothing. */
function PanelPair({ left, right }: { left: ((span: string) => React.ReactNode) | null; right: ((span: string) => React.ReactNode) | null }) {
  if (!left && !right) return null;
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
      {left?.(right ? "min-w-0 xl:col-span-7" : "min-w-0 xl:col-span-12")}
      {right?.(left ? "min-w-0 xl:col-span-5" : "min-w-0 xl:col-span-12")}
    </div>
  );
}

/**
 * Redesign R6c, UBEC layout; design round 2026-11-26: the project Overview as a dashboard. The phase
 * action banner, the stage bar with early-warning alerts, the closeout prompt, a stat row, then the
 * charts from `GET /projects/:id/overview/charts` (progress and payments over time beside "Coming
 * up", progress by facility unit beside findings and monitoring visits, the work phase timeline),
 * the map, money beside the contractor, and the remaining cards. Stage, alerts, next visit, next
 * deadline and counts come from `GET /projects/:id/overview`. A section the caller may not see is
 * null and its panel is left out; the grid closes up around it. Drafts request neither.
 */
export function ProjectOverviewPage({ project, evidenceLogs }: ProjectOverviewPageProps) {
  const { hasPermission, hasAnyPermission } = useAuth();
  const live = project.status !== "DRAFT";
  const overviewQuery = useProjectOverviewQuery(project.id, live);
  const overview = overviewQuery.data;
  const chartsQuery = useOverviewChartsQuery(project.id, live);
  const charts = chartsQuery.data;
  const canSeeVisits = hasPermission("visits:view");
  const canSeeDeadlines = hasAnyPermission(...MILESTONE_VIEW_PERMISSIONS) || canSeeVisits;
  const hasContractor = Boolean(project.contractors[0]?.organizationId);
  const chartsLoading = live && !charts && !chartsQuery.isError;

  const curve = charts?.progressCurve ?? null;
  const units = charts?.units ?? null;
  const workPhases = charts?.workPhases ?? null;
  const visits = charts?.visitsByMonth ?? null;
  const findings = charts?.findingsBySeverity ?? null;
  const money = charts?.money ?? null;

  return (
    <div className="space-y-3">
      <PhaseActions projectId={project.id} projectStatus={project.status} stage={overview?.stage.current} />

      <section className="rounded-2xl border border-slate-200/80 bg-white px-4 py-4 shadow-sm sm:px-5" aria-labelledby="overview-stage-heading">
        <h2 id="overview-stage-heading" className="sr-only">
          Project cycle{overview ? `: ${overview.stage.currentLabel}${overview.stage.subLabel ? ` (${overview.stage.subLabel})` : ""}` : ""}
        </h2>
        {overview ? (
          <>
            <ProjectStageBar stage={overview.stage} />
            {overview.activeAlerts.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                <span className="text-xs font-semibold text-slate-700">Early-warning alerts</span>
                <ProjectAlertChips alerts={overview.activeAlerts} raisedAt={overview.alertRaisedAt} />
              </div>
            )}
          </>
        ) : overviewQuery.isError ? (
          <p className="text-xs text-rose-700">The project cycle could not be loaded.</p>
        ) : (
          <div className="h-14 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" />
        )}
      </section>

      <CloseoutReportPrompt project={project} />

      {overview && <OverviewStatRow project={project} overview={overview} charts={charts} />}
      {!overview && live && !overviewQuery.isError && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none" />
          ))}
        </div>
      )}

      {live && chartsQuery.isError && (
        <p className={`${PANEL_CLASS} px-4 py-3 text-xs text-rose-700`}>The dashboard charts could not be loaded.</p>
      )}

      {/* Progress over time beside "Coming up". */}
      {(chartsLoading || curve || overview) && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
          {chartsLoading ? (
            <PanelSkeleton className="xl:col-span-8" />
          ) : curve && charts ? (
            <ProgressCurveChart curve={curve} today={charts.today} className="xl:col-span-8" />
          ) : null}
          {overview && (
            <ComingUpPanel
              projectId={project.id}
              overview={overview}
              showVisit={canSeeVisits}
              showDeadline={canSeeDeadlines}
              wide={!chartsLoading && !curve}
              className={!chartsLoading && !curve ? "xl:col-span-12" : "xl:col-span-4"}
            />
          )}
        </div>
      )}

      {/* Two rows of similar height: unit progress beside findings, work phases beside monitoring visits. */}
      {chartsLoading ? (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
          <PanelSkeleton className="xl:col-span-7" height={320} />
          <PanelSkeleton className="xl:col-span-5" height={320} />
        </div>
      ) : charts ? (
        <>
          <PanelPair
            left={units !== null ? (span) => <UnitProgressChart units={units} projectId={project.id} className={span} /> : null}
            right={findings !== null ? (span) => <FindingsBySeverityChart rows={findings} projectId={project.id} className={span} /> : null}
          />
          <PanelPair
            left={workPhases !== null ? (span) => <WorkPhasesChart phases={workPhases} today={charts.today} projectId={project.id} className={span} /> : null}
            right={visits !== null ? (span) => <VisitsByMonthChart months={visits} today={charts.today} projectId={project.id} className={span} /> : null}
          />
        </>
      ) : null}

      <LiveGeospatialMap project={project} evidenceLogs={evidenceLogs} />

      {/* Money beside the contractor (client demo updates F.4: stars and any open performance flag). */}
      {money || hasContractor ? (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
          {money && <MoneyPanel money={money} projectId={project.id} className={hasContractor ? "xl:col-span-7" : "xl:col-span-12"} />}
          {hasContractor && (
            <div className={`min-w-0 ${money ? "xl:col-span-5" : "xl:col-span-12"}`}>
              <ProjectContractorFlagCard project={project} />
            </div>
          )}
        </div>
      ) : null}

      {/* Needs pipeline wave 4 (C5): where the project came from (proposed project, amounts, rank). */}
      <ProjectOriginCard projectId={project.id} />

      {/* Client demo updates E3 (wave 3): the approved list row and the budget-mismatch red flag. */}
      <ApprovedListLinkCard projectId={project.id} />

      <RegisterDetails project={project} />

      {hasAnyPermission(...DEFAULT_CASE_VIEW_PERMISSIONS) && <OpenDefaultCasesCard projectId={project.id} />}

      {/* Client demo updates C2 (wave 2): multi-site projects list their sites. */}
      <ProjectSitesCard projectId={project.id} enabled={live && (project.sites === undefined || project.sites.length > 0)} />

      {hasPermission("kpis:view") && live && <ProjectKpisCard projectId={project.id} />}
    </div>
  );
}
