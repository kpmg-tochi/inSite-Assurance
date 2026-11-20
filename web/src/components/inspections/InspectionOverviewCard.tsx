import React from "react";
import { Link } from "react-router-dom";
import { ClipboardCheck } from "lucide-react";
import { INSPECTION_OVERALL_FINDING_LABELS, INSPECTION_VISIT_TYPE_LABELS, InspectionVisitTypeEnum } from "@insite/shared";
import { useInspectionOverviewQuery } from "../../queries/inspections/useInspectionQueries";

/**
 * Phase 14: project overview of site inspections: the last inspection per visit type, the next
 * inspection due, open findings, missed visits and whether the baseline survey is complete.
 */
export function InspectionOverviewCard({ projectId, compact = false }: { projectId: string; compact?: boolean }) {
  const q = useInspectionOverviewQuery(projectId);
  if (q.isLoading) return <div className="h-24 rounded-2xl bg-slate-100 animate-pulse" />;
  if (!q.data) return null;
  const o = q.data;
  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-3" aria-label="Site inspections">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-slate-900 inline-flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-brand-primary" /> Site inspections
        </h2>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${o.baselineComplete ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}
          title="An accepted baseline survey records the site before works start"
        >
          {o.baselineComplete ? "Baseline complete" : "No accepted baseline survey"}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-[11px] text-slate-500">Next inspection due</p>
          <p className="font-semibold text-slate-900">
            {o.nextDue ? `${o.nextDue.streamLabel}: by ${new Date(o.nextDue.dueAt).toLocaleDateString()}` : "Nothing scheduled"}
          </p>
          {o.nextDue?.status === "MISSED" && <p className="text-[11px] font-semibold text-red-600">Missed</p>}
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-[11px] text-slate-500">Open findings</p>
          <p className={`text-lg font-bold ${o.openFindings > 0 ? "text-amber-700" : "text-slate-900"}`}>{o.openFindings}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-[11px] text-slate-500">Missed inspections</p>
          <p className={`text-lg font-bold ${o.missedInspections > 0 ? "text-red-600" : "text-slate-900"}`}>{o.missedInspections}</p>
        </div>
        {!compact && (
          <div className="rounded-xl bg-slate-50 p-3">
            <Link to={`/app/projects/${projectId}/inspections`} className="text-[11px] font-semibold text-brand-primary hover:underline">
              Open inspections →
            </Link>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        {InspectionVisitTypeEnum.options.map((v) => {
          const last = o.lastByVisitType[v];
          return (
            <div key={v} className="rounded-xl border border-slate-200 p-3">
              <p className="text-[11px] text-slate-500">Last {INSPECTION_VISIT_TYPE_LABELS[v].toLowerCase()}</p>
              {last ? (
                <Link to={`/app/projects/${projectId}/inspections?inspectionId=${last.id}`} className="font-semibold text-slate-900 hover:underline">
                  {last.visitDate} · {INSPECTION_OVERALL_FINDING_LABELS[last.overallFinding]}
                  {last.status === "PENDING_APPROVAL" ? " · awaiting approval" : ""}
                </Link>
              ) : (
                <p className="text-slate-400">None yet</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
