import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ScheduleRevisionDto, ScheduleRevisionStatus } from "@insite/shared";
import { useDecideScheduleRevisionMutation } from "../../mutations/schedule/useScheduleMutations";
import { formatDateTimeShort } from "../../lib/formatters";

const STATUS_CLASSES: Record<ScheduleRevisionStatus, string> = {
  DRAFT: "bg-slate-50 text-slate-600 border-slate-200",
  PENDING_APPROVAL: "bg-amber-50 text-amber-800 border-amber-200",
  APPLIED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REJECTED: "bg-rose-50 text-rose-700 border-rose-200",
  WITHDRAWN: "bg-slate-50 text-slate-500 border-slate-200",
};
const STATUS_LABELS: Record<ScheduleRevisionStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Waiting for approval",
  APPLIED: "Applied",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

function DecisionControls({ projectId, revision }: { projectId: string; revision: ScheduleRevisionDto }) {
  const decide = useDecideScheduleRevisionMutation(projectId);
  const [notes, setNotes] = useState("");
  const run = (decision: "approve" | "reject") =>
    decide.mutate({ revisionId: revision.id, decision, notes: notes.trim() || undefined });
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
      <label className="block text-[11px] font-semibold text-slate-700" htmlFor={`notes-${revision.id}`}>
        Decision note (optional)
      </label>
      <textarea
        id={`notes-${revision.id}`}
        rows={2}
        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={2000}
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={decide.isPending}
          onClick={() => run("approve")}
          className="rounded-lg bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          Approve and apply
        </button>
        <button
          type="button"
          disabled={decide.isPending}
          onClick={() => run("reject")}
          className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

/** The proposer's own pending revision: take it back before anyone decides (no dates change). */
function WithdrawControl({ projectId, revision }: { projectId: string; revision: ScheduleRevisionDto }) {
  const decide = useDecideScheduleRevisionMutation(projectId);
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <div className="mt-3 flex items-center gap-3">
        <p className="text-[11px] text-slate-500">You proposed this revision. You can withdraw it while it waits for approval.</p>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Withdraw
        </button>
      </div>
    );
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-[11px] text-slate-600">Withdraw revision {revision.revisionNumber}? No dates change, and you can propose a new one.</p>
      <button
        type="button"
        disabled={decide.isPending}
        onClick={() => decide.mutate({ revisionId: revision.id, decision: "withdraw" })}
        className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
      >
        Withdraw revision
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100">
        Keep it
      </button>
    </div>
  );
}

/** Revision history with status, initiator, decider and a before/after diff per revision. */
export function RevisionHistory({
  projectId,
  revisions,
  initiallyOpenId,
}: {
  projectId: string;
  revisions: ScheduleRevisionDto[];
  initiallyOpenId?: string | null;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(initiallyOpenId ? [initiallyOpenId] : []));
  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (revisions.length === 0) {
    return <p className="text-xs text-slate-500">No revisions yet. The plan is the original baseline.</p>;
  }
  return (
    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
      {revisions.map((r) => {
        const isOpen = open.has(r.id);
        return (
          <li key={r.id} className="px-4 py-3">
            <button type="button" onClick={() => toggle(r.id)} className="flex w-full items-start gap-3 text-left" aria-expanded={isOpen}>
              {isOpen ? <ChevronDown className="mt-0.5 h-4 w-4 text-slate-400" /> : <ChevronRight className="mt-0.5 h-4 w-4 text-slate-400" />}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-slate-900">Revision {r.revisionNumber}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_CLASSES[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                  <span className="text-[11px] text-slate-500 tabular-nums">
                    End {r.previousProjectedEndDate ?? "–"} → {r.newProjectedEndDate ?? "–"} · {r.adjustments.length} item(s)
                  </span>
                </div>
                {!isOpen && <p className="mt-0.5 truncate text-[11px] text-slate-600">{r.reason}</p>}
                <p className="text-[10px] text-slate-400">
                  Proposed by {r.initiatedByName}, {formatDateTimeShort(r.createdAt)}
                  {r.status === "WITHDRAWN" && r.decidedAt && ` · withdrawn by the proposer, ${formatDateTimeShort(r.decidedAt)}`}
                  {r.status !== "WITHDRAWN" &&
                    r.decidedAt &&
                    (r.decidedByName
                      ? ` · ${r.status === "REJECTED" ? "rejected" : "approved"} by ${r.decidedByName}, ${formatDateTimeShort(r.decidedAt)}`
                      : " · applied without approval (end date unchanged)")}
                </p>
              </div>
            </button>
            {isOpen && (
              <div className="mt-3 pl-7">
                <p className="mb-2 whitespace-pre-wrap text-xs text-slate-700">{r.reason}</p>
                {r.decisionNotes && <p className="mb-2 text-[11px] text-slate-600">Decision note: {r.decisionNotes}</p>}
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                      <th className="py-1">WBS</th>
                      <th className="py-1">Before</th>
                      <th className="py-1">After</th>
                      <th className="py-1 text-right">Shift</th>
                      <th className="py-1">Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.adjustments.map((a) => (
                      <tr key={a.boqItemId} className="border-t border-slate-100">
                        <td className="py-1 font-mono text-[11px]">{a.wbsCode ?? a.boqItemId.slice(0, 8)}</td>
                        <td className="py-1 tabular-nums text-slate-500 line-through decoration-slate-300">
                          {a.previousStartDate} → {a.previousEndDate}
                        </td>
                        <td className="py-1 tabular-nums text-slate-900">
                          {a.newStartDate} → {a.newEndDate}
                        </td>
                        <td className="py-1 text-right tabular-nums">{a.shiftWorkdays > 0 ? `+${a.shiftWorkdays}` : a.shiftWorkdays}</td>
                        <td className="py-1 text-[11px] text-slate-500">{a.cause === "REQUESTED" ? "Chosen" : "Follows a predecessor"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {r.canDecide && <DecisionControls projectId={projectId} revision={r} />}
                {r.canWithdraw && <WithdrawControl projectId={projectId} revision={r} />}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
