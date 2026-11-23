import React from "react";
import { useParams } from "react-router-dom";
import { Star } from "lucide-react";
import { CONTRACTOR_RATING_STAGE_META } from "@insite/shared";
import Loader from "../../components/Loader";
import { ScoreStars } from "../../components/closure/ContractorRatingsPanel";
import { useOrganizationRatingsQuery } from "../../queries/closure/useClosureQueries";

/**
 * Phase 15: a contractor organisation's performance ratings across the projects the viewer can see
 * (average per criterion and every rating). The contractor's own users see only ratings that a
 * project shares with them.
 */
export function OrganizationRatingsPage() {
  const { organizationId } = useParams();
  const query = useOrganizationRatingsQuery(organizationId);
  if (query.isLoading) return <Loader />;
  if (query.isError || !query.data) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">These ratings are not available to you.</div>;
  }
  const d = query.data;
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <Star className="mt-1 h-5 w-5 text-brand-primary" />
        <div>
          <h1 className="text-lg font-bold text-slate-900">{d.organizationName}</h1>
          <p className="text-xs text-slate-500">
            Contractor performance: {d.ratingCount} rating(s) on {d.projectCount} project(s)
            {d.averageOverall !== null ? `, average ${d.averageOverall.toFixed(2)} of 5` : ""}.
          </p>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {d.perCriterion.map((c) => (
          <div key={c.key} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{c.label}</div>
            <div className="mt-1 text-xl font-bold text-slate-900">{c.average !== null ? c.average.toFixed(2) : "—"}</div>
            {c.average !== null && <ScoreStars score={c.average} />}
            <div className="text-[11px] text-slate-500">{c.count} score(s)</div>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white">
        {d.ratings.length === 0 ? (
          <p className="p-6 text-center text-xs text-slate-500">No ratings yet.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Project</th>
                <th className="px-4 py-2">Stage</th>
                <th className="px-4 py-2">Overall</th>
                <th className="px-4 py-2">Scores</th>
                <th className="px-4 py-2">Rated by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {d.ratings.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-2 font-semibold text-slate-800">
                    {r.projectCode} <span className="font-normal text-slate-500">{r.projectName}</span>
                  </td>
                  <td className="px-4 py-2">{CONTRACTOR_RATING_STAGE_META[r.stage].label}</td>
                  <td className="px-4 py-2 font-semibold">{r.overallScore.toFixed(2)}</td>
                  <td className="px-4 py-2 text-slate-600">
                    {r.criteria.map((c) => `${c.label} ${c.score}`).join(", ")}
                    {r.comments ? <div className="mt-0.5 text-slate-500">“{r.comments}”</div> : null}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {r.ratedByName ?? "—"}
                    <div className="text-[11px] text-slate-400">{new Date(r.createdAt).toLocaleDateString("en-GB")}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
