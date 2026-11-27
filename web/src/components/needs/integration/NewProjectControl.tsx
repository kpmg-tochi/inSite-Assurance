import React, { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, FilePlus2, FileUp, Plus } from "lucide-react";
import { useAuth } from "../../../lib/auth-context";
import { useGuardedNavigate } from "../../../lib/navigationGuard";
import { useNeedsCyclesQuery, useNeedsOptionsQuery } from "../../../queries/needs/useNeedsQueries";
import { OutOfCycleRequestDialog } from "../outOfCycle/OutOfCycleRequestDialog";
import { outOfCyclePath } from "../outOfCycle/OutOfCycleList";

/**
 * Needs pipeline wave 4 (C4): "New project" in the header (and on the register). In a workspace whose
 * programmes run the needs pipeline (`GET /needs/options` lists them), a project starts as a proposed
 * project, so the button opens a menu: "New proposed project" (the upload on the open cycle of the
 * user's organisation, `needs:submit`) and "Out-of-cycle project" (a request with its own approval,
 * `needs:submit`). Elsewhere it stays the plain link to `/app/projects/new` for `projects:create`.
 */

const buttonClass =
  "inline-flex h-[34px] items-center gap-1.5 rounded-xl bg-white px-2 sm:px-3 text-xs font-semibold text-brand-navy shadow-sm transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-navy";
const itemClass =
  "flex w-full items-start gap-2 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-white";

export function NewProjectControl() {
  const { hasPermission, user } = useAuth();
  const navigate = useGuardedNavigate();
  const canViewNeeds = hasPermission("needs:view");
  const canSubmitNeeds = hasPermission("needs:submit");
  const optionsQuery = useNeedsOptionsQuery(canViewNeeds);
  const pipeline = canViewNeeds && (optionsQuery.data?.programmes.length ?? 0) > 0;
  const cyclesQuery = useNeedsCyclesQuery(pipeline && canSubmitNeeds);
  const [open, setOpen] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) wrapRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
  }, [open]);

  // Still finding out whether the workspace runs the pipeline: show nothing rather than the wrong button.
  if (canViewNeeds && optionsQuery.isLoading) return null;

  if (!pipeline) {
    if (!hasPermission("projects:create")) return null;
    return (
      <button type="button" onClick={() => navigate("/app/projects/new")} aria-label="New project" title="New project" className={buttonClass}>
        <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline">New project</span>
      </button>
    );
  }
  if (!canSubmitNeeds) return null;

  // The open cycle the user's organisation runs (uploads are only taken there).
  const uploadCycle = (cyclesQuery.data ?? []).find((c) => c.status === "OPEN" && c.owningOrganizationId === user?.organizationId) ?? null;

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = Array.from(wrapRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="New project"
        title="New project"
        onClick={() => setOpen((o) => !o)}
        className={buttonClass}
      >
        <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline">New project</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="New project"
          onKeyDown={onMenuKey}
          className="absolute right-0 z-40 mt-1 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            disabled={!uploadCycle}
            onClick={() => {
              if (!uploadCycle) return;
              setOpen(false);
              navigate(`/app/needs-assessment?cycle=${uploadCycle.id}&tab=proposals&upload=1`);
            }}
          >
            <FileUp className="mt-0.5 h-4 w-4 shrink-0 text-brand-primary" aria-hidden="true" />
            <span>
              <span className="block font-semibold text-slate-900">New proposed project</span>
              <span className="block text-[11px] text-slate-500">
                {uploadCycle
                  ? `Upload a needs assessment into the ${uploadCycle.interventionYear} ${uploadCycle.projectTypeName} cycle`
                  : cyclesQuery.isLoading
                    ? "Looking for the open cycle…"
                    : "No open cycle of your organisation takes uploads now"}
              </span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              setOpen(false);
              setRequesting(true);
            }}
          >
            <FilePlus2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-primary" aria-hidden="true" />
            <span>
              <span className="block font-semibold text-slate-900">Out-of-cycle project</span>
              <span className="block text-[11px] text-slate-500">A project that cannot wait for the annual cycle, with its own approval</span>
            </span>
          </button>
        </div>
      )}
      {requesting && optionsQuery.data && (
        <OutOfCycleRequestDialog
          options={optionsQuery.data}
          onClose={() => setRequesting(false)}
          onCreated={(r) => {
            setRequesting(false);
            navigate(outOfCyclePath(r.proposalId));
          }}
        />
      )}
    </div>
  );
}
