import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, Archive, ArrowLeft, ArrowRight, CheckCircle2, Circle, Loader2 } from "lucide-react";
import { useLeaveGuard, type LeaveGuard } from "../../../lib/navigationGuard";
import { ArchiveProjectDialog } from "../../../components/projects/ArchiveProjectDialog";
import { useAuth } from "../../../lib/auth-context";
import { useProjectSetupQuery } from "../../../queries/projects/useProjectSetupQueries";
import { SetupContext, type SetupMode, type StepHandle } from "./setupContext";
import { findStep, visibleSteps } from "./stepRegistry";

/**
 * Wizard frame for /app/projects/:projectId/setup/:stepId (drafts) and
 * /app/projects/:projectId/settings/:stepId (the same steps as settings after activation).
 * Each step saves on "Save and continue" and before moving to another step; leaving the page
 * with unsaved changes asks first.
 */
export function ProjectSetupShell({ mode }: { mode: SetupMode }) {
  const { projectId = "", stepId } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const setupQuery = useProjectSetupQuery(projectId);
  const setup = setupQuery.data;
  const steps = visibleSteps();
  const step = findStep(stepId);

  const handleRef = useRef<StepHandle | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const register = useCallback((handle: StepHandle | null) => {
    handleRef.current = handle;
    setDirty(Boolean(handle?.dirty));
  }, []);

  // Leaving through the sidebar, a link or a header button asks to save first.
  const leaveGuard = useMemo<LeaveGuard | null>(
    () =>
      dirty
        ? {
            label: step?.title ?? "This step",
            save: async () => {
              const h = handleRef.current;
              if (!h || !h.dirty) return true;
              const ok = await h.save({ silent: true });
              if (ok) setLastSavedAt(new Date());
              return ok;
            },
          }
        : null,
    [dirty, step?.title]
  );
  useLeaveGuard(leaveGuard);
  const [archiveOpen, setArchiveOpen] = useState(false);

  // Warn on reload / tab close while the step has unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  if (setupQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading project setup…
      </div>
    );
  }
  if (setupQuery.isError || !setup) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-sm text-slate-600">
        This project could not be opened. It may have been deleted, or you may not have access.{" "}
        <Link to="/app/projects" className="font-semibold text-brand-primary hover:underline">
          Back to projects
        </Link>
      </div>
    );
  }
  // A live project's steps are settings; a draft's settings URL goes to setup and vice versa.
  if (mode === "setup" && setup.status !== "DRAFT") {
    return <Navigate to={`/app/projects/${projectId}/settings/${stepId ?? "basics"}`} replace />;
  }
  if (mode === "settings" && setup.status === "DRAFT") {
    return <Navigate to={`/app/projects/${projectId}/setup/${stepId ?? "basics"}`} replace />;
  }
  if (!step) {
    return <Navigate to={`/app/projects/${projectId}/${mode}/${steps[0].route}`} replace />;
  }

  const base = `/app/projects/${projectId}/${mode}`;
  const index = steps.findIndex((s) => s.id === step.id);
  const next = steps[index + 1];
  const prev = steps[index - 1];
  const canEdit =
    setup.status === "ARCHIVED"
      ? false
      : setup.status === "ACTIVE"
        ? hasPermission("projects:edit_baseline")
        : hasPermission("projects:create") || hasPermission("projects:edit_baseline");
  const readOnly = !canEdit;
  const statusOf = (id: string) => setup.steps.find((s) => s.stepId === id);

  const saveCurrent = async (silent: boolean) => {
    const h = handleRef.current;
    if (!h || !h.dirty || readOnly) return true;
    setSaving(true);
    try {
      const ok = await h.save({ silent });
      if (ok) setLastSavedAt(new Date());
      return ok;
    } finally {
      setSaving(false);
    }
  };

  /** Saves first; stays on the step if the save failed so the person sees the errors. */
  const go = async (route: string) => {
    if (await saveCurrent(true)) navigate(`${base}/${route}`);
  };

  const StepComponent = step.component;

  return (
    <SetupContext.Provider value={{ register }}>
      <div className="space-y-5 pb-10">
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <Link to={setup.status === "DRAFT" ? "/app/projects?tab=drafts" : `/app/projects/${projectId}/dashboard`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-primary hover:underline">
              <ArrowLeft className="w-3.5 h-3.5" /> {setup.status === "DRAFT" ? "Drafts" : "Project dashboard"}
            </Link>
            <h1 className="mt-1 text-lg font-bold text-slate-900">
              {setup.basics.name} <span className="font-mono text-sm text-slate-500">{setup.basics.codePrefix}</span>
            </h1>
            <p className="text-xs text-slate-500">
              {setup.status === "DRAFT"
                ? "Draft: not live anywhere until you set it active on the Review step."
                : setup.status === "ARCHIVED"
                  ? "Archived: read-only."
                  : "Project settings. Changes are recorded in the audit ledger."}
            </p>
          </div>
          <div className="flex items-center gap-3">
          <div className="text-xs text-slate-500" aria-live="polite">
            {saving ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…
              </span>
            ) : dirty ? (
              <span className="text-amber-700">Unsaved changes</span>
            ) : lastSavedAt ? (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <CheckCircle2 className="w-3.5 h-3.5" /> Saved
              </span>
            ) : null}
          </div>
          {setup.status === "ACTIVE" && hasPermission("projects:edit_baseline") && (
            <button
              type="button"
              onClick={() => setArchiveOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
            >
              <Archive className="w-3.5 h-3.5" /> Archive project
            </button>
          )}
          </div>
        </div>
        {archiveOpen && (
          <ArchiveProjectDialog
            projectId={projectId}
            projectName={setup.basics.name}
            codePrefix={setup.basics.codePrefix}
            onClose={() => setArchiveOpen(false)}
          />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-5">
          <nav aria-label="Setup steps" className="bg-white rounded-2xl border border-slate-200/80 p-3 shadow-sm h-fit lg:sticky lg:top-4">
            <ol className="space-y-1">
              {steps.map((s, i) => {
                const st = statusOf(s.id);
                const current = s.id === step.id;
                const complete = s.id === "review" ? setup.status !== "DRAFT" : st?.complete ?? false;
                const flagged = s.required && st && !st.complete && st.saved;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => go(s.route)}
                      aria-current={current ? "step" : undefined}
                      className={`w-full flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary ${
                        current ? "bg-brand-primary/10 font-bold text-brand-primary" : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {complete ? (
                        <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" aria-label="Complete" />
                      ) : flagged ? (
                        <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" aria-label="Needs attention" />
                      ) : (
                        <Circle className="w-4 h-4 shrink-0 text-slate-300" aria-label="Not done" />
                      )}
                      <span className="flex-1">
                        {i + 1}. {s.title}
                      </span>
                      {!s.required && s.id !== "review" && <span className="text-[10px] font-normal text-slate-400">optional</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <div className="space-y-5 min-w-0">
            {/* key: a fresh form per step and per project */}
            <StepComponent key={`${projectId}-${step.id}`} projectId={projectId} setup={setup} mode={mode} readOnly={readOnly} />

            {step.id !== "review" && (
              <div className="flex items-center justify-between gap-3">
                <div>
                  {prev && (
                    <button
                      type="button"
                      onClick={() => go(prev.route)}
                      className="inline-flex items-center gap-1 rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" /> Back
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => saveCurrent(false)}
                      disabled={!dirty || saving}
                      className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Save
                    </button>
                  )}
                  {next && (
                    <button
                      type="button"
                      onClick={() => go(next.route)}
                      disabled={saving}
                      className="inline-flex items-center gap-1 rounded-xl bg-brand-primary px-4 py-2 text-xs font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
                    >
                      {readOnly || !dirty ? "Continue" : "Save and continue"} <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </SetupContext.Provider>
  );
}
