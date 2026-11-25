import React from "react";
import { useForm, type FieldError as RhfFieldError, type UseFormProps, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

/**
 * One way to build every form in the portal (owner, 2026-11-24): React Hook Form with a Zod schema,
 * validated as the user types, and a submit button that cannot be pressed while the form is invalid
 * or saving.
 *
 *   const form = useZodForm(MySchema, { defaultValues: { name: "" } });
 *   <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate>
 *     <input {...form.register("name")} {...fieldA11y(form, "name")} />
 *     <FieldError form={form} name="name" />
 *     <SubmitButton form={form} pending={mutation.isPending}>Save</SubmitButton>
 *   </form>
 *
 * Prefer the request schemas from `@insite/shared` (every request body has one). When the inputs
 * hold text that the request needs as numbers or dates, write a form schema with the helpers below
 * and `.transform` to the request shape, or `.pick` / `.extend` the shared schema.
 */

export type ZodForm<S extends z.ZodTypeAny> = UseFormReturn<z.input<S>, unknown, z.output<S>>;

/** Any form, for the helpers below (they read form state only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyForm = UseFormReturn<any, any, any>;

export function useZodForm<S extends z.ZodTypeAny>(
  schema: S,
  options: Omit<UseFormProps<z.input<S>, unknown>, "resolver"> = {}
): ZodForm<S> {
  return useForm<z.input<S>, unknown, z.output<S>>({
    mode: "onChange",
    reValidateMode: "onChange",
    ...options,
    resolver: zodResolver(schema),
  });
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

const errorIdFor = (name: string) => `field-error-${name.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

/** Nested errors by dotted path ("items.0.amount"). */
function errorAt(form: AnyForm, name: string): RhfFieldError | undefined {
  let node: unknown = form.formState.errors;
  for (const part of name.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node && typeof node === "object" && "message" in (node as object) ? (node as RhfFieldError) : undefined;
}

/** A field's error once the user has touched it (or tried to submit). */
export function visibleError(form: AnyForm, name: string): string | undefined {
  const err = errorAt(form, name);
  if (!err) return undefined;
  let touched: unknown = form.formState.touchedFields;
  for (const part of name.split(".")) touched = touched && typeof touched === "object" ? (touched as Record<string, unknown>)[part] : undefined;
  const dirtyOrTouched = Boolean(touched) || form.formState.isSubmitted;
  return dirtyOrTouched ? (err.message as string | undefined) ?? "Check this field" : undefined;
}

/** aria-invalid / aria-describedby for an input, so its error is announced. */
export function fieldA11y(form: AnyForm, name: string) {
  const msg = visibleError(form, name);
  return { "aria-invalid": msg ? true : undefined, "aria-describedby": msg ? errorIdFor(name) : undefined } as const;
}

/** Red border classes for an invalid input; append to the input's own classes. */
export function invalidClass(form: AnyForm, name: string): string {
  return visibleError(form, name) ? "border-rose-400 focus:border-rose-500 focus:ring-rose-200" : "";
}

/** The field's message under the input, once touched. Renders nothing when valid. */
export function FieldError({ form, name, className = "" }: { form: AnyForm; name: string; className?: string }) {
  const msg = visibleError(form, name);
  if (!msg) return null;
  return (
    <p id={errorIdFor(name)} className={`mt-1 text-xs font-medium text-rose-700 ${className}`}>
      {msg}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

/** True when the form may be submitted: valid, not submitting, nothing pending, no extra block. */
export function canSubmit(form: AnyForm, opts: { pending?: boolean; blocked?: boolean } = {}): boolean {
  return form.formState.isValid && !form.formState.isSubmitting && !opts.pending && !opts.blocked;
}

/**
 * The form's submit button. Disabled while the form is invalid, submitting or `pending` (the
 * mutation), or `blocked` (a condition outside the form, e.g. no file chosen). When it is disabled
 * because of the form, `hint` explains why next to it (default: "Complete the required fields.").
 */
export function SubmitButton({
  form,
  pending = false,
  blocked = false,
  pendingLabel,
  hint = "Complete the required fields to continue.",
  showHint = true,
  className,
  children,
  type = "submit",
  onClick,
}: {
  form: AnyForm;
  pending?: boolean;
  blocked?: boolean;
  pendingLabel?: React.ReactNode;
  hint?: string;
  showHint?: boolean;
  className?: string;
  children: React.ReactNode;
  type?: "submit" | "button";
  onClick?: () => void;
}) {
  const enabled = canSubmit(form, { pending, blocked });
  const invalid = !form.formState.isValid && !pending;
  const hintId = React.useId();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type={type}
        onClick={onClick}
        disabled={!enabled}
        aria-describedby={invalid && showHint ? hintId : undefined}
        className={
          className ??
          "inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-brand-primary"
        }
      >
        {pending || form.formState.isSubmitting ? pendingLabel ?? children : children}
      </button>
      {invalid && showHint && (
        <span id={hintId} className="text-[11px] text-slate-500">
          {hint}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Schema helpers for inputs that hold text
// ---------------------------------------------------------------------------

/** Required text, trimmed. */
export const zText = (label: string, max = 500) =>
  z.string().trim().min(1, `Enter the ${label.toLowerCase()}`).max(max, `${label} is too long (at most ${max} characters)`);

/** Optional text, trimmed; empty becomes undefined. */
export const zOptionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max, `Too long (at most ${max} characters)`)
    .optional()
    .transform((v) => (v ? v : undefined));

/** A number typed into a text input. Output is a number. */
export const zNumberText = (label: string, opts: { min?: number; max?: number; int?: boolean } = {}) =>
  z
    .string()
    .trim()
    .min(1, `Enter the ${label.toLowerCase()}`)
    .refine((v) => /^-?\d+(\.\d+)?$/.test(v.replace(/,/g, "")), `${label} must be a number`)
    .transform((v) => Number(v.replace(/,/g, "")))
    .refine((n) => !opts.int || Number.isInteger(n), `${label} must be a whole number`)
    .refine((n) => opts.min === undefined || n >= opts.min, `${label} must be at least ${opts.min}`)
    .refine((n) => opts.max === undefined || n <= opts.max, `${label} must be at most ${opts.max}`);

/** A date from <input type="date"> (YYYY-MM-DD). */
export const zDateText = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `Choose the ${label.toLowerCase()}`);

/** An email address. */
export const zEmail = (label = "Email") => z.string().trim().min(1, `Enter the ${label.toLowerCase()}`).email(`Enter a valid ${label.toLowerCase()}`);

/** A required choice from a select (value "" means nothing chosen). */
export const zChoice = (label: string) => z.string().min(1, `Choose the ${label.toLowerCase()}`);
