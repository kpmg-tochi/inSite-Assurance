import React from "react";
import { SCHOOL_LEVEL_LABELS } from "@insite/shared";
import { useProjectSitesQuery } from "../../queries/sites";
import { SiteStatusChip, sitePercentText } from "./siteStatus";

/**
 * Client demo updates C2 (wave 2): the project overview's site list (multi-site projects only):
 * each site's school, LGA, status and % complete. Renders nothing for a single-site project.
 */
export function ProjectSitesCard({ projectId, enabled = true }: { projectId: string; enabled?: boolean }) {
  const { data } = useProjectSitesQuery(projectId, enabled);
  const sites = data?.sites ?? [];
  if (sites.length === 0) return null;
  const behind = sites.filter((s) => s.status === "BEHIND").length;
  const done = sites.filter((s) => s.status === "COMPLETED" || s.status === "HANDED_OVER").length;

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm" aria-labelledby="project-sites-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="project-sites-heading" className="text-sm font-bold text-slate-900">
          Sites
        </h2>
        <p className="text-xs text-slate-500">
          {sites.length} site{sites.length === 1 ? "" : "s"}
          {done > 0 && ` · ${done} completed`}
          {behind > 0 && <span className="font-semibold text-rose-700"> · {behind} behind</span>}
        </p>
      </div>
      <ul className="mt-2 divide-y divide-slate-100">
        {sites.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
            <span className="w-14 shrink-0 text-xs font-semibold text-slate-500 tabular-nums">Site {s.siteNumber}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-slate-900" title={s.schoolName}>
                {s.schoolName}
              </span>
              <span className="block text-[11px] text-slate-500">
                {SCHOOL_LEVEL_LABELS[s.schoolLevel]}
                {s.lgaName && ` · ${s.lgaName} LGA`}
                {!s.located && " · not located yet"}
              </span>
            </span>
            <span className="w-24 shrink-0">
              <span className="block text-xs font-semibold text-slate-800 tabular-nums">{sitePercentText(s.progressPct)}</span>
              <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
                <span className="block h-full rounded-full bg-brand-primary" style={{ width: `${Math.min(100, Math.max(0, s.progressPct ?? 0))}%` }} />
              </span>
            </span>
            <SiteStatusChip status={s.status} className="w-28 shrink-0" />
          </li>
        ))}
      </ul>
    </section>
  );
}
