# Phase 4: Field Evidence Pipeline and Mobile Sync Reliability

| | |
| :--- | :--- |
| **Status** | Not started |
| **Depends on** | Phase 2. Phase 3 recommended first (it creates the evidence provider seam); if Phase 3 has not run, create `evidenceProvider.ts` here. |
| **Unblocks** | Phases 5, 7 |
| **Read first** | [Master plan](saas_implementation_plan.md) sections 2, 3 and 6 |

---

## 1. Overview

**Objective:** connect what field staff capture to what reconciliation reads, make offline sync lossless and idempotent, and make every integrity statement in the product true or remove it.

**In scope:** one capture-to-report pipeline on the server, real media upload, server-side integrity checks, the mobile outbox, removal of fabricated data, honest verification UI on mobile and web, build profiles.

**Out of scope:** login and multi-project on mobile (Phase 5), persona-aware briefs and report approval (Phase 7), cadence (Phase 8).

---

## 2. Context for the implementing agent

**Two pipelines exist and they do not meet**
- *Pipeline A (server only, unused by the app):* `POST /evidence/extract` then `POST /evidence/:logId/confirm` in [evidence.service.ts](../server/src/modules/evidence/evidence.service.ts). Creates `FieldEvidenceLog` and `EvidenceMedia`, runs `screenCaptureIntegrity`, Whisper and AI extraction. Reconciliation reads only these rows. Mobile has client functions for it in `mobile/src/api/evidence/evidenceApi.ts` with zero callers.
- *Pipeline B (what the app does):* photos, voice notes and text go into a per-WBS chat thread ([wbsRepository.ts](../mobile/src/storage/wbsRepository.ts), [WbsChatThreadScreen.tsx](../mobile/src/screens/WbsChatThreadScreen.tsx)); at end of day the user confirms a summary and quantity ([ConfirmAiSummarySheet.tsx](../mobile/src/screens/ConfirmAiSummarySheet.tsx)) and a `WorkdayReport` is posted ([workdayReports.service.ts](../server/src/modules/workday-reports/workdayReports.service.ts)). Nothing downstream uses it for ratings.

**Mobile defects that lose or corrupt data** (all verified in code)
- Evidence item IDs are `msg-<timestamp>-<rand>`; the server schema requires UUIDs, so any report with evidence gets a 400, which the client treats as "offline" and retries forever.
- Photos are base64 data URIs stored in SQLite and posted in chat bodies, fire-and-forget, with `is_delivered` hardcoded to 1. Voice notes are sent as local `file://` paths. Nothing is uploaded to object storage except assurance images.
- If GPS fails at the shutter, coordinates `6.4698, 3.5852` and "Ch 14+200" are attached. The thread header always shows "In-Zone · Ch 14+200"; every photo shows "GPS Verified".
- Per-photo `isMocked`, accuracy and GPS are dropped; `capturedAt` is overwritten with the report time.
- Reports are sent before they are persisted; a failed insert is only logged. The staged table lacks `project_id`, `delaysOrBlockers`, `isHoldPointClaimed`. The sync loop wraps all rows in one try/catch, so one bad row blocks the rest ([syncEngine.ts](../mobile/src/storage/syncEngine.ts)).
- Submission is not idempotent: the server ignores `localReportId`, and runs an AI call before responding while the client times out at 12 seconds.
- Contractor approval never reaches the device (nothing reads assurance status from the server), `REJECTED` is unhandled, and [BacklogReviewModal.tsx](../mobile/src/screens/BacklogReviewModal.tsx) submits staged reports without checking status.
- Assurance sync marks a row synced even when the upload failed, sending local file paths as document URLs.
- The geofence pack is held in memory only; after a restart there is no geofence check. Mobile re-implements a "not linear means radial" branch in [locationService.ts](../mobile/src/services/locationService.ts) instead of the shared `verifyPointAgainstGeofence`.
- `workdayDate` is the UTC date. "Reported today" is wrong in both directions.
- Chat messages duplicate after refetch (local `msg-` ID and server UUID both kept).
- SQLite is not encrypted. Migrations are add-column-only with errors swallowed and no version.
- Face liveness: the ML path cannot load (missing peer dependency and config), so the app always uses a three-tap fallback that returns `isLive: true`, score 0.92.
- No `eas.json`; demo flag is on in `mobile/.env`; push has no config plugin, channel or tap handler; telemetry runs only while the app is open.

**Server defects in the same area**
- `derivePhotoPerceptualHash` in [integrity.ts](../server/src/utils/integrity.ts) hashes the file hash, so it cannot detect similar images. Duplicate screening looks at the latest 500 photos across all tenants. `sha256FileHash` and `deviceSignatureHash` are client-supplied and never verified.
- `confirmEvidenceLogByAgent` has no status or assurance check; a queued log from an unapproved contractor can be confirmed, and any log can be re-confirmed with new quantities.
- [whisper.service.ts](../server/src/integrations/whisper.service.ts) returns a canned transcript ("cast 12 meters… 40 bags of Dangote cement") when no key is configured or on error. `fallbackFieldExtraction` in [azure-openai.service.ts](../server/src/integrations/azure-openai.service.ts) links evidence to the first BOQ item and asserts "verified against project geofence".
- Telemetry and workday geotag verification keep the client's `isWithinGeofence` when evaluation throws, and write one audit entry per out-of-geofence ping.
- `LOCAL_DEV_SIMULATED` storage returns URLs for routes that do not exist, so uploads cannot work without S3.

**Web text that asserts unverified facts:** `LiveGeospatialMap.tsx` ("0 Mock GPS · 0 Duplicate pHash"), `PortfolioDashboardPage.tsx` ("Device Signature: Verified"), `ContractorVerificationQueue.tsx` ("Active Head-Turn Verified"), `PortfolioExecutivePage.tsx` ("100% Hardware-Sealed Geofences").

---

## 3. Decisions

**Needs owner input**

| ID | Question | Default being built |
| :--- | :--- | :--- |
| D-4.1 | Canonical evidence pipeline | Report-centric (pipeline B's user experience) on top of per-capture records (pipeline A's data model). See section 4. |
| D-4.2 | Contractor identity check | Guided three-pose selfie plus ID photo, reviewed by a human. All "liveness verified" wording and scores are removed. The data model keeps room for a real liveness result later. |
| D-4.3 | Background telemetry | Foreground only, plus a ping at every capture and report. Wording changes from "hourly telemetry" to "presence while the app is open". |

**Made here**
- Without a configured AI or speech provider, the system records "pending" and never invents content. Simulated output exists only in demo mode and is labelled.
- A capture with no GPS fix is allowed but marked "location unavailable" and can never count as in-geofence.
- The device signs captures with a per-install key; the server verifies. This replaces the unkeyed hash.

---

## 4. Target pipeline

```mermaid
flowchart LR
    Cam["Camera / recorder"] --> Local["Local file + capture row (UUID, GPS, time, mock flag, signature)"]
    Local --> Out["Outbox"]
    Out --> Up["Presign, PUT object"]
    Up --> Reg["POST /captures (idempotent)"]
    Reg --> Screen["Server: hash, pHash, signature, geofence, duplicates"]
    Local --> Rep["End-of-day report references capture IDs"]
    Rep --> Out
    Out --> Sub["POST /workday-reports (idempotent)"]
    Sub --> Gate{"Session approved?"}
    Gate -- no --> Staged["STAGED_UNVERIFIED, no AI"]
    Gate -- yes --> Conf["CONFIRMED, AI omission check queued"]
    Conf --> Prov["evidenceProvider"]
    Screen --> Prov
    Prov --> Recon["Reconciliation"]
```

- A **capture** is one photo, voice note or document with its hardware metadata. It reuses `FieldEvidenceLog` + `EvidenceMedia` (rename to `EvidenceCapture` if you prefer; data is disposable).
- A **workday report** is the human-confirmed statement (summary, quantity, unit, hold-point claim, blockers) for one WBS item and period, linking the captures that support it.
- The **evidence provider** returns, per BOQ item, confirmed reports with their captures. A capture with no confirmed report does not count as evidence. Phase 7 will add "approved" as a further condition when report approval is enabled.
- The old `extract` and `confirm` endpoints are removed. Transcript and quantity suggestion become an optional assist endpoint the summary sheet can call.

---

## 5. Schema changes

**Server**
- `FieldEvidenceLog` (capture): add `workdayReportId String?`, `locationAvailable Boolean`, `signatureVerified Boolean?`, `devicePublicKeyId String?`, `serverSha256 String?`, `transcriptionStatus String @default("NOT_APPLICABLE")` (`PENDING`, `DONE`, `FAILED`, `NOT_APPLICABLE`). `isWithinGeofence` becomes nullable. Remove fields that only served the old confirm flow if unused.
- `EvidenceMedia`: `perceptualHash` computed server-side; drop `fileUrl` (object key only, from Phase 2).
- `WorkdayReport`: add `clientReportId String @unique`, `delaysOrBlockers String?`, `reporterTimezone String`, `aiCheckStatus String` (`PENDING`, `DONE`, `SKIPPED`, `FAILED`). Convert `status` to a Prisma enum. Replace `evidenceItems Json` with the capture relation (keep a small JSON for text-only notes).
- `FieldAgentSession`: add `devicePublicKey String?`, `devicePublicKeyAlg String?`.
- `SiteTelemetryPing`: add `clientPingId String @unique`.
- `WbsChatMessage`: add `clientMessageId String? @unique`, `senderSessionId`/`senderUserId`, `captureId String?`; `mediaUrls` no longer accepts data URIs or file paths.
- `IncidentReport`: add `clientIncidentId String @unique`.
- `AuditActionType`: add `CAPTURE_REGISTERED`, `CAPTURE_FLAGGED_INTEGRITY`, `TELEMETRY_ANOMALY_SUMMARY`.

**Mobile SQLite** (versioned with `PRAGMA user_version`; a destructive rebuild is acceptable in dev)
- `outbox (id, project_id, kind, payload_json, status, attempts, next_attempt_at, last_error, created_at)`.
- `captures (id, project_id, wbs_item_id, kind, local_path, object_key, lat, lon, accuracy, is_mocked, location_available, captured_at, signature, upload_status)`.
- `project_baseline (project_id, json, updated_at)` for the geofence and BOQ pack.
- Reports, chat messages and incidents get `project_id` and client UUIDs; drop base64 columns.

---

## 6. Implementation checklist

### Step 1: Server capture and report pipeline
- [ ] Local dev storage: implement upload and file handlers for `LOCAL_DEV_SIMULATED` (disk under a git-ignored folder, same auth as the media endpoint) so the full flow works without S3.
- [ ] `POST /projects/:projectId/captures`: idempotent on `clientCaptureId` (return the existing row). Verifies the object exists, computes `serverSha256`, verifies the device signature, evaluates the geofence with `verifyPointAgainstGeofence`, runs integrity screening, writes `CAPTURE_REGISTERED` or `CAPTURE_FLAGGED_INTEGRITY`.
- [ ] Integrity screening rewrite in [integrity.ts](../server/src/utils/integrity.ts): real perceptual hash from image bytes (for example a difference hash with `sharp`); duplicate search by indexed lookup scoped to the tenant, exact on `serverSha256` and near-match on pHash within the project and across the tenant; no arbitrary 500-row window. Never trust client hashes.
- [ ] Geofence: one helper used by captures, telemetry and reports. If evaluation fails or there is no fix, store `null` and add a flag. Never keep the client's claim.
- [ ] Device key: at join (and at login in Phase 5) the device registers a public key. Captures, reports and pings are signed over a canonical string; the server verifies and stores the result. Choose a pure-JS curve library that runs in React Native and Node; confirm the choice against current library docs before adopting.
- [ ] `POST /workday-reports`: idempotent on `clientReportId`; links captures (all must belong to the session's project and reporter); assurance gate enforced server-side (`STAGED_UNVERIFIED` when the session is not approved, and no AI call); AI omission check moves out of the request path (set `aiCheckStatus = PENDING`, process after responding, then raise the query if needed).
- [ ] Staged reports are released by the server when a session is approved (in `reviewContractorVerification`), not by the client.
- [ ] Revalidation: same idempotency and ownership rules; closes the targeted query.
- [ ] Remove the `extract` and `confirm` routes and their shared schemas. Add `POST /workday-reports/suggest` (optional assist: transcript plus quantity suggestion for the summary sheet).
- [ ] Implement `evidenceProvider.ts` per section 4 (replace the Phase 3 placeholder body). Add a test that a confirmed mobile-style report with captures changes a reconciliation rating.
- [ ] Speech and AI honesty: with no provider or on failure, return `transcriptionStatus = PENDING/FAILED` and no text. Canned transcripts and the first-BOQ-item fallback only under `DEMO_MODE`, labelled "simulated". Remove "verified against project geofence" from fallback text.
- [ ] Telemetry: idempotent on `clientPingId`; `createMany`; accept batches larger than 100 by chunking; replace per-ping audit entries with one `TELEMETRY_ANOMALY_SUMMARY` per session per day per anomaly type.
- [ ] Chat: idempotent on `clientMessageId`; media by `captureId`; reject data URIs and `file://`.
- [ ] Incidents: idempotent on `clientIncidentId`.
- [ ] `/auth/me` for field sessions is the source of truth for assurance status; add a mobile notification and push on approval and rejection (exists for the notification; confirm push).

### Step 2: Mobile storage and outbox
- [ ] Enable SQLCipher for `expo-sqlite` with a key held in SecureStore (check the current Expo docs for the config-plugin option and key pragma). Remove "encrypted" wording anywhere it is not true until this lands.
- [ ] Versioned migrations; rebuild tables per section 5.
- [ ] One outbox processor: per-row try/catch, exponential backoff, a dead-letter state after N attempts with the error kept, ordering only where needed (a report waits for its captures). Auth failures pause the outbox (Phase 2 session-ended state) instead of counting as attempts.
- [ ] All IDs from `expo-crypto` `randomUUID()`.
- [ ] Persist first, then enqueue, then attempt send. A report the user confirmed must survive an app kill at any point.
- [ ] Media: write files to app storage, never base64 in SQLite or request bodies; upload through presign; delete the local file after the capture is registered and a retention window passes.
- [ ] Remove `syncEngine.ts` ad hoc loops, the three copies of the report payload builder, and the memory-only fallbacks that diverge from SQLite. If SQLite is unavailable, block capture with a clear message.
- [ ] Sync status surface: pending count, last error, dead-letter list with retry. Replace "Saved Offline" and "Incident Transmitted" toasts with the real state.

### Step 3: Mobile capture correctness
- [ ] Remove every hardcoded coordinate and chainage. No fix means `location_available = false` and a visible "Location unavailable" tag.
- [ ] Keep per-capture GPS, accuracy, mock flag and capture time through to the server.
- [ ] GPS acquisition: timeout, maximum age and accuracy thresholds as constants; show the accuracy.
- [ ] Persist the baseline pack and use the shared `verifyPointAgainstGeofence`. Delete the local branch in `locationService.ts`.
- [ ] Badges show only computed states: in geofence, outside, unknown, mock location flagged, pending upload, uploaded.
- [ ] `workdayDate` computed in the project timezone using `shared/src/utils/time.ts` (extend it to take an IANA zone).
- [ ] "Reported today" derived from reports for the current period, local plus server, not from a sticky flag or certified percentage.
- [ ] Hold-point certification text comes from the BOQ item's `holdPointInstruction`; the claim checkbox defaults to off and is shown only for hold-point items.
- [ ] Chat: merge by `clientMessageId`; real timestamps stored as ISO strings and formatted at render; own messages identified by sender session, not by `senderRole === "ENGINEER"`.
- [ ] Morning brief sync (formerly TD-P2-5): upsert briefs on sync, including in any remaining memory layer; show the brief date.

### Step 4: Mobile assurance flow
- [ ] Refresh assurance status from `/auth/me` on app foreground, on push, and on pull-to-refresh. Handle `REJECTED` with the reason and a route back to the wizard.
- [ ] Backlog modal: remove the static "Account Verified" pill and client-side release; it becomes a read-only view of staged reports that the server will release.
- [ ] Assurance upload: a row is synced only when every upload succeeded and the server accepted the keys. Use a dedicated media type for ID and selfie, not `SITE_PHOTO`.
- [ ] D-4.2: delete the dead vision-camera path and its three dependencies. Rename the component and copy to "guided selfie capture". Stop sending `isLive`, yaw and eye-probability values; send the three images and capture times. Server: stop setting `livenessScore`; `livenessPassed` stays false unless a real check exists. Web queue: remove "Active Head-Turn Verified"; label as "Selfie set (3 poses) for manual review".
- [ ] Role-driven assurance only: use `requiresIdentityAssurance` from the server, never the persona.

### Step 5: Web honesty pass
- [ ] Replace hardcoded integrity text with values computed from data, or remove it: `LiveGeospatialMap.tsx`, `PortfolioDashboardPage.tsx`, `ContractorVerificationQueue.tsx`, `PortfolioExecutivePage.tsx`.
- [ ] Evidence views show per-capture integrity results (signature verified, duplicate flags, geofence state, location unavailable).
- [ ] Zero-data states say "no data", not "100% within".

### Step 6: Build, push, telemetry
- [ ] Add `eas.json` with development, preview and production profiles; demo flag on only in a demo profile; API base URL per profile.
- [ ] Push: add the config plugin and project ID, Android channel, tap handler that routes by `actionType`; request permission in context, not on the landing screen; real app version in the token registration.
- [ ] D-4.3: keep foreground telemetry; add a ping on each capture and report; fix overlapping flush callers with a single lock; change wording in app and web.
- [ ] Remove unused dependencies (`expo-image-picker`, `@react-navigation/stack`); fix the duplicate `registerRootComponent`; add the missing `start` script; align `@types/react-native` with the installed React Native.

### Step 7: Tests
- [ ] Server: capture idempotency, signature verification pass and fail, duplicate and near-duplicate detection with real image fixtures, geofence null handling, report idempotency under a simulated client retry, assurance gate, staged release on approval, provider-unavailable returns pending.
- [ ] Mobile: unit tests for the outbox processor (ordering, backoff, dead-letter, auth pause) and the report builder, run in Node with an in-memory SQLite shim or by isolating pure logic.
- [ ] End to end (manual script in this file's appendix once written): airplane-mode capture of three photos and a voice note, confirm report, kill app, relaunch, go online; one report with four captures arrives exactly once and appears in reconciliation.

---

## 7. Definition of done

- A report submitted from the app changes an evidence rating in the web workbench.
- Killing the app at any step loses nothing the user confirmed, and retries never duplicate.
- No hardcoded coordinate, chainage or "verified" string remains in mobile or web (`grep` for `6.4698`, `14+200`, `Verified` and review each hit).
- The product claims table below is filled in with the final state.

| Claim | State after Phase 4 |
| :--- | :--- |
| Live camera only | |
| GPS at capture | |
| Mock-location flag | |
| Device signature | |
| Duplicate / similar photo detection | |
| Encrypted local storage | |
| Identity check | |

## 8. Found during implementation

_Add items here rather than expanding scope._
