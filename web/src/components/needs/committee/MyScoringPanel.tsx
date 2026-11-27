import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ChevronDown, ChevronRight, Circle, Info } from "lucide-react";
import type { NeedsCommitteeDto, NeedsCycleDto } from "@insite/shared";
import { formatDateTimeShort } from "../../../lib/formatters";
import { useMyScoringQuery } from "../../../queries/needs/useCommitteeQueries";
import { cardCls, EmptyPanel, money } from "../needsUi";
import { DeclarationForm, type DeclarableProposal } from "./DeclarationForm";
import { ScoreSheetForm } from "./ScoreSheetForm";
import { RecusedChip, linkButtonCls, secondaryButtonCls } from "./committeeUi";

/**
 * D2: the member's side. The declaration comes first; then the proposed projects to score (recused
 * ones greyed with the reason), one score sheet at a time, and the progress. A member only ever sees
 * their own sheets here (D-N.10: independent scores).
 */
export function MyScoringPanel({
  cycle,
  committee,
  declarable,
  cycleOpen,
}: {
  cycle: NeedsCycleDto;
  committee: NeedsCommitteeDto;
  declarable: readonly DeclarableProposal[];
  cycleOpen: boolean;
}) {
  const me = committee.me!;
  const myRow = committee.members.find((m) => m.id === me.memberId) ?? null;
  const finalised = Boolean(committee.rankingFinalisedAt);
  const [changingDeclaration, setChangingDeclaration] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const scoringQuery = useMyScoringQuery(cycle.id, me.declared);
  const headingRefs = useRef(new Map<string, HTMLElement | null>());

  useEffect(() => {
    if (openId) headingRefs.current.get(openId)?.focus();
  }, [openId]);

  if (!me.declared || changingDeclaration) {
    return (
      <section className={cardCls} aria-label="Your declaration">
        <DeclarationForm
          cycleId={cycle.id}
          proposals={declarable}
          initial={myRow?.conflictDeclaredAt ? { conflictedProposalIds: myRow.conflictedProposalIds, statement: myRow.conflictStatement } : null}
          onDone={() => setChangingDeclaration(false)}
          onCancel={changingDeclaration ? () => setChangingDeclaration(false) : undefined}
        />
      </section>
    );
  }

  const data = scoringQuery.data;
  const eligible = data?.items.filter((i) => !i.recusal) ?? [];
  const scored = eligible.filter((i) => i.sheet).length;
  const pct = eligible.length ? Math.round((scored / eligible.length) * 100) : 0;
  const readOnly = !data?.canScore || finalised || !cycleOpen;

  return (
    <section className={cardCls} aria-labelledby="my-scoring-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="my-scoring-heading" className="text-sm font-bold text-slate-900">
            Your scoring
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">
            {myRow?.conflictedProposalIds.length
              ? `Declared ${myRow.conflictedProposalIds.length === 1 ? "1 conflict" : `${myRow.conflictedProposalIds.length} conflicts`}`
              : "Declared: no conflict of interest"}
            {myRow?.conflictDeclaredAt && ` on ${formatDateTimeShort(myRow.conflictDeclaredAt)}`}
            {!finalised && cycleOpen && (
              <>
                {" · "}
                <button type="button" className={linkButtonCls} onClick={() => setChangingDeclaration(true)}>
                  Update declaration
                </button>
              </>
            )}
          </p>
        </div>
        {data && eligible.length > 0 && (
          <div className="w-full max-w-xs">
            <p className="text-xs font-semibold text-slate-800">
              {scored} of {eligible.length} scored
            </p>
            <div
              className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"
              role="progressbar"
              aria-label="Score sheets saved"
              aria-valuemin={0}
              aria-valuemax={eligible.length}
              aria-valuenow={scored}
            >
              <div className="h-full rounded-full bg-brand-primary transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>

      {data && !data.canScore && data.cannotScoreReason && !finalised && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-700">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
          {data.cannotScoreReason}
        </p>
      )}
      {finalised && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          The ranking is finalised. Your sheets are read-only.
        </p>
      )}

      <div className="mt-3">
        {scoringQuery.isLoading && <p className="text-xs text-slate-500">Loading your proposed projects…</p>}
        {scoringQuery.isError && <p className="text-xs font-medium text-rose-700">{(scoringQuery.error as Error)?.message || "Could not load your score sheets."}</p>}
        {data && data.items.length === 0 && <EmptyPanel title="Nothing to score yet">Proposed projects come here once they are validated and costed.</EmptyPanel>}
        {data && data.items.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {data.items.map((item) => {
              const open = openId === item.proposalId;
              const panelId = `score-panel-${item.proposalId}`;
              if (item.recusal) {
                return (
                  <li key={item.proposalId} className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
                    <span className="font-semibold">{item.reference}</span>
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    <RecusedChip reason={item.recusal} />
                  </li>
                );
              }
              return (
                <li key={item.proposalId}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-xs">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded text-left font-semibold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                      aria-expanded={open}
                      aria-controls={panelId}
                      onClick={() => setOpenId(open ? null : item.proposalId)}
                    >
                      {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
                      {item.reference}
                    </button>
                    <span className="min-w-0 flex-1 text-slate-700">{item.title}</span>
                    <span className="tabular-nums text-slate-600">{money(item.costedAmountNgn)}</span>
                    {item.sheet ? (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Scored
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                        <Circle className="h-3 w-3" aria-hidden="true" /> Not scored
                      </span>
                    )}
                    <button type="button" className={secondaryButtonCls} aria-controls={panelId} aria-expanded={open} onClick={() => setOpenId(open ? null : item.proposalId)}>
                      {open ? "Hide" : readOnly ? "View" : item.sheet ? "Edit scores" : "Score"}
                    </button>
                  </div>
                  {open && (
                    <div id={panelId} className="border-t border-slate-100 bg-slate-50/50 px-3 py-3">
                      <h3
                        ref={(el) => {
                          headingRefs.current.set(item.proposalId, el);
                        }}
                        tabIndex={-1}
                        className="mb-2 text-xs font-bold text-slate-900 focus:outline-none"
                      >
                        Score {item.reference}{" "}
                        <Link className={`${linkButtonCls} ml-1 font-normal`} to={`/app/needs-assessment/proposals/${item.proposalId}`}>
                          Open the proposed project
                        </Link>
                      </h3>
                      <ScoreSheetForm
                        key={item.sheet?.submittedAt ?? "new"}
                        cycleId={cycle.id}
                        rubric={cycle.config.rubric}
                        proposalId={item.proposalId}
                        reference={item.reference}
                        sheet={item.sheet}
                        readOnly={readOnly}
                        onSaved={() => {
                          const next = eligible.find((i) => !i.sheet && i.proposalId !== item.proposalId);
                          setOpenId(next?.proposalId ?? null);
                        }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
