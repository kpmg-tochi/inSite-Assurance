import React, { useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Redesign R6b: accessible tabs (WAI-ARIA tabs pattern, automatic activation). One tab stop for the
 * list; Left/Right/Home/End move between tabs and select them. The selected tab lives in the URL
 * (`?tab=`) through `useUrlTab`, so notification links and reloads open the right tab.
 */

export interface TabItem<T extends string> {
  id: T;
  label: React.ReactNode;
  /** Small count shown after the label (text, so it is read out). */
  count?: number | null;
}

export const tabId = (idPrefix: string, id: string) => `${idPrefix}-tab-${id}`;
export const tabPanelId = (idPrefix: string, id: string) => `${idPrefix}-panel-${id}`;

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  label,
  idPrefix,
}: {
  tabs: readonly TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  /** Accessible name of the tab list. */
  label: string;
  idPrefix: string;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement | null>());

  const move = (from: number, delta: number | "first" | "last") => {
    const n = tabs.length;
    const index = delta === "first" ? 0 : delta === "last" ? n - 1 : (from + delta + n) % n;
    const next = tabs[index];
    onChange(next.id);
    refs.current.get(next.id)?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "ArrowRight") move(index, 1);
    else if (e.key === "ArrowLeft") move(index, -1);
    else if (e.key === "Home") move(index, "first");
    else if (e.key === "End") move(index, "last");
    else return;
    e.preventDefault();
  };

  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 text-xs font-semibold w-fit max-w-full">
      {tabs.map((t, i) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current.set(t.id, el);
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, t.id)}
            aria-selected={selected}
            aria-controls={tabPanelId(idPrefix, t.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`rounded-lg px-3 py-1.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary ${
              selected ? "bg-white text-brand-primary shadow-xs" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {t.label}
            {typeof t.count === "number" && <span className="ml-1.5 tabular-nums text-slate-500">({t.count})</span>}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idPrefix, id, children }: { idPrefix: string; id: string; children: React.ReactNode }) {
  return (
    <div role="tabpanel" id={tabPanelId(idPrefix, id)} aria-labelledby={tabId(idPrefix, id)} tabIndex={0} className="focus:outline-none">
      {children}
    </div>
  );
}

/**
 * The selected tab from `?tab=`; an unknown or hidden tab falls back to the first visible one.
 * Changing tab keeps only `tab` in the query: the other parameters (`case`, `ticket`) belong to
 * the tab that was open.
 */
export function useUrlTab<T extends string>(visible: readonly T[], param = "tab"): [T | null, (id: T) => void] {
  const [params, setParams] = useSearchParams();
  const requested = params.get(param) as T | null;
  const active = requested && visible.includes(requested) ? requested : (visible[0] ?? null);
  const setActive = useCallback(
    (id: T) => {
      const next = new URLSearchParams();
      next.set(param, id);
      setParams(next, { replace: true });
    },
    [param, setParams]
  );
  return [active, setActive];
}
