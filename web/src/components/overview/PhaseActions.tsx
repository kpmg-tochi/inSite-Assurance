import React, { useState } from "react";
import { CONSTRUCTION_PHASE_LABELS, type ConstructionPhase, type ProjectPhaseTransitionDto } from "@insite/shared";
import { useProjectProcess } from "../../queries/process/useProcessQueries";
import { useProjectPhaseQuery } from "../../queries/closeout/useCloseoutQueries";
import { useChangeProjectPhaseMutation } from "../../mutations/closeout/useCloseoutMutations";
import { ModalShell, ModalActions, BlockedNotice, inputClass } from "../common/ModalShell";

export const PHASE_ACTION_LABEL: Record<ConstructionPhase, string> = {
  ACTIVE_CONSTRUCTION: "Back to construction",
  HANDOVER_IN_PROGRESS: "Start handover",
  RETENTION_PERIOD: "Start defects liability period",
  COMPLETED_CLOSED: "Close the project",
};

/**
 * Redesign R6c (D-R6.20): the phase-change actions, moved from the header banner to the Overview's
 * stage bar. Shown only when the handover or retention module is on and the caller may change the
 * phase (`canChangePhase`); a blocked transition shows its refusal text next to the button.
 */
export function PhaseActions({ projectId, projectStatus }: { projectId: string; projectStatus: string }) {
  const live = projectStatus === "ACTIVE";
  const processQuery = useProjectProcess(projectId, live);
  const config = processQuery.data?.config;
  const enabled = Boolean(config?.enableHandoverModule || config?.enableRetentionModule);
  const phaseQuery = useProjectPhaseQuery(projectId, enabled && live);
  const [target, setTarget] = useState<ProjectPhaseTransitionDto | null>(null);
  const phase = phaseQuery.data;
  if (!enabled || !phase) return null;

  const retentionNote =
    phase.phase === "RETENTION_PERIOD" && phase.retentionEndDate
      ? `Liability period ends ${phase.retentionEndDate}${
          phase.daysRemaining !== null ? (phase.daysRemaining >= 0 ? ` (${phase.daysRemaining} days left)` : " (ended)") : ""
        }`
      : null;
  const actions = phase.canChangePhase ? phase.transitions : [];
  if (!retentionNote && actions.length === 0) return null;

  return (
    <div className="space-y-2">
      {retentionNote && <p className="text-xs text-slate-600">{retentionNote}</p>}
      {actions.length > 0 && (
        <ul className="flex flex-wrap items-start gap-3" aria-label="Phase actions">
          {actions.map((t) => (
            <li key={t.to} className="max-w-xs space-y-1">
              <button
                type="button"
                onClick={() => setTarget(t)}
                aria-describedby={!t.allowed && t.reason ? `phase-refusal-${t.to}` : undefined}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary ${
                  t.to === "ACTIVE_CONSTRUCTION"
                    ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    : "bg-brand-primary text-white hover:opacity-90"
                }`}
              >
                {PHASE_ACTION_LABEL[t.to]}
              </button>
              {!t.allowed && t.reason && (
                <p id={`phase-refusal-${t.to}`} className="text-[11px] text-rose-700">
                  {t.reason}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {target && <PhaseChangeModal projectId={projectId} transition={target} onClose={() => setTarget(null)} />}
    </div>
  );
}

export function PhaseChangeModal({
  projectId,
  transition,
  onClose,
}: {
  projectId: string;
  transition: ProjectPhaseTransitionDto;
  onClose: () => void;
}) {
  const mutation = useChangeProjectPhaseMutation(projectId);
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState(false);
  const [practical, setPractical] = useState("");
  const needsReason = transition.to === "ACTIVE_CONSTRUCTION" || (transition.overridable && override);
  const blocked = !transition.allowed && !(transition.overridable && override);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await mutation.mutateAsync({
        to: transition.to,
        reason: reason.trim() || undefined,
        overrideUndecided: transition.overridable && override ? true : undefined,
        practicalCompletionDate: transition.to === "RETENTION_PERIOD" && practical ? practical : undefined,
      });
      onClose();
    } catch {
      // toasted by the mutation hook
    }
  };

  return (
    <ModalShell title={PHASE_ACTION_LABEL[transition.to]} subtitle={`Move to ${CONSTRUCTION_PHASE_LABELS[transition.to]}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 p-5 text-xs">
        {!transition.allowed && transition.reason && <BlockedNotice>{transition.reason}</BlockedNotice>}
        {transition.overridable && (
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="mt-0.5" />
            <span>Continue anyway. The reason is recorded in the audit ledger.</span>
          </label>
        )}
        {transition.to === "RETENTION_PERIOD" && (
          <label className="block space-y-1">
            <span className="font-semibold text-slate-700">Practical completion date</span>
            <input type="date" value={practical} onChange={(e) => setPractical(e.target.value)} className={inputClass} />
            <span className="text-slate-500">Leave empty to use the date the accepted handover was reviewed. The liability period starts on this date.</span>
          </label>
        )}
        {transition.to === "HANDOVER_IN_PROGRESS" && (
          <p className="text-slate-600">You can then record the beneficiary's handover response from the signed paper copy.</p>
        )}
        {transition.to === "RETENTION_PERIOD" && (
          <p className="text-slate-600">Construction progress is no longer recorded. Field users can still record defect work.</p>
        )}
        {(needsReason || transition.to !== "ACTIVE_CONSTRUCTION") && (
          <label className="block space-y-1">
            <span className="font-semibold text-slate-700">Reason{needsReason ? "" : " (optional)"}</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={inputClass} maxLength={1000} />
          </label>
        )}
        <ModalActions
          onCancel={onClose}
          submitLabel={PHASE_ACTION_LABEL[transition.to]}
          pendingLabel="Saving…"
          isPending={mutation.isPending}
          disabled={blocked || (needsReason && reason.trim().length < 3)}
        />
      </form>
    </ModalShell>
  );
}
