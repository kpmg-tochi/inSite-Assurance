import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { z } from "zod";
import { FieldError, canSubmit, fieldA11y, invalidClass, useZodForm } from "../../lib/forms";
import { CONSTRUCTION_PHASE_LABELS, type ConstructionPhase, type ProjectPhaseTransitionDto } from "@insite/shared";
import { useProjectProcess } from "../../queries/process/useProcessQueries";
import { useProjectPhaseQuery } from "../../queries/closeout/useCloseoutQueries";
import { useChangeProjectPhaseMutation } from "../../mutations/closeout/useCloseoutMutations";
import { ModalShell, ModalActions, BlockedNotice, inputClass } from "../common/ModalShell";

export const PHASE_ACTION_LABEL: Record<ConstructionPhase, string> = {
  ACTIVE_CONSTRUCTION: "Back to execution",
  HANDOVER_IN_PROGRESS: "Start the handover",
  RETENTION_PERIOD: "Start the defects liability period",
  COMPLETED_CLOSED: "Close the project",
};

/**
 * Where to fix a refused phase change. The server's refusal text names the gate (Certificate of
 * Completion, accepted handover, closure checklist, retention held); this maps it to the page.
 */
function fixLinkFor(projectId: string, reason: string | null): { to: string; label: string } | null {
  if (!reason) return null;
  const base = `/app/projects/${projectId}`;
  if (/Certificate of Completion/i.test(reason)) return { to: `${base}/completion?tab=certificate`, label: "Open the Certificate tab" };
  if (/accept the works|handover/i.test(reason)) return { to: `${base}/completion?tab=handover`, label: "Open the Handover tab" };
  if (/Retention is still held|retention release/i.test(reason)) return { to: `${base}/payments`, label: "Open Payments" };
  if (/can be closed|can be archived|checklist/i.test(reason)) return { to: `${base}/completion?tab=closure`, label: "Open the Project closure tab" };
  return null;
}

/**
 * Redesign R6c (D-R6.20), UBEC: the phase-change actions as a faint green banner above the stage
 * timeline. Shown only when the handover or retention module is on and the caller may change the
 * phase (`canChangePhase`) with a move available. A refused move keeps its button (disabled unless
 * it can be overridden) with the refusal as plain text and a link to where it is fixed. Without an
 * action, the liability period end date is a plain line.
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
      ? `The defects liability period ends ${phase.retentionEndDate}${
          phase.daysRemaining !== null ? (phase.daysRemaining >= 0 ? ` (${phase.daysRemaining} days left).` : " (ended).") : "."
        }`
      : null;
  // Forward moves first, the backwards one last.
  const actions = (phase.canChangePhase ? phase.transitions : []).slice().sort((a, b) => Number(a.to === "ACTIVE_CONSTRUCTION") - Number(b.to === "ACTIVE_CONSTRUCTION"));

  if (actions.length === 0) {
    return retentionNote ? <p className="text-xs text-slate-600">{retentionNote}</p> : null;
  }

  return (
    <section aria-label="Next step for this project" className="space-y-2.5 rounded-xl border border-brand-primary/20 bg-brand-primary/5 px-4 py-3">
      {retentionNote && <p className="text-xs text-slate-700">{retentionNote}</p>}
      <ul className="space-y-2.5">
        {actions.map((t) => {
          const blocked = !t.allowed;
          const fix = blocked ? fixLinkFor(projectId, t.reason) : null;
          const forward = t.to !== "ACTIVE_CONSTRUCTION";
          return (
            <li key={t.to} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-xs">
                {blocked && t.reason ? (
                  <p id={`phase-refusal-${t.to}`} className="text-slate-700">
                    <span className="font-semibold text-slate-900">You cannot {PHASE_ACTION_LABEL[t.to].toLowerCase()} yet.</span> {t.reason}
                    {fix && (
                      <>
                        {" "}
                        <Link to={fix.to} className="font-semibold text-brand-primary underline-offset-2 hover:underline">
                          {fix.label}
                        </Link>
                      </>
                    )}
                  </p>
                ) : (
                  <p className="text-slate-700">
                    {forward ? (
                      <>
                        <span className="font-semibold text-slate-900">Next step:</span> {PHASE_ACTION_LABEL[t.to].toLowerCase()}.
                      </>
                    ) : (
                      "If handover started too early, move the project back to execution."
                    )}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setTarget(t)}
                disabled={blocked && !t.overridable}
                aria-describedby={blocked && t.reason ? `phase-refusal-${t.to}` : undefined}
                className={`shrink-0 self-start rounded-xl px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto ${
                  forward ? "bg-brand-primary text-white hover:bg-brand-hover" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {PHASE_ACTION_LABEL[t.to]}
              </button>
            </li>
          );
        })}
      </ul>
      {target && <PhaseChangeModal projectId={projectId} transition={target} onClose={() => setTarget(null)} />}
    </section>
  );
}

/**
 * ChangeProjectPhaseRequestSchema for one move: the reason is required (at least 3 characters) to go
 * back to construction and when overriding; the practical completion date is optional.
 */
function phaseChangeFormSchema(transition: ProjectPhaseTransitionDto) {
  return z
    .object({
      override: z.boolean(),
      reason: z.string().trim().max(1000, "The reason is too long (at most 1000 characters)"),
      practical: z.string().refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Choose a valid date or leave it empty"),
    })
    .superRefine((v, ctx) => {
      const needsReason = transition.to === "ACTIVE_CONSTRUCTION" || (transition.overridable && v.override);
      if (needsReason && v.reason.length < 3) ctx.addIssue({ code: "custom", path: ["reason"], message: "Give a reason (at least 3 characters)" });
    });
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
  const schema = useMemo(() => phaseChangeFormSchema(transition), [transition]);
  const form = useZodForm(schema, { defaultValues: { override: false, reason: "", practical: "" } });
  const override = form.watch("override");
  const needsReason = transition.to === "ACTIVE_CONSTRUCTION" || (transition.overridable && override);
  const blocked = !transition.allowed && !(transition.overridable && override);

  const submit = form.handleSubmit(async ({ reason, override: overridden, practical }) => {
    try {
      await mutation.mutateAsync({
        to: transition.to,
        reason: reason || undefined,
        overrideUndecided: transition.overridable && overridden ? true : undefined,
        practicalCompletionDate: transition.to === "RETENTION_PERIOD" && practical ? practical : undefined,
      });
      onClose();
    } catch {
      // toasted by the mutation hook
    }
  });

  return (
    <ModalShell title={PHASE_ACTION_LABEL[transition.to]} subtitle={`Move to ${CONSTRUCTION_PHASE_LABELS[transition.to]}`} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-3 p-5 text-xs">
        {!transition.allowed && transition.reason && <BlockedNotice>{transition.reason}</BlockedNotice>}
        {transition.overridable && (
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              {...form.register("override", {
                // Ticking the override makes the reason required: re-check it.
                onChange: () => void form.trigger("reason"),
              })}
            />
            <span>Continue anyway. The reason is recorded in the audit ledger.</span>
          </label>
        )}
        {transition.to === "RETENTION_PERIOD" && (
          <label className="block space-y-1">
            <span className="font-semibold text-slate-700">Practical completion date</span>
            <input type="date" className={`${inputClass} ${invalidClass(form, "practical")}`} {...form.register("practical")} {...fieldA11y(form, "practical")} />
            <FieldError form={form} name="practical" />
            <span className="text-slate-500">Leave empty to use the date the accepted handover was reviewed. The defects liability period starts on this date.</span>
          </label>
        )}
        {transition.to === "HANDOVER_IN_PROGRESS" && (
          <p className="text-slate-600">You can then record the beneficiary's handover response from the signed paper copy.</p>
        )}
        {transition.to === "RETENTION_PERIOD" && (
          <p className="text-slate-600">Execution progress is no longer recorded. Field users can still record defect work.</p>
        )}
        {(needsReason || transition.to !== "ACTIVE_CONSTRUCTION") && (
          <label className="block space-y-1">
            <span className="font-semibold text-slate-700">Reason{needsReason ? "" : " (optional)"}</span>
            <textarea rows={3} className={`${inputClass} ${invalidClass(form, "reason")}`} maxLength={1000} {...form.register("reason")} {...fieldA11y(form, "reason")} />
            <FieldError form={form} name="reason" />
          </label>
        )}
        <ModalActions
          onCancel={onClose}
          submitLabel={PHASE_ACTION_LABEL[transition.to]}
          pendingLabel="Saving…"
          isPending={mutation.isPending}
          disabled={!canSubmit(form, { pending: mutation.isPending, blocked })}
        />
      </form>
    </ModalShell>
  );
}
