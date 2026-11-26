import React, { useId } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, X } from "lucide-react";
import type { ApprovedListRowDto, ApprovedListSummaryDto } from "@insite/shared";
import Drawer from "../Drawer";
import { formatNaira } from "../../lib/formatters";
import {
  APPROVED_LIST_PROJECT_TYPE,
  BudgetCheckLine,
  MatchStatusChip,
  lgaNames,
  listProvenance,
  projectLabel,
  stateName,
} from "./approvedListUi";
import { rowHasBudgetMismatch, rowStateCode } from "./approvedListRowFilters";

/** What the row's match status means, in one or two sentences. */
function matchExplanation(row: ApprovedListRowDto, tolerancePct: number): string {
  const hidden = row.matchStatus !== "NOT_LINKED" && row.linkedProjects.length === 0;
  switch (row.matchStatus) {
    case "NOT_LINKED":
      return "No project is linked to this row yet. Link it from the project's Project details (Approved list row).";
    case "LINKED":
      return `${hidden ? "A project you cannot see is linked to this row" : "One project is linked"}, and its budget is within ±${tolerancePct}% of the approved estimate.`;
    case "MISMATCH":
      return `${hidden ? "A project you cannot see is linked to this row, and its" : "The linked project's"} budget is more than ±${tolerancePct}% from the approved estimate: a red flag to resolve with the budget or the list.`;
    case "MULTIPLE":
      return `Several projects are linked to this row. Each row should match one project${rowHasBudgetMismatch(row) ? `, and at least one budget is more than ±${tolerancePct}% from the estimate` : ""}.`;
  }
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-xs text-slate-800">{children}</dd>
    </div>
  );
}

/**
 * Design refinement (2026-11-26): the full detail of one approved list row on the Needs assessment
 * page (description, project type, list and its provenance, schools, LGAs, facility scope, estimate,
 * linked projects with their budget check, and what the match status means).
 */
export function ApprovedListRowDrawer({
  row,
  list,
  tolerancePct,
  onClose,
}: {
  row: ApprovedListRowDto;
  list: ApprovedListSummaryDto | undefined;
  tolerancePct: number;
  onClose: () => void;
}) {
  const titleId = useId();
  const state = rowStateCode(row, list);
  const hiddenLinks = row.matchStatus !== "NOT_LINKED" && row.linkedProjects.length === 0;

  return (
    <Drawer onClick={(e) => e.target === e.currentTarget && onClose()} onClose={onClose} labelledBy={titleId}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Row {row.rowRef}</p>
            <h3 id={titleId} className="mt-0.5 text-sm font-bold text-slate-900">
              {row.projectTitle}
            </h3>
            <div className="mt-2">
              <MatchStatusChip status={row.matchStatus} />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          <section aria-label="Match" className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-700">
            {matchExplanation(row, tolerancePct)}
          </section>

          <section aria-labelledby={`${titleId}-projects`} className="space-y-2">
            <h4 id={`${titleId}-projects`} className="text-xs font-bold text-slate-900">
              Linked project{row.linkedProjects.length === 1 ? "" : "s"}
            </h4>
            {row.linkedProjects.length === 0 ? (
              <p className="text-xs text-slate-500">{hiddenLinks ? "Linked to a project you cannot see." : "Not linked."}</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {row.linkedProjects.map((p) => (
                  <li key={p.id} className="space-y-1.5 px-3 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900">{projectLabel(p)}</p>
                        <p className="truncate text-[11px] text-slate-500" title={p.name}>
                          {p.name}
                        </p>
                      </div>
                      <Link
                        to={`/app/projects/${p.id}/dashboard`}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-brand-primary hover:bg-brand-primary/5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                        aria-label={`Open ${projectLabel(p)}`}
                      >
                        Open <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    </div>
                    <p className="text-[11px] text-slate-600">
                      Budget {p.totalBudgetNgn === null ? "not set" : formatNaira(p.totalBudgetNgn)} · approved estimate {formatNaira(row.costEstimateNgn)}
                    </p>
                    {p.mismatch && <BudgetCheckLine mismatch={p.mismatch} />}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Detail label="Approved estimate">
              <span className="font-semibold tabular-nums">{formatNaira(row.costEstimateNgn)}</span>
            </Detail>
            <Detail label="Project type">{list ? APPROVED_LIST_PROJECT_TYPE[list.kind] : "–"}</Detail>
            <Detail label="State">{state ? stateName(state) : "–"}</Detail>
            <Detail label="LGAs">{row.lgaCodes.length ? lgaNames(row.lgaCodes) : "–"}</Detail>
            {row.lotTitle && (
              <div className="col-span-2">
                <Detail label="Lot">{row.lotTitle}</Detail>
              </div>
            )}
            <div className="col-span-2">
              <Detail label="Facility scope">
                <span className="whitespace-pre-line">{row.facilityScope ?? "–"}</span>
              </Detail>
            </div>
            <div className="col-span-2">
              <Detail label={`School${row.schoolNames.length === 1 ? "" : "s"}`}>
                {row.schoolNames.length === 0 ? (
                  "–"
                ) : (
                  <ul className="list-disc space-y-0.5 pl-4">
                    {row.schoolNames.map((s, i) => (
                      <li key={`${s}-${i}`}>{s}</li>
                    ))}
                  </ul>
                )}
              </Detail>
            </div>
            {list && (
              <div className="col-span-2">
                <Detail label="Approved list">
                  <span className="font-semibold">{list.title}</span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">{listProvenance(list)}</span>
                </Detail>
              </div>
            )}
          </dl>
        </div>
      </div>
    </Drawer>
  );
}
