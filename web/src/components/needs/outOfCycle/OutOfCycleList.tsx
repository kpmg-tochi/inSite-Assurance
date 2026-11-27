import React, { useState } from "react";
import { Plus } from "lucide-react";
import type { NeedsCycleDto, NeedsOutOfCycleDto } from "@insite/shared";
import { StandardTable, TableBadge, type TableColumnDef } from "../../table";
import { useGuardedNavigate } from "../../../lib/navigationGuard";
import { useAuth } from "../../../lib/auth-context";
import { useOutOfCycleRequestsQuery } from "../../../queries/needs/useApprovalQueries";
import { useNeedsOptionsQuery } from "../../../queries/needs/useNeedsQueries";
import { formatDateShort } from "../../../lib/formatters";
import { ProposalStatusTag, money } from "../needsUi";
import { SubmissionStatusTag } from "../submissions/submissionUi";
import { OutOfCycleRequestDialog } from "./OutOfCycleRequestDialog";

/**
 * Needs pipeline wave 4 (C1, C4): the cycle's out-of-cycle requests on the Approvals tab, with their
 * approval status; a row opens the request page (where approvers decide). Requesters (`needs:submit`)
 * start a new one here for this cycle's programme and year.
 */
export const outOfCyclePath = (proposalId: string) => `/app/needs-assessment/out-of-cycle/${proposalId}`;

export function OutOfCycleList({ cycle }: { cycle: NeedsCycleDto }) {
  const { hasPermission } = useAuth();
  const navigate = useGuardedNavigate();
  const query = useOutOfCycleRequestsQuery(cycle.id);
  const canRequest = hasPermission("needs:submit");
  const options = useNeedsOptionsQuery(canRequest);
  const [creating, setCreating] = useState(false);
  const rows = query.data ?? [];

  const columns: TableColumnDef<NeedsOutOfCycleDto>[] = [
    {
      id: "request",
      header: "Request",
      cell: (r) => (
        <div className="min-w-0 max-w-[320px]">
          <div className="text-[11px] font-semibold text-slate-500 tabular-nums">{r.reference}</div>
          <div className="truncate font-semibold text-slate-900" title={r.title}>
            {r.title}
          </div>
        </div>
      ),
    },
    { id: "reason", header: "Reason", cell: (r) => <span className="text-xs text-slate-700">{r.reasonLabel}</span> },
    { id: "amount", header: "Amount requested", align: "right", cell: (r) => <span className="text-xs tabular-nums text-slate-900">{money(r.requestedAmountNgn)}</span> },
    { id: "status", header: "Status", cell: (r) => <ProposalStatusTag status={r.status} label={r.statusLabel} /> },
    {
      id: "approval",
      header: "Approval",
      cell: (r) => (
        <div className="flex flex-col items-start gap-0.5">
          <SubmissionStatusTag status={r.submission.status} label={r.submission.statusLabel} />
          {r.submission.canAct && r.submission.status === "IN_REVIEW" && <TableBadge variant="info">Waiting for you</TableBadge>}
        </div>
      ),
    },
    { id: "created", header: "Requested", cell: (r) => <span className="whitespace-nowrap text-[11px] text-slate-600">{formatDateShort(r.createdAt)}<span className="block text-slate-500">{r.createdByName}</span></span> },
  ];

  return (
    <>
      <StandardTable<NeedsOutOfCycleDto>
        title="Out-of-cycle requests"
        subtitle="Projects asked for outside the annual cycle in this programme and year, each with its own approval."
        headerActions={
          canRequest && options.data && options.data.programmes.length > 0 ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1 rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-brand-navy hover:bg-slate-100"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> New request
            </button>
          ) : undefined
        }
        columns={columns}
        data={rows}
        keyExtractor={(r) => r.proposalId}
        onRowClick={(r) => navigate(outOfCyclePath(r.proposalId))}
        loading={query.isLoading}
        minWidth="min-w-[860px]"
        emptyState={{ title: "No out-of-cycle requests", description: query.isError ? "The requests could not be loaded." : "None for this programme and year." }}
      />
      {creating && options.data && (
        <OutOfCycleRequestDialog
          options={options.data}
          initial={{ projectTypeId: cycle.projectTypeId, interventionYear: cycle.interventionYear, stateCode: cycle.stateCode }}
          onClose={() => setCreating(false)}
          onCreated={(r) => {
            setCreating(false);
            navigate(outOfCyclePath(r.proposalId));
          }}
        />
      )}
    </>
  );
}
