import React, { useMemo } from "react";
import { NEEDS_OPEN_PROPOSAL_STATUSES, NEEDS_STAGE_ORDER, deadlineState, type NeedsCycleDto } from "@insite/shared";
import { formatDateShort } from "../../lib/formatters";
import { DEADLINE_PASSED_META, DEADLINE_STATE_META, todayInTenant } from "./needsUi";

/**
 * Needs pipeline wave 2: the cycle's calendar as a strip (stage deadlines, chain steps, extra dates)
 * with a "Today" marker. A past date reads "Overdue" only while proposed projects are still at that
 * stage or an earlier one; otherwise "Passed". Scrolls sideways inside its card on a phone.
 */
export function DeadlineStrip({ cycle }: { cycle: NeedsCycleDto }) {
  const today = todayInTenant();
  const items = useMemo(() => {
    const openAtOrBefore = (stage: NonNullable<NeedsCycleDto["deadlines"][number]["stage"]>) =>
      cycle.counts.some(
        (c) => c.count > 0 && NEEDS_OPEN_PROPOSAL_STATUSES.includes(c.status) && NEEDS_STAGE_ORDER.indexOf(c.stage) <= NEEDS_STAGE_ORDER.indexOf(stage)
      );
    return cycle.deadlines.map((d) => {
      const state = deadlineState(d.date, today);
      const passed = state === "OVERDUE" && (d.stage === null || cycle.status !== "OPEN" || !openAtOrBefore(d.stage));
      return { d, meta: passed ? DEADLINE_PASSED_META : DEADLINE_STATE_META[state], isPast: d.date < today };
    });
  }, [cycle, today]);

  if (items.length === 0) return null;
  const todayIndex = items.findIndex((i) => !i.isPast);

  const todayMarker = (
    <li key="today" className="flex shrink-0 flex-col items-center justify-center px-1" aria-label={`Today, ${formatDateShort(today)}`}>
      <span className="h-full min-h-[3rem] w-0.5 rounded bg-brand-primary" aria-hidden="true" />
      <span className="mt-1 whitespace-nowrap rounded-full bg-brand-primary px-2 py-0.5 text-[10px] font-bold text-white">Today</span>
    </li>
  );

  return (
    <section aria-label="Cycle deadlines" className="rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
      <div className="overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary" tabIndex={0} role="region" aria-label="Deadlines, scroll sideways">
        <ol className="flex min-w-max items-stretch gap-2">
          {items.map((item, i) => {
            const Icon = item.meta.icon;
            return (
              <React.Fragment key={item.d.key}>
                {i === todayIndex && todayMarker}
                <li
                  className={`w-40 shrink-0 rounded-xl border px-3 py-2 ${item.isPast ? "border-slate-100 bg-slate-50" : "border-slate-200 bg-white"}`}
                >
                  <p className="text-[11px] font-semibold tabular-nums text-slate-500">{formatDateShort(item.d.date)}</p>
                  <p className={`mt-0.5 text-xs font-semibold leading-snug ${item.isPast ? "text-slate-600" : "text-slate-900"}`}>{item.d.label}</p>
                  <p className={`mt-1 inline-flex items-center gap-1 text-[11px] font-semibold ${item.meta.cls}`}>
                    <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {item.meta.label}
                  </p>
                </li>
              </React.Fragment>
            );
          })}
          {todayIndex === -1 && todayMarker}
        </ol>
      </div>
    </section>
  );
}
