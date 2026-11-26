import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { Ban, CalendarCheck, ChevronLeft, ChevronRight, CircleCheck, CircleDashed, CirclePlay, CircleX, Send, Undo2, type LucideIcon } from "lucide-react";
import { calendarTitle, monthGrid, shiftCalendar, VISIT_STATUS_LABELS, VisitStatusEnum, weekGrid, type CalendarDay, type VisitDto, type VisitStatus } from "@insite/shared";
import Loader from "../Loader";
import { TAB_LIST_CLASS, tabItemClass } from "../common/Tabs";
import { secondaryButton, visitStatusToneClass } from "./visitUi";
import { todayLocalIso, type VisitCalendarState } from "./useVisitCalendar";

/**
 * Client demo updates D4 (wave 4): a read-only month / week calendar of monitoring visits, coloured by status
 * (icon + colour, status in the tooltip and the accessible name). Used beside the list on a
 * project's visit plan and beside the officers grid on the planner. Clicking a visit opens it the
 * way the page already does (`onOpen`, or a link from `hrefFor`). No adding or moving here.
 */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Visits a month cell shows before "+N more" (which opens that week). */
const MONTH_CELL_LIMIT = 3;

const VISIT_STATUS_ICON: Record<VisitStatus, LucideIcon> = {
  PROPOSED: CircleDashed,
  PLANNED: CalendarCheck,
  IN_PROGRESS: CirclePlay,
  SUBMITTED: Send,
  RETURNED: Undo2,
  APPROVED: CircleCheck,
  MISSED: CircleX,
  CANCELLED: Ban,
};

/** "Tuesday 24 November 2026" from YYYY-MM-DD (a calendar date, no zone shift). */
const longDay = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export interface VisitCalendarProps {
  state: VisitCalendarState;
  visits: VisitDto[];
  loading?: boolean;
  error?: boolean;
  /** Bold text of an entry (e.g. the visit kind, or the project code on the planner). */
  primaryText: (v: VisitDto) => string;
  /** Second line / text after the primary (e.g. officer initials, or the visit kind). */
  secondaryText?: (v: VisitDto) => string | null;
  /** Extra words for the tooltip and the accessible name (officers). */
  describe?: (v: VisitDto) => string | null;
  /**
   * What the entry is, for the tooltip and the accessible name (default: the primary text). The
   * status comes first, then this, the day and `describe`; the secondary text (e.g. officer
   * initials) stays visible only, so nothing is read twice.
   */
  labelText?: (v: VisitDto) => string;
  selectedId?: string | null;
  onOpen?: (v: VisitDto) => void;
  hrefFor?: (v: VisitDto) => string;
  /** Statuses the legend lists (the planner never shows cancelled visits). */
  legendStatuses?: readonly VisitStatus[];
  /** Filters shown on the calendar's toolbar. */
  filters?: React.ReactNode;
}

export function VisitCalendar({
  state,
  visits,
  loading,
  error,
  primaryText,
  secondaryText,
  describe,
  labelText,
  selectedId,
  onOpen,
  hrefFor,
  legendStatuses = VisitStatusEnum.options,
  filters,
}: VisitCalendarProps) {
  const { anchor, span, setAnchor, setSpan } = state;
  const today = todayLocalIso();
  const weeks: CalendarDay[][] = useMemo(() => (span === "month" ? monthGrid(anchor) : [weekGrid(anchor)]), [anchor, span]);
  const byDate = useMemo(() => {
    const map = new Map<string, VisitDto[]>();
    for (const v of visits) {
      const list = map.get(v.plannedDate);
      if (list) list.push(v);
      else map.set(v.plannedDate, [v]);
    }
    return map;
  }, [visits]);
  const shownDays = weeks.flat().filter((d) => d.inMonth);
  const shownCount = shownDays.reduce((n, d) => n + (byDate.get(d.date)?.length ?? 0), 0);
  const title = calendarTitle(anchor, span);

  const entryProps = (v: VisitDto) => {
    const extra = describe?.(v);
    const label = [VISIT_STATUS_LABELS[v.status], (labelText ?? primaryText)(v), longDay(v.plannedDate), extra].filter(Boolean).join(" · ");
    return { label, selected: v.id === selectedId };
  };

  const renderEntry = (v: VisitDto, compact: boolean) => {
    const { label, selected } = entryProps(v);
    const Icon = VISIT_STATUS_ICON[v.status];
    const secondary = secondaryText?.(v);
    const className = `block w-full rounded-md px-1.5 py-1 text-left text-[11px] leading-tight transition hover:ring-1 hover:ring-brand-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary ${visitStatusToneClass(v.status)} ${
      selected ? "ring-2 ring-brand-primary" : ""
    }`;
    const body = compact ? (
      <span className="flex min-w-0 items-center gap-1">
        <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="truncate">
          <span className="font-semibold">{primaryText(v)}</span>
          {secondary ? ` ${secondary}` : ""}
        </span>
      </span>
    ) : (
      <span className="block min-w-0">
        <span className="block truncate font-semibold">{primaryText(v)}</span>
        {secondary && <span className="block truncate opacity-90">{secondary}</span>}
        <span className="mt-0.5 flex items-center gap-1 font-semibold">
          <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
          {VISIT_STATUS_LABELS[v.status]}
        </span>
        {v.sprint && <span className="block truncate opacity-80">{v.sprint.name}</span>}
      </span>
    );
    if (hrefFor) {
      return (
        <Link key={v.id} to={hrefFor(v)} title={label} aria-label={label} className={className}>
          {body}
        </Link>
      );
    }
    return (
      <button key={v.id} type="button" title={label} aria-label={label} aria-pressed={selected} onClick={() => onOpen?.(v)} className={className}>
        {body}
      </button>
    );
  };

  const dayHeading = (d: CalendarDay, withWeekday: boolean, index: number) => {
    const isToday = d.date === today;
    return (
      <div className="flex items-center justify-between gap-1">
        <span className="sr-only">{longDay(d.date)}</span>
        <span aria-hidden="true" className={`text-[11px] font-semibold ${d.inMonth ? "text-slate-700" : "text-slate-500"}`}>
          {withWeekday ? `${WEEKDAYS[index]} ` : ""}
          <span className={`inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 tabular-nums ${isToday ? "bg-brand-primary text-white" : ""}`}>{Number(d.date.slice(8))}</span>
        </span>
        {isToday && <span className="text-[10px] font-semibold text-brand-primary">Today</span>}
      </div>
    );
  };

  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 p-3 shadow-sm space-y-3" aria-label="Monitoring calendar">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={secondaryButton} onClick={() => setAnchor(shiftCalendar(anchor, span, -1))} aria-label={span === "month" ? "Previous month" : "Previous week"}>
            <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button type="button" className={secondaryButton} onClick={() => setAnchor(today)}>
            Today
          </button>
          <button type="button" className={secondaryButton} onClick={() => setAnchor(shiftCalendar(anchor, span, 1))} aria-label={span === "month" ? "Next month" : "Next week"}>
            <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <h2 className="text-sm font-bold text-slate-900" aria-live="polite">
            {title}
          </h2>
          <span className="text-[11px] text-slate-500">
            {loading ? "" : `${shownCount} monitoring visit${shownCount === 1 ? "" : "s"}`}
          </span>
        </div>
        <div role="group" aria-label="Calendar period" className={TAB_LIST_CLASS}>
          {(["month", "week"] as const).map((s) => (
            <button key={s} type="button" onClick={() => setSpan(s)} aria-pressed={span === s} className={tabItemClass(span === s)}>
              {s === "month" ? "Month" : "Week"}
            </button>
          ))}
        </div>
      </div>

      {filters}

      {error && <p className="text-xs text-rose-700">The monitoring visits could not be loaded.</p>}

      {loading ? (
        <Loader />
      ) : (
        <>
          {/* Tablet and up: the grid. */}
          <div className="hidden sm:block overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="grid grid-cols-7 border-b border-slate-200" aria-hidden="true">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="px-1.5 py-1 text-[11px] font-semibold text-slate-500">
                    {w}
                  </div>
                ))}
              </div>
              {weeks.map((week) => (
                <div key={week[0].date} className="grid grid-cols-7 border-b border-slate-100">
                  {week.map((d) => {
                    const dayVisits = byDate.get(d.date) ?? [];
                    const isToday = d.date === today;
                    const limit = span === "month" ? MONTH_CELL_LIMIT : dayVisits.length;
                    const hidden = dayVisits.length - limit;
                    return (
                      <div
                        key={d.date}
                        className={`space-y-1 border-r border-slate-100 p-1 last:border-r-0 ${span === "month" ? "min-h-[6.5rem]" : "min-h-[12rem]"} ${
                          isToday ? "bg-brand-primary/[0.05]" : d.inMonth ? "" : "bg-slate-50/80"
                        }`}
                      >
                        {dayHeading(d, false, 0)}
                        <div className="space-y-1">
                          {dayVisits.slice(0, limit).map((v) => renderEntry(v, span === "month"))}
                          {hidden > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setAnchor(d.date);
                                setSpan("week");
                              }}
                              className="w-full rounded-md px-1.5 py-0.5 text-left text-[11px] font-semibold text-brand-primary hover:bg-brand-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                              aria-label={`${hidden} more monitoring visit${hidden === 1 ? "" : "s"} on ${longDay(d.date)}: show that week`}
                            >
                              +{hidden} more
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Phone: the days that have visits, as a list. */}
          <div className="sm:hidden">
            {shownCount === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">No monitoring visits {span === "month" ? "this month" : "this week"}.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {shownDays
                  .filter((d) => byDate.has(d.date))
                  .map((d) => (
                    <li key={d.date} className="space-y-1 py-2">
                      <p className={`text-xs font-semibold ${d.date === today ? "text-brand-primary" : "text-slate-700"}`}>
                        {longDay(d.date)}
                        {d.date === today ? " · Today" : ""}
                      </p>
                      <div className="space-y-1">{(byDate.get(d.date) ?? []).map((v) => renderEntry(v, false))}</div>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </>
      )}

      <ul className="flex flex-wrap gap-x-3 gap-y-1.5 border-t border-slate-100 pt-2" aria-label="Status colours">
        {legendStatuses.map((s) => {
          const Icon = VISIT_STATUS_ICON[s];
          return (
            <li key={s} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${visitStatusToneClass(s)}`}>
              <Icon className="h-3 w-3" aria-hidden="true" />
              {VISIT_STATUS_LABELS[s]}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

