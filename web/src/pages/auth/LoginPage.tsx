import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Play } from "lucide-react";
import { SEEDED_DEMO_ACCOUNTS, useAuth } from "../../lib/auth-context";
import { InSiteLogo } from "../../components/InSiteLogo";

const VOICE_WAVE_BARS = [
  10, 18, 12, 22, 14, 24, 16, 12, 20, 10, 16, 22, 12, 18, 14, 10, 16, 12,
];

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [selectedRoleIdx, setSelectedRoleIdx] = useState(0);
  const [email, setEmail] = useState(SEEDED_DEMO_ACCOUNTS[0].email);
  const [password, setPassword] = useState(SEEDED_DEMO_ACCOUNTS[0].password);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSelectSeededAccount = (idx: number) => {
    const acct = SEEDED_DEMO_ACCOUNTS[idx];
    setSelectedRoleIdx(idx);
    setEmail(acct.email);
    setPassword(acct.password);
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
      {/* Left Full-Height Ribbed KPMG Showcase Panel */}
      <div className="hidden lg:flex lg:col-span-7 p-3 h-full overflow-hidden">
        <div className="w-full h-full kpmg-ribbed-panel rounded-2xl p-8 xl:p-10 flex flex-col justify-between text-white relative overflow-hidden shadow-inner">
          {/* Top Brand Bar */}
          <div className="flex items-center justify-between z-10">
            <Link
              to="/"
              className="flex items-center gap-3 hover:opacity-90 transition"
            >
              <div className="bg-white rounded-xl px-2.5 py-1.5 flex items-center justify-center shadow-sm">
                {/* <img
                  src="/KPMG-logo.svg"
                  alt="KPMG"
                  className="h-5 w-auto object-contain"
                /> */}
                <InSiteLogo />
              </div>
              <div className="h-4 w-px bg-white/25" />
              <span className="font-semibold text-base tracking-tight text-white">
                InSite Assurance
              </span>
            </Link>
            <div className="flex items-center gap-2">
              <Link
                to="/"
                className="text-[11px] font-medium text-blue-100/85 hover:text-white bg-white/10 hover:bg-white/20 backdrop-blur-md px-3 py-1 rounded-full border border-white/15 transition"
              >
                Overview
              </Link>
              <Link
                to="/about"
                className="text-[11px] font-medium text-blue-100/85 hover:text-white bg-white/10 hover:bg-white/20 backdrop-blur-md px-3 py-1 rounded-full border border-white/15 transition"
              >
                Specification
              </Link>
              <Link
                to="/mobile-app"
                className="text-[11px] font-medium text-blue-100/85 hover:text-white bg-white/10 hover:bg-white/20 backdrop-blur-md px-3 py-1 rounded-full border border-white/15 transition"
              >
                Mobile App
              </Link>
            </div>
          </div>

          {/* Hero Copy */}
          <div className="mt-4 max-w-xl z-10">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-200 mb-1.5">
              Capital Project Governance
            </div>
            <h1 className="text-2xl xl:text-3xl font-bold leading-tight tracking-tight">
              Closing the Physical-to-Financial Assurance Gap.
            </h1>
            <p className="text-xs xl:text-sm text-blue-100/85 mt-2 leading-relaxed">
              Independent geospatial corridor verification, Nigerian Pidgin
              &amp; English voice-to-BOQ extraction, and automated Interim
              Payment Certificate reconciliation for infrastructure lenders and
              monitors.
            </p>
          </div>

          {/* Center Overlapping Glassmorphic Cards (Map Preview + Overlapping Voice Note / Extraction Card) */}
          <div className="relative my-auto py-4 z-10">
            {/* Card 1: Translucent Live Corridor Map Preview (~70% Opacity + Backdrop Blur + Subtle Border) */}
            <div className="w-[82%] bg-brand-navy/70 backdrop-blur-md border border-white/20 rounded-2xl p-4 shadow-2xl">
              <div className="flex items-center justify-between mb-2.5">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-blue-200/80">
                    Live Corridor Geofence Preview
                  </div>
                  <div className="text-xs font-bold text-white mt-0.5">
                    LKK-402 · Lekki–Epe Dual-Carriageway (KM 0+000 to KM 24+500)
                  </div>
                </div>
                <span className="text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 px-2.5 py-0.5 rounded-full">
                  98.4% Within Corridor
                </span>
              </div>

              {/* Stylized Vector Corridor Map Canvas */}
              <div className="h-48 xl:h-52 rounded-xl bg-brand-dark/75 border border-white/10 relative overflow-hidden">
                {/* Subtle Coordinate Grid */}
                <div
                  className="absolute inset-0 opacity-20"
                  style={{
                    backgroundImage:
                      "linear-gradient(to right, rgba(148, 163, 184, 0.25) 1px, transparent 1px), linear-gradient(to bottom, rgba(148, 163, 184, 0.25) 1px, transparent 1px)",
                    backgroundSize: "36px 36px",
                  }}
                />

                {/* SVG Highway Corridor Buffer & Centerline */}
                <svg
                  viewBox="0 0 500 200"
                  className="w-full h-full relative z-10"
                  preserveAspectRatio="none"
                >
                  {/* Secondary arterial roads */}
                  <path
                    d="M 0 150 Q 140 130, 240 105 T 500 50"
                    fill="none"
                    stroke="rgba(56, 189, 248, 0.18)"
                    strokeWidth="34"
                    strokeLinecap="round"
                  />
                  <path
                    d="M 0 150 Q 140 130, 240 105 T 500 50"
                    fill="none"
                    stroke="var(--hex-brand-sky)"
                    strokeWidth="2.5"
                    strokeDasharray="7 5"
                  />
                </svg>

                {/* Pin 1: KM 12+400 */}
                <div className="absolute left-[22%] top-[58%] z-20 flex items-center gap-1.5 bg-brand-navy/90 backdrop-blur-sm border border-white/20 px-2 py-1 rounded-lg shadow">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-[10px] text-white font-semibold">
                    KM 12+400 · Tier 1
                  </span>
                </div>

                {/* Pin 2: Active KM 14+210 Culvert Hold-Point */}
                <div className="absolute left-[46%] top-[40%] z-20 flex items-center gap-1.5 bg-brand-primary/95 backdrop-blur-sm border border-blue-300/40 px-2.5 py-1 rounded-lg shadow-lg">
                  <span className="w-2.5 h-2.5 rounded-full bg-brand-sky animate-pulse" />
                  <span className="text-[10px] text-white font-bold">
                    KM 14+210 · WBS 02.03.1
                  </span>
                </div>

                {/* Bottom Telemetry Strip inside Map Preview */}
                <div className="absolute bottom-2 left-2.5 right-2.5 z-20 flex items-center justify-between text-[10px] text-blue-200/80 bg-brand-navy/75 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-white/10">
                  <span>6.4698° N, 3.5852° E (±3.4m GPS)</span>
                  <span>±150m Corridor Buffer</span>
                </div>
              </div>
            </div>

            {/* Card 2: Partially Overlapping Voice Note & Whisper Summary Card (~70% Opacity + Backdrop Blur + Subtle Border) */}
            <div className="lg:absolute lg:right-0 lg:-bottom-3 w-full lg:w-[370px] xl:w-[395px] z-30 bg-brand-navy/70 backdrop-blur-xl border border-white/20 rounded-2xl p-3.5 shadow-[0_20px_50px_rgba(0,0,0,0.45)] space-y-2.5">
              {/* Top Sub-Card: Submitted Voice Note Player */}
              <div className="bg-brand-subcard/80 backdrop-blur-md border border-white/15 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-white">
                    Submitted Voice Note (Pidgin / English)
                  </span>
                  <span className="text-[11px] text-brand-sky font-semibold">
                    0:38
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="w-8 h-8 rounded-lg bg-brand-primary border border-blue-400/30 flex items-center justify-center shrink-0 shadow">
                    <Play className="w-3.5 h-3.5 text-white fill-white ml-0.5" />
                  </div>
                  <div className="flex-1 flex items-center gap-1 h-7">
                    {VOICE_WAVE_BARS.map((heightPx, idx) => (
                      <div
                        key={idx}
                        style={{ height: `${heightPx}px` }}
                        className={`w-1 rounded-full ${
                          idx < 9 ? "bg-brand-sky" : "bg-white/25"
                        }`}
                      />
                    ))}
                  </div>
                  <span className="text-[11px] text-slate-300">1.0x</span>
                </div>
              </div>

              {/* Bottom Sub-Card: Agent-Confirmed Summary & Whisper Transcript */}
              <div className="bg-white/85 backdrop-blur-md border border-white/40 rounded-xl p-3 text-slate-900">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-semibold text-slate-600">
                    Agent-Confirmed Summary
                  </span>
                  <span className="text-[11px] font-bold text-emerald-700">
                    Signed Log
                  </span>
                </div>
                <p className="text-[11px] font-semibold text-slate-900 leading-relaxed">
                  &ldquo;Cast 12m of box culvert wall at KM 14+210. 40 bags of
                  Dangote cement and 2 trips of granite used. Blocker: Heavy
                  rain halted pouring on Cell 2.&rdquo;
                </p>
                <div className="border-t border-slate-200/90 my-2" />
                <p className="text-[10.5px] text-slate-600 leading-relaxed">
                  <strong className="text-slate-700">
                    Whisper Transcript:
                  </strong>{" "}
                  &ldquo;We dey for chainage fourteen plus two hundred this
                  afternoon. Contractor don cast twelve meters of the box
                  culvert wall and use forty bags of Dangote cement...&rdquo;
                </p>
              </div>
            </div>
          </div>

          {/* Bottom Footer Bar */}
          <div className="flex items-center justify-between text-[11px] text-blue-100/75 pt-2 border-t border-white/10 z-10">
            <span>
              Active Pilot Corridors: LKK-402 Lekki–Epe (₦14.5B) · ABJ-108 Abuja
              Idu Solar (₦4.2B)
            </span>
            <span>QSRBN · COREN · ICAN</span>
          </div>
        </div>
      </div>

      {/* Right Full-Viewport Sign-In Panel */}
      <div className="col-span-1 lg:col-span-5 h-full flex flex-col justify-between p-8 sm:p-10 xl:p-12 overflow-y-auto bg-white">
        <div className="my-auto max-w-md w-full mx-auto">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              Sign in to Assurance Portal
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

          {/* 1-Click Seeded Demo Account Selector */}
          <div className="mt-8 pt-6 border-t border-slate-100">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2.5">
              Quick-Select Seeded Demo Account (1-Click Fill)
            </div>
            <div className="space-y-2">
              {SEEDED_DEMO_ACCOUNTS.map((acct, idx) => {
                const isSelected = selectedRoleIdx === idx;
                return (
                  <button
                    key={acct.email}
                    type="button"
                    onClick={() => handleSelectSeededAccount(idx)}
                    className={`w-full text-left p-2.5 rounded-xl border transition flex items-center justify-between ${
                      isSelected
                        ? "border-brand-primary bg-blue-50/40 shadow-sm"
                        : "border-slate-200 hover:border-brand-primary hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-7 h-7 rounded-full font-bold text-xs flex items-center justify-center shrink-0 ${
                          isSelected
                            ? "bg-brand-primary text-white"
                            : "bg-slate-200 text-slate-700"
                        }`}
                      >
                        {acct.initials}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-slate-900">
                          {acct.roleTitle}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {acct.name} — {acct.organization} · {acct.email}
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] font-semibold text-brand-primary bg-white px-2 py-0.5 rounded border border-blue-200 shrink-0">
                      {acct.credential}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bottom Copyright Footer */}
        <div className="text-[11px] text-slate-400 flex items-center justify-between max-w-md w-full mx-auto pt-4">
          <span>&copy; 2026 KPMG Advisory Services. All rights reserved.</span>
          <span className="text-slate-400">Pilot</span>
        </div>
      </div>
    </div>
  );
}
