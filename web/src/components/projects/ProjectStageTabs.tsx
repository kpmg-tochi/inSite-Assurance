import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Check } from "lucide-react";
import type { ProjectStageSummary } from "@insite/shared";
import { useAuth } from "../../lib/auth-context";
import { currentStageSegment, parseAppLocation, STAGE_PAGES } from "../../navigation/navItems";

const SEGMENT_OF: Record<string, string> = {
  milestones: "kickoff",
  boq: "scope",
  schedule: "scope",
  handover: "completion",
  retention: "completion",
  closure: "completion",
};

/**
 * UBEC rebrand: the three stage pages of a project as a stepper (numbered steps on a line, a tick on
 * the stages the project has passed), so it reads as the project's progression and not as a second
 * tab bar. The open page is the raised step. Each stage is its own page and URL (notification links
 * keep working). Pages put their own tab bar on the same row.
 */
export function ProjectStageTabs({ projectId, stage }: { projectId: string; stage: ProjectStageSummary | null | undefined }) {
  const { hasAnyPermission } = useAuth();
  const location = useLocation();
  const here = parseAppLocation(location.pathname, location.search).segment;
  const active = SEGMENT_OF[here] ?? here;
  const current = currentStageSegment(stage);
  const order = STAGE_PAGES.map((p) => p.segment as string);
  const pages = STAGE_PAGES.filter((p) => hasAnyPermission(...p.anyOf));
  if (pages.length < 2) return null;

  return (
    <nav aria-label="Project cycle">
      <ol className="flex flex-wrap items-center gap-y-2">
        {pages.map((p, i) => {
          const n = order.indexOf(p.segment) + 1;
          const selected = p.segment === active;
          const done = order.indexOf(p.segment) < order.indexOf(current);
          const isCurrent = p.segment === current;
          return (
            <li key={p.segment} className="flex items-center">
              {i > 0 && <span className="mx-1.5 h-px w-6 sm:w-10 bg-slate-300" aria-hidden="true" />}
              <Link
                to={`/app/projects/${projectId}/${p.segment}`}
                aria-current={selected ? "page" : undefined}
                className={`group inline-flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary ${
                  selected ? "bg-white shadow-sm ring-1 ring-slate-200 font-semibold text-slate-900" : "font-medium text-slate-600 hover:bg-white/70 hover:text-slate-900"
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${
                    done
                      ? "bg-brand-primary text-white"
                      : isCurrent
                        ? "border-2 border-brand-primary text-brand-primary bg-white"
                        : "border border-slate-300 text-slate-500 bg-white"
                  }`}
                  aria-hidden="true"
                >
                  {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : n}
                </span>
                {p.label}
                {isCurrent && <span className="sr-only"> (the project's current stage)</span>}
                {done && <span className="sr-only"> (done)</span>}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
