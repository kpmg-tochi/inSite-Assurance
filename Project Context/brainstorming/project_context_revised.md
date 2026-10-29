# inSite Assurance: Field Evidence & Disbursement Reconciliation Platform (MVP, v2)

> **Status:** Revised 29 October 2026 after problem validation and competitor research. This is a brainstorm-level spec, not a final plan. Figures marked *(assumption)* need validation through customer interviews. Source references like [S1] point to the list at the end.

---

## 1. Executive Summary

### Value statement (one-sentence pitch)

**inSite Assurance gives Nigerian lenders and their licensed project monitors a faster, auditable way to check every contractor payment claim against tamper-resistant field evidence before funds are released.**

### Summary

**inSite Assurance** is an evidence and reconciliation layer for capital project financing in Nigeria. A field agent captures live, geotagged photos and voice or text updates through a chat-style mobile app. The platform ties that evidence to individual Bill of Quantities (BOQ) items, compares it with the contractor's Interim Payment Certificate (IPC) claim, and rates how well each claimed item is supported. The licensed monitor (a quantity surveyor or engineer) reviews the flags, makes the decision and signs off. The lender sees a portfolio view and an audit trail.

### What changed from v1

| v1 | v2 | Why |
|---|---|---|
| AI produces an "AI-verified %" of completion | AI produces an **evidence-strength rating** per BOQ item; a human certifies | Phone photos cannot reliably verify quantities, buried works or quality. Certifying drawdowns is also a regulated professional role with liability attached [S8][S22]. |
| Aimed at banks, DFIs, state governments and corporates at once | **Monitors first, then lenders and guarantors**; DFIs and BOI deprioritised | AfDB and the World Bank already run free monitoring tools, and BOI is building its own [S10][S17]. |
| Tranches auto-generated from the BOQ | Tranches and conditions precedent are **entered from the facility agreement**; AI proposes the BOQ-to-tranche mapping for the monitor to confirm | Tranches are defined in loan terms, not in BOQs [S8]. |
| Contractor and approver in one product | Contractor and monitor surfaces are **separated** | Protects independence of the monitor [S22]. |
| Geofence radius around a point | Site **corridor or chainage** option for linear projects | Roads, pipelines and transmission lines do not fit a radius. |
| "Disbursement Assurance Certificate" | **Disbursement Evidence Report** | Avoids implying that the software itself certifies. |

---

## 2. Problem Statement (validated)

Capital projects in Nigeria are financed in stages against progress claims that are slow and hard to verify independently. The research supports the problem for public projects strongly and for private lending only partly.

| Problem | Verdict | Evidence |
|---|---|---|
| **Payment without visible work** | Strongly validated (public sector) | Tracka's 2024/25 report found 92 federal projects worth ₦15.07bn fraudulently delivered, through fund diversion, relocated projects, payment for work already done, partial completion or substandard work [S1]. Its Q2 2026 scorecard flagged ₦13.86bn released with no visible work [S2]. |
| **Slow, manual verification** | Partly validated | Banks employ in-house monitoring managers who verify milestones and certify drawdowns, and independent cost monitors work on drawdown reports [S8][S9]. The gap is speed and depth, not the absence of monitoring. The claim that reports lag site visits by weeks is **unverified**. |
| **Unstructured field reporting (WhatsApp, paper)** | Unverified | Local owner-side apps exist [S19], but I found no survey or data on how field reporting is actually done. |
| **Weak, hard-to-audit evidence** | Plausible | Nigerian project documents often carry large lump sums with limited breakdowns, which complicates verification [S8]. |

### Reality checks

- **Scale is uncertain.** A widely cited "60,000+ abandoned projects" figure is described by experts as largely estimates [S3]. In Tracka's sample, roughly 3% of projects were fraudulently delivered and about 3.6% abandoned (my arithmetic on [S1]).
- **Much non-completion is a funding problem, not fraud.** The 2025 capital budget was extended a fourth time and nine-month performance was only 17% [S4]. NIQS points to unrealistic estimates and cost overruns [S5]. The Finance Ministry disputes the "abandonment" narrative [S6]. Disbursement assurance does not fix underfunding.
- **The approver can be part of the problem.** The sponsor of the proposed National Independent Project Monitoring Agency bill argues MDAs monitoring themselves enables collusion [S7]. A dashboard for a complicit approver adds little.
- **Private lenders show less visible pain.** BOI reports a non-performing loan ratio below 1.5% [S10]. I found no public data on lender losses from construction-progress fraud.

### What this product does not solve

Underfunded budgets, unrealistic estimates, poor design, and approvers who are complicit.

---

## 3. Proposed Solution Overview

A three-part system that supports, but does not replace, the licensed monitor:

1. **Monitor and lender web app.** Baseline setup, claim-versus-evidence review, draft drawdown report and portfolio view.
2. **Field evidence mobile app.** Offline-first, chat-style capture of live photos, voice notes (English and Pidgin) and text, with location and timestamp.
3. **Evidence integrity and reconciliation backend.** Integrity checks, BOQ item mapping, voice transcription, image analysis and the claim-versus-evidence engine.

**Design principle:** the software produces evidence and flags. A licensed human certifies. The lender decides.

---

## 4. Solution Components & User Flows by Role

### A. Web Application

#### Role 1: Independent Monitor (QS or engineering firm, or the lender's in-house monitoring manager)

*Primary user and the person who signs off.*

- **Views**
  - **Project baseline:** facility terms, tranche schedule and conditions precedent (entered by the monitor), BOQ, programme.
  - **BOQ and tranche mapping:** AI proposes which BOQ items feed which tranche condition. The monitor confirms or edits.
  - **Claim-versus-evidence review queue:** per BOQ item, shows `Budgeted Cost (NGN)` | `Contractor Claimed % (IPC)` | `Evidence Strength` | `Evidence Items (photos, voice, notes)` | `Monitor Decision`.
  - **Field evidence timeline:** daily logs with transcripts (editable), extracted quantities, image analysis and integrity badges.
  - **Visit planner:** recommends where a physical visit is most needed, based on weak or conflicting evidence.
  - **Disbursement Evidence Report generator:** draft report in the monitor's own format (printable PDF), including a recommended payment, any holdback and the reasons.
- **Key actions**
  1. Set up a project and generate a 6-character Project Code (for example `LKK-402`) and deep link for the field agent.
  2. Review flagged items and drill into the underlying evidence.
  3. Record a recommendation: **support**, **support with holdback**, or **hold**.
  4. Sign off and export the report.

#### Role 2: Lender or Guarantor (the decision-maker)

- **Views**
  - **Portfolio map and list:** status per project using evidence-based colours:
    - `EVIDENCE_SUPPORTED (green)`: claims are well supported by verified field evidence.
    - `EVIDENCE_PARTIAL (amber)`: gaps, delays or minor variances.
    - `EVIDENCE_CONFLICT (red)`: major gap between claimed and evidenced progress, or integrity checks failed.
  - **Tranche readiness:** conditions precedent status, monitor recommendation and open flags.
  - **Audit trail:** every claim, piece of evidence, review and sign-off with timestamps and user identity.
- **Key actions:** approve, approve with holdback, or hold, based on the monitor's recommendation. Export the audit trail.

#### Role 3: Contractor (submits claims)

- **Views:** project baseline (read-only), IPC submission by BOQ item, flags raised on their claim and a place to respond or add supporting documents.
- **Key action:** submit an IPC claim and answer queries.
- *Kept separate from monitor views to preserve independence.*

### B. Field Evidence Mobile App

Designed for speed and little training on site.

- **Screen 1: Lightweight profile.** Full name, phone number, role or title.
- **Screen 2: Project onboarding.** Enter the 6-character Project Code or use the deep link. The app fetches the project, caches active BOQ tasks and opens the workspace.
- **Screen 3: Chat-style daily reporting feed.**
  - **Morning card:** today's expected scope drawn from BOQ schedules (for example, "[2.1] Ground slab curing, [2.4] Erect structural steel roof trusses").
  - **Composer bar:**
    - **Voice note** in English or Nigerian Pidgin.
    - **Text** for quick notes.
    - **Live verified camera:** live capture only, no gallery uploads. Captures location (latitude, longitude, accuracy) and timestamp at shutter press.
  - **Offline-first behaviour:** everything queues locally and syncs when a signal returns. Capture time comes from signed device data and is rechecked against server time on sync.
  - **AI reply card with mandatory confirmation:** the app returns an extracted summary (for example, "40 bags of cement used; steel trusses delayed at fabricator") and the field agent must confirm or correct it before it is saved. This matters because speech recognition is weakest on quantities and item names [S20].
- **Who is the field agent?** Ideally appointed by the monitor or lender. If it is the contractor's own engineer, the system applies extra cross-checks (see Section 8).

### C. Backend: Evidence Integrity and Reconciliation

1. **Capture integrity:** device integrity checks, mock-location detection, signed capture bundles, tamper-evident log, server-side timestamps.
2. **Image checks:** duplicate and reuse detection across projects, screening for AI-generated or altered images [S26].
3. **Speech to text:** English and Pidgin, preferably fine-tuned on Nigerian speech, hosted locally if the customer requires it [S20][S21].
4. **BOQ parsing:** extracts items from tabular or scanned BOQs and flags lump-sum items that cannot be verified without a breakdown.
5. **Reconciliation engine:** matches evidence to BOQ items and rates each claimed item as `Supported`, `Partial`, `Unsupported` or `Contradicted`, with reasons. It does **not** output a certified percentage.
6. **Linear-project support:** chainage or corridor geofences in place of a single radius.

---

## 5. Target Customers & Pricing (NGN)

> **Pricing basis.** All prices are **assumptions to validate**. They are anchored on: (a) QS cost-monitoring fees quoted at roughly 1-3% of construction cost for a full BOQ and cost-monitoring service, from a consumer blog (low confidence) [S23]; (b) Nedbank's reported initial concern about the cost of remote-monitoring tools [S13]; (c) a rate of about ₦1,350 per US dollar, with the official rate near ₦1,346 on 29 October 2026 [S24]. Prices are in NGN with an annual review clause, because inflation was 14.63% in September 2026 and cloud and AI costs are dollar-linked [S24].

### Pricing models

**Route 1: per project (paid by a monitoring firm, or by the borrower if the lender approves)**

| Tier | Project value | Monthly fee | Approx. USD |
|---|---|---|---|
| S | under ₦2bn | ₦150,000 | $111 |
| M | ₦2bn-₦10bn | ₦350,000 | $259 |
| L | over ₦10bn or linear infrastructure | ₦750,000-₦1,200,000 | $556-$889 |
| Setup | per project | ₦250,000 one-time | $185 |

*Worked example:* a ₦5bn project over 24 months costs ₦350,000 × 24 + ₦250,000 = **₦8.65m**, about 0.17% of project value. Against a 1-3% QS fee range (₦50m-₦150m), that is roughly 6-17% of the monitoring fee.

**Route 2: portfolio licence (paid by a lender or guarantor, unlimited monitor and viewer seats)**

| Package | Scope | Annual fee | Approx. USD |
|---|---|---|---|
| Pilot | up to 3 projects, 90 days, credited against year one if converted | ₦3,000,000 | $2,222 |
| Bank Starter | up to 10 active projects, audit export | ₦18,000,000 | $13,333 |
| Bank Growth | up to 30 active projects, integrations, custom report template | ₦45,000,000 | $33,333 |
| Guarantor / Enterprise | programme-wide, local hosting option, SLA | ₦60,000,000-₦90,000,000 | $44,444-$66,667 |

*Sense check:* for a guarantor expecting around ₦400bn in new guarantees in 2026 [S11], a ₦60-90m licence is about 0.015-0.0225% of that volume.

**Rule:** a project is never billed twice. If a lender holds a portfolio licence, monitors appointed on those projects use it at no extra charge.

### Customer segments, in priority order

#### 1. Independent monitoring firms and QS practices (beachhead user and channel)
- **Why:** they hold the sign-off role and the liability. The QS regulator's own presentation frames independent cost monitoring as QS-led and calls for digital monitoring tools [S8]. A tool that makes them faster and more defensible is a help, not a threat. They are also the route into banks, DFIs and TPM engagements [S18].
- **Buyer:** managing partner or head of project monitoring.
- **Price:** Route 1 per-project tiers.
- **Risks:** thin margins, fear of being replaced, price sensitivity.

#### 2. Infrastructure guarantors and project-finance lenders (InfraCredit-type)
- **Why:** a small number of high-value buyers with structured construction-phase risk. InfraCredit plans up to ₦400bn of new guarantees in 2026, is growing its Construction Finance Warehouse, and its construction-phase staff sign off milestone certificates before disbursement [S11].
- **Buyer:** head of credit risk and portfolio management; technical lead.
- **Price:** Guarantor / Enterprise licence (₦60-90m per year), after a ₦3m pilot.
- **Risks:** few buyers, long cycles, strict vendor and data-hosting due diligence.

#### 3. Commercial banks with construction and real estate books
- **Why:** banks employ in-house project monitoring managers who certify drawdowns [S9]. Bank lending is recovering after recapitalisation, with Fitch expecting more lending in 2026 [S12]. Construction credit stood at ₦2.29tn in 2025 and real estate credit at ₦10.5tn [S12].
- **Buyer:** head of real estate or project finance and the risk or credit monitoring unit.
- **Price:** Bank Starter or Growth, after a ₦3m pilot on 2-3 live projects.
- **Risks:** in-house build, procurement cycles, vendor due diligence and data localisation rules [S21], modest construction credit per bank.

#### 4. Developers and corporate CapEx teams with lender-funded projects
- **Why:** faster, better-documented drawdown approvals. Nedbank said remote monitoring let it pay clients faster [S13].
- **Buyer:** developer CFO or project director, with lender approval of the tool.
- **Price:** Route 1 per project.
- **Risks:** borrower-paid evidence undermines independence unless the lender appoints or approves the tool and the field agent.

#### 5. State governments and public oversight bodies (later stage)
- **Why:** strongest evidence of the problem [S1][S2]. Some states already run independent monitoring offices, such as Ekiti's IPMO, and the ICPC tracks federal projects at scale [S25]. The proposed NIPMA agency signals demand [S7].
- **Buyer:** state project monitoring office or commission.
- **Price:** ₦30-60m per state programme per year (about $22,000-$44,000) *(assumption)*.
- **Risks:** capital budget performance was 17% over nine months [S4], so payment delays are likely. Procurement is slow and political, and the approver may be complicit [S7]. A donor or monitoring-firm channel may work better than selling directly.

### Not targeting now

- **AfDB and the World Bank:** AfDB's RASME, built on KoBoToolbox, covers 35+ countries and 670+ projects at no licence cost [S17], and DFIs buy monitoring as consultancy services [S18]. Reach them through monitoring firms (segment 1), not directly.
- **Bank of Industry:** it is building its own digital loan tracking and dashboards [S10]. It could be a later partner.
- **Homeowners and diaspora clients:** small tickets and already served by owner-side apps [S19].

---

## 6. Competitive Landscape

### International

| Player | Approach | Traction | Threat to inSite |
|---|---|---|---|
| **Built Technologies** (US) | Construction loan and draw management software. AI Draw Agent reconciles documents to budgets and inspections; inspector network [S14]. | Serves commercial and consumer construction lending in the US. | Low near-term. Document-centric and US-focused; no Nigerian presence found. Validates the category. |
| **OpenSpace** | 360° site capture and AI analytics. | Thousands of sites in 91+ countries. Nedbank uses it on 25 active sites across Africa, starting with clients in Kenya, Morocco and Mauritius [S13]. | **Closest precedent:** a lender using remote visual monitoring in Africa. Hardware and per-site cost are the weak points. |
| **Buildots** | AI progress tracking against BIM models. | Reported $130M raise, $297M total funding, 100+ large organisations [S16] (secondary source). | Low. Mega-project and BIM focus. |
| **AI Clearing** | Drone analytics for infrastructure progress. | $14M Series A; clients include contractors, owners and financial investors; NEOM contract [S15]. | Low to medium. Large infrastructure only, but explicitly serves lenders. |
| **CenterPoint Solutions** (US) | Geotagged photo documentation for loan monitoring. | Unclear. | Low. Shows the concept is productised abroad. |

### Development-finance substitutes

- **AfDB RASME (KoBoToolbox, World Bank GEMS):** free, in-house and widely deployed across Africa [S17]. The biggest barrier to selling to DFIs directly.
- **Third-party monitoring firms:** for example, the World Bank-financed AGILE project in Nigeria tendered for a firm to verify works across eleven states using ICT tools [S18]. These firms are customers, not only competitors.

### Local (Nigeria)

| Player | What they do | Overlap |
|---|---|---|
| **BuildTrust (SaarahBuildTech)** | Project management for owners, contractors and suppliers with milestones, budgets, GPS-validated site photos, chat and AI cost estimates [S19]. | Field capture overlaps; targets owners and contractors, not lenders. Traction unknown. |
| **Buildove** | Project management software plus a human concierge monitoring service for owners and diaspora clients [S19]. | A manual version of the thesis for a different buyer. |
| **Cutstruct** | Materials marketplace with project tracking. Funding figures conflict between sources ($620K vs $2.4M) [S19]. | Low. |
| **Other local construction startups** | One tracker lists 8 Nigerian construction startups; none found targeting lender disbursement assurance with meaningful funding. | Gap, but may also signal a hard sale. |

### Human and institutional incumbents

- **Professional monitors:** QS and engineering firms delivering independent cost monitoring, and Big-4 firms marketing project assurance to lenders.
- **Bank in-house monitoring teams** [S9].
- **Civil society and government:** Tracka (17,811+ projects tracked in eight years), ICPC tracking, state monitoring offices, and the proposed NIPMA agency [S7][S25].

*Caveat: this reflects public sources only. Stealth players may exist. I did not research Procore or Autodesk's Nigerian presence.*

---

## 7. Positioning and Edge

**Defensible if executed well**

- **Low cost, phone-only capture.** No 360 cameras, drones or BIM. Nedbank flagged cost as a concern even with OpenSpace [S13].
- **Nigeria-native field experience.** Chat-style, offline-first, English and Pidgin with confirmation of extracted quantities. Worth building, but others will copy it as speech models improve.
- **Claim-versus-evidence reconciliation at BOQ-item level** for Nigerian lenders. I found no one offering this locally.
- **Built for the licensed monitor.** Makes QS and monitoring teams faster and more defensible, so they become the channel.
- **Local compliance posture:** Nigerian hosting option and a clear audit trail [S21].

**Not defensible on its own**

- Geotagged photos (BuildTrust already advertises GPS-validated photos).
- A claim of "AI-verified" completion percentages.

**Overall view:** worth pursuing as a **narrow evidence-and-reconciliation layer for monitors, guarantors and lenders**. As a broad AI verification platform for all of Nigeria's capital projects, the evidence does not yet support it.

---

## 8. Key Risks and Design Mitigations

| Risk | Mitigation |
|---|---|
| Photos cannot verify quantities, buried works or quality | Evidence-strength rating, human certification, visit planner for weak evidence |
| Liability: software output treated as certification [S22] | Decision support only; monitor signs; "Evidence Report" wording; legal review of terms |
| Field agent is the party being monitored | Prefer monitor- or lender-appointed agents; extra cross-checks and random visit targeting when the contractor supplies the agent |
| Spoofed GPS, staged scenes, AI-generated images [S26] | Device integrity checks, signed bundles, server timestamps, duplicate and AI-image screening |
| Pidgin speech errors on quantities and item names [S20] | Mandatory confirmation step, fine-tuned local model, editable transcripts |
| Lump-sum or scanned BOQs [S8] | Flag unverifiable items; ask the monitor to confirm the mapping |
| Linear projects do not fit a geofence radius | Chainage or corridor geofences |
| Data residency and vendor due diligence [S21] | Nigerian-hosted option; avoid sending personal data offshore by default; seek legal advice |
| Contractor and monitor conflict of interest [S22] | Separate surfaces and permissions |
| Dollar-linked costs against naira pricing [S24] | NGN pricing with annual review; cost controls on AI inference |

---

## 9. MVP Scope and Validation Plan

**MVP slice:** one lender or guarantor, two or three live projects, and a ₦3m pilot covering capture, reconciliation and the draft Evidence Report.

**Pilot success measures**
- How closely the tool's flags match the monitor's own valuation.
- Time saved per drawdown cycle.
- Monitor and lender willingness to continue and pay.

**Before building, interview roughly 15-20 people:** bank project monitoring managers, QS and monitoring firms, infrastructure guarantors, state monitoring offices and contractors' site engineers.

**Questions to answer**
1. Does faster drawdown review matter more to lenders, monitors or borrowers?
2. Will monitors adopt it if it makes them faster, or resist it?
3. Who pays, and at what price?
4. Is the field agent independent enough in practice?
5. How often do recycled or spoofed photos occur in bank-financed projects?

---

## 10. Open Questions and Unverified Assumptions

- How stale lender reports really are, and how field reporting is actually done on site.
- Prevalence of photo fraud in privately financed projects.
- Willingness to pay, procurement cycles and the real fee levels monitors charge lenders. All prices in Section 5 are assumptions.
- Traction of local competitors.
- Network coverage and GPS behaviour at typical sites (not researched).
- Legal position on certification and on hosting data offshore (not legal advice).

---

## Sources

- [S1] Tracka 2024/25 report coverage: https://allafrica.com/stories/202602090084.html
- [S2] Tracka Q2 2026 scorecard: https://platformtimes.com.ng/constituency-projects-%E2%82%A6608-99bn-released-just-225-completed-as-tracka-flags-%E2%82%A613-86bn-gap/
- [S3] Guardian, abandoned projects: https://guardian.ng/featured/weak-oversight-fiscal-plan-leave-over-60000-public-projects-abandoned/
- [S4] Guardian, capital budget rollover: https://guardian.ng/featured/overlapping-budgets-continue-to-muddle-fiscal-space-project-delivery/
- [S5] NIQS on waste and overruns: https://www.thisdaylive.com/2026/09/01/niqs-stop-waste-cost-overruns-on-nigerias-infrastructure-projects/
- [S6] Finance Ministry statement: https://www.vanguardngr.com/2026/03/capital-projects-ongoing-not-abandoned-finance-ministry/
- [S7] NIPMA bill: https://www.primebusiness.africa/reps-push-bill-to-curb-corruption-in-federal-projects/
- [S8] QSRBN independent project cost monitoring presentation (April 2026): https://qsrbn.gov.ng/wp-content/uploads/2026/04/QSRBN_IPCM_Ogundare.pdf
- [S9] Bank internal project monitoring manager job posting: https://www.hotnigerianjobs.com/print/934809/
- [S10] BOI 2025 results: https://www.boi.ng/?p=21851 ; MyBOI portal: https://www.thisdaylive.com/2026/10/02/boi-digitises-credit-process-cuts-funding-delays-for-businesses/
- [S11] InfraCredit Q2 2026 report: https://infracredit.ng/update/wp-content/uploads/2026/08/Q2-Investor-Report_June-2026.pdf ; job posting: https://infracredit.ng/candidate/career/clean-energy-project-manager/
- [S12] Bank credit data: https://www.nigeriahousingmarket.com/news/banks-cut-lending-real-estate-credit-declines-2025 ; https://businessday.ng/?p=1133200 ; https://nairametrics.com/2026/10/19/banks-lend-more-to-traders-as-manufacturing-credit-shrinks/
- [S13] Nedbank and OpenSpace: https://www.openspace.ai/?p=10881 ; https://www.intelligentcio.com/africa/?p=52477
- [S14] Built Technologies: https://getbuilt.com/blog/construction-loan-management-software-lenders/
- [S15] AI Clearing: https://sifted.eu/articles/ai-clearing-series-a-14m
- [S16] Buildots: https://www.landbase.com/blog/fastest-growing-construction-tech-companies ; https://www.remio.ai/ko/post/buildots-funding-round-adds-130-million-as-mega-projects-test-construction-ai-ko
- [S17] AfDB RASME: https://www.ecofinagency.com/news-digital/2307-57661-african-development-bank-rolls-out-digital-oversight-for-419-million-liberia-portfolio
- [S18] World Bank AGILE third-party monitoring tender: https://projects.worldbank.org/pt/projects-operations/procurement-detail/OP00293320
- [S19] Local players: https://liners.com/buildtrust ; https://buildove.com/ ; https://tracxn.com/d/explore/construction-tech-startups-in-nigeria/__8709OMgFhoi7_EgIDzIf4UdwwRrPMSUfEmmde-kYQb8/companies
- [S20] Nigerian speech recognition: https://www.researchgate.net/publication/378429883_Evaluating_OpenAI's_Whisper_ASR_Performance_analysis_across_diverse_accents_and_speaker_traits ; https://arxiv.org/pdf/2608.22872 ; https://dev.to/nadinev/whisper-keeps-correcting-nigerian-speech-heres-how-i-measured-it-4f4j (single-developer benchmark, not peer-reviewed)
- [S21] Data localisation: https://www.mondaq.com/nigeria/financial-services/1823206/the-central-bank-of-nigerias-localisation-directive-data-protection-compliance-implications-for-financial-institutions-and-participants-in-nigerias-payments-ecosystem ; https://chambers.com/articles/data-localisation-in-nigeria-separating-myth-from-reality
- [S22] Monitoring surveyor liability (UK): https://www.mondaq.com/uk/real-estate/1776894/eiger-funding-pcc-ltd-v-ridge-and-partners-llp-a-cautionary-tale-for-monitoring-surveyors-and-lenders
- [S23] QS fee range (consumer blog, low confidence): https://ownkey.com/ng/blog/quantity-surveyor-nigeria-guide
- [S24] Exchange rate: https://www.opinionnigeria.com/dollar-to-naira-exchange-rate-today-october-29-2026/ ; inflation: https://www.legit.ng/business-economy/money/1736488-naira-exchange-rate-cbn-releases-dollar-pound-euro-rates/
- [S25] ICPC tracking: https://www.nigeriahousingmarket.com/news/icpc-tracks-21tn-works-projects-anti-corruption ; Ekiti IPMO: https://ekitistate.gov.ng/?p=28210
- [S26] AI-generated image fraud: https://www.sas.com/en_us/news/press-releases/2026/may/synthetic-images-ai-insurance-fraud.html
