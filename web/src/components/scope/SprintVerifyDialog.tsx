import { z } from "zod";
import {
  SPRINT_VERIFICATION_OUTCOME_LABELS,
  SprintVerificationOutcomeEnum,
  VerifySprintRequestSchema,
  type SprintVerificationViewDto,
  type VerifySprintRequest,
} from "@insite/shared";
import { ModalActions, ModalShell, inputClass } from "../common/ModalShell";
import Loader from "../Loader";
import { FieldError, canSubmit, fieldA11y, invalidClass, useZodForm } from "../../lib/forms";
import { useSprintVerificationQuery } from "../../queries/visits/useVisitQueries";
import { useVerifySprintMutation } from "../../mutations/visits/useVisitMutations";
import { visitKindLabel } from "../visits/visitUi";

/**
 * Redesign R4e (D-R4.31): verify a sprint as met, partly met or not met. Shows, per facility in the
 * sprint, the latest accepted visit's answers, unit progress and open findings.
 */
export function SprintVerifyDialog({ projectId, sprintId, onClose }: { projectId: string; sprintId: string; onClose: () => void }) {
  const q = useSprintVerificationQuery(projectId, sprintId);
  const v = q.data;
  return (
    <ModalShell
      title={v ? `Verify ${v.name}` : "Verify sprint"}
      subtitle={v ? `${v.startDate} to ${v.endDate}${v.outcome ? ` · now ${SPRINT_VERIFICATION_OUTCOME_LABELS[v.outcome].toLowerCase()} (${v.verifiedByName ?? "—"})` : ""}` : undefined}
      onClose={onClose}
      maxWidth="max-w-3xl"
    >
      {q.isLoading || !v ? (
        <div className="p-6">
          <Loader inline />
        </div>
      ) : (
        <div className="p-5 space-y-4">
          {v.deliverables && (
            <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
              <p className="font-semibold text-slate-900">Deliverables</p>
              <p className="whitespace-pre-line">{v.deliverables}</p>
            </div>
          )}
          <div className="space-y-3">
            {v.facilities.length === 0 && <p className="text-xs text-slate-500">No facility units are active in this sprint.</p>}
            {v.facilities.map((f) => (
              <div key={f.facilityId} className="rounded-xl border border-slate-200 p-3 text-xs space-y-2">
                <p className="font-bold text-slate-900">{f.facilityName}</p>
                <ul className="space-y-0.5">
                  {f.units.map((u) => (
                    <li key={u.unitId} className="flex justify-between gap-2">
                      <span>
                        {u.code} · {u.label}
                      </span>
                      <span className="font-semibold tabular-nums">{u.progressPct === null ? "no visit yet" : `${u.progressPct}% (${u.progressAsOf})`}</span>
                    </li>
                  ))}
                </ul>
                {f.latestVisit ? (
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="text-[11px] font-semibold text-slate-700">
                      {visitKindLabel(f.latestVisit.visitKind)} of {f.latestVisit.date}
                    </p>
                    <ul className="text-[11px] text-slate-600">
                      {f.latestVisit.answers.map((a, i) => (
                        <li key={i}>
                          {a.label}: <span className="font-semibold">{a.answer}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500">No accepted visit covered this facility in the sprint.</p>
                )}
                {f.openFindings.length > 0 && (
                  <ul className="text-[11px] text-red-700">
                    {f.openFindings.map((x) => (
                      <li key={x.id}>
                        Open {x.severity.toLowerCase()} finding: {x.title} (raised {x.raisedDate})
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          {v.canVerify ? (
            <VerifyForm projectId={projectId} sprintId={sprintId} v={v} onClose={onClose} />
          ) : (
            <p className="text-xs text-slate-500">{v.endedYet || v.status !== "UPCOMING" ? "You cannot verify sprints." : "The sprint has not started."}</p>
          )}
        </div>
      )}
    </ModalShell>
  );
}

function VerifyForm({ projectId, sprintId, v, onClose }: { projectId: string; sprintId: string; v: SprintVerificationViewDto; onClose: () => void }) {
  const verify = useVerifySprintMutation(projectId);
  const schema = z
    .object({
      outcome: SprintVerificationOutcomeEnum.nullable(),
      notes: z.string().trim().max(2000, "Notes are too long (at most 2000 characters)"),
    })
    .superRefine((x, ctx) => {
      if (!x.outcome) ctx.addIssue({ code: "custom", path: ["outcome"], message: "Choose met, partly met or not met" });
      if (!v.endedYet && x.notes.length < 3) {
        ctx.addIssue({ code: "custom", path: ["notes"], message: "The sprint has not ended: say why you verify it now (at least 3 characters)" });
      }
    })
    .transform((x): VerifySprintRequest => ({ outcome: x.outcome!, notes: x.notes || null }))
    .pipe(VerifySprintRequestSchema);
  const form = useZodForm(schema, { defaultValues: { outcome: v.outcome ?? null, notes: "" } });
  const chosen = form.watch("outcome");
  return (
    <form className="space-y-4" noValidate onSubmit={form.handleSubmit((body) => verify.mutate({ sprintId, body }, { onSuccess: onClose }))}>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Outcome">
        {SprintVerificationOutcomeEnum.options.map((o) => (
          <label key={o} className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold ${chosen === o ? "border-brand-primary text-brand-primary" : "border-slate-300 text-slate-700"}`}>
            <input type="radio" name="outcome" checked={chosen === o} onChange={() => form.setValue("outcome", o, { shouldValidate: true, shouldTouch: true, shouldDirty: true })} />{" "}
            {SPRINT_VERIFICATION_OUTCOME_LABELS[o]}
          </label>
        ))}
      </div>
      <label className="block text-xs font-semibold text-slate-700">
        Notes{!v.endedYet ? " (required: the sprint has not ended)" : ""}
        <textarea className={`${inputClass} mt-1 ${invalidClass(form, "notes")}`} rows={3} {...form.register("notes")} {...fieldA11y(form, "notes")} />
      </label>
      <FieldError form={form} name="notes" />
      <ModalActions
        onCancel={onClose}
        submitLabel={v.outcome ? "Re-verify" : "Verify"}
        pendingLabel="Saving…"
        isPending={verify.isPending}
        disabled={!canSubmit(form, { pending: verify.isPending })}
      />
    </form>
  );
}
