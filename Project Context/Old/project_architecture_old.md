# inSite Assurance: Architecture and Approach

## 1. Technical Architecture & Monorepo Structure

### Tech Stack

- **Monorepo Manager:** npm workspaces or pnpm workspaces (`packages/shared`, `apps/server`, `apps/web`, `apps/mobile`).
- **Shared Types & Validation (`packages/shared`):** TypeScript interfaces + **Zod** schemas (shared across Web, Mobile, and Server for end-to-end type safety and Azure OpenAI Structured Outputs).
- **Database:** **Neon Serverless PostgreSQL** managed via **Prisma ORM**.
- **Backend (`apps/server`):** **Node.js + Express + TypeScript**.
  - **AI SDK:** `openai` (configured with `AzureOpenAI` client for `gpt-4o` chat/vision/structured-outputs and `whisper-1` audio transcription).
  - **File Uploads:** `multer` (storing media locally in `/uploads` or cloud bucket for MVP demo speed).
- **Frontend Web (`apps/web`):** **Vite + React + TypeScript**.
  - **Styling & UI:** Tailwind CSS, `shadcn/ui` components, `lucide-react` icons.
  - **Maps & Charts:** `react-leaflet` + `leaflet` (OpenStreetMap tiles—no API key friction), `recharts` for financial burn vs. physical progress curves.
  - **Data Fetching:** `@tanstack/react-query`.
- **Mobile App (`apps/mobile`):** **React Native + Expo** (Expo Router, `expo-camera`, `expo-location`, `expo-audio`, `expo-linking`, NativeWind or StyleSheet).

### Repository Directory Layout

```text
capex-assurance-mvp/
├── package.json                 # Workspace root
├── PROJECT_CONTEXT.md           # This specification file
├── packages/
│   └── shared/                  # Shared Zod schemas, DTOs, and constants
│       ├── package.json
│       └── src/
│           ├── schemas.ts       # Zod schemas for AI structured outputs & API payloads
│           └── index.ts
├── apps/
│   ├── server/                  # Express + TypeScript Backend
│   │   ├── package.json
│   │   ├── prisma/
│   │   │   ├── schema.prisma    # Neon Postgres schema
│   │   │   └── seed.ts          # Realistic Nigerian capital projects seed data
│   │   └── src/
│   │       ├── index.ts         # Express app entry & SSE/polling routes
│   │       ├── config/
│   │       │   └── azureAi.ts   # AzureOpenAI client setup (gpt-4o & whisper-1)
│   │       ├── routes/
│   │       │   ├── projects.ts  # CRUD, BOQ upload, IPC claims, Tranche approvals
│   │       │   └── fieldLogs.ts # Mobile onboarding, chat log submission, media upload
│   │       ├── services/
│   │       │   ├── aiParser.ts  # BOQ extraction & Field Log reconciliation pipelines
│   │       │   └── geoVerify.ts # Haversine distance & timestamp verification
│   │       └── utils/
│   ├── web/                     # Vite + React Executive & Finance Portal
│   │   ├── package.json
│   │   └── src/
│   │       ├── components/
│   │       │   ├── layout/      # Navbar with Role Switcher
│   │       │   ├── map/         # Nigeria Portfolio Leaflet Map
│   │       │   ├── executive/   # Project Setup, BOQ Upload, IPC Claim forms
│   │       │   └── finance/     # Variance Table, Evidence Drawer, Assurance PDF Report
│   │       ├── pages/
│   │       └── App.tsx
│   └── mobile/                  # React Native + Expo Field Engineer App
│       ├── package.json
│       ├── app.json
│       └── src/
│           ├── screens/
│           │   ├── OnboardingScreen.tsx
│           │   ├── JoinProjectScreen.tsx
│           │   └── ProjectChatScreen.tsx
│           └── components/
│               ├── LiveCameraModal.tsx
│               └── VoiceRecorderBar.tsx
```

---

## 2. Database Schema (`apps/server/prisma/schema.prisma`)

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL") // Neon Postgres connection string
}

generator client {
  provider = "prisma-client-js"
}

enum ProjectHealth {
  ON_TRACK
  AT_RISK
  DISCREPANCY_FLAGGED
}

enum TrancheStatus {
  PENDING_REVIEW
  FLAGGED
  APPROVED
  HOLD
}

// 1. PROJECTS: Overarching capital project
model Project {
  id                   String        @id @default(uuid())
  projectCode          String        @unique // 6-char code for Mobile Join (e.g., "LKK-402")
  name                 String        // e.g., "Lekki Cold-Storage Facility"
  borrowerName         String        // e.g., "AgroCold Logistics Ltd"
  financierName        String        // e.g., "Bank of Industry (BOI)"
  latitude             Float         // Target site latitude (e.g., 6.4698)
  longitude            Float         // Target site longitude (e.g., 3.5852)
  geofenceRadiusMeters Int           @default(300)
  totalBudgetNgn       Decimal       @db.Decimal(18, 2)
  disbursedAmountNgn   Decimal       @default(0) @db.Decimal(18, 2)

  healthStatus         ProjectHealth @default(ON_TRACK)
  aiExecutiveSummary   String?       @db.Text

  fieldEngineers       FieldEngineer[]
  workItems            BoqWorkItem[]
  tranches             DisbursementTranche[]
  dailyLogs            DailyFieldLog[]
  createdAt            DateTime      @default(now())
  updatedAt            DateTime      @updatedAt
}

// 2. FIELD ENGINEERS: Onboarded via the Expo mobile app
model FieldEngineer {
  id          String          @id @default(uuid())
  name        String
  phone       String          @unique
  roleTitle   String          @default("Site Supervisor")
  projectId   String?
  project     Project?        @relation(fields: [projectId], references: [id])
  dailyLogs   DailyFieldLog[]
  createdAt   DateTime        @default(now())
}

// 3. BOQ WORK ITEMS: Baseline tasks parsed from schedule/BOQ upload
model BoqWorkItem {
  id                   String               @id @default(uuid())
  projectId            String
  project              Project              @relation(fields: [projectId], references: [id], onDelete: Cascade)
  trancheId            String?
  tranche              DisbursementTranche? @relation(fields: [trancheId], references: [id])

  wbsCode              String               // e.g., "2.4"
  category             String               // e.g., "Superstructure"
  description          String               // e.g., "Supply & erect structural steel roof trusses"
  budgetedCostNgn      Decimal              @db.Decimal(18, 2)

  plannedStartDate     DateTime
  plannedEndDate       DateTime

  // Core Reconciliation Metrics
  contractorClaimedPct Float                @default(0) // Updated via IPC claim
  aiVerifiedPct        Float                @default(0) // Updated by AI from Field Logs
  varianceFlag         Boolean              @default(false) // True if (Claimed - Verified) > 15%
  varianceReason       String?              @db.Text
}

// 4. DISBURSEMENT TRANCHES: Financial drawdown milestones
model DisbursementTranche {
  id                   String        @id @default(uuid())
  projectId            String
  project              Project       @relation(fields: [projectId], references: [id], onDelete: Cascade)

  trancheNumber        Int           // e.g., 3
  title                String        // e.g., "Tranche 3: Superstructure & Roofing"
  requestedAmountNgn   Decimal       @db.Decimal(18, 2)
  recommendedAmountNgn Decimal?      @db.Decimal(18, 2) // AI risk-adjusted payout
  targetReleaseDate    DateTime
  status               TrancheStatus @default(PENDING_REVIEW)

  aiRiskReportJson     Json?         // Stores compliance check, blockers, holdback math
  workItems            BoqWorkItem[]
}

// 5. DAILY FIELD LOGS: Chat submissions from the Expo Mobile App
model DailyFieldLog {
  id                   String          @id @default(uuid())
  projectId            String
  project              Project         @relation(fields: [projectId], references: [id], onDelete: Cascade)
  engineerId           String?
  engineer             FieldEngineer?  @relation(fields: [engineerId], references: [id])

  loggedAt             DateTime        @default(now())
  rawVoiceTranscript   String?         @db.Text // Output from Azure Whisper-1
  rawTextNote          String?         @db.Text // Direct text input from chat UI

  // Structured AI Extraction
  aiStructuredSummary  String          @db.Text
  materialsUsedJson    Json?           // e.g., [{"item": "Cement", "qty": 40, "unit": "bags"}]
  reportedBlockers     String?         @db.Text
  updatedWorkItemCodes Json?           // e.g., ["2.1", "2.4"]

  mediaEvidence        MediaEvidence[]
}

// 6. MEDIA EVIDENCE: Geotagged live photos & checklist scans
model MediaEvidence {
  id                 String        @id @default(uuid())
  fieldLogId         String
  fieldLog           DailyFieldLog @relation(fields: [fieldLogId], references: [id], onDelete: Cascade)

  imageUrl           String
  mediaType          String        @default("SITE_PHOTO") // SITE_PHOTO | HANDWRITTEN_NOTE
  capturedAt         DateTime
  capturedLat        Float
  capturedLng        Float
  distanceFromSiteM  Float         // Computed via Haversine formula against Project coordinates
  isGeofenceVerified Boolean       @default(false) // True if distanceFromSiteM <= project.geofenceRadiusMeters

  aiVisionAnalysis   String?       @db.Text // GPT-4o visual assessment
  detectedStage      String?       // e.g., "SLAB_CAST_NO_ROOF_TRUSSES"
}

```

---

## 3. Core AI & Verification Pipelines (`apps/server`)

1. **Geofence & Timestamp Verification (`geoVerify.ts`):**

- Upon receiving a mobile photo upload with `capturedLat`, `capturedLng`, and `capturedAt`, calculate the Haversine distance in meters from `Project.latitude` and `Project.longitude`.
- Set `isGeofenceVerified = distanceFromSiteM <= project.geofenceRadiusMeters`.

2. **Voice Transcription Pipeline (`azureAi.ts`):**

- Pass uploaded `.m4a` / `.mp4` audio buffer from the Expo app to Azure OpenAI `whisper-1` with a system prompt hint containing Nigerian construction terminology, local names, Pidgin phrases, and the project's active `BoqWorkItem` descriptions.

3. **Multimodal Field Log & Variance Reconciliation (`aiParser.ts`):**

- Combine:

1. Active `BoqWorkItem` list (with current `contractorClaimedPct`).
2. `rawVoiceTranscript` + `rawTextNote`.
3. Uploaded site photos (passed as base64/URLs to Azure OpenAI `gpt-4o` Vision).

- Using **Zod Structured Outputs**, instruct `gpt-4o` to return:
- `aiStructuredSummary`: Clean professional engineering summary.
- `materialsUsed`: Array of `{ item, qty, unit }`.
- `reportedBlockers`: Any schedule or supply chain risks mentioned.
- `visionFindings`: Per-photo description of physical construction stage visible.
- `workItemUpdates`: Array of `{ wbsCode, newAiVerifiedPct, varianceFlag, varianceReason }`.
- `trancheRecommendation`: Updated `recommendedAmountNgn` and risk rationale if a discrepancy is detected against the contractor's IPC claim.

---

## 4. Seed Data & Demo Narrative Requirements

The `prisma/seed.ts` script must populate **3 realistic Nigerian projects** out of the box so the map and dashboards immediately look executive-ready:

1. **`LKK-402` — Lekki Cold-Storage & Logistics Hub (Lagos):**

- **Financier:** Bank of Industry (BOI) | **Budget:** ₦1,200,000,000.
- **Status:** `AT_RISK` (transitions to `DISCREPANCY_FLAGGED` during the live mobile demo).
- **Demo Scenario:** Contractor submitted an IPC for **Tranche 3 (₦180M)** claiming **80% completion on WBS 2.4 (Structural Steel Roof Trusses)**. When the user submits a live voice note + photo from the Expo app showing only the concrete floor slab and stating steel trusses are delayed, the dashboard flags the discrepancy in real time and recommends holding back **₦65M**.

2. **`OGN-108` — Sagamu Industrial Packaging Plant (Ogun State):**

- **Financier:** Access Bank Project Finance | **Budget:** ₦3,500,000,000 | **Status:** `ON_TRACK`.

3. **`ABJ-309` — Gwagwalada Solar Mini-Grid & Substation (FCT Abuja):**

- **Financier:** InfraCredit / AfDB | **Budget:** ₦850,000,000 | **Status:** `DISCREPANCY_FLAGGED` (pre-populated example of an out-of-geofence photo alert 4.8km from site).
