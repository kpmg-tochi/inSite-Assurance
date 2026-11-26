import type React from "react";
import { Link } from "react-router-dom";
import {
  VISIT_CONFIRMATION_LABELS,
  VISIT_KIND_META,
  VISIT_STATUS_LABELS,
  type OverviewDeadline,
  type OverviewNextVisit,
  type OverviewSprint,
  type ProjectOverviewDto,
  type SprintStatus,
} from "@insite/shared";
import { StatusText, type StatusTone } from "../common/StatusText";
import { fmtDay, fmtRange, plural } from "./overviewFormat";

const SPRINT_STATUS: Record<SprintStatus, { text: string; tone: StatusTone }> = {
  UPCOMING: { text: "Upcoming", tone: "neutral" },
  ACTIVE: { text: "In progress", tone: "good" },
  ENDED: { text: "Ended, not verified yet", tone: "pending" },
  LATE: { text: "Verification late", tone: "bad" },
  VERIFIED: { text: "Verified", tone: "good" },
};
const OUTCOME = {
  MET: { text: "met", tone: "good" },
  PARTLY_MET: { text: "partly met", tone: "pending" },
  NOT_MET: { text: "not met", tone: "bad" },
} as const satisfies Record<string, { text: string; tone: StatusTone }>;

/** One item of the panel: its name, a headline, up to two lines and one link. */
function Item({ title, headline, lines = [], link }: { title: string; headline: React.ReactNode; lines?: React.ReactNode[]; link?: { to: string; label: string } | null }) {
  const shown = lines.filter(Boolean);
  return (
    <div className="min-w-0 py-3 first:pt-0 last:pb-0">
      <h3 className="text-xs font-semibold text-slate-500">{title}</h3>
      <div className="mt-1 text-sm font-semibold leading-snug text-slate-900">{headline}</div>
      {shown.length > 0 && (
        <div className="mt-0.5 space-y-0.5 text-xs text-slate-600">
          {shown.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
      {link && (
        <Link
          to={link.to}
          className="mt-1.5 inline-block rounded text-xs font-semibold text-brand-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
        >
          {link.label}
        </Link>
      )}
    </div>
  );
}

function visitItem(projectId: string, visit: OverviewNextVisit | null, today: string) {
  if (!visit) {
    return (
      <Item
        key="visit"
        title="Next monitoring visit"
        headline="None planned"
        lines={["No monitoring visit is planned from today."]}
        link={{ to: `/app/projects/${projectId}/visits`, label: "Monitoring visits" }}
      />
    );
  }
  const status = visit.status === "PLANNED" ? VISIT_CONFIRMATION_LABELS[visit.confirmation] : VISIT_STATUS_LABELS[visit.status];
  return (
    <Item
      key="visit"
      title="Next monitoring visit"
      headline={`${VISIT_KIND_META[visit.visitKind]?.label ?? visit.visitKind} · ${visit.plannedDate === today ? "today" : fmtDay(visit.plannedDate)}`}
      lines={[
        status,
        visit.officerNames.length > 0 ? visit.officerNames.join(", ") : <StatusText key="o" tone="pending" label="No officer assigned" />,
      ]}
      link={{ to: `/app/projects/${projectId}/visits?visitId=${visit.id}`, label: "Open monitoring visit" }}
    />
  );
}

function deadlineItem(projectId: string, deadline: OverviewDeadline | null, overdueMilestones: number | null) {
  const overdueLine =
    overdueMilestones !== null && overdueMilestones > 0 ? (
      <StatusText key="m" tone="bad" label={`${plural(overdueMilestones, "contract milestone")} overdue`} />
    ) : null;
  const visitLink = deadline?.kind === "VISIT_SUBMISSION" && deadline.visitId ? `/app/projects/${projectId}/visits?visitId=${deadline.visitId}` : null;
  // The link follows the deadline shown: a monitoring report opens its monitoring visit.
  const link = visitLink
    ? { to: visitLink, label: "Open monitoring visit" }
    : overdueMilestones !== null
      ? { to: `/app/projects/${projectId}/kickoff?tab=milestones`, label: "Milestones" }
      : null;
  if (!deadline) return <Item key="deadline" title="Next deadline" headline="No open deadlines" lines={[overdueLine]} link={link} />;
  return (
    <Item
      key="deadline"
      title="Next deadline"
      headline={deadline.label}
      lines={[
        deadline.overdue ? (
          <StatusText key="d" tone="bad" label={`Overdue since ${fmtDay(deadline.dueDate)}`} />
        ) : (
          `${deadline.kind === "MILESTONE" ? "Milestone due" : "Monitoring report due"} ${fmtDay(deadline.dueDate)}`
        ),
        overdueLine,
      ]}
      link={link}
    />
  );
}

function sprintItem(projectId: string, sprint: OverviewSprint | null, hasSprints: boolean) {
  const link = { to: `/app/projects/${projectId}/scope`, label: "BoQ & work phases" };
  if (!hasSprints || !sprint) {
    return <Item key="sprint" title="Current work phase" headline="No work phases yet" lines={["Plan work phases to schedule the work."]} link={link} />;
  }
  const title = sprint.relation === "NEXT" ? "Next work phase" : sprint.relation === "LAST" ? "Last work phase" : "Current work phase";
  const status = SPRINT_STATUS[sprint.status];
  const outcome = sprint.verificationOutcome ? OUTCOME[sprint.verificationOutcome] : null;
  return (
    <Item
      key="sprint"
      title={title}
      headline={`Work phase ${sprint.number} of ${sprint.totalSprints}${sprint.name ? ` · ${sprint.name}` : ""}`}
      lines={[
        fmtRange(sprint.startDate, sprint.endDate),
        <span key="s" className="flex flex-wrap items-center gap-x-1.5">
          <StatusText tone={outcome?.tone ?? status.tone} label={`${status.text}${outcome ? ` (${outcome.text})` : ""}`} />
          <span>· {plural(sprint.activeUnitCount, "facility unit")}</span>
        </span>,
      ]}
      link={link}
    />
  );
}

/**
 * "Coming up": the next monitoring visit, the next deadline and the current (or next) work phase,
 * each with today's link target. `wide` lays the items side by side (when the panel spans the row).
 */
export function ComingUpPanel({
  projectId,
  overview,
  showVisit,
  showDeadline,
  wide = false,
  className = "",
}: {
  projectId: string;
  overview: ProjectOverviewDto;
  showVisit: boolean;
  showDeadline: boolean;
  wide?: boolean;
  className?: string;
}) {
  const items: React.ReactNode[] = [];
  if (showVisit) items.push(visitItem(projectId, overview.nextVisit, overview.today));
  if (showDeadline) items.push(deadlineItem(projectId, overview.nextDeadline, overview.overdueMilestoneCount));
  if (overview.hasSprints !== null) items.push(sprintItem(projectId, overview.currentSprint, overview.hasSprints));
  if (items.length === 0) return null;
  return (
    <section className={`min-w-0 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5 ${className}`} aria-labelledby="overview-coming-up">
      <h2 id="overview-coming-up" className="text-sm font-semibold text-slate-900">
        Coming up
      </h2>
      <div
        className={`mt-3 ${
          wide
            ? "grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-3 sm:gap-4 sm:divide-y-0 sm:[&>div]:py-0"
            : "divide-y divide-slate-100"
        }`}
      >
        {items}
      </div>
    </section>
  );
}
