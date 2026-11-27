import React, { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, FileText, Flag, Lock, MoveVertical, RefreshCw, SlidersHorizontal } from "lucide-react";
import type { NeedsCommitteeDto, NeedsCycleDto, NeedsRankingDto, NeedsRankingRow } from "@insite/shared";
import { formatDateTimeShort } from "../../../lib/formatters";
import { getCycleDocumentLink } from "../../../api/needsPipeline";
import { useOpenNeedsFileMutation } from "../../../mutations/needs/useNeedsMutations";
import { useRankingReportMutation } from "../../../mutations/needs/useCommitteeMutations";
import { useRankingQuery } from "../../../queries/needs/useCommitteeQueries";
import { cardCls, EmptyPanel, locationText, money } from "../needsUi";
import { FinaliseDialog, FundingLineDialog, MinutesUploadButton, PlacementDialog } from "./RankingDialogs";
import { DivergenceMark, LineChip, currentDocuments, hidesCombinedScores, linkButtonCls, primaryButtonCls, scoreText, secondaryButtonCls } from "./committeeUi";

/**
 * D3: the ranking (live until finalised, then the stored ranks): scores, divergence marks, cost and
 * cumulative cost, the funding line drawn as a row with the ceiling and the total above it, and the
 * chair's overrides. The chair moves the line, overrides placements with a reason and finalises.
 * Everyone else with `needs:view` reads it; a committee member who is not the chair sees it only
 * after finalisation (independent scores).
 */
export function RankingPanel({ cycle, committee, cycleOpen }: { cycle: NeedsCycleDto; committee: NeedsCommitteeDto | null; cycleOpen: boolean }) {
  const hidden = hidesCombinedScores(committee);
  const rankingQuery = useRankingQuery(cycle.id, !hidden);
  const [placing, setPlacing] = useState<NeedsRankingRow | null>(null);
  const [movingLine, setMovingLine] = useState(false);
  const [finalising, setFinalising] = useState(false);
  const openFile = useOpenNeedsFileMutation();
  const report = useRankingReportMutation(cycle.id);

  if (hidden) {
    return (
      <section className={cardCls} aria-labelledby="ranking-heading">
        <h2 id="ranking-heading" className="text-sm font-bold text-slate-900">
          Ranking
        </h2>
        <p className="mt-1 flex items-start gap-2 text-xs text-slate-600">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
          Members score independently, so the combined scores and the ranking are shown to you once the chair finalises the ranking.
        </p>
      </section>
    );
  }

  if (rankingQuery.isLoading) return <p className="text-xs text-slate-500">Loading the ranking…</p>;
  if (rankingQuery.isError || !rankingQuery.data) {
    return <p className="text-xs font-medium text-rose-700">{(rankingQuery.error as Error)?.message || "Could not load the ranking."}</p>;
  }
  const ranking: NeedsRankingDto = rankingQuery.data;
  const chair = ranking.canManage && cycleOpen && !ranking.finalised;
  const rows = [...ranking.rows].sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || a.reference.localeCompare(b.reference));
  const rankedCount = rows.filter((r) => r.rank !== null).length;
  const linePosition = Math.min(ranking.linePosition, rankedCount);
  const aboveCount = rows.filter((r) => r.aboveLine).length;
  const lineMoved = ranking.linePosition !== ranking.computedLinePosition;
  const minutes = currentDocuments(cycle, "COMMITTEE_MINUTES");
  const portfolio = currentDocuments(cycle, "PRIORITISED_PROJECT_PORTFOLIO");
  const columns = chair ? 12 : 11;
  const finaliseBlockedId = "ranking-finalise-blocked";

  const lineRow = (
    <tr key="funding-line" className="bg-brand-primary/5">
      <td colSpan={columns} className="border-y-2 border-dashed border-brand-primary px-3 py-2 text-xs text-slate-800">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1 font-bold text-brand-primary">
            <Flag className="h-3.5 w-3.5" aria-hidden="true" /> Funding line
          </span>
          <span>Ceiling {ranking.ceilingNgn === null ? "not set" : money(ranking.ceilingNgn)}</span>
          <span>
            Above the line: <span className="font-semibold">{money(ranking.totalAboveNgn)}</span> ({aboveCount})
          </span>
          {lineMoved && (
            <span className="text-slate-700">
              Moved by the chair{ranking.lineReason ? `: ${ranking.lineReason}` : ""} (at the ceiling it sits after {ranking.computedLinePosition})
            </span>
          )}
        </span>
      </td>
    </tr>
  );

  const body: React.ReactNode[] = [];
  rows.forEach((row, i) => {
    if (i === linePosition) body.push(lineRow);
    body.push(<RankingRowView key={row.proposalId} row={row} quorum={ranking.quorum} threshold={cycle.config.rubric.divergenceThreshold} chair={chair} onOverride={() => setPlacing(row)} />);
  });
  if (linePosition >= rows.length) body.push(lineRow);

  return (
    <section className={cardCls} aria-labelledby="ranking-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="ranking-heading" className="text-sm font-bold text-slate-900">
            Ranking
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">
            {ranking.finalised
              ? `Finalised ${formatDateTimeShort(ranking.finalisedAt)}${ranking.finalisedByName ? ` by ${ranking.finalisedByName}` : ""}.`
              : "Live: it changes as members save their sheets."}{" "}
            Ties: higher Impact first, then lower cost. Quorum: {ranking.quorum} sheets.
          </p>
        </div>
        {chair && (
          <div className="flex flex-wrap items-start gap-2">
            <button type="button" className={secondaryButtonCls} onClick={() => setMovingLine(true)} disabled={rankedCount === 0}>
              <MoveVertical className="h-3.5 w-3.5" aria-hidden="true" /> Move the line
            </button>
            <button
              type="button"
              className={primaryButtonCls}
              onClick={() => setFinalising(true)}
              disabled={!ranking.canFinalise}
              aria-describedby={!ranking.canFinalise && ranking.cannotFinaliseReason ? finaliseBlockedId : undefined}
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Finalise
            </button>
          </div>
        )}
      </div>
      {chair && !ranking.canFinalise && ranking.cannotFinaliseReason && (
        <p id={finaliseBlockedId} className="mt-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {ranking.cannotFinaliseReason}
        </p>
      )}

      {ranking.finalised && (
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-950">
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 font-semibold">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> The proposed projects moved to Approval with their place against the funding line.
            </p>
            <DocumentLinks
              label="Prioritised Project Portfolio"
              docs={portfolio}
              empty="Not generated yet."
              onOpen={(id) => openFile.mutate(() => getCycleDocumentLink(cycle.id, id))}
            />
            <DocumentLinks label="Committee minutes" docs={minutes} empty="None uploaded." onOpen={(id) => openFile.mutate(() => getCycleDocumentLink(cycle.id, id))} />
          </div>
          {ranking.canManage && cycleOpen && (
            <div className="flex flex-wrap items-start gap-2">
              <button type="button" className={secondaryButtonCls} disabled={report.isPending} onClick={() => report.mutate()}>
                <RefreshCw className={`h-3.5 w-3.5 ${report.isPending ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
                {report.isPending ? "Generating…" : portfolio.length ? "Regenerate portfolio" : "Generate portfolio"}
              </button>
              <MinutesUploadButton cycleId={cycle.id} label={minutes.length ? "Upload other minutes" : "Upload minutes"} />
            </div>
          )}
        </div>
      )}

      <div className="mt-3">
        {rows.length === 0 ? (
          <EmptyPanel title="Nothing to rank yet">Proposed projects come here once they are validated and costed, and are ranked as the committee scores them.</EmptyPanel>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[1080px] text-left text-xs">
              <caption className="sr-only">Ranked proposed projects with scores, cost, cumulative cost and the funding line</caption>
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Rank</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Proposed project</th>
                  <th scope="col" className="px-3 py-2 font-semibold">State / LGAs</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Impact</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Ease</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Total</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Sheets</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Divergence</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Cost</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Cumulative</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Funding line</th>
                  {chair && (
                    <th scope="col" className="px-3 py-2 font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">{body}</tbody>
            </table>
          </div>
        )}
      </div>

      {placing && <PlacementDialog cycleId={cycle.id} row={placing} onClose={() => setPlacing(null)} />}
      {movingLine && <FundingLineDialog cycleId={cycle.id} ranking={ranking} onClose={() => setMovingLine(false)} />}
      {finalising && <FinaliseDialog cycleId={cycle.id} ranking={ranking} minutes={minutes} onClose={() => setFinalising(false)} />}
    </section>
  );
}

function RankingRowView({ row, quorum, threshold, chair, onOverride }: { row: NeedsRankingRow; quorum: number; threshold: number; chair: boolean; onOverride: () => void }) {
  const belowQuorum = row.sheetCount < quorum;
  return (
    <tr className={`align-top ${row.aboveLine ? "" : "bg-slate-50/60 text-slate-600"}`}>
      <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{row.rank ?? "–"}</td>
      <th scope="row" className="max-w-[16rem] px-3 py-2 font-normal">
        <Link className={linkButtonCls} to={`/app/needs-assessment/proposals/${row.proposalId}`}>
          {row.reference}
        </Link>
        <span className="block text-slate-700">{row.title}</span>
      </th>
      <td className="max-w-[12rem] px-3 py-2 text-slate-700">{locationText(row.stateCode, row.lgaCodes)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{scoreText(row.score?.impact)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{scoreText(row.score?.ease)}</td>
      <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{scoreText(row.score?.total)}</td>
      <td className="whitespace-nowrap px-3 py-2">
        <span className="tabular-nums">
          {row.sheetCount} of {row.eligibleCount}
        </span>
        {belowQuorum && (
          <span className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-amber-800">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Below quorum
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        <DivergenceMark divergent={row.divergent} threshold={threshold} />
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(row.costNgn)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(row.cumulativeNgn)}</td>
      <td className="px-3 py-2">
        <LineChip above={row.rank === null && row.placement === null ? null : row.aboveLine} />
        {row.placement && (
          <span className="mt-1 block max-w-[14rem] text-[11px] text-slate-700">
            <span className="font-semibold">Placed {row.placement === "ABOVE" ? "above" : "below"} the line</span>
            {row.placementReason ? `: ${row.placementReason}` : ""}
          </span>
        )}
      </td>
      {chair && (
        <td className="px-3 py-2">
          <button type="button" className={`${secondaryButtonCls} whitespace-nowrap px-2 py-1`} onClick={onOverride} aria-label={`Override the placement of ${row.reference}`}>
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" /> Override
          </button>
        </td>
      )}
    </tr>
  );
}

function DocumentLinks({ label, docs, empty, onOpen }: { label: string; docs: ReadonlyArray<{ id: string; title: string; fileName: string }>; empty: string; onOpen: (id: string) => void }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-semibold">{label}:</span>
      {docs.length === 0 ? (
        <span className="text-emerald-900/80">{empty}</span>
      ) : (
        docs.map((d) => (
          <button key={d.id} type="button" className={`${linkButtonCls} inline-flex items-center gap-1`} onClick={() => onOpen(d.id)}>
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            {d.fileName}
          </button>
        ))
      )}
    </p>
  );
}
