import React, { useMemo } from "react";
import { Undo2 } from "lucide-react";
import type { NeedsCycleDto } from "@insite/shared";
import { useAuth } from "../../../lib/auth-context";
import { useCycleSubmissionsQuery } from "../../../queries/needs/useApprovalQueries";
import { useNeedsProposalsQuery } from "../../../queries/needs/useNeedsQueries";
import { EmptyPanel, cardCls } from "../needsUi";
import { OutOfCycleList } from "../outOfCycle/OutOfCycleList";
import { PortfolioBuilder } from "./PortfolioBuilder";
import { SubmissionReview } from "./SubmissionReview";
import { ActionsHistory } from "./submissionUi";

/**
 * Needs pipeline wave 4, Track C (C1): the cycle's Approvals tab. The latest portfolio (Direct
 * Intervention) or State approval (Matching Grants: SUBEB management review, then the Executive
 * Chairman's endorsement) and its review; while there is none, or after a return, the submitter
 * (`needs:submit_portfolio`, the cycle's own organisation) builds the list from the finalised
 * ranking. Below it, the cycle's out-of-cycle requests.
 */
export function ApprovalsTab({ cycle }: { cycle: NeedsCycleDto }) {
  const { hasPermission, user } = useAuth();
  const stateLevel = cycle.fundingGate === "BEAP_APPROVAL";
  const approvalLabel = stateLevel ? "State approval" : "Portfolio approval";
  const submissionsQuery = useCycleSubmissionsQuery(cycle.id, "PORTFOLIO");
  const proposalsQuery = useNeedsProposalsQuery(cycle.id, {});
  const latest = submissionsQuery.data?.[0] ?? null;
  const ownsCycle = Boolean(user && user.organizationId === cycle.owningOrganizationId);
  const canSubmit = ownsCycle && hasPermission("needs:submit_portfolio") && cycle.status === "OPEN";
  // The list is the annual proposals at Approval (out-of-cycle requests have their own chain).
  const atApproval = useMemo(
    () => (proposalsQuery.data ?? []).filter((p) => p.stage === "APPROVAL" && p.status === "IN_PROGRESS" && p.route === "ANNUAL"),
    [proposalsQuery.data]
  );
  const chain = cycle.config.approvalChains.NEEDS_PORTFOLIO;
  const building = !latest || latest.status === "RETURNED";

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-700 shadow-sm">
        <p className="font-semibold text-slate-900">{approvalLabel}</p>
        <p className="mt-0.5">
          {stateLevel
            ? "The SUBEB decides on the State's list: management reviews it and the Executive Chairman endorses it. Approved proposed projects go on to the BEAP."
            : "One decision on the list from the finalised ranking: management reviews it and the Executive Secretary approves it with a signed memo. Approved proposed projects go on to funding."}
        </p>
        {chain.length > 0 && <p className="mt-1 text-slate-500">Steps: {chain.map((s, i) => `${i + 1}. ${s.label}`).join(" → ")}</p>}
      </div>

      {(submissionsQuery.isLoading || (building && proposalsQuery.isLoading)) && (
        <div role="status" className="h-40 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none">
          <span className="sr-only">Loading the approval…</span>
        </div>
      )}
      {submissionsQuery.isError && (
        <p role="alert" className="text-xs font-medium text-rose-700">
          The approval could not be loaded.
        </p>
      )}

      {submissionsQuery.data && building && latest?.status === "RETURNED" && (
        <section className={`${cardCls} space-y-2 border-amber-200`} aria-labelledby="approval-returned">
          <h3 id="approval-returned" className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <Undo2 className="h-4 w-4 text-amber-700" aria-hidden="true" /> Returned for revision
          </h3>
          <ActionsHistory actions={latest.actions} />
        </section>
      )}

      {submissionsQuery.data && building && !proposalsQuery.isLoading && (
        canSubmit && atApproval.length > 0 ? (
          <PortfolioBuilder key={latest?.id ?? "new"} cycleId={cycle.id} proposals={atApproval} returned={latest} approvalLabel={approvalLabel} />
        ) : (
          <EmptyPanel title={latest ? "Waiting to be resubmitted" : "Not submitted yet"}>
            {atApproval.length === 0
              ? "Proposed projects reach Approval when the committee finalises the ranking. The list can be submitted then."
              : canSubmit
                ? null
                : stateLevel
                  ? "The SUBEB's procurement officer submits the list from the finalised ranking."
                  : "Procurement submits the list from the finalised ranking."}
          </EmptyPanel>
        )
      )}

      {latest && !building && <SubmissionReview submission={latest} cycleId={cycle.id} approvalLabel={approvalLabel} />}

      <OutOfCycleList cycle={cycle} />
    </div>
  );
}
