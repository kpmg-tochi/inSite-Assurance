import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { calendarRange, type CalendarSpan, type VisitDto } from "@insite/shared";

/** Client demo updates D4: state of the read-only visit calendar (anchor day and month/week span). */

const pad = (n: number) => String(n).padStart(2, "0");

/** Today as YYYY-MM-DD in the browser's own calendar. */
export const todayLocalIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export interface VisitCalendarState {
  anchor: string;
  span: CalendarSpan;
  setAnchor: (anchor: string) => void;
  setSpan: (span: CalendarSpan) => void;
  /** First and last day the view shows: the query's `from` / `to`. */
  range: { from: string; to: string };
}

export function useVisitCalendarState(initialSpan: CalendarSpan = "month"): VisitCalendarState {
  const [anchor, setAnchor] = useState(todayLocalIso);
  const [span, setSpan] = useState<CalendarSpan>(initialSpan);
  const range = useMemo(() => calendarRange(anchor, span), [anchor, span]);
  return { anchor, span, setAnchor, setSpan, range };
}

/**
 * The page's view (`?view=`), next to `?tab=`: `fallback` (the existing view) leaves the parameter
 * out. Other parameters (`tab`, `visitId`) are kept.
 */
export function useUrlView<T extends string>(views: readonly T[], fallback: T): [T, (view: T) => void] {
  const [params, setParams] = useSearchParams();
  const requested = params.get("view") as T | null;
  const view = requested && views.includes(requested) ? requested : fallback;
  const setView = useCallback(
    (next: T) => {
      const p = new URLSearchParams(params);
      if (next === fallback) p.delete("view");
      else p.set("view", next);
      setParams(p, { replace: true });
    },
    [params, setParams, fallback]
  );
  return [view, setView];
}

/** "AO" for "Ada Okafor"; the lead first, "+1" for each other officer; null without officers. */
export function officerInitials(v: Pick<VisitDto, "assignees">): string | null {
  if (v.assignees.length === 0) return null;
  const lead = v.assignees.find((a) => a.isLead) ?? v.assignees[0];
  const initials = lead.fullName
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("");
  return v.assignees.length > 1 ? `${initials} +${v.assignees.length - 1}` : initials;
}
