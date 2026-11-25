import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWatch, type DefaultValues, type Path } from "react-hook-form";
import { z } from "zod";
import { resolveSetupRoute, type ProjectSetupDto, type ProjectSetupSectionId } from "@insite/shared";
import { projectSetupKey } from "../../../queries/projects/useProjectSetupQueries";
import { fieldA11y, useZodForm, type AnyForm, type ZodForm } from "../../../lib/forms";

/**
 * Wiring between the setup shell and the sections on the current wizard step (redesign R6a,
 * D-R6.2). Each section registers whether it has unsaved changes, whether its fields are valid and
 * how to save them; the shell saves the dirty sections in order on "Save", before moving to another
 * step and when leaving the page, and on "Save and continue" also saves every required section that
 * was never saved (`force`, with its current values: D-R6.5). While a section on the step is
 * invalid, the shell's Save and Continue buttons are disabled (owner, 2026-11-24).
 */
export interface SectionHandle {
  dirty: boolean;
  /** The section's fields pass its form schema (the section's request schema). */
  valid: boolean;
  /**
   * Saves the section. Resolves true when saved (or nothing to save), false when it could not.
   * `force` saves the current values even when nothing changed (marks the section reviewed).
   */
  save: (opts?: { silent?: boolean; force?: boolean }) => Promise<boolean>;
  /** Shows every field error of the section (as after a submit attempt). */
  reveal: () => void;
}

/** What a section with a form tells the shell besides dirty and save. */
export interface SectionFormState {
  valid: boolean;
  reveal: () => void;
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

/**
 * Registers a section with the shell. Call once per section with the latest dirty flag and save;
 * a section with a form also passes its validity (`useSectionForm` returns it). Sections without
 * fields of their own (scope, standards) are always valid.
 */
export function useRegisterSection(
  sectionId: ProjectSetupSectionId,
  dirty: boolean,
  save: SectionHandle["save"],
  form?: SectionFormState
) {
  const { register } = useContext(SetupContext);
  const saveRef = useRef(save);
  saveRef.current = save;
  const revealRef = useRef(form?.reveal);
  revealRef.current = form?.reveal;
  const stableSave = useCallback<SectionHandle["save"]>((opts) => saveRef.current(opts), []);
  const stableReveal = useCallback(() => revealRef.current?.(), []);
  const valid = form?.valid ?? true;
  useEffect(() => {
    register(sectionId, { dirty, valid, save: stableSave, reveal: stableReveal });
  }, [sectionId, dirty, valid, register, stableSave, stableReveal]);
  useEffect(() => () => register(sectionId, null), [sectionId, register]);
}

// ---------------------------------------------------------------------------
// Section forms (React Hook Form + Zod; owner, 2026-11-24)
// ---------------------------------------------------------------------------

export interface SectionForm<S extends z.ZodTypeAny, V extends z.input<S> = z.input<S>> extends SectionFormState {
  form: ZodForm<S>;
  /** The current field values (re-rendered on every change). */
  values: V;
  /** The values differ from `initial` (compared by `key`). */
  dirty: boolean;
  /**
   * Validates and returns the request body (the schema's output), or null with every error shown.
   * `fresh`: validate these values instead of the fields (a clean section saved with the newest
   * server values, see `useLatestSetup`); the fields take them.
   */
  submit: (fresh?: V) => Promise<z.output<S> | null>;
  /** Back to these values, clean and untouched (after a save). */
  reset: (values: V) => void;
  /** Puts a failed save's field errors on the fields; returns the section-level message. */
  showServerErrors: (err: unknown, mapPath?: (path: string) => string | null) => string | null;
}

/**
 * A setup section's form: React Hook Form validated by `schema` (built from the section's shared
 * request schema; inputs that hold text `.transform` to the request shape) as the person types.
 * The form follows the server while untouched: when `initial` changes
 * (another section's save, a refetch) and the fields still hold the previous initial values, the
 * form takes the new ones; edits are kept. `key` compares values (leave out display-only fields).
 */
export function useSectionForm<S extends z.ZodTypeAny, V extends z.input<S> = z.input<S>>(
  schema: S,
  initial: V,
  key: (v: V) => string = JSON.stringify
): SectionForm<S, V> {
  const form = useZodForm(schema, { defaultValues: initial as DefaultValues<z.input<S>> });
  // The generic form, for calls whose types do not resolve against an abstract schema.
  const anyForm = form as unknown as AnyForm;
  const values = useWatch({ control: form.control }) as V;
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
    if (keyRef.current(anyForm.getValues() as V) === previous) anyForm.reset(initialRef.current);
  }, [initialKey, anyForm]);
  // Rules can depend on context (a live project, the tenant's project types): re-check the fields
  // when the schema changes, so shown errors and `isValid` follow.
  useEffect(() => {
    void anyForm.trigger();
  }, [schema, anyForm]);

  const dirty = key(values) !== initialKey;
  const valid = useMemo(() => schema.safeParse(values).success, [schema, values]);
  const reveal = useCallback(() => {
    void anyForm.handleSubmit(() => undefined)();
  }, [anyForm]);
  const submit = useCallback(
    async (fresh?: V) => {
      if (fresh !== undefined) anyForm.reset(fresh);
      const box: { out?: z.output<S> } = {};
      await anyForm.handleSubmit((data: z.output<S>) => {
        box.out = data;
      })();
      return box.out ?? null;
    },
    [anyForm]
  );
  const reset = useCallback((next: V) => anyForm.reset(next), [anyForm]);
  const showServerErrors = useCallback(
    (err: unknown, mapPath?: (path: string) => string | null) => applyServerErrors(anyForm, err, mapPath),
    [anyForm]
  );
  return { form, values, dirty, valid, reveal, submit, reset, showServerErrors };
}

/**
 * A failed request's field errors (400 Zod issues) on the form's fields, by path (`mapPath` renames
 * a server path to a field name, or drops it with null). Returns the message for the form.
 */
export function applyServerErrors(form: AnyForm, err: unknown, mapPath?: (path: string) => string | null): string | null {
  const { fields, general } = extractErrors(err);
  for (const [path, message] of Object.entries(fields)) {
    const name = mapPath ? mapPath(path) : path;
    if (name) form.setError(name as Path<Record<string, unknown>>, { type: "server", message });
  }
  return general;
}

/**
 * Sets a field from an input and re-checks the whole form, so cross-field rules (date order) clear
 * as soon as the other field is fixed. `touch` shows the field's error at once (selects, dates,
 * checkboxes); text inputs show it on blur.
 */
export function setField(form: AnyForm, name: string, value: unknown, touch = false) {
  form.setValue(name, value, { shouldDirty: true, shouldTouch: touch });
  void form.trigger();
}

/** Marks a field touched, so its error shows. */
export function touchField(form: AnyForm, name: string) {
  form.setValue(name, form.getValues(name), { shouldTouch: true });
}

/**
 * value / onChange / onBlur / aria props for a text input, textarea or select bound to a form
 * field. `map` rewrites what was typed (e.g. upper case).
 */
export function textProps(form: AnyForm, name: string, map?: (v: string) => string) {
  const value = form.getValues(name);
  return {
    name,
    value: typeof value === "string" ? value : value == null ? "" : String(value),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setField(form, name, map ? map(e.target.value) : e.target.value),
    onBlur: () => touchField(form, name),
    ...fieldA11y(form, name),
  };
}

/** Text typed as a number: "" → null, "12,500" → 12500; anything else is an error. Pipe into the request field. */
export const numberOrNull = (label: string) =>
  z.string().transform((v, ctx) => {
    const cleaned = v.replace(/[,\s]/g, "");
    if (cleaned === "") return null;
    const n = Number(cleaned);
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be a number` });
      return z.NEVER;
    }
    return n;
  });

/** Trimmed text; "" → null. Pipe into the request field. */
export const textOrNull = () => z.string().transform((v) => v.trim() || null);

/** A select's value; "" (nothing chosen) → null. Pipe into the request field. */
export const choiceOrNull = () => z.string().transform((v) => v || null);

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
