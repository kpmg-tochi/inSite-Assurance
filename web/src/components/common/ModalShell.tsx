import React, { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { Overlay } from "./Overlay";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Focus handling for a modal dialog: focus moves into it on open (the first field, else the first
 * control), Tab and Shift+Tab stay inside, Escape closes, and focus returns to where it was on close.
 * Escape that a control inside already handled (e.g. an open select list) is left alone.
 */
export function useDialogFocus(dialogRef: React.RefObject<HTMLElement>, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (dialog) {
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      const field = items.find((el) => el.matches("input, select, textarea"));
      (field ?? items.find((el) => el.getAttribute("aria-label") !== "Close") ?? items[0] ?? dialog).focus();
    }
    return () => {
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [dialogRef]);

  return (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (e.defaultPrevented) return;
      e.stopPropagation();
      onCloseRef.current();
      return;
    }
    const dialog = dialogRef.current;
    if (e.key !== "Tab" || !dialog) return;
    const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      e.preventDefault();
      first.focus();
    }
  };
}

/** Common frame for modal dialogs. */
export function ModalShell({
  title,
  subtitle,
  onClose,
  maxWidth = "max-w-xl",
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  maxWidth?: string;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onKeyDown = useDialogFocus(dialogRef, onClose);

  return (
    <Overlay className="flex items-center justify-center p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`bg-white rounded-2xl border border-slate-200 shadow-2xl w-full ${maxWidth} max-h-[90vh] flex flex-col overflow-hidden focus:outline-none`}
      >
        <div className="px-5 py-4 bg-brand-navy text-white flex items-center justify-between shrink-0">
          <div>
            <h3 id={titleId} className="text-sm font-bold">{title}</h3>
            {subtitle && <p className="text-[11px] text-white/80">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-lg text-white/80 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto">{children}</div>
      </div>
    </Overlay>
  );
}

export function BlockedNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 font-medium">
      {children}
    </div>
  );
}

export function ModalActions({
  onCancel,
  submitLabel,
  pendingLabel,
  isPending,
  disabled,
}: {
  onCancel: () => void;
  submitLabel: string;
  pendingLabel: string;
  isPending: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
      <button
        type="button"
        onClick={onCancel}
        className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={isPending || disabled}
        className="px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? pendingLabel : submitLabel}
      </button>
    </div>
  );
}

export const inputClass =
  "w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:border-brand-primary";
