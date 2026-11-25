import type React from "react";
import { Link } from "react-router-dom";
import {
  PROJECT_REGISTER_IMPORT_STATUS_LABELS,
  SCHEDULE_STATUS_META,
  VISIT_CONFIRMATION_LABELS,
  VISIT_KIND_META,
  VISIT_STATUS_LABELS,
  type CaptureListItemDto,
  type OverviewDeadline,
  type OverviewNextVisit,
  type OverviewSprint,
  type ProjectOverviewDto,
  type ProjectRegisterImportStatus,
  type SprintStatus,
} from "@insite/shared";
import type { ProjectSummaryDto } from "../../api/types";
import { formatCompactNaira, formatDateShort } from "../../lib/formatters";
import { useAuth, useTerm } from "../../lib/auth-context";
import { LiveGeospatialMap } from "../../components/LiveGeospatialMap";
import { ProjectKpisCard } from "../../components/kpis/ProjectKpisCard";
import { OpenDefaultCasesCard } from "../../components/contracts/ContractOverviewCards";
import { DEFAULT_CASE_VIEW_PERMISSIONS, MILESTONE_VIEW_PERMISSIONS } from "../../components/contracts/contractUi";
import { ProjectStageBar } from "../../components/overview/ProjectStageBar";
import { PhaseActions } from "../../components/overview/PhaseActions";
import { ProjectAlertChips } from "../../components/alerts/ProjectAlertChips";
import { CloseoutReportPrompt } from "../../components/closure/CloseoutReport";
import { useProjectOverviewQuery } from "../../queries/projects/useProjectsQueries";
import { useProjectPaymentsQuery } from "../../queries/payments/usePaymentsQueries";

interface ProjectOverviewPageProps {
  project: ProjectSummaryDto;
  evidenceLogs: CaptureListItemDto[];
}

type Tone = "good" | "warn" | "bad" | "muted";

const SPRINT_STATUS: Record<SprintStatus, { text: string; tone: Tone }> = {
  UPCOMING: { text: "Upcoming", tone: "muted" },
  ACTIVE: { text: "In progress", tone: "good" },
  ENDED: { text: "Ended, not verified yet", tone: "warn" },
  LATE: { text: "Verification late", tone: "bad" },
  VERIFIED: { text: "Verified", tone: "good" },
};
const OUTCOME = { MET: { text: "met", tone: "good" }, PARTLY_MET: { text: "partly met", tone: "warn" }, NOT_MET: { text: "not met", tone: "bad" } } as const;
const SCHEDULE_TONE: Record<string, Tone> = { positive: "good", neutral: "muted", warning: "warn", critical: "bad", muted: "muted" };

const DOT: Record<Tone, string> = { good: "bg-emerald-600", warn: "bg-amber-500", bad: "bg-rose-600", muted: "bg-slate-400" };
const TONE_TEXT: Record<Tone, string> = { good: "text-slate-700", warn: "text-amber-800", bad: "text-rose-700", muted: "text-slate-600" };

/** A state as a small dot plus words (no pills). */
function StateText({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${TONE_TEXT[tone]}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[tone]}`} aria-hidden="true" />
      {children}
    </span>
  );
}

/** "24 Nov 2026" from YYYY-MM-DD (calendar dates, no zone shift). */
function fmtDay(date: string, withYear = true): string {
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
}
function fmtRange(start: string, end: string): string {
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${fmtDay(start, !sameYear)} – ${fmtDay(end)}`;
}

/**
 * One overview card: the card's name, one headline fact, at most two supporting lines and one link.
 * `span` places it in the 6-column grid (3 across or 2 across).
 */
function Card({
  title,
  headline,
  lines = [],
  link,
  span,
}: {
  title: string;
  headline: React.ReactNode;
  lines?: React.ReactNode[];
  link?: { to: string; label: string } | null;
  span: string;
}) {
  const shown = lines.filter(Boolean);
  return (
    <section className={`flex flex-col rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm ${span}`} aria-label={title}>
      <h2 className="text-xs font-semibold text-slate-500">{title}</h2>
      <div className="mt-1.5 text-base font-bold leading-snug text-slate-900">{headline}</div>
      {shown.length > 0 && (
        <div className="mt-1 space-y-0.5 text-xs text-slate-600">
          {shown.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
      {link && (
        <Link
          to={link.to}
          className="mt-auto self-start rounded pt-3 text-xs font-semibold text-brand-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
        >
          {link.label}
        </Link>
      )}
    </section>
  );
}

function sprintCard(projectId: string, sprint: OverviewSprint | null, hasSprints: boolean, span: string) {
  const title = sprint?.relation === "NEXT" ? "Next sprint" : sprint?.relation === "LAST" ? "Last sprint" : "Current sprint";
  const link = { to: `/app/projects/${projectId}/scope`, label: "Scope & sprints" };
  if (!hasSprints || !sprint) {
    return <Card key="sprint" span={span} title="Current sprint" headline="No sprints yet" lines={["Plan sprints to schedule the work."]} link={link} />;
  }
  const status = SPRINT_STATUS[sprint.status];
  const outcome = sprint.verificationOutcome ? OUTCOME[sprint.verificationOutcome] : null;
  return (
    <Card
      key="sprint"
      span={span}
      title={title}
      headline={`Sprint ${sprint.number} of ${sprint.totalSprints}${sprint.name ? ` · ${sprint.name}` : ""}`}
      lines={[
        fmtRange(sprint.startDate, sprint.endDate),
        <StateText key="s" tone={outcome?.tone ?? status.tone}>
          {status.text}
          {outcome ? ` (${outcome.text})` : ""} · {sprint.activeUnitCount} facility unit{sprint.activeUnitCount === 1 ? "" : "s"}
        </StateText>,
      ]}
      link={link}
    />
  );
}

function visitCard(projectId: string, visit: OverviewNextVisit | null, today: string, span: string) {
  if (!visit) {
    return (
      <Card key="visit" span={span} title="Next visit" headline="None planned" lines={["No visit is planned from today."]} link={{ to: `/app/projects/${projectId}/visits`, label: "Visits" }} />
    );
  }
  const status = visit.status === "PLANNED" ? VISIT_CONFIRMATION_LABELS[visit.confirmation] : VISIT_STATUS_LABELS[visit.status];
  return (
    <Card
      key="visit"
      span={span}
      title="Next visit"
      headline={`${VISIT_KIND_META[visit.visitKind]?.label ?? visit.visitKind} · ${visit.plannedDate === today ? "today" : fmtDay(visit.plannedDate)}`}
      lines={[
        status,
        visit.officerNames.length > 0 ? visit.officerNames.join(", ") : <StateText key="o" tone="warn">No officer assigned</StateText>,
      ]}
      link={{ to: `/app/projects/${projectId}/visits?visitId=${visit.id}`, label: "Open visit" }}
    />
  );
}

function deadlineCard(projectId: string, deadline: OverviewDeadline | null, overdueMilestones: number | null, span: string) {
  const milestones = `/app/projects/${projectId}/kickoff?tab=milestones`;
  const overdueLine =
    overdueMilestones !== null && overdueMilestones > 0 ? (
      <StateText key="m" tone="bad">
        {overdueMilestones} contract milestone{overdueMilestones === 1 ? "" : "s"} overdue
      </StateText>
    ) : null;
  const visitLink = deadline?.kind === "VISIT_SUBMISSION" && deadline.visitId ? `/app/projects/${projectId}/visits?visitId=${deadline.visitId}` : null;
  const link =
    overdueMilestones !== null
      ? { to: milestones, label: "Milestones" }
      : visitLink
        ? { to: visitLink, label: "Open visit" }
        : null;
  if (!deadline) {
    return <Card key="deadline" span={span} title="Next deadline" headline="No open deadlines" lines={[overdueLine]} link={link} />;
  }
  return (
    <Card
      key="deadline"
      span={span}
      title="Next deadline"
      headline={deadline.label}
      lines={[
        deadline.overdue ? (
          <StateText key="d" tone="bad">Overdue since {fmtDay(deadline.dueDate)}</StateText>
        ) : (
          `${deadline.kind === "MILESTONE" ? "Milestone due" : "Visit report due"} ${fmtDay(deadline.dueDate)}`
        ),
        overdueLine,
      ]}
      link={link}
    />
  );
}

function BudgetCard({ project, canSeePayments, span }: { project: ProjectSummaryDto; canSeePayments: boolean; span: string }) {
  const term = useTerm();
  const payments = useProjectPaymentsQuery(project.id, canSeePayments);
  const budget = formatCompactNaira(project.totalBudgetNgn);
  if (!canSeePayments) {
    return <Card span={span} title="Budget" headline={budget} />;
  }
  const link = { to: `/app/projects/${project.id}/payments`, label: "Payments" };
  if (!payments.data) {
    return (
      <Card
        span={span}
        title="Budget and payments"
        headline={budget}
        lines={[payments.isError ? "Payments could not be loaded." : <span key="l" className="inline-block h-3 w-40 animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />]}
        link={link}
      />
    );
  }
  const p = payments.data;
  return (
    <Card
      span={span}
      title="Budget and payments"
      headline={`${formatCompactNaira(p.paidGrossNgn)} paid`}
      lines={[
        p.contractSumNgn !== null ? `Of ${formatCompactNaira(p.contractSumNgn)} contract sum · budget ${budget}` : `Budget ${budget}`,
        <span key="r">
          {formatCompactNaira(p.retentionBalanceNgn)} {term("retention").toLowerCase()} held
          {p.exceptionCount > 0 && (
            <>
              {" · "}
              <StateText tone="warn">
                {p.exceptionCount} payment exception{p.exceptionCount === 1 ? "" : "s"}
              </StateText>
            </>
          )}
        </span>,
      ]}
      link={link}
    />
  );
}

function progressCard(project: ProjectSummaryDto, overview: ProjectOverviewDto, span: string) {
  const badge = project.scheduleVariance;
  const findings = overview.openFindingCount;
  const defects = overview.openDefectCount;
  const counts = [
    findings !== null ? `${findings} open finding${findings === 1 ? "" : "s"}` : null,
    defects !== null ? `${defects} open defect${defects === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return (
    <Card
      key="progress"
      span={span}
      title="Progress"
      headline={
        project.progressIsImported ? (
          <span title="Reported at import; replaced by verified progress once the scope is added">
            <span className="text-2xl tabular-nums">{project.certifiedProgressPct.toFixed(1)}%</span>{" "}
            <span className="text-xs font-semibold text-slate-500">Reported at import</span>
          </span>
        ) : (
          <span title="Budget-weighted, from accepted visits" className="text-2xl tabular-nums">
            {project.certifiedProgressPct.toFixed(1)}%
          </span>
        )
      }
      lines={[
        badge ? (
          <StateText key="s" tone={SCHEDULE_TONE[SCHEDULE_STATUS_META[badge.status].tone]}>
            {badge.status === "UNSCHEDULED" ? "No sprints to schedule against" : `Schedule: ${badge.label.toLowerCase()}`}
          </StateText>
        ) : null,
        counts.length ? counts.join(" · ") : null,
      ]}
      link={findings !== null ? { to: `/app/projects/${project.id}/visits?tab=findings`, label: "Findings" } : null}
    />
  );
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

/** Grid spans for n cards: 3 then 2 for five, two rows of two for four, otherwise one even row. */
function spansFor(n: number): string[] {
  const third = "md:col-span-2";
  const half = "md:col-span-3";
  if (n === 5) return [third, third, third, half, half];
  if (n === 4) return [half, half, half, half];
  if (n === 3) return [third, third, third];
  if (n === 2) return [half, half];
  return ["md:col-span-6"];
}

/**
 * Redesign R6c (D-R6.18 – D-R6.21), UBEC layout: the project overview. The phase action banner and
 * the stage timeline, the closeout report prompt once construction is complete, then five plain
 * cards (current sprint, next visit, next deadline in one row; budget and payments, progress in the
 * next), open default cases, the map and the project KPIs. Data from `GET /projects/:id/overview`;
 * sections the caller may not see come back null and their card is hidden.
 */
export function ProjectOverviewPage({ project, evidenceLogs }: ProjectOverviewPageProps) {
  const { hasPermission, hasAnyPermission } = useAuth();
  const live = project.status !== "DRAFT";
  const overviewQuery = useProjectOverviewQuery(project.id, live);
  const overview = overviewQuery.data;
  const canSeePayments = hasPermission("payments:view") || hasPermission("payments:record");
  const canSeeDeadlines = hasAnyPermission(...MILESTONE_VIEW_PERMISSIONS) || hasPermission("visits:view");

  const cards: Array<(span: string) => React.ReactNode> = [];
  if (overview) {
    if (overview.hasSprints !== null) cards.push((span) => sprintCard(project.id, overview.currentSprint, overview.hasSprints ?? false, span));
    if (hasPermission("visits:view")) cards.push((span) => visitCard(project.id, overview.nextVisit, overview.today, span));
    if (canSeeDeadlines) cards.push((span) => deadlineCard(project.id, overview.nextDeadline, overview.overdueMilestoneCount, span));
    cards.push((span) => <BudgetCard key="budget" project={project} canSeePayments={canSeePayments} span={span} />);
    cards.push((span) => progressCard(project, overview, span));
  }
  const spans = spansFor(cards.length);

  return (
    <div className="space-y-3">
      <PhaseActions projectId={project.id} projectStatus={project.status} />

      <section className="rounded-2xl border border-slate-200/80 bg-white px-4 py-4 shadow-sm sm:px-5" aria-labelledby="overview-stage-heading">
        <h2 id="overview-stage-heading" className="sr-only">
          Project stage{overview ? `: ${overview.stage.currentLabel}${overview.stage.subLabel ? ` (${overview.stage.subLabel})` : ""}` : ""}
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
          <p className="text-xs text-rose-700">The project stage could not be loaded.</p>
        ) : (
          <div className="h-14 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" />
        )}
      </section>

      <CloseoutReportPrompt project={project} />

      <RegisterDetails project={project} />

      {overview && <div className="grid grid-cols-1 gap-3 md:grid-cols-6">{cards.map((render, i) => render(spans[i]))}</div>}
      {!overview && live && !overviewQuery.isError && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none" />
          ))}
        </div>
      )}

      {hasAnyPermission(...DEFAULT_CASE_VIEW_PERMISSIONS) && <OpenDefaultCasesCard projectId={project.id} />}

      <LiveGeospatialMap project={project} evidenceLogs={evidenceLogs} />

      {hasPermission("kpis:view") && live && <ProjectKpisCard projectId={project.id} />}
    </div>
  );
}
