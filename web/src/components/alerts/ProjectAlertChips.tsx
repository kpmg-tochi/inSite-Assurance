import { Banknote, CalendarX, Clock, PauseCircle, type LucideIcon } from "lucide-react";
import { PROJECT_ALERT_META, type ProjectAlertKey } from "@insite/shared";
import { formatDateShort } from "../../lib/formatters";

/**
 * UBEC IRL early-warning alerts: one chip per active alert, icon plus label (never colour alone),
 * the description and the day it was raised in the tooltip and for screen readers. Renders nothing
 * when the project has no active alert. `size="sm"` suits table rows.
 */

const ICON: Record<ProjectAlertKey, LucideIcon> = {
  DELAYED: Clock,
  STALLED: PauseCircle,
  SITE_UPDATE_OVERDUE: CalendarX,
  SPEND_AHEAD_OF_PROGRESS: Banknote,
};

/** Delayed and stalled are the serious ones; the others ask for attention. */
const TONE: Record<ProjectAlertKey, string> = {
  DELAYED: "bg-rose-50 text-rose-800 ring-rose-200",
  STALLED: "bg-rose-50 text-rose-800 ring-rose-200",
  SITE_UPDATE_OVERDUE: "bg-amber-50 text-amber-800 ring-amber-200",
  SPEND_AHEAD_OF_PROGRESS: "bg-amber-50 text-amber-800 ring-amber-200",
};

export function ProjectAlertChips({
  alerts,
  raisedAt,
  size = "md",
  className = "",
}: {
  alerts: readonly ProjectAlertKey[] | null | undefined;
  /** When each alert was raised (ISO), shown in the tooltip. */
  raisedAt?: Partial<Record<ProjectAlertKey, string>>;
  size?: "sm" | "md";
  className?: string;
}) {
  if (!alerts || alerts.length === 0) return null;
  const chip = size === "sm" ? "px-1.5 py-0.5 text-[11px] gap-1" : "px-2 py-0.5 text-xs gap-1.5";
  const icon = size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";
  return (
    <ul className={`flex flex-wrap items-center gap-1.5 ${className}`} aria-label="Early-warning alerts">
      {alerts.map((key) => {
        const meta = PROJECT_ALERT_META[key];
        const Icon = ICON[key];
        const since = raisedAt?.[key] ? ` Since ${formatDateShort(raisedAt[key]!)}.` : "";
        return (
          <li key={key}>
            <span title={`${meta.description}${since}`} className={`inline-flex items-center rounded-full font-semibold ring-1 ring-inset ${chip} ${TONE[key]}`}>
              <Icon className={icon} aria-hidden />
              {meta.label}
              <span className="sr-only">
                : {meta.description}
                {since}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
