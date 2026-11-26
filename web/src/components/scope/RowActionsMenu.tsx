import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";

/**
 * Design refinement (2026-11-26): the "…" menu of a facility unit row on BoQ & work phases.
 * WAI-ARIA menu button: Enter/Space/ArrowDown open it on the first item, arrows move, Escape and Tab
 * close it (Escape returns focus to the button). The menu is fixed-positioned so the table's own
 * scroll container never clips it. A disabled item stays focusable (`aria-disabled`) and says why
 * underneath, so the rule is read out and visible instead of sitting in a paragraph on the page.
 */

export interface RowMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  /** Set when the action is not possible: shown under the label and read out. */
  disabledReason?: string | null;
}

export function RowActionsMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setPos(null);
    if (refocus) buttonRef.current?.focus();
  }, []);

  const openMenu = () => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    setOpen(true);
  };

  // Flip above the button when the menu would run off the bottom of the window; focus the first item.
  useLayoutEffect(() => {
    if (!open || !menuRef.current || !buttonRef.current) return;
    const menu = menuRef.current.getBoundingClientRect();
    const btn = buttonRef.current.getBoundingClientRect();
    if (menu.bottom > window.innerHeight - 8 && btn.top - menu.height - 4 > 8) {
      setPos((p) => (p ? { ...p, top: btn.top - menu.height - 4 } : p));
    }
    itemRefs.current[0]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) close(false);
    };
    const onMove = () => close(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, close]);

  const focusItem = (index: number) => {
    const n = items.length;
    itemRefs.current[(index + n) % n]?.focus();
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    if (e.key === "ArrowDown") focusItem(current + 1);
    else if (e.key === "ArrowUp") focusItem(current - 1);
    else if (e.key === "Home") focusItem(0);
    else if (e.key === "End") focusItem(items.length - 1);
    else if (e.key === "Escape") close(true);
    else if (e.key === "Tab") {
      close(false);
      return;
    } else return;
    e.preventDefault();
  };

  if (items.length === 0) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (open) close(false);
          else openMenu();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            openMenu();
          }
        }}
        className="rounded-lg p-1.5 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>
      {open && pos && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", top: pos.top, right: pos.right }}
          className="z-50 w-60 rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
        >
          {items.map((item, i) => {
            const disabled = Boolean(item.disabledReason);
            const reasonId = `${menuId}-${item.id}-reason`;
            return (
              <button
                key={item.id}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={disabled || undefined}
                aria-describedby={disabled ? reasonId : undefined}
                onClick={() => {
                  if (disabled) return;
                  close(false);
                  item.onSelect();
                }}
                className={`flex w-full items-start gap-2 px-3.5 py-2 text-left text-xs focus:outline-none ${
                  disabled
                    ? "cursor-not-allowed text-slate-500 focus:bg-slate-50"
                    : item.danger
                      ? "text-rose-700 hover:bg-rose-50 focus:bg-rose-50"
                      : "text-slate-800 hover:bg-slate-50 focus:bg-slate-50"
                }`}
              >
                {item.icon && <span className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true">{item.icon}</span>}
                <span className="min-w-0">
                  <span className="block font-semibold">{item.label}</span>
                  {disabled && (
                    <span id={reasonId} className="mt-0.5 block text-[11px] font-normal leading-snug text-slate-500">
                      {item.disabledReason}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
