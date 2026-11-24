import React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, X } from "lucide-react";
import type { SupervisorWorkloadDto } from "@insite/shared";
import Drawer from "../Drawer";
import { supervisorWarnings } from "./supervisorWarnings";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 py-1.5 text-xs last:border-b-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-semibold text-slate-800">{children}</dd>
    </div>
  );
}

/** Settings → Supervisors: one supervisor's sites, spread, limits and warnings. */
export function SupervisorDetailDrawer({
  supervisor: w,
  organizationName,
  onClose,
}: {
  supervisor: SupervisorWorkloadDto;
  organizationName: string | null;
  onClose: () => void;
}) {
  const warnings = supervisorWarnings(w);
  return (
    <Drawer onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 shrink-0">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold text-slate-900">{w.fullName}</h3>
          <p className="text-[11px] text-slate-500">
            {w.roleName}
            {organizationName ? ` · ${organizationName}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-5 text-xs">
        {warnings.length > 0 ? (
          <div className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
            {warnings.map((text) => (
              <p key={text} className="flex items-start gap-1.5 font-semibold">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{text.charAt(0).toUpperCase() + text.slice(1)}.</span>
              </p>
            ))}
            <p className="text-[11px] text-amber-800">A warning only: they can still be assigned to more projects.</p>
          </div>
        ) : (
          <p className="text-slate-600">
            {w.maxSitesPerSupervisor === null && w.maxSpreadKm === null ? "Their project types set no workload limits." : "Within the workload limits."}
          </p>
        )}

        <dl>
          <Row label="Live sites">{w.activeProjectCount}</Row>
          <Row label="Site limit">{w.maxSitesPerSupervisor ?? "No limit"}</Row>
          <Row label="Distance between sites">{w.spreadKm !== null ? `${w.spreadKm} km` : "Not enough located sites"}</Row>
          <Row label="Distance limit">{w.maxSpreadKm !== null ? `${w.maxSpreadKm} km` : "No limit"}</Row>
        </dl>

        <section aria-labelledby="supervisor-sites-heading" className="space-y-2">
          <h4 id="supervisor-sites-heading" className="text-xs font-bold text-slate-900">
            Sites
          </h4>
          {w.projects.length === 0 ? (
            <p className="text-slate-500">No live sites.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {w.projects.map((p) => (
                <li key={p.projectId} className="flex items-start justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <Link to={`/app/projects/${p.projectId}/visits`} className="font-semibold text-slate-900 hover:underline">
                      {p.codePrefix}
                    </Link>
                    <p className="truncate text-slate-600">{p.name}</p>
                  </div>
                  <p className="shrink-0 text-right text-slate-500">
                    Last visit
                    <span className="block font-semibold text-slate-800">{p.lastVisitDate ?? "None yet"}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Drawer>
  );
}
