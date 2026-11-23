import React from "react";
import { Link } from "react-router-dom";
import { CalendarClock, Gavel } from "lucide-react";
import { useDefaultCasesQuery, useMilestonesQuery } from "../../queries/contracts/useContractQueries";
import { DaysLeft, DEFAULT_CASE_STATUS_META, MILESTONE_STATUS_META, StatusChip } from "./contractUi";

/** Phase 13: compact "Next deadlines" card for the project overview (next 3 open milestones + overdue count). */
export function NextDeadlinesCard({ projectId }: { projectId: string }) {
  const q = useMilestonesQuery(projectId);
  if (q.isLoading) return <div className="h-24 rounded-2xl bg-slate-100 animate-pulse" />;
  if (!q.data || q.data.milestones.length === 0) return null;
  const open = q.data.milestones
    .filter((m) => m.status !== "DONE" && m.status !== "WAIVED")
    .sort((a, b) => (a.dueDate ?? "9999-99-99").localeCompare(b.dueDate ?? "9999-99-99") || a.sortOrder - b.sortOrder);
  const next = open.slice(0, 3);
  const overdue = q.data.summary.overdue;
  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-3" aria-label="Next deadlines">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-slate-900 inline-flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-brand-primary" /> Next deadlines
        </h2>
        <div className="flex items-center gap-3">
          {overdue > 0 && <StatusChip label={`${overdue} overdue`} cls={MILESTONE_STATUS_META.OVERDUE.cls} />}
          <Link to={`/app/projects/${projectId}/milestones`} className="text-[11px] font-semibold text-brand-primary hover:underline">
            All milestones →
          </Link>
        </div>
      </div>
      {next.length === 0 ? (
        <p className="text-xs text-slate-500">Every contract milestone is done or waived.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {next.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-xs">
              <span className="min-w-0">
                <span className="font-semibold text-slate-900">{m.label}</span>
                <span className="text-slate-500">
                  {m.contractorName ? ` · ${m.contractorName}` : ""} · {m.dueDate ?? "no date yet"}
                </span>
              </span>
              <span className="shrink-0">
                <DaysLeft daysLeft={m.daysLeft} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Phase 13: "Open default cases" card for the project overview; renders nothing when there are none. */
export function OpenDefaultCasesCard({ projectId }: { projectId: string }) {
  const q = useDefaultCasesQuery(projectId, { openOnly: true });
  const cases = q.data ?? [];
  if (cases.length === 0) return null;
  return (
    <section className="bg-white rounded-2xl border border-rose-200 p-5 shadow-sm space-y-3" aria-label="Open default cases">
      <h2 className="text-sm font-bold text-slate-900 inline-flex items-center gap-2">
        <Gavel className="w-4 h-4 text-rose-600" /> Open default cases ({cases.length})
      </h2>
      <ul className="divide-y divide-slate-100">
        {cases.map((c) => {
          const s = DEFAULT_CASE_STATUS_META[c.status];
          const current = c.approval.steps.find((st) => st.state === "CURRENT");
          return (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-xs">
              <Link to={`/app/projects/${projectId}/milestones?case=${c.id}`} className="min-w-0 hover:underline">
                <span className="font-semibold text-slate-900">{c.contractorName}</span>
                <span className="text-slate-500">
                  {c.milestoneLabel ? ` · ${c.milestoneLabel}` : ""}
                  {current ? ` · waiting on ${current.label}` : ""}
                </span>
              </Link>
              <StatusChip label={s.label} cls={s.cls} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
