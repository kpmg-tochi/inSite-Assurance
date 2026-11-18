import React, { useState } from "react";
import { ChangePasswordRequestSchema } from "@insite/shared";
import { useAuth } from "../../lib/auth-context";
import { InSiteLogo } from "../../components/InSiteLogo";

/**
 * Shown instead of the workspace while `user.mustChangePassword` is set (accounts created by an
 * administrator with a temporary password). The API refuses every other request until then.
 */
export function ChangePasswordPage() {
  const { user, changePassword, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    const parsed = ChangePasswordRequestSchema.safeParse({ currentPassword, newPassword });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid password.");
      return;
    }
    try {
      setSubmitting(true);
      await changePassword(parsed.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change your password.");
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    "w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-brand-primary";

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="max-w-sm w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4"
      >
        <InSiteLogo />
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
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-700">New password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className={inputClass}
          />
          <span className="text-[11px] text-slate-400">
            At least 10 characters, with a letter and a number.
          </span>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-700">Confirm new password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={inputClass}
          />
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
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-bold disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Save password"}
          </button>
        </div>
      </form>
    </div>
  );
}
