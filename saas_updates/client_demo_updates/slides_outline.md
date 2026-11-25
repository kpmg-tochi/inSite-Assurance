# Slides outline: UBEC client demo

**Written:** 2026-11-25. **For:** the presenter (owner) and KPMG consultants. **Used with:** [demo_script_wave1.md](demo_script_wave1.md) (screens) and [demo_questions.md](demo_questions.md) (questions). **Sources:** [implementation_plan.md](implementation_plan.md) B.3–B.5, C5, E1, E2; the PCM text in `sources/pcm_process_design_text.txt` (page numbers below are the PCM's).

Everything on these slides is either **in the platform now** or **the design** for a later release. Say which, every time. Nothing on a slide is shown on screen as if it existed.

## Deck order

| # | Slide | When in the demo |
| :--- | :--- | :--- |
| 1 | Your process, Direct Intervention | Opening, before the first screen |
| 2 | Your process, Matching Grants | Straight after slide 1 |
| 3 | Who does what: 14 roles | When the user switcher first appears |
| 4 | Separation of duties | Optional, after slide 3 if Audit or Legal is in the room |
| 5 | Security | After the field visit |
| 6 | Why not encrypt the API payload | Only if asked, or if the IRL item comes up |
| 7 | Tamper evidence | After slide 5 |
| 8 | What's next | Closing |
| 9–10 | Questions for UBEC | Closing; keep on screen while answers are written down |

---

## Slide 1. Your process, Direct Intervention

**Title:** Direct Intervention: your project cycle, step by step, in one platform

| PCM step | Responsible (B.3 role) | Platform screen | PCM timeline |
| :--- | :--- | :--- | :--- |
| 1. Needs assessment | Director, Physical Planning (State/Zonal Physical Planning officers collect) | Needs assessment template → BoQ & work phases (import) | To Physical Planning by 30 September; ES approval by 31 October (p7–8) |
| 2. Budget and procurement planning | Director, Finance & Accounts; Director, Procurement; ES approves | Outside the platform (programme level). Later: approved list on the Needs assessment page | Costs to steering committee within 2 weeks; ES approves the plan within 1 week (p8–9) |
| 3. Procurement and award | Director, Procurement (Tender Board, BPP, FEC approve) | Setup step 2 Contract: contractor, contract sum, award dates; Documents: award and acceptance letters | Award letter within 1 week of award; acceptance within 3 days (p10) |
| 4. Kick-off meeting | Project Coordinator (UBEC State/Zonal office) | Project cycle → Kick-off & mobilisation: notice, invitees, quorum, minutes | Briefing pack within 1 week of contract execution; notice at least 1 week before; minutes signed by all (p11) |
| 5. Site mobilisation | Director, Physical Planning (letter of introduction, Resident Supervisor); Resident Supervisor checks | Documents (Letter of introduction, Supervisor assignment record, Site possession form); Milestones: "Mobilised to site"; mobilisation check visits | Letter within 1 week of kick-off; mobilise within 3 weeks; 7–10 sites per supervisor; default → Director, Legal → ES (p6, p11–12) |
| 6. Monitoring & evaluation | Resident Supervisor (weekly); M&E Officer (baseline, quarterly); Independent M&E firm (as required); Director, M&E (approves) | Monitoring: visit plan, monitoring reports, findings; field app; BoQ & work phases: verification; KPIs and alerts | Weekly supervision; quarterly M&E; reports within 1 week of the visit with geotagged photos (p12–13) |
| 7. Completion | Director, M&E with the Resident Supervisor (final evaluation); Director, Physical Planning drafts the CoC; department heads and the school sign | Completion & handover → Certificate | No handover, final payment or closure without a signed CoC (p13) |
| 8. Handover and closure | Project Coordinator (handover to the school); Director, M&E (review); Finance Officer (retention release); Internal Auditor | Completion & handover → Handover, Defects, Closure; Payments; Project closure file | Handover within 1 week of the CoC (p13); defects liability period per contract |

- Steps 3–8 run in the platform today; steps 1–2 are programme-level and arrive with the Needs assessment page (next releases).
- Every timeline in the right-hand column is a dated milestone or a rule the platform checks, not a sentence in a manual.
- The platform's unit is one contract: a project, which can cover several schools (sites).

**Speaker note:** "This is your manual, not ours. Each row is a step you wrote, the person you made responsible, and the screen where it now happens. The manual has two mobilisation anchors (3 weeks from award on p12, 3 weeks from kick-off on p6); the platform takes either, and we need you to pick one."

---

## Slide 2. Your process, Matching Grants

**Title:** Matching Grants: the same platform, the SUBEB's rules

| PCM step | Responsible (B.3 role, at the SUBEB) | Platform screen | PCM timeline |
| :--- | :--- | :--- | :--- |
| 1. Needs assessment | Director, Physical Planning (SUBEB) | Needs assessment template | State-level repository; feeds the BEAP |
| 2. BEAP | SUBEB prepares; UBEC reviews; UBEC executive management approves | Later: approved BEAP on the Needs assessment page, with the budget-mismatch flag | Draft BEAP to UBEC HQ by 15 November; revise within 5 working days of comments (p36) |
| 3. Procurement and award | Director, Procurement (SUBEB; Tender Board) | Setup step 2 Contract; Documents | Award letter within 1 week; acceptance within 3 days (p37) |
| 4. Kick-off meeting | Project Coordinator (SUBEB PRS) | Kick-off & mobilisation | Programme of works at or before kick-off; minutes approved and uploaded within 3 working days (p38) |
| 5. Site mobilisation | Director, Physical Planning (SUBEB); Resident Supervisor (SUBEB: Project Supervisor) | Milestones: "Mobilised to site"; mobilisation check visits | Mobilise within 14 calendar days of kick-off; default → Director, Legal → SUBEB Executive Chairman (p38) |
| 6. Monitoring & evaluation | Resident Supervisor (weekly); M&E Officer (SUBEB, quarterly, with UBEC Zonal/State representatives); Independent M&E firm | Monitoring; field app; KPIs and alerts | Weekly; quarterly; reports within 1 week of the visit (p38) |
| 7. Completion and handover | SUBEB issues the CoC; department heads and the school sign | Completion & handover | No handover, final payment or closure without a signed CoC; handover within 1 week of the CoC (p39) |
| 8. Post-closure evaluation | SUBEB M&E (with UBEC State representatives) | Monitoring: post-closure evaluation visit; Completion & handover → Closure | Within 2 weeks (p54) |
| 9. Archiving and audit | Internal Auditor (Audit department) | Closure checklist: audit sign-off; archive; Project closure file | Continuous (p54) |

- Same screens as Direct Intervention; the delivery model (project type) changes who decides, the deadlines and the extra steps.
- The SUBEB owns its projects and sees only its own; UBEC HQ sees all.
- Two extra steps at the end: post-closure evaluation and the audit sign-off before archiving.

**Speaker note:** "Nothing is coded twice. Matching Grants is a set of rules on the same platform: 14 days instead of 3 weeks, the Executive Chairman instead of the ES, and two closing steps. If the rules change, the setting changes, not the software."

---

## Slide 3. Who does what: 14 roles

**Title:** One role per function; the organisation decides what each person sees

| # | Role | Held in | Web / field | In the platform now |
| :--- | :--- | :--- | :--- | :--- |
| 1 | System Administrator (ICT) | UBEC HQ | Web | ✓ |
| 2 | Executive Secretary | UBEC HQ | Web | ✓ |
| 3 | SUBEB Executive Chairman | SUBEB | Web | ✓ |
| 4 | Zonal Director | Zonal office | Web | Design |
| 5 | Director, Physical Planning | UBEC HQ, SUBEB | Web | ✓ |
| 6 | Director, Monitoring & Evaluation | UBEC HQ, SUBEB | Web | Design |
| 7 | M&E Officer | HQ, zonal/state office, SUBEB | Both | ✓ |
| 8 | Project Coordinator (State office; SUBEB PRS) | State office, SUBEB | Both | Design |
| 9 | Resident Supervisor (SUBEB: Project Supervisor) | State/zonal office, SUBEB | Field | ✓ |
| 10 | Director, Procurement | UBEC HQ, SUBEB | Web | Design |
| 11 | Finance Officer | UBEC HQ, SUBEB | Web | ✓ |
| 12 | Director, Legal | UBEC HQ, SUBEB | Web | Design |
| 13 | Internal Auditor | UBEC HQ, SUBEB | Web | Design |
| 14 | Independent M&E (COREN-certified firm) | Firm | Both | ✓ |

- 8 roles are in the platform today; the other 6 are the design, to confirm with you before they are built.
- Where UBEC and a SUBEB do the same job, one role serves both; the person's organisation limits what they see.
- Not users: contractors (emails only), the school and SBMC (sign on paper, recorded by staff), LGEA Education Secretaries (invited by email), Tender Board, BPP, FEC and committees.
- The System Administrator configures the platform and signs nothing on projects.

**Speaker note:** "Today one administrator still covers Legal, Procurement and Audit behind the scenes. Tell us which of these 14 are wrong or missing (question 1). The user switcher you just saw is a demo convenience; it doesn't exist in a live installation."

---

## Slide 4. Separation of duties

**Title:** Nobody approves their own work

- A monitoring report is never approved by the person who submitted it (in the platform now).
- The person who records a handover cannot review it (in the platform now).
- Contractor default: raised by Physical Planning, reviewed by Legal, decided by the ES or the SUBEB Executive Chairman (chain in the platform now; Legal and the ES are acted by one administrator until the roles are built).
- Only Finance records payments; only Internal Audit signs the closure audit; the System Administrator holds no sign-off (design: enforced when the 14 roles are built, with tests over the default roles).

**Speaker note:** "Four eyes is not a policy we hope people follow. The platform refuses the second click."

---

## Slide 5. Security

**Title:** Security: what is there, what comes before go-live

| Topic | Today | Before go-live |
| :--- | :--- | :--- |
| Sign-in | Password, account lockout after repeated failures, every action in the audit ledger | Authenticator-app MFA for every web user (required for administrators and signatories); short sessions with idle sign-out; self-service password reset; UBEC's password policy |
| In transit | HTTPS | HTTPS only (TLS 1.2+, HSTS); the field app pins the server certificate |
| At rest | Depends on the hosting UBEC chooses | Encrypted database and file volumes; encrypted backups; the few sensitive fields (phone numbers, specimen signatures) encrypted by the application, keys in a key vault, not in the database |
| Field evidence | Every photo is taken in the app (no gallery), hashed, signed by the phone that took it, geotagged, with compass heading | – |

- Hosting, backups and who holds database access follow UBEC's hosting decision (question 28).
- Data protection: NDPA privacy notice and retention settings are planned with UBEC's DPO.

**Speaker note:** "Say plainly what is not built yet: MFA and short sessions are on the list for go-live, not in this demo."

---

## Slide 6. Why not encrypt the API payload (only if asked)

**Title:** Encrypting the request body adds little on top of HTTPS

- HTTPS already encrypts every request and response in transit; a second layer protects against nothing an attacker on the network can do.
- It hides traffic from UBEC's own web application firewall, so attacks become harder to spot, not easier.
- It adds key management to every browser and phone, a new way to break and to leak.
- Stronger, and recommended instead: certificate pinning in the field app, signed field submissions (photos are already signed by the device), column-level encryption of the few sensitive fields.

**Speaker note:** "We'd rather spend the effort where it changes the risk. If UBEC's policy requires payload encryption regardless, we'll do it; we just won't call it the main control."

---

## Slide 7. Tamper evidence

**Title:** Tamper-evident, not tamper-proof

- Honest framing: no system whose administrators control the servers is tamper-*proof*. It can be tamper-*evident*: any change made outside the platform is detected and reported, and history before the last external anchor cannot be rewritten unnoticed.
- **In the platform now:** a hash-chained audit ledger of every action, verified when the project closure file is exported; every photo hashed and device-signed; every document hashed when uploaded.

| Layer (design) | What it adds |
| :--- | :--- |
| 1. Record seals | Payments, approvals, monitoring reports, findings, CoC, handover, documents, users: each platform write stores a hash of the record; a nightly check finds any change made outside the platform |
| 2. Signed ledger | Each ledger entry signed with a key held outside the database (key vault/HSM); a database administrator can no longer forge or recompute the chain |
| 3. External anchors | Hourly, the chain head is timestamped by a trusted authority (RFC 3161) and copied to write-once storage or Internal Audit's mailbox |
| 4. Database controls | The platform's database user can only insert and read the ledger; database-level logging (pgAudit) to a server the DBA does not control |
| 5. Files | Stored documents and photos re-hashed; changed or missing files flagged |
| 6. Separation of custody | The DBA, the signing-key holder and the Internal Auditor are different people, written into the hosting runbook |

**Speaker note:** "Today, a determined database administrator could rewrite rows and recompute the chain, because the chain uses a plain hash. Layers 2 and 3 close that. Layers 3 and 4 need UBEC's hosting team (question 28). A later Integrity page shows the checks to Internal Audit and the ES."

---

## Slide 8. What's next

**Title:** What we heard, and when it lands

| Next release | What you'll see |
| :--- | :--- |
| Works the way UBEC runs projects | Projects with several schools (sites), each with its own LGA, location, progress and status; one map pin per site; new project starts from the needs assessment upload; owner and funder filled from the delivery model; contractor register with a reliability rating, inactive until its signed contract is in |
| Catches problems | Contractor flagged after repeated poor workmanship, with recorded decisions (extra visits, warning, payment hold, sent to Legal); Needs assessment page with the approved lists and a budget-mismatch red flag |
| Then | Approved list upload; payments breakdown by zone, state, LGA, contractor; visit plan calendar; address lookup |
| Before go-live | 14-role catalogue as confirmed by you; MFA and sessions; tamper evidence layers; signed paper forms with QR codes compared with the original; NDPA notice and retention; per-site visits, check-in and handover in the field app; contractor replacement; UBEC wording throughout the system, not only on screen |
| Only if you approve | Reading free-form needs assessment documents with AI (question 27); today the platform uses no AI |

- Shipped small and often: each release ends demo-ready, so you can try it between releases.

**Speaker note:** "Strike from this slide anything already shown on screen today (the demo may run after the second or third release). Source: `working_plan.md` section 2 and `next_steps/client_demo_follow_ups.md`."

---

## Slide 9. Questions for UBEC (1 of 2)

**Title:** Your answers change the platform

- **Access:** who gets access, in which of the 14 roles? How are internal and external monitors assigned (zone, state, project), and by whom? (Q1, Q3)
- **Codes:** who assigns lot numbers; do batches restart each year; is a lot always one kind of project? (Q7)
- **Progress:** how is % completion per site worked out today: engineer's estimate, BoQ valuation, milestones? Which site statuses do you use? (Q9, Q10)
- **Changes after award:** what may be edited after the kick-off, and who approves it? (Q15)
- **Contractors:** when reports keep showing poor workmanship, who decides what? (Q19, Q21)

**Speaker note:** "★ marks the founder's own questions in `demo_questions.md`; capture each answer next to its number."

## Slide 10. Questions for UBEC (2 of 2)

**Title:** Money, documents and data

- **Payments:** per project or per site? Mobilisation advance, and at what percentage? Retention and defects liability period: how much, how long? (Q22–Q24)
- **Finance views:** monthly, quarterly, by state? Which finance system would feed payments? Does the intervention year follow January–December? (Q14, Q25)
- **Documents:** which are still signed on paper? Would you accept platform-printed forms with a QR code, uploaded after signing? (Q26)
- **AI and data residency:** may AI be used at all, and may data be processed outside Nigeria under your NDPA obligations? (Q27)
- **Hosting and integrity:** who hosts, who has database access, can integrity proofs leave the server? (Q28, Q29)

**Speaker note:** "The full list has 32 questions; these are the ones that block design. Ask the rest by email after the demo."
