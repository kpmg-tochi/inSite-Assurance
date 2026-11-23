import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Star } from "lucide-react";
import {
  CONTRACTOR_RATING_STAGE_META,
  type ContractorRatingStage,
  type ProjectRatingsDto,
} from "@insite/shared";
import Loader from "../Loader";
import { ModalActions, ModalShell, inputClass } from "../../pages/reconciliation/components/ModalShell";
import { useProjectRatingsQuery } from "../../queries/closure/useClosureQueries";
import { useRateContractorMutation } from "../../mutations/closure/useClosureMutations";

type ContractorRow = ProjectRatingsDto["contractors"][number];

export function ScoreStars({ score }: { score: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" title={`${score} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`h-3 w-3 ${n <= Math.round(score) ? "fill-amber-400 text-amber-400" : "text-slate-300"}`} />
      ))}
    </span>
  );
}

/** Phase 15: contractor ratings on the Closure tab (hidden from contractors unless shared). */
export function ContractorRatingsPanel({ projectId }: { projectId: string }) {
  const query = useProjectRatingsQuery(projectId);
  const [rating, setRating] = useState<{ contractor: ContractorRow; stage: ContractorRatingStage } | null>(null);
  if (query.isLoading) return <Loader />;
  if (query.isError || !query.data) return null;
  const data = query.data;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
      <div>
        <h2 className="text-sm font-bold text-slate-900">Contractor performance</h2>
        <p className="text-[11px] text-slate-500">
          Rated at completion (from handover on) and after closure on {data.criteria.map((c) => c.label.toLowerCase()).join(", ")}.{" "}
          {data.sharedWithContractor ? "Shared with the contractor." : "Not shown to the contractor."}
        </p>
      </div>
      {data.contractors.map((c) => {
        const average = c.ratings.length ? c.ratings.reduce((n, r) => n + r.overallScore, 0) / c.ratings.length : null;
        return (
          <div key={c.projectContractorId} className="rounded-xl border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs">
                <Link to={`/app/organizations/${c.organizationId}/ratings`} className="font-semibold text-slate-900 hover:text-brand-primary hover:underline">
                  {c.organizationName}
                </Link>{" "}
                <span className="text-slate-500">
                  ({c.tradeCode}
                  {c.contractStatus === "TERMINATED" ? ", terminated" : ""})
                </span>
                {average !== null && (
                  <span className="ml-2 inline-flex items-center gap-1 text-slate-700">
                    <ScoreStars score={average} /> {average.toFixed(2)}
                  </span>
                )}
              </div>
              {data.canRate && (
                <div className="flex gap-2">
                  {data.openStages
                    .filter((s) => !c.myRatedStages.includes(s))
                    .map((stage) => (
                      <button
                        key={stage}
                        type="button"
                        onClick={() => setRating({ contractor: c, stage })}
                        className="rounded-xl border border-brand-primary px-3 py-1 text-[11px] font-semibold text-brand-primary hover:bg-brand-primary/5"
                      >
                        Rate {CONTRACTOR_RATING_STAGE_META[stage].label.toLowerCase()}
                      </button>
                    ))}
                </div>
              )}
            </div>
            {c.ratings.length === 0 ? (
              <p className="mt-2 text-[11px] text-slate-400">No ratings yet.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {c.ratings.map((r) => (
                  <li key={r.id} className="text-[11px] text-slate-600">
                    <span className="font-semibold text-slate-800">{r.overallScore.toFixed(2)}</span> · {CONTRACTOR_RATING_STAGE_META[r.stage].label.toLowerCase()} by {r.ratedByName ?? "—"} ·{" "}
                    {r.criteria.map((x) => `${x.label} ${x.score}`).join(", ")}
                    {r.comments ? ` — “${r.comments}”` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {!data.canRate && data.openStages.length === 0 && <p className="text-[11px] text-slate-500">Rating opens when the project enters handover.</p>}
      {rating && <RateModal projectId={projectId} criteria={data.criteria} contractor={rating.contractor} stage={rating.stage} onClose={() => setRating(null)} />}
    </section>
  );
}

function RateModal({
  projectId,
  criteria,
  contractor,
  stage,
  onClose,
}: {
  projectId: string;
  criteria: ProjectRatingsDto["criteria"];
  contractor: ContractorRow;
  stage: ContractorRatingStage;
  onClose: () => void;
}) {
  const rate = useRateContractorMutation(projectId);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comments, setComments] = useState("");
  const complete = criteria.every((c) => scores[c.key]);
  return (
    <ModalShell title={`Rate ${contractor.organizationName}`} subtitle={CONTRACTOR_RATING_STAGE_META[stage].label} onClose={onClose}>
      <form
        className="space-y-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          rate.mutate(
            {
              projectContractorId: contractor.projectContractorId,
              stage,
              criteria: criteria.map((c) => ({ key: c.key, score: scores[c.key] })),
              comments: comments.trim() || null,
            },
            { onSuccess: onClose }
          );
        }}
      >
        {criteria.map((c) => (
          <div key={c.key} className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs">
              <div className="font-semibold text-slate-800">{c.label}</div>
              {c.description && <div className="text-[11px] text-slate-500">{c.description}</div>}
            </div>
            <div className="flex gap-1" role="radiogroup" aria-label={c.label}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={scores[c.key] === n}
                  onClick={() => setScores((s) => ({ ...s, [c.key]: n }))}
                  className={`h-7 w-7 rounded-lg border text-xs font-semibold ${
                    scores[c.key] === n ? "border-brand-primary bg-brand-primary text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        ))}
        <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={3} className={inputClass} placeholder="Comments (optional)" maxLength={2000} />
        <ModalActions onCancel={onClose} submitLabel="Save rating" pendingLabel="Saving…" isPending={rate.isPending} disabled={!complete} />
      </form>
    </ModalShell>
  );
}
