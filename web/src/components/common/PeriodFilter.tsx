import { useCallback, useId, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarRange } from "lucide-react";
import {
  describePeriod,
  fiscalYearOf,
  fiscalYearRange,
  PERIOD_PRESET_LABELS,
  PeriodPresetEnum,
  periodRange,
  type DateRange,
  type PeriodPreset,
  type PeriodSelection,
} from "@insite/shared";
import { CustomSelect } from "./CustomSelect";

/**
 * Client demo updates G.1: the period filter of the payments screens. A preset (this/last month,
 * this/last quarter, a quarter of a fiscal year, this fiscal year, a fiscal year, a custom range,
 * all time) resolved with the shared `periodRange` on the tenant's fiscal year start. The screen
 * sends the resolved `{ from, to }` (inclusive, by date paid) to the server.
 */

const PRESET_ORDER: PeriodPreset[] = ["THIS_MONTH", "LAST_MONTH", "THIS_QUARTER", "LAST_QUARTER", "QUARTER", "THIS_FISCAL_YEAR", "FISCAL_YEAR", "CUSTOM", "ALL"];
const PRESET_OPTION_LABELS: Partial<Record<PeriodPreset, string>> = { QUARTER: "Quarter of a fiscal year…", FISCAL_YEAR: "Fiscal year…", CUSTOM: "Custom range…" };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Today in the browser (YYYY-MM-DD), until the server's tenant date arrives. */
export function browserToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "1 Jan 2026" from YYYY-MM-DD (no time zone involved). */
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** The dates a period covers, in words ("1 Jan 2026 – 31 Mar 2026", "from 1 Jan 2026", "every date"). */
export function describeRange(range: DateRange): string {
  if (range.from && range.to) return `${dayLabel(range.from)} – ${dayLabel(range.to)}`;
  if (range.from) return `from ${dayLabel(range.from)}`;
  if (range.to) return `up to ${dayLabel(range.to)}`;
  return "every date";
}

/**
 * The period kept in the URL (replace, not push): `period` (preset), `fy`, `qtr`, `from`, `to`.
 * `qtr`, not `q`: the workspace home already uses `q` for the register search. The default
 * selection leaves the URL clean.
 */
export function usePeriodUrlState(defaultSelection: PeriodSelection): [PeriodSelection, (next: PeriodSelection) => void] {
  const [params, setParams] = useSearchParams();
  const presetText = params.get("period");
  const fyText = params.get("fy");
  const qtrText = params.get("qtr");
  const fromText = params.get("from");
  const toText = params.get("to");
  const selection = useMemo<PeriodSelection>(() => {
    const preset = PeriodPresetEnum.safeParse(presetText);
    if (!preset.success) return defaultSelection;
    const fy = fyText && /^\d{4}$/.test(fyText) ? Number(fyText) : null;
    const quarter = qtrText && /^[1-4]$/.test(qtrText) ? Number(qtrText) : null;
    return {
      preset: preset.data,
      fiscalYear: fy,
      quarter,
      from: fromText && ISO_DATE.test(fromText) ? fromText : null,
      to: toText && ISO_DATE.test(toText) ? toText : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the default is a constant of the screen
  }, [presetText, fyText, qtrText, fromText, toText]);

  const setSelection = useCallback(
    (next: PeriodSelection) =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          ["period", "fy", "qtr", "from", "to"].forEach((k) => p.delete(k));
          const isDefault =
            next.preset === defaultSelection.preset &&
            !next.fiscalYear &&
            !next.quarter &&
            !next.from &&
            !next.to;
          if (!isDefault) {
            p.set("period", next.preset);
            if (next.preset === "QUARTER" || next.preset === "FISCAL_YEAR") {
              if (next.fiscalYear) p.set("fy", String(next.fiscalYear));
              if (next.preset === "QUARTER" && next.quarter) p.set("qtr", String(next.quarter));
            }
            if (next.preset === "CUSTOM") {
              if (next.from) p.set("from", next.from);
              if (next.to) p.set("to", next.to);
            }
          }
          return p;
        },
        { replace: true }
      ),
    [setParams, defaultSelection.preset]
  );
  return [selection, setSelection];
}

const inputClass =
  "rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary";

export function PeriodFilter({
  value,
  onChange,
  today,
  fiscalYearStartMonth,
  compact = false,
}: {
  value: PeriodSelection;
  onChange: (next: PeriodSelection) => void;
  /** Today in the tenant's zone (YYYY-MM-DD). */
  today: string;
  fiscalYearStartMonth: number;
  /** Leave out the line that spells out the dates (when the screen shows it elsewhere). */
  compact?: boolean;
}) {
  const id = useId();
  const currentFy = fiscalYearOf(today, fiscalYearStartMonth);
  const fy = value.fiscalYear ?? currentFy;
  const range = periodRange(value, today, fiscalYearStartMonth);
  const fyLabel = (y: number) => {
    if (fiscalYearStartMonth === 1) return `FY${y}`;
    const r = fiscalYearRange(y, fiscalYearStartMonth);
    const [fy1, fm1] = (r.from ?? "").split("-").map(Number);
    const [fy2, fm2] = (r.to ?? "").split("-").map(Number);
    return `FY${y} (${MONTHS[fm1 - 1]} ${fy1} – ${MONTHS[fm2 - 1]} ${fy2})`;
  };
  const years = useMemo(() => Array.from({ length: 7 }, (_, i) => currentFy + 1 - i), [currentFy]);

  const setPreset = (preset: PeriodPreset) => {
    if (preset === "QUARTER") onChange({ preset, fiscalYear: fy, quarter: value.quarter ?? 1 });
    else if (preset === "FISCAL_YEAR") onChange({ preset, fiscalYear: fy });
    else if (preset === "CUSTOM") onChange({ preset, from: range.from, to: range.to });
    else onChange({ preset });
  };

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Period (date paid)">
      <CalendarRange className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
      <div className="w-48">
        <CustomSelect
          ariaLabel="Period"
          value={value.preset}
          onChange={(v) => setPreset(v as PeriodPreset)}
          options={PRESET_ORDER.map((p) => ({ value: p, label: PRESET_OPTION_LABELS[p] ?? PERIOD_PRESET_LABELS[p] }))}
          size="sm"
        />
      </div>
      {value.preset === "QUARTER" && (
        <div className="w-24">
          <CustomSelect
            ariaLabel="Quarter"
            value={String(value.quarter ?? 1)}
            onChange={(v) => onChange({ ...value, fiscalYear: fy, quarter: Number(v) })}
            options={[1, 2, 3, 4].map((q) => ({ value: String(q), label: `Q${q}` }))}
            size="sm"
          />
        </div>
      )}
      {(value.preset === "QUARTER" || value.preset === "FISCAL_YEAR") && (
        <div className={fiscalYearStartMonth === 1 ? "w-28" : "w-56"}>
          <CustomSelect
            ariaLabel="Fiscal year"
            value={String(fy)}
            onChange={(v) => onChange({ ...value, fiscalYear: Number(v) })}
            options={years.map((y) => ({ value: String(y), label: fyLabel(y) }))}
            size="sm"
          />
        </div>
      )}
      {value.preset === "CUSTOM" && (
        <>
          <label className="sr-only" htmlFor={`${id}-from`}>
            Paid from
          </label>
          <input
            id={`${id}-from`}
            type="date"
            className={inputClass}
            value={value.from ?? ""}
            max={value.to ?? undefined}
            onChange={(e) => onChange({ ...value, from: e.target.value || null })}
          />
          <span className="text-xs text-slate-500" aria-hidden="true">
            to
          </span>
          <label className="sr-only" htmlFor={`${id}-to`}>
            Paid up to
          </label>
          <input
            id={`${id}-to`}
            type="date"
            className={inputClass}
            value={value.to ?? ""}
            min={value.from ?? undefined}
            onChange={(e) => onChange({ ...value, to: e.target.value || null })}
          />
        </>
      )}
      {!compact && (
        <span className="text-[11px] text-slate-500" aria-live="polite">
          {periodLabel(value, today, fiscalYearStartMonth)}
        </span>
      )}
    </div>
  );
}

/** "Q2 FY2026 · 1 Apr 2026 – 30 Jun 2026", "1 Nov 2026 – 30 Nov 2026", "All time". */
export function periodLabel(value: PeriodSelection, today: string, fiscalYearStartMonth: number): string {
  if (value.preset === "ALL") return "All time";
  const dates = describeRange(periodRange(value, today, fiscalYearStartMonth));
  const named = ["THIS_QUARTER", "LAST_QUARTER", "QUARTER", "THIS_FISCAL_YEAR", "FISCAL_YEAR"].includes(value.preset);
  if (value.preset === "LAST_QUARTER") return `${PERIOD_PRESET_LABELS.LAST_QUARTER} · ${dates}`;
  return named ? `${describePeriod(value, today, fiscalYearStartMonth)} · ${dates}` : dates;
}

/** The `{ from, to }` query keys of a selection (undefined when open), for the API and the export. */
export function periodQuery(value: PeriodSelection, today: string, fiscalYearStartMonth: number): { from?: string; to?: string } {
  const r = periodRange(value, today, fiscalYearStartMonth);
  // A custom range typed backwards would be refused (400): swap it.
  const [from, to] = r.from && r.to && r.from > r.to ? [r.to, r.from] : [r.from, r.to];
  return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
}
