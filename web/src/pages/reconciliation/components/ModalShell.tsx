import React from "react";
import { X } from "lucide-react";

/** Common frame for the reconciliation workbench modals. */
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
  return (
    <div className="fixed inset-0 bg-slate-950/35 backdrop-blur-[1px] z-50 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        className={`bg-white rounded-2xl border border-slate-200 shadow-2xl w-full ${maxWidth} max-h-[90vh] flex flex-col overflow-hidden`}
      >
        <div className="px-5 py-4 bg-brand-navy text-white flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-sm font-bold">{title}</h3>
            {subtitle && <p className="text-[11px] text-blue-200/80">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-lg text-blue-200 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>
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
