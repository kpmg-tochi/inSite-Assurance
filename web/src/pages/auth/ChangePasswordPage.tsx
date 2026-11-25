import { useState } from "react";
import { z } from "zod";
import { ChangePasswordRequestSchema } from "@insite/shared";
import { useAuth } from "../../lib/auth-context";
import { BrandLogo } from "../../components/BrandLogo";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm } from "../../lib/forms";

/** The change-password contract plus the confirmation field (the server never sees it). */
export const ChangePasswordFormSchema = z
  .object({ currentPassword: z.string(), newPassword: z.string(), confirmPassword: z.string() })
  .superRefine((v, ctx) => {
    const parsed = ChangePasswordRequestSchema.safeParse({ currentPassword: v.currentPassword, newPassword: v.newPassword });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message });
    }
    if (!v.confirmPassword) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["confirmPassword"], message: "Type the new password again" });
    } else if (v.confirmPassword !== v.newPassword) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["confirmPassword"], message: "New password and confirmation do not match." });
    }
  });

/**
 * Shown instead of the workspace while `user.mustChangePassword` is set (accounts created by an
 * administrator with a temporary password). The API refuses every other request until then.
 */
export function ChangePasswordPage() {
  const { user, changePassword, logout } = useAuth();
  const form = useZodForm(ChangePasswordFormSchema, {
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });
  const { register, handleSubmit, trigger } = form;
  const [error, setError] = useState<string | null>(null);

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await changePassword({ currentPassword: values.currentPassword, newPassword: values.newPassword });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change your password.");
    }
  });

  const inputClass =
    "w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-brand-primary";

  return (
    <div className="min-h-screen bg-surface-canvas flex items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        noValidate
        className="max-w-sm w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4"
      >
        <BrandLogo className="h-12 w-12" />
        <div>
          <h1 className="text-base font-bold text-slate-900">Set a new password</h1>
          <p className="text-xs text-slate-500 mt-1">
            {user?.fullName ? `${user.fullName}, your` : "Your"} account was created with a
            temporary password. Choose your own before continuing.
          </p>
        </div>

        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-700">Temporary password</span>
          <input
            type="password"
            autoComplete="current-password"
            {...register("currentPassword", { onChange: () => void trigger("newPassword") })}
            {...fieldA11y(form, "currentPassword")}
            className={`${inputClass} ${invalidClass(form, "currentPassword")}`}
          />
          <FieldError form={form} name="currentPassword" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-700">New password</span>
          <input
            type="password"
            autoComplete="new-password"
            {...register("newPassword", { onChange: () => void trigger("confirmPassword") })}
            {...fieldA11y(form, "newPassword")}
            className={`${inputClass} ${invalidClass(form, "newPassword")}`}
          />
          <span className="text-[11px] text-slate-400">
            At least 10 characters, with a letter and a number.
          </span>
          <FieldError form={form} name="newPassword" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-700">Confirm new password</span>
          <input
            type="password"
            autoComplete="new-password"
            {...register("confirmPassword")}
            {...fieldA11y(form, "confirmPassword")}
            className={`${inputClass} ${invalidClass(form, "confirmPassword")}`}
          />
          <FieldError form={form} name="confirmPassword" />
        </label>

        {error && (
          <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={logout}
            className="text-xs font-semibold text-slate-500 hover:text-slate-800"
          >
            Sign out
          </button>
          <SubmitButton
            form={form}
            pendingLabel="Saving..."
            className="px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-primary"
          >
            Save password
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
