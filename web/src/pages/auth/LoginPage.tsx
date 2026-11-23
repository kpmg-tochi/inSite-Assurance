import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { useAuth } from "../../lib/auth-context";
import { useDemoAccounts } from "../../config/useDemoAccounts";
import { IS_DEMO_MODE } from "../../config/demoMode";
import { CustomSelect, type CustomSelectOption } from "../../components/common";

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
        badge: acct.credential,
      })),
    [demoAccounts],
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
      navigate("/app/dashboard");
    } catch (err: any) {
      setErrorMsg(
        err?.message ||
          "Unable to connect to InSite Assurance API. Please verify the server is running on port 4000.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-white grid grid-cols-1 lg:grid-cols-12">
      {/* Left Full-Height UBEC Showcase Panel (demo branch) */}
      <div className="hidden lg:flex lg:col-span-7 p-3 h-full overflow-hidden">
        <div className="w-full h-full rounded-2xl relative overflow-hidden shadow-inner text-white">
          <img
            src="/client/ubec-login.jpeg"
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-brand-navy/85 via-brand-navy/35 to-brand-navy/90" />

          <div className="relative z-10 h-full p-8 xl:p-10 flex flex-col justify-between">
            {/* Top Brand Bar */}
            <div className="flex items-center justify-between">
              <img
                src="/client/ubec-logo-full.png"
                alt="Universal Basic Education Commission (UBEC)"
                className="h-12 xl:h-14 w-auto"
              />
              <span className="text-[11px] font-semibold text-white bg-white/10 backdrop-blur-md px-3 py-1 rounded-full border border-white/20">
                Powered by InSite Assurance
              </span>
            </div>

            {/* Hero Copy */}
            <div className="max-w-xl">
              <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#FFBF00] mb-2">
                <span className="w-6 h-0.5 bg-[#FFBF00] rounded-full" />
                Basic Education Infrastructure Programme
              </div>
              <h1 className="text-3xl xl:text-4xl font-bold leading-tight tracking-tight">
                Verified progress, from site to payment.
              </h1>
              <p className="text-sm text-white/85 mt-3 leading-relaxed">
                One platform for Direct Intervention and Matching Grounds projects:
                supervision and M&amp;E visits captured on site, findings tracked to
                resolution, and milestone payments released only on verified evidence.
              </p>
            </div>

            {/* Bottom Footer Bar */}
            <div className="flex items-center justify-between text-[11px] text-white/80 pt-3 border-t border-white/15">
              <span>Universal Basic Education Commission · Education for Development</span>
              <span>UBEC · SUBEBs</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Full-Viewport Sign-In Panel */}
      <div className="col-span-1 lg:col-span-5 h-full flex flex-col justify-between p-8 sm:p-10 xl:p-12 overflow-y-auto bg-white">
        <div className="my-auto max-w-md w-full mx-auto">
          <div>
            <img
              src="/client/ubec-logo.png"
              alt="UBEC"
              className="h-16 w-auto mb-5"
            />
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              Sign in to the UBEC Assurance Portal
            </h2>
            <p className="text-xs text-slate-500 mt-1.5">
              Enter your corporate credentials or select a seeded pilot role
              below.
            </p>

            {errorMsg && (
              <div className="mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Work Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-brand-primary focus:bg-white transition"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-brand-primary focus:bg-white transition"
                />
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 px-4 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm transition disabled:opacity-50"
              >
                {isSubmitting ? "Signing in..." : "Sign In to Workspace"}
              </button>
            </form>
          </div>

          {/* Quick-Select Demo Role Dropdown */}
          {IS_DEMO_MODE && demoAccounts.length > 0 && (
            <div className="mt-7 pt-5 border-t border-slate-100">
              <div className="flex items-center justify-between mb-2">
                <label
                  htmlFor="demo-role-select"
                  className="text-[11px] font-semibold uppercase tracking-wider text-slate-500"
                >
                  Quick-Fill Demo Role
                </label>
                <span className="text-[10px] font-medium text-slate-400">
                  Select a role to autofill
                </span>
              </div>

              <CustomSelect
                value={selectedRoleIdx}
                onChange={(idx) => handleSelectSeededAccount(idx)}
                options={demoAccountOptions}
                size="md"
              />

              {/* Selected account summary card */}
              {demoAccounts[selectedRoleIdx] && (
                <div className="mt-2.5 p-2.5 rounded-xl bg-brand-primary/5 border border-brand-primary/15 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-brand-primary text-white text-xs font-bold flex items-center justify-center shrink-0 shadow-sm">
                      {demoAccounts[selectedRoleIdx].initials}
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900">
                        {demoAccounts[selectedRoleIdx].name}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {demoAccounts[selectedRoleIdx].email} · {demoAccounts[selectedRoleIdx].organization}
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] font-semibold text-brand-primary bg-white px-2 py-0.5 rounded border border-brand-primary/25 shrink-0">
                    {demoAccounts[selectedRoleIdx].credential}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom Copyright Footer */}
        <div className="text-[11px] text-slate-400 flex items-center justify-between max-w-md w-full mx-auto pt-4">
          <span>&copy; 2026 UBEC · Powered by InSite Assurance</span>
          <span className="text-slate-400">Pilot</span>
        </div>
      </div>
    </div>
  );
}
