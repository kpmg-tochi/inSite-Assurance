import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
import { PROJECT_ALERT_META, type ProjectAlertKey } from "@insite/shared";
import { PROJECT_ALERT_ICON, SERIOUS_PROJECT_ALERTS } from "../alerts/ProjectAlertChips";
import { OVERLAY_POPOVER_Z } from "../common/Overlay";

const GAP = 6;
const EDGE = 8;

/**
 * UBEC IRL early-warning alerts, compact for table rows: one warning icon with the number of active
 * alerts (rose when Delayed or Stalled is among them, else amber; never colour alone: icon, count and
 * an accessible name that lists them). Hover, keyboard focus or a tap shows a tooltip with every alert
 * and what it means. The tooltip is portalled to the body with fixed positioning, so a table's scroll
 * container cannot clip it and it sits above maps and open dialogs. Renders nothing without alerts.
 */
export function ProjectAlertIndicator({ alerts }: { alerts: readonly ProjectAlertKey[] | null | undefined }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const tipId = useId();

  // Place the tooltip under the button (above it when there is no room), inside the viewport.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const b = buttonRef.current?.getBoundingClientRect();
    const t = tipRef.current?.getBoundingClientRect();
    if (!b || !t) return;
    const below = b.bottom + GAP;
    const above = b.top - GAP - t.height;
    const top = below + t.height > window.innerHeight - EDGE && above >= EDGE ? above : below;
    const left = Math.min(Math.max(EDGE, b.left), Math.max(EDGE, window.innerWidth - t.width - EDGE));
    setPos({ top, left });
  }, [open]);

  // A fixed tooltip would drift from its button: close it on scroll, resize or a tap elsewhere.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onPointerDown = (e: PointerEvent) => {
      if (!buttonRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  if (!alerts || alerts.length === 0) return null;
  const serious = alerts.some((k) => SERIOUS_PROJECT_ALERTS.includes(k));
  const labels = alerts.map((k) => PROJECT_ALERT_META[k].label);
  const name = `${alerts.length} early-warning alert${alerts.length === 1 ? "" : "s"}: ${labels.join(", ")}`;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={name}
        aria-describedby={open ? tipId : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          // Inside a clickable row: show the alerts, do not open the project.
          e.stopPropagation();
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            // Closes the tooltip only, not a dialog around the table.
            e.preventDefault();
            setOpen(false);
          }
        }}
        className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-inset focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary ${
          serious ? "bg-rose-50 text-rose-800 ring-rose-200" : "bg-amber-50 text-amber-800 ring-amber-200"
        }`}
      >
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        {alerts.length}
      </button>
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={tipId}
            role="tooltip"
            style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
            className={`pointer-events-none fixed ${OVERLAY_POPOVER_Z} w-max max-w-[18rem] rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xl`}
          >
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Early-warning alerts</p>
            <ul className="space-y-2">
              {alerts.map((key) => {
                const meta = PROJECT_ALERT_META[key];
                const Icon = PROJECT_ALERT_ICON[key];
                const tone = SERIOUS_PROJECT_ALERTS.includes(key)
                  ? "bg-rose-50 text-rose-800 ring-rose-200"
                  : "bg-amber-50 text-amber-800 ring-amber-200";
                return (
                  <li key={key}>
                    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${tone}`}>
                      <Icon className="h-3 w-3" aria-hidden="true" />
                      {meta.label}
                    </span>
                    <p className="mt-0.5 text-[11px] leading-snug text-slate-600">{meta.description}</p>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body
        )}
    </>
  );
}
