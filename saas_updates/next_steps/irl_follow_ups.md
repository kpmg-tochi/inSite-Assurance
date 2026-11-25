# Next step: IRL items deferred until after the demo

**Raised:** 2026-11-25 (owner, after the IRL coverage review, `saas_updates/irl_coverage_review.md`). **Status:** not started. Not needed for the demo.

The IRL items built before the demo (register fields and filters, bulk project import, exports, early-warning alerts, photo compression and compass heading) are recorded in the review and in `CLAUDE.md`. This file holds the rest, in the order the owner wants them.

## 1. Sign-in policy (IRL output 8: "sign-in per UBEC policy")

| Item | Today | Change |
| :--- | :--- | :--- |
| MFA | None | TOTP (authenticator app) for web users, required for roles holding `roles:create_edit` or `users:invite_manage` and optional for others; enrolment on first sign-in after it is switched on; recovery codes; reset by a tenant admin (audited). Mobile accounts: device-bound sign-in already; MFA on the web only unless UBEC asks. |
| Short-lived sessions | Web JWT lives 7 days (`env.ts`, `JWT_EXPIRES_IN`) | Access token 15–30 minutes plus a refresh token (rotating, revocable, stored hashed); idle timeout per tenant (default 30 minutes on the web); the web app refreshes silently and signs out on idle. Revocation already exists through `tokenVersion`. |
| Password reset | None (admin sets a new password) | "Forgot password" by email link (single use, 30-minute expiry, rate-limited, no account enumeration), needs the email engine below. |
| Password and lockout policy | Lockout 5 failures / 15 minutes hard-coded; 10 characters on change, 8 on first set | Tenant security settings (`tenant:manage_settings`): minimum length, complexity, expiry, history, lockout threshold and duration; first password must follow the same rule and be changed at first sign-in. |
| Sign-in audit | Failed sign-ins counted; successful sign-ins not logged | Tenant-level sign-in log (success, failure, lockout, MFA events) visible in the audit ledger. |
| Rate limiting behind a proxy | In-memory per-IP limiter; no `trust proxy` | Set `trust proxy` from config so the per-IP limit uses the client address (part of the hosting work, but required before MFA goes live). |

Tests: unit tests for the policy rules; route tests for MFA enrolment and challenge, refresh rotation and revocation, idle expiry, reset link single use and expiry, lockout settings. Docs: `CLAUDE.md` (auth paragraph), `configuration_reference.md` (security settings), the demo script's Q&A line.

## 2. Email engine (IRL item 14)

| Item | Today | Change |
| :--- | :--- | :--- |
| Provider | Resend (HTTPS API) or console; SMS adapter empty | SMTP adapter (nodemailer; STARTTLS on 587; auth; connection pooling; retry through the existing message dispatch and `JobRun` claim) selected by `MESSAGING_EMAIL_PROVIDER=smtp`. |
| Sender | One global `MESSAGING_EMAIL_FROM` | Per-tenant sender name and address (tenant settings), falling back to the global one. |
| Limits | Daily caps per tenant and recipient | Keep; make them configurable and report bounces/failures in the outbox view. |
| Content | 3 templates (kick-off notice, minutes sign-off, findings summary) | Add the templates the other items need: password reset, MFA enrolment, alert digests (the alerts built before the demo are in-app and push only). |

## 3. Other IRL gaps, not scheduled yet

| Gap | IRL | Note |
| :--- | :--- | :--- |
| Hosting package (Docker image, install and upgrade guide, backups and restore, runbook, monitoring); replace outside services (Whisper, Expo push → FCM, OpenStreetMap tiles) | Output 9, items 1–2 | Owner: not needed for the demo; the final stack is not settled. If UBEC insists on the Microsoft stack (.NET, SQL Server, IIS), the platform is migrated or rebuilt, and this item changes completely. Correct the IRL's System requirements and Server costing sheets before sending them. |
| ERP / F&A integration and money against progress | Output 6, item 3 | Needs IRL 3 (systems in use). Payments already carry `source = ERP` and an external reference. |
| Report templates and scheduled reports | Output 7, item 11 | Excel exports exist now; UBEC's templates (management, Board, Ministry/FEC) and scheduled delivery need IRL 11 and the email engine. |
| Status list (Delayed, Stalled, Abandoned) as statuses with rules | Item 9 | The alerts cover delayed and stalled; a configurable status list waits for UBEC's definitions. |
| Condition reporting (Good / Fair / Poor / Dilapidated) and beneficiary reach (enrolment) | Items 10, output 4 | Needs UBEC's definitions; baseline ratings exist but aren't reported. |
| UBEC project code convention | Item 7 | Codes stay `AAA-999` for now (owner, 2026-11-25); UBEC's own ID is kept in the new "UBEC project ID" field and is searchable. Revisit when UBEC sends its convention. |
| QA "Reject" (terminal) and a QA compliance KPI | Output 3, 4 | Today: approve or return for rework. |
| Show/hide (skip) logic in forms | Item 12 | Wait for UBEC's questionnaire. |
