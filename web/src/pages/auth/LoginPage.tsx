import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth-context";
import { useDemoAccounts } from "../../config/useDemoAccounts";
import { IS_DEMO_MODE } from "../../config/demoMode";
import { CustomSelect, type CustomSelectOption } from "../../components/common";
import { APPLICATION_NAME } from "../../config/appName";
import { BrandLogo, DEFAULT_FULL_LOGO_URL } from "../../components/BrandLogo";

/**
 * Sign-in (UBEC rebrand): the client's photograph and full logo on the left, a plain form on the
 * right. In demo builds a role picker fills the form with a seeded account.
 */
export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const demo = useDemoAccounts();
  const demoAccounts = demo?.accounts ?? [];
  const [selectedRoleIdx, setSelectedRoleIdx] = useState(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const demoAccountOptions: CustomSelectOption<number>[] = useMemo(
    () =>
      demoAccounts.map((acct, idx) => ({
        value: idx,
        label: `${acct.roleTitle} — ${acct.name}`,
        description: `${acct.organization} · ${acct.email}`,
      })),
    [demoAccounts]
  );

  // Demo builds prefill the first seeded account once the demo module has loaded.
  useEffect(() => {
    if (demo && demo.accounts[0]) {
      setEmail((prev) => prev || demo.accounts[0].email);
      setPassword((prev) => prev || demo.password);
    }
  }, [demo]);

  const handleSelectSeededAccount = (idx: number) => {
    const acct = demoAccounts[idx];
    if (!acct || !demo) return;
    setSelectedRoleIdx(idx);
    setEmail(acct.email);
    setPassword(demo.password);
    setErrorMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      setErrorMsg(null);
      await login(email, password);
      navigate("/app");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      setErrorMsg(message || "The portal could not be reached. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass =
    "w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 transition";

  return (
    <div className="min-h-screen w-full bg-white grid grid-cols-1 lg:grid-cols-12">
      {/* The client's photograph and mark */}
      <div className="hidden lg:block lg:col-span-7 p-3 h-screen sticky top-0">
        <div className="relative h-full w-full overflow-hidden rounded-2xl text-white">
          <img src="/client/ubec-login.jpeg" alt="" className="absolute inset-0 h-full w-full object-cover object-[center_60%]" />
          <div className="absolute inset-0 bg-gradient-to-b from-brand-navy/90 via-brand-navy/20 to-brand-navy/95" aria-hidden="true" />
          <div className="relative z-10 flex h-full flex-col justify-between p-8 xl:p-10">
            <img src={DEFAULT_FULL_LOGO_URL} alt="Universal Basic Education Commission (UBEC)" className="h-12 xl:h-14 w-auto self-start" />
            <div className="max-w-xl">
              <h1 className="text-3xl xl:text-4xl font-bold leading-tight tracking-tight text-balance">
                Every school project, from contract award to handover.
              </h1>
              <p className="mt-3 text-sm xl:text-base leading-relaxed text-white/85 max-w-lg">
                Site visits with geotagged photos, findings followed to correction, and every deadline and sign-off in one place, for
                Direct Intervention and Matching Grants projects.
              </p>
              <p className="mt-6 border-t border-white/20 pt-3 text-xs text-white/75">Universal Basic Education Commission · Education for development</p>
            </div>
          </div>
        </div>
      </div>

      {/* Sign-in */}
      <div className="lg:col-span-5 min-h-screen flex flex-col justify-between px-6 py-8 sm:px-10 xl:px-12">
        <div className="my-auto w-full max-w-sm mx-auto">
          <BrandLogo className="h-14 w-14 mb-6" alt="Universal Basic Education Commission (UBEC)" />
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Sign in</h2>
          <p className="mt-1.5 text-sm text-slate-600">{APPLICATION_NAME}</p>

          {errorMsg && (
            <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="login-email" className="mb-1.5 block text-sm font-medium text-slate-700">
                Work email
              </label>
              <input
                id="login-email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@ubec.gov.ng"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="login-password" className="mb-1.5 block text-sm font-medium text-slate-700">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {isSubmitting ? "Signing in…" : "Sign in"}
            </button>
          </form>

          {IS_DEMO_MODE && demoAccounts.length > 0 && (
            <div className="mt-8 border-t border-slate-100 pt-5">
              <label htmlFor="demo-role-select" className="mb-2 block text-sm font-medium text-slate-700">
                Demo: sign in as
              </label>
              <CustomSelect id="demo-role-select" openUpward value={selectedRoleIdx} onChange={(idx) => handleSelectSeededAccount(idx)} options={demoAccountOptions} size="md" />
              {demoAccounts[selectedRoleIdx] && (
                <p className="mt-2 text-xs text-slate-500">
                  {demoAccounts[selectedRoleIdx].name}, {demoAccounts[selectedRoleIdx].organization}
                </p>
              )}
            </div>
          )}
        </div>

        <p className="mx-auto w-full max-w-sm pt-6 text-xs text-slate-500">© 2026 Universal Basic Education Commission</p>
      </div>
    </div>
  );
}
