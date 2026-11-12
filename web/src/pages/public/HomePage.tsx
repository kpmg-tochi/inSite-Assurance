import React from "react";
import { Link } from "react-router-dom";
import { Play } from "lucide-react";
import { PublicLayout } from "../../components/PublicLayout";

const WAVE_BARS = [10, 18, 12, 22, 14, 24, 16, 12, 20, 10, 16, 22, 12, 18, 14];

export function HomePage() {
  return (
    <PublicLayout>
      {/* 1. Hero Section */}
      <section className="kpmg-ribbed-panel text-white border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 py-16 lg:py-20 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-6 space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-xs font-medium text-blue-100">
              <span>Capital Project Financing &amp; Monitoring in Nigeria</span>
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold leading-tight tracking-tight">
              Verify Physical Execution Before Tranche Funds Are Released.
            </h1>

            <p className="text-sm sm:text-base text-blue-100/90 leading-relaxed">
              <strong>InSite Assurance</strong> gives Nigerian project
              financiers, infrastructure guarantors, and licensed Independent
              Project Monitors a tamper-resistant field evidence and
              BOQ-to-claim reconciliation workbench.
            </p>

            <div className="bg-brand-navy/75 backdrop-blur-md border border-white/15 rounded-2xl p-4 text-xs text-blue-100/90 leading-relaxed">
              <strong className="text-white block mb-1">
                The &ldquo;Auditor Co-Pilot&rdquo; Principle:
              </strong>
              Certifying construction drawdowns in Nigeria is a regulated
              professional function carrying legal liability. The software never
              legally certifies completion percentages; instead, it structures
              geotagged field evidence and flags discrepancies so the licensed
              human Monitor (QSRBN Quantity Surveyor or COREN Engineer) can
              certify valuations with defensible proof.
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link
                to="/login"
                className="px-5 py-3 rounded-xl bg-white text-brand-primary hover:bg-blue-50 text-xs font-bold shadow-lg transition"
              >
                Launch Assurance Portal
              </Link>
              <Link
                to="/about"
                className="px-5 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/20 text-xs font-semibold transition"
              >
                Read Validated Specification
              </Link>
            </div>
          </div>

          {/* Right: Visual Platform Preview Mockup Stack */}
          <div className="lg:col-span-6 relative">
            {/* Base Card: Web Reconciliation & Corridor Map Preview */}
            <div className="bg-brand-navy/75 backdrop-blur-md border border-white/20 rounded-2xl p-5 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-blue-200">
                    Live Pilot Corridor · LKK-402
                  </div>
                  <div className="text-sm font-bold text-white">
                    Lekki–Epe Dual-Carriageway &amp; Box Culvert Upgrade
                  </div>
                </div>
                <span className="text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 px-2.5 py-0.5 rounded-full">
                  98.4% Within Corridor
                </span>
              </div>

              {/* Stylized Map Preview */}
              <div className="h-44 rounded-xl bg-brand-dark/90 border border-white/10 relative overflow-hidden">
                <svg
                  viewBox="0 0 500 180"
                  className="w-full h-full"
                  preserveAspectRatio="none"
                >
                  <path
                    d="M 0 140 Q 150 120, 260 95 T 500 40"
                    fill="none"
                    stroke="rgba(56, 189, 248, 0.18)"
                    strokeWidth="36"
                  />
                  <path
                    d="M 0 140 Q 150 120, 260 95 T 500 40"
                    fill="none"
                    stroke="var(--hex-brand-sky)"
                    strokeWidth="2.5"
                    strokeDasharray="7 5"
                  />
                </svg>
                <div className="absolute left-[18%] top-[56%] bg-brand-navy/90 border border-white/20 px-2.5 py-1 rounded-lg text-[10px] text-white">
                  KM 12+400 · Tier 1 Monitor
                </div>
                <div className="absolute left-[48%] top-[36%] bg-brand-primary border border-blue-300/40 px-2.5 py-1 rounded-lg text-[10px] font-bold text-white shadow-lg">
                  KM 14+210 · Hold-Point WBS 02.01.2
                </div>
              </div>

              {/* Mini Reconciliation Table Preview */}
              <div className="bg-white rounded-xl p-3 text-slate-900 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 pb-1.5">
                  <span>IPC #02 Line Item</span>
                  <span>Claim vs. Evidence</span>
                </div>
                <div className="flex items-center justify-between text-xs py-1">
                  <div>
                    <span className="font-bold text-slate-900 mr-2">
                      01.02.1
                    </span>
                    <span className="text-slate-600">
                      Laterite sub-grade compaction (45,000 m3)
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">
                    Supported
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs py-1 border-t border-slate-100">
                  <div>
                    <span className="font-bold text-slate-900 mr-2">
                      02.01.2
                    </span>
                    <span className="text-slate-600">
                      Grade C30 Box Culvert concrete (KM 14+210)
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-50 text-red-800 border border-red-200">
                    Contradicted
                  </span>
                </div>
              </div>
            </div>

            {/* Floating Voice Note & Whisper Card */}
            <div className="mt-4 lg:mt-0 lg:absolute lg:-bottom-6 lg:-left-6 w-full lg:w-80 bg-brand-navy/85 backdrop-blur-xl border border-white/25 rounded-2xl p-3.5 shadow-2xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold text-white">
                  Submitted Voice Note (Pidgin / English)
                </span>
                <span className="text-[11px] text-brand-sky">0:38</span>
              </div>
              <div className="flex items-center gap-2.5 mb-2.5">
                <div className="w-7 h-7 rounded-lg bg-brand-primary flex items-center justify-center shrink-0">
                  <Play className="w-3.5 h-3.5 text-white fill-white ml-0.5" />
                </div>
                <div className="flex-1 flex items-center gap-1 h-6">
                  {WAVE_BARS.map((h, i) => (
                    <div
                      key={i}
                      style={{ height: `${h}px` }}
                      className={`w-1 rounded-full ${
                        i < 8 ? "bg-brand-sky" : "bg-white/25"
                      }`}
                    />
                  ))}
                </div>
                <span className="text-[10px] text-blue-200">1.0x</span>
              </div>
              <div className="bg-white/95 rounded-xl p-2.5 text-slate-900 text-[11px] leading-snug">
                <div className="flex justify-between font-semibold text-slate-600 mb-0.5">
                  <span>Agent-Confirmed Summary</span>
                  <span className="text-emerald-700 font-bold">Signed Log</span>
                </div>
                &ldquo;Cast 12m of box culvert wall at KM 14+210. 40 bags of
                Dangote cement used.&rdquo;
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Validated Market Pain Points Solved */}
      <section className="max-w-7xl mx-auto px-6 py-16">
        <div className="max-w-3xl">
          <div className="text-xs font-bold uppercase tracking-wider text-brand-primary">
            Validated Problem Statement
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mt-1">
            Why Capital Project Tranche Verification Breaks Down
          </h2>
          <p className="text-sm text-slate-600 mt-2 leading-relaxed">
            Capital projects in Nigeria are financed in tranches against
            milestone progress claims that are labor-intensive to verify
            independently. Research across QSRBN, DFI, and industry sources
            highlights four core operational friction points:
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm flex flex-col justify-between">
            <div>
              <div className="text-xs font-bold text-brand-primary bg-blue-50 inline-block px-2.5 py-1 rounded-lg">
                01 · Drawdown Leakage Risk
              </div>
              <h3 className="text-sm font-bold text-slate-900 mt-3">
                Disbursement Without Commensurate Work
              </h3>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                Public monitoring across 2,760 federal projects flagged ₦15.07bn
                in incomplete or relocated works and ₦13.86bn released with no
                visible execution. Private lenders avoid defaults only through
                slow, manual IPC policing.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm flex flex-col justify-between">
            <div>
              <div className="text-xs font-bold text-brand-primary bg-blue-50 inline-block px-2.5 py-1 rounded-lg">
                02 · BOQ Opacity
              </div>
              <h3 className="text-sm font-bold text-slate-900 mt-3">
                Unstandardized Lump-Sum Baselines
              </h3>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                QSRBN documentation highlights that Nigerian project BOQs
                frequently contain large, opaque lump-sum items with limited
                breakdown, complicating independent cost-to-complete
                verification for lenders.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm flex flex-col justify-between">
            <div>
              <div className="text-xs font-bold text-brand-primary bg-blue-50 inline-block px-2.5 py-1 rounded-lg">
                03 · Field-to-Office Gap
              </div>
              <h3 className="text-sm font-bold text-slate-900 mt-3">
                Unstructured Site Supervision Logs
              </h3>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                Resident Clerks of Works and Site Engineers record daily covered
                works and material deliveries, but disconnected photos and voice
                notes are rarely mapped directly to WBS line items or loan
                Conditions Precedent.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm flex flex-col justify-between">
            <div>
              <div className="text-xs font-bold text-brand-primary bg-blue-50 inline-block px-2.5 py-1 rounded-lg">
                04 · Provenance &amp; Liability
              </div>
              <h3 className="text-sm font-bold text-slate-900 mt-3">
                Monitor Independence &amp; Collusion Risk
              </h3>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                Self-monitoring or unverified contractor photos undermine
                oversight. Every piece of evidence must be tagged with its
                reporter Independence Tier so self-reported claims trigger
                independent inspection.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Three-Part System Architecture */}
      <section className="bg-white border-y border-slate-200/80 py-16">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-brand-primary">
                3-Part Platform Architecture
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mt-1">
                Role-Segregated Governance from Site to Credit Committee
              </h2>
            </div>
            <Link
              to="/about"
              className="text-xs font-bold text-brand-primary hover:underline"
            >
              View Full Workflows &amp; Pricing Model &rarr;
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-8">
            {/* Pillar 1 */}
            <div className="rounded-2xl border border-slate-200 p-6 bg-slate-50/60 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-brand-primary">
                    Part 1 · Web Portal
                  </span>
                  <span className="text-[11px] font-medium bg-white border border-slate-200 px-2 py-0.5 rounded">
                    3 Segregated Roles
                  </span>
                </div>
                <h3 className="text-base font-bold text-slate-900 mt-2">
                  Role-Segregated Assurance Workbench
                </h3>
                <ul className="mt-3 space-y-2 text-xs text-slate-600 leading-relaxed">
                  <li>
                    <strong className="text-slate-900">
                      Independent Monitor (Certifier):
                    </strong>{" "}
                    Configures radial or linear corridor geofences, flags
                    Mandatory Visual Hold-Points, reviews AI claim-vs-evidence
                    ratings, and signs formal Valuation Reports.
                  </li>
                  <li>
                    <strong className="text-slate-900">
                      Lender / Guarantor (Approver):
                    </strong>{" "}
                    Reviews portfolio risk maps, Condition Precedent readiness,
                    holdback math, and approves tranche disbursements.
                  </li>
                  <li>
                    <strong className="text-slate-900">
                      Main Contractor (Claimant):
                    </strong>{" "}
                    Submits IPC drawdown claims and responds to Monitor line
                    queries on a segregated surface.
                  </li>
                </ul>
              </div>
              <div className="mt-6 pt-4 border-t border-slate-200/80">
                <Link
                  to="/login"
                  className="text-xs font-semibold text-brand-primary hover:underline"
                >
                  Test All 3 Demo Roles in Portal &rarr;
                </Link>
              </div>
            </div>

            {/* Pillar 2 */}
            <div className="rounded-2xl border border-slate-200 p-6 bg-slate-50/60 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-brand-primary">
                    Part 2 · Field Mobile App
                  </span>
                  <span className="text-[11px] font-medium bg-white border border-slate-200 px-2 py-0.5 rounded">
                    Offline-First SQLite
                  </span>
                </div>
                <h3 className="text-base font-bold text-slate-900 mt-2">
                  Provenance-Tagged Field Capture
                </h3>
                <ul className="mt-3 space-y-2 text-xs text-slate-600 leading-relaxed">
                  <li>
                    <strong className="text-slate-900">
                      6-Character Join Codes:
                    </strong>{" "}
                    Binds reporters to <strong>MONITOR_INSPECTOR (-INS)</strong>
                    , <strong>INDEPENDENT_RESIDENT (-COW)</strong>, or{" "}
                    <strong>CONTRACTOR_ENGINEER (-CON)</strong>.
                  </li>
                  <li>
                    <strong className="text-slate-900">
                      Live Verified Camera:
                    </strong>{" "}
                    Blocks gallery uploads, locks hardware GPS &amp; Turf.js
                    highway chainage (<strong>KM X+YYY</strong>), and signs
                    local SQLite bundles with SHA-256.
                  </li>
                  <li>
                    <strong className="text-slate-900">
                      Mandatory Human Confirmation:
                    </strong>{" "}
                    Field agents must review and sign off on Whisper-extracted
                    Pidgin/English quantities before database commit.
                  </li>
                </ul>
              </div>
              <div className="mt-6 pt-4 border-t border-slate-200/80">
                <Link
                  to="/mobile-app"
                  className="text-xs font-semibold text-brand-primary hover:underline"
                >
                  Explore Mobile App Architecture &rarr;
                </Link>
              </div>
            </div>

            {/* Pillar 3 */}
            <div className="rounded-2xl border border-slate-200 p-6 bg-slate-50/60 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-brand-primary">
                    Part 3 · Reconciliation Engine
                  </span>
                  <span className="text-[11px] font-medium bg-white border border-slate-200 px-2 py-0.5 rounded">
                    SHA-256 Hash Chain
                  </span>
                </div>
                <h3 className="text-base font-bold text-slate-900 mt-2">
                  Integrity Screening &amp; AI Co-Pilot
                </h3>
                <ul className="mt-3 space-y-2 text-xs text-slate-600 leading-relaxed">
                  <li>
                    <strong className="text-slate-900">
                      Anti-Spoofing &amp; pHash Screening:
                    </strong>{" "}
                    Screens every upload for Android/iOS mock-location flags,
                    out-of-corridor coordinates, and 64-bit perceptual hash
                    duplicate photos across projects.
                  </li>
                  <li>
                    <strong className="text-slate-900">
                      Evidence Strength Ratings:
                    </strong>{" "}
                    Evaluates each IPC line item as <strong>Supported</strong>,{" "}
                    <strong>Partially Supported</strong>,{" "}
                    <strong>Unsupported</strong>, or{" "}
                    <strong>Contradicted</strong>.
                  </li>
                  <li>
                    <strong className="text-slate-900">
                      Smart Visit Planner:
                    </strong>{" "}
                    Prioritizes high-value claims backed only by contractor
                    self-reports or missing Hold-Points for physical inspection.
                  </li>
                </ul>
              </div>
              <div className="mt-6 pt-4 border-t border-slate-200/80">
                <Link
                  to="/about"
                  className="text-xs font-semibold text-brand-primary hover:underline"
                >
                  Read Engineering Mitigations &rarr;
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
