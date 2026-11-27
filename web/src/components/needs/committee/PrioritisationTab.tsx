import React, { useMemo, useState } from "react";
import type { NeedsCycleDto, NeedsProposalStatus } from "@insite/shared";
import { Tabs, TabPanel } from "../../common/Tabs";
import { useCommitteeQuery } from "../../../queries/needs/useCommitteeQueries";
import { useNeedsProposalsQuery } from "../../../queries/needs/useNeedsQueries";
import { EmptyPanel, money } from "../needsUi";
import { CommitteePanel } from "./CommitteePanel";
import { MyScoringPanel } from "./MyScoringPanel";
import { RankingPanel } from "./RankingPanel";
import { ScoringStateChip, scoringState } from "./committeeUi";

/**
 * Needs pipeline wave 3, Track D (D1–D3): the cycle's Prioritisation tab. A member's own scoring
 * (declaration first), the committee (the chair appoints it and opens or closes scoring) and the
 * ranking with the funding line against the indicative ceiling.
 */

type Section = "mine" | "committee" | "ranking";

const CLOSED_STATUSES: readonly NeedsProposalStatus[] = ["CONVERTED", "NOT_VALIDATED", "NOT_SELECTED", "WITHDRAWN", "MERGED"];

export function PrioritisationTab({ cycle }: { cycle: NeedsCycleDto }) {
  const committeeQuery = useCommitteeQuery(cycle.id);
  const proposalsQuery = useNeedsProposalsQuery(cycle.id, {});
  const committee = committeeQuery.data ?? null;
  const cycleOpen = cycle.status === "OPEN";
  const [chosen, setChosen] = useState<Section | null>(null);

  const proposals = useMemo(() => proposalsQuery.data ?? [], [proposalsQuery.data]);
  const referenceById = useMemo(() => new Map(proposals.map((p) => [p.id, p.reference])), [proposals]);
  // Proposed projects a member may name in a declaration: the cycle's open ones, Prioritisation first.
  const declarable = useMemo(
    () =>
      proposals
        .filter((p) => !CLOSED_STATUSES.includes(p.status))
        .sort((a, b) => Number(b.stage === "PRIORITISATION") - Number(a.stage === "PRIORITISATION") || a.reference.localeCompare(b.reference))
        .map((p) => ({ id: p.id, reference: p.reference, title: p.title })),
    [proposals]
  );

  if (committeeQuery.isLoading) {
    return (
      <div role="status" className="h-32 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none">
        <span className="sr-only">Loading the committee…</span>
      </div>
    );
  }
  if (committeeQuery.isError || !committee) {
    return (
      <EmptyPanel title="The committee could not be loaded">
        {(committeeQuery.error as Error)?.message || "Try again in a moment."}
      </EmptyPanel>
    );
  }

  const state = scoringState(committee);
  const sections: Array<{ id: Section; label: string }> = [
    ...(committee.me ? [{ id: "mine" as const, label: "Your scoring" }] : []),
    { id: "committee", label: "Committee" },
    { id: "ranking", label: "Ranking" },
  ];
  const defaultSection: Section =
    committee.me && (!committee.me.declared || (committee.me.role === "MEMBER" && state === "OPEN"))
      ? "mine"
      : committee.canManage && (committee.members.length === 0 || state === "NOT_OPENED")
        ? "committee"
        : "ranking";
  const active: Section = chosen && sections.some((s) => s.id === chosen) ? chosen : defaultSection;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-700 shadow-sm">
        <ScoringStateChip state={state} />
        <span>
          Waiting at Prioritisation: <span className="font-semibold tabular-nums">{committee.proposalCount}</span>
        </span>
        <span>
          Quorum: <span className="font-semibold tabular-nums">{committee.quorum}</span> sheets
        </span>
        <span>
          Divergence flagged at <span className="font-semibold tabular-nums">{committee.divergenceThreshold}</span> points apart
        </span>
        <span>
          Indicative ceiling: <span className="font-semibold">{cycle.indicativeCeilingNgn === null ? "not set" : money(cycle.indicativeCeilingNgn)}</span>
        </span>
        {committee.me && committee.me.declared === false && (
          <span className="font-semibold text-amber-800">Declare your conflicts of interest to score.</span>
        )}
      </div>

      <Tabs tabs={sections} active={active} onChange={setChosen} label="Prioritisation" idPrefix="prioritisation" />

      <TabPanel idPrefix="prioritisation" id={active}>
        {active === "mine" && committee.me && <MyScoringPanel cycle={cycle} committee={committee} declarable={declarable} cycleOpen={cycleOpen} />}
        {active === "committee" && (
          <CommitteePanel cycleId={cycle.id} committee={committee} cycleOpen={cycleOpen} referenceOf={(id) => referenceById.get(id) ?? "A proposed project"} />
        )}
        {active === "ranking" && <RankingPanel cycle={cycle} committee={committee} cycleOpen={cycleOpen} />}
      </TabPanel>
    </div>
  );
}
