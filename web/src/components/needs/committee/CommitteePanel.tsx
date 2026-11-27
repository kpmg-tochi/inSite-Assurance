import React, { useState } from "react";
import { Lock, PlayCircle, Users } from "lucide-react";
import type { NeedsCommitteeDto } from "@insite/shared";
import { ModalShell } from "../../common/ModalShell";
import { formatDateTimeShort } from "../../../lib/formatters";
import { useCommitteeScoringMutation } from "../../../mutations/needs/useCommitteeMutations";
import { cardCls, EmptyPanel } from "../needsUi";
import { EditCommitteeDialog } from "./EditCommitteeDialog";
import { DeclaredChip, RECUSAL_REASON_LABELS, RoleChip, primaryButtonCls, scoringState, secondaryButtonCls } from "./committeeUi";

/**
 * D1: the committee (members, declarations, recusals, scoring progress) and, for the chair, the
 * membership and Open / Close scoring. Everyone with `needs:view` sees the membership read-only;
 * nobody sees another member's scores here.
 */
export function CommitteePanel({
  cycleId,
  committee,
  cycleOpen,
  referenceOf,
}: {
  cycleId: string;
  committee: NeedsCommitteeDto;
  cycleOpen: boolean;
  /** Proposal id → reference, for recusals. */
  referenceOf: (proposalId: string) => string;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const scoring = useCommitteeScoringMutation(cycleId);
  const state = scoringState(committee);
  const finalised = state === "FINALISED";
  const chairActions = committee.canManage && cycleOpen && !finalised;
  const undeclared = committee.members.filter((m) => !m.conflictDeclaredAt);
  const openBlocked =
    committee.members.length === 0
      ? "Appoint the committee first."
      : undeclared.length > 0
        ? `Waiting for ${undeclared.length === 1 ? "1 member" : `${undeclared.length} members`} to declare conflicts of interest: ${undeclared.map((m) => m.fullName).join(", ")}.`
        : null;
  const blockedId = "committee-open-blocked";

  return (
    <section className={cardCls} aria-labelledby="committee-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="committee-heading" className="text-sm font-bold text-slate-900">
            Committee
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">
            {committee.members.length === 0
              ? "No committee yet."
              : `${committee.members.length} ${committee.members.length === 1 ? "person" : "people"} · ${committee.members.length - undeclared.length} declared`}
            {committee.scoringOpenedAt && state !== "NOT_OPENED" && (
              <> · scoring opened {formatDateTimeShort(committee.scoringOpenedAt)}{committee.scoringOpenedByName ? ` by ${committee.scoringOpenedByName}` : ""}</>
            )}
            {state === "CLOSED" && committee.scoringClosedAt && <> · closed {formatDateTimeShort(committee.scoringClosedAt)}</>}
          </p>
        </div>
        {chairActions && (
          <div className="flex flex-wrap items-start gap-2">
            <button type="button" className={secondaryButtonCls} onClick={() => setEditing(true)}>
              <Users className="h-3.5 w-3.5" aria-hidden="true" /> Edit committee
            </button>
            {state === "OPEN" ? (
              <button type="button" className={secondaryButtonCls} onClick={() => setConfirmClose(true)} disabled={scoring.isPending}>
                <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Close scoring
              </button>
            ) : (
              <button
                type="button"
                className={primaryButtonCls}
                disabled={Boolean(openBlocked) || scoring.isPending}
                aria-describedby={openBlocked ? blockedId : undefined}
                onClick={() => scoring.mutate({ action: "OPEN" })}
              >
                <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" /> {scoring.isPending ? "Opening…" : state === "CLOSED" ? "Reopen scoring" : "Open scoring"}
              </button>
            )}
          </div>
        )}
      </div>
      {chairActions && state !== "OPEN" && openBlocked && (
        <p id={blockedId} className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
          {openBlocked}
        </p>
      )}

      {committee.members.length === 0 ? (
        <div className="mt-3">
          <EmptyPanel title="No committee yet">
            {committee.canManage
              ? "Appoint the members who score the proposed projects. You chair the committee."
              : "The chair appoints the committee. Its members and their declarations will be shown here."}
          </EmptyPanel>
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-[720px] w-full text-left text-xs">
            <caption className="sr-only">Committee members, their declarations, recusals and scoring progress</caption>
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Name</th>
                <th scope="col" className="px-3 py-2 font-semibold">Committee role</th>
                <th scope="col" className="px-3 py-2 font-semibold">Declaration</th>
                <th scope="col" className="px-3 py-2 font-semibold">Recusals</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Scored</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">To score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...committee.members]
                .sort((a, b) => (a.role === b.role ? a.fullName.localeCompare(b.fullName) : a.role === "CHAIR" ? -1 : 1))
                .map((m) => (
                  <tr key={m.id} className="align-top">
                    <th scope="row" className="px-3 py-2 font-normal">
                      <span className="block font-semibold text-slate-900">{m.fullName}</span>
                      <span className="text-[11px] text-slate-500">{m.roleName}</span>
                    </th>
                    <td className="px-3 py-2">
                      <RoleChip role={m.role} />
                    </td>
                    <td className="px-3 py-2">
                      <DeclaredChip declared={Boolean(m.conflictDeclaredAt)} conflicts={m.conflictedProposalIds.length} />
                      {m.conflictDeclaredAt && <span className="mt-0.5 block text-[11px] text-slate-500">{formatDateTimeShort(m.conflictDeclaredAt)}</span>}
                      {m.conflictStatement && <span className="mt-0.5 block max-w-xs text-[11px] text-slate-600">"{m.conflictStatement}"</span>}
                    </td>
                    <td className="px-3 py-2">
                      {m.recusals.length === 0 ? (
                        <span className="text-slate-400">None</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {m.recusals.map((r) => (
                            <li key={`${r.proposalId}-${r.reason}`} className="text-slate-700">
                              <span className="font-semibold">{referenceOf(r.proposalId)}</span>: {RECUSAL_REASON_LABELS[r.reason].toLowerCase()}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.scoredCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.toScoreCount}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <EditCommitteeDialog cycleId={cycleId} committee={committee} onClose={() => setEditing(false)} />}
      {confirmClose && (
        <ModalShell title="Close scoring" onClose={() => setConfirmClose(false)}>
          <div className="space-y-3 p-5 text-xs text-slate-700">
            <p>Members can no longer save score sheets once scoring is closed. Proposed projects with fewer sheets than the quorum ({committee.quorum}) cannot be finalised.</p>
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
              <button type="button" className={secondaryButtonCls} onClick={() => setConfirmClose(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={primaryButtonCls}
                disabled={scoring.isPending}
                onClick={() => scoring.mutate({ action: "CLOSE" }, { onSuccess: () => setConfirmClose(false) })}
              >
                {scoring.isPending ? "Closing…" : "Close scoring"}
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </section>
  );
}
