import React from "react";
import { EyeOff, Lock } from "lucide-react";
import { NeedsStageEnum, type NeedsCycleDto, type NeedsProposalDetailDto, type NeedsRubric, type ScoreSheetDto } from "@insite/shared";
import { formatDateTimeShort } from "../../../lib/formatters";
import { useCommitteeQuery, useProposalScoresQuery } from "../../../queries/needs/useCommitteeQueries";
import { cardCls, EmptyPanel } from "../needsUi";
import { DivergenceMark, LineChip, RECUSAL_REASON_LABELS, hidesCombinedScores, scoreText } from "./committeeUi";

/**
 * Needs pipeline wave 3, Track D: the proposal page's Scores tab: total, Impact, Ease, rank, the
 * funding line, sheets (independent until the ranking is finalised), divergence and recusals.
 */
export function ProposalScoresTab({ proposal, cycle }: { proposal: NeedsProposalDetailDto; cycle: NeedsCycleDto | null }) {
  const stages = NeedsStageEnum.options;
  const reached = stages.indexOf(proposal.stage) >= stages.indexOf("PRIORITISATION") || proposal.scoreTotal !== null;
  const committeeQuery = useCommitteeQuery(reached ? proposal.cycleId : null);
  const scoresQuery = useProposalScoresQuery(proposal.id, reached);

  if (!reached) {
    return <EmptyPanel title="Not scored yet">The committee scores proposed projects at Prioritisation, once they are validated and costed.</EmptyPanel>;
  }
  if (scoresQuery.isLoading) {
    return (
      <div role="status" className="h-32 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none">
        <span className="sr-only">Loading the scores…</span>
      </div>
    );
  }
  if (scoresQuery.isError || !scoresQuery.data) {
    return <EmptyPanel title="The scores could not be loaded">{(scoresQuery.error as Error)?.message || "Try again in a moment."}</EmptyPanel>;
  }

  const s = scoresQuery.data;
  const rubric = cycle?.config.rubric ?? null;
  const hideCombined = hidesCombinedScores(committeeQuery.data);

  return (
    <div className="space-y-4">
      {hideCombined ? (
        <p className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-700 shadow-sm">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
          Members score independently: the combined score, the rank and the funding line are shown to you once the chair finalises the ranking.
        </p>
      ) : (
        <section className={cardCls} aria-labelledby="scores-summary-heading">
          <h2 id="scores-summary-heading" className="text-sm font-bold text-slate-900">
            Score
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Fact label="Total (0–100)" value={<span className="text-lg font-bold text-slate-900">{scoreText(s.score?.total)}</span>} />
            <Fact label="Impact" value={scoreText(s.score?.impact)} />
            <Fact label="Ease" value={scoreText(s.score?.ease)} />
            <Fact label="Rank" value={s.rank ?? "–"} />
            <Fact
              label="Funding line"
              value={
                <span className="space-y-1">
                  <LineChip above={s.aboveLine} />
                  {s.lineOverrideReason && <span className="block text-[11px] font-normal text-slate-700">Override: {s.lineOverrideReason}</span>}
                </span>
              }
            />
            <Fact label="Score sheets" value={`${s.sheetCount} of ${s.eligibleCount}`} />
          </dl>
          <div className="mt-3 text-xs text-slate-700">
            <p className="mb-1 font-semibold text-slate-800">Divergence</p>
            {s.divergent.length === 0 ? (
              <p className="text-slate-500">No sub-criterion is scored {rubric ? `${rubric.divergenceThreshold} or more points` : "far"} apart.</p>
            ) : (
              <DivergenceMark divergent={s.divergent} threshold={rubric?.divergenceThreshold} />
            )}
          </div>
        </section>
      )}

      <section className={cardCls} aria-labelledby="scores-sheets-heading">
        <h2 id="scores-sheets-heading" className="text-sm font-bold text-slate-900">
          Score sheets
        </h2>
        {s.sheetsHidden && (
          <p className="mt-1 flex items-start gap-2 text-xs text-slate-600">
            <EyeOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
            Sheets are independent until the ranking is finalised: {s.sheets.length ? "only your own sheet is shown" : "they are shown once the chair finalises the ranking"}.
          </p>
        )}
        {s.sheets.length === 0 ? (
          !s.sheetsHidden && <p className="mt-2 text-xs text-slate-500">No score sheet saved yet.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {s.sheets.map((sheet) => (
              <SheetView key={sheet.id} sheet={sheet} rubric={rubric} />
            ))}
          </div>
        )}
      </section>

      <section className={cardCls} aria-labelledby="scores-recusals-heading">
        <h2 id="scores-recusals-heading" className="text-sm font-bold text-slate-900">
          Recusals
        </h2>
        {s.recusals.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">No committee member is recused from this proposed project.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-xs text-slate-700">
            {s.recusals.map((r) => (
              <li key={`${r.memberName}-${r.reason}`}>
                <span className="font-semibold text-slate-900">{r.memberName}</span>: {RECUSAL_REASON_LABELS[r.reason].toLowerCase()}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 p-2.5">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-800">{value}</dd>
    </div>
  );
}

function SheetView({ sheet, rubric }: { sheet: ScoreSheetDto; rubric: NeedsRubric | null }) {
  const criteria = rubric?.criteria.length
    ? rubric.criteria.map((c) => ({ key: c.key, label: c.label, dimension: rubric.dimensions.find((d) => d.key === c.dimension)?.label ?? c.dimension }))
    : Object.keys(sheet.scores).map((key) => ({ key, label: key, dimension: "" }));
  return (
    <div className="rounded-xl border border-slate-200">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-3 py-2 text-xs">
        <span className="font-semibold text-slate-900">{sheet.memberName}</span>
        <span className="text-slate-500">Saved {formatDateTimeShort(sheet.submittedAt)}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">Scores by {sheet.memberName}</caption>
          <thead className="text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-3 py-1.5 font-semibold">Criterion</th>
              <th scope="col" className="px-3 py-1.5 font-semibold">Dimension</th>
              <th scope="col" className="px-3 py-1.5 text-right font-semibold">Score (1–5)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {criteria.map((c) => (
              <tr key={c.key}>
                <th scope="row" className="px-3 py-1.5 font-normal text-slate-800">{c.label}</th>
                <td className="px-3 py-1.5 text-slate-600">{c.dimension}</td>
                <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{sheet.scores[c.key] ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sheet.comment && <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-700">"{sheet.comment}"</p>}
    </div>
  );
}
