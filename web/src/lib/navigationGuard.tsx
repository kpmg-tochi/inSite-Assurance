import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useNavigate, type NavigateOptions } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Overlay } from "../components/common/Overlay";

/**
 * Leave-page guard for forms with unsaved changes (the project setup wizard). The app uses
 * BrowserRouter, which has no route blocker, so the guard covers the two ways people leave:
 * - in-app links (sidebar NavLinks, breadcrumbs): a capture-phase click listener stops the click;
 * - buttons that call navigate (project switcher, header actions, sign-out): they go through
 *   `useGuardedNavigate` / `useGuardedAction`.
 * Either way the person chooses "Save and leave", "Leave without saving" or "Stay".
 * Reload and tab close are covered separately by the page's beforeunload warning.
 */
export interface LeaveGuard {
  /** What has unsaved changes, e.g. "Parties". */
  label: string;
  /** Saves; resolves false when it could not (the person stays to see the errors). */
  save: () => Promise<boolean>;
}

interface GuardContextValue {
  setGuard: (guard: LeaveGuard | null) => void;
  /** Runs `proceed` now, or after the person confirms when a guard is active. */
  requestLeave: (proceed: () => void) => void;
}

const GuardContext = createContext<GuardContextValue>({
  setGuard: () => undefined,
  requestLeave: (proceed) => proceed(),
});

export function NavigationGuardProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const guardRef = useRef<LeaveGuard | null>(null);
  const [active, setActive] = useState(false);
  const [pending, setPending] = useState<null | (() => void)>(null);
  const [saving, setSaving] = useState(false);

  const setGuard = useCallback((guard: LeaveGuard | null) => {
    guardRef.current = guard;
    setActive(Boolean(guard));
  }, []);

  const requestLeave = useCallback((proceed: () => void) => {
    if (!guardRef.current) {
      proceed();
      return;
    }
    setPending(() => proceed);
  }, []);

  // Intercept in-app link clicks while a guard is active.
  useEffect(() => {
    if (!active) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      if (anchor.closest("[data-leave-guard-ignore]")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const to = `${url.pathname}${url.search}${url.hash}`;
      if (to === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
      e.preventDefault();
      e.stopPropagation();
      requestLeave(() => navigate(to));
    };
    // Capture phase on document runs before React's root listener.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [active, navigate, requestLeave]);

  const close = () => setPending(null);
  const leave = () => {
    const proceed = pending;
    guardRef.current = null;
    setActive(false);
    setPending(null);
    proceed?.();
  };
  const saveAndLeave = async () => {
    const guard = guardRef.current;
    if (!guard) return leave();
    setSaving(true);
    try {
      const ok = await guard.save();
      if (ok) leave();
      else close();
    } finally {
      setSaving(false);
    }
  };

  return (
    <GuardContext.Provider value={{ setGuard, requestLeave }}>
      {children}
      {pending && (
        <Overlay zIndex="z-[1100]" className="flex items-center justify-center p-4" role="presentation">
          <div role="alertdialog" aria-modal="true" aria-labelledby="leave-guard-title" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl space-y-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" />
              <div>
                <h2 id="leave-guard-title" className="text-sm font-bold text-slate-900">
                  Save your changes first?
                </h2>
                <p className="mt-1 text-xs text-slate-600">
                  "{guardRef.current?.label ?? "This step"}" has changes that are not saved.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                autoFocus
                onClick={saveAndLeave}
                disabled={saving}
                className="rounded-xl bg-brand-primary px-4 py-2 text-xs font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save and leave"}
              </button>
              <button
                type="button"
                onClick={leave}
                disabled={saving}
                className="rounded-xl border border-rose-200 px-4 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
              >
                Leave without saving
              </button>
              <button
                type="button"
                onClick={close}
                disabled={saving}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Stay on this page
              </button>
            </div>
          </div>
        </Overlay>
      )}
    </GuardContext.Provider>
  );
}

/** Registers a guard while `guard` is non-null; clears it on unmount. */
export function useLeaveGuard(guard: LeaveGuard | null) {
  const { setGuard } = useContext(GuardContext);
  useEffect(() => {
    setGuard(guard);
  }, [guard, setGuard]);
  useEffect(() => () => setGuard(null), [setGuard]);
}

/** navigate() that asks first when a page has unsaved changes. */
export function useGuardedNavigate() {
  const navigate = useNavigate();
  const { requestLeave } = useContext(GuardContext);
  return useCallback(
    (to: string, options?: NavigateOptions) => requestLeave(() => navigate(to, options)),
    [navigate, requestLeave]
  );
}

/** Wraps any action that leaves the page (sign-out, switching project). */
export function useGuardedAction() {
  const { requestLeave } = useContext(GuardContext);
  return requestLeave;
}
