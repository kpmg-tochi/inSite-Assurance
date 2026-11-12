import React, { useEffect, useState } from "react";
import { PublicLayout } from "../../components/PublicLayout";
import { CitationRef, CitationGroup } from "../../components/CitationRef";

const SECTIONS = [
  { id: "executive-summary", title: "1. Executive Summary" },
  {
    id: "problem-statement",
    title: "2. Validated Problem Statement & Market Reality",
  },
  { id: "solution-overview", title: "3. Proposed Solution Overview" },
  {
    id: "lifecycle-flow",
    title: "4. End-to-End Project Lifecycle & Operational Flow",
  },
  {
    id: "role-components",
    title: "5. Solution Components & User Flows by Role",
  },
  { id: "competitive-landscape", title: "6. Competitive Landscape" },
  {
    id: "customers-pricing",
    title: "7. Target Customers & Realistic Pricing Model",
  },
  {
    id: "risks-mitigations",
    title: "8. Key Risks & Engineering Mitigations",
  },
];

export function AboutPage() {
  const [activeSectionId, setActiveSectionId] = useState<string>(
    SECTIONS[0].id,
  );

  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY + 160;
      let currentId = SECTIONS[0].id;

      for (const section of SECTIONS) {
        const el = document.getElementById(section.id);
        if (el && el.offsetTop <= scrollPosition) {
          currentId = section.id;
        }
      }
      setActiveSectionId(currentId);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = (id: string) => {
    setActiveSectionId(id);
    const el = document.getElementById(id);
    if (el) {
      const y = el.getBoundingClientRect().top + window.scrollY - 96;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  };

  return (
    <PublicLayout>
      {/* Top Hero Banner */}
      <div className="bg-brand-navy text-white border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 py-12">
          <div className="text-xs font-semibold uppercase tracking-wider text-blue-200">
            Validated Platform Specification
          </div>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold mt-2">
            InSite Assurance: Field Evidence and Disbursement Reconciliation
            Platform
          </h1>
        </div>
      </div>

      {/* Main Content Grid with High-Contrast Dark Sidebar */}
      <div className="max-w-7xl mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Specification Content (9 Columns) */}
        <div className="lg:col-span-9 space-y-10">
          {/* Section 1: Executive Summary */}
          <section
            id="executive-summary"
            className="bg-white rounded-2xl border border-slate-200/80 p-6 sm:p-8 shadow-sm scroll-mt-24 space-y-4"
          >
            <h2 className="text-xl font-bold text-slate-900 border-b border-slate-100 pb-3">
              1. Executive Summary
            </h2>
            <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-brand-primary">
                Value Proposition
              </div>
              <p className="text-sm font-semibold text-slate-900 mt-1 leading-relaxed">
                InSite Assurance provides Nigerian project financiers,
                infrastructure guarantors, and licensed Independent Project
                Monitors with a tamper-resistant field evidence and BOQ-to-claim
                reconciliation workbench to verify contractor payment claims
                before tranche funds are released.
              </p>
            </div>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              InSite Assurance is an evidence integrity and drawdown
              reconciliation platform built for capital project financing and
              monitoring in Nigeria. Appointed field personnel (including
              Resident Clerks of Works, visiting Monitor Engineers, and mandated
              Contractor Site Supervisors) capture live, hardware-geotagged
              photos and voice or text logs in English or Nigerian Pidgin
              through an offline-first mobile application.
            </p>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              The platform maps field evidence directly to individual Bill of
              Quantities (BOQ) line items and loan Conditions Precedent (CPs).
              It cross-examines evidence against the contractor&apos;s Interim
              Payment Certificate (IPC) drawdown claim, assigning an Evidence
              Strength Rating (<em>Supported</em>, <em>Partially Supported</em>,{" "}
              <em>Unsupported</em>, or <em>Contradicted</em>) to each claimed
              work item.
            </p>
            <p className="text-xs sm:text-sm text-slate-700 font-medium bg-slate-50 p-4 rounded-xl border border-slate-200 leading-relaxed">
              The software does not legally certify completion percentages.
              Certifying construction drawdowns in Nigeria is a regulated
              professional function carrying statutory legal liability
              <CitationGroup ids={[8, 22]} />. Instead, InSite Assurance acts as
              an Auditor Co-Pilot: the software structures field evidence and
              flags discrepancies, the licensed human Monitor (Quantity Surveyor
              or COREN Engineer) reviews and certifies the valuation, and the
              Financier approves the disbursement.
            </p>
          </section>

          {/* Section 2: Validated Problem Statement */}
          <section
            id="problem-statement"
            className="bg-white rounded-2xl border border-slate-200/80 p-6 sm:p-8 shadow-sm scroll-mt-24 space-y-5"
          >
            <h2 className="text-xl font-bold text-slate-900 border-b border-slate-100 pb-3">
              2. Validated Problem Statement &amp; Market Reality Checks
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Capital projects in Nigeria are financed in tranches against
              milestone progress claims that are difficult to verify quickly and
              independently. Secondary research and industry documentation
              validate four operational friction points:
            </p>

            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
                <h3 className="text-sm font-bold text-slate-900">
                  1. Disbursement Without Commensurate Physical Work (Validated
                  in Public Sector; Plausible Risk in Private Credit)
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  <strong>Public Infrastructure Findings:</strong> Tracka&apos;s
                  2024/2025 monitoring report across 2,760 federal projects
                  identified 92 projects worth ₦15.07bn fraudulently delivered
                  via fund diversion, project relocation, or payment for
                  incomplete or substandard work, alongside 99 abandoned and 471
                  unexecuted projects <CitationRef id={1} />. Its Q2 scorecard
                  flagged ₦13.86bn released across constituency projects with no
                  visible on-site execution <CitationRef id={2} />.
                </p>
                <p className="text-xs text-slate-600 leading-relaxed">
                  <strong>Private Sector Reality:</strong> Commercial banks and
                  development finance institutions maintain lower default rates
                  (for example, Bank of Industry reports an NPL ratio below 1.5%
                  <CitationRef id={10} />) because they enforce manual credit
                  controls by employing in-house Project Monitoring Managers{" "}
                  <CitationRef id={9} /> and external Independent Project
                  Monitors (IPMs) to verify drawdowns <CitationRef id={8} />.
                  For private lenders, the primary challenge is verification
                  labor intensity, lengthy drawdown turnaround times, and lack
                  of early-warning visibility rather than a total absence of
                  monitoring.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
                <h3 className="text-sm font-bold text-slate-900">
                  2. Opaque BOQ Baselines and Manual Claim Reconciliation
                  (Validated)
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Industry documentation from the Quantity Surveyors
                  Registration Board of Nigeria (QSRBN) highlights that Nigerian
                  project contracts frequently contain large, unstandardized
                  lump-sum items with limited breakdown, making independent cost
                  verification difficult for lenders <CitationRef id={8} />.
                  Reconciling an IPC claim against physical site progress, loan
                  Conditions Precedent, and Cost-to-Complete requires intensive
                  manual cross-checking
                  <CitationGroup ids={[8, 9]} />.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
                <h3 className="text-sm font-bold text-slate-900">
                  3. Fragmented Field-to-Office Evidence Capture (Plausible /
                  Hypothesis to Validate)
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  On Nigerian construction sites, daily supervision is handled
                  by Resident Clerks of Works or Site Engineers who maintain
                  daily records of work scheduled to be covered up, material
                  deliveries, and labor logs <CitationRef id={27} />. While
                  local startups have emerged to digitize site photo updates{" "}
                  <CitationRef id={19} />, the proportion of institutional
                  project reporting conducted via WhatsApp versus paper logs
                  remains an ongoing empirical inquiry{" "}
                  <em>[Assumption: To Validate in Discovery]</em>.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
                <h3 className="text-sm font-bold text-slate-900">
                  4. The Monitor Independence and Collusion Risk (Validated)
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Legislative debates around Nigeria&apos;s proposed National
                  Independent Project Monitoring Agency (NIPMA) bill emphasize
                  that when institutions monitor themselves, conflicts of
                  interest undermine oversight <CitationRef id={7} />.
                  International case law (
                  <em>Eiger Funding v. Ridge and Partners</em>) demonstrates the
                  severe financial liability (£2.5m damages) incurred when
                  monitoring surveyors fail to maintain independence from
                  borrowers <CitationRef id={22} />.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed">
              <strong>Scope Boundaries:</strong> InSite Assurance cannot correct
              systemic public budget funding deficits (such as Nigeria&apos;s
              2025 capital budget recording 17% nine-month execution
              <CitationGroup ids={[4, 6]} />
              ), macroeconomic inflation or material price spikes cited by NIQS{" "}
              <CitationRef id={5} />, or situations where the financial approver
              is intentionally complicit <CitationRef id={7} />.
            </div>
          </section>

          {/* Section 3: Proposed Solution Overview */}
          <section
            id="solution-overview"
            className="bg-white rounded-2xl border border-slate-200/80 p-6 sm:p-8 shadow-sm scroll-mt-24 space-y-4"
          >
            <h2 className="text-xl font-bold text-slate-900 border-b border-slate-100 pb-3">
              3. Proposed Solution Overview
            </h2>
            <p className="text-xs sm:text-sm text-slate-600">
              A 3-part platform designed to make Independent Project Monitors
              and Lender Monitoring Teams faster, more rigorous, and legally
              defensible:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                <div className="text-xs font-bold text-brand-primary">
                  1. Role-Segregated Web Portal
                </div>
                <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                  Separate workspaces for Independent Monitors (baseline setup,
                  BOQ-to-tranche mapping, claim review, and report
                  certification), Lenders/Guarantors (portfolio risk map,
                  tranche approval, and audit trails), and Contractors
                  (read-only baseline, IPC claim submission, and query
                  response).
                </p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                <div className="text-xs font-bold text-brand-primary">
                  2. Configurable Field Mobile App
                </div>
                <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                  Offline-first mobile application supporting configurable
                  reporting cadences (Daily, Weekly, Bi-Weekly, or Hold-Point
                  Triggered) and tagging every submission with the
                  reporter&apos;s verified Independence Tier.
                </p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                <div className="text-xs font-bold text-brand-primary">
                  3. Integrity &amp; Reconciliation Backend
                </div>
                <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                  Performs mock-location and perceptual hash duplicate
                  screening, supports Radial and Linear Corridor geofences,
                  transcribes English and Pidgin voice notes with mandatory
                  human confirmation <CitationRef id={20} />, and computes
                  line-item Evidence Strength Ratings.
                </p>
              </div>
            </div>
          </section>

          {/* Section 4: End-to-End Project Lifecycle & Operational Flow (NEW) */}
          <section
            id="lifecycle-flow"
            className="bg-white rounded-2xl border border-slate-200/80 p-6 sm:p-8 shadow-sm scroll-mt-24 space-y-6"
          >
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-brand-primary">
                Operational Walkthrough
              </div>
              <h2 className="text-xl font-bold text-slate-900 mt-1">
                4. End-to-End Capital Project Lifecycle &amp; Operational Flow
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 mt-1 leading-relaxed">
                This walkthrough guides users through the complete lifecycle of
                a capital project, explaining what happens at each stage across
                all participating roles.
              </p>
            </div>

            <div className="space-y-4">
              {/* Step 1 */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-brand-primary">
                    Step 1: Project Registration and Geofence Definition
                  </span>
                  <span className="text-[10px] font-semibold bg-white border border-slate-200 px-2 py-0.5 rounded text-slate-600">
                    Lead / Monitor Role
                  </span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  The project is registered with facility parameters: total
                  budget, allocated loan tranches, location, and the
                  participating institutions (Financier, Monitoring Firm, Main
                  Contractor). Physical project boundaries are defined using
                  either a <strong>Linear Corridor Geofence</strong> (polyline
                  centerline with a buffer tolerance, such as ±150m for highway
                  corridors) or a <strong>Radial Site Boundary</strong> (center
                  coordinate with radius for captive power plants or
                  substations). The platform automatically generates three
                  role-specific 6-character Mobile Join Codes (<code>-INS</code>{" "}
                  for Monitor Inspectors, <code>-COW</code> for Resident Clerks
                  of Works, and <code>-CON</code> for Contractor Site
                  Engineers).
                </p>
              </div>

              {/* Step 2 */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-brand-primary">
                    Step 2: Baseline BOQ Ingestion and Visual Hold-Point Mapping
                  </span>
                  <span className="text-[10px] font-semibold bg-white border border-slate-200 px-2 py-0.5 rounded text-slate-600">
                    Independent Monitor
                  </span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  The contractual Bill of Quantities (BOQ) is uploaded in
                  spreadsheet format. The platform screens each item for
                  measurement hygiene, flagging unitemized lump-sum entries that
                  lack defined engineering quantities per BESMM4 standards{" "}
                  <CitationRef id={8} />. The Independent Monitor maps work
                  items to their corresponding disbursement tranches and
                  designates high-risk buried activities (such as foundation
                  reinforcement, culvert bedding, or sub-grade compaction) as{" "}
                  <strong>Mandatory Visual Hold-Points</strong>. Works cannot be
                  certified without pre-pour photographic evidence{" "}
                  <CitationRef id={27} />.
                </p>
              </div>

              {/* Step 3 */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-brand-primary">
                    Step 3: Provenance-Tagged Mobile Field Evidence Capture
                  </span>
                  <span className="text-[10px] font-semibold bg-white border border-slate-200 px-2 py-0.5 rounded text-slate-600">
                    Field Personnel (All Tiers)
                  </span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  On-site personnel enter their assigned join code on the mobile
                  application without requiring corporate email provisioning.
                  The mobile app operates offline in remote corridors, storing
                  captures locally in an encrypted SQLite database. Device
                  gallery uploads are blocked; live shutter presses capture
                  hardware GPS, confirm the device is physically inside the
                  corridor, calculate highway chainage (KM X+YYY), and verify
                  that mock-location spoofing is not active. Voice logs in
                  English or Nigerian Pidgin are transcribed and converted into
                  structured material quantities. The reporter completes a
                  mandatory confirmation step to sign the log before
                  synchronization.
                </p>
              </div>

              {/* Step 4 */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-brand-primary">
                    Step 4: Drawdown Claim Submission
                  </span>
                  <span className="text-[10px] font-semibold bg-white border border-slate-200 px-2 py-0.5 rounded text-slate-600">
                    Main Contractor
                  </span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  As construction milestones are reached, the Main Contractor
                  accesses their segregated portal view and submits an Interim
                  Payment Certificate (IPC) drawdown claim. The contractor
                  specifies cumulative completion percentages against active BOQ
                  line items and attaches laboratory concrete cube test results,
                  mill certificates, or delivery waybills.
                </p>
              </div>

              {/* Step 5 */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-brand-primary">
                    Step 5: Automated Cross-Examination and Smart Visit Planning
                  </span>
                  <span className="text-[10px] font-semibold bg-white border border-slate-200 px-2 py-0.5 rounded text-slate-600">
                    Reconciliation Engine
                  </span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  The reconciliation engine cross-examines contractor claims
                  against accumulated field logs and mandatory Hold-Point
                  statuses. Each claimed item receives an Evidence Strength
                  Rating (<em>Supported</em>, <em>Partially Supported</em>,{" "}
                  <em>Unsupported</em>, or <em>Contradicted</em>). The Smart
                  Visit Planner generates a prioritized inspection schedule for
                  the visiting Monitor, highlighting high-value claims that
                  currently rely solely on contractor self-reported logs.
                </p>
              </div>

              {/* Step 6 */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-brand-primary">
                    Step 6: Technical Valuation Certification and Query
                    Resolution
                  </span>
                  <span className="text-[10px] font-semibold bg-white border border-slate-200 px-2 py-0.5 rounded text-slate-600">
                    Independent Monitor
                  </span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  The licensed Independent Monitor reviews flagged line items.
                  If evidence is insufficient or contradictory, the Monitor
                  issues a formal line-item query to the contractor directly
                  from the workbench. The contractor can provide clarification
                  or submit a revised percentage claim. The Monitor adjusts
                  certified percentages to match verified physical reality,
                  computes recommended releases and holdbacks, and signs the
                  formal Valuation Certificate with their professional
                  credentials (QSRBN or COREN license).
                </p>
              </div>

              {/* Step 7 */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-brand-primary">
                    Step 7: Tranche Disbursement Decision and Ledger Sealing
                  </span>
                  <span className="text-[10px] font-semibold bg-white border border-slate-200 px-2 py-0.5 rounded text-slate-600">
                    Lender / Guarantor
                  </span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  The Lender or Guarantor Credit Committee accesses the
                  portfolio console to review the signed Valuation Report,
                  holdback amounts, and Condition Precedent compliance. The
                  Lender records the formal disbursement decision (
                  <em>Approve Full Release</em>, <em>Approve with Holdback</em>,
                  or <em>Hold</em>). Every event (baseline creation, field
                  capture, Monitor certification, and disbursement decision) is
                  sealed into an append-only SHA-256 cryptographic audit chain.
                </p>
              </div>
            </div>
          </section>

          {/* Section 5: Solution Components & User Flows by Role */}
          <section
            id="role-components"
            className="bg-white rounded-2xl border border-slate-200/80 p-6 sm:p-8 shadow-sm scroll-mt-24 space-y-5"
          >
            <h2 className="text-xl font-bold text-slate-900 border-b border-slate-100 pb-3">
              5. Solution Components &amp; User Flows by Role
            </h2>

            <div className="space-y-4">
              <div className="p-5 rounded-xl border border-slate-200 space-y-2">
                <div className="text-xs font-bold text-brand-primary">
                  ROLE 1: THE CERTIFIER
                </div>
                <h3 className="text-base font-bold text-slate-900">
                  Independent Monitor / Quantity Surveyor / Lender Monitoring
                  Manager
                </h3>
                <ul className="list-disc list-inside text-xs text-slate-600 space-y-1.5 leading-relaxed">
                  <li>
                    <strong>Project &amp; Facility Baseline Setup:</strong>{" "}
                    Configures Point Radius or Linear Corridor geofences,
                    expected reporting cadences, and flags critical BOQ items as
                    Mandatory Visual Hold Points <CitationRef id={27} />.
                  </li>
                  <li>
                    <strong>Claim-vs-Evidence Review Queue:</strong>{" "}
                    Side-by-side schedule per BOQ item comparing Budgeted Cost,
                    Contractor Claimed %, AI Evidence Strength Rating, Field
                    Proof and Reporter Independence Badge, and Monitor Certified
                    Valuation.
                  </li>
                  <li>
                    <strong>
                      Smart Visit Planner and Valuation Generator:
                    </strong>{" "}
                    Recommends which site zones require physical inspection and
                    exports signed PDF Valuation Reports.
                  </li>
                </ul>
              </div>

              <div className="p-5 rounded-xl border border-slate-200 space-y-2">
                <div className="text-xs font-bold text-brand-primary">
                  ROLE 2: THE APPROVER
                </div>
                <h3 className="text-base font-bold text-slate-900">
                  Lender / Guarantor / Credit Risk Officer
                </h3>
                <ul className="list-disc list-inside text-xs text-slate-600 space-y-1.5 leading-relaxed">
                  <li>
                    <strong>National Geospatial Portfolio Map:</strong>{" "}
                    Interactive map of Nigeria plotting all funded or guaranteed
                    projects with evidence-based status indicators (Supported,
                    Partial, or Conflict).
                  </li>
                  <li>
                    <strong>
                      Tranche Readiness Console and Immutable Ledger:
                    </strong>{" "}
                    Summarizes Condition Precedent compliance, requested versus
                    recommended amounts, holdback calculations, and SHA-256
                    hash-chained ledger events.
                  </li>
                </ul>
              </div>

              <div className="p-5 rounded-xl border border-slate-200 space-y-2">
                <div className="text-xs font-bold text-brand-primary">
                  ROLE 3: THE CLAIMANT (SEGREGATED SURFACE)
                </div>
                <h3 className="text-base font-bold text-slate-900">
                  Main Contractor / Project Sponsor
                </h3>
                <ul className="list-disc list-inside text-xs text-slate-600 space-y-1.5 leading-relaxed">
                  <li>
                    <strong>Project Baseline and Hold-Point Checklist:</strong>{" "}
                    Read-only view of approved BOQ items, tranche milestones,
                    and pre-pour inspection requirements.
                  </li>
                  <li>
                    <strong>IPC Submission and Query Response:</strong> Submits
                    cumulative completion claims per BOQ item, attaches delivery
                    waybills or cube test results, and responds to Monitor
                    line-item queries.
                  </li>
                </ul>
              </div>
            </div>
          </section>

          {/* Section 6: Competitive Landscape */}
          <section
            id="competitive-landscape"
            className="bg-white rounded-2xl border border-slate-200/80 p-6 sm:p-8 shadow-sm scroll-mt-24 space-y-4"
          >
            <h2 className="text-xl font-bold text-slate-900 border-b border-slate-100 pb-3">
              6. Competitive Landscape
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-brand-navy text-white text-[11px] uppercase tracking-wider">
                    <th className="py-3 px-4">Competitor Category</th>
                    <th className="py-3 px-4">Representative Players</th>
                    <th className="py-3 px-4">Approach &amp; Traction</th>
                    <th className="py-3 px-4">
                      Where They Fall Short in Nigeria (Our Edge)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  <tr>
                    <td className="py-3.5 px-4 font-bold text-slate-900 align-top">
                      Global Construction Loan &amp; AI Visual Tech
                    </td>
                    <td className="py-3.5 px-4 text-slate-700 align-top">
                      Built Technologies <CitationRef id={14} />, OpenSpace{" "}
                      <CitationRef id={13} />, Buildots <CitationRef id={16} />,
                      AI Clearing <CitationRef id={15} />
                    </td>
                    <td className="py-3.5 px-4 text-slate-600 align-top">
                      Built automates US draw workflows; OpenSpace uses 360°
                      cameras (deployed by Nedbank on 25 African sites{" "}
                      <CitationRef id={13} />
                      ); Buildots compares site visuals against 3D BIM; AI
                      Clearing uses drones for linear infrastructure.
                    </td>
                    <td className="py-3.5 px-4 text-slate-700 align-top">
                      <strong>1. Hardware and BIM Barriers:</strong> Require
                      360° hard-hat cameras, drones, or full BIM models.
                      <br />
                      <strong>2. No Local BOQ/IPC Nuance:</strong> Built for US
                      and European contracts; lack Nigerian Pidgin speech
                      pipelines and Naira tranche logic.
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3.5 px-4 font-bold text-slate-900 align-top">
                      DFI In-House Data Tools
                    </td>
                    <td className="py-3.5 px-4 text-slate-700 align-top">
                      AfDB RASME (KoBoToolbox / World Bank GEMS){" "}
                      <CitationRef id={17} />
                    </td>
                    <td className="py-3.5 px-4 text-slate-600 align-top">
                      Free smartphone survey tool deployed across 35+ African
                      countries and 670+ AfDB-financed projects{" "}
                      <CitationRef id={17} />.
                    </td>
                    <td className="py-3.5 px-4 text-slate-700 align-top">
                      <strong>
                        Generic Survey Forms, Not Financial Reconciliation:
                      </strong>{" "}
                      Collects basic survey inputs. Cannot parse an engineering
                      BOQ, cross-check an IPC claim line-by-line, or generate a
                      QS valuation certificate.
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3.5 px-4 font-bold text-slate-900 align-top">
                      Local Nigerian ConTech Startups
                    </td>
                    <td className="py-3.5 px-4 text-slate-700 align-top">
                      BuildTrust, Buildove, Cutstruct <CitationRef id={19} />
                    </td>
                    <td className="py-3.5 px-4 text-slate-600 align-top">
                      Owner/contractor project management, diaspora homeowner
                      monitoring, and material procurement{" "}
                      <CitationRef id={19} />.
                    </td>
                    <td className="py-3.5 px-4 text-slate-700 align-top">
                      <strong>Owner Focus vs. Institutional Finance:</strong>{" "}
                      Not architected for institutional lender drawdown
                      governance, facility Condition Precedent tracking, or
                      licensed IPM workflows.
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3.5 px-4 font-bold text-slate-900 align-top">
                      Institutional &amp; Human Incumbents
                    </td>
                    <td className="py-3.5 px-4 text-slate-700 align-top">
                      Big-4 Advisory Firms (including KPMG), QS Practices,
                      In-House Bank Monitors <CitationGroup ids={[8, 9]} />
                    </td>
                    <td className="py-3.5 px-4 text-slate-600 align-top">
                      Hold regulatory standing and institutional trust with Bank
                      Credit Committees, Guarantors, and DFIs.
                    </td>
                    <td className="py-3.5 px-4 text-slate-700 align-top">
                      <strong>Target Users and Channels:</strong> Empowering
                      these professional teams with InSite Assurance eliminates
                      manual bottlenecks and differentiates ICT-enabled
                      monitoring bids <CitationRef id={18} />.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 7: Target Customers & Pricing Model */}
          <section
            id="customers-pricing"
            className="bg-white rounded-2xl border border-slate-200/80 p-6 sm:p-8 shadow-sm scroll-mt-24 space-y-5"
          >
            <h2 className="text-xl font-bold text-slate-900 border-b border-slate-100 pb-3">
              7. Target Customers &amp; Realistic Pricing Model (NGN)
            </h2>

            <div className="space-y-3">
              <h3 className="text-sm font-bold text-slate-900">
                Priority Customer Segments
              </h3>
              <ol className="list-decimal list-inside text-xs text-slate-600 space-y-1.5 leading-relaxed">
                <li>
                  <strong>
                    Internal Advisory and Independent Monitoring Practices:
                  </strong>{" "}
                  Advisory teams (such as KPMG Infrastructure Advisory) and
                  licensed QS practices bidding on Third-Party Monitoring
                  tenders
                  <CitationGroup ids={[8, 18]} />.
                </li>
                <li>
                  <strong>
                    Infrastructure Guarantors &amp; Specialised Project
                    Financiers:
                  </strong>{" "}
                  Institutions like InfraCredit (₦400bn guarantee pipeline and
                  Construction Finance Warehouse) requiring technical
                  verification before funds are released <CitationRef id={11} />
                  .
                </li>
                <li>
                  <strong>
                    Commercial Bank Project Finance &amp; Real Estate Desks:
                  </strong>{" "}
                  Nigerian banks managing roughly ₦2.29tn in construction credit
                  and ₦10.5tn in real estate credit <CitationRef id={12} />.
                </li>
                <li>
                  <strong>
                    Large Corporate CapEx &amp; Developers on Funded Facilities
                  </strong>{" "}
                  <CitationRef id={13} />.
                </li>
                <li>
                  <strong>
                    State Project Monitoring Offices &amp; Public Oversight
                    Bodies
                  </strong>{" "}
                  <CitationGroup ids={[7, 25]} />.
                </li>
              </ol>
            </div>

            <div className="space-y-3 pt-2">
              <h3 className="text-sm font-bold text-slate-900">
                Model A: Institutional Portfolio Licenses (NGN, Indexed
                Annually){" "}
                <span className="text-[11px] font-normal text-slate-400">
                  [Assumption: To Validate]
                </span>
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 text-[11px] uppercase tracking-wider border-b border-slate-200">
                      <th className="py-2.5 px-4">Package</th>
                      <th className="py-2.5 px-4">Scope</th>
                      <th className="py-2.5 px-4">Proposed Pricing (NGN)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    <tr>
                      <td className="py-3 px-4 font-bold text-slate-900">
                        90-Day Paid Pilot
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        Up to 3 live projects; baseline setup, field app
                        deployment and custom report template
                      </td>
                      <td className="py-3 px-4 font-bold text-brand-primary">
                        ₦3,500,000 (One-time)
                      </td>
                    </tr>
                    <tr>
                      <td className="py-3 px-4 font-bold text-slate-900">
                        Lender / CapEx Starter
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        Up to 10 active projects; Portfolio Map, Reconciliation
                        Engine and Audit Trail Export
                      </td>
                      <td className="py-3 px-4 font-bold text-brand-primary">
                        ₦18,000,000 / year
                      </td>
                    </tr>
                    <tr>
                      <td className="py-3 px-4 font-bold text-slate-900">
                        Lender / Guarantor Growth
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        Up to 30 active projects; Linear Corridor Geofencing,
                        Custom Report Templates and Priority SLA
                      </td>
                      <td className="py-3 px-4 font-bold text-brand-primary">
                        ₦45,000,000 / year
                      </td>
                    </tr>
                    <tr>
                      <td className="py-3 px-4 font-bold text-slate-900">
                        Enterprise / Guarantor
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        Programme-Wide / Unlimited; Nigerian Cloud/On-Premises
                        Data Residency <CitationRef id={21} />, SSO and
                        Dedicated Support
                      </td>
                      <td className="py-3 px-4 font-bold text-brand-primary">
                        ₦65,000,000 to ₦95,000,000 / yr
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 leading-relaxed">
              <strong>Model B: Per-Project License:</strong> One-time setup of
              ₦250,000 to ₦350,000 plus monthly active monitoring of ₦175,000/mo
              (Tier S under ₦2B), ₦375,000/mo (Tier M ₦2B to ₦10B), or ₦750,000
              to ₦1,200,000/mo (Tier L over ₦10B). On a ₦5 Billion project over
              24 months, a Tier M fee plus setup totals ₦9.35 Million (roughly
              0.19% of project value, or ~6% to 18% of a typical 1% to 3% QS
              monitoring fee <CitationRef id={23} />
              ).
            </div>
          </section>

          {/* Section 8: Key Risks & Engineering Mitigations */}
          <section
            id="risks-mitigations"
            className="bg-white rounded-2xl border border-slate-200/80 p-6 sm:p-8 shadow-sm scroll-mt-24 space-y-4"
          >
            <h2 className="text-xl font-bold text-slate-900 border-b border-slate-100 pb-3">
              8. Key Risks &amp; Engineering Mitigations
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-brand-navy text-white text-[11px] uppercase tracking-wider">
                    <th className="py-3 px-4 w-1/3">Risk Factor</th>
                    <th className="py-3 px-4">
                      Operational &amp; Technical Mitigation
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  <tr>
                    <td className="py-3 px-4 font-bold text-slate-900 align-top">
                      1. Smartphone photos cannot verify buried works or
                      concrete strength
                    </td>
                    <td className="py-3 px-4 text-slate-600 align-top">
                      AI outputs an Evidence Strength Rating, never a certified
                      completion percentage. Critical buried works are flagged
                      as Mandatory Hold Points requiring pre-pour photos plus
                      laboratory concrete cube test certificates.
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-bold text-slate-900 align-top">
                      2. Professional and Legal Liability
                      <CitationGroup ids={[8, 22]} />
                    </td>
                    <td className="py-3 px-4 text-slate-600 align-top">
                      Positioned strictly as decision-support for licensed QS
                      and COREN Monitors. Reports are titled Disbursement
                      Evidence &amp; Valuation Reports and require human Monitor
                      sign-off.
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-bold text-slate-900 align-top">
                      3. Field Agent Independence and Collusion
                      <CitationGroup ids={[7, 22]} />
                    </td>
                    <td className="py-3 px-4 text-slate-600 align-top">
                      Every log carries a verified provenance badge (Monitor
                      Inspector, Independent Clerk of Works, or Contractor
                      Engineer). Contractor self-reports trigger higher scrutiny
                      in the Smart Visit Planner.
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-bold text-slate-900 align-top">
                      4. GPS Spoofing, Recycled Photos and AI Image Manipulation{" "}
                      <CitationRef id={26} />
                    </td>
                    <td className="py-3 px-4 text-slate-600 align-top">
                      Live camera capture only; 64-bit perceptual hash (pHash)
                      duplicate detection across projects; device mock-location
                      screening; SHA-256 signed capture bundles.
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-bold text-slate-900 align-top">
                      5. Nigerian Accented Speech and Pidgin Quantity Errors{" "}
                      <CitationRef id={20} />
                    </td>
                    <td className="py-3 px-4 text-slate-600 align-top">
                      Mandatory Field Confirmation Step in the mobile UI before
                      saving logs, paired with domain-prompted speech models.
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-bold text-slate-900 align-top">
                      6. Data Residency and Bank Vendor Due Diligence{" "}
                      <CitationRef id={21} />
                    </td>
                    <td className="py-3 px-4 text-slate-600 align-top">
                      Architecture supports Nigerian cloud and on-premises
                      deployment compliant with NDPA and CBN localization
                      standards.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* Right Sticky Sidebar: High-Contrast Dark Theme Matching Hero */}
        <aside className="hidden lg:block lg:col-span-3 sticky top-24">
          <div className="bg-brand-navy rounded-2xl border border-white/15 p-4 shadow-xl text-white">
            <div className="text-[11px] font-bold uppercase tracking-wider text-blue-200 px-2.5 mb-2.5">
              On This Page
            </div>
            <nav className="space-y-1">
              {SECTIONS.map((sec) => {
                const isActive = activeSectionId === sec.id;
                return (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => scrollToSection(sec.id)}
                    className={`w-full text-left px-3 py-2 rounded-xl text-xs transition ${
                      isActive
                        ? "bg-white/15 text-white font-bold shadow-sm"
                        : "text-blue-100/80 hover:text-white hover:bg-white/5 font-medium"
                    }`}
                  >
                    {sec.title}
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>
      </div>
    </PublicLayout>
  );
}
