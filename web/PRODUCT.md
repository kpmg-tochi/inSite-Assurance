# Product

<!-- impeccable:product-schema 1 -->

Scope: the web portal (`web/`, `@insite/web`). The Expo field app (`mobile/`) is out of scope for this record; it appears here only as the source of the evidence the portal shows.

## Platform

web

## Users

The current client is UBEC, which delivers school infrastructure under two delivery models: Direct Intervention (UBEC-led) and Matching Grants (SUBEB-led). The role table below predates the rename: read "Chief Executive" as the Executive Secretary (Direct Intervention) or the SUBEB Executive Chairman (Matching Grants). Its staff use the portal on desktop, in offices (HQ, regional and area offices, regional delivery entities). Their roles, from `saas_updates/client_flow_redesign.md` section 4:

| Role | Job in the portal |
| :--- | :--- |
| Chief Executive / Executive Secretary (Regional CE for Co-Funded) | Read the portfolio and KPIs; decide contractor default cases |
| Director Physical Planning (Programme Manager) | Owns projects: kick-off, mobilisation, escalation; signs the Certificate of Completion |
| Physical Planning / PRS officers (Project Officer) | Create projects, import the needs-assessment workbook, run the kick-off |
| Director M&E (M&E Manager) | Build the form library, plan visits, review visit submissions, verify sprints, final evaluation, lessons learned |
| M&E officers and resident supervisors | Work in the mobile app; use the web portal to view only |
| Procurement | Record the award and contract; sign the CoC and closure |
| Finance & Accounts | Record payments made outside the platform (an ERP feed comes later) |
| Legal | Receive default referrals; start termination |
| Audit | Audit sign-off on the closure file |
| ICT support (Tenant Admin) | Users, roles, organisations, the facility list |

The contractor and the beneficiary school have no login. The contractor only gets emails. The beneficiary signs on paper, and staff record the signed copy.

## Product Purpose

An online monitoring portal for construction projects, covering everything from contract award to closure. M&E officers visit sites on a schedule and fill in forms with geotagged photos. The portal tracks every deadline, sign-off and finding, and gives leadership a portfolio and KPI view.

The core model is **Scope → Facilities → Sprints → Visits → Forms**:

- Scope lines (BoQ) are tagged with facilities (Classroom, Toilet, Borehole…).
- Sprints say when each unit is built.
- Visits are scheduled per project.
- Each visit's form is assembled automatically from fixed sections, the sub-forms of the facilities active in that sprint, and the open findings to re-check.

Success right now is a convincing client demo (`saas_updates/demo_script_programme_delivery.md`) that also survives daily production use. Nothing is built for the demo alone.

## Positioning

- Each visit form is assembled from the project's own scope and sprint, then frozen, so every submission can be traced to exactly what was asked on site.
- Evidence comes from the field: geotagged, offline-captured photos and voice notes, recorded against a hash-chained audit ledger.
- The client's rules (deadlines, approval chains, closure gates, terminology) are data on project types, not custom code.
- No AI judgement anywhere: checks are deterministic form rules. This is a client requirement.

## Operating Context

- Client project cycle: needs assessment → kick-off → site mobilisation → monitoring & evaluation → completion & handover → closure. Procurement and budgeting happen outside the platform; only their outputs are recorded.
- Key artefacts:
  - the needs-assessment Excel workbook (download, fill in, preview, import);
  - the programme of works;
  - kick-off minutes;
  - the Certificate of Completion and the handover certificate (paper signatures uploaded);
  - the closure pack (ZIP).
- Visit evidence comes from M&E officers on site, in conditions that limit what they can capture: outdoors in bright sun, with weak or no connectivity, on low-end Android phones. Submissions can arrive late and in batches after an offline period, and photos may be imperfect. The portal must present that evidence honestly.
- Work is multi-tenant. Projects are visible by organisation hierarchy (HQ → regions → areas) and by assignment.
- Users with several roles are common. The UI is gated by permission, never by role name.

## Capabilities and Constraints

- Stack in place: React, Vite, Tailwind 3, React Query, React Router, lucide-react icons, Leaflet maps, sonner toasts. Contracts are shared Zod schemas from `@insite/shared`.
- Navigation is data (`web/src/navigation/navItems.ts`). Workspace: Portfolio (programme admins, `projects:view_portfolio`) or Dashboard (everyone else), and Settings. Both home pages have Overview (headline figures, map, projects table: the only way into a project), KPIs and Visits tabs. Project pages: Project overview, Kick-off & mobilisation, Sprints & scope, Visits & reports, Findings, Payments, Documents, Completion & handover, plus Audit ledger and Settings under More. Lessons learned come in each project's closeout report, not a library page.
- Project setup is a guided wizard with five steps: Project, Contract, Scope, Team & visits, Review.
- Terminology is per tenant (`useTerm()`). The client's words replace canonical labels on screen only.
- Payments happen outside the platform; the portal only records them.
- Web users cannot submit visits; only field accounts can.
- No AI provider, AI features or AI wording. The only model is Whisper, for voice-note transcription.
- Undecided: the final visual identity and how white-labelling works (see Brand Commitments).

## Brand Commitments

Decided 2026-11-24 (owner): the portal is branded for the client.

- Name on screen: **UBEC Project Monitoring Portal**. No InSite Assurance or KPMG credit anywhere in the portal.
- Client: Universal Basic Education Commission (UBEC). Assets in `web/public/client/` (`ubec-logo.png` round mark, `ubec-logo-full.png` mark with white lettering for dark backgrounds, `ubec-login.jpeg` photograph).
- Colours: UBEC deep green `#00715D`, dark green `#122F2A`, amber `#FFBF00` for accents on dark green only.
- Delivery models in the client's words: **Direct Intervention** (projects UBEC oversees) and **Matching Grants** (projects the SUBEBs, State Universal Basic Education Boards, oversee). Other terms from the client's Project Cycle Manual: UBEC HQ, State/Zonal Offices, Executive Secretary (ES), SUBEB Executive Chairman, Resident Supervisor, M&E officer, Certificate of Completion (CoC).
- Per-tenant terminology labels stay binding; wording stays plain and factual.
- "Remove unnecessary badges; simplified and approachable" (owner): plain text over pills unless the pill carries state someone acts on.

## Evidence on Hand

- Seeded demo programme with real-shaped data: two tenants, projects PRG-101 to PRG-242 at every stage. Demo logins are printed by the seed. The walkthrough is `saas_updates/demo_script_programme_delivery.md`.
- Earlier visual references: `design_reference/*.png` (auth, dashboard, map). They predate the redesign.
- No real client testimonials, usage metrics or production deployment data exist yet. Do not fabricate them.

## Product Principles

1. **Evidence over assertion.** Every status traces back to a visit, a signature or a recorded document. Never show a state the system did not compute.
2. **The client's process, as configuration.** Deadlines, approvals and gates are type data, so the UI must explain which rule applies and why.
3. **Deadlines and the next action first.** Each role should see what is due, overdue or waiting on them before anything else.
4. **Demo-ready but never demo-only.** Anything shown in the demo must hold up under daily use by a programme team.
5. **Deterministic and auditable.** No AI. Every change lands in the audit ledger.

## Accessibility & Inclusion

No formal standard has been set yet. Expect public-sector users of mixed digital confidence. Wording should be plain, with the client's own terms via terminology labels.
