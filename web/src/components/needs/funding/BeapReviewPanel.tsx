import React, { useMemo, useState } from "react";
import { z } from "zod";
import { CheckCircle2, Undo2 } from "lucide-react";
import {
  BEAP_REVIEW_OUTCOME_LABELS,
  BeapItemReviewRequestSchema,
  BeapReviewOutcomeEnum,
  NeedsApprovalActionRequestSchema,
  PROCUREMENT_METHOD_LABELS,
  type BeapReviewOutcome,
  type NeedsApprovalDecision,
  type NeedsCycleDto,
  type NeedsSubmissionDto,
} from "@insite/shared";
import { ModalShell } from "../../common/ModalShell";
import { dangerButton, primaryButton } from "../../contracts/contractUi";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../../lib/forms";
import { useBeapActionMutation, useReviewBeapItemsMutation } from "../../../mutations/needs/useFundingMutations";
import { useCycleVerificationsQuery } from "../../../queries/needs/useVerificationQueries";
import { BeapItemVerification } from "../verification/BeapItemVerification";
import { cardCls, inputCls, labelCls, locationText, money, plural } from "../needsUi";
import { ProposalLink, onLastStep, plannedText } from "./fundingUi";

/**
 * Needs pipeline wave 4 (C2): UBEC's review of a submitted BEAP, for the person who may act on the
 * current step (`canAct`: UBEC Physical Planning review, then Executive Management approval). Per
 * included item: accept, comment or request removal (a comment is required unless accepted); then
 * approve the step, or return the BEAP to the SUBEB with notes. Approving the last step converts the
 * included proposed projects into draft projects owned by the SUBEB, lots and batches from the BEAP.
 * Wave 5 (N8): per item, a site visit from the field app (assign, review) with `needs:review_beap`.
 */

const ReviewFormSchema = z
  .object({
    items: z.array(
      z
        .object({ proposalId: z.string(), outcome: z.string(), comment: z.string() })
        .superRefine((v, ctx) => {
          if (v.outcome && v.outcome !== "ACCEPTED" && v.comment.trim().length < 5) ctx.addIssue({ code: "custom", path: ["comment"], message: "Write the comment" });
        })
    ),
  })
  .transform((v) => ({
    items: v.items
      .filter((i) => i.outcome)
      .map((i) => ({ proposalId: i.proposalId, outcome: i.outcome as BeapReviewOutcome, comment: i.comment.trim() || null })),
  }))
  .pipe(BeapItemReviewRequestSchema);

export function BeapReviewPanel({ cycle, beap }: { cycle: NeedsCycleDto; beap: NeedsSubmissionDto }) {
  const review = useReviewBeapItemsMutation(cycle.id);
  const verifications = useCycleVerificationsQuery(cycle.id).data ?? [];
  const [decision, setDecision] = useState<NeedsApprovalDecision | null>(null);
  const items = beap.items.filter((i) => i.included);
  const excluded = beap.items.filter((i) => !i.included);
  const form = useZodForm(ReviewFormSchema, {
    defaultValues: { items: items.map((i) => ({ proposalId: i.proposalId, outcome: i.reviewOutcome ?? "", comment: i.reviewComment ?? "" })) },
  });
  const values = form.watch();
  const touch = { shouldValidate: true, shouldDirty: true, shouldTouch: true } as const;
  const unreviewed = values.items.filter((i) => !i.outcome).length;
  const removals = beap.items.filter((i) => i.reviewOutcome === "REMOVAL_REQUESTED").length;
  const last = onLastStep(beap);
  const current = beap.steps.find((s) => s.state === "CURRENT");

  const acceptRest = () =>
    values.items.forEach((i, n) => {
      if (!i.outcome) form.setValue(`items.${n}.outcome`, "ACCEPTED", touch);
    });

  return (
    <div className="space-y-4">
      <form className={`${cardCls} space-y-3`} noValidate onSubmit={form.handleSubmit((body) => review.mutate(body, { onSuccess: () => form.reset(form.getValues()) }))}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900">Review the BEAP{current ? `: ${current.label}` : ""}</h3>
          <p className="text-xs text-slate-600">
            {plural(items.length, "project")} · {money(beap.totalNgn)}
            {unreviewed > 0 ? ` · ${unreviewed} not reviewed` : ""}
          </p>
        </div>
        <p className="text-xs text-slate-500">
          Accept each project, or write a comment or ask for its removal. Save the review, then approve the step or return the BEAP to the SUBEB.
        </p>
        <ul className="space-y-2">
          {items.map((i, n) => {
            const outcome = values.items[n]?.outcome ?? "";
            return (
              <li key={i.proposalId} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <p className="text-slate-900">
                      <ProposalLink proposalId={i.proposalId} reference={i.reference} /> · <span className="font-semibold">{i.title}</span>
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {locationText(i.stateCode, i.lgaCodes)} · {plural(i.siteCount, "site")}
                      {i.currentVersionNumber ? ` · needs assessment v${i.currentVersionNumber}` : ""}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-700">
                      Lot: <span className="font-semibold">{i.lotTitle ?? "–"}</span> · {i.procurementMethod ? PROCUREMENT_METHOD_LABELS[i.procurementMethod] : "Method not set"} ·{" "}
                      {plannedText(i.plannedStartDate, i.plannedEndDate)}
                    </p>
                  </div>
                  <span className="tabular-nums font-semibold text-slate-900">{money(i.amountNgn)}</span>
                </div>
                <fieldset className="mt-2">
                  <legend className="sr-only">Review of {i.reference}</legend>
                  <div className="flex flex-wrap gap-3 text-xs">
                    {BeapReviewOutcomeEnum.options.map((o) => (
                      <label key={o} className="inline-flex items-center gap-1.5 text-slate-700">
                        <input
                          type="radio"
                          name={`beap-review-${i.proposalId}`}
                          checked={outcome === o}
                          onChange={() => form.setValue(`items.${n}.outcome`, o, touch)}
                        />
                        {o === "COMMENTED" ? "Comment" : BEAP_REVIEW_OUTCOME_LABELS[o]}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {outcome && outcome !== "ACCEPTED" && (
                  <div className="mt-2">
                    <label className={labelCls} htmlFor={`beap-review-comment-${n}`}>
                      {outcome === "REMOVAL_REQUESTED" ? "Why it should be removed" : "Comment"} <span className="text-rose-600">*</span>
                    </label>
                    <textarea
                      id={`beap-review-comment-${n}`}
                      rows={2}
                      className={`${inputCls} ${invalidClass(form, `items.${n}.comment`)}`}
                      {...form.register(`items.${n}.comment`)}
                      {...fieldA11y(form, `items.${n}.comment`)}
                    />
                    <FieldError form={form} name={`items.${n}.comment`} />
                  </div>
                )}
                <BeapItemVerification item={i} verifications={verifications} beapInReview={beap.status === "IN_REVIEW"} />
              </li>
            );
          })}
        </ul>
        {excluded.length > 0 && (
          <details className="text-xs text-slate-600">
            <summary className="cursor-pointer font-semibold text-slate-700">Left out by the SUBEB ({excluded.length})</summary>
            <ul className="mt-1 space-y-0.5">
              {excluded.map((i) => (
                <li key={i.proposalId}>
                  <span className="font-semibold">{i.reference}</span> · {i.title}: {i.exclusionReason ?? "no reason given"}
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="flex flex-wrap items-start justify-end gap-2 border-t border-slate-100 pt-3">
          {unreviewed > 0 && (
            <button type="button" className="mr-auto text-xs font-semibold text-slate-700 hover:underline" onClick={acceptRest}>
              Accept the {unreviewed} not reviewed
            </button>
          )}
          <SubmitButton form={form} pending={review.isPending} pendingLabel="Saving…" hint="Choose an outcome for at least one project; comments need a few words.">
            Save review
          </SubmitButton>
        </div>
      </form>

      <section className={`${cardCls} space-y-2`} aria-labelledby="beap-decision-heading">
        <h3 id="beap-decision-heading" className="text-sm font-bold text-slate-900">
          Decision
        </h3>
        <p className="text-xs text-slate-600">
          {last
            ? `Approving is the last step: the ${plural(items.length, "included project")} become draft projects owned by the SUBEB, with their lots and batches from the BEAP.`
            : "Approving passes the BEAP to the next step."}{" "}
          Returning sends it back to the SUBEB with your notes and the item comments.
        </p>
        {form.formState.isDirty && <p className="text-[11px] font-medium text-amber-800">The item review has unsaved changes: save it before you decide.</p>}
        {removals > 0 && <p className="text-[11px] text-slate-600">{plural(removals, "removal request")} saved: return the BEAP so the SUBEB can act on them.</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={dangerButton} onClick={() => setDecision("RETURN")}>
            <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> Return to the SUBEB
          </button>
          <button type="button" className={primaryButton} onClick={() => setDecision("APPROVE")}>
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {last ? "Approve the BEAP" : "Approve this step"}
          </button>
        </div>
      </section>

      {decision && <BeapDecisionDialog cycleId={cycle.id} beap={beap} decision={decision} last={last} onClose={() => setDecision(null)} />}
    </div>
  );
}

const NotesSchema = z.object({ notes: z.string().max(2000, "At most 2000 characters") });

function BeapDecisionDialog({
  cycleId,
  beap,
  decision,
  last,
  onClose,
}: {
  cycleId: string;
  beap: NeedsSubmissionDto;
  decision: NeedsApprovalDecision;
  last: boolean;
  onClose: () => void;
}) {
  const act = useBeapActionMutation(cycleId);
  const schema = useMemo(() => NotesSchema.transform((v) => ({ decision, notes: v.notes.trim() || null })).pipe(NeedsApprovalActionRequestSchema), [decision]);
  const form = useZodForm(schema, { defaultValues: { notes: "" } });
  const returning = decision === "RETURN";
  const included = beap.items.filter((i) => i.included).length;
  return (
    <ModalShell title={returning ? "Return the BEAP to the SUBEB" : last ? "Approve the BEAP" : "Approve this step"} subtitle={`${plural(included, "project")} · ${money(beap.totalNgn)}`} onClose={onClose}>
      <form className="space-y-3 p-5" noValidate onSubmit={form.handleSubmit((body) => act.mutate(body, { onSuccess: () => onClose() }))}>
        <p className="text-xs text-slate-700">
          {returning
            ? "The SUBEB sees your notes and the item comments, revises the BEAP (it may upload revised needs assessments) and resubmits it."
            : last
              ? `The ${plural(included, "included proposed project")} become draft projects owned by the SUBEB, with lot and batch numbers from the BEAP's lot titles. This cannot be undone here.`
              : "The BEAP moves to the next step of the chain."}
        </p>
        <div>
          <label className={labelCls} htmlFor="beap-decision-notes">
            Notes {returning && <span className="text-rose-600">*</span>}
          </label>
          <textarea
            id="beap-decision-notes"
            rows={4}
            className={`${inputCls} ${invalidClass(form, "notes")}`}
            placeholder={returning ? "Say what must change" : undefined}
            {...form.register("notes")}
            {...fieldA11y(form, "notes")}
          />
          <FieldError form={form} name="notes" />
        </div>
        <div className="flex flex-wrap items-start justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">
            Cancel
          </button>
          <SubmitButton form={form} pending={act.isPending} pendingLabel={returning ? "Returning…" : "Approving…"} hint={returning ? "Say what must change." : undefined}>
            {returning ? "Return the BEAP" : last ? "Approve and create projects" : "Approve"}
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}
