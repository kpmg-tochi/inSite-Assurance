import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { resolveSetupRoute, type ProjectSetupDto, type ProjectSetupSectionId } from "@insite/shared";
import { projectSetupKey } from "../../../queries/projects/useProjectSetupQueries";

/**
 * Wiring between the setup shell and the sections on the current wizard step (redesign R6a,
 * D-R6.2). Each section registers whether it has unsaved changes and how to save them; the shell
 * saves the dirty sections in order on "Save", before moving to another step and when leaving the
 * page, and on "Save and continue" also saves every required section that was never saved
 * (`force`, with its current values: D-R6.5).
 */
export interface SectionHandle {
  dirty: boolean;
  /**
   * Saves the section. Resolves true when saved (or nothing to save), false when it could not.
   * `force` saves the current values even when nothing changed (marks the section reviewed).
   */
  save: (opts?: { silent?: boolean; force?: boolean }) => Promise<boolean>;
}

export type SetupMode = "setup" | "settings";

/** Props of a section component and of a wizard step page. */
export interface StepProps {
  projectId: string;
  setup: ProjectSetupDto;
  mode: SetupMode;
  /** Archived projects and users without edit rights see the step read-only. */
  readOnly: boolean;
}

interface SetupContextValue {
  register: (sectionId: ProjectSetupSectionId, handle: SectionHandle | null) => void;
}

export const SetupContext = createContext<SetupContextValue>({ register: () => undefined });

/** Registers a section with the shell. Call once per section with the latest dirty flag and save. */
export function useRegisterSection(sectionId: ProjectSetupSectionId, dirty: boolean, save: SectionHandle["save"]) {
  const { register } = useContext(SetupContext);
  const saveRef = useRef(save);
  saveRef.current = save;
  const stableSave = useCallback<SectionHandle["save"]>((opts) => saveRef.current(opts), []);
  useEffect(() => {
    register(sectionId, { dirty, save: stableSave });
  }, [sectionId, dirty, register, stableSave]);
  useEffect(() => () => register(sectionId, null), [sectionId, register]);
}

/**
 * The newest setup DTO in the cache. Sections on one page save one after another, and a save
 * (e.g. applying a project type) can change what the next section shows before React re-renders:
 * a section saving unchanged values reads them from here, not from its last render.
 */
export function useLatestSetup(projectId: string, fallback: ProjectSetupDto) {
  const queryClient = useQueryClient();
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  return useCallback(
    () => queryClient.getQueryData<ProjectSetupDto>(projectSetupKey(projectId)) ?? fallbackRef.current,
    [projectId, queryClient]
  );
}

/**
 * Form state that follows the server while untouched. When `initial` changes (another section's
 * save, a refetch) and the person has not edited this form, the form takes the new values;
 * edits are kept. `dirty` compares with `initial` by `key`.
 */
export function useSyncedState<T>(initial: T, key: (v: T) => string = JSON.stringify) {
  const [values, setValues] = useState<T>(initial);
  const keyRef = useRef(key);
  keyRef.current = key;
  const initialKey = key(initial);
  const baseKey = useRef(initialKey);
  const initialRef = useRef(initial);
  initialRef.current = initial;
  useEffect(() => {
    if (baseKey.current === initialKey) return;
    const previous = baseKey.current;
    baseKey.current = initialKey;
    setValues((current) => (keyRef.current(current) === previous ? initialRef.current : current));
  }, [initialKey]);
  const dirty = key(values) !== initialKey;
  return [values, setValues, dirty] as const;
}

/** Field errors from a 400 (Zod issues) or 422 (AppError with a code) response. */
export interface FormErrors {
  fields: Record<string, string>;
  general: string | null;
}

export function extractErrors(err: unknown): FormErrors {
  const anyErr = err as {
    message?: string;
    response?: { data?: { error?: { message?: string; issues?: Array<{ path: string; message: string }> } } };
  };
  const body = anyErr?.response?.data?.error;
  const fields: Record<string, string> = {};
  for (const issue of body?.issues ?? []) {
    if (issue.path && !fields[issue.path]) fields[issue.path] = issue.message;
  }
  const general =
    Object.keys(fields).length > 0 ? "Some fields need attention." : body?.message || anyErr?.message || "Could not save.";
  return { fields, general };
}

export const NO_ERRORS: FormErrors = { fields: {}, general: null };

/** Small presentational helpers shared by the sections. */
export function FieldError({ message, id }: { message?: string | null; id?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-[11px] font-medium text-red-600">
      {message}
    </p>
  );
}

/** A card inside a section. */
export function StepSection({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">{title}</h2>
          {description && <p className="text-[11px] text-slate-500 mt-0.5">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export const inputClass = (hasError?: boolean) =>
  `w-full rounded-xl border px-3.5 py-2 text-xs text-slate-900 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500 ${
    hasError ? "border-red-400 focus:border-red-500" : "border-slate-300 focus:border-brand-primary"
  }`;

export const labelClass = "block text-xs font-semibold text-slate-700 mb-1";

/** Parses a number typed by a person ("12,500" → 12500). Returns null for empty or invalid input. */
export function parseNumberInput(value: string): number | null {
  const cleaned = value.replace(/[,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Link to a section: `<base>/<step route>#section-<id>` (base = /app/projects/:id/setup or /settings). */
export function sectionHref(base: string, sectionId: string): string {
  const step = resolveSetupRoute(sectionId)?.step;
  return step ? `${base}/${step.route}#section-${sectionId}` : base;
}
