import React, { useCallback, useRef, useState } from "react";
import { ModalShell } from "../../pages/reconciliation/components/ModalShell";

interface ConfirmRequest {
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
}

/**
 * Promise-based confirmation for flows that must pause mid-save (e.g. a 409 CONFIRMATION_REQUIRED).
 * `ask` resolves true when confirmed; render `dialog` somewhere in the tree.
 */
export function useConfirmDialog() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const ask = useCallback((req: ConfirmRequest) => {
    setRequest(req);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setRequest(null);
  };

  const dialog = request ? (
    <ModalShell title={request.title} onClose={() => close(false)} maxWidth="max-w-md">
      <div className="p-5 space-y-4">
        <div className="text-xs text-slate-700 leading-relaxed">{request.message}</div>
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={() => close(false)}
            className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => close(true)}
            className={`px-4 py-2 rounded-xl text-white text-xs font-semibold shadow-sm ${
              request.danger ? "bg-rose-600 hover:bg-rose-700" : "bg-brand-primary hover:bg-brand-hover"
            }`}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </ModalShell>
  ) : null;

  return { ask, dialog };
}
