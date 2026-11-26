import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, Archive, ArrowLeft, ArrowRight, CheckCircle2, Circle, Loader2 } from "lucide-react";
import { formatProjectCode, type ProjectSetupSectionId } from "@insite/shared";
import { useLeaveGuard, type LeaveGuard } from "../../../lib/navigationGuard";
import { ArchiveProjectDialog } from "../../../components/projects/ArchiveProjectDialog";
import { useAuth } from "../../../lib/auth-context";
import { useProjectSetupQuery } from "../../../queries/projects/useProjectSetupQueries";
import { SetupContext, type SectionHandle, type SetupMode } from "./setupContext";
import { findStep, visibleSteps, type RegisteredStep } from "./stepRegistry";

const DEFAULT_STEP = "project";

/** Lets React apply a save's cache update (the next section re-syncs) before the next save runs. */
const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function scrollToSection(sectionId: string, focus = true) {
  const el = document.getElementById(`section-${sectionId}`);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  if (focus) el.focus({ preventScroll: true });
  return true;
}

/**
 * Wizard frame for /app/projects/:projectId/setup/:stepId (drafts) and
 * /app/projects/:projectId/settings/:stepId (the same steps as settings after activation).
 *
 * Redesign R6a (D-R6.2, D-R6.5): five wizard steps (Project, Contract, Scope & sprints, Team &
 * visits, Review) plus "Advanced" under a divider. A step shows several sections; "Save" saves the
 * dirty ones in order, "Save and continue" also saves every required section of the step that was
 * never saved (marking it reviewed), stopping at the first failure and scrolling to it. Moving to
 * another step or leaving the page saves the dirty sections first. Old step URLs (a section id)
 * redirect to the step that holds the section, with `#section-<id>` (D-R6.10).
 */
export function ProjectSetupShell({ mode }: { mode: SetupMode }) {
  const { projectId = "", stepId } = useParams();
  // Moves between steps happen after the shell has saved; the leave guard would ask again.
  const navigate = useNavigate();
  const location = useLocation();
  const { hasPermission } = useAuth();
  const setupQuery = useProjectSetupQuery(projectId);
  const setup = setupQuery.data;
  const steps = visibleSteps();
  const found = findStep(stepId);
  const step = found && !found.legacy ? found.step : undefined;

  const handlesRef = useRef(new Map<string, SectionHandle>());
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [invalidIds, setInvalidIds] = useState<ReadonlySet<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const register = useCallback((sectionId: ProjectSetupSectionId, handle: SectionHandle | null) => {
    if (handle) handlesRef.current.set(sectionId, handle);
    else handlesRef.current.delete(sectionId);
    const toggle = (want: boolean) => (prev: ReadonlySet<string>) => {
      if (prev.has(sectionId) === want) return prev;
      const next = new Set(prev);
      if (want) next.add(sectionId);
      else next.delete(sectionId);
      return next;
    };
    setDirtyIds(toggle(Boolean(handle?.dirty)));
    setInvalidIds(toggle(Boolean(handle && !handle.valid)));
  }, []);
  const dirty = dirtyIds.size > 0;

  const canEdit =
    !setup || setup.status === "ARCHIVED"
      ? false
      : setup.status === "ACTIVE"
        ? hasPermission("projects:edit_baseline")
        : hasPermission("projects:create") || hasPermission("projects:edit_baseline");
  const readOnly = !canEdit;

  /** Section ids shown on the current step (the server leaves out sections that do not apply). */
  const sectionIds = useMemo(
    () => (step && setup ? step.sectionIds.filter((id) => setup.steps.some((s) => s.stepId === id)) : []),
    [setup, step]
  );
  const unsavedRequired = useMemo(
    () =>
      setup && setup.status === "DRAFT"
        ? sectionIds.filter((id) => {
            const st = setup.steps.find((s) => s.stepId === id);
            return Boolean(st && st.required && !st.saved);
          })
        : [],
    [sectionIds, setup]
  );

  /** Sections on the step whose fields are invalid (owner, 2026-11-24: Save and Continue wait for them). */
  const invalidOnStep = useMemo(() => (readOnly ? [] : sectionIds.filter((id) => invalidIds.has(id))), [invalidIds, readOnly, sectionIds]);
  const blocked = invalidOnStep.length > 0;

  /** Shows a section's field errors and moves to it. */
  const showSection = useCallback((sectionId: string) => {
    handlesRef.current.get(sectionId)?.reveal();
    scrollToSection(sectionId);
  }, []);

  /**
   * Saves the step's dirty sections in order (and, with `includeUnsaved`, its never-saved required
   * sections with their current values). One success toast at most: every save but the last is silent.
   */
  const saveSections = useCallback(
    async ({ silent, includeUnsaved }: { silent: boolean; includeUnsaved: boolean }) => {
      if (readOnly) return true;
      const queue = sectionIds.filter((id) => {
        const h = handlesRef.current.get(id);
        if (!h) return false;
        return h.dirty || (includeUnsaved && unsavedRequired.includes(id as ProjectSetupSectionId));
      });
      if (queue.length === 0) return true;
      // Nothing is saved while a section to save has invalid fields: show them instead.
      const invalid = queue.find((id) => !handlesRef.current.get(id)?.valid);
      if (invalid) {
        showSection(invalid);
        return false;
      }
      setSaving(true);
      try {
        for (let i = 0; i < queue.length; i++) {
          const h = handlesRef.current.get(queue[i]);
          if (!h) continue;
          const ok = await h.save({ silent: silent || i < queue.length - 1, force: !h.dirty });
          if (!ok) {
            scrollToSection(queue[i]);
            return false;
          }
          await nextTick();
        }
        setLastSavedAt(new Date());
        return true;
      } finally {
        setSaving(false);
      }
    },
    [readOnly, sectionIds, unsavedRequired, showSection]
  );

  // Leaving through the sidebar, a link or a header button asks to save first.
  const leaveGuard = useMemo<LeaveGuard | null>(
    () => (dirty ? { label: step?.title ?? "This step", save: () => saveSections({ silent: true, includeUnsaved: false }) } : null),
    [dirty, step?.title, saveSections]
  );
  useLeaveGuard(leaveGuard);
  const [archiveOpen, setArchiveOpen] = useState(false);

  // Warn on reload / tab close while a section has unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // `#section-<id>`: scroll to the section once the step has rendered (old URLs, Review "Fix").
  const hash = location.hash;
  const loaded = Boolean(setup);
  useEffect(() => {
    if (!loaded || !hash.startsWith("#section-")) return;
    const id = hash.slice("#section-".length);
    let tries = 0;
    const timer = window.setInterval(() => {
      if (scrollToSection(id) || ++tries > 20) window.clearInterval(timer);
    }, 50);
    return () => window.clearInterval(timer);
  }, [hash, loaded, step?.id]);

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
    return <Navigate to={{ pathname: `/app/projects/${projectId}/settings/${stepId ?? DEFAULT_STEP}`, search: location.search, hash }} replace />;
  }
  if (mode === "settings" && setup.status === "DRAFT") {
    return <Navigate to={{ pathname: `/app/projects/${projectId}/setup/${stepId ?? DEFAULT_STEP}`, search: location.search, hash }} replace />;
  }
  const base = `/app/projects/${projectId}/${mode}`;
  // D-R6.10: an old step URL (a section id) opens the step that holds it, scrolled to the section.
  if (found?.legacy) {
    return (
      <Navigate
        to={{ pathname: `${base}/${found.step.route}`, search: location.search, hash: found.sectionId ? `#section-${found.sectionId}` : hash }}
        replace
      />
    );
  }
  if (!step) {
    return <Navigate to={`${base}/${DEFAULT_STEP}`} replace />;
  }

  const shown = steps.filter((s) => s.id === "review" || setup.wizardSteps.some((w) => w.id === s.id));
  const numbered = shown.filter((s) => !s.settingsOnly);
  const extra = shown.filter((s) => s.settingsOnly);
  const index = numbered.findIndex((s) => s.id === step.id);
  const next = index >= 0 ? numbered[index + 1] : undefined;
  const prev = index > 0 ? numbered[index - 1] : step.settingsOnly ? numbered.find((s) => s.id === "review") : undefined;
  const statusOf = (id: string) => setup.wizardSteps.find((w) => w.id === id);

  /** Saves first; stays on the step if a save failed so the person sees the errors. */
  const go = async (route: string, includeUnsaved: boolean) => {
    if (await saveSections({ silent: true, includeUnsaved })) navigate(`${base}/${route}`);
  };
  const continueLabel = !readOnly && (dirty || unsavedRequired.length > 0) ? "Save and continue" : "Continue";
  const sectionTitle = (id: string) => setup.steps.find((s) => s.stepId === id)?.title ?? id;

  const StepComponent = step.component;

  const stepButton = (s: RegisteredStep) => {
    const st = statusOf(s.id);
    const current = s.id === step.id;
    const complete = s.id === "review" ? setup.status !== "DRAFT" : st?.complete ?? false;
    const flagged = Boolean(st && st.required && !st.complete && st.saved);
    const required = st?.required ?? false;
    const stateLabel = complete ? "complete" : flagged ? "needs attention" : required ? "not done" : "optional";
    return (
      <li key={s.id}>
        <button
          type="button"
          onClick={() => go(s.route, false)}
          aria-current={current ? "step" : undefined}
          className={`w-full flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary ${
            current ? "bg-brand-primary/10 font-bold text-brand-primary" : "text-slate-700 hover:bg-slate-50"
          }`}
        >
          {complete ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" aria-hidden="true" />
          ) : flagged ? (
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" aria-hidden="true" />
          ) : (
            <Circle className="w-4 h-4 shrink-0 text-slate-300" aria-hidden="true" />
          )}
          <span className="flex-1">
            {s.settingsOnly ? s.title : `${s.order}. ${s.title}`}
            <span className="sr-only"> ({stateLabel})</span>
          </span>
          {!required && s.id !== "review" && (
            <span className="text-[10px] font-normal text-slate-600" aria-hidden="true">
              optional
            </span>
          )}
        </button>
      </li>
    );
  };

  return (
    <SetupContext.Provider value={{ register }}>
      <div className="space-y-5 pb-10">
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <Link to={setup.status === "DRAFT" ? "/app/projects?tab=drafts" : `/app/projects/${projectId}/dashboard`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-primary hover:underline">
              <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> {setup.status === "DRAFT" ? "Drafts" : "Overview"}
            </Link>
            <h2 className="mt-1 text-lg font-bold text-slate-900">
              {setup.basics.name} <span className="font-mono text-sm text-slate-500">{formatProjectCode(setup.basics.codePrefix)}</span>
            </h2>
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
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Saving…
                </span>
              ) : dirty ? (
                <span className="text-amber-700">Unsaved changes</span>
              ) : lastSavedAt ? (
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Saved
                </span>
              ) : null}
            </div>
            {setup.status === "ACTIVE" && hasPermission("projects:edit_baseline") && (
              <button
                type="button"
                onClick={() => setArchiveOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
              >
                <Archive className="w-3.5 h-3.5" aria-hidden="true" /> Archive project
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
            <ol className="space-y-1">{numbered.map(stepButton)}</ol>
            {extra.length > 0 && (
              <>
                <hr className="my-2 border-slate-100" />
                <ul className="space-y-1">{extra.map(stepButton)}</ul>
              </>
            )}
          </nav>

          <div className="space-y-5 min-w-0">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                {step.settingsOnly ? step.title : `Step ${step.order} of ${numbered.length}: ${step.title}`}
              </h2>
              <p className="text-[11px] text-slate-500">
                {step.settingsOnly ? `${step.description}. Optional: filled from the project type's workflow template.` : step.description}
              </p>
            </div>

            {/* key: a fresh form per step and per project */}
            <StepComponent key={`${projectId}-${step.id}`} step={step} projectId={projectId} setup={setup} mode={mode} readOnly={readOnly} />

            {step.id !== "review" && (
              <div className="flex items-center justify-between gap-3">
                <div>
                  {prev && (
                    <button
                      type="button"
                      onClick={() => go(prev.route, false)}
                      className="inline-flex items-center gap-1 rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Back
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => saveSections({ silent: false, includeUnsaved: false })}
                      disabled={!dirty || saving || blocked}
                      aria-describedby={blocked ? "setup-invalid-hint" : undefined}
                      className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Save
                    </button>
                  )}
                  {next && (
                    <button
                      type="button"
                      onClick={() => go(next.route, true)}
                      disabled={saving || blocked}
                      aria-describedby={blocked ? "setup-invalid-hint" : undefined}
                      className="inline-flex items-center gap-1 rounded-xl bg-brand-primary px-4 py-2 text-xs font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
                    >
                      {continueLabel} <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            )}
            {step.id !== "review" && blocked && (
              <p id="setup-invalid-hint" role="status" className="text-right text-[11px] text-slate-600">
                Fix the highlighted fields in{" "}
                {invalidOnStep.map((id, i) => (
                  <React.Fragment key={id}>
                    {i > 0 && (i === invalidOnStep.length - 1 ? " and " : ", ")}
                    <button
                      type="button"
                      onClick={() => showSection(id)}
                      className="font-semibold text-rose-700 underline hover:text-rose-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary rounded"
                    >
                      {sectionTitle(id)}
                    </button>
                  </React.Fragment>
                ))}
                .
              </p>
            )}
          </div>
        </div>
      </div>
    </SetupContext.Provider>
  );
}
