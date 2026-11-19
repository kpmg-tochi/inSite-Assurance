import React, { createContext, useCallback, useContext, useEffect, useRef } from "react";
import type { ProjectSetupDto } from "@insite/shared";

/**
 * Wiring between the setup shell and the active step. A step registers whether it has unsaved
 * changes and how to save them; the shell calls `save` on "Save and continue" and before
 * navigating to another step, and warns on unload while the step is dirty.
 */
export interface StepHandle {
  dirty: boolean;
  /** Saves the step. Resolves true when saved (or nothing to save), false when it could not. */
  save: (opts?: { silent?: boolean }) => Promise<boolean>;
}

export type SetupMode = "setup" | "settings";

export interface StepProps {
  projectId: string;
  setup: ProjectSetupDto;
  mode: SetupMode;
  /** Archived projects and users without edit rights see the step read-only. */
  readOnly: boolean;
}

interface SetupContextValue {
  register: (handle: StepHandle | null) => void;
}

export const SetupContext = createContext<SetupContextValue>({ register: () => undefined });

/** Registers the step with the shell. Call once per step with the latest dirty flag and save. */
export function useRegisterStep(dirty: boolean, save: StepHandle["save"]) {
  const { register } = useContext(SetupContext);
  const saveRef = useRef(save);
  saveRef.current = save;
  const stableSave = useCallback<StepHandle["save"]>((opts) => saveRef.current(opts), []);
  useEffect(() => {
    register({ dirty, save: stableSave });
  }, [dirty, register, stableSave]);
  useEffect(() => () => register(null), [register]);
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

/** Small presentational helpers shared by the steps. */
export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p className="mt-1 text-[11px] font-medium text-red-600">{message}</p>;
}

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
