This plan is for an internal dry run, presented as if the client were watching.

It follows the process flow from mobilisation to payment. Every step uses data that's already seeded. I took project codes, logins and routes from the seed and router code but haven't clicked them myself, so check each step against your agent's click-through results before you go.

**Before you start:** run the branch `demo-client-branding` and seed with the UBEC profile: `cd server && npm run prisma:seed:ubec`. Every login uses `Password123!`. The programme tenant is "Universal Basic Education Commission (UBEC)". Its delivery entities are **Kano State SUBEB** (`north.admin@`, region North West → Kano) and **Lagos State SUBEB** (`south.admin@`, region South West → Lagos). Its funder term is "Funding authority". Re-seeding signs everyone out, including the phone.

## Opening (1 min)

**Say:** "Your process flow has two delivery models: Direct Intervention and Matching Grounds. They share one platform and one set of controls. Each model's rules are configuration, not separate builds. Today we follow a project from mobilisation to payment and show how each control in your flow is enforced and evidenced."

## 1. One programme, two models (3 min)
**Login:** `programme.admin@insite.ng`

| Click | Say |
| :--- | :--- |
| Portfolio (`/app/portfolio`), then filter by project type, then region (North West → Kano), then owning organisation | "UBEC sees the whole programme. Filter by model, region or delivery entity. Each project carries an on-schedule or behind badge." |
| Settings → Project types: open **Direct Intervention Delivery Model**, then **Matching Grounds Delivery Model** | "Direct Intervention is owned and funded by UBEC. Matching Grounds is owned by the relevant SUBEB regional entity and funded through it. The owner, funder, reporting cadence and approval chain all come from the type, so a third model is configuration, not code." |
| Settings → Organisations: Universal Basic Education Commission (UBEC) → Kano State SUBEB and Lagos State SUBEB | "This mirrors your structure: UBEC and the SUBEBs." |

## 2. Each entity sees only its own projects (2 min)
**Login:** `north.admin@insite.ng`

| Click | Say |
| :--- | :--- |
| Projects list (shows only PRG-211) | "The Kano SUBEB sees its own projects. It doesn't see Lagos projects or the Direct Intervention projects. Same platform, separated by organisation." |
| (Optional) Approval chain on PRG-211 | "Approval steps can require the project owner, the owner's parent or the funder. Matching Grounds approvals stay with the SUBEBs, and escalate to UBEC only where your flow says so." |

## 3. Setting up a project (2 min)
**Login:** `programme.admin@insite.ng`, draft **PRG-201**

| Click | Say |
| :--- | :--- |
| Setup → Basics (type already applied), Parties (owner, funder, beneficiary school), Reporting (streams) | "Choosing the model pre-fills owner, funder and reporting rules. Required parties and the beneficiary are enforced before go-live. That's the handover from procurement into delivery." |

## 4. Supervision and M&E: the core of the flow (5 min)
**Login:** `me.officer@insite.ng` (M&E officer; sees PRG-102, PRG-211 and PRG-221, and is the supervisor over the site limit), project **PRG-211**. `programme.monitor@insite.ng` also sees all three.

| Click | Say |
| :--- | :--- |
| Project → Reporting / streams | "Three separate obligations, matching your flow: weekly resident supervision, weekly contractor progress and quarterly M&E visits. Each has its own due dates and overdue tracking." |
| Inspections (`/projects/:id/inspections`): the approved **baseline survey** | "The baseline is captured on site against a standard checklist before works progress. It's GPS-tagged, timestamped and photographed." |
| The **late routine visit** | "Late visits are flagged automatically, not discovered at quarter end." |
| The visit with the **major finding**, then the finding raised against the contractor | "A failed checklist item becomes a finding assigned to the contractor and tracked until it's resolved. Nothing gets lost in a PDF." |
| Switch to **PRG-221**: the missed quarterly visit | "This visit never happened, and the platform says so." |
| Team step / workload notice | "Supervisor workload: we warn when a supervisor has too many sites, or sites too far apart." |

**If you have a device:** show `InspectionScreen` on the phone for 60 seconds, with the offline draft and photos. If you don't, say that capture is offline-first on mobile and show the result on the web.

## 5. Evidence to payment (4 min)
**Login:** `programme.admin@insite.ng` or `programme.funder@insite.ng`, project **PRG-102**

| Click | Say |
| :--- | :--- |
| Facility / tranches: three fixed payment milestones (30 / 40 / …) | "Payment is by milestone, as in your flow. A fixed amount is released on completion, not a re-measured valuation." |
| A milestone: mapped BOQ items and completion rule (no condition precedent is seeded on PRG-102, so don't mention one) | "The milestone pays only when the mapped work is verified complete from field evidence. The amount is computed by the server and can't be typed in." |
| Verification / approval chain (`/reconciliation`) | "Verification, review and release are separate people: segregation of duties is enforced. Registration numbers are required, optional or hidden, set per tenant or model." |
| Audit (`/projects/:id/audit`) | "Every action is in a tamper-evident, hash-chained ledger. The audit trail is a by-product of doing the work." |

## 6. Configurable to your terminology (1 min)
**Login:** `programme.admin@insite.ng`

| Click | Say |
| :--- | :--- |
| Tenant settings → Terminology: change "Funding authority" to "Funding agency" (or similar), then reload a project. Change it back afterwards. | "Your words, not ours. Labels, branding and registration rules are all settings." |

Only do this live if the click-through confirms it works.

## 7. Close and roadmap (2 min)

**Say:** "Handover, retention and defects are already in the platform. Next, completing the flow end to end:
- **Kick-off and mobilisation:** kick-off date, a mobilisation deadline measured from kick-off, a document register, contractor default cases.
- **Completion and closure:** Certificate of Completion signatures, closure checklist, contractor ratings, lessons learned.
- **KPI dashboard:** the KPIs your flow defines for each stage.

Each is specced against your slides."

Then ask the three open questions: milestone payments, who signs the CoC, and registration rules.

## Timing

| Segment | Min |
| :--- | :--- |
| Opening | 1 |
| 1 Programme view | 3 |
| 2 Each entity's view | 2 |
| 3 Setup | 2 |
| 4 Supervision & M&E | 5 |
| 5 Evidence to payment | 4 |
| 6 Configurability | 1 |
| 7 Roadmap | 2 |
| **Total** | **20** |

**If you're running long:** cut segment 3 first, then segment 2. Segments 4 and 5 are the core of the flow, so keep them.