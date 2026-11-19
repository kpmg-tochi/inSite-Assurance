import React from "react";
import { SCHEDULE_STATUS_META, type ScheduleStatusValue, type ScheduleVarianceBadge as Badge } from "@insite/shared";

const TONE_CLASSES: Record<string, string> = {
  positive: "bg-emerald-50 text-emerald-700 border-emerald-200",
  neutral: "bg-slate-50 text-slate-600 border-slate-200",
  warning: "bg-amber-50 text-amber-700 border-amber-200",
  critical: "bg-rose-50 text-rose-700 border-rose-200",
  muted: "bg-slate-50 text-slate-400 border-slate-200",
};

/** Tone for a status; "behind" by under two weeks is a warning, not critical. */
function toneFor(status: ScheduleStatusValue, varianceWorkdays: number | null | undefined, weekLength = 6): string {
  if (status === "BEHIND" && varianceWorkdays !== null && varianceWorkdays !== undefined && -varianceWorkdays < 2 * weekLength) {
    return "warning";
  }
  return SCHEDULE_STATUS_META[status].tone;
}

/** Variance pill: "On schedule", "4 weeks behind", "No schedule". */
export function ScheduleVariancePill({
  status,
  label,
  varianceWorkdays,
  title,
  size = "sm",
}: {
  status: ScheduleStatusValue;
  label: string;
  varianceWorkdays?: number | null;
  title?: string;
  size?: "xs" | "sm";
}) {
  const tone = toneFor(status, varianceWorkdays);
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border font-semibold whitespace-nowrap ${TONE_CLASSES[tone]} ${
        size === "xs" ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-[11px]"
      }`}
    >
      {label}
    </span>
  );
}

/** The stored project badge (directory, dashboard, executive matrix). Renders nothing without one. */
export function ScheduleBadge({ badge, size = "sm" }: { badge: Badge | null | undefined; size?: "xs" | "sm" }) {
  if (!badge) return null;
  const computed = badge.computedAt ? ` · computed ${new Date(badge.computedAt).toLocaleString()}` : "";
  return (
    <ScheduleVariancePill
      status={badge.status}
      label={badge.label}
      varianceWorkdays={badge.varianceWorkdays}
      size={size}
      title={`Schedule variance on certified progress${computed}`}
    />
  );
}
