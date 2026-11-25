import React, { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { DEFAULT_RATING_CRITERIA, RatingCriteriaListSchema, type RatingCriterion } from "@insite/shared";
import Loader from "../Loader";
import { useRatingCriteriaQuery } from "../../queries/closure/useClosureQueries";
import { useSaveRatingCriteriaMutation } from "../../mutations/closure/useClosureMutations";

const inputCls = "w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:border-brand-primary";
const iconButton = "rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-800 disabled:opacity-30";

/** "Health & safety" → "health_safety", unique among `taken`. */
function keyFrom(label: string, taken: string[]): string {
  let base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 36);
  if (!/^[a-z]/.test(base)) base = `c_${base}`.replace(/_+$/, "");
  if (base.length < 2) base = "criterion";
  let key = base;
  for (let n = 2; taken.includes(key); n += 1) key = `${base}_${n}`;
  return key;
}

interface Row extends RatingCriterion {
  /** Saved before: its key is fixed (ratings refer to it). */
  saved: boolean;
}

/**
 * Phase 15 tenant setting: the criteria contractors are rated on (1 to 5 each). A change applies
 * to new ratings; recorded ratings keep the criteria and labels they were given.
 */
export function RatingCriteriaCard() {
  const query = useRatingCriteriaQuery();
  const save = useSaveRatingCriteriaMutation();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (query.data && rows === null) setRows(query.data.map((c) => ({ ...c, saved: true })));
  }, [query.data, rows]);

  if (query.isLoading || !rows) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 flex justify-center">
        <Loader inline />
      </div>
    );
  }

  const payload: RatingCriterion[] = rows.map((r) => ({ key: r.key, label: r.label.trim(), description: r.description?.trim() || null }));
  const parsed = RatingCriteriaListSchema.safeParse(payload);
  const problem = parsed.success ? null : parsed.error.issues[0]?.message ?? "Check the criteria.";
  const update = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...rows];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setRows(next);
  };

  return (
    <form
      className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!parsed.success) return;
        save.mutate(parsed.data, { onSuccess: (data) => setRows(data.map((c) => ({ ...c, saved: true }))) });
      }}
    >
      <div>
        <h3 className="text-sm font-bold text-slate-900">Contractor rating criteria</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Each contractor is scored 1 to 5 on every criterion at completion and after closure. Changes apply to new ratings; recorded ratings keep the
          criteria they were given.
        </p>
      </div>

      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 p-3 md:grid-cols-[1fr_2fr_auto]">
            <label className="block text-[11px] font-medium text-slate-700">
              Criterion
              <input
                className={`${inputCls} mt-1`}
                value={row.label}
                maxLength={80}
                onChange={(e) => update(i, { label: e.target.value, ...(row.saved ? {} : { key: keyFrom(e.target.value, rows.filter((_, j) => j !== i).map((r) => r.key)) }) })}
              />
              <span className="mt-0.5 block text-[10px] text-slate-400">Key: {row.key}</span>
            </label>
            <label className="block text-[11px] font-medium text-slate-700">
              What a good score means
              <input className={`${inputCls} mt-1`} value={row.description ?? ""} maxLength={300} onChange={(e) => update(i, { description: e.target.value })} />
            </label>
            <div className="flex items-start gap-1 pt-5">
              <button type="button" className={iconButton} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button type="button" className={iconButton} disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button type="button" className={iconButton} disabled={rows.length <= 1} onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove criterion">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-3">
          <button
            type="button"
            disabled={rows.length >= 12}
            onClick={() => setRows([...rows, { key: keyFrom("criterion", rows.map((r) => r.key)), label: "", description: null, saved: false }])}
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-primary hover:underline disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" /> Add criterion
          </button>
          <button
            type="button"
            onClick={() => setRows(DEFAULT_RATING_CRITERIA.map((c) => ({ ...c, saved: rows.some((r) => r.saved && r.key === c.key) })))}
            className="text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            Reset to the defaults
          </button>
        </div>
        <div className="flex items-center gap-3">
          {problem && <span className="text-[11px] text-rose-700">{problem}</span>}
          <button
            type="submit"
            disabled={save.isPending || Boolean(problem)}
            className="px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-primary"
          >
            {save.isPending ? "Saving…" : "Save criteria"}
          </button>
        </div>
      </div>
    </form>
  );
}
