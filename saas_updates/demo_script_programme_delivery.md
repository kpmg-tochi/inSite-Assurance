# Demo Script: Programme Delivery (Central and Co-Funded)

**For:** presenters running the client demo of the two delivery models.
**Length:** about 45 minutes (two storylines of ~15 minutes, KPIs ~5, configuration live ~10).
**Status:** written against the Phase 16 seed and verified through the API and route tests. **Not yet rehearsed in the browser:** do one full dry run on a fresh seed before the client session, and note anything that differs here.

---

## 0. Before the demo

1. Reset and seed: from `server/`, `npm run prisma:seed`. Dates are relative to the seed day, so seed **on the demo day** (or the day before).
2. Start the API (`npm run dev` in `server/`) and the web app (`npm run dev` in `web/`). Leave scheduled jobs on: the KPI snapshot job and the deadline jobs run at start-up.
3. Copy the **beneficiary handover link** printed at the end of the seed (PRG-104). The one-time code goes to `headteacher.prg-104@example.org`. In dev the console adapter prints it in the API log.
4. Open one browser profile per persona you will switch to quickly (or use private windows).

**Logins** (password `Password123!` for all):

| Persona | Login | Used for |
| :--- | :--- | :--- |
| Programme administrator | `programme.admin@insite.ng` | Settings changes, drafts, KPI page |
| Flagship admin (Programme Authority) | `flagship.admin@insite.ng` | Central owner; second CoC signatory |
| Subsidiary admin, North | `north.admin@insite.ng` | Visibility contrast (sees North only) |
| Subsidiary admin, South | `south.admin@insite.ng` | Co-Funded owner; default case decision |
| South M&E (second signatory) | `south.me@insite.ng` | Co-Funded CoC |
| Funding authority | `programme.funder@insite.ng` | Releases Central payment milestones |
| Monitor | `programme.monitor@insite.ng` | Verifies milestones, inspections, handover review |
| M&E officer | `me.officer@insite.ng` | Supervision workload (over the site limit) |
| Resident Supervisor (mobile, provisioned) | `resident.supervisor@insite.ng` | Mobile sign-in without a join code |
| Legal officer | `legal.officer@insite.ng` | Default case review |
| Contractor (Sahel Build) | `sahel.contractor@insite.ng` | Contractor's view: shared documents, findings, defects |
| Beneficiary | Handover link from the seed log | Accepts the works on PRG-104 |

**The demo programme** ("Programme Authority (demo programme)"):

| Stage (process flow) | Central | Co-Funded |
| :--- | :--- | :--- |
| Draft, kick-off planned | PRG-101 (kick-off in 9 days, agenda filed) | PRG-201 (draft) |
| Mobilising | PRG-102 (on time, due in ~5 days) | PRG-221 (overdue, default case at the decision step) |
| Under construction, M&E | PRG-105 (ahead of schedule) | PRG-211 (weekly supervision, late visit, open finding) |
| Payment milestone | PRG-105 (milestone 2 verified, awaiting release) | – |
| Completion | PRG-104 (CoC signed once, waiting for the flagship and the beneficiary) | – |
| Liability period | PRG-103 (two open defects) | – |
| Closed | – | PRG-241 (post-closure evaluation and audit pending) |
| Archived | – | PRG-242 (closure pack built) |

---

## 1. Opening: one programme, two models (2 min)

**Login:** `programme.admin@`. **Click:** Portfolio.

**Say:** "This is one programme authority running two delivery models side by side. Central projects are owned and funded by the Programme Authority; Co-Funded ones by a regional delivery entity, itself funded by the authority. The rules for each model are configuration on a project type, not code."

**Click:** the project type filter (Central, then Co-Funded); the region filter (North, South).

---

## 2. Storyline A: Central Delivery Model (15 min)

### A1. Contract award and kick-off (process slide: Kick-off)

**Login:** `programme.admin@`. **Open:** PRG-101 (draft) → Setup → Contract step, then Kick-off.

**Say:** "Award and signing dates drive every deadline. The kick-off is set for nine days from now, so the notice is due seven days before it. The agenda is filed in the document register and goes out with the notice."

**Click:** Milestones on PRG-102 to show a held kick-off: notice sent on time, quorum met, minutes signed by the owner and the monitor.

### A2. Mobilisation (process slide: Mobilisation)

**Open:** PRG-102 → Milestones.

**Say:** "Central contracts allow 21 days from kick-off to mobilise. The contractor counts as on site the first time someone checks in inside the geofence, so nobody ticks a box. The letter of introduction and the mobilisation documents are tracked the same way."

**Show:** the mobilisation compliance panel (documents still missing, days left).

### A3. Monitoring and evaluation (process slide: M&E)

**Open:** PRG-105 → Dashboard: schedule badge (ahead), KPI card, inspections card.

**Optional mobile:** sign in on the phone as `resident.supervisor@`. **Say:** "Supervisors are provisioned: no join code, and they see all their sites at once."

### A4. Payment milestone (process slide: Payments)

**Login:** `programme.funder@`. **Open:** PRG-105 → Tranche & IPC Review.

**Say:** "Central contracts pay a fixed amount per milestone, and only when the milestone is complete. The monitor verified milestone 2 from site evidence, and the funding authority releases it."

**Click:** the pending release of Payment milestone 2 → approve in full. Point out milestone 1, released 9 days after verification (that is the payment turnaround KPI).

### A5. Completion (process slide: Completion and handover)

**Login:** `flagship.admin@`. **Open:** PRG-104 → Closure (Completion section).

**Say:** "The Certificate of Completion needs the Head of Physical Planning and the Head of M&E of the owning organisation, and then the beneficiary. The programme administrator has signed; I sign as Head of M&E."

**Click:** sign the "Head of M&E" slot. Then, as `programme.admin@`, record the beneficiary's signed paper copy (upload any PDF, attest). The last signature issues the certificate and its PDF.

**Beneficiary:** open the handover link in a private window, enter the code from the API log, accept with one snag. As `programme.monitor@`, review it on PRG-104 → Handover: the handover certificate is issued and the handover milestone is done.

### A6. Liability period (process slide: Defects liability)

**Login:** `sahel.contractor@`. **Open:** PRG-103 → Retention and defects.

**Say:** "Snags from the handover became defect tickets for the contractor. Retention is released only after the period ends and the defects are closed."

---

## 3. Storyline B: Co-Funded Delivery Model (15 min)

### B1. Ownership and visibility

**Login:** `north.admin@`, then `south.admin@`. **Click:** All Projects.

**Say:** "Each delivery entity sees only its own projects. The Programme Authority sees everything below it."

### B2. Mobilisation overdue and default (process slide: Contractor default)

**Login:** `south.admin@`. **Open:** PRG-221 → Milestones.

**Say:** "Co-Funded contracts allow 14 days. The contractor never checked in, so the milestone went overdue and a default case opened by itself. Legal has reviewed it and served notice. The decision belongs to the delivery entity's executive."

**Click:** the default case → decide (for example, a cure period of 7 days).

### B3. Supervision and inspections (process slide: M&E)

**Login:** `programme.monitor@`. **Open:** PRG-211 → Inspections.

**Show:** the approved baseline survey, the late routine visit, the major finding aimed at the contractor. Then, as `programme.admin@`, Settings → Inspections & supervisors: the M&E officer (`me.officer@`) supervises more sites than the Co-Funded limit of 2. The system warns and never blocks. As `sahel.contractor@`, the same finding is waiting for the contractor to resolve.

### B4. Closure (process slide: Closure)

**Open:** PRG-241 → Closure.

**Say:** "Closed, rated and two lessons published. Archiving waits for the post-closure evaluation two weeks after closing, and for an audit sign-off that cannot be waived."

**Open:** PRG-242 → Closure. **Say:** "This one is archived. The closure pack is one ZIP for the auditor: index, every document and certificate, valuations, inspections, the audit ledger and a check that the ledger chain is intact."

**Click:** download the closure pack.

---

## 4. Programme KPIs (5 min) (process slide: KPIs per stage)

**Login:** `programme.admin@`. **Click:** Programme KPIs.

**Say:** "The process flow defines a KPI for each stage. Here they are for everything I can see, against the targets set for each model."

**Show:**
- The period selector (this quarter by default; switch to this month).
- Mobilisation: "Contractors mobilised on time" says targets vary. Central is 90% and Co-Funded 85%, with the per-model breakdown underneath.
- Click a tile → the contributing projects. Click a project to open it.
- Filter by Co-Funded and by South.
- "Not tracked" versus 0%: filter by Co-Funded and point at payment turnaround ("no Co-Funded project has payment milestones, so it isn't counted as zero").
- Export CSV.
- Log in as `north.admin@`: the same page shows only North's project.

---

## 5. Configuration, live (10 min)

Change each setting, show the effect, and say whether it applies at once or to new projects.

| Setting | Where (as `programme.admin@`) | Change | Show | Applies |
| :--- | :--- | :--- | :--- | :--- |
| **Terminology** | Settings → Tenant Settings → Terminology | "Payment milestone" → "Stage payment" | PRG-105 → Tranche & IPC Review; mobile labels too | At once |
| **Registration policy** | Settings → Tenant Settings → Professional registration | Certifier: Optional → Required | As `programme.monitor@` (no registration on file), open the PRG-105 milestone verification form: the registration is now marked required, and the monitor cannot certify until one is on their profile. Set it back afterwards. | At once |
| **Mobilisation days** | Settings → Project types → Central → Contract rules → "Contractor mobilised on site" | 21 → 28 days | Save (new version). Create a new Central draft, set a kick-off date, and see the deadline at +28. PRG-102 keeps +21. | New projects (existing projects keep their version) |
| **CoC signatories** | Settings → Project types → Co-Funded → Closure rules | Add a third slot, e.g. "Programme Authority M&E", scope "Owning organisation or above" | Save. A new Co-Funded project's certificate shows three staff slots. | New projects |
| **KPI targets** (optional) | Settings → Project types → Co-Funded → KPI targets | Mobilised on time 85 → 95 | Programme KPIs: the Co-Funded figure turns from met to missed | At once |

**Say:** "Every rule you saw is a setting with today's behaviour as the default. When a type changes, projects already running keep the rules they started with, and that is recorded."

---

## 6. If something goes wrong

| Symptom | Cause | Fix |
| :--- | :--- | :--- |
| KPI trends show "Trend after two months of snapshots" | Snapshots missing (reset without the seed) | Re-run the seed. |
| A deadline looks a day off | Seeded the day before | Re-seed on the demo day. |
| The beneficiary code never arrives | Console email adapter | Read the code from the API log. |
| Releasing PRG-105 milestone 2 is refused | Already released in an earlier rehearsal | Re-seed. |
