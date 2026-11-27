import React from "react";
import { Link } from "react-router-dom";
import { Sprout } from "lucide-react";
import { useProjectNeedsOriginQuery } from "../../../queries/needs/useIntegrationQueries";
import { money } from "../needsUi";
import { OutsideCycleChip } from "./OriginChip";

/**
 * Needs pipeline wave 4 (C5): the project Overview's "Origin" card. A project from the needs pipeline
 * or an out-of-cycle request shows its proposed project (reference, linked to the proposal page for
 * holders of `needs:view` on its cycle), the costed, approved and funded amounts, its rank and the
 * number of needs assessment versions. Older and imported projects get one line.
 */
export function ProjectOriginCard({ projectId }: { projectId: string }) {
  const query = useProjectNeedsOriginQuery(projectId);
  if (query.isLoading || query.isError || !query.data) return null;
  const { proposal, origin, originLabel } = query.data;

  if (!proposal) {
    return (
      <p className="rounded-2xl border border-slate-200/80 bg-white px-4 py-2.5 text-xs text-slate-600 shadow-sm">
        <span className="font-semibold text-slate-900">Origin:</span> {originLabel}
      </p>
    );
  }

  const facts: Array<{ label: string; value: string }> = [
    { label: "Programme", value: `${proposal.projectTypeName} ${proposal.interventionYear}` },
    { label: "Costed", value: money(proposal.costedAmountNgn) },
    { label: "Approved", value: money(proposal.approvedAmountNgn) },
    { label: "Funded", value: money(proposal.fundedAmountNgn) },
    ...(proposal.rank !== null ? [{ label: "Rank", value: String(proposal.rank) }] : []),
    { label: "Needs assessment versions", value: String(proposal.versionCount) },
  ];

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm" aria-labelledby={`origin-${projectId}`}>
      <div className="flex items-start gap-3">
        <Sprout className="mt-0.5 h-4 w-4 shrink-0 text-brand-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={`origin-${projectId}`} className="text-sm font-bold text-slate-900">
              Origin
            </h2>
            {origin === "OUT_OF_CYCLE" ? <OutsideCycleChip /> : <span className="text-xs text-slate-600">{originLabel}</span>}
          </div>
          <p className="text-xs text-slate-700">
            {proposal.canOpenProposal ? (
              <Link to={`/app/needs-assessment/proposals/${proposal.id}`} className="font-semibold text-brand-primary hover:underline">
                {proposal.reference}
              </Link>
            ) : (
              <span className="font-semibold text-slate-900">{proposal.reference}</span>
            )}{" "}
            · {proposal.title}
            <span className="text-slate-500"> · {proposal.statusLabel}</span>
          </p>
          {proposal.outOfCycleReasonLabel && <p className="text-[11px] text-slate-600">Reason: {proposal.outOfCycleReasonLabel}</p>}
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
            {facts.map((f) => (
              <div key={f.label} className="flex items-baseline gap-1.5">
                <dt className="text-slate-500">{f.label}</dt>
                <dd className="font-semibold tabular-nums text-slate-900">{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
