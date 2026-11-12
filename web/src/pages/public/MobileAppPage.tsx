import React from "react";
import { Link } from "react-router-dom";
import { PublicLayout } from "../../components/PublicLayout";

export function MobileAppPage() {
  return (
    <PublicLayout>
      {/* Hero Banner */}
      <section className="kpmg-ribbed-panel text-white border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 py-16 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-7 space-y-5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-xs font-medium text-blue-100">
              <span>InSite Assurance Field · iOS &amp; Android (Expo)</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold leading-tight">
              Offline-First, Provenance-Tagged Field Evidence Capture.
            </h1>
            <p className="text-sm sm:text-base text-blue-100/90 leading-relaxed max-w-2xl">
              Designed for zero training overhead and rugged Nigerian corridor
              resilience. Visiting Monitors, Resident Clerks of Works, and
              Contractor Site Engineers join via a 6-character Project Code,
              capture live geotagged photos and English/Pidgin voice notes
              offline, and cryptographically sign extracted quantities.
            </p>

            {/* Download / Pilot Distribution Callout */}
            <div className="pt-2 flex flex-wrap items-center gap-3">
              <div className="px-4 py-2.5 rounded-xl bg-white text-brand-primary text-xs font-bold shadow">
                Android Pilot APK (Coming Soon)
              </div>
              <div className="px-4 py-2.5 rounded-xl bg-white/10 border border-white/20 text-white text-xs font-semibold">
                iOS TestFlight Build (Coming Soon)
              </div>
              <Link
                to="/login"
                className="px-4 py-2.5 rounded-xl text-blue-100 hover:text-white text-xs font-semibold underline underline-offset-4"
              >
                View Synced Logs in Web Portal &rarr;
              </Link>
            </div>
          </div>

          {/* Right: Interactive Mobile Phone Frame Preview */}
          <div className="lg:col-span-5 flex justify-center">
            <div className="w-[330px] bg-brand-dark rounded-[36px] p-3 border-4 border-white/20 shadow-2xl">
              <div className="bg-slate-50 rounded-[28px] overflow-hidden text-slate-900">
                {/* Mobile Top Status Bar */}
                <div className="bg-brand-navy text-white px-4 py-3.5">
                  <div className="flex items-center justify-between text-[10px] font-semibold text-blue-200">
                    <span>LKK-402-COW</span>
                    <span className="text-emerald-400">
                      SQLite Outbox Ready
                    </span>
                  </div>
                  <div className="text-xs font-bold mt-0.5">
                    Lekki–Epe Dual-Carriageway
                  </div>
                  <div className="text-[10px] text-blue-200/80">
                    Tier 2: Independent Resident Clerk of Works
                  </div>
                </div>

                {/* Live Turf.js Chainage Banner */}
                <div className="bg-emerald-50 border-b border-emerald-200 px-3.5 py-2 flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-emerald-900">
                    Corridor Verified: KM 14+200
                  </span>
                  <span className="font-medium text-emerald-700">
                    ±3.2m GPS
                  </span>
                </div>

                {/* Mandatory Human Confirmation Bubble Preview */}
                <div className="p-3.5 space-y-3">
                  <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-brand-primary">
                        Mandatory Confirmation Bubble
                      </span>
                      <span className="text-[10px] text-slate-400">
                        17:12 WAT
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 italic">
                      &ldquo;We dey for chainage fourteen plus two hundred.
                      Contractor don cast twelve meters of culvert wall and use
                      forty bags of Dangote cement...&rdquo;
                    </p>
                    <div className="bg-slate-50 rounded-lg p-2 border border-slate-200/80 text-xs">
                      <div className="font-semibold text-slate-900">
                        Extracted Summary (GPT-4.1):
                      </div>
                      <p className="text-[11px] text-slate-700 mt-0.5">
                        Cast <strong>12m</strong> of drainage culvert (WBS
                        02.01.2). <strong>40 bags</strong> of cement used.
                        Blocker: Granite delivery delayed.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div className="py-2 rounded-lg bg-brand-primary text-white text-center text-[11px] font-bold">
                        Confirm &amp; Sign Log
                      </div>
                      <div className="py-2 rounded-lg border border-slate-300 text-slate-700 text-center text-[11px] font-semibold">
                        Edit Quantities
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Core Mobile Capabilities */}
      <section className="max-w-7xl mx-auto px-6 py-16 space-y-12">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-brand-primary">
            How the Field App Works
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mt-1">
            Built for Low-Connectivity Sites and Cryptographic Provenance
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm space-y-3">
            <div className="text-xs font-bold text-brand-primary bg-blue-50 inline-block px-2.5 py-1 rounded-lg">
              Step 1 · Role-Bound Join Codes
            </div>
            <h3 className="text-base font-bold text-slate-900">
              3 Provenance &amp; Independence Tiers
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Field personnel do not need corporate email accounts. Entering a
              project&apos;s 6-character Join Code binds their device session to
              one of three strict provenance tiers:
            </p>
            <ul className="space-y-1.5 text-xs text-slate-700 font-medium bg-slate-50 p-3 rounded-xl border border-slate-200/80">
              <li>
                <strong>LKK-402-INS</strong> &rarr; Tier 1 Monitor Inspector
              </li>
              <li>
                <strong>LKK-402-COW</strong> &rarr; Tier 2 Resident CoW
              </li>
              <li>
                <strong>LKK-402-CON</strong> &rarr; Tier 3 Contractor Eng.
              </li>
            </ul>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm space-y-3">
            <div className="text-xs font-bold text-brand-primary bg-blue-50 inline-block px-2.5 py-1 rounded-lg">
              Step 2 · On-Device Turf.js &amp; SQLite
            </div>
            <h3 className="text-base font-bold text-slate-900">
              Live Verified Camera &amp; Offline Outbox
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Camera roll/gallery uploads are blocked for site evidence. At
              shutter press, the app locks hardware GPS coordinates, screens for
              mock-location providers, computes highway chainage (
              <strong>KM X+YYY</strong>) offline via <strong>@turf/turf</strong>
              , and signs the capture bundle in <strong>expo-sqlite</strong>{" "}
              with a SHA-256 device signature hash.
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm space-y-3">
            <div className="text-xs font-bold text-brand-primary bg-blue-50 inline-block px-2.5 py-1 rounded-lg">
              Step 3 · Mitigating ASR Risk [S20]
            </div>
            <h3 className="text-base font-bold text-slate-900">
              Mandatory Human Confirmation Bubble
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Published benchmarks show standard speech models exhibit higher
              word error rates on Nigerian accents (31.6% vs. 8.6% US) and can
              mistranscribe quantities unless verified. Before any voice log is
              committed to the database, the field reporter must review the
              extracted quantities and tap{" "}
              <strong>Confirm &amp; Sign Log</strong>.
            </p>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
