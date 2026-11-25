# Questions to raise with UBEC during the demo

Each answer changes something specific in the platform (right column), so capture the answer next to the question. ★ = the owner's own questions.

## 1. Access and roles

| # | Question | What the answer changes |
| :--- | :--- | :--- |
| 1 | ★ Who will have access to the platform, and in which roles? (Show the 14 roles; which have we got wrong or missed?) | Final role list and logins (`role_catalogue_migration_plan.md`) |
| 2 | Which roles work on site (field app), which only in the office (web), and which both? | Each role's surface |
| 3 | ★ How are internal and external monitors (M&E officers, COREN-certified firms) assigned to projects and sites: by zone, by state, by project? Who assigns them? | Visit assignment rules, who holds `visits:plan` |
| 4 | Is there always one Resident Supervisor per project, even with 10 sites? Can one supervisor cover projects in several states? | Site and supervisor model, the 7–10 sites guidance |
| 5 | For Matching Grants, do SUBEB staff use the same platform? Who manages SUBEB users: UBEC ICT or each SUBEB? | Organisation-level user administration |
| 6 | Do the Board, the Ministry or development partners need read-only access (dashboard, KPIs, register)? | A viewer role |

## 2. Projects, codes and the annual needs assessment

| # | Question | What the answer changes |
| :--- | :--- | :--- |
| 7 | ★ How are project codes determined? Who assigns lot numbers, do batches restart each year, and is a lot always one kind of project? | Code generation (C3) |
| 8 | Is a project always within one state? Can sites be added or removed after award? | Site rules, change control |
| 9 | Which status values do you use per site (e.g. Not started, Ongoing, Delayed, Stalled, Completed, Abandoned), and what defines each? | Site status list and alert rules |
| 10 | How is "% completion" per site worked out today: engineer's estimate, BoQ valuation, or milestones? | Progress calculation |
| 11 | What is the full list of facilities you count (the quantity columns in your register)? | Facility catalogue, register import template |
| 12 | What does the approved annual list look like (Direct Intervention approved projects; BEAPs for Matching Grants)? Who would upload it, and can we have a blank copy? | Needs assessment page and its upload template (E3) |
| 13 | Would you adopt our structured needs assessment template, or should the platform read your existing documents (which needs AI, see 27)? | Template parsing vs AI parsing (D1) |
| 14 | Which fiscal year does the intervention year follow: January–December? | Year validation, payment periods |

## 3. Changes after award

| # | Question | What the answer changes |
| :--- | :--- | :--- |
| 15 | ★ Can project settings (scope, sites, contract sum, dates, supervisor) be edited after the kick-off? Who approves a change? | Which setup sections lock after kick-off; change approval chain |
| 16 | How are variations and extensions of time handled today: who requests, who approves, is there a ceiling? | Variation / extension workflow |
| 17 | Can a contractor be replaced mid-project? How is the remaining work re-awarded? | Contractor replacement (F.5) |

## 4. Contractors

| # | Question | What the answer changes |
| :--- | :--- | :--- |
| 18 | Do you keep a contractor register? Do you record CAC RC numbers? | Contractor record, duplicate check |
| 19 | When reports keep showing poor workmanship, what happens today, and who decides (warning, withholding payment, deduction, stop-work, termination)? | Flag actions and their approvals |
| 20 | Should contractor performance be available to the Bid Evaluation Committee for future awards? | Contractor performance report |
| 21 | What counts as a bad report for you: workmanship rating, critical findings, delays? How many before you act? | Flag rule defaults |

## 5. Payments and contracts

| # | Question | What the answer changes |
| :--- | :--- | :--- |
| 22 | Are contracts paid per project or per site? How is each payment certified (valuation, certificate)? | Payment model |
| 23 | Is there a mobilisation (advance) payment, and what percentage? | Payment kinds |
| 24 | Do your contracts hold retention and a defects liability period? What percentage, how long, released how? | Retention defaults, closure rules |
| 25 | Which period views does Finance report: monthly, quarterly, by state, by programme? Which finance system would feed payments later? | Payments tab presets, ERP integration |

## 6. Documents, signatures and integrity

| # | Question | What the answer changes |
| :--- | :--- | :--- |
| 26 | Which documents are still signed on paper, and by whom? Would you accept platform-printed forms with a QR code that are uploaded back after signing? | Verified paper documents (E4) |
| 27 | ★ Will the use of AI be permitted (reading needs assessment documents; checking signed forms)? Is processing outside Nigeria acceptable under your NDPA obligations, or must data stay in-country? | AI features and their data handling |
| 28 | Where will the platform be hosted, and who will have database administrator access? Can integrity proofs be sent outside the server (a timestamping authority, a write-once store, Internal Audit's mailbox)? | Tamper evidence design (E2) |
| 29 | Is outbound internet allowed from the hosting (map lookups, timestamps, email)? | Geocoding, anchors, email engine |
| 30 | What sign-in policy applies (MFA, password rules, session length)? | Sign-in settings |

## 7. Reporting

| # | Question | What the answer changes |
| :--- | :--- | :--- |
| 31 | Which reports do you produce today (management, Board, Ministry/FEC, partners), and can we have the templates? | Report templates and scheduled reports |
| 32 | Which three numbers does the Executive Secretary look at first? | Dashboard and KPI order |
