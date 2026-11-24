import type React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CalendarClock, CalendarDays, CheckCircle2, Layers, Wallet } from "lucide-react";
import {
  VISIT_CONFIRMATION_LABELS,
  VISIT_KIND_META,
  VISIT_STATUS_LABELS,
  type CaptureListItemDto,
  type OverviewDeadline,
  type OverviewNextVisit,
  type OverviewSprint,
  type ProjectOverviewDto,
  type SprintStatus,
} from "@insite/shared";
import type { ProjectSummaryDto } from "../../api/types";
import { formatCompactNaira, formatNaira } from "../../lib/formatters";
import { useAuth, useTerm } from "../../lib/auth-context";
import { LiveGeospatialMap } from "../../components/LiveGeospatialMap";
import { ScheduleBadge } from "../../components/schedule/ScheduleVarianceBadge";
import { ProjectKpisCard } from "../../components/kpis/ProjectKpisCard";
import { OpenDefaultCasesCard } from "../../components/contracts/ContractOverviewCards";
import { DEFAULT_CASE_VIEW_PERMISSIONS, MILESTONE_VIEW_PERMISSIONS } from "../../components/contracts/contractUi";
import { PaidVsContractSumBar } from "../../components/payments/PaidVsContractSumBar";
import { ProjectStageBar } from "../../components/overview/ProjectStageBar";
import { PhaseActions } from "../../components/overview/PhaseActions";
import { useProjectOverviewQuery } from "../../queries/projects/useProjectsQueries";
import { useProjectPaymentsQuery } from "../../queries/payments/usePaymentsQueries";

interface ProjectOverviewPageProps {
  project: ProjectSummaryDto;
  evidenceLogs: CaptureListItemDto[];
}

const SPRINT_STATUS_TEXT: Record<SprintStatus, string> = {
  UPCOMING: "Upcoming",
  ACTIVE: "Active",
  ENDED: "Ended, not verified yet",
  LATE: "Verification late",
  VERIFIED: "Verified",
};
const OUTCOME_TEXT = { MET: "met", PARTLY_MET: "partly met", NOT_MET: "not met" } as const;

function Card({
  title,
  icon,
  action,
  children,
  className = "",
}: {
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm ${className}`} aria-label={title}>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-bold text-slate-900">
          <span className="text-brand-primary" aria-hidden="true">
            {icon}
          </span>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function CardLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="shrink-0 text-[11px] font-semibold text-brand-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary rounded">
      {children}
    </Link>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 py-1 text-xs last:border-b-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-semibold text-slate-800">{children}</dd>
    </div>
  );
}

function SprintCard({ projectId, sprint, hasSprints }: { projectId: string; sprint: OverviewSprint | null; hasSprints: boolean }) {
  const title = sprint?.relation === "NEXT" ? "Next sprint" : sprint?.relation === "LAST" ? "Last sprint" : "Current sprint";
  return (
    <Card title={title} icon={<Layers className="h-4 w-4" />} action={<CardLink to={`/app/projects/${projectId}/scope`}>Sprints &amp; scope</CardLink>}>
      {!hasSprints || !sprint ? (
        <p className="text-xs text-slate-500">No sprints yet.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-900">
            Sprint {sprint.number} of {sprint.totalSprints}
            {sprint.name ? ` · ${sprint.name}` : ""}
          </p>
          <dl>
            <Row label="Dates">
              {sprint.startDate} to {sprint.endDate}
            </Row>
            <Row label="Status">
              {SPRINT_STATUS_TEXT[sprint.status]}
              {sprint.verificationOutcome ? ` (${OUTCOME_TEXT[sprint.verificationOutcome]})` : ""}
            </Row>
            <Row label="Facility units in this sprint">{sprint.activeUnitCount}</Row>
          </dl>
          {sprint.deliverables && <p className="rounded-xl bg-slate-50 p-2 text-xs text-slate-700">{sprint.deliverables}</p>}
        </div>
      )}
    </Card>
  );
}

function NextVisitCard({ projectId, visit, today }: { projectId: string; visit: OverviewNextVisit | null; today: string }) {
  return (
    <Card
      title="Next visit"
      icon={<CalendarDays className="h-4 w-4" />}
      action={<CardLink to={visit ? `/app/projects/${projectId}/visits?visitId=${visit.id}` : `/app/projects/${projectId}/visits`}>Visits</CardLink>}
    >
      {!visit ? (
        <p className="text-xs text-slate-500">No visit planned from today.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-900">
            {VISIT_KIND_META[visit.visitKind]?.label ?? visit.visitKind} · {visit.plannedDate}
            {visit.plannedDate === today ? " (today)" : ""}
          </p>
          <dl>
            <Row label="Status">{VISIT_STATUS_LABELS[visit.status]}</Row>
            {visit.status === "PLANNED" && <Row label="Confirmation">{VISIT_CONFIRMATION_LABELS[visit.confirmation]}</Row>}
            <Row label={visit.officerNames.length === 1 ? "Officer" : "Officers"}>
              {visit.officerNames.length > 0 ? visit.officerNames.join(", ") : "No officer"}
            </Row>
          </dl>
        </div>
      )}
    </Card>
  );
}

function NextDeadlineCard({
  projectId,
  deadline,
  overdueMilestoneCount,
}: {
  projectId: string;
  deadline: OverviewDeadline | null;
  overdueMilestoneCount: number | null;
}) {
  const link =
    deadline?.kind === "VISIT_SUBMISSION" && deadline.visitId
      ? `/app/projects/${projectId}/visits?visitId=${deadline.visitId}`
      : `/app/projects/${projectId}/kickoff?tab=milestones`;
  return (
    <Card
      title="Next deadline"
      icon={<CalendarClock className="h-4 w-4" />}
      action={overdueMilestoneCount !== null ? <CardLink to={`/app/projects/${projectId}/kickoff?tab=milestones`}>All milestones</CardLink> : undefined}
    >
      {!deadline ? (
        <p className="text-xs text-slate-500">No open deadlines.</p>
      ) : (
        <div className="space-y-2">
          <Link to={link} className="block text-sm font-semibold text-slate-900 hover:underline">
            {deadline.label}
          </Link>
          <dl>
            <Row label={deadline.kind === "MILESTONE" ? "Contract milestone due" : "Visit report due"}>
              {deadline.dueDate}
              {deadline.overdue && <span className="ml-1 text-rose-700">(overdue)</span>}
            </Row>
          </dl>
        </div>
      )}
      {overdueMilestoneCount !== null && overdueMilestoneCount > 0 && (
        <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-rose-700">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> {overdueMilestoneCount} contract milestone
          {overdueMilestoneCount === 1 ? "" : "s"} overdue
        </p>
      )}
    </Card>
  );
}

function BudgetCard({ project, canSeePayments }: { project: ProjectSummaryDto; canSeePayments: boolean }) {
  const term = useTerm();
  const payments = useProjectPaymentsQuery(project.id, canSeePayments);
  return (
    <Card
      title="Budget and payments"
      icon={<Wallet className="h-4 w-4" />}
      action={canSeePayments ? <CardLink to={`/app/projects/${project.id}/payments`}>Payments</CardLink> : undefined}
    >
      <dl>
        <Row label="Budget">{formatCompactNaira(project.totalBudgetNgn)}</Row>
      </dl>
      {canSeePayments &&
        (payments.data ? (
          <div className="mt-2 space-y-2">
            <PaidVsContractSumBar paidNgn={payments.data.paidGrossNgn} contractSumNgn={payments.data.contractSumNgn} />
            <dl>
              <Row label={`${term("retention")} held now`}>{formatNaira(payments.data.retentionBalanceNgn)}</Row>
              <Row label="Payment exceptions">
                <span className={payments.data.exceptionCount > 0 ? "text-amber-700" : undefined}>{payments.data.exceptionCount}</span>
              </Row>
            </dl>
          </div>
        ) : payments.isError ? (
          <p className="mt-2 text-xs text-slate-500">Payments could not be loaded.</p>
        ) : (
          <div className="mt-2 h-12 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" />
        ))}
    </Card>
  );
}

function ProgressCard({ project, overview }: { project: ProjectSummaryDto; overview: ProjectOverviewDto | undefined }) {
  const findings = overview?.openFindingCount ?? null;
  const defects = overview?.openDefectCount ?? null;
  return (
    <Card title="Progress" icon={<CheckCircle2 className="h-4 w-4" />}>
      <p className="flex flex-wrap items-center gap-2 text-2xl font-bold text-slate-900">
        {project.certifiedProgressPct.toFixed(1)}%
        <ScheduleBadge badge={project.scheduleVariance} size="xs" />
      </p>
      <p className="text-[11px] text-slate-500">Budget-weighted, from accepted visits</p>
      {(findings !== null || defects !== null) && (
        <dl className="mt-2">
          {findings !== null && (
            <Row label="Open findings">
              <Link to={`/app/projects/${project.id}/visits?tab=findings`} className="hover:underline">
                {findings}
              </Link>
            </Row>
          )}
          {defects !== null && (
            <Row label="Open defects">
              <Link to={`/app/projects/${project.id}/completion?tab=defects`} className="hover:underline">
                {defects}
              </Link>
            </Row>
          )}
        </dl>
      )}
    </Card>
  );
}

/**
 * Redesign R6c (D-R6.18 – D-R6.21): the project Overview. Stage bar with the phase actions, then the
 * current sprint, next visit, next deadline, budget and payments, progress, open default cases, the
 * map and the project KPIs. Data from `GET /projects/:id/overview`; sections the caller may not see
 * come back null and their card is hidden.
 */
export function ProjectOverviewPage({ project, evidenceLogs }: ProjectOverviewPageProps) {
  const { hasPermission, hasAnyPermission } = useAuth();
  const live = project.status !== "DRAFT";
  const overviewQuery = useProjectOverviewQuery(project.id, live);
  const overview = overviewQuery.data;
  const canSeePayments = hasPermission("payments:view") || hasPermission("payments:record");
  const canSeeDeadlines = hasAnyPermission(...MILESTONE_VIEW_PERMISSIONS) || hasPermission("visits:view");

  return (
    <div className="space-y-3">
      <section className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm" aria-labelledby="overview-stage-heading">
        <h2 id="overview-stage-heading" className="text-sm font-bold text-slate-900">
          Stage
          {overview && <span className="ml-2 font-semibold text-slate-500">· {overview.stage.currentLabel}{overview.stage.subLabel ? ` (${overview.stage.subLabel})` : ""}</span>}
        </h2>
        {overview ? (
          <ProjectStageBar stage={overview.stage} />
        ) : overviewQuery.isError ? (
          <p className="text-xs text-rose-700">The project stage could not be loaded.</p>
        ) : (
          <div className="h-16 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" />
        )}
        <PhaseActions projectId={project.id} projectStatus={project.status} />
      </section>

      {overview && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {overview.hasSprints !== null && <SprintCard projectId={project.id} sprint={overview.currentSprint} hasSprints={overview.hasSprints} />}
          {hasPermission("visits:view") && <NextVisitCard projectId={project.id} visit={overview.nextVisit} today={overview.today} />}
          {canSeeDeadlines && (
            <NextDeadlineCard projectId={project.id} deadline={overview.nextDeadline} overdueMilestoneCount={overview.overdueMilestoneCount} />
          )}
          <BudgetCard project={project} canSeePayments={canSeePayments} />
          <ProgressCard project={project} overview={overview} />
        </div>
      )}

      {hasAnyPermission(...DEFAULT_CASE_VIEW_PERMISSIONS) && <OpenDefaultCasesCard projectId={project.id} />}

      <LiveGeospatialMap project={project} evidenceLogs={evidenceLogs} />

      {hasPermission("kpis:view") && live && <ProjectKpisCard projectId={project.id} />}
    </div>
  );
}
