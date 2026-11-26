import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Star } from "lucide-react";
import { z } from "zod";
import { FieldError, canSubmit, fieldA11y, invalidClass, useZodForm } from "../../lib/forms";
import {
  CONTRACTOR_RATING_STAGE_META,
  type ContractorRatingStage,
  type ProjectRatingsDto,
} from "@insite/shared";
import Loader from "../Loader";
import { ModalActions, ModalShell, inputClass } from "../common/ModalShell";
import { useProjectRatingsQuery } from "../../queries/closure/useClosureQueries";
import { useRateContractorMutation } from "../../mutations/closure/useClosureMutations";
import { CollapsibleSection, primaryAction } from "./closureUi";

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

/**
 * Phase 15: contractor ratings on the Project closure tab (hidden from contractors unless shared).
 * `readOnly`: an archived project (the server refuses every write but the closure pack).
 * Design round 2026-11-26: a collapsible sub-section, open when the caller has a rating to give.
 */
export function ContractorRatingsPanel({ projectId, readOnly = false }: { projectId: string; readOnly?: boolean }) {
  const query = useProjectRatingsQuery(projectId);
  const [rating, setRating] = useState<{ contractor: ContractorRow; stage: ContractorRatingStage } | null>(null);
  if (query.isLoading) return <Loader />;
  if (query.isError || !query.data) return null;
  const data = query.data;
  const all = data.contractors.flatMap((c) => c.ratings);
  const overall = all.length ? all.reduce((n, r) => n + r.overallScore, 0) / all.length : null;
  const toRate = data.canRate && !readOnly && data.contractors.some((c) => data.openStages.some((s) => !c.myRatedStages.includes(s)));
  const hint = `${overall !== null ? `Average ${overall.toFixed(2)} of 5 from ${all.length} rating${all.length === 1 ? "" : "s"}` : "Not rated yet"} · ${
    data.sharedWithContractor ? "shared with the contractor" : "not shown to the contractor"
  }`;
  return (
    <CollapsibleSection title="Contractor performance" hint={hint} defaultOpen={toRate}>
      <div className="space-y-3">
        <p className="text-xs text-slate-600">
          Rated at completion (from handover on) and after closure on {data.criteria.map((c) => c.label.toLowerCase()).join(", ")}.
        </p>
        <ul className="divide-y divide-slate-100">
          {data.contractors.map((c) => {
            const average = c.ratings.length ? c.ratings.reduce((n, r) => n + r.overallScore, 0) / c.ratings.length : null;
            const stages = data.canRate && !readOnly ? data.openStages.filter((s) => !c.myRatedStages.includes(s)) : [];
            return (
              <li key={c.projectContractorId} className="space-y-2 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs">
                    <Link to={`/app/organizations/${c.organizationId}/ratings`} className="font-semibold text-slate-900 hover:text-brand-primary hover:underline">
                      {c.organizationName}
                    </Link>{" "}
                    <span className="text-slate-600">
                      ({c.tradeCode}
                      {c.contractStatus === "TERMINATED" ? ", terminated" : ""})
                    </span>
                    {average !== null && (
                      <span className="ml-2 inline-flex items-center gap-1 text-slate-700">
                        <ScoreStars score={average} /> {average.toFixed(2)}
                      </span>
                    )}
                  </div>
                  {stages.length > 0 && (
                    <div className="flex gap-2">
                      {stages.map((stage) => (
                        <button key={stage} type="button" onClick={() => setRating({ contractor: c, stage })} className={primaryAction}>
                          Rate {CONTRACTOR_RATING_STAGE_META[stage].label.toLowerCase()}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {c.ratings.length === 0 ? (
                  <p className="text-[11px] text-slate-600">No ratings yet.</p>
                ) : (
                  <ul className="space-y-1">
                    {c.ratings.map((r) => (
                      <li key={r.id} className="text-[11px] text-slate-600">
                        <span className="font-semibold text-slate-800">{r.overallScore.toFixed(2)}</span> · {CONTRACTOR_RATING_STAGE_META[r.stage].label.toLowerCase()} by {r.ratedByName ?? "—"} ·{" "}
                        {r.criteria.map((x) => `${x.label} ${x.score}`).join(", ")}
                        {r.comments ? ` — “${r.comments}”` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        {!data.canRate && data.openStages.length === 0 && <p className="text-[11px] text-slate-600">Rating opens when the project enters handover.</p>}
      </div>
      {rating && <RateModal projectId={projectId} criteria={data.criteria} contractor={rating.contractor} stage={rating.stage} onClose={() => setRating(null)} />}
    </CollapsibleSection>
  );
}

/** RateContractorRequestSchema: every criterion scored 1 to 5, comments up to 2000 characters. */
function rateFormSchema(criteria: ProjectRatingsDto["criteria"]) {
  return z.object({
    scores: z.object(
      Object.fromEntries(
        criteria.map((c) => [
          c.key,
          z.number({ required_error: `Score ${c.label.toLowerCase()}`, invalid_type_error: `Score ${c.label.toLowerCase()}` }).int().min(1).max(5),
        ])
      ) as Record<string, z.ZodNumber>
    ),
    comments: z.string().trim().max(2000, "The comments are too long (at most 2000 characters)"),
  });
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
  const schema = useMemo(() => rateFormSchema(criteria), [criteria]);
  const form = useZodForm(schema, { defaultValues: { scores: {}, comments: "" } });
  const scores = form.watch("scores");
  return (
    <ModalShell title={`Rate ${contractor.organizationName}`} subtitle={CONTRACTOR_RATING_STAGE_META[stage].label} onClose={onClose}>
      <form
        className="space-y-3 p-5"
        noValidate
        onSubmit={form.handleSubmit((v) =>
          rate.mutate(
            {
              projectContractorId: contractor.projectContractorId,
              stage,
              criteria: criteria.map((c) => ({ key: c.key, score: v.scores[c.key] })),
              comments: v.comments || null,
            },
            { onSuccess: onClose }
          )
        )}
      >
        {criteria.map((c) => (
          <div key={c.key} className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs">
              <div className="font-semibold text-slate-800">{c.label}</div>
              {c.description && <div className="text-[11px] text-slate-500">{c.description}</div>}
              <FieldError form={form} name={`scores.${c.key}`} />
            </div>
            <div className="flex gap-1" role="radiogroup" aria-label={c.label}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={scores?.[c.key] === n}
                  // Radio group pattern: one tab stop (the chosen score, else 1); arrows, Home and End choose.
                  tabIndex={(scores?.[c.key] ?? 1) === n ? 0 : -1}
                  onKeyDown={(e) => {
                    const next =
                      e.key === "ArrowRight" || e.key === "ArrowUp" ? (n % 5) + 1
                      : e.key === "ArrowLeft" || e.key === "ArrowDown" ? ((n + 3) % 5) + 1
                      : e.key === "Home" ? 1
                      : e.key === "End" ? 5
                      : null;
                    if (next === null) return;
                    e.preventDefault();
                    form.setValue(`scores.${c.key}`, next, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
                    (e.currentTarget.parentElement?.children[next - 1] as HTMLElement | undefined)?.focus();
                  }}
                  onClick={() => form.setValue(`scores.${c.key}`, n, { shouldValidate: true, shouldDirty: true, shouldTouch: true })}
                  className={`h-7 w-7 rounded-lg border text-xs font-semibold ${
                    scores?.[c.key] === n ? "border-brand-primary bg-brand-primary text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        ))}
        <textarea
          rows={3}
          className={`${inputClass} ${invalidClass(form, "comments")}`}
          placeholder="Comments (optional)"
          aria-label="Comments (optional)"
          maxLength={2000}
          {...form.register("comments")}
          {...fieldA11y(form, "comments")}
        />
        <FieldError form={form} name="comments" />
        <ModalActions
          onCancel={onClose}
          submitLabel="Save rating"
          pendingLabel="Saving…"
          isPending={rate.isPending}
          disabled={!canSubmit(form, { pending: rate.isPending })}
        />
      </form>
    </ModalShell>
  );
}
