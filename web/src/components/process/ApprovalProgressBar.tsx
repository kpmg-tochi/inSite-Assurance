import React, { useId, useState } from "react";
import { CheckCircle2, Circle, CornerUpLeft, MinusCircle, Timer } from "lucide-react";
import type { ApprovalProgressDto, ApprovalProgressStep } from "@insite/shared";
import { formatDateTimeShort, formatNaira } from "../../lib/formatters";

const STATE_STYLE: Record<ApprovalProgressStep["state"], { cls: string; icon: React.ReactNode; label: string }> = {
  DONE: { cls: "border-emerald-200 bg-emerald-50 text-emerald-800", icon: <CheckCircle2 className="w-3.5 h-3.5" />, label: "Approved" },
  CURRENT: { cls: "border-amber-300 bg-amber-50 text-amber-900", icon: <Timer className="w-3.5 h-3.5" />, label: "Waiting" },
  SKIPPED: { cls: "border-slate-200 bg-slate-50 text-slate-500", icon: <MinusCircle className="w-3.5 h-3.5" />, label: "Skipped (below threshold)" },
  PENDING: { cls: "border-slate-200 bg-white text-slate-500", icon: <Circle className="w-3.5 h-3.5" />, label: "Later" },
};

const DECISION_LABEL = { APPROVE: "approved", RETURN: "returned", REJECT: "rejected" } as const;

/**
 * Position on an approval chain with its history. When `onReview` is given and the caller can act,
 * shows Approve and Return (Return needs notes). Otherwise shows why the caller cannot act.
 */
export function ApprovalProgressBar({
  approval,
  title = "Approval chain",
  onReview,
  isPending,
  hideActions,
}: {
  approval: ApprovalProgressDto;
  title?: string;
  onReview?: (decision: "APPROVE" | "RETURN", notes: string | null) => Promise<unknown>;
  isPending?: boolean;
  /** Hide the review buttons (e.g. the current step is handled by another screen such as release). */
  hideActions?: boolean;
}) {
  const [mode, setMode] = useState<"idle" | "approve" | "return">("idle");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const notesId = useId();
  const steps = [...approval.steps].sort((a, b) => a.stepOrder - b.stepOrder);
  const current = steps.find((s) => s.state === "CURRENT");

  const submit = async () => {
    const trimmed = notes.trim();
    if (mode === "return" && trimmed.length < 5) {
      setError("Say what must change (at least 5 characters).");
      return;
    }
    setError(null);
    try {
      await onReview?.(mode === "return" ? "RETURN" : "APPROVE", trimmed || null);
      setMode("idle");
      setNotes("");
    } catch {
      // The mutation hook shows the error.
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-slate-800">{title}</p>
        <span className="text-[10px] text-slate-400">Chain version {approval.chainVersion}</span>
      </div>

      <ol className="flex flex-wrap items-stretch gap-1.5" aria-label={title}>
        {steps.map((s) => {
          const style = STATE_STYLE[s.state];
          return (
            <li
              key={s.id}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] ${style.cls}`}
              title={`${style.label}${s.requiredRoleName ? ` · role ${s.requiredRoleName}` : ""}${
                s.minAmountThresholdNgn != null ? ` · from ${formatNaira(s.minAmountThresholdNgn)}` : ""
              }`}
            >
              {style.icon}
              <span className="font-semibold">
                {s.stepOrder}. {s.label}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="text-[11px] text-slate-600">
        {approval.completed
          ? "Every step has approved."
          : current
            ? `Waiting on step ${current.stepOrder}: ${current.label}.`
            : approval.currentStepOrder === 0
              ? "Returned; it re-enters at step 1 when revised."
              : "Not started."}
      </p>

      {approval.actions.length > 0 && (
        <ul className="space-y-1 border-t border-slate-100 pt-2">
          {approval.actions.map((a) => (
            <li key={a.id} className="text-[11px] text-slate-600">
              <span className={a.decision === "APPROVE" ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"}>
                {a.decision === "RETURN" && <CornerUpLeft className="inline w-3 h-3 mr-0.5" />}
                {a.actorName ?? "Someone"} {DECISION_LABEL[a.decision]}
              </span>{" "}
              step {a.stepOrder} ({a.stepLabel}) · {formatDateTimeShort(a.createdAt)}
              {a.notes && <span className="block pl-3 text-slate-500">“{a.notes}”</span>}
            </li>
          ))}
        </ul>
      )}

      {!approval.completed && !hideActions && onReview && (
        approval.canAct ? (
          mode === "idle" ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode("approve")}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => setMode("return")}
                className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
              >
                Return
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-[11px] font-semibold text-slate-700" htmlFor={notesId}>
                {mode === "return" ? "What must change (required)" : "Notes (optional)"}
              </label>
              <textarea
                id={notesId}
                rows={3}
                maxLength={1500}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:border-brand-primary"
              />
              {error && <p className="text-[11px] font-medium text-red-600">{error}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={submit}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${
                    mode === "return" ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"
                  }`}
                >
                  {isPending ? "Saving…" : mode === "return" ? "Return" : "Confirm approval"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("idle");
                    setError(null);
                  }}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )
        ) : (
          approval.cannotActReason && <p className="text-[11px] text-slate-500">{approval.cannotActReason}</p>
        )
      )}
    </div>
  );
}
