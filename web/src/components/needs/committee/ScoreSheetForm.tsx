import React, { useMemo } from "react";
import { z } from "zod";
import { ScoreSheetSchema, proposalScore, type NeedsRubric, type ScoreSheetDto } from "@insite/shared";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../../lib/forms";
import { formatDateTimeShort } from "../../../lib/formatters";
import { useSaveScoreSheetMutation } from "../../../mutations/needs/useCommitteeMutations";
import { inputCls, labelCls } from "../needsUi";
import { scoreText } from "./committeeUi";

/**
 * D2: one member's score sheet for one proposed project. The cycle's rubric, grouped by dimension
 * (label and weight); each sub-criterion a radio group of the five descriptors. Saving submits the
 * sheet; it stays editable until the ranking is finalised. Only the member's own sheet is shown.
 */
export function ScoreSheetForm({
  cycleId,
  rubric,
  proposalId,
  reference,
  sheet,
  readOnly,
  onSaved,
}: {
  cycleId: string;
  rubric: NeedsRubric;
  proposalId: string;
  reference: string;
  sheet: ScoreSheetDto | null;
  readOnly: boolean;
  onSaved?: () => void;
}) {
  const save = useSaveScoreSheetMutation(cycleId);
  const schema = useMemo(
    () =>
      ScoreSheetSchema.superRefine((v, ctx) => {
        const missing = rubric.criteria.filter((c) => typeof v.scores[c.key] !== "number");
        if (missing.length > 0) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["scores"], message: `Score every criterion (${missing.length} left).` });
        }
      }),
    [rubric.criteria]
  );
  const form = useZodForm(schema, {
    defaultValues: { proposalId, scores: { ...(sheet?.scores ?? {}) }, comment: sheet?.comment ?? "" },
  });
  const scores = (form.watch("scores") ?? {}) as Record<string, number>;
  const scoredCount = rubric.criteria.filter((c) => typeof scores[c.key] === "number").length;
  const preview = scoredCount === rubric.criteria.length && rubric.criteria.length > 0 ? proposalScore([{ scores }], rubric) : null;

  const choose = (key: string, value: number) =>
    form.setValue("scores", { ...scores, [key]: value }, { shouldValidate: true, shouldDirty: true, shouldTouch: true });

  const submit = form.handleSubmit((values) =>
    save.mutate(
      { proposalId, scores: values.scores, comment: values.comment?.trim() ? values.comment.trim() : null, reference },
      { onSuccess: () => onSaved?.() }
    )
  );

  const dimensions = rubric.dimensions.length
    ? rubric.dimensions
    : [...new Set(rubric.criteria.map((c) => c.dimension))].map((key) => ({ key, label: key === "IMPACT" ? "Impact" : "Ease", weight: 0 }));

  return (
    <form className="space-y-4" noValidate onSubmit={submit}>
      {sheet && (
        <p className="text-[11px] text-slate-500">
          Saved {formatDateTimeShort(sheet.submittedAt)}. {readOnly ? "" : "You can change it until the ranking is finalised."}
        </p>
      )}
      {dimensions.map((d) => {
        const criteria = rubric.criteria.filter((c) => c.dimension === d.key);
        if (criteria.length === 0) return null;
        return (
          <fieldset key={d.key} className="space-y-3">
            <legend className="text-xs font-bold uppercase tracking-wide text-slate-600">
              {d.label}
              {d.weight > 0 && <span className="ml-1 font-semibold normal-case tracking-normal text-slate-500">· weight {d.weight}%</span>}
            </legend>
            {criteria.map((c) => {
              const name = `score-${proposalId}-${c.key}`;
              return (
                <fieldset key={c.key} className="rounded-xl border border-slate-200 p-3">
                  <legend className="px-1 text-xs font-semibold text-slate-900">{c.label}</legend>
                  <div className="mt-1 grid gap-1.5 sm:grid-cols-5">
                    {c.descriptors.map((descriptor, i) => {
                      const value = i + 1;
                      const checked = scores[c.key] === value;
                      return (
                        <label
                          key={value}
                          className={`flex items-start gap-2 rounded-lg border p-2 text-[11px] leading-snug sm:flex-col sm:gap-1 ${
                            checked ? "border-brand-primary bg-brand-primary/5 text-slate-900" : "border-slate-200 text-slate-700"
                          } ${readOnly ? "cursor-default opacity-80" : "cursor-pointer hover:border-brand-primary/50"} focus-within:ring-2 focus-within:ring-brand-primary`}
                        >
                          <span className="flex items-center gap-1.5">
                            <input type="radio" name={name} value={value} checked={checked} disabled={readOnly} onChange={() => choose(c.key, value)} />
                            <span className="text-xs font-bold tabular-nums">{value}</span>
                          </span>
                          <span>{descriptor}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              );
            })}
          </fieldset>
        );
      })}

      <div>
        <label className={labelCls} htmlFor={`score-comment-${proposalId}`}>
          Comment (optional)
        </label>
        <textarea
          id={`score-comment-${proposalId}`}
          rows={3}
          disabled={readOnly}
          className={`${inputCls} ${invalidClass(form, "comment")}`}
          {...form.register("comment")}
          {...fieldA11y(form, "comment")}
        />
        <FieldError form={form} name="comment" />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 border-t border-slate-100 pt-3">
        <p className="text-xs text-slate-600" aria-live="polite">
          {scoredCount} of {rubric.criteria.length} criteria scored
          {preview && (
            <>
              {" "}
              · your sheet gives <span className="font-semibold">Impact {scoreText(preview.impact)}</span>, <span className="font-semibold">Ease {scoreText(preview.ease)}</span>,{" "}
              <span className="font-semibold">Total {scoreText(preview.total)}</span>
            </>
          )}
        </p>
        {!readOnly && (
          <SubmitButton form={form} pending={save.isPending} pendingLabel="Saving…" hint="Score every criterion to save.">
            {sheet ? "Save changes" : "Save scores"}
          </SubmitButton>
        )}
      </div>
    </form>
  );
}
