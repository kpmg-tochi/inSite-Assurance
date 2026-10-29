# inSite Assurance: Capital Project Intelligence & Disbursement Assurance Platform (MVP)

## 1. Executive Summary

**inSite Assurance** is an AI-powered **Capital Project Governance, Site Monitoring, and Disbursement Assurance** system built for the Nigerian market. The system targets Commercial Banks, Development Finance Institutions like Bank of Industry (BOI) / African Development Bank (AfDB), State Governments, and Corporate CapEx teams.

inSite Assurance bridges the gap between **physical site progress** and **financial tranche disbursements**. It ingests project baselines (Bills of Quantities [BOQs] and schedules), captures tamper-proof daily field updates (voice notes, text, and geotagged photos) via a lightweight chat-style mobile app, and uses AI analysis to reconcile actual on-site progress against contractor payment claims (Interim Payment Certificates [IPCs]). Financiers and monitoring teams use the web dashboard to track active/ongoing projects within their portfolios in real time, detect fraud or schedule slippage, and generate audit-ready Disbursement Assurance Reports before releasing funds.

---

## 2. Problem Statement

In Nigeria's construction and infrastructure financing ecosystem, billion-Naira capital projects suffer from severe monitoring blind spots:

1. **Static, Lagging Assurance:** Financiers and project sponsors rely on monthly report documents, often compiled weeks after physical site visits. By the time discrepancies are noticed, funds may have been diverted or inflation has eroded project budgets.
2. **Unstructured Field Reporting:** Site engineers report updates via noisy WhatsApp groups or paper logs, lacking standardized mapping to BOQ line items.
3. **Spoofed Evidence & "Ghost Work":** Contractors submit Interim Payment Certificates (IPCs) claiming high completion percentages backed by unverified, recycled, or out-of-bounds site photos.
4. **Disconnected Silos:** Physical progress, material consumption (cement, rebar, diesel), and financial drawdowns live in separate spreadsheets, making real-time variance detection impossible.

---

## 3. Proposed Solution Overview

A **3-Tier Hybrid System:**

1. **Web Application:** A dual-role executive portal for **Construction Executives** (enabling project setup, baseline BOQ upload, IPC drawdown requests) and **Finance / Project Monitors** (enabling national geospatial portfolio view, AI variance inspection, tranche approval, and executive PDF report export).
2. **Field Supervisor Mobile App:** A lightweight mobile application featuring frictionless project onboarding (via a Project Join Code or Direct Join Link) and a familiar **Chat-Style Reporting UI**. At the start of each workday, field supervisors (i.e., lead on-site engineers) receive a breakdown of the expected tasks. At the end of the day, they submit a daily progress report via voice notes (English/Pidgin) or text, along with evidence photos stamped with hardware GPS coordinates and timestamps.
3. **AI Reconciliation & API Backend:** A server dedicated to orchestrating the **AI Analysis pipelines** to parse uploaded BOQs, transcribe voice notes, analyze site imagery, verify geofence compliance, and compute real-time variance flags between claimed vs. verified progress.

---

## 4. Solution Components & User Flows by Role

### A. Web Application

#### Role 1: Construction Executive (Project Sponsor / Contractor)

- **Views:**
  - **Project Portfolio & Overview:** Summary cards of active sites, schedule health, and drawdown status.
  - **Project Creation & Baseline Setup:** A form to input project data (Name, Borrower, Financier, Budget in NGN, Target Site coordinates, Geofence Radius) and upload Baseline Documents (BOQ).
  - **BOQ & Tranche Schedule Table:** Interactive view of AI-parsed Work Breakdown Structure (WBS) items grouped into Disbursement Tranches.
  - **IPC Submission Modal:** Interface to update the progression percentage as reported by the contractor across BOQ items when requesting a tranche payout
  - **Disbursement Tranche Table:** Interactive view of AI-parsed Disbursement Tranches.
- **Key Actions:**
  1. Create a project and auto-generate a unique **6-character Project Code** (e.g., `LKK-402`) and deep link (`inSiteAssurance://join/LKK-402`) to share with the site supervisor.
  2. Upload a BOQ document, which triggers AI parsing to populate "BOQ Work Item" and "Disbursement Tranche" records.
  3. Submit an Interim Payment Certificate (IPC) claim for an upcoming tranche.

#### Role 2: Finance Manager / KPMG Independent Monitor (The Approver)

- **Views:**
  - **National Geospatial Portfolio Map:** Interactive map of Nigeria plotting all funded projects with color-coded health pins:
    - `ON_TRACK (green)`: Verified progress aligns with schedule and financial drawdowns.
    - `AT_RISK (amber)`: Schedule delays, material blockers, or minor variances reported.
    - `DISCREPANCY_FLAGGED (red)`: Major gap between Contractor IPC claimed completion percentage and AI-verified field completion percentage, or geofence/metadata spoofing detected.
  - **Project Variance & Tranche Readiness Dashboard:** Side-by-side comparison table per BOQ Work Item showing:
    - `Budgeted Cost (NGN)` | `Contractor Claimed % (IPC)` | `AI-Verified % (Field)` | `Variance Status` | `Verified Photo & Voice Proof`.
  - **Field Evidence Audit Drawer:** Timeline of daily field logs showing transcribed voice notes, extracted material usage, AI vision analysis, and GPS verification badges.
  - **Disbursement Assurance Report Generator:** Clean, printable executive summary view (exportable to PDF) detailing compliance, risks, and AI-recommended holdback math.
- **Key Actions:**
  1. Inspect AI-flagged discrepancies on pending Disbursement Tranches.
  2. Drill into specific site photos and voice transcripts to verify physical completion.
  3. Approve full tranche, approve AI risk-adjusted amount (with holdback), or place tranche on hold.
  4. Export the **Disbursement Assurance Certificate PDF**.

---

### B. Field Engineer Mobile App

Designed for speed and zero training on construction sites.

- **Screen 1: Lightweight Profile Onboarding**
  - Simple first-launch screen capturing `Full Name`, `Phone Number`, and `Role/Title`.
- **Screen 2: Project Onboarding**
  - Input field for the **6-character Project Code** (e.g., `LKK-402`) or automatic handling via deep link.
  - Fetches project details, caches active BOQ tasks locally, and opens the project workspace.
- **Screen 3: Chat-Style Daily Reporting Feed (Main Interface)**
  - **System "Morning Card" (Automated/Pinned):** Displays today's expected scope of work based on active BOQ Work Item schedules (e.g., _"Today's Target Scope: [2.1] Ground Slab Curing, [2.4] Erect Structural Steel Roof Trusses"_).
  - **Interactive Composer Bar (Bottom):**
    - **Voice Note Recorder:** Tap-and-hold or toggle recording for informal updates in English or Nigerian Pidgin.
    - **Text Input:** Quick notes or checklist updates.
    - **Live Verified Camera:** Forces **live camera capture only** (no gallery picker allowed for evidence photos; optional secondary button for scanning handwritten paper checklists). Automatically grabs high-accuracy GPS coordinates (`latitude`, `longitude`, `accuracy`) and timestamp at the exact moment of shutter press.
  - **AI Assistant Reply Bubble:** Once submitted, the backend processes the payload and returns a structured confirmation card in the chat feed within seconds:
    - _"✅ Log Recorded (17:12 WAT) | 📍 GPS Verified (14m from site center)"_
    - _"📋 Extracted Summary: Ground slab curing completed. 40 bags of cement used. Blocker logged: Steel trusses delayed at fabricator."_
