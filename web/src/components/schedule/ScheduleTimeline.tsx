import React, { useMemo } from "react";
import { addDays, daysBetween, type ProjectScheduleDto, type ScheduleItemDto } from "@insite/shared";
import { ScheduleVariancePill } from "./ScheduleVarianceBadge";

/**
 * Plain CSS timeline (no Gantt dependency): rows are BOQ items grouped by section; each row shows
 * the original window (outline), the current planned window (filled to certified progress) and the
 * actual window (from the first counted report to completion, or to today while in progress), with
 * a line for today. Positions are percentages of the overall date range.
 */
export function ScheduleTimeline({
  schedule,
  highlight,
}: {
  schedule: ProjectScheduleDto;
  /** Items to emphasise (e.g. those a revision moves), with optional proposed dates. */
  highlight?: Map<string, { newStartDate: string; newEndDate: string }>;
}) {
  const { items, today } = schedule;
  const range = useMemo(() => {
    const all: string[] = [today];
    for (const i of items) {
      for (const d of [i.plannedStartDate, i.plannedEndDate, i.originalPlannedStartDate, i.originalPlannedEndDate, i.actualStartDate, i.actualCompletionDate]) {
        if (d) all.push(d);
      }
    }
    for (const h of highlight?.values() ?? []) all.push(h.newStartDate, h.newEndDate);
    if (schedule.summary.plannedStartDate) all.push(schedule.summary.plannedStartDate);
    if (schedule.summary.plannedEndDate) all.push(schedule.summary.plannedEndDate);
    all.sort();
    const start = addDays(all[0], -3);
    const end = addDays(all[all.length - 1], 3);
    return { start, end, span: Math.max(1, daysBetween(start, end) + 1) };
  }, [items, today, highlight, schedule.summary.plannedStartDate, schedule.summary.plannedEndDate]);

  const pos = (date: string) => (daysBetween(range.start, date) / range.span) * 100;
  const width = (from: string, to: string) => Math.max(0.4, ((daysBetween(from, to) + 1) / range.span) * 100);

  const months = useMemo(() => {
    const out: Array<{ date: string; label: string }> = [];
    let cursor = `${range.start.slice(0, 7)}-01`;
    while (cursor <= range.end) {
      if (cursor >= range.start) {
        out.push({ date: cursor, label: new Date(`${cursor}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" }) });
      }
      const [y, m] = cursor.split("-").map(Number);
      cursor = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
    }
    return out;
  }, [range]);

  const sections = useMemo(() => {
    const out: Array<{ name: string; items: ScheduleItemDto[] }> = [];
    for (const item of items) {
      const s = out.find((x) => x.name === item.section);
      if (s) s.items.push(item);
      else out.push({ name: item.section, items: [item] });
    }
    return out;
  }, [items]);

  const todayLeft = pos(today);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[860px]">
        {/* Header */}
        <div className="grid grid-cols-[260px_1fr_150px] border-b border-slate-200 text-[10px] uppercase tracking-wide text-slate-400">
          <div className="px-3 py-2">WBS item</div>
          <div className="relative h-8">
            {months.map((m) => (
              <span key={m.date} className="absolute top-2 -translate-x-1/2 whitespace-nowrap" style={{ left: `${pos(m.date)}%` }}>
                {m.label}
              </span>
            ))}
          </div>
          <div className="px-3 py-2 text-right">Variance · progress</div>
        </div>

        {sections.map((section) => (
          <div key={section.name}>
            <div className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">{section.name}</div>
            {section.items.map((item) => {
              const moved = highlight?.get(item.id);
              const actualEnd = item.actualCompletionDate ?? (item.actualStartDate ? today : null);
              return (
                <div
                  key={item.id}
                  className={`grid grid-cols-[260px_1fr_150px] items-center border-t border-slate-100 ${moved ? "bg-amber-50/50" : ""}`}
                >
                  <div className="px-3 py-2 min-w-0">
                    <p className="font-mono text-[11px] text-slate-800">
                      {item.wbsCode}
                      {item.isHoldPoint && <span className="ml-1.5 rounded bg-amber-100 px-1 text-[9px] font-sans font-semibold text-amber-800">HP</span>}
                    </p>
                    <p className="truncate text-[11px] text-slate-500" title={item.description}>
                      {item.description}
                    </p>
                  </div>
                  <div className="relative h-10" aria-hidden="true">
                    {months.map((m) => (
                      <span key={m.date} className="absolute top-0 bottom-0 border-l border-dashed border-slate-100" style={{ left: `${pos(m.date)}%` }} />
                    ))}
                    {item.originalPlannedStartDate && item.originalPlannedEndDate && (
                      <span
                        className="absolute top-1 h-2.5 rounded-sm border border-slate-400 border-dashed"
                        style={{ left: `${pos(item.originalPlannedStartDate)}%`, width: `${width(item.originalPlannedStartDate, item.originalPlannedEndDate)}%` }}
                        title={`Original: ${item.originalPlannedStartDate} to ${item.originalPlannedEndDate}`}
                      />
                    )}
                    {item.plannedStartDate && item.plannedEndDate && (
                      <span
                        className={`absolute top-4 h-3 rounded-sm overflow-hidden ${moved ? "bg-slate-200" : "bg-brand-primary/20"}`}
                        style={{ left: `${pos(item.plannedStartDate)}%`, width: `${width(item.plannedStartDate, item.plannedEndDate)}%` }}
                        title={`Planned: ${item.plannedStartDate} to ${item.plannedEndDate} · ${item.certifiedProgressPct}% certified`}
                      >
                        <span className={`block h-full ${moved ? "bg-slate-400" : "bg-brand-primary"}`} style={{ width: `${item.certifiedProgressPct}%` }} />
                      </span>
                    )}
                    {moved && (
                      <span
                        className="absolute top-4 h-3 rounded-sm border-2 border-amber-500 bg-amber-200/60"
                        style={{ left: `${pos(moved.newStartDate)}%`, width: `${width(moved.newStartDate, moved.newEndDate)}%` }}
                        title={`Proposed: ${moved.newStartDate} to ${moved.newEndDate}`}
                      />
                    )}
                    {item.actualStartDate && actualEnd && (
                      <span
                        className={`absolute top-[30px] h-1.5 rounded-full ${item.actualCompletionDate ? "bg-emerald-500" : "bg-emerald-300"}`}
                        style={{ left: `${pos(item.actualStartDate)}%`, width: `${width(item.actualStartDate, actualEnd)}%` }}
                        title={`Actual: ${item.actualStartDate} to ${item.actualCompletionDate ?? "in progress"}`}
                      />
                    )}
                    <span className="absolute top-0 bottom-0 w-px bg-rose-500" style={{ left: `${todayLeft}%` }} />
                  </div>
                  <div className="px-3 py-2 text-right space-y-0.5">
                    <ScheduleVariancePill status={item.status} label={item.varianceLabel} varianceWorkdays={item.varianceWorkdays} size="xs" />
                    <p className="text-[10px] text-slate-500 tabular-nums">
                      {item.certifiedProgressPct.toFixed(0)}% cert · {item.reportedProgressPct.toFixed(0)}% rep
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-4 border-t border-slate-200 px-3 py-2 text-[10px] text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-5 rounded-sm border border-dashed border-slate-400" /> Original baseline
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-5 rounded-sm bg-brand-primary/20 overflow-hidden">
              <span className="block h-full w-1/2 bg-brand-primary" />
            </span>{" "}
            Current plan (filled to certified %)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-5 rounded-full bg-emerald-500" /> Actual
          </span>
          {highlight && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-5 rounded-sm border-2 border-amber-500 bg-amber-200/60" /> Proposed
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-px bg-rose-500" /> Today ({today})
          </span>
        </div>
      </div>
    </div>
  );
}
