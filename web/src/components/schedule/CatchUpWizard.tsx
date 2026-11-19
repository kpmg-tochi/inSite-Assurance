import React, { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import {
  formatVariance,
  type ProjectScheduleDto,
  type ScheduleChangeInput,
  type ScheduleRevisionPreviewDto,
} from "@insite/shared";
import {
  useCreateScheduleRevisionMutation,
  usePreviewScheduleRevisionMutation,
} from "../../mutations/schedule/useScheduleMutations";
import { ScheduleVariancePill } from "./ScheduleVarianceBadge";
import { ScheduleTimeline } from "./ScheduleTimeline";

type Step = 1 | 2 | 3 | 4;
const STEP_TITLES: Record<Step, string> = {
  1: "Choose delayed items",
  2: "New dates or shift",
  3: "Preview",
  4: "Reason and submit",
};

interface ChangeDraft {
  mode: "shift" | "date";
  shiftWorkdays: number;
  newStartDate: string;
}

function errorText(err: unknown): string {
  const anyErr = err as { message?: string; response?: { data?: { error?: { message?: string } } } };
  return anyErr?.response?.data?.error?.message || anyErr?.message || "Could not compute the preview.";
}

/**
 * "Catch Project Up" (Phase 9): (1) choose the delayed items, suggested from variance; (2) enter a
 * new start or a shift in working days; (3) preview before and after, the moved items and the new
 * end; (4) give a reason and submit. Dates move; durations and daily rates do not.
 */
export function CatchUpWizard({ projectId, schedule, onClose }: { projectId: string; schedule: ProjectScheduleDto; onClose: () => void }) {
  const [step, setStep] = useState<Step>(1);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [changes, setChanges] = useState<Record<string, ChangeDraft>>({});
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<ScheduleRevisionPreviewDto | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewMutation = usePreviewScheduleRevisionMutation(projectId);
  const create = useCreateScheduleRevisionMutation(projectId);
  const week = schedule.workWeekDays;
  const weekLength = week.length || 6;

  const candidates = useMemo(
    () => schedule.items.filter((i) => i.plannedStartDate && i.plannedEndDate && i.status !== "COMPLETE"),
    [schedule.items],
  );
  const suggested = useMemo(() => new Set(candidates.filter((i) => i.status === "BEHIND").map((i) => i.id)), [candidates]);
  const itemsById = useMemo(() => new Map(schedule.items.map((i) => [i.id, i])), [schedule.items]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const draftFor = (id: string): ChangeDraft => {
    if (changes[id]) return changes[id];
    const item = itemsById.get(id);
    // Default shift: the item's own delay, rounded to whole working days.
    const behind = item?.varianceWorkdays && item.varianceWorkdays < 0 ? Math.round(-item.varianceWorkdays) : weekLength;
    return { mode: "shift", shiftWorkdays: behind, newStartDate: item?.plannedStartDate ?? "" };
  };
  const setDraft = (id: string, patch: Partial<ChangeDraft>) => setChanges((c) => ({ ...c, [id]: { ...draftFor(id), ...patch } }));

  const requestChanges = (): ScheduleChangeInput[] =>
    [...selected].map((id) => {
      const d = draftFor(id);
      return d.mode === "date" ? { boqItemId: id, newStartDate: d.newStartDate } : { boqItemId: id, shiftWorkdays: d.shiftWorkdays };
    });

  const runPreview = async () => {
    setPreviewError(null);
    setPreview(null);
    try {
      const result = await previewMutation.mutateAsync({ changes: requestChanges() });
      setPreview(result);
      setStep(3);
    } catch (err) {
      setPreviewError(errorText(err));
    }
  };

  const submit = async () => {
    try {
      await create.mutateAsync({ changes: requestChanges(), reason: reason.trim() });
      onClose();
    } catch {
      // The mutation hook shows the error; the wizard stays open to correct it.
    }
  };

  const stepTwoValid = [...selected].every((id) => {
    const d = draftFor(id);
    return d.mode === "date" ? Boolean(d.newStartDate) : Number.isInteger(d.shiftWorkdays) && d.shiftWorkdays !== 0;
  });

  const highlight = useMemo(
    () => (preview ? new Map(preview.adjustments.map((a) => [a.boqItemId, { newStartDate: a.newStartDate, newEndDate: a.newEndDate }])) : undefined),
    [preview],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="catchup-title">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 id="catchup-title" className="text-sm font-bold text-slate-900">
              Catch Project Up
            </h2>
            <p className="text-[11px] text-slate-500">
              Step {step} of 4 · {STEP_TITLES[step]}. Dates move; durations and daily targets stay as they are.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {step === 1 && (
            <>
              <p className="text-xs text-slate-600">
                Pick the items whose delay you accept. Items behind schedule are suggested. Their successors move automatically.
              </p>
              {suggested.size > 0 && (
                <button
                  type="button"
                  className="text-xs font-semibold text-brand-primary hover:underline"
                  onClick={() => setSelected(new Set([...selected, ...suggested]))}
                >
                  Select all {suggested.size} item(s) behind schedule
                </button>
              )}
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {candidates.map((item) => (
                  <li key={item.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50">
                      <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} />
                      <span className="w-20 font-mono text-[11px] text-slate-700">{item.wbsCode}</span>
                      <span className="flex-1 truncate text-xs text-slate-700">{item.description}</span>
                      <span className="text-[11px] text-slate-500 tabular-nums whitespace-nowrap">
                        {item.plannedStartDate} → {item.plannedEndDate}
                      </span>
                      <ScheduleVariancePill status={item.status} label={item.varianceLabel} varianceWorkdays={item.varianceWorkdays} size="xs" />
                      {suggested.has(item.id) && <span className="text-[10px] font-semibold text-amber-700">suggested</span>}
                    </label>
                  </li>
                ))}
                {candidates.length === 0 && <li className="px-3 py-4 text-xs text-slate-500">No dated, unfinished items.</li>}
              </ul>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-xs text-slate-600">
                For each item, enter how many working days it slips ({weekLength} = one week), or its new start date.
              </p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                    <th className="py-1.5">WBS</th>
                    <th className="py-1.5">Current window</th>
                    <th className="py-1.5">Change</th>
                    <th className="py-1.5">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {[...selected].map((id) => {
                    const item = itemsById.get(id)!;
                    const d = draftFor(id);
                    return (
                      <tr key={id} className="border-t border-slate-100">
                        <td className="py-2 font-mono text-[11px]">{item.wbsCode}</td>
                        <td className="py-2 text-slate-600 tabular-nums">
                          {item.plannedStartDate} → {item.plannedEndDate} ({item.durationWorkdays} days)
                        </td>
                        <td className="py-2">
                          <select
                            className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                            value={d.mode}
                            aria-label={`Change type for WBS ${item.wbsCode}`}
                            onChange={(e) => setDraft(id, { mode: e.target.value as ChangeDraft["mode"] })}
                          >
                            <option value="shift">Shift by working days</option>
                            <option value="date">New start date</option>
                          </select>
                        </td>
                        <td className="py-2">
                          {d.mode === "shift" ? (
                            <span className="inline-flex items-center gap-2">
                              <input
                                type="number"
                                className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                                value={d.shiftWorkdays}
                                aria-label={`Shift for WBS ${item.wbsCode}`}
                                onChange={(e) => setDraft(id, { shiftWorkdays: Math.trunc(Number(e.target.value) || 0) })}
                              />
                              <span className="text-[11px] text-slate-500">≈ {formatVariance(-d.shiftWorkdays, week).replace("behind", "later").replace("ahead", "earlier")}</span>
                            </span>
                          ) : (
                            <input
                              type="date"
                              className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                              value={d.newStartDate}
                              aria-label={`New start for WBS ${item.wbsCode}`}
                              onChange={(e) => setDraft(id, { newStartDate: e.target.value })}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {previewError && <p className="text-xs font-medium text-red-600">{previewError}</p>}
            </>
          )}

          {step === 3 && preview && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Projected end</p>
                  <p className="text-sm font-bold text-slate-900 tabular-nums">
                    {preview.previousProjectedEndDate ?? "–"} → {preview.newProjectedEndDate ?? "–"}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {preview.endShiftWorkdays === 0 ? "No change" : `${preview.endShiftWorkdays > 0 ? "+" : ""}${preview.endShiftWorkdays} working days`}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Items moved</p>
                  <p className="text-sm font-bold text-slate-900">{preview.adjustments.length}</p>
                  <p className="text-[11px] text-slate-500">
                    {preview.adjustments.filter((a) => a.cause === "DEPENDENCY").length} through dependencies
                  </p>
                </div>
                <div className={`rounded-xl border p-3 ${preview.requiresApproval ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Approval</p>
                  <p className="text-xs font-semibold text-slate-900">
                    {preview.requiresApproval ? "Needs a second person's approval" : "Applies at once"}
                  </p>
                  <p className="text-[11px] text-slate-600">
                    {preview.requiresApproval ? "It moves the projected end date." : "The projected end date does not move."}
                  </p>
                </div>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                    <th className="py-1.5">WBS</th>
                    <th className="py-1.5">Before</th>
                    <th className="py-1.5">After</th>
                    <th className="py-1.5 text-right">Shift</th>
                    <th className="py-1.5">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.adjustments.map((a) => (
                    <tr key={a.boqItemId} className="border-t border-slate-100">
                      <td className="py-1.5 font-mono text-[11px]">{a.wbsCode}</td>
                      <td className="py-1.5 tabular-nums text-slate-500">
                        {a.previousStartDate} → {a.previousEndDate}
                      </td>
                      <td className="py-1.5 tabular-nums text-slate-900">
                        {a.newStartDate} → {a.newEndDate}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{a.shiftWorkdays > 0 ? `+${a.shiftWorkdays}` : a.shiftWorkdays}</td>
                      <td className="py-1.5 text-[11px] text-slate-500">{a.cause === "REQUESTED" ? "Chosen" : "Follows a predecessor"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="rounded-xl border border-slate-200">
                <ScheduleTimeline schedule={schedule} highlight={highlight} />
              </div>
            </>
          )}

          {step === 4 && preview && (
            <>
              <label className="block text-xs font-semibold text-slate-700" htmlFor="catchup-reason">
                Reason for the delay
              </label>
              <textarea
                id="catchup-reason"
                rows={5}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-brand-primary focus:outline-none"
                placeholder="What caused the delay and why the new dates are realistic. This is kept in the audit ledger."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={2000}
              />
              <p className="text-[11px] text-slate-500">
                {preview.requiresApproval
                  ? `This moves the projected end to ${preview.newProjectedEndDate}. It will wait for approval by someone other than you.`
                  : "The projected end does not move, so this applies as soon as you submit."}
              </p>
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            disabled={step === 1}
            onClick={() => setStep((s) => (s > 1 ? ((s - 1) as Step) : s))}
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          {step === 1 && (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
              disabled={selected.size === 0}
              onClick={() => setStep(2)}
            >
              Next <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
          {step === 2 && (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
              disabled={!stepTwoValid || previewMutation.isPending}
              onClick={runPreview}
            >
              {previewMutation.isPending ? "Working…" : "Preview"} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
          {step === 3 && (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-primary px-4 py-2 text-xs font-semibold text-white"
              onClick={() => setStep(4)}
            >
              Next <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
          {step === 4 && (
            <button
              type="button"
              className="rounded-xl bg-brand-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
              disabled={reason.trim().length < 10 || create.isPending}
              onClick={submit}
            >
              {create.isPending ? "Submitting…" : preview?.requiresApproval ? "Submit for approval" : "Apply revision"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
