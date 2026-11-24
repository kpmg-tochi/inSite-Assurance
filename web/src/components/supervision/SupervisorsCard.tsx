import React from "react";
import { AlertTriangle } from "lucide-react";
import type { SupervisorWorkloadDto } from "@insite/shared";
import { useSupervisorsQuery, useTeamWorkloadQuery } from "../../queries/supervision/useSupervisionQueries";

/**
 * Phase 14: supervision workload. A supervisor is a user whose role a project type lists as a
 * supervisor role; their sites are their assigned live projects. The system warns above the
 * project type's limits (sites per supervisor, distance between sites) and never blocks.
 */

function warnings(w: SupervisorWorkloadDto): string[] {
  const out: string[] = [];
  if (w.overSiteLimit) out.push(`${w.activeProjectCount} sites, above the limit of ${w.maxSitesPerSupervisor}`);
  if (w.overSpread) out.push(`sites ${w.spreadKm} km apart, above ${w.maxSpreadKm} km`);
  return out;
}

export function SupervisorsCard() {
  const q = useSupervisorsQuery();
  const rows = q.data ?? [];
  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm space-y-4">
      <div className="border-b border-slate-100 pb-3">
        <h2 className="text-sm font-bold text-slate-900">Supervisors</h2>
        <p className="text-[11px] text-slate-500 mt-0.5">
          People in a project type's supervisor roles, with their live sites, the distance between them and their last visit per site.
        </p>
      </div>
      {q.isLoading && <p className="text-xs text-slate-500">Loading…</p>}
      {!q.isLoading && rows.length === 0 && <p className="text-xs text-slate-500">No supervisors: no project type names supervisor roles, or no one holds them.</p>}
      <ul className="divide-y divide-slate-100">
        {rows.map((w) => {
          const warn = warnings(w);
          return (
            <li key={w.userId} className="py-3 text-xs space-y-1">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-slate-900">
                  {w.fullName} <span className="font-normal text-slate-500">· {w.roleName}</span>
                </p>
                <p className="text-slate-600">
                  {w.activeProjectCount} site(s){w.spreadKm !== null ? ` · ${w.spreadKm} km spread` : ""}
                  {w.maxSitesPerSupervisor !== null ? ` · limit ${w.maxSitesPerSupervisor}` : ""}
                </p>
              </div>
              {warn.length > 0 && (
                <p className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                  <AlertTriangle className="w-3.5 h-3.5" /> {warn.join("; ")}
                </p>
              )}
              <ul className="text-[11px] text-slate-500 pl-2">
                {w.projects.map((p) => (
                  <li key={p.projectId}>
                    {p.codePrefix} {p.name} · last visit {p.lastVisitDate ?? "none"}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Team step: warns when people on the team would supervise too many or too spread-out sites. */
export function TeamWorkloadNotice({ projectId, userIds }: { projectId: string; userIds: string[] }) {
  const q = useTeamWorkloadQuery(projectId, userIds);
  const over = (q.data ?? []).filter((w) => w.overSiteLimit || w.overSpread);
  const counted = (q.data ?? []).filter((w) => w.maxSitesPerSupervisor !== null || w.maxSpreadKm !== null);
  if (counted.length === 0) return null;
  return (
    <div className={`rounded-xl border px-3 py-2 text-xs ${over.length ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700"}`} aria-live="polite">
      <p className="font-semibold inline-flex items-center gap-1">
        {over.length > 0 && <AlertTriangle className="w-3.5 h-3.5" />} Supervision workload (with this project)
      </p>
      <ul className="mt-1 space-y-0.5">
        {counted.map((w) => (
          <li key={w.userId}>
            {w.fullName}: {w.activeProjectCount} site(s){w.spreadKm !== null ? `, ${w.spreadKm} km apart` : ""}
            {warnings(w).length > 0 ? ` · ${warnings(w).join("; ")}` : ""}
          </li>
        ))}
      </ul>
      {over.length > 0 && <p className="mt-1 text-[11px]">This is a warning only; you can still assign them.</p>}
    </div>
  );
}
