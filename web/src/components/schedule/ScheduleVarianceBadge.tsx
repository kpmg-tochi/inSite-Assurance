import React from "react";
import { SCHEDULE_STATUS_META, type ScheduleStatusValue, type ScheduleVarianceBadge as Badge } from "@insite/shared";

const TONE_CLASSES: Record<string, string> = {
  positive: "bg-emerald-50 text-emerald-700 border-emerald-200",
  neutral: "bg-slate-50 text-slate-600 border-slate-200",
  warning: "bg-amber-50 text-amber-700 border-amber-200",
  critical: "bg-rose-50 text-rose-700 border-rose-200",
  muted: "bg-slate-50 text-slate-400 border-slate-200",
};

function toneFor(status: ScheduleStatusValue): string {
  return SCHEDULE_STATUS_META[status].tone;
}

/** Schedule pill: "On track", "Behind", "No sprints" (redesign R2d: computed from sprints). */
export function ScheduleVariancePill({
  status,
  label,
  title,
  size = "sm",
}: {
  status: ScheduleStatusValue;
  label: string;
  title?: string;
  size?: "xs" | "sm";
}) {
  const tone = toneFor(status);
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

/** The stored project badge (directory, dashboard, portfolio). Renders nothing without one. */
export function ScheduleBadge({ badge, size = "sm" }: { badge: Badge | null | undefined; size?: "xs" | "sm" }) {
  if (!badge) return null;
  const computed = badge.computedAt ? ` · computed ${new Date(badge.computedAt).toLocaleString()}` : "";
  return (
    <ScheduleVariancePill
      status={badge.status}
      label={badge.label}
      size={size}
      title={`Schedule from sprints: behind when a unit due by an ended sprint is not complete${computed}`}
    />
  );
}
