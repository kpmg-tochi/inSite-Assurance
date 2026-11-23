import React, { useState } from "react";
import { Flag } from "lucide-react";
import { CONSTRUCTION_PHASE_LABELS, type ConstructionPhase, type ProjectPhaseTransitionDto } from "@insite/shared";
import { useProjectProcess } from "../../queries/process/useProcessQueries";
import { useProjectPhaseQuery } from "../../queries/closeout/useCloseoutQueries";
import { useChangeProjectPhaseMutation } from "../../mutations/closeout/useCloseoutMutations";
import { ModalShell, ModalActions, BlockedNotice, inputClass } from "../common/ModalShell";

const PHASE_STYLE: Record<ConstructionPhase, string> = {
  ACTIVE_CONSTRUCTION: "bg-slate-100 text-slate-700 border-slate-200",
  HANDOVER_IN_PROGRESS: "bg-amber-50 text-amber-800 border-amber-200",
  RETENTION_PERIOD: "bg-sky-50 text-sky-800 border-sky-200",
  COMPLETED_CLOSED: "bg-emerald-50 text-emerald-800 border-emerald-200",
};

const ACTION_LABEL: Record<ConstructionPhase, string> = {
  ACTIVE_CONSTRUCTION: "Back to construction",
  HANDOVER_IN_PROGRESS: "Start handover",
  RETENTION_PERIOD: "Start defects liability period",
  COMPLETED_CLOSED: "Close the project",
};

/**
 * Phase 10: the project's construction phase on the header, with the phase-change actions. Shown
 * only when the handover or retention module is on for the project.
 */
export function ProjectPhaseBanner({ projectId, projectStatus }: { projectId: string; projectStatus: string }) {
  const processQuery = useProjectProcess(projectId, projectStatus === "ACTIVE");
  const config = processQuery.data?.config;
  const enabled = Boolean(config?.enableHandoverModule || config?.enableRetentionModule);
  const phaseQuery = useProjectPhaseQuery(projectId, enabled && projectStatus === "ACTIVE");
  const [target, setTarget] = useState<ProjectPhaseTransitionDto | null>(null);
  const phase = phaseQuery.data;
  if (!enabled || !phase) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold ${PHASE_STYLE[phase.phase]}`}>
        <Flag className="h-3 w-3" />
        {CONSTRUCTION_PHASE_LABELS[phase.phase]}
      </span>
      {phase.phase === "RETENTION_PERIOD" && phase.retentionEndDate && (
        <span className="text-slate-300">
          Liability period ends {phase.retentionEndDate}
          {phase.daysRemaining !== null && (phase.daysRemaining >= 0 ? ` (${phase.daysRemaining} days left)` : " (ended)")}
        </span>
      )}
      {phase.canChangePhase &&
        phase.transitions.map((t) => (
          <button
            key={t.to}
            type="button"
            onClick={() => setTarget(t)}
            title={t.allowed ? undefined : t.reason ?? undefined}
            className="rounded-lg border border-slate-300 bg-white px-2 py-0.5 font-semibold text-slate-700 hover:bg-slate-50"
          >
            {ACTION_LABEL[t.to]}
          </button>
        ))}
      {target && <PhaseChangeModal projectId={projectId} transition={target} onClose={() => setTarget(null)} />}
    </div>
  );
}

function PhaseChangeModal({
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
    <ModalShell title={ACTION_LABEL[transition.to]} subtitle={`Move to ${CONSTRUCTION_PHASE_LABELS[transition.to]}`} onClose={onClose}>
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
          <p className="text-slate-600">You can then send stakeholders a link to accept the works.</p>
        )}
        {transition.to === "RETENTION_PERIOD" && (
          <p className="text-slate-600">New claims, briefs and reporting stop. Field users can only record defect work.</p>
        )}
        {(needsReason || transition.to !== "ACTIVE_CONSTRUCTION") && (
          <label className="block space-y-1">
            <span className="font-semibold text-slate-700">Reason{needsReason ? "" : " (optional)"}</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={inputClass} maxLength={1000} />
          </label>
        )}
        <ModalActions
          onCancel={onClose}
          submitLabel={ACTION_LABEL[transition.to]}
          pendingLabel="Saving…"
          isPending={mutation.isPending}
          disabled={blocked || (needsReason && reason.trim().length < 3)}
        />
      </form>
    </ModalShell>
  );
}
