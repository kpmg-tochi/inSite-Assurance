import React, { useMemo, useRef, useState } from "react";
import { z } from "zod";
import { FileUp } from "lucide-react";
import { NEEDS_DOCUMENT_UPLOAD_POLICY, type NeedsCycleDocumentDto, type NeedsRankingDto, type NeedsRankingRow } from "@insite/shared";
import { ModalShell } from "../../common/ModalShell";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm, zNumberText } from "../../../lib/forms";
import { formatDateTimeShort } from "../../../lib/formatters";
import { mimeTypeOf } from "../../../api/needsPipeline";
import {
  useFinaliseRankingMutation,
  useFundingLineMutation,
  useRankingPlacementMutation,
  useUploadMinutesMutation,
} from "../../../mutations/needs/useCommitteeMutations";
import { DOCUMENT_FILE_ACCEPT, formatBytes, inputCls, labelCls, money } from "../needsUi";
import { secondaryButtonCls } from "./committeeUi";

/** D3: the chair's ranking actions (override a placement, move the line, finalise) and the minutes upload. */

const ReasonSchema = z.string().trim().max(2000);

// ---------------------------------------------------------------------------
// Placement override
// ---------------------------------------------------------------------------

const PlacementFormSchema = z
  .object({ placement: z.enum(["ABOVE", "BELOW", "CLEAR"]), reason: ReasonSchema })
  .superRefine((v, ctx) => {
    if (v.placement !== "CLEAR" && v.reason.length < 5) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "Give the reason for the override" });
  });

export function PlacementDialog({ cycleId, row, onClose }: { cycleId: string; row: NeedsRankingRow; onClose: () => void }) {
  const place = useRankingPlacementMutation(cycleId);
  const form = useZodForm(PlacementFormSchema, {
    defaultValues: { placement: row.placement ?? (row.computedAboveLine ? "BELOW" : "ABOVE"), reason: row.placementReason ?? "" },
  });
  const placement = form.watch("placement");
  const submit = form.handleSubmit((v) =>
    place.mutate(
      { proposalId: row.proposalId, placement: v.placement === "CLEAR" ? null : v.placement, reason: v.placement === "CLEAR" ? null : v.reason, reference: row.reference },
      { onSuccess: () => onClose() }
    )
  );
  const options: Array<{ value: "ABOVE" | "BELOW" | "CLEAR"; label: string; hint: string; show: boolean }> = [
    { value: "ABOVE", label: "Place above the line", hint: "Funded in this portfolio whatever its rank.", show: true },
    { value: "BELOW", label: "Place below the line", hint: "Left out of this portfolio whatever its rank.", show: true },
    {
      value: "CLEAR",
      label: "Clear the override",
      hint: `Back to where its rank puts it (${row.computedAboveLine ? "above" : "below"} the line).`,
      show: row.placement !== null,
    },
  ];

  return (
    <ModalShell title={`Override ${row.reference}`} subtitle={row.title} onClose={onClose}>
      <form className="space-y-3 p-5" noValidate onSubmit={submit}>
        <p className="text-xs text-slate-600">
          Its rank puts it <span className="font-semibold">{row.computedAboveLine ? "above" : "below"} the line</span>. An override is recorded with your reason and shown on the ranking and in the Prioritised Project Portfolio.
        </p>
        <fieldset>
          <legend className={labelCls}>Placement</legend>
          <div className="space-y-1.5">
            {options
              .filter((o) => o.show)
              .map((o) => (
                <label key={o.value} className="flex items-start gap-2 rounded-xl border border-slate-200 p-2.5 text-xs text-slate-800 has-[:checked]:border-brand-primary has-[:checked]:bg-brand-primary/5">
                  <input
                    type="radio"
                    className="mt-0.5"
                    value={o.value}
                    checked={placement === o.value}
                    onChange={() => form.setValue("placement", o.value, { shouldValidate: true, shouldDirty: true, shouldTouch: true })}
                  />
                  <span>
                    <span className="font-semibold">{o.label}</span>
                    <span className="block text-[11px] text-slate-500">{o.hint}</span>
                  </span>
                </label>
              ))}
          </div>
        </fieldset>
        {placement !== "CLEAR" && (
          <div>
            <label className={labelCls} htmlFor="placement-reason">
              Reason <span className="text-rose-600">*</span>
            </label>
            <textarea id="placement-reason" rows={3} className={`${inputCls} ${invalidClass(form, "reason")}`} {...form.register("reason")} {...fieldA11y(form, "reason")} />
            <FieldError form={form} name="reason" />
          </div>
        )}
        <div className="flex flex-wrap items-start justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">
            Cancel
          </button>
          <SubmitButton form={form} pending={place.isPending} pendingLabel="Saving…" hint="Give the reason (at least 5 characters).">
            Save
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Funding line
// ---------------------------------------------------------------------------

export function FundingLineDialog({ cycleId, ranking, onClose }: { cycleId: string; ranking: NeedsRankingDto; onClose: () => void }) {
  const setLine = useFundingLineMutation(cycleId);
  const ranked = ranking.rows.filter((r) => r.rank !== null).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const moved = ranking.linePosition !== ranking.computedLinePosition || Boolean(ranking.lineReason);
  const rankedCount = ranked.length;
  const schema = useMemo(
    () =>
      z
    .object({ mode: z.enum(["POSITION", "CEILING"]), position: z.string(), reason: ReasonSchema })
    .superRefine((v, ctx) => {
      if (v.mode === "CEILING") return;
      const parsed = zNumberText("Position", { min: 0, max: rankedCount, int: true }).safeParse(v.position);
      if (!parsed.success) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["position"], message: `Enter a whole number from 0 to ${rankedCount}` });
      if (v.reason.length < 5) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "Give the reason for moving the line" });
    }),
    [rankedCount]
  );
  const form = useZodForm(schema, { defaultValues: { mode: "POSITION", position: String(ranking.linePosition), reason: ranking.lineReason ?? "" } });
  const mode = form.watch("mode");
  const positionText = form.watch("position");
  const position = Number(positionText);
  const validPosition = mode === "POSITION" && Number.isInteger(position) && position >= 0 && position <= ranked.length;
  const cumulative = validPosition && position > 0 ? ranked[position - 1]?.cumulativeNgn ?? null : validPosition ? 0 : null;

  const submit = form.handleSubmit((v) =>
    setLine.mutate(v.mode === "CEILING" ? { linePosition: null, reason: null } : { linePosition: Number(v.position), reason: v.reason }, { onSuccess: () => onClose() })
  );
  const opts = { shouldValidate: true, shouldDirty: true, shouldTouch: true } as const;

  return (
    <ModalShell title="Move the funding line" subtitle={`Ceiling ${money(ranking.ceilingNgn)} · at the ceiling the line sits after ${ranking.computedLinePosition} ranked`} onClose={onClose}>
      <form className="space-y-3 p-5" noValidate onSubmit={submit}>
        <fieldset>
          <legend className={labelCls}>Where the line sits</legend>
          <div className="space-y-1.5">
            <label className="flex items-start gap-2 rounded-xl border border-slate-200 p-2.5 text-xs text-slate-800 has-[:checked]:border-brand-primary has-[:checked]:bg-brand-primary/5">
              <input type="radio" className="mt-0.5" checked={mode === "POSITION"} onChange={() => form.setValue("mode", "POSITION", opts)} />
              <span>
                <span className="font-semibold">After a number of ranked proposed projects</span>
                <span className="block text-[11px] text-slate-500">The reason is recorded and shown on the line.</span>
              </span>
            </label>
            <label
              className={`flex items-start gap-2 rounded-xl border border-slate-200 p-2.5 text-xs has-[:checked]:border-brand-primary has-[:checked]:bg-brand-primary/5 ${moved ? "text-slate-800" : "text-slate-400"}`}
            >
              <input type="radio" className="mt-0.5" checked={mode === "CEILING"} disabled={!moved} onChange={() => form.setValue("mode", "CEILING", opts)} />
              <span>
                <span className="font-semibold">Back to the ceiling</span>
                <span className="block text-[11px] text-slate-500">{moved ? "The line follows the indicative ceiling again." : "The line is already at the ceiling."}</span>
              </span>
            </label>
          </div>
        </fieldset>
        {mode === "POSITION" && (
          <>
            <div>
              <label className={labelCls} htmlFor="line-position">
                Proposed projects above the line <span className="text-rose-600">*</span>
              </label>
              <input
                id="line-position"
                inputMode="numeric"
                className={`${inputCls} max-w-[8rem] ${invalidClass(form, "position")}`}
                {...form.register("position")}
                {...fieldA11y(form, "position")}
              />
              <FieldError form={form} name="position" />
              {cumulative !== null && (
                <p className="mt-1 text-[11px] text-slate-600" aria-live="polite">
                  Total above the line before overrides: <span className="font-semibold">{money(cumulative)}</span>
                  {ranking.ceilingNgn !== null && cumulative > ranking.ceilingNgn && <span className="font-semibold text-amber-800"> (above the ceiling)</span>}
                </p>
              )}
            </div>
            <div>
              <label className={labelCls} htmlFor="line-reason">
                Reason <span className="text-rose-600">*</span>
              </label>
              <textarea id="line-reason" rows={3} className={`${inputCls} ${invalidClass(form, "reason")}`} {...form.register("reason")} {...fieldA11y(form, "reason")} />
              <FieldError form={form} name="reason" />
            </div>
          </>
        )}
        <div className="flex flex-wrap items-start justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">
            Cancel
          </button>
          <SubmitButton form={form} pending={setLine.isPending} pendingLabel="Saving…">
            {mode === "CEILING" ? "Move back to the ceiling" : "Move the line"}
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Minutes upload
// ---------------------------------------------------------------------------

function fileProblem(file: File): string | null {
  if (file.size > NEEDS_DOCUMENT_UPLOAD_POLICY.maxBytes) return `The file is larger than ${Math.round(NEEDS_DOCUMENT_UPLOAD_POLICY.maxBytes / 1024 / 1024)} MB.`;
  if (!NEEDS_DOCUMENT_UPLOAD_POLICY.mimeTypes.includes(mimeTypeOf(file))) return "Choose a PDF, photo, Word, Excel or text file.";
  return null;
}

/** Choose a file and upload it as the committee minutes; `onUploaded` gets the new cycle document. */
export function MinutesUploadButton({ cycleId, onUploaded, label = "Upload minutes" }: { cycleId: string; onUploaded?: (doc: NeedsCycleDocumentDto) => void; label?: string }) {
  const upload = useUploadMinutesMutation(cycleId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div>
      <button type="button" className={secondaryButtonCls} disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
        <FileUp className="h-3.5 w-3.5" aria-hidden="true" /> {upload.isPending ? "Uploading…" : label}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept={DOCUMENT_FILE_ACCEPT}
        className="hidden"
        aria-label="Committee minutes file"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = "";
          if (!f) return;
          const p = fileProblem(f);
          setProblem(p);
          if (p) return;
          const title = `Committee minutes: ${f.name.replace(/\.[^.]+$/, "")}`.slice(0, 200);
          upload.mutate({ file: f, title }, { onSuccess: (doc) => onUploaded?.(doc) });
        }}
      />
      {problem && <p className="mt-1 text-xs font-medium text-rose-700">{problem}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Finalise
// ---------------------------------------------------------------------------

const FinaliseFormSchema = z.object({ minutesDocumentId: z.string(), note: ReasonSchema });

export function FinaliseDialog({
  cycleId,
  ranking,
  minutes,
  onClose,
}: {
  cycleId: string;
  ranking: NeedsRankingDto;
  minutes: readonly NeedsCycleDocumentDto[];
  onClose: () => void;
}) {
  const finalise = useFinaliseRankingMutation(cycleId);
  const form = useZodForm(FinaliseFormSchema, { defaultValues: { minutesDocumentId: minutes[0]?.id ?? "", note: "" } });
  const chosen = form.watch("minutesDocumentId");
  const above = ranking.rows.filter((r) => r.aboveLine);
  const below = ranking.rows.length - above.length;
  const submit = form.handleSubmit((v) =>
    finalise.mutate({ minutesDocumentId: v.minutesDocumentId || null, note: v.note.trim() ? v.note.trim() : null }, { onSuccess: () => onClose() })
  );

  return (
    <ModalShell title="Finalise the ranking" subtitle="Proposed projects move to Approval" onClose={onClose}>
      <form className="space-y-3 p-5" noValidate onSubmit={submit}>
        <ul className="space-y-1 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">
          <li>
            <span className="font-semibold">{above.length}</span> above the line, total <span className="font-semibold">{money(ranking.totalAboveNgn)}</span>
            {ranking.ceilingNgn !== null && <> against a ceiling of {money(ranking.ceilingNgn)}</>}
          </li>
          <li>
            <span className="font-semibold">{below}</span> below the line
          </li>
          <li>Ranks, scores and the line are stored. Score sheets become read-only and are shown to the committee.</li>
        </ul>

        <fieldset>
          <legend className={labelCls}>Committee minutes (optional, can be added later)</legend>
          {minutes.length > 0 && (
            <div className="space-y-1">
              {minutes.map((d) => (
                <label key={d.id} className="flex items-start gap-2 text-xs text-slate-700">
                  <input
                    type="radio"
                    className="mt-0.5"
                    checked={chosen === d.id}
                    onChange={() => form.setValue("minutesDocumentId", d.id, { shouldValidate: true, shouldDirty: true })}
                  />
                  <span>
                    <span className="font-semibold text-slate-900">{d.title}</span> · {d.fileName} · {formatBytes(d.byteSize)} · {formatDateTimeShort(d.uploadedAt)}
                  </span>
                </label>
              ))}
              <label className="flex items-start gap-2 text-xs text-slate-700">
                <input type="radio" className="mt-0.5" checked={chosen === ""} onChange={() => form.setValue("minutesDocumentId", "", { shouldValidate: true, shouldDirty: true })} />
                <span>Finalise without minutes</span>
              </label>
            </div>
          )}
          <div className="mt-2">
            <MinutesUploadButton
              cycleId={cycleId}
              label={minutes.length ? "Upload other minutes" : "Upload minutes"}
              onUploaded={(doc) => form.setValue("minutesDocumentId", doc.id, { shouldValidate: true, shouldDirty: true })}
            />
          </div>
        </fieldset>

        <div>
          <label className={labelCls} htmlFor="finalise-note">
            Note (optional)
          </label>
          <textarea id="finalise-note" rows={2} className={`${inputCls} ${invalidClass(form, "note")}`} {...form.register("note")} {...fieldA11y(form, "note")} />
          <FieldError form={form} name="note" />
        </div>

        <div className="flex flex-wrap items-start justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600">
            Cancel
          </button>
          <SubmitButton form={form} pending={finalise.isPending} pendingLabel="Finalising…">
            Finalise: move to Approval
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}
