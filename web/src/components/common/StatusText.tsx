import React from "react";

export type StatusTone = "neutral" | "pending" | "good" | "bad";

const TONE: Record<StatusTone, { dot: string; text: string }> = {
  neutral: { dot: "bg-slate-400", text: "text-slate-700" },
  pending: { dot: "bg-amber-500", text: "text-amber-800" },
  good: { dot: "bg-emerald-600", text: "text-emerald-800" },
  bad: { dot: "bg-rose-600", text: "text-rose-700" },
};

/** A status as a small coloured dot plus plain text (UBEC: no filled pills). */
export function StatusText({ label, tone }: { label: string; tone: StatusTone }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold ${TONE[tone].text}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${TONE[tone].dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}
