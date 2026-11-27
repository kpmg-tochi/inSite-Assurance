import React from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ExternalLink, Info, MinusCircle } from "lucide-react";
import type { NeedsSubmissionDto } from "@insite/shared";
import { formatDateTimeShort } from "../../../lib/formatters";
import { getCycleDocumentLink } from "../../../api/needsPipeline";
import { useOpenNeedsFileMutation } from "../../../mutations/needs/useNeedsMutations";
import { usePortfolioActionMutation } from "../../../mutations/needs/useApprovalMutations";
import { cardCls, locationText, money, plural } from "../needsUi";
import { ApprovalDecisionForm } from "./ApprovalDecisionForm";
import { LineText } from "./PortfolioBuilder";
import { ActionsHistory, ChainSteps, DistributionPanel, SubmissionStatusTag } from "./submissionUi";

/**
 * Needs pipeline wave 4 (C1, plan section 9 "Approval review"): one portfolio (DI) or State approval
 * (MG) submission: how many and how much, where they are (zone, State, LGA), what was excluded and
 * why, the chain's steps and decisions, the signed memo, and the decision form for the step's holder.
 */
export function SubmissionReview({ submission, cycleId, approvalLabel }: { submission: NeedsSubmissionDto; cycleId: string; approvalLabel: string }) {
  const act = usePortfolioActionMutation(cycleId);
  const openFile = useOpenNeedsFileMutation();
  const included = submission.items.filter((i) => i.included);
  const excluded = submission.items.filter((i) => !i.included);
  const open = submission.status === "IN_REVIEW";

  return (
    <div className="space-y-4">
      <section className={`${cardCls} space-y-3`} aria-labelledby="submission-heading">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 id="submission-heading" className="text-sm font-bold text-slate-900">
              {approvalLabel}
            </h3>
            <p className="text-[11px] text-slate-500">
              {submission.submittedAt
                ? `Submitted by ${submission.submittedByName ?? "someone"}, ${formatDateTimeShort(submission.submittedAt)}`
                : "Not submitted yet"}
              {submission.decidedAt ? ` · decided ${formatDateTimeShort(submission.decidedAt)}` : ""}
            </p>
          </div>
          <SubmissionStatusTag status={submission.status} label={submission.statusLabel} />
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure label="Included" value={String(submission.includedCount)} />
          <Figure label="Total" value={money(submission.totalNgn)} />
          <Figure label="Excluded" value={String(excluded.length)} />
          <Figure label="Listed" value={String(submission.items.length)} />
        </dl>
        {submission.memoDocumentId && (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-primary hover:underline disabled:opacity-50"
            disabled={openFile.isPending}
            onClick={() => openFile.mutate(() => getCycleDocumentLink(cycleId, submission.memoDocumentId!))}
          >
            Open the signed approval memo <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <section className={`${cardCls} space-y-2 xl:col-span-7`} aria-labelledby="submission-distribution">
          <h3 id="submission-distribution" className="text-sm font-bold text-slate-900">
            Where the included projects are
          </h3>
          <DistributionPanel items={included} />
        </section>
        <section className={`${cardCls} space-y-3 xl:col-span-5`} aria-labelledby="submission-steps">
          <h3 id="submission-steps" className="text-sm font-bold text-slate-900">
            Approval steps
          </h3>
          <ChainSteps submission={submission} />
          <h4 className="pt-1 text-xs font-bold text-slate-900">Decisions</h4>
          <ActionsHistory actions={submission.actions} />
        </section>
      </div>

      {open && submission.canAct && (
        <ApprovalDecisionForm
          submission={submission}
          cycleId={cycleId}
          portfolio
          pending={act.isPending}
          onDecide={(body, done) => act.mutate(body, { onSuccess: done })}
        />
      )}
      {open && !submission.canAct && submission.cannotActReason && (
        <p role="status" className="flex items-start gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {submission.cannotActReason}
        </p>
      )}

      <section className={`${cardCls} space-y-2`} aria-labelledby="submission-items">
        <h3 id="submission-items" className="text-sm font-bold text-slate-900">
          Proposed projects ({submission.items.length})
        </h3>
        <div className="overflow-x-auto rounded-xl border border-slate-200" tabIndex={0} role="region" aria-label="Proposed projects on the list">
          <table className="w-full min-w-[880px] text-xs">
            <thead className="bg-slate-50">
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                <th scope="col" className="w-14 px-3 py-1.5 text-right">Rank</th>
                <th scope="col" className="px-3 py-1.5">Proposed project</th>
                <th scope="col" className="px-3 py-1.5">Location</th>
                <th scope="col" className="w-24 px-3 py-1.5">Funding line</th>
                <th scope="col" className="w-32 px-3 py-1.5 text-right">Amount</th>
                <th scope="col" className="px-3 py-1.5">On the list</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...submission.items]
                .sort((a, b) => Number(b.included) - Number(a.included) || (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.reference.localeCompare(b.reference))
                .map((i) => (
                  <tr key={i.proposalId} className={i.included ? "" : "bg-slate-50/70"}>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{i.rank ?? "–"}</td>
                    <td className="px-3 py-2">
                      <Link to={`/app/needs-assessment/proposals/${i.proposalId}`} className="font-semibold text-brand-primary hover:underline">
                        {i.reference}
                      </Link>
                      <span className="block text-slate-700">{i.title}</span>
                      {i.projectId && (
                        <Link to={`/app/projects/${i.projectId}/setup`} className="text-[11px] font-semibold text-brand-primary hover:underline">
                          Project {i.projectCode ?? ""}
                        </Link>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {locationText(i.stateCode, i.lgaCodes)}
                      <span className="block text-[11px] text-slate-500">{plural(i.siteCount, "site")}</span>
                    </td>
                    <td className="px-3 py-2">
                      <LineText aboveLine={i.aboveLine} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-900">{money(i.amountNgn)}</td>
                    <td className="px-3 py-2">
                      {i.included ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-800">
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Included
                        </span>
                      ) : (
                        <span className="text-slate-700">
                          <span className="inline-flex items-center gap-1 font-semibold">
                            <MinusCircle className="h-3.5 w-3.5" aria-hidden="true" /> Excluded
                          </span>
                          {i.exclusionReason && <span className="block text-[11px] text-slate-600">{i.exclusionReason}</span>}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-sm font-bold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}
