import crypto from "crypto";
import zlib from "zlib";
import { Prisma } from "@prisma/client";
import {
  addDays,
  formatCalendarDate,
  visitKindNoun,
  ApprovedListKind,
  budgetMismatch,
  buildLotBatchCode,
  CocSignatorySlotInput,
  contractorFlagDue,
  contractorFlagSummary,
  ContractorPerformanceSettingsSchema,
  contractorReliability,
  ContractorReliability,
  CONTRACTOR_STATUS_LABELS,
  DEFAULT_FACILITIES,
  defaultContractDefaultChain,
  deriveSiteStatus,
  DEVICE_SIGNATURE_ALGORITHM,
  FACILITY_ARCHETYPE_META,
  FacilityArchetype,
  FlagRule,
  FlagRuleReport,
  formatProjectCode,
  formatProjectCodeWithYear,
  fundingSourceText,
  lgaByCode,
  ProjectTypeConfig,
  ProjectTypeConfigSchema,
  ProjectTypeSnapshot,
  SchoolLevel,
  SITE_STATUS_LABELS,
  SiteStatus,
  stateByCode,
  VisitFormSnapshot,
  VisitKind,
  VISIT_KIND_META,
  weightedProgressPct,
  zonedCalendarDate,
  zoneOfState,
} from "@insite/shared";
import { prisma } from "../config/prisma";
import { projectObjectPrefix, storageService } from "../integrations/storage.service";
import { refreshContractorRatingSnapshots } from "../modules/contractors/contractors.service";
import { evaluateContractorFlags } from "../modules/contractorFlags/contractorFlags.service";
import { freezeVisitFormSnapshot } from "../modules/forms/visitForm.service";
import { acceptSubmission, AcceptanceOutbox } from "../modules/visits/visitAcceptance";
import { webVisitActor } from "../modules/visits/visitCore";
import { completedUnitIdsFor, freezeVisitForm, recheckInputsForProject } from "../modules/visits/visitForms";
import { WebJwtPayload } from "../middleware/auth.middleware";
import { recordAuditEvent } from "../modules/audit/audit.service";
import { signOffStatementHash } from "../modules/documents/documents.service";
import { changeProjectPhase } from "../modules/closeout/projectPhase.service";
import { recordHandoverResponse } from "../modules/closeout/handover.service";
import { draftCompletionCertificate } from "../modules/completion/completion.service";
import { recomputeMilestoneDates, syncContractMilestones } from "../modules/contracts/milestones.service";
import { snapshotTenantKpis } from "../modules/kpis/kpis.service";
import { recordPayment } from "../modules/payments/payments.service";
import { getProcessConfig, writeChainVersion } from "../modules/process/processConfig.service";
import { refreshProjectProgress } from "../modules/progress/progress.service";
import { applyProjectTypeToProject } from "../modules/projectTypes/projectTypes.service";
import { createProjectDraft, saveProjectSetupStep } from "../modules/projects/projectSetup.service";
import { deriveLineDatesFromSprints } from "../modules/scope/scope.service";
import { refreshScheduleBadge } from "../modules/schedule/schedule.service";
import { seedAlerts } from "./seedAlerts";
import { clearConvertedHistory, seedConvertedHistory } from "./seedNeedsPipeline";
import { needsOpenYear } from "./needsSeedSpecs";
import { KANO_SUBEB_NAME, ME_CONSULTANTS_NAME, PROGRAMME_TENANT_SLUG, UBEC_ORG_NAME } from "./seedPhase11";
import { heldKickoff, payloadFor } from "./seedPhase13";
import { approvedFinalEvaluation } from "./seedPhase15";
import {
  DPP_EMAIL,
  ES_EMAIL,
  FINANCE_EMAIL,
  INDEPENDENT_ME_EMAIL,
  KANO_ADMIN_EMAIL,
  LAGOS_ADMIN_EMAIL,
  LAGOS_ME_EMAIL,
  NEEDS_PIPELINE_GRANTS,
  RESIDENT_SUPERVISOR_EMAIL,
  UBEC_ADMIN_EMAIL,
  UBEC_ME_EMAIL,
  UBEC_ROLE,
} from "./seedUbecRoster";

/**
 * Client demo updates, wave 1: the UBEC demo overlay (`SEED_PROFILE=ubec-demo npm run prisma:seed`,
 * called last by `seedDatabase()`; tests and the default profile keep the normal seed). UBEC tenant
 * (slug `programme-authority`) only. Working plan sections 3, 7.1 and 7.3.
 *
 * 1. Roles in the client's words (section 3): "System Administrator" (was UBEC Administrator, keeps
 *    every permission and acts for Legal and Audit off-screen), "SUBEB Executive Chairman" (was SUBEB
 *    Administrator), "M&E Officer" / "M&E Officer (SUBEB)", "Independent M&E (COREN-certified firm)";
 *    new roles and logins Executive Secretary (es@), Director, Physical Planning (dpp@), Finance Officer
 *    (finance@), all UBEC HQ, web only; plus sokoto.admin@ (SUBEB Executive Chairman, Sokoto SUBEB),
 *    because PRG-221's default case now waits for the Sokoto chairman (its project moved to Sokoto).
 * 2. Programme types (no version bump, as Phases 13–16 do): Certificate of Completion slots
 *    "Director, Physical Planning" (Direct Intervention: role DIRECTOR_PHYSICAL_PLANNING) and "Director,
 *    Monitoring & Evaluation"; the new SUBEBs allowed as Matching Grants owners; every project's default
 *    case chain gets a new version whose decision step names the Executive Secretary (DI) or the SUBEB
 *    Executive Chairman (MG) role. The Legal step stays with the System Administrator.
 * 3. Projects (North 9 / South 9), relocated to real LGAs, re-coded `{year}-LOT-{n}-BATCH-{m}` with
 *    ProjectLot rows, renamed in UBEC style, owners re-pointed (DI: UBEC HQ; MG: the state's SUBEB):
 *
 * | #  | Code (was)                | State (zone) | LGA             | Model | Story                                                       |
 * | -- | ------------------------- | ------------ | --------------- | ----- | ----------------------------------------------------------- |
 * | 1  | 2026-LOT-1-BATCH-1 (PRG-105) | FCT (NC)  | Abuja Municipal | DI    | Demo 1, on track (work phases 1–2 verified met)             |
 * | 2  | 2026-LOT-4-BATCH-1 (PRG-211) | Kano (NW) | Dala            | MG    | Demo 2, in trouble (late report, missed visit, escalation)  |
 * | 3  | 2025-LOT-2-BATCH-1 (PRG-106) | Lagos (SW)| Mushin          | DI    | Demo 3, closing out                                         |
 * | 4  | 2025-LOT-1-BATCH-1 (PRG-103) | Lagos (SW)| Lagos Mainland  | DI    | Defects liability period, open defect, retention held       |
 * | 5  | 2025-LOT-1-BATCH-2 (PRG-104) | Lagos (SW)| Lagos Island    | DI    | CoC signed once, handover response to record                |
 * | 6  | 2026-LOT-2-BATCH-1 (PRG-101) | Kaduna (NW)| Kaduna North   | DI    | Draft, kick-off planned                                     |
 * | 7  | 2026-LOT-1-BATCH-3 (PRG-102) | Niger (NC)| Chanchaga       | DI    | Mobilising; site possession form pending                    |
 * | 8  | 2026-LOT-4-BATCH-2 (PRG-221) | Sokoto (NW)| Sokoto North   | MG    | Mobilisation overdue, default case waiting for the chairman |
 * | 9  | 2025-LOT-3-BATCH-1 (PRG-241) | Enugu (SE)| Enugu North     | MG    | Closed, audit sign-off pending                              |
 * | 10 | 2025-LOT-3-BATCH-2 (PRG-242) | Rivers (SS)| Obio/Akpor     | MG    | Closed and archived                                         |
 * | 11 | 2027-LOT-1-BATCH-1 (PRG-201) | FCT (NC)  | Bwari           | DI    | Draft with fields still to fill (was a MG draft)            |
 * | 12 | 2026-LOT-1-BATCH-2 (new)  | Delta (SS)   | Oshimili South  | DI    | Execution, on track (Asaba; the live South South project)   |
 * | 13 | 2025-LOT-2-BATCH-2 (new)  | Kano (NW)    | Nassarawa       | DI    | Imported from the register, ongoing at 45%                  |
 * | 14 | 2026-LOT-1-BATCH-4 (new)  | Kaduna (NW)  | Zaria           | DI    | Execution; final payment before the CoC (exception)         |
 * | 15 | 2026-LOT-1-BATCH-5 (new)  | Borno (NE)   | Maiduguri       | DI    | Stalled (no progress raised for 60 days)                    |
 * | 16 | 2025-LOT-3-BATCH-3 (new)  | Oyo (SW)     | Ibadan North    | MG    | Handover recorded, waiting for review (no CoC: simplified)  |
 * | 17 | 2026-LOT-4-BATCH-3 (new)  | Ogun (SW)    | Abeokuta South  | MG    | Mobilising (kick-off held 9 days ago)                       |
 * | 18 | 2026-LOT-3-BATCH-1 (new)  | Anambra (SE) | Awka South      | DI    | CoC drafted, waiting for signatures                         |
 *
 * New projects (#12–#18) are light demo data written directly (draft and parties through the setup
 * services, then status, scope, visits and milestones written directly; payments, phase changes, the
 * handover response and the CoC draft go through the real services). Evidence, site log and check-in
 * coordinates of the relocated projects move with their site. Badges, alerts and KPI snapshots are
 * refreshed at the end. Runs on a freshly reset database (the seed's reset list covers every table).
 *
 * Part 2 (wave 2, working plan 7.2 and appendix A), keyed on the story number:
 * 4. Facility catalogue: the tenant's 50 facilities carry the client's register names in title case,
 *    in register order, with the appendix archetypes (same codes and ids, so units, sub-forms and the
 *    customised TOILET stay linked; BoQ line sections follow the new names). Facilities outside the
 *    list would be retired and their units re-pointed (none today: the defaults map one to one).
 * 5. Sites (written directly; the sites service is not used): schools in UBEC style in the project's
 *    state, a radial boundary of the workspace default radius when located. Every facility unit of a
 *    project with sites names a site; empty sites get a light unit with BoQ lines.
 * 6. Contractor register: 10 fictional contractors (CAC RC number, TIN, address, state), project
 *    contractors re-pointed (the ProjectContractor rows keep their ids, so findings, defects, default
 *    cases and closure ratings follow). Ratings come from data: accepted monitoring reports with a
 *    workmanship answer (`s:WORKMANSHIP/workmanship`), written directly (light demo data), then
 *    `refreshContractorRatingSnapshots`.
 * 7. Demo 1 monitoring story through the real acceptance (`acceptSubmission`): weekly routine reports
 *    by the Resident Supervisor with geotagged photos (placeholder PNGs in storage), a PPE finding
 *    raised and rectified on the follow-up check a week later; interim payments in three quarters.
 *
 * | #  | Sites (LGAs)                           | Contractor (status)                        | Rating story                          |
 * | -- | -------------------------------------- | ------------------------------------------ | ------------------------------------- |
 * | 1  | 3 (Abuja Municipal), all on track      | Zuma Rock Construction Company Ltd         | about 4.5 (Demo 1 reports, #12)       |
 * | 2  | 6 (Dala, Gwale, Kano Municipal), 2 behind | Sahel Build & Civil Works Ltd           | about 2.5: 5 reports ≤ 3 in 60 days   |
 * | 3  | 2 | Lagoon City Contractors Ltd | 3.5–4 (#3, #4) |
 * | 4  | 2 | Lagoon City Contractors Ltd | |
 * | 5  | 1 | Oduduwa Builders & Engineering Ltd | 3.5–4 (#5, #16) |
 * | 6  | 2 (draft, no units) | Arewa Classic Builders Ltd | 3.5–4 (#14) |
 * | 7  | 2 | Kainji Works & Engineering Ltd | Not yet rated (1 report, #13) |
 * | 8  | 3 (Sokoto North, Sokoto South, Wamako), no units | Sahel Build & Civil Works Ltd | |
 * | 9  | 4 (Enugu North, East, South) | Garden City Works Nigeria Ltd | completed projects only |
 * | 10 | 2 | Garden City Works Nigeria Ltd | |
 * | 11 | 2 (draft; Kubwa not located) | Zuma Rock Construction Company Ltd | |
 * | 12 | 4 (Oshimili South, Oshimili North) | Zuma Rock Construction Company Ltd | |
 * | 13 | 3 (imported: no units, the imported % stays) | Kainji Works & Engineering Ltd | |
 * | 14 | 3 (Zaria, Sabon Gari) | Arewa Classic Builders Ltd | |
 * | 15 | 2 | Danjuma & Sons Construction Ltd | about 3 (stalled) |
 * | 16 | 5 (Ibadan North, Ibadan North East, Akinyele), mixed: 4 complete, 1 behind | Oduduwa Builders & Engineering Ltd | |
 * | 17 | 2 | Olumo Works & Services Ltd (INACTIVE: no signed contract on file) | Not yet rated |
 * | 18 | 3 | Eastline Engineering Nigeria Ltd | 3.5–4 |
 *
 * Part 3 (wave 3, working plan 6; implementation plan E3 and F.4):
 * 8. Demo 2's contractor (Sahel Build & Civil Works Ltd) flagged: its 5 accepted reports rating
 *    workmanship 3 or less within 60 days meet the flag rule. Raised by the real
 *    `evaluateContractorFlags`; when that call raises nothing on Demo 2 (the service was still a stub
 *    when part 3 was written), the OPEN flag is written directly with the same rule and evidence
 *    ("fallback while the service lands"). No action is decided: the demo decides. Every other
 *    project has at most one report at or below 3 in the last 60 days, so only Demo 2 meets the rule
 *    (the printed summary warns otherwise).
 * 9. Approved lists (written directly, read-only): for 2025 and 2026 one "Approved Projects &
 *    Implementation Schedule" (Direct Intervention, approved by the Executive Secretary the October
 *    before) with a row per DI project plus three rows in other states, and one "Approved BEAP" per
 *    state with a Matching Grants project (approved by the UBEC Board) with the project's row and one
 *    or two other rows. Rows carry the project's title, site schools, LGAs, facility scope (from its
 *    units) and lot. Every 2025–2026 project is linked to its row, with an estimate within ±5% of its
 *    budget, except Demo 2: budget ₦84.0m (contract sum ₦82.3m, its classroom blocks sized for
 *    Matching Grants, payments in step) vs approved BEAP ₦71.5m (+17%), the budget-mismatch red flag.
 *    2027 has no list; draft #11 stays unlinked.
 * Roles: `approved_lists:view` for the System Administrator, Executive Secretary, Director, Physical
 * Planning and SUBEB Executive Chairman; wave 4: `approved_lists:manage` (upload) for the System
 * Administrator and the Director, Physical Planning.
 *
 * Needs pipeline (wave 5, M3; `seedNeedsPipeline.ts` header for the open cycles, which the overlay
 * keeps as the normal seed leaves them): the normal seed's history (converted proposals for PRG-*) is
 * removed and written again from the overlay's projects, so each one's proposal names its final title,
 * State, sites, units and budget:
 *
 * | #  | Origin | Proposal |
 * | -- | ------ | -------- |
 * | 1–10, 12, 14–18 | NEEDS_PIPELINE | CONVERTED at Funding in the CLOSED cycle of its year: Direct Intervention 2025 or 2026 (national, UBEC HQ), Matching Grants 2025 or 2026 per State (owned by the State's SUBEB, with its approved BEAP and counterpart evidence); one version (template v2 built from the project's sites, units and BoQ), approved = funded = the budget |
 * | 11 | OUT_OF_CYCLE | An approved out-of-cycle request in the open Direct Intervention cycle (carry-over of an appropriated project, the Executive Secretary's approval filed): a draft of the open year cannot come from the annual cycle before its appropriation |
 * | 13 | REGISTER_IMPORT | None: imported from the register |
 *
 * The proposal ready to be appropriated live is the normal seed's: Y-DI-001 (Dawakin Tofa, the demo
 * project), with Y-DI-002 and -003, at Funding in the open Direct Intervention cycle (demo pack file
 * "16 Appropriated schedule.xlsx").
 */

const TZ = "Africa/Lagos";

// Needs pipeline (D-N.25): these three roles and logins are created by the normal seed
// (seedUbecRoster); the overlay reuses them and sets their demo permissions.
const ROLE = {
  ES: UBEC_ROLE.ES,
  DPP: UBEC_ROLE.DPP,
  FINANCE: UBEC_ROLE.FINANCE,
} as const;
const SOKOTO_ADMIN_EMAIL = "sokoto.admin@ubec.test";

/** Lots in order per intervention year (UBEC-style titles). */
const LOTS: Array<{ year: number; number: number; title: string }> = [
  { year: 2025, number: 1, title: "Renovation, Equipment and Furnishings of Public Schools" },
  { year: 2025, number: 2, title: "Construction of a Block of Two (2) Classrooms with Office & Store and Supply of Furniture" },
  { year: 2025, number: 3, title: "Provision of Motorized Boreholes, VIP Toilets and Perimeter Fencing (Matching Grants)" },
  { year: 2026, number: 1, title: "Construction of a Block of Two (2) Classrooms with Office & Store and Supply of Furniture" },
  { year: 2026, number: 2, title: "Renovation, Equipment and Furnishings of Public Schools" },
  { year: 2026, number: 3, title: "Construction and Equipping of Early Childhood Care Development and Education (ECCDE) Centres" },
  { year: 2026, number: 4, title: "Construction of Classrooms, VIP Toilets and Perimeter Fencing (Matching Grants)" },
  { year: 2027, number: 1, title: "Renovation, Equipment and Furnishings of Public Schools" },
];

type Model = "DI" | "MG";
interface Story {
  n: number;
  source: string | null;
  model: Model;
  year: number;
  lot: number;
  batch: number;
  stateCode: string;
  lgaCode: string;
  name: string;
  school: string;
  lat: number;
  lng: number;
  story: string;
}

const STORIES: Story[] = [
  { n: 1, source: "PRG-105", model: "DI", year: 2026, lot: 1, batch: 1, stateCode: "FC", lgaCode: "FC-ABUJA-MUNICIPAL", school: "LEA Primary School, Garki", name: "Construction of a Block of Two (2) Classrooms with Office & Store and Supply of Furniture at LEA Primary School, Garki", lat: 9.0335, lng: 7.4892, story: "Demo 1: on track" },
  { n: 2, source: "PRG-211", model: "MG", year: 2026, lot: 4, batch: 1, stateCode: "KN", lgaCode: "KN-DALA", school: "Dala Model Primary School", name: "Construction of Classrooms and VIP Toilets at Dala Model Primary School, Dala LGA", lat: 12.0012, lng: 8.5052, story: "Demo 2: in trouble" },
  { n: 3, source: "PRG-106", model: "DI", year: 2025, lot: 2, batch: 1, stateCode: "LA", lgaCode: "LA-MUSHIN", school: "LGEA Primary School, Mushin", name: "Construction of a Block of Two (2) Classrooms with Office & Store, VIP Toilets and a Motorized Borehole at LGEA Primary School, Mushin", lat: 6.5275, lng: 3.3416, story: "Demo 3: closing out" },
  { n: 4, source: "PRG-103", model: "DI", year: 2025, lot: 1, batch: 1, stateCode: "LA", lgaCode: "LA-LAGOS-MAINLAND", school: "Government Technical College, Yaba", name: "Renovation, Equipment and Furnishings of Government Technical College, Yaba", lat: 6.5052, lng: 3.3781, story: "Defects liability period, open defect, retention held" },
  { n: 5, source: "PRG-104", model: "DI", year: 2025, lot: 1, batch: 2, stateCode: "LA", lgaCode: "LA-LAGOS-ISLAND", school: "Junior Model College, Lagos Island", name: "Renovation, Equipment and Furnishings of Junior Model College, Lagos Island", lat: 6.4549, lng: 3.3941, story: "CoC signed once, handover response to record" },
  { n: 6, source: "PRG-101", model: "DI", year: 2026, lot: 2, batch: 1, stateCode: "KD", lgaCode: "KD-KADUNA-NORTH", school: "LEA Primary School, Kawo", name: "Renovation, Equipment and Furnishings of LEA Primary School, Kawo, Kaduna North", lat: 10.5826, lng: 7.4421, story: "Draft, kick-off planned" },
  { n: 7, source: "PRG-102", model: "DI", year: 2026, lot: 1, batch: 3, stateCode: "NI", lgaCode: "NI-CHANCHAGA", school: "Government Girls' Junior Secondary School, Minna", name: "Construction of a Block of Two (2) Classrooms with Office & Store and Supply of Furniture at Government Girls' Junior Secondary School, Minna", lat: 9.6142, lng: 6.5571, story: "Mobilising; site possession form pending" },
  { n: 8, source: "PRG-221", model: "MG", year: 2026, lot: 4, batch: 2, stateCode: "SO", lgaCode: "SO-SOKOTO-NORTH", school: "Model Junior Secondary School, Sokoto", name: "Construction of Classrooms and Perimeter Fencing at Model Junior Secondary School, Sokoto North", lat: 13.0625, lng: 5.2341, story: "Mobilisation overdue, default case waiting for the Executive Chairman" },
  { n: 9, source: "PRG-241", model: "MG", year: 2025, lot: 3, batch: 1, stateCode: "EN", lgaCode: "EN-ENUGU-NORTH", school: "Community Primary School, Ogui", name: "Provision of a Motorized Borehole and VIP Toilets at Community Primary School, Ogui, Enugu North", lat: 6.4423, lng: 7.4951, story: "Closed, audit sign-off pending" },
  { n: 10, source: "PRG-242", model: "MG", year: 2025, lot: 3, batch: 2, stateCode: "RI", lgaCode: "RI-OBIO-AKPOR", school: "Community Junior Secondary School, Rumuokoro", name: "Construction of VIP Toilets and Perimeter Fencing at Community Junior Secondary School, Rumuokoro", lat: 4.8682, lng: 6.9958, story: "Closed and archived" },
  { n: 11, source: "PRG-201", model: "DI", year: 2027, lot: 1, batch: 1, stateCode: "FC", lgaCode: "FC-BWARI", school: "LEA Primary School, Bwari", name: "Renovation, Equipment and Furnishings of LEA Primary School, Bwari", lat: 9.2836, lng: 7.3835, story: "Draft with fields still to fill" },
  { n: 12, source: null, model: "DI", year: 2026, lot: 1, batch: 2, stateCode: "DE", lgaCode: "DE-OSHIMILI-SOUTH", school: "Central Primary School, Asaba", name: "Construction of a Block of Two (2) Classrooms with Office & Store and Supply of Furniture at Central Primary School, Asaba", lat: 6.2012, lng: 6.7335, story: "Execution, on track" },
  { n: 13, source: null, model: "DI", year: 2025, lot: 2, batch: 2, stateCode: "KN", lgaCode: "KN-NASARAWA", school: "LGEA Primary School, Bompai", name: "Construction of a Block of Two (2) Classrooms with Office & Store and Supply of Furniture at LGEA Primary School, Bompai", lat: 12.0203, lng: 8.5452, story: "Imported from the register, ongoing at the imported %" },
  { n: 14, source: null, model: "DI", year: 2026, lot: 1, batch: 4, stateCode: "KD", lgaCode: "KD-ZARIA", school: "LEA Primary School, Tudun Wada, Zaria", name: "Construction of a Block of Two (2) Classrooms with Office & Store and Supply of Furniture at LEA Primary School, Tudun Wada, Zaria", lat: 11.0805, lng: 7.7102, story: "Execution; final payment before the CoC" },
  { n: 15, source: null, model: "DI", year: 2026, lot: 1, batch: 5, stateCode: "BO", lgaCode: "BO-MAIDUGURI", school: "LGEA Primary School, Bulumkutu", name: "Construction of a Block of Two (2) Classrooms with Office & Store and Supply of Furniture at LGEA Primary School, Bulumkutu, Maiduguri", lat: 11.8335, lng: 13.1512, story: "Stalled" },
  { n: 16, source: null, model: "MG", year: 2025, lot: 3, batch: 3, stateCode: "OY", lgaCode: "OY-IBADAN-NORTH", school: "LGEA Primary School, Agbowo", name: "Provision of a Motorized Borehole and VIP Toilets at LGEA Primary School, Agbowo, Ibadan North", lat: 7.4382, lng: 3.9102, story: "Handover recorded, waiting for review" },
  { n: 17, source: null, model: "MG", year: 2026, lot: 4, batch: 3, stateCode: "OG", lgaCode: "OG-ABEOKUTA-SOUTH", school: "Community Junior Secondary School, Ake", name: "Construction of Classrooms and Perimeter Fencing at Community Junior Secondary School, Ake, Abeokuta South", lat: 7.1559, lng: 3.3453, story: "Mobilising" },
  { n: 18, source: null, model: "DI", year: 2026, lot: 3, batch: 1, stateCode: "AN", lgaCode: "AN-AWKA-SOUTH", school: "Central School, Awka", name: "Construction and Equipping of an ECCDE Centre at Central School, Awka", lat: 6.2102, lng: 7.0702, story: "CoC drafted, waiting for signatures" },
];

/** State regions (zone → state), reusing the Phase 11 rows (codes N, S, N-KAN, N-KAD, S-LAG, S-OGU). */
const ZONE_REGION: Record<string, { code: string; name: string }> = {
  NW: { code: "N", name: "North West" },
  SW: { code: "S", name: "South West" },
  NC: { code: "NC", name: "North Central" },
  NE: { code: "NE", name: "North East" },
  SE: { code: "SE", name: "South East" },
  SS: { code: "SS", name: "South South" },
};
const STATE_REGION: Record<string, { code: string; name: string }> = {
  KN: { code: "N-KAN", name: "Kano" },
  KD: { code: "N-KAD", name: "Kaduna" },
  SO: { code: "N-SOK", name: "Sokoto" },
  LA: { code: "S-LAG", name: "Lagos" },
  OG: { code: "S-OGU", name: "Ogun" },
  OY: { code: "S-OYO", name: "Oyo" },
  FC: { code: "NC-FCT", name: "FCT" },
  NI: { code: "NC-NIG", name: "Niger" },
  BO: { code: "NE-BOR", name: "Borno" },
  EN: { code: "SE-ENU", name: "Enugu" },
  AN: { code: "SE-ANA", name: "Anambra" },
  RI: { code: "SS-RIV", name: "Rivers" },
  DE: { code: "SS-DEL", name: "Delta" },
};

/** SUBEBs for the Matching Grants states (Kano's Phase 11 record is reused). */
const SUBEB_STATES = ["SO", "EN", "RI", "OY", "OG"];
const subebName = (stateCode: string) => `${stateByCode(stateCode)!.name} State Universal Basic Education Board (SUBEB)`;

const DIRECT_COC_SLOTS: CocSignatorySlotInput[] = [
  { key: "head-physical-planning", label: "Director, Physical Planning", roleCode: ROLE.DPP, organizationScope: "PROJECT_OWNER" },
  { key: "head-me", label: "Director, Monitoring & Evaluation", organizationScope: "PROJECT_OWNER" },
  { key: "beneficiary", label: "Beneficiary institution", isBeneficiary: true, organizationScope: "ANY" },
];
const MATCHING_COC_SLOTS: CocSignatorySlotInput[] = [
  { key: "head-physical-planning", label: "Director, Physical Planning", organizationScope: "PROJECT_OWNER" },
  { key: "head-me", label: "Director, Monitoring & Evaluation", organizationScope: "PROJECT_OWNER" },
  { key: "beneficiary", label: "Beneficiary institution", isBeneficiary: true, organizationScope: "ANY" },
];
const SLOT_LABELS: Record<string, string> = { "head-physical-planning": "Director, Physical Planning", "head-me": "Director, Monitoring & Evaluation" };

const ES_PERMISSIONS = [
  "projects:view_all_tenant",
  "projects:view_portfolio",
  "kpis:view",
  "scope:view",
  "sprints:view_status",
  "visits:view",
  "incidents:view",
  "findings:receive_escalations",
  "documents:view",
  "contracts:decide_default",
  "contractors:view_register",
  "payments:view",
  "lessons:view",
  "approved_lists:view",
];
const DPP_PERMISSIONS = [
  "projects:view_all_tenant",
  "projects:view_portfolio",
  "kpis:view",
  "projects:create",
  "projects:activate",
  "projects:edit_baseline",
  "scope:view",
  "scope:edit",
  "sprints:view_status",
  "contractors:manage",
  "contractors:view_register",
  "milestones:manage",
  "kickoff:manage",
  "contracts:raise_default",
  "documents:view",
  "documents:upload",
  "visits:view",
  "completion:draft_certificate",
  "completion:sign_certificate",
  "payments:view",
  "lessons:view",
  "approved_lists:view",
  // Wave 4: uploads the approved lists.
  "approved_lists:manage",
];
const FINANCE_PERMISSIONS = [
  "projects:view_all_tenant",
  "projects:view_portfolio",
  "kpis:view",
  "scope:view",
  "sprints:view_status",
  "documents:view",
  "payments:view",
  "payments:record",
];

type Ctx = {
  tenantId: string;
  today: string;
  admin: WebJwtPayload;
  dpp: WebJwtPayload;
  finance: WebJwtPayload;
  monitor: WebJwtPayload;
  lagosMe: WebJwtPayload;
  resident: WebJwtPayload;
  flagshipId: string;
  subebByState: Map<string, string>;
  regionByState: Map<string, string>;
  lotIds: Map<string, string>;
  types: Map<string, { id: string }>;
  roleIds: Record<"admin" | "chairman" | "es", string>;
  /** Workspace default geofence radius (site boundaries, part 2). */
  defaultRadiusMeters: number;
};

const story0 = (n: number): Story => STORIES.find((x) => x.n === n)!;
const code0 = (s: Story) => buildLotBatchCode(s.year, s.lot, s.batch);
const lotKey = (year: number, n: number) => `${year}-${n}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------------------------
// 1. Roles and logins
// ---------------------------------------------------------------------------------------------

async function rolesAndLogins(tenantId: string): Promise<Ctx["roleIds"]> {
  const permIds = new Map((await prisma.permission.findMany({ select: { id: true, key: true } })).map((p) => [p.key, p.id]));
  const setPermissions = async (roleId: string, keys: string[]) => {
    const missing = keys.filter((k) => !permIds.has(k));
    if (missing.length) throw new Error(`Demo overlay roles: unknown permissions ${missing.join(", ")}`);
    await prisma.rolePermission.deleteMany({ where: { roleId } });
    await prisma.rolePermission.createMany({ data: [...new Set(keys)].map((k) => ({ roleId, permissionId: permIds.get(k)! })) });
  };
  const byCode = (code: string) => prisma.role.findUniqueOrThrow({ where: { tenantId_code: { tenantId, code } } });
  const rename = async (code: string, name: string, description: string) =>
    prisma.role.update({ where: { id: (await byCode(code)).id }, data: { name, description } });

  const admin = await rename(
    UBEC_ROLE.ADMIN,
    "System Administrator",
    "UBEC HQ ICT: users, roles, workspace settings, form library, facilities, project types and monitoring plan rules. In the demo also covers the Director Legal and Internal Audit steps."
  );
  // The System Administrator keeps every permission, including the contractor register (wave 2).
  // Part 3 (wave 3): and the approved lists (Needs assessment page); wave 4: their upload.
  await prisma.rolePermission.createMany({
    data: ["contractors:view_register", "approved_lists:view", "approved_lists:manage"].map((k) => ({ roleId: admin.id, permissionId: permIds.get(k)! })),
    skipDuplicates: true,
  });
  const chairman = await rename(
    UBEC_ROLE.SUBEB_ADMIN,
    "SUBEB Executive Chairman",
    "Heads a State Universal Basic Education Board: sees the SUBEB's Matching Grants projects, decides their contractor default cases and signs their Certificates of Completion."
  );
  // Part 3 (wave 3): the chairman sees the approved lists (its own projects' links only).
  await prisma.rolePermission.createMany({ data: [{ roleId: chairman.id, permissionId: permIds.get("approved_lists:view")! }], skipDuplicates: true });
  await rename(
    UBEC_ROLE.UBEC_ME,
    "M&E Officer",
    "Monitoring & Evaluation on assigned projects (web and field app): mobilisation checks, baseline and quarterly monitoring, evaluations; reviews Resident Supervisor reports; raises and follows findings; handover review; CoC signature."
  );
  await rename(
    UBEC_ROLE.SUBEB_ME,
    "M&E Officer (SUBEB)",
    "A SUBEB's Monitoring & Evaluation on assigned Matching Grants projects (web and field app): monitoring visits, evaluations, handover responses and the SUBEB's CoC signature."
  );
  await rename(
    UBEC_ROLE.INDEPENDENT_ME,
    "Independent M&E (COREN-certified firm)",
    "Independent monitoring and evaluation by a COREN-certified firm on the projects it is engaged on: web and field app."
  );

  const newRoles: Array<[string, string, string, string[]]> = [
    [
      ROLE.ES,
      "Executive Secretary",
      "UBEC's Executive Secretary: programme dashboard, KPIs, register and alerts; decides Direct Intervention contractor default cases; receives escalations.",
      ES_PERMISSIONS,
    ],
    [
      ROLE.DPP,
      "Director, Physical Planning",
      "Process owner: creates projects from the needs assessment, BoQ & work phases, contractor, kick-off and letter of introduction, Resident Supervisor assignment; raises defaults to Legal; drafts and signs the Certificate of Completion; activates projects.",
      DPP_PERMISSIONS,
    ],
    [ROLE.FINANCE, "Finance Officer", "Records payments made outside the platform (interim, final, retention release) and follows payment exceptions.", FINANCE_PERMISSIONS],
  ];
  const created: Record<string, string> = {};
  for (const [code, name, description, keys] of newRoles) {
    // The role exists (normal seed) with its needs pipeline grants only: the demo adds its project permissions.
    const role = await prisma.role.upsert({
      where: { tenantId_code: { tenantId, code } },
      update: { name, description },
      create: { tenantId, code, name, description, surface: "WEB", fieldPersonaType: "NONE", isSystemDefault: false },
    });
    await setPermissions(role.id, [...keys, ...(NEEDS_PIPELINE_GRANTS[code] ?? [])]);
    created[code] = role.id;
  }

  const passwordHash = (await prisma.user.findUniqueOrThrow({ where: { email: UBEC_ADMIN_EMAIL } })).passwordHash;
  const flagship = await prisma.organization.findFirstOrThrow({ where: { tenantId, name: UBEC_ORG_NAME } });
  for (const [email, fullName, roleId, phone] of [
    [ES_EMAIL, "Aminu Yusuf", created[ROLE.ES], "+234 803 555 0201"],
    [DPP_EMAIL, "Ifeoma Nwosu", created[ROLE.DPP], "+234 803 555 0202"],
    [FINANCE_EMAIL, "Babatunde Adewale", created[ROLE.FINANCE], "+234 803 555 0203"],
  ] as const) {
    await prisma.user.upsert({
      where: { email },
      update: { fullName, roleId, organizationId: flagship.id, phoneNumber: phone },
      create: { tenantId, email, fullName, passwordHash, roleId, organizationId: flagship.id, phoneNumber: phone },
    });
  }
  return { admin: admin.id, chairman: chairman.id, es: created[ROLE.ES] };
}

// ---------------------------------------------------------------------------------------------
// 2. Organisations, regions, lots, type rules
// ---------------------------------------------------------------------------------------------

async function subebs(tenantId: string, flagshipId: string, chairmanRoleId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  out.set("KN", (await prisma.organization.findFirstOrThrow({ where: { tenantId, name: KANO_SUBEB_NAME } })).id);
  for (const s of SUBEB_STATES) {
    const org = await prisma.organization.create({
      data: { tenantId, name: subebName(s), categories: ["CLIENT_OWNER", "FINANCIER_LENDER"], parentOrganizationId: flagshipId },
    });
    out.set(s, org.id);
  }
  const passwordHash = (await prisma.user.findUniqueOrThrow({ where: { email: UBEC_ADMIN_EMAIL } })).passwordHash;
  await prisma.user.create({
    data: { tenantId, email: SOKOTO_ADMIN_EMAIL, fullName: "Abubakar Shehu", passwordHash, roleId: chairmanRoleId, organizationId: out.get("SO")!, phoneNumber: "+234 803 555 0204" },
  });
  return out;
}

async function regions(tenantId: string): Promise<Map<string, string>> {
  const ensure = async (code: string, name: string, parentRegionId: string | null) =>
    (await prisma.region.findFirst({ where: { tenantId, code } })) ?? prisma.region.create({ data: { tenantId, code, name, parentRegionId } });
  const out = new Map<string, string>();
  for (const [stateCode, r] of Object.entries(STATE_REGION)) {
    const zone = ZONE_REGION[zoneOfState(stateCode)!];
    const parent = await ensure(zone.code, zone.name, null);
    out.set(stateCode, (await ensure(r.code, r.name, parent.id)).id);
  }
  return out;
}

/** Merges a change into both programme types and every project's snapshot (no version bump, seed only). */
async function mergeTypeConfig(tenantId: string, change: (config: ProjectTypeConfig, typeCode: string) => ProjectTypeConfig) {
  const types = await prisma.projectType.findMany({ where: { tenantId } });
  for (const type of types) {
    const config = ProjectTypeConfigSchema.parse(change(ProjectTypeConfigSchema.parse(type.configJson), type.code));
    await prisma.projectType.update({ where: { id: type.id }, data: { configJson: config as unknown as Prisma.InputJsonValue } });
  }
  const codeById = new Map(types.map((t) => [t.id, t.code]));
  for (const p of await prisma.project.findMany({ where: { tenantId, projectTypeId: { not: null } }, select: { id: true, projectTypeId: true, projectTypeSnapshotJson: true } })) {
    if (!p.projectTypeSnapshotJson) continue;
    const snapshot = p.projectTypeSnapshotJson as unknown as ProjectTypeSnapshot;
    const config = ProjectTypeConfigSchema.parse(change(ProjectTypeConfigSchema.parse(snapshot.config), codeById.get(p.projectTypeId!)!));
    await prisma.project.update({ where: { id: p.id }, data: { projectTypeSnapshotJson: { ...snapshot, config } as unknown as Prisma.InputJsonValue } });
  }
}

// ---------------------------------------------------------------------------------------------
// 3. Projects
// ---------------------------------------------------------------------------------------------

/** Moves every stored coordinate object ({ latitude, longitude }) by the same offset. */
function shiftCoordinates(value: unknown, dLat: number, dLng: number): unknown {
  if (Array.isArray(value)) return value.map((v) => shiftCoordinates(v, dLat, dLng));
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) out[k] = shiftCoordinates(v, dLat, dLng);
    if (typeof o.latitude === "number" && typeof o.longitude === "number") {
      out.latitude = round6(o.latitude + dLat);
      out.longitude = round6(o.longitude + dLng);
    }
    return out;
  }
  return value;
}
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

function geofenceCentre(geo: Record<string, unknown> | null): { latitude: number; longitude: number } | null {
  if (!geo) return null;
  const c = geo.center as { latitude: number; longitude: number } | undefined;
  if (c) return c;
  const ring = geo.perimeterCoordinates as Array<{ latitude: number; longitude: number }> | undefined;
  if (!ring?.length) return null;
  return {
    latitude: ring.reduce((s, p) => s + p.latitude, 0) / ring.length,
    longitude: ring.reduce((s, p) => s + p.longitude, 0) / ring.length,
  };
}

/** Location, code, lot, names, owner, region and register fields of one project, per its story row. */
async function relocate(ctx: Ctx, projectId: string, s: Story) {
  const state = stateByCode(s.stateCode)!;
  const lga = lgaByCode(s.lgaCode)!;
  if (lga.stateCode !== s.stateCode) throw new Error(`Demo overlay: ${s.lgaCode} is not in ${s.stateCode}`);
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { geofenceGeoJson: true, codePrefix: true } });
  const geo = project.geofenceGeoJson as Record<string, unknown> | null;
  const centre = geofenceCentre(geo);
  const dLat = centre ? s.lat - centre.latitude : 0;
  const dLng = centre ? s.lng - centre.longitude : 0;
  const geofence = geo
    ? { ...(shiftCoordinates(geo, dLat, dLng) as Record<string, unknown>), siteLabel: s.school.slice(0, 120) }
    : { mode: "RADIAL", siteLabel: s.school.slice(0, 120), center: { latitude: s.lat, longitude: s.lng }, radiusMeters: 150 };
  const fundingSourceCode = s.model === "MG" ? "MATCHING_GRANT" : "DIRECT_INTERVENTION";
  const owner = s.model === "MG" ? ctx.subebByState.get(s.stateCode)! : ctx.flagshipId;
  await prisma.project.update({
    where: { id: projectId },
    data: {
      name: s.name,
      codePrefix: buildLotBatchCode(s.year, s.lot, s.batch),
      lotId: ctx.lotIds.get(lotKey(s.year, s.lot))!,
      batchNumber: s.batch,
      interventionYear: s.year,
      fundingSourceCode,
      fundingSource: fundingSourceText(fundingSourceCode),
      externalReference: `UBEC/${s.model}/${s.year}/${s.stateCode}/${String(s.lot).padStart(2, "0")}${String(s.batch).padStart(2, "0")}`,
      stateCode: s.stateCode,
      lgaCode: s.lgaCode,
      stateLocation: state.name,
      lgaLocation: lga.name,
      siteAddress: `${s.school}, ${lga.name} LGA, ${state.name}`,
      regionId: ctx.regionByState.get(s.stateCode)!,
      owningOrganizationId: owner,
      ...(s.model === "MG" ? { lenderOrganizationId: owner } : {}),
      geofenceMode: (geofence.mode as "RADIAL" | "PERIMETER") ?? "RADIAL",
      geofenceGeoJson: geofence as unknown as Prisma.InputJsonValue,
    },
  });
  await prisma.projectBeneficiary.updateMany({ where: { projectId, isPrimary: true }, data: { name: s.school } });
  await prisma.kickoffMeeting.updateMany({ where: { projectId }, data: { location: s.school } });
  if (centre && (dLat || dLng)) {
    // Field records keep their position on the moved site.
    await prisma.fieldEvidenceLog.updateMany({ where: { projectId, latitude: { not: null } }, data: { latitude: { increment: dLat }, longitude: { increment: dLng } } });
    await prisma.siteLogEntry.updateMany({ where: { projectId, latitude: { not: null } }, data: { latitude: { increment: dLat }, longitude: { increment: dLng } } });
    for (const v of await prisma.visit.findMany({ where: { projectId, checkInGeotag: { not: Prisma.DbNull } }, select: { id: true, checkInGeotag: true } })) {
      await prisma.visit.update({ where: { id: v.id }, data: { checkInGeotag: shiftCoordinates(v.checkInGeotag, dLat, dLng) as Prisma.InputJsonValue } });
    }
    for (const v of await prisma.visitSubmission.findMany({ where: { projectId, submissionGeotag: { not: Prisma.DbNull } }, select: { id: true, submissionGeotag: true } })) {
      await prisma.visitSubmission.update({ where: { id: v.id }, data: { submissionGeotag: shiftCoordinates(v.submissionGeotag, dLat, dLng) as Prisma.InputJsonValue } });
    }
  }
}

/** The project's default case chain with the deciding role named (a new chain version). */
async function writeDefaultCaseChain(ctx: Ctx, projectId: string, model: Model) {
  await prisma.$transaction(async (tx) => {
    const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { owningOrganizationId: true } });
    const [review, decision] = defaultContractDefaultChain({ hasOwner: Boolean(project.owningOrganizationId), legalRoleId: ctx.roleIds.admin });
    const steps = [
      { ...review, label: "Director Legal review" },
      model === "MG"
        ? { ...decision, label: "SUBEB Executive Chairman decision", requiredRoleId: ctx.roleIds.chairman }
        : { ...decision, label: "Executive Secretary (ES) decision", requiredRoleId: ctx.roleIds.es },
    ];
    await writeChainVersion(tx, projectId, "CONTRACT_DEFAULT", steps, await getProcessConfig(projectId, tx));
  });
}

type LineSeed = [description: string, unit: string, quantity: number, rateNgn: number];
interface UnitSeed {
  facility: string;
  label: string;
  /** Work phase numbers; omitted on projects without work phases (legacy). */
  startSprint?: number;
  endSprint?: number;
  progressPct: number;
  plannedQuantity?: number;
  /** Part 2: the site number (1-based) the unit is at. */
  site?: number;
  lines: LineSeed[];
}

/** One facility unit with its BoQ lines (light demo data, written directly); returns the lines' total. */
async function createUnit(
  ctx: Ctx,
  projectId: string,
  index: number,
  u: UnitSeed,
  sprintIds: string[],
  siteId: string | null,
  wbsGroup = index + 1
): Promise<number> {
  const facility = await prisma.facility.findUniqueOrThrow({ where: { tenantId_code: { tenantId: ctx.tenantId, code: u.facility } } });
  const unit = await prisma.facilityUnit.create({
    data: {
      projectId,
      facilityId: facility.id,
      code: `U${String(index + 1).padStart(2, "0")}`,
      label: u.label,
      plannedQuantity: u.plannedQuantity ?? null,
      quantityUnit: u.plannedQuantity ? "nr" : null,
      startSprintId: u.startSprint ? (sprintIds[u.startSprint - 1] ?? null) : null,
      endSprintId: u.endSprint ? (sprintIds[u.endSprint - 1] ?? null) : null,
      siteId,
      sortOrder: (index + 1) * 10,
      progressPct: u.progressPct,
      progressAsOf: u.progressPct > 0 ? addDays(ctx.today, -7) : null,
    },
  });
  let total = 0;
  for (const [j, [description, unitOfMeasure, qty, rate]] of u.lines.entries()) {
    const amount = round2(qty * rate);
    total += amount;
    await prisma.boqItem.create({
      data: {
        projectId,
        facilityUnitId: unit.id,
        wbsCode: `${String(wbsGroup).padStart(2, "0")}.${String(j + 1).padStart(2, "0")}`,
        section: facility.name,
        description,
        unit: unitOfMeasure,
        totalQuantity: qty,
        rateNgn: rate,
        budgetedCostNgn: amount,
        cumulativeCertifiedPct: u.progressPct,
      },
    });
  }
  return total;
}

/** Light demo data, written directly: work phases, facility units with progress and BoQ lines. */
async function lightScope(
  ctx: Ctx,
  projectId: string,
  sprints: Array<[name: string, start: number, end: number]>,
  units: UnitSeed[],
  siteIds: string[] = []
): Promise<number> {
  const sprintIds: string[] = [];
  for (const [i, [name, start, end]] of sprints.entries()) {
    const row = await prisma.projectSprint.create({
      data: { projectId, number: i + 1, name, startDate: addDays(ctx.today, start), endDate: addDays(ctx.today, end), deliverables: name },
    });
    sprintIds.push(row.id);
  }
  let total = 0;
  for (const [i, u] of units.entries()) {
    total += await createUnit(ctx, projectId, i, u, sprintIds, u.site ? siteIds[u.site - 1] : null);
  }
  await prisma.$transaction(async (tx) => {
    await deriveLineDatesFromSprints(tx, projectId);
    await refreshProjectProgress(tx, projectId);
  });
  await prisma.project.update({ where: { id: projectId }, data: { contractSumNgn: round2(total) } });
  return round2(total);
}

/** The usual scope of a two-classroom block with toilets and furniture (light demo data). */
function classroomBlock(progress: [number, number, number]): UnitSeed[] {
  return [
    {
      facility: "CLASSROOM",
      label: "Block of two classrooms with office & store",
      startSprint: 1,
      endSprint: 2,
      progressPct: progress[0],
      lines: [
        ["Substructure: excavation, foundations and ground floor slab", "m2", 210, 95_000],
        ["Superstructure: block walls, columns, lintels and roof", "m2", 210, 140_000],
        ["Finishes: plaster, paint, doors and windows", "m2", 620, 18_500],
      ],
    },
    {
      facility: "TOILET",
      label: "VIP toilet block (4 compartments)",
      startSprint: 2,
      endSprint: 3,
      progressPct: progress[1],
      lines: [["VIP toilet block, complete", "item", 1, 9_800_000]],
    },
    {
      facility: "PUPILS_FURNITURE",
      label: "Pupils' desks and chairs",
      startSprint: 3,
      endSprint: 3,
      progressPct: progress[2],
      plannedQuantity: 80,
      lines: [["Two-seater pupils' desk and chair", "nr", 80, 85_000]],
    },
  ];
}

/** An accepted visit (light demo data, written directly); with `raisedUnits` it is recorded as the
 *  visit that raised those units' progress, as visit acceptance records it (STALLED alert fact). */
async function acceptedVisit(ctx: Ctx, projectId: string, reporter: WebJwtPayload, daysAgo: number, kind: string, summary: string, raisedUnits = false) {
  const visitDate = addDays(ctx.today, -daysAgo);
  const visit = await approvedFinalEvaluation({ tenantId: ctx.tenantId, projectId, reporter, visitDate, visitKind: kind as "BASELINE", summary });
  if (!raisedUnits) return;
  const units = await prisma.facilityUnit.findMany({ where: { projectId, progressPct: { gt: 0 } }, select: { id: true, progressPct: true } });
  await prisma.facilityUnit.updateMany({ where: { projectId, progressPct: { gt: 0 } }, data: { progressAsOf: visitDate } });
  await recordAuditEvent(prisma, {
    projectId,
    actorType: "WEB_USER",
    actorId: reporter.userId,
    actorDisplayName: reporter.fullName,
    action: "VISIT_UPDATED",
    summaryText: `The routine monitoring visit of ${visitDate} raised the progress of ${units.length} facility unit(s).`,
    payload: { visitId: visit.id, progressIncrease: { asOf: visitDate, units: units.map((u) => ({ unitId: u.id, from: null, to: Number(u.progressPct) })) } },
  });
}

type KickoffInvitee = Parameters<typeof heldKickoff>[0]["invitees"][number];

/** The usual kick-off attendance: owner, M&E, the project's contractor and the head teacher. */
async function defaultKickoffInvitees(ctx: Ctx, projectId: string): Promise<KickoffInvitee[]> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { owningOrganization: { select: { id: true, name: true } }, contractors: { select: { organization: { select: { id: true, name: true } } } } },
  });
  const contractor = project.contractors[0]?.organization ?? null;
  return [
    project.owningOrganization
      ? { group: "OWNER", name: project.owningOrganization.name, email: null, organizationId: project.owningOrganization.id }
      : { group: "OWNER", name: ctx.dpp.fullName, email: ctx.dpp.email, userId: ctx.dpp.userId, organizationId: ctx.dpp.organizationId },
    { group: "MONITOR", name: ctx.monitor.fullName, email: ctx.monitor.email, userId: ctx.monitor.userId, organizationId: ctx.monitor.organizationId },
    ...(contractor ? [{ group: "CONTRACTOR", name: contractor.name, email: null, organizationId: contractor.id }] : []),
    { group: "BENEFICIARY", name: "Head teacher", email: null },
  ];
}

/**
 * Contract dates, a held kick-off meeting (the record the Kick-off page and the stage read, with the
 * project's minutes when it has them) and, when mobilised, every contract milestone before
 * completion done, each on its due date and at the latest a week after the kick-off (light demo data).
 */
async function contractHistory(
  ctx: Ctx,
  projectId: string,
  ref: string,
  kickoffDaysAgo: number,
  opts: { mobilised?: boolean; invitees?: KickoffInvitee[]; award?: string; signed?: string } = {}
) {
  const mobilised = opts.mobilised ?? true;
  const kickoff = addDays(ctx.today, -kickoffDaysAgo);
  await prisma.project.update({
    where: { id: projectId },
    data: {
      contractReference: ref,
      contractAwardDate: opts.award ?? addDays(kickoff, -20),
      contractSignedDate: opts.signed ?? addDays(kickoff, -12),
      kickoffDate: kickoff,
    },
  });
  await prisma.$transaction(async (tx) => {
    await syncContractMilestones(tx, projectId);
    await recomputeMilestoneDates(tx, projectId);
  });
  if (await prisma.kickoffMeeting.findUnique({ where: { projectId } })) {
    await prisma.kickoffMeeting.update({ where: { projectId }, data: { scheduledAt: new Date(`${kickoff}T09:00:00.000Z`), heldAt: new Date(`${kickoff}T09:00:00.000Z`), quorumMet: true } });
    await prisma.project.update({ where: { id: projectId }, data: { kickoffHeldAt: new Date(`${kickoff}T09:00:00.000Z`) } });
  } else {
    const minutes = await prisma.projectDocument.findFirst({ where: { projectId, documentType: { code: "KICKOFF_MINUTES" } }, select: { id: true } });
    await heldKickoff({ projectId, date: kickoff, minutesDocumentId: minutes?.id ?? null, invitees: opts.invitees ?? (await defaultKickoffInvitees(ctx, projectId)) });
  }
  if (!mobilised) return;
  const latest = addDays(kickoff, 7);
  for (const m of await prisma.projectContractMilestone.findMany({
    where: { projectId, status: { in: ["PENDING", "DUE", "OVERDUE"] }, anchor: { notIn: ["COC_ISSUED", "PROJECT_CLOSED"] } },
    select: { id: true, dueDate: true },
  })) {
    const on = m.dueDate && m.dueDate < latest ? m.dueDate : latest;
    await prisma.projectContractMilestone.update({ where: { id: m.id }, data: { status: "DONE", completedAt: new Date(`${on}T10:00:00.000Z`), completedNotes: "Done." } });
  }
  // Mobilised: the mobilisation checks still proposed are no longer needed (as an accepted check does).
  await prisma.visit.updateMany({
    where: { projectId, visitKind: "MOBILISATION_CHECK", status: "PROPOSED" },
    data: { status: "CANCELLED", cancelledAt: new Date(`${latest}T10:00:00.000Z`), cancelledReason: "The contractor is on site: no mobilisation check needed." },
  });
}

/** A new project: draft and parties through the setup services, then switched on (light demo data). */
async function newProject(
  ctx: Ctx,
  s: Story,
  opts: { contractorId: string; budget: number; activatedDaysAgo: number | null; assign: WebJwtPayload[] }
): Promise<string> {
  const state = stateByCode(s.stateCode)!;
  const lga = lgaByCode(s.lgaCode)!;
  const draft = await createProjectDraft(ctx.admin, {
    name: s.name,
    codePrefix: `DMO-${300 + s.n}`, // re-coded to its lot and batch by relocate()
    stateLocation: state.name,
    lgaLocation: lga.name,
    description: s.story,
    totalBudgetNgn: opts.budget,
    projectTypeId: ctx.types.get(s.model === "MG" ? "CO_FUNDED" : "CENTRAL")!.id,
    regionId: ctx.regionByState.get(s.stateCode)!,
  });
  const projectId = draft.projectId;
  const monitorOrg = await prisma.organization.findFirstOrThrow({ where: { tenantId: ctx.tenantId, name: ME_CONSULTANTS_NAME } });
  await saveProjectSetupStep(projectId, "parties", ctx.admin, {
    ...(s.model === "MG" ? { owningOrganizationId: ctx.subebByState.get(s.stateCode)! } : {}),
    monitorOrganization: { id: monitorOrg.id },
    contractors: [{ organization: { id: opts.contractorId }, tradeCategory: "Civil works", tradeCode: "CIV" }],
    beneficiaries: [
      {
        name: s.school,
        beneficiaryType: "SCHOOL",
        contactName: "Head teacher",
        contactEmail: `headteacher.demo${s.n}@example.org`,
        isPrimary: true,
      },
    ],
  });
  await relocate(ctx, projectId, s);
  if (opts.activatedDaysAgo !== null) {
    await prisma.project.update({
      where: { id: projectId },
      data: { status: "ACTIVE", activatedAt: new Date(`${addDays(ctx.today, -opts.activatedDaysAgo)}T10:00:00.000Z`), activatedByUserId: ctx.dpp.userId },
    });
  }
  await prisma.userProjectAssignment.createMany({ data: opts.assign.map((u) => ({ userId: u.userId, projectId })), skipDuplicates: true });
  return projectId;
}

/**
 * Payment voucher reference in the client's style: intervention year, lot and batch, serial
 * ("UBEC/PV/2026/0102-01" for LOT 1 BATCH 2 of 2026, first payment). The intervention year, not the
 * year paid, keeps references apart: lot numbers repeat across years.
 */
function voucherRef(s: Pick<Story, "year" | "lot" | "batch">, n: number | string): string {
  return `UBEC/PV/${s.year}/${String(s.lot).padStart(2, "0")}${String(s.batch).padStart(2, "0")}-${typeof n === "number" ? String(n).padStart(2, "0") : n}`;
}

async function pay(ctx: Ctx, projectId: string, s: Story, kind: "INTERIM" | "FINAL", daysAgo: number, gross: number, description: string, n: number) {
  const paidOn = addDays(ctx.today, -daysAgo);
  await recordPayment(projectId, ctx.finance, {
    kind,
    paidOn,
    grossAmountNgn: round2(gross),
    reference: voucherRef(s, n),
    description,
  });
}

// =============================================================================================
// Part 2 (wave 2): facility catalogue, sites, contractor register, Demo 1 monitoring, ratings
// =============================================================================================

// ---- 4. Facility catalogue (appendix A) --------------------------------------------------------

/** The client's 50 register columns in register order, title case; codes as provisioned. */
const FACILITY_CATALOGUE: Array<[code: string, name: string, archetype: FacilityArchetype, pluralName?: string]> = [
  ["CLASSROOM", "Classroom", "BUILDING_WORKS"],
  ["OFFICE", "Office", "BUILDING_WORKS"],
  ["STORE", "Store", "BUILDING_WORKS"],
  ["TOILET", "Toilet", "BUILDING_WORKS"],
  ["LABORATORY", "Laboratory", "BUILDING_WORKS"],
  ["WORKSHOP", "Workshop", "BUILDING_WORKS"],
  ["LIBRARY", "Library", "BUILDING_WORKS"],
  ["ICT_LAB", "ICT Lab / Room", "BUILDING_WORKS", "ICT Labs / Rooms"],
  ["GATE_HOUSE", "Gate House", "BUILDING_WORKS"],
  ["HALL", "Hall", "BUILDING_WORKS"],
  ["STAFF_QUARTERS", "Staff Quarters", "BUILDING_WORKS", "Staff Quarters"],
  ["ADMIN_BLOCK", "Admin Block", "BUILDING_WORKS"],
  ["CRECHE", "Creche", "BUILDING_WORKS"],
  ["CLINIC", "Clinic", "BUILDING_WORKS"],
  ["KITCHEN", "Kitchen", "BUILDING_WORKS"],
  ["SHOP", "Shop", "BUILDING_WORKS"],
  ["NANNY_STATION", "Nanny Station", "BUILDING_WORKS"],
  ["HOSTEL", "Hostel", "BUILDING_WORKS"],
  ["STAFF_ROOM", "Staff Room", "BUILDING_WORKS"],
  ["PUPILS_FURNITURE", "Pupils Furniture", "SUPPLY_INSTALLATION"],
  ["TEACHERS_FURNITURE", "Teachers Furniture", "SUPPLY_INSTALLATION"],
  ["PRINCIPAL_FURNITURE", "Headmaster / Principal Furniture", "SUPPLY_INSTALLATION"],
  ["LAB_FURNITURE", "Lab Furniture", "SUPPLY_INSTALLATION"],
  ["LIBRARY_FURNITURE", "Library Furniture", "SUPPLY_INSTALLATION"],
  ["WORKSHOP_FURNITURE", "Workshop Furniture", "SUPPLY_INSTALLATION"],
  ["MAGNETIC_BOARD", "Magnetic Board", "SUPPLY_INSTALLATION"],
  ["SCIENCE_KIT", "Science Kit", "SUPPLY_INSTALLATION"],
  ["PLAY_EQUIPMENT", "Play Equipment", "SUPPLY_INSTALLATION"],
  ["ROBOTICS_EQUIPMENT", "Robotics Equipment", "SUPPLY_INSTALLATION"],
  ["PHONE_REPAIR_EQUIPMENT", "Phone Repair Equipment", "SUPPLY_INSTALLATION"],
  ["ELECTRICAL_EQUIPMENT", "Electrical Wiring Equipment", "SUPPLY_INSTALLATION"],
  ["ICT_EQUIPMENT", "ICT Equipment", "SUPPLY_INSTALLATION"],
  ["SPORTS_EQUIPMENT", "Sports Equipment", "SUPPLY_INSTALLATION"],
  ["COMPUTER", "Computer", "SUPPLY_INSTALLATION"],
  ["FILE_CABINET", "File Cabinet", "SUPPLY_INSTALLATION"],
  ["FRIDGE", "Fridge", "SUPPLY_INSTALLATION"],
  ["BOOKSHELF", "Bookshelf / Cupboard", "SUPPLY_INSTALLATION"],
  ["SHOE_AND_BAG", "Shoe & Bag Equipment", "SUPPLY_INSTALLATION"],
  ["BED_AND_BEDDINGS", "Bed + Beddings", "SUPPLY_INSTALLATION"],
  ["TAILORING_EQUIPMENT", "Fashion Design + Tailoring Equipment", "SUPPLY_INSTALLATION"],
  ["BAKING_EQUIPMENT", "Cake/Baking Equipment", "SUPPLY_INSTALLATION"],
  ["BOREHOLE", "Borehole", "UTILITIES"],
  ["OVERHEAD_TANK", "Overhead Tank", "UTILITIES"],
  ["GENERATOR", "Generator", "UTILITIES"],
  ["SOLAR_POWER", "Solar Power", "UTILITIES", "Solar Power Systems"],
  ["FENCE", "Fence", "EXTERNAL_WORKS"],
  ["LANDSCAPING", "Landscaping", "EXTERNAL_WORKS", "Landscaping"],
  ["DRAINAGE", "Drainage / Exterior Works", "EXTERNAL_WORKS", "Drainage / Exterior Works"],
  ["FOOTBALL_PITCH", "Football Pitch", "EXTERNAL_WORKS"],
  ["PLAYGROUND", "Playground", "EXTERNAL_WORKS"],
];

/** Renames the tenant's facilities to the register names (ids kept), adds missing ones, retires the rest. */
async function facilityCatalogue(tenantId: string): Promise<{ renamed: number; added: number; retired: number }> {
  if (FACILITY_CATALOGUE.length !== 50) throw new Error("Demo overlay: the facility catalogue must have 50 entries");
  const existing = await prisma.facility.findMany({ where: { tenantId } });
  const byCode = new Map(existing.map((f) => [f.code, f]));
  const kept = new Map<string, string>();
  let renamed = 0;
  let added = 0;
  let retired = 0;
  for (const [i, [code, name, archetype, pluralName]] of FACILITY_CATALOGUE.entries()) {
    const category = DEFAULT_FACILITIES.find((d) => d.code === code)?.category ?? FACILITY_ARCHETYPE_META[archetype].label;
    const data = { name, archetype, category, pluralName: pluralName ?? null, isRetired: false, sortOrder: (i + 1) * 10 };
    const row = byCode.get(code);
    if (row) {
      if (row.name !== name) renamed += 1;
      await prisma.facility.update({ where: { id: row.id }, data });
      kept.set(code, row.id);
    } else {
      kept.set(code, (await prisma.facility.create({ data: { tenantId, code, ...data } })).id);
      added += 1;
    }
    await prisma.boqItem.updateMany({ where: { facilityUnit: { facilityId: kept.get(code)! } }, data: { section: name } });
  }
  for (const f of existing.filter((x) => !kept.has(x.code))) {
    // The closest register facility: the first of the same archetype.
    const target = FACILITY_CATALOGUE.find(([, , archetype]) => archetype === f.archetype)!;
    await prisma.facilityUnit.updateMany({ where: { facilityId: f.id }, data: { facilityId: kept.get(target[0])! } });
    await prisma.boqItem.updateMany({ where: { facilityUnit: { facilityId: kept.get(target[0])! } }, data: { section: target[1] } });
    if (!f.isRetired) {
      await prisma.facility.update({ where: { id: f.id }, data: { isRetired: true } });
      retired += 1;
    }
  }
  return { renamed, added, retired };
}

// ---- 5. Sites ------------------------------------------------------------------------------------

type SiteRow = [school: string, level: SchoolLevel, lgaCode: string, lat: number | null, lng: number | null];
interface SitePlan {
  sites: SiteRow[];
  /** Site number per existing unit (sort order) that has no site yet; default round-robin. */
  assign?: number[];
  /** Legacy BoQ lines without a unit: each becomes a unit at this site number (in WBS order). */
  legacySites?: number[];
  /** New units (light demo data), so no site is empty. */
  extra?: UnitSeed[];
  /** Contract sum = the BoQ total after the change (projects whose sum came from light scope). */
  contractSumFromLines?: boolean;
}

const BLOCK_RENOVATION: LineSeed = ["Renovation of classroom blocks: roofing, doors, windows, plaster and paint", "item", 1, 42_000_000];
const DESKS: LineSeed = ["Two-seater pupils' desk and chair", "nr", 120, 85_000];
const VIP_TOILET: LineSeed = ["VIP toilet block, complete", "item", 1, 9_800_000];
const BOREHOLE_LINE: LineSeed = ["Motorized borehole, complete with pump and tank stand", "item", 1, 14_500_000];

/** Demo 2 (#2): six schools; the classroom blocks at sites 1 and 3 end in work phase 2 (ended) unfinished. */
/**
 * Part 3: Demo 2's Matching Grants classroom block (smaller than the Direct Intervention one), so its
 * contract sum (₦82.3m) sits within its ₦84.0m budget, 17% over the approved BEAP (₦71.5m).
 */
function mgClassroomBlock(progressPct: number): UnitSeed {
  return {
    facility: "CLASSROOM",
    label: "Block of two classrooms with office & store",
    progressPct,
    lines: [
      ["Substructure: excavation, foundations and ground floor slab", "m2", 120, 48_000],
      ["Superstructure: block walls, columns, lintels and roof", "m2", 120, 75_000],
      ["Finishes: plaster, paint, doors and windows", "m2", 340, 12_500],
    ],
  };
}

const DEMO2_UNITS: UnitSeed[] = [
  { ...mgClassroomBlock(45), site: 1, startSprint: 1, endSprint: 2 },
  { facility: "TOILET", label: "VIP toilet block (4 compartments)", site: 2, startSprint: 2, endSprint: 3, progressPct: 30, lines: [VIP_TOILET] },
  { ...mgClassroomBlock(35), site: 3, startSprint: 1, endSprint: 2 },
  { ...mgClassroomBlock(20), label: "Block of two classrooms", site: 4, startSprint: 2, endSprint: 3 },
  { facility: "TOILET", label: "VIP toilet block (4 compartments)", site: 5, startSprint: 2, endSprint: 3, progressPct: 15, lines: [VIP_TOILET] },
  {
    facility: "PUPILS_FURNITURE",
    label: "Child-size tables and chairs",
    site: 6,
    startSprint: 3,
    endSprint: 3,
    progressPct: 0,
    plannedQuantity: 60,
    lines: [["Child-size table with four chairs", "nr", 60, 95_000]],
  },
];

const SITE_PLANS: Record<number, SitePlan> = {
  1: {
    sites: [
      ["LEA Primary School, Garki", "PRIMARY", "FC-ABUJA-MUNICIPAL", 9.0335, 7.4892],
      ["Government Junior Secondary School, Wuse", "JSS", "FC-ABUJA-MUNICIPAL", 9.0702, 7.4655],
      ["Model ECCDE Centre, Asokoro", "ECCDE", "FC-ABUJA-MUNICIPAL", 9.0431, 7.5262],
    ],
    assign: [1, 2],
    extra: [
      {
        facility: "PUPILS_FURNITURE",
        label: "Child-size tables and chairs",
        site: 3,
        startSprint: 3,
        endSprint: 3,
        progressPct: 0,
        plannedQuantity: 60,
        lines: [["Child-size table with four chairs", "nr", 60, 95_000]],
      },
    ],
    contractSumFromLines: true,
  },
  2: {
    sites: [
      ["Dala Model Primary School", "PRIMARY", "KN-DALA", 12.0012, 8.5052],
      ["LGEA Primary School, Kofar Mazugal", "PRIMARY", "KN-DALA", 12.0086, 8.5121],
      ["Government Junior Secondary School, Gwale", "JSS", "KN-GWALE", 11.9851, 8.4949],
      ["LGEA Primary School, Dorayi", "PRIMARY", "KN-GWALE", 11.9702, 8.4781],
      ["LGEA Primary School, Jakara", "PRIMARY", "KN-KANO-MUNICIPAL", 11.9991, 8.5199],
      ["Model ECCDE Centre, Kofar Mata", "ECCDE", "KN-KANO-MUNICIPAL", 11.9928, 8.5148],
    ],
  },
  3: {
    sites: [
      ["LGEA Primary School, Mushin", "PRIMARY", "LA-MUSHIN", 6.5275, 3.3416],
      ["Government Junior Secondary School, Idi-Araba", "JSS", "LA-MUSHIN", 6.5182, 3.3528],
    ],
    legacySites: [1, 2, 2],
  },
  4: {
    sites: [
      ["Government Technical College, Yaba", "JSS", "LA-LAGOS-MAINLAND", 6.5052, 3.3781],
      ["LGEA Primary School, Ebute-Metta", "PRIMARY", "LA-LAGOS-MAINLAND", 6.4862, 3.3812],
    ],
    extra: [
      { facility: "CLASSROOM", label: "Renovation of two classroom blocks", site: 1, progressPct: 100, lines: [BLOCK_RENOVATION] },
      { facility: "PUPILS_FURNITURE", label: "Pupils' desks and chairs", site: 2, progressPct: 100, plannedQuantity: 120, lines: [DESKS] },
    ],
  },
  5: {
    sites: [["Junior Model College, Lagos Island", "JSS", "LA-LAGOS-ISLAND", 6.4549, 3.3941]],
    extra: [
      { facility: "CLASSROOM", label: "Renovation of the classroom block", site: 1, progressPct: 100, lines: [["Renovation of the classroom block: roofing, doors, windows, plaster and paint", "item", 1, 36_000_000]] },
      { facility: "ICT_EQUIPMENT", label: "Computer room equipment", site: 1, progressPct: 100, plannedQuantity: 20, lines: [["Desktop computer with UPS, installed", "nr", 20, 650_000]] },
    ],
  },
  6: {
    sites: [
      ["LEA Primary School, Kawo", "PRIMARY", "KD-KADUNA-NORTH", 10.5826, 7.4421],
      ["Government Junior Secondary School, Unguwan Rimi", "JSS", "KD-KADUNA-NORTH", 10.5614, 7.4498],
    ],
  },
  7: {
    sites: [
      ["Government Girls' Junior Secondary School, Minna", "JSS", "NI-CHANCHAGA", 9.6142, 6.5571],
      ["LGEA Primary School, Tunga", "PRIMARY", "NI-CHANCHAGA", 9.6003, 6.5489],
    ],
  },
  8: {
    sites: [
      ["Model Junior Secondary School, Sokoto", "JSS", "SO-SOKOTO-NORTH", 13.0625, 5.2341],
      ["LGEA Primary School, Mabera", "PRIMARY", "SO-SOKOTO-SOUTH", 13.0418, 5.2465],
      ["LGEA Primary School, Arkilla", "PRIMARY", "SO-WAMAKO", 13.0479, 5.1983],
    ],
  },
  9: {
    sites: [
      ["Community Primary School, Ogui", "PRIMARY", "EN-ENUGU-NORTH", 6.4423, 7.4951],
      ["LGEA Primary School, Asata", "PRIMARY", "EN-ENUGU-NORTH", 6.4478, 7.5012],
      ["Government Junior Secondary School, Abakpa Nike", "JSS", "EN-ENUGU-EAST", 6.4852, 7.5296],
      ["LGEA Primary School, Uwani", "PRIMARY", "EN-ENUGU-SOUTH", 6.4298, 7.4897],
    ],
    extra: [
      { facility: "BOREHOLE", label: "Motorized borehole with overhead tank", site: 1, progressPct: 100, lines: [BOREHOLE_LINE] },
      { facility: "TOILET", label: "VIP toilet block (4 compartments)", site: 2, progressPct: 100, lines: [VIP_TOILET] },
      { facility: "TOILET", label: "VIP toilet block (4 compartments)", site: 3, progressPct: 100, lines: [VIP_TOILET] },
      { facility: "BOREHOLE", label: "Motorized borehole with overhead tank", site: 4, progressPct: 100, lines: [BOREHOLE_LINE] },
    ],
  },
  10: {
    sites: [
      ["Community Junior Secondary School, Rumuokoro", "JSS", "RI-OBIO-AKPOR", 4.8682, 6.9958],
      ["LGEA Primary School, Rumuola", "PRIMARY", "RI-OBIO-AKPOR", 4.8349, 7.0047],
    ],
    extra: [
      { facility: "TOILET", label: "VIP toilet block (6 compartments)", site: 1, progressPct: 100, lines: [["VIP toilet block, complete", "item", 1, 13_200_000]] },
      { facility: "FENCE", label: "Perimeter fence with gate (350 m)", site: 2, progressPct: 100, lines: [["Block perimeter fence with steel gate", "m", 350, 48_000]] },
    ],
  },
  11: {
    sites: [
      ["LEA Primary School, Bwari", "PRIMARY", "FC-BWARI", 9.2836, 7.3835],
      ["LEA Primary School, Kubwa", "PRIMARY", "FC-BWARI", null, null],
    ],
  },
  12: {
    sites: [
      ["Central Primary School, Asaba", "PRIMARY", "DE-OSHIMILI-SOUTH", 6.2012, 6.7335],
      ["Government Junior Secondary School, Okwe", "JSS", "DE-OSHIMILI-SOUTH", 6.2168, 6.7046],
      ["Model ECCDE Centre, Cable Point", "ECCDE", "DE-OSHIMILI-SOUTH", 6.1925, 6.7441],
      ["Ogbeowa Primary School, Ibusa", "PRIMARY", "DE-OSHIMILI-NORTH", 6.1716, 6.6412],
    ],
    extra: [{ facility: "TOILET", label: "VIP toilet block (4 compartments)", site: 4, startSprint: 2, endSprint: 3, progressPct: 15, lines: [VIP_TOILET] }],
    contractSumFromLines: true,
  },
  13: {
    sites: [
      ["LGEA Primary School, Bompai", "PRIMARY", "KN-NASARAWA", 12.0203, 8.5452],
      ["Government Junior Secondary School, Tudun Murtala", "JSS", "KN-NASARAWA", 12.0281, 8.5598],
      ["LGEA Primary School, Gama", "PRIMARY", "KN-NASARAWA", 11.9948, 8.5652],
    ],
  },
  14: {
    sites: [
      ["LEA Primary School, Tudun Wada, Zaria", "PRIMARY", "KD-ZARIA", 11.0805, 7.7102],
      ["Government Junior Secondary School, Kofar Doka", "JSS", "KD-ZARIA", 11.0652, 7.7048],
      ["Model ECCDE Centre, Samaru", "ECCDE", "KD-SABON-GARI", 11.1648, 7.6503],
    ],
  },
  15: {
    sites: [
      ["LGEA Primary School, Bulumkutu", "PRIMARY", "BO-MAIDUGURI", 11.8335, 13.1512],
      ["Government Junior Secondary School, Gwange", "JSS", "BO-MAIDUGURI", 11.8452, 13.1698],
    ],
    assign: [1, 2, 1],
  },
  16: {
    sites: [
      ["LGEA Primary School, Agbowo", "PRIMARY", "OY-IBADAN-NORTH", 7.4382, 3.9102],
      ["LGEA Primary School, Bodija", "PRIMARY", "OY-IBADAN-NORTH", 7.4301, 3.9049],
      ["Government Junior Secondary School, Mokola", "JSS", "OY-IBADAN-NORTH", 7.4048, 3.8952],
      ["LGEA Primary School, Iwo Road", "PRIMARY", "OY-IBADAN-NORTH-EAST", 7.4003, 3.9301],
      ["Model ECCDE Centre, Moniya", "ECCDE", "OY-AKINYELE", 7.5298, 3.9198],
    ],
    extra: [
      { facility: "TOILET", label: "VIP toilet block (4 compartments)", site: 3, startSprint: 2, endSprint: 2, progressPct: 100, lines: [VIP_TOILET] },
      { facility: "BOREHOLE", label: "Motorized borehole with overhead tank", site: 4, startSprint: 1, endSprint: 1, progressPct: 100, lines: [BOREHOLE_LINE] },
      // Mixed: the Moniya toilet block is unfinished after its work phase ended (Behind).
      { facility: "TOILET", label: "VIP toilet block (4 compartments)", site: 5, startSprint: 2, endSprint: 2, progressPct: 80, lines: [VIP_TOILET] },
    ],
    contractSumFromLines: true,
  },
  17: {
    sites: [
      ["Community Junior Secondary School, Ake", "JSS", "OG-ABEOKUTA-SOUTH", 7.1559, 3.3453],
      ["LGEA Primary School, Isale-Igbein", "PRIMARY", "OG-ABEOKUTA-SOUTH", 7.1452, 3.3501],
    ],
  },
  18: {
    sites: [
      ["Central School, Awka", "PRIMARY", "AN-AWKA-SOUTH", 6.2102, 7.0702],
      ["Model ECCDE Centre, Amawbia", "ECCDE", "AN-AWKA-SOUTH", 6.1951, 7.0398],
      ["Government Junior Secondary School, Nibo", "JSS", "AN-AWKA-SOUTH", 6.1802, 7.0598],
    ],
  },
};

/** The story's sites (written directly), each located one with a radial boundary of the default radius. */
async function createSites(ctx: Ctx, projectId: string, n: number): Promise<string[]> {
  const s = story0(n);
  const state = stateByCode(s.stateCode)!;
  const ids: string[] = [];
  for (const [i, [school, level, lgaCode, lat, lng]] of SITE_PLANS[n].sites.entries()) {
    const lga = lgaByCode(lgaCode);
    if (!lga || lga.stateCode !== s.stateCode) throw new Error(`Demo overlay sites: ${lgaCode} is not in ${s.stateCode}`);
    const located = lat !== null && lng !== null;
    const row = await prisma.projectSite.create({
      data: {
        projectId,
        siteNumber: i + 1,
        schoolName: school,
        schoolLevel: level,
        lgaCode,
        address: `${school}, ${lga.name} LGA, ${state.name}`,
        latitude: lat,
        longitude: lng,
        boundaryJson: located
          ? { mode: "RADIAL", center: { latitude: lat, longitude: lng }, radiusMeters: ctx.defaultRadiusMeters, siteLabel: school.slice(0, 120) }
          : Prisma.DbNull,
      },
    });
    ids.push(row.id);
  }
  return ids;
}

const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();

/** Every unit names a site; legacy lines get units; empty sites get light units. */
async function placeUnits(ctx: Ctx, projectId: string, siteIds: string[], plan: SitePlan): Promise<void> {
  const units = await prisma.facilityUnit.findMany({ where: { projectId }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }], select: { id: true, siteId: true } });
  for (const [i, u] of units.entries()) {
    if (u.siteId) continue;
    const site = plan.assign?.[i] ?? (i % siteIds.length) + 1;
    await prisma.facilityUnit.update({ where: { id: u.id }, data: { siteId: siteIds[site - 1] } });
  }
  let index = units.length;
  let changed = false;
  if (plan.legacySites) {
    const lines = await prisma.boqItem.findMany({ where: { projectId, facilityUnitId: null }, orderBy: { wbsCode: "asc" } });
    for (const [j, line] of lines.entries()) {
      const section = line.section ?? "";
      const code = /toilet/i.test(section) ? "TOILET" : /borehole/i.test(section) ? "BOREHOLE" : "CLASSROOM";
      const facility = await prisma.facility.findUniqueOrThrow({ where: { tenantId_code: { tenantId: ctx.tenantId, code } } });
      const pct = Number(line.cumulativeCertifiedPct ?? 0);
      const unit = await prisma.facilityUnit.create({
        data: {
          projectId,
          facilityId: facility.id,
          code: `U${String(index + 1).padStart(2, "0")}`,
          label: sentenceCase(section || facility.name),
          siteId: siteIds[(plan.legacySites[j] ?? 1) - 1],
          sortOrder: (index + 1) * 10,
          progressPct: pct,
        },
      });
      index += 1;
      await prisma.boqItem.update({ where: { id: line.id }, data: { facilityUnitId: unit.id, section: facility.name } });
      changed = true;
    }
  }
  if (plan.extra?.length) {
    const sprintIds = (await prisma.projectSprint.findMany({ where: { projectId }, orderBy: { number: "asc" }, select: { id: true } })).map((x) => x.id);
    // WBS groups after the highest already used (older seeds number lines their own way).
    const used = (await prisma.boqItem.findMany({ where: { projectId }, select: { wbsCode: true } })).map((l) => parseInt(l.wbsCode, 10)).filter((x) => Number.isFinite(x));
    let group = Math.max(index, ...used) + 1;
    for (const u of plan.extra) {
      await createUnit(ctx, projectId, index, u, sprintIds, siteIds[(u.site ?? 1) - 1], group++);
      index += 1;
    }
    changed = true;
  }
  if (changed) {
    const hasSprints = (await prisma.projectSprint.count({ where: { projectId } })) > 0;
    await prisma.$transaction(async (tx) => {
      if (hasSprints) await deriveLineDatesFromSprints(tx, projectId);
      await refreshProjectProgress(tx, projectId);
    });
  }
  if (plan.contractSumFromLines) {
    const sum = await prisma.boqItem.aggregate({ where: { projectId }, _sum: { budgetedCostNgn: true } });
    await prisma.project.update({ where: { id: projectId }, data: { contractSumNgn: sum._sum.budgetedCostNgn } });
  }
}

// ---- 6. Contractor register --------------------------------------------------------------------

interface ContractorSeed {
  name: string;
  rc: string;
  tin: string;
  stateCode: string;
  address: string;
  email: string;
  phone: string;
  status: "ACTIVE" | "INACTIVE";
  stories: number[];
}

/** 10 fictional contractors (the first five already exist: Phase 11 and part 1). */
const CONTRACTORS: ContractorSeed[] = [
  { name: "Sahel Build & Civil Works Ltd", rc: "RC 1184523", tin: "10482731-0001", stateCode: "KN", address: "14 Zaria Road, Gyadi-Gyadi, Kano", email: "contracts@sahelbuild.example.com", phone: "+234 803 555 0301", status: "ACTIVE", stories: [2, 8] },
  { name: "Arewa Classic Builders Ltd", rc: "RC 1427716", tin: "11930457-0001", stateCode: "KD", address: "7 Ahmadu Bello Way, Kaduna", email: "info@arewaclassic.example.com", phone: "+234 803 555 0302", status: "ACTIVE", stories: [6, 14] },
  { name: "Zuma Rock Construction Company Ltd", rc: "RC 987342", tin: "09876214-0001", stateCode: "FC", address: "Plot 1123 Aminu Kano Crescent, Wuse II, Abuja", email: "projects@zumarock.example.com", phone: "+234 803 555 0303", status: "ACTIVE", stories: [1, 11, 12] },
  { name: "Eastline Engineering Nigeria Ltd", rc: "RC 1563208", tin: "13204589-0001", stateCode: "AN", address: "21 Zik Avenue, Awka", email: "tenders@eastline.example.com", phone: "+234 803 555 0304", status: "ACTIVE", stories: [18] },
  { name: "Olumo Works & Services Ltd", rc: "RC 1702945", tin: "14572380-0001", stateCode: "OG", address: "12 Lalubu Street, Oke-Ilewo, Abeokuta", email: "admin@olumoworks.example.com", phone: "+234 803 555 0305", status: "INACTIVE", stories: [17] },
  { name: "Danjuma & Sons Construction Ltd", rc: "RC 845117", tin: "08451173-0001", stateCode: "BO", address: "5 Baga Road, Maiduguri", email: "office@danjumasons.example.com", phone: "+234 803 555 0306", status: "ACTIVE", stories: [15] },
  { name: "Oduduwa Builders & Engineering Ltd", rc: "RC 1290384", tin: "12903841-0001", stateCode: "OY", address: "34 Ring Road, Ibadan", email: "info@oduduwabuilders.example.com", phone: "+234 803 555 0307", status: "ACTIVE", stories: [5, 16] },
  { name: "Lagoon City Contractors Ltd", rc: "RC 1035672", tin: "10356720-0001", stateCode: "LA", address: "8 Ikorodu Road, Yaba, Lagos", email: "contracts@lagooncity.example.com", phone: "+234 803 555 0308", status: "ACTIVE", stories: [3, 4] },
  { name: "Garden City Works Nigeria Ltd", rc: "RC 1129450", tin: "11294503-0001", stateCode: "RI", address: "17 Aba Road, Port Harcourt", email: "info@gardencityworks.example.com", phone: "+234 803 555 0309", status: "ACTIVE", stories: [9, 10] },
  { name: "Kainji Works & Engineering Ltd", rc: "RC 1648821", tin: "16488219-0001", stateCode: "NI", address: "3 Paiko Road, Minna", email: "projects@kainjiworks.example.com", phone: "+234 803 555 0310", status: "ACTIVE", stories: [7, 13] },
];

/** Register fields on the 10 contractors; each project's contractor row re-pointed to its story's firm. */
async function contractorRegister(ctx: Ctx, idByStory: Map<number, string>): Promise<Map<string, string>> {
  const covered = CONTRACTORS.flatMap((c) => c.stories).sort((a, b) => a - b);
  if (covered.join(",") !== STORIES.map((s) => s.n).join(",")) throw new Error("Demo overlay: every story needs exactly one contractor");
  const out = new Map<string, string>();
  for (const c of CONTRACTORS) {
    const data = {
      categories: ["CONTRACTOR" as const],
      registrationNumber: c.rc,
      tin: c.tin,
      address: c.address,
      stateCode: c.stateCode,
      contactEmail: c.email,
      contactPhone: c.phone,
      contractorStatus: c.status,
    };
    const existing = await prisma.organization.findFirst({ where: { tenantId: ctx.tenantId, name: { equals: c.name, mode: "insensitive" } } });
    const org = existing
      ? await prisma.organization.update({ where: { id: existing.id }, data })
      : await prisma.organization.create({ data: { tenantId: ctx.tenantId, name: c.name, ...data } });
    out.set(c.name, org.id);
    for (const n of c.stories) {
      const projectId = idByStory.get(n)!;
      const pc = await prisma.projectContractor.findFirst({ where: { projectId }, orderBy: { createdAt: "asc" } });
      if (!pc || pc.organizationId === org.id) continue;
      // The row keeps its id, so findings, defects, default cases and closure ratings follow.
      await prisma.kickoffInvitee.updateMany({ where: { organizationId: pc.organizationId, meeting: { projectId } }, data: { organizationId: org.id, name: c.name } });
      await prisma.projectContractor.update({ where: { id: pc.id }, data: { organizationId: org.id } });
    }
  }
  return out;
}

// ---- Monitoring reports: shared helpers ---------------------------------------------------------

const SEED_DEVICE = "SEED-EVALUATION"; // the device seedPhase15 gives its evaluation reporters
const WORKMANSHIP_PATH = "s:WORKMANSHIP/workmanship";

/** The reporter's seed field session on the project (one account, one device, one project). */
async function fieldSession(reporter: WebJwtPayload, projectId: string): Promise<string> {
  let device = await prisma.mobileDevice.findFirst({ where: { userId: reporter.userId, deviceId: SEED_DEVICE } });
  if (!device) {
    const raw = crypto.randomBytes(32);
    device = await prisma.mobileDevice.create({
      data: {
        userId: reporter.userId,
        deviceId: SEED_DEVICE,
        deviceModel: "Seed evaluation device",
        publicKey: raw.toString("base64"),
        publicKeyAlg: DEVICE_SIGNATURE_ALGORITHM,
        publicKeyId: crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16),
      },
    });
  }
  const session =
    (await prisma.fieldAgentSession.findFirst({ where: { userId: reporter.userId, projectId, deviceId: SEED_DEVICE } })) ??
    (await prisma.fieldAgentSession.create({
      data: {
        projectId,
        userId: reporter.userId,
        mobileDeviceId: device.id,
        roleId: reporter.roleId,
        roleNameSnapshot: reporter.roleName,
        agentFullName: reporter.fullName,
        agentPhoneNumber: "",
        deviceId: SEED_DEVICE,
        isActive: false,
      },
    }));
  return session.id;
}

type CaptureRef = { clientCaptureId: string; unitId: string | null; kind: "PHOTO" };
type SeedAnswer = { path: string; value: string | number | string[] | null; comment: string | null; captures: CaptureRef[] };

function stageFor(pct: number): string {
  return pct >= 100 ? "complete" : pct >= 80 ? "finishes" : pct >= 65 ? "roofing" : pct >= 35 ? "superstructure" : "substructure";
}

/**
 * Answers for a frozen form, consistent with the units' progress: % complete, stage and quantity
 * fields follow `progress`; everything else answers as a sound site would; `overrides` and re-check
 * outcomes win. With `photo`, photo questions (and rule-driven photos) get captures.
 */
function seedAnswers(
  snapshot: VisitFormSnapshot,
  o: {
    progress: Map<string, number>;
    overrides?: Record<string, { value: string | number; comment: string | null }>;
    recheck?: (findingId: string) => { value: "YES" | "NO"; comment: string };
    photo?: (path: string, unitId: string | null) => CaptureRef;
    extraPhotoPaths?: string[];
  }
): SeedAnswer[] {
  const values = [...o.progress.values()];
  const overall = values.length ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : 50;
  const out: SeedAnswer[] = [];
  for (const b of snapshot.blocks) {
    for (const f of b.fields) {
      const unitIds = f.unitId ? [f.unitId] : b.units.map((u) => u.id);
      const pct = unitIds.length ? Math.round(unitIds.reduce((s, id) => s + (o.progress.get(id) ?? 0), 0) / unitIds.length) : overall;
      if (f.type === "VOICE_NOTE") continue;
      if (f.type === "PHOTO") {
        if (!o.photo || !f.photo) continue;
        const refs =
          f.photo.mode === "AT_LEAST_N"
            ? Array.from({ length: Math.max(1, f.photo.minCount) }, () => o.photo!(f.path, f.unitId))
            : f.photo.slots.map((slot) => o.photo!(f.path, slot.unitId));
        if (refs.length) out.push({ path: f.path, value: null, comment: null, captures: refs });
        continue;
      }
      let value: SeedAnswer["value"] = null;
      let comment: string | null = null;
      if (f.type === "SHORT_TEXT" || f.type === "LONG_TEXT") value = "Checked on site";
      if (f.type === "NUMBER") value = f.key === "workers" ? 14 + (overall % 9) : f.boundedByPlannedQuantity && f.plannedQuantity !== null ? f.plannedQuantity : Math.max(1, f.min ?? 1);
      if (f.type === "PERCENTAGE") value = pct;
      if (f.type === "RATING_1_5") value = 4;
      if (f.type === "YES_NO") value = f.key === "incidents" ? "NO" : "YES";
      if (f.type === "SINGLE_CHOICE") value = f.options[0]?.key ?? null;
      if (f.type === "MULTI_CHOICE") value = f.options.slice(0, Math.max(1, f.minSelected ?? 1)).map((x) => x.key);
      if (f.type === "DATE") value = snapshot.context.visitDate;
      if (b.facility && unitIds.length) {
        const kind = f.signal?.kind;
        if (kind === "PERCENT_COMPLETE") value = pct;
        if (kind === "QUANTITY_DELIVERED") value = f.plannedQuantity !== null ? Math.round((f.plannedQuantity * pct) / 100) : 0;
        if (kind === "UNIT_COMPLETE" && f.type === "SINGLE_CHOICE" && f.options.some((x) => x.key === "complete")) value = stageFor(pct);
        if (kind === "UNIT_COMPLETE" && f.type === "YES_NO") value = pct >= 100 ? "YES" : f.allowNa ? "NA" : "YES";
        if (f.key === "installed" || f.key === "installed-in-use") value = pct >= 100 ? "YES" : "NO";
      }
      let captures: CaptureRef[] = [];
      if (f.recheck && o.recheck) {
        const r = o.recheck(f.recheck.id);
        value = r.value;
        comment = r.comment;
        if (r.value === "YES" && o.photo) captures = [o.photo(f.path, f.unitId)];
      }
      const override = o.overrides?.[f.path];
      if (override) {
        value = override.value;
        comment = override.comment;
      }
      if (o.photo && o.extraPhotoPaths?.includes(f.path)) captures = [...captures, o.photo(f.path, f.unitId)];
      out.push({ path: f.path, value, comment, captures });
    }
  }
  return out;
}

/** The work phase a date falls in (null outside every phase). */
async function sprintOn(tx: Prisma.TransactionClient, projectId: string, date: string): Promise<string | null> {
  const s = await tx.projectSprint.findFirst({ where: { projectId, startDate: { lte: date }, endDate: { gte: date } }, select: { id: true } });
  return s?.id ?? null;
}

// ---- Placeholder site photos (PNG, written to storage so the web shows them) --------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A simple drawn site scene (sky, ground, a block rising with progress); `seed` varies it. */
function sitePhoto(seed: number, progress: number): Buffer {
  const W = 320;
  const H = 240;
  const horizon = 170;
  const bx = 50 + ((seed * 37) % 90);
  const bw = 150;
  const bh = Math.round(24 + 96 * Math.min(1, Math.max(0, progress) / 100));
  const top = horizon - bh;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    const row = y * (W * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < W; x++) {
      let r: number;
      let g: number;
      let b: number;
      if (y < horizon) {
        const t = y / horizon;
        r = Math.round(110 + 95 * t + (seed % 3) * 8);
        g = Math.round(165 + 60 * t);
        b = Math.round(225 + 15 * t);
      } else {
        const n = (x * 7 + y * 13 + seed * 5) % 11;
        r = 160 + n;
        g = 118 + n;
        b = 72 + n;
      }
      const inBlock = x >= bx && x < bx + bw && y >= top && y < horizon;
      if (inBlock) {
        const mortar = (y - top) % 9 === 0 || (x - bx + ((Math.floor((y - top) / 9) % 2) * 9)) % 18 === 0;
        [r, g, b] = mortar ? [140, 136, 128] : [186, 180, 168];
        const wy = (y - top) % 40;
        const wx = (x - bx) % 38;
        if (progress >= 50 && bh > 60 && wy >= 14 && wy < 30 && wx >= 12 && wx < 28) [r, g, b] = [58, 68, 82];
      }
      const roofBand = progress >= 70 && y >= top - 16 && y < top && Math.abs(x - (bx + bw / 2)) <= bw / 2 + 10 - (top - y) * 0.6;
      if (roofBand) [r, g, b] = [146, 62, 44];
      const pole = progress < 70 && (Math.abs(x - (bx - 6)) <= 1 || Math.abs(x - (bx + bw + 5)) <= 1) && y >= top - 12 && y < horizon;
      if (pole) [r, g, b] = [120, 84, 46];
      const o = row + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

interface CaptureSpec {
  clientCaptureId: string;
  path: string;
  unitId: string | null;
  latitude: number;
  longitude: number;
  progress: number;
  seed: number;
  caption: string;
}

/** A registered, geotagged photo linked to a submission answer, with its image in storage. */
async function createCapture(
  tx: Prisma.TransactionClient,
  ctx: Ctx,
  p: { projectId: string; sessionId: string; reporter: WebJwtPayload; submissionId: string; at: Date },
  spec: CaptureSpec
): Promise<void> {
  const body = sitePhoto(spec.seed, spec.progress);
  const sha = crypto.createHash("sha256").update(body).digest("hex");
  const objectKey = `${projectObjectPrefix(ctx.tenantId, p.projectId)}seed/${spec.clientCaptureId}.png`;
  await storageService.putServerObject(objectKey, body, "image/png");
  await tx.fieldEvidenceLog.create({
    data: {
      projectId: p.projectId,
      fieldSessionId: p.sessionId,
      clientCaptureId: spec.clientCaptureId,
      reporterRoleId: p.reporter.roleId,
      reporterRoleName: p.reporter.roleName,
      status: "REGISTERED",
      caption: spec.caption,
      locationAvailable: true,
      latitude: spec.latitude,
      longitude: spec.longitude,
      gpsAccuracyMeters: 5,
      headingDegrees: (spec.seed * 47) % 360,
      isMockLocation: false,
      isWithinGeofence: true,
      geofenceStatus: "INSIDE",
      distanceOutsideMeters: 0,
      distanceFromSiteMeters: 15,
      signatureVerified: null,
      serverSha256: sha,
      clientSha256: sha,
      integrityPassed: true,
      integrityFlags: ["SEED_FIXTURE"] as unknown as Prisma.InputJsonValue,
      visitSubmissionId: p.submissionId,
      visitAnswerPath: spec.path,
      facilityUnitId: spec.unitId,
      capturedAtDevice: new Date(p.at.getTime() + spec.seed * 60_000),
      mediaAttachments: {
        create: {
          tenantId: ctx.tenantId,
          projectId: p.projectId,
          mediaType: "SITE_PHOTO",
          objectKey,
          mimeType: "image/png",
          byteSize: body.length,
          sha256FileHash: sha,
        },
      },
    },
  });
}

// ---- 7. Demo 1 monitoring story (real acceptance) ------------------------------------------------

interface Demo1Report {
  daysAgo: number;
  /** % complete per unit code; units outside the visit's work phase are not on its form. */
  progress: Record<string, number>;
  workmanship: number;
  onProgramme: number;
  summary: string;
  ppeNotWorn?: boolean;
  rectify?: boolean;
}

const DEMO1_REPORTS: Demo1Report[] = [
  { daysAgo: 47, progress: { U01: 55 }, workmanship: 5, onProgramme: 5, summary: "Routine monitoring visit: block walls up to lintel level at Garki; lintel formwork in place. Blocks and reinforcement on site match the specification." },
  { daysAgo: 40, progress: { U01: 62 }, workmanship: 4, onProgramme: 4, summary: "Routine monitoring visit: lintels cast; roof trusses being fabricated on site. Workers in PPE." },
  {
    daysAgo: 33,
    progress: { U01: 68 },
    workmanship: 4,
    onProgramme: 4,
    ppeNotWorn: true,
    summary: "Routine monitoring visit: roof trusses going up. Two labourers on the roof without helmets or harnesses: finding raised and the site agent told on the day.",
  },
  {
    daysAgo: 26,
    progress: { U01: 73 },
    workmanship: 5,
    onProgramme: 5,
    rectify: true,
    summary: "Routine monitoring visit: roof covering under way. Follow-up check on the PPE finding: rectified, every worker in a helmet, boots and a vest, harnesses in use on the roof.",
  },
  { daysAgo: 19, progress: { U01: 78 }, workmanship: 4, onProgramme: 4, summary: "Routine monitoring visit: roofing complete on the classroom block; ceiling and electrical first fix started." },
  { daysAgo: 12, progress: { U01: 82, U02: 20, U03: 0 }, workmanship: 5, onProgramme: 5, summary: "Routine monitoring visit: plastering started at Garki; toilet block foundations cast at Wuse; furniture order placed for Asokoro." },
  { daysAgo: 5, progress: { U01: 86, U02: 40, U03: 0 }, workmanship: 4, onProgramme: 4, summary: "Routine monitoring visit: plastering and painting under way on the classroom block; toilet block walls up." },
];

/**
 * Demo 1 (#1): weekly routine reports by the Resident Supervisor, accepted by the M&E Officer through
 * the real acceptance (`acceptSubmission`: findings from the form rules, the follow-up check, unit
 * progress and the STALLED fact); the visit and submission rows and the captures are written directly
 * (light demo data), photos geotagged at the unit's school. Then interim payments in three quarters.
 */
async function demo1MonitoringStory(ctx: Ctx, projectId: string): Promise<void> {
  const reporter = ctx.resident;
  const reviewer = ctx.monitor;
  const sessionId = await fieldSession(reporter, projectId);
  const sites = await prisma.projectSite.findMany({ where: { projectId }, orderBy: { siteNumber: "asc" } });
  const siteById = new Map(sites.map((s) => [s.id, s]));
  const units = await prisma.facilityUnit.findMany({ where: { projectId }, select: { id: true, code: true, siteId: true, label: true } });
  const unitById = new Map(units.map((u) => [u.id, u]));
  const idByCode = new Map(units.map((u) => [u.code, u.id]));
  let seed = 0;
  for (const r of DEMO1_REPORTS) {
    const date = addDays(ctx.today, -r.daysAgo);
    const at = new Date(`${date}T10:30:00.000Z`);
    const submittedAt = new Date(`${date}T13:05:00.000Z`);
    const approvedAt = new Date(`${addDays(date, 1)}T09:15:00.000Z`);
    const progress = new Map<string, number>();
    for (const [code, pct] of Object.entries(r.progress)) if (idByCode.has(code)) progress.set(idByCode.get(code)!, pct);
    await prisma.$transaction(
      async (tx) => {
        const rechecks = (await recheckInputsForProject(tx, projectId, TZ)).filter((x) => x.raisedDate < date);
        const form = await freezeVisitFormSnapshot(tx, {
          projectId,
          visitKind: "ROUTINE",
          visitDate: date,
          rechecks,
          completedUnitIds: await completedUnitIdsFor(tx, projectId),
          builtAt: new Date(`${addDays(date, -3)}T08:00:00.000Z`),
          builtByUserId: reviewer.userId,
        });
        const specs: CaptureSpec[] = [];
        const photo = (path: string, unitId: string | null): CaptureRef => {
          const unit = unitId ? unitById.get(unitId) : undefined;
          const site = (unit?.siteId ? siteById.get(unit.siteId) : undefined) ?? sites[0];
          seed += 1;
          const spec: CaptureSpec = {
            clientCaptureId: crypto.randomUUID(),
            path,
            unitId,
            latitude: round6(site.latitude! + ((seed % 5) - 2) * 0.00012),
            longitude: round6(site.longitude! + ((seed % 3) - 1) * 0.00015),
            progress: unitId ? (progress.get(unitId) ?? 60) : (r.progress.U01 ?? 60),
            seed,
            caption: unit ? `${unit.label}, ${site.schoolName}` : site.schoolName,
          };
          specs.push(spec);
          return { clientCaptureId: spec.clientCaptureId, unitId, kind: "PHOTO" };
        };
        const answers = seedAnswers(form.snapshot, {
          progress,
          overrides: {
            [WORKMANSHIP_PATH]: { value: r.workmanship, comment: null },
            "s:PROGRESS/on-programme": { value: r.onProgramme, comment: null },
            ...(r.ppeNotWorn ? { "s:HEALTH_SAFETY/ppe-worn": { value: "NO", comment: "Two labourers on the roof without helmets or harnesses." } } : {}),
          },
          recheck: () =>
            r.rectify
              ? { value: "YES", comment: `Rectified on the routine monitoring visit of ${date}: every worker on site in a helmet, boots and a high-visibility vest; harnesses in use on the roof.` }
              : { value: "NO", comment: "Not yet rectified." },
          photo,
          extraPhotoPaths: r.ppeNotWorn ? ["s:HEALTH_SAFETY/ppe-worn"] : [],
        });
        const site1 = sites[0];
        const geotag = {
          latitude: site1.latitude,
          longitude: site1.longitude,
          accuracyMeters: 6,
          isMocked: false,
          capturedAt: at.toISOString(),
          isWithinGeofence: true,
          geofenceStatus: "INSIDE",
          distanceOutsideMeters: 0,
          distanceFromSiteMeters: 18,
        };
        const visit = await tx.visit.create({
          data: {
            projectId,
            visitKind: "ROUTINE",
            status: "SUBMITTED",
            originalPlannedDate: date,
            plannedDate: date,
            sprintId: await sprintOn(tx, projectId, date),
            confirmation: "CONFIRMED",
            confirmedAt: new Date(`${addDays(date, -2)}T07:40:00.000Z`),
            formSnapshotId: form.id,
            formHash: form.contentSha256,
            formAssembledAt: new Date(`${addDays(date, -3)}T08:00:00.000Z`),
            submissionDeadline: addDays(date, 2),
            publishedAt: new Date(`${addDays(date, -3)}T08:00:00.000Z`),
            publishedByUserId: reviewer.userId,
            createdByUserId: reviewer.userId,
            checkInAt: at,
            checkInGeotag: geotag as unknown as Prisma.InputJsonValue,
            checkInGeofenceStatus: "INSIDE",
            checkInByUserId: reporter.userId,
            assignees: { create: { userId: reporter.userId, isLead: true } },
          },
        });
        const submission = await tx.visitSubmission.create({
          data: {
            clientSubmissionId: crypto.randomUUID(),
            visitId: visit.id,
            projectId,
            submittedByUserId: reporter.userId,
            fieldSessionId: sessionId,
            reporterName: reporter.fullName,
            reporterRoleName: reporter.roleName,
            formSnapshotId: form.id,
            formHash: form.contentSha256,
            answersJson: answers as unknown as Prisma.InputJsonValue,
            overallFinding: r.ppeNotWorn ? "MINOR_ISSUES" : "SATISFACTORY",
            summaryText: r.summary,
            submissionGeotag: { ...geotag, capturedAt: submittedAt.toISOString() } as unknown as Prisma.InputJsonValue,
            geofenceStatus: "INSIDE",
            confirmedAt: submittedAt,
            receivedAt: submittedAt,
            status: "PENDING_APPROVAL",
          },
        });
        for (const spec of specs) await createCapture(tx, ctx, { projectId, sessionId, reporter, submissionId: submission.id, at }, spec);
        const outbox: AcceptanceOutbox = { emails: [], refreshProjects: new Set() };
        await acceptSubmission(tx, submission.id, { actor: webVisitActor(reviewer), pushes: [], outbox, notifyOfficer: false, now: approvedAt });
        // Findings it raised are dated on the acceptance (the seed runs today).
        await tx.finding.updateMany({ where: { visitSubmissionId: submission.id }, data: { createdAt: approvedAt } });
      },
      { timeout: 60_000 }
    );
  }

  // Interim payments in three quarters of the current fiscal year (the period filter shows them apart);
  // seedPhase16 recorded the one 12 days ago.
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { contractSumNgn: true, codePrefix: true } });
  const sum = Number(project.contractSumNgn ?? 0);
  const sprint1 = await prisma.projectSprint.findFirst({ where: { projectId, number: 1 }, select: { id: true } });
  for (const [n, daysAgo, share, description, sprintId] of [
    // After the award (the advance follows the signed contract), in the previous quarter.
    [2, 130, 0.15, "Mobilisation advance", null],
    [3, 75, 0.2, "Interim payment: substructure and block walls (work phase 1)", sprint1?.id ?? null],
  ] as const) {
    await recordPayment(projectId, ctx.finance, {
      kind: "INTERIM",
      paidOn: addDays(ctx.today, -daysAgo),
      grossAmountNgn: round2(sum * share),
      reference: voucherRef(story0(1), n),
      description,
      sprintId,
    });
  }
}

// ---- 6b. Rating reports (light demo data, written directly) --------------------------------------

interface RatingReport {
  n: number;
  who: "resident" | "monitor" | "lagosMe";
  daysAgo: number;
  workmanship: number;
  summary: string;
  /** A finding the form rules raise from this report's answer (one open per question). */
  finding?: { path: string; value: string | number; comment: string; title: string; severity: "MAJOR" | "MINOR" };
  /** The answer path of an open finding this report's follow-up check finds rectified. */
  rectifies?: string;
}

const POOR_WORK = "Honeycombed columns at the classroom block; blockwork out of plumb and mortar joints uneven.";

const RATING_REPORTS: RatingReport[] = [
  // Zuma Rock (#12; Demo 1's reports come from the story above): about 4.5.
  { n: 12, who: "resident", daysAgo: 34, workmanship: 5, summary: "Routine monitoring visit: foundations complete at Asaba; good concrete finish." },
  { n: 12, who: "resident", daysAgo: 20, workmanship: 4, summary: "Routine monitoring visit: block walls rising; materials to specification." },
  // Sahel Build (Demo 2): five reports within 60 days rate workmanship 3 or less (wave 3 flags it).
  {
    n: 2,
    who: "resident",
    daysAgo: 58,
    workmanship: 2,
    summary: "Routine monitoring visit: poor workmanship on the classroom block at Dala; columns to be hacked and recast.",
    finding: { path: WORKMANSHIP_PATH, value: 2, comment: POOR_WORK, title: "Overall workmanship", severity: "MAJOR" },
  },
  { n: 2, who: "resident", daysAgo: 51, workmanship: 3, summary: "Routine monitoring visit: slow progress at Gwale; few workers on site." },
  {
    n: 2,
    who: "resident",
    daysAgo: 30,
    workmanship: 2,
    summary: "Routine monitoring visit: the recast columns at Dala are still poor; blockwork at Gwale out of plumb.",
    finding: { path: WORKMANSHIP_PATH, value: 2, comment: POOR_WORK, title: "Overall workmanship", severity: "MAJOR" },
  },
  // Arewa Classic (#14): about 3.5–4, a materials finding rectified three weeks later.
  { n: 14, who: "resident", daysAgo: 100, workmanship: 3, summary: "Routine monitoring visit: setting out and excavation; site untidy." },
  {
    n: 14,
    who: "resident",
    daysAgo: 72,
    workmanship: 4,
    summary: "Routine monitoring visit: block walls rising; a batch of sandcrete blocks below the specified strength.",
    finding: { path: "s:MATERIALS/materials-to-spec", value: "NO", comment: "Sandcrete blocks on site below the specified strength (cube test pending).", title: "Materials on site match the specification", severity: "MAJOR" },
  },
  { n: 14, who: "resident", daysAgo: 51, workmanship: 3, summary: "Routine monitoring visit: substandard blocks removed and replaced; test certificates seen.", rectifies: "s:MATERIALS/materials-to-spec" },
  { n: 14, who: "resident", daysAgo: 30, workmanship: 4, summary: "Routine monitoring visit: roofing complete; toilet block walls up." },
  // Eastline (#18): about 3.5–4.
  { n: 18, who: "monitor", daysAgo: 160, workmanship: 4, summary: "Routine monitoring visit: ECCDE block foundations cast." },
  { n: 18, who: "monitor", daysAgo: 130, workmanship: 3, summary: "Routine monitoring visit: ECCDE block walls at lintel level." },
  { n: 18, who: "monitor", daysAgo: 100, workmanship: 3, summary: "Routine monitoring visit: roofing under way; some cracked blocks replaced." },
  { n: 18, who: "monitor", daysAgo: 70, workmanship: 4, summary: "Routine monitoring visit: finishes under way; play area set out." },
  { n: 18, who: "monitor", daysAgo: 40, workmanship: 3, summary: "Routine monitoring visit: play equipment installed; child-size toilets complete." },
  // Lagoon City (#3, #4): about 3.5–4.
  { n: 3, who: "monitor", daysAgo: 480, workmanship: 4, summary: "Routine monitoring visit: classroom block walls up at Mushin." },
  { n: 3, who: "monitor", daysAgo: 450, workmanship: 3, summary: "Routine monitoring visit: toilet block at Idi-Araba behind; borehole drilled." },
  { n: 3, who: "monitor", daysAgo: 420, workmanship: 4, summary: "Routine monitoring visit: classroom block roofed; borehole pump installed." },
  { n: 4, who: "monitor", daysAgo: 45, workmanship: 4, summary: "Routine monitoring visit: renovation of the classroom blocks at Yaba under way." },
  { n: 4, who: "monitor", daysAgo: 20, workmanship: 3, summary: "Routine monitoring visit: painting complete; some door frames to be re-fixed." },
  // Oduduwa (#5, #16): about 3.5–4.
  { n: 16, who: "lagosMe", daysAgo: 200, workmanship: 3, summary: "Routine monitoring visit: borehole drilling at Agbowo; site not fenced." },
  { n: 16, who: "lagosMe", daysAgo: 150, workmanship: 3, summary: "Routine monitoring visit: boreholes complete at Agbowo and Iwo Road." },
  { n: 16, who: "lagosMe", daysAgo: 90, workmanship: 4, summary: "Routine monitoring visit: toilet blocks rising at Bodija and Mokola." },
  { n: 5, who: "monitor", daysAgo: 60, workmanship: 4, summary: "Routine monitoring visit: classroom renovation under way at Lagos Island." },
  { n: 5, who: "monitor", daysAgo: 30, workmanship: 3, summary: "Routine monitoring visit: computers delivered and installed." },
  // Garden City (#9, #10; completed projects only): about 3.5–4.
  { n: 9, who: "lagosMe", daysAgo: 120, workmanship: 3, summary: "Routine monitoring visit: borehole at Ogui drilled; toilet pits dug at Asata and Abakpa Nike." },
  { n: 9, who: "lagosMe", daysAgo: 80, workmanship: 4, summary: "Routine monitoring visit: toilet blocks roofed; borehole at Uwani drilled." },
  { n: 9, who: "lagosMe", daysAgo: 40, workmanship: 4, summary: "Routine monitoring visit: boreholes tested; toilets finished." },
  { n: 10, who: "lagosMe", daysAgo: 110, workmanship: 4, summary: "Routine monitoring visit: toilet block walls up at Rumuokoro." },
  { n: 10, who: "lagosMe", daysAgo: 60, workmanship: 4, summary: "Routine monitoring visit: perimeter fence at Rumuola complete." },
  // Danjuma & Sons (#15, stalled): about 3; nothing accepted for 50 days (STALLED and monitoring overdue stay).
  { n: 15, who: "resident", daysAgo: 85, workmanship: 3, summary: "Routine monitoring visit: setting out at Bulumkutu." },
  { n: 15, who: "resident", daysAgo: 78, workmanship: 4, summary: "Routine monitoring visit: excavation for foundations." },
  { n: 15, who: "resident", daysAgo: 64, workmanship: 3, summary: "Routine monitoring visit: foundations under way; few workers on site." },
  { n: 15, who: "resident", daysAgo: 57, workmanship: 3, summary: "Routine monitoring visit: foundations cast; work slowed down." },
];

/** An accepted routine report written directly (no progress effects), with its finding and follow-up check. */
async function directReport(ctx: Ctx, projectId: string, r: RatingReport): Promise<void> {
  const reporter = ctx[r.who];
  const sessionId = await fieldSession(reporter, projectId);
  const date = addDays(ctx.today, -r.daysAgo);
  const at = new Date(`${date}T11:00:00.000Z`);
  const approvedAt = new Date(`${addDays(date, 1)}T10:00:00.000Z`);
  await prisma.$transaction(
    async (tx) => {
      const rechecks = (await recheckInputsForProject(tx, projectId, TZ)).filter((x) => x.raisedDate < date);
      const open = await tx.finding.findMany({ where: { projectId, status: "OPEN" }, select: { id: true, questionKey: true } });
      const form = await freezeVisitFormSnapshot(tx, { projectId, visitKind: "ROUTINE", visitDate: date, rechecks, builtAt: at, builtByUserId: reporter.userId });
      const units = await tx.facilityUnit.findMany({ where: { projectId }, select: { id: true, progressPct: true } });
      const rectifiedNote = `Rectified on the routine monitoring visit of ${date}: ${r.summary.replace(/^Routine monitoring visit: /, "")}`;
      const answers = seedAnswers(form.snapshot, {
        progress: new Map(units.map((u) => [u.id, Number(u.progressPct ?? 0)])),
        overrides: {
          [WORKMANSHIP_PATH]: { value: r.workmanship, comment: r.workmanship <= 2 ? POOR_WORK : null },
          ...(r.finding ? { [r.finding.path]: { value: r.finding.value, comment: r.finding.comment } } : {}),
        },
        recheck: (id) =>
          r.rectifies && open.find((f) => f.id === id)?.questionKey === r.rectifies
            ?{ value: "YES", comment: rectifiedNote }
            : { value: "NO", comment: "Not yet rectified." },
      });
      const visit = await tx.visit.create({
        data: {
          projectId,
          visitKind: "ROUTINE",
          status: "APPROVED",
          originalPlannedDate: date,
          plannedDate: date,
          sprintId: await sprintOn(tx, projectId, date),
          confirmation: "CONFIRMED",
          confirmedAt: at,
          formSnapshotId: form.id,
          formHash: form.contentSha256,
          formAssembledAt: at,
          submissionDeadline: addDays(date, 2),
          publishedAt: at,
          publishedByUserId: reporter.userId,
          createdByUserId: reporter.userId,
          assignees: { create: { userId: reporter.userId, isLead: true } },
        },
      });
      const submission = await tx.visitSubmission.create({
        data: {
          clientSubmissionId: crypto.randomUUID(),
          visitId: visit.id,
          projectId,
          submittedByUserId: reporter.userId,
          fieldSessionId: sessionId,
          reporterName: reporter.fullName,
          reporterRoleName: reporter.roleName,
          formSnapshotId: form.id,
          formHash: form.contentSha256,
          answersJson: answers as unknown as Prisma.InputJsonValue,
          overallFinding: r.workmanship <= 2 || r.finding ? "MAJOR_ISSUES" : r.workmanship === 3 ? "MINOR_ISSUES" : "SATISFACTORY",
          summaryText: r.summary,
          confirmedAt: at,
          receivedAt: at,
          status: "APPROVED",
          approvedAt,
        },
      });
      // Follow-up checks: rectified closes the finding (as acceptance does); otherwise it is counted.
      for (const rc of rechecks) {
        const f = open.find((x) => x.id === rc.id);
        if (!f) continue;
        const rectified = Boolean(r.rectifies) && f.questionKey === r.rectifies;
        await tx.finding.update({
          where: { id: f.id },
          data: {
            ...(rectified
              ? { status: "RESOLVED", resolvedNotes: rectifiedNote, resolvedByUserId: reporter.userId, resolvedByName: reporter.fullName, resolvedAt: approvedAt }
              : {}),
            recheckCount: { increment: 1 },
            lastRecheckedSubmissionId: submission.id,
            lastRecheckedAt: approvedAt,
          },
        });
      }
      if (r.finding && (await tx.finding.count({ where: { projectId, questionKey: r.finding.path, status: "OPEN" } })) === 0) {
        const contractor = await tx.projectContractor.findFirst({ where: { projectId }, orderBy: { createdAt: "asc" }, select: { id: true } });
        await tx.finding.create({
          data: {
            projectId,
            visitId: visit.id,
            visitSubmissionId: submission.id,
            checklistItemKey: r.finding.path.split("/").pop()!,
            questionKey: r.finding.path,
            title: r.finding.title,
            projectContractorId: contractor?.id ?? null,
            description: `${r.finding.title}: ${r.finding.value === "NO" ? "No" : r.finding.value}. ${r.finding.comment}`,
            severity: r.finding.severity,
            raisedByUserId: reporter.userId,
            raisedByName: reporter.fullName,
            createdAt: approvedAt,
          },
        });
      }
    },
    { timeout: 60_000 }
  );
}

/** Accepted reports behind the contractor ratings (chronological, so follow-up checks find their findings). */
async function ratingReports(ctx: Ctx, idByStory: Map<number, string>): Promise<void> {
  // Demo 2's two routine reports from seedR4 also rate workmanship 3.
  for (const s of await prisma.visitSubmission.findMany({
    where: { projectId: idByStory.get(2)!, status: "APPROVED", visit: { visitKind: "ROUTINE" } },
    select: { id: true, answersJson: true },
  })) {
    const answers = (s.answersJson as Array<Record<string, unknown>>).map((a) =>
      a.path === WORKMANSHIP_PATH ? { ...a, value: 3, comment: "Finishes below standard: uneven blockwork and rough plaster." } : a
    );
    await prisma.visitSubmission.update({ where: { id: s.id }, data: { answersJson: answers as unknown as Prisma.InputJsonValue } });
  }
  for (const r of [...RATING_REPORTS].sort((a, b) => b.daysAgo - a.daysAgo)) await directReport(ctx, idByStory.get(r.n)!, r);
}

// ---- Printed summary -------------------------------------------------------------------------------

/**
 * Local preview of a contractor's rating from the seeded facts (printed only; the register reads the
 * snapshots `refreshContractorRatingSnapshots` writes). Mobilisation timing is not counted here.
 */
async function ratingPreview(projectIds: string[], today: string): Promise<ContractorReliability> {
  const [subs, sprints, findings, ratings] = await Promise.all([
    prisma.visitSubmission.findMany({ where: { projectId: { in: projectIds }, status: "APPROVED" }, select: { projectId: true, answersJson: true, visit: { select: { plannedDate: true } } } }),
    prisma.projectSprint.findMany({ where: { projectId: { in: projectIds }, verificationOutcome: { not: null } }, select: { verificationOutcome: true } }),
    prisma.finding.findMany({ where: { projectId: { in: projectIds }, severity: { in: ["MAJOR", "CRITICAL"] } }, select: { createdAt: true, resolvedAt: true } }),
    prisma.contractorPerformanceRating.findMany({ where: { projectId: { in: projectIds } }, select: { projectId: true, overallScore: true } }),
  ]);
  const reports = subs.flatMap((s) => {
    const a = (s.answersJson as Array<{ path: string; value: unknown }>).find((x) => x.path === WORKMANSHIP_PATH);
    return typeof a?.value === "number" ? [{ date: s.visit.plannedDate, workmanship: a.value, projectId: s.projectId }] : [];
  });
  const resolved = findings.filter((f) => f.resolvedAt);
  const byProject = new Map<string, number[]>();
  for (const r of ratings) byProject.set(r.projectId, [...(byProject.get(r.projectId) ?? []), Number(r.overallScore)]);
  return contractorReliability(
    {
      reports,
      workPhases: { verifiedMetOnTime: sprints.filter((s) => s.verificationOutcome === "MET").length, verified: sprints.length },
      mobilisation: { onTime: 0, total: 0 },
      findings: {
        majorOrCritical: findings.length,
        rectifiedAverageDays: resolved.length ? resolved.reduce((s, f) => s + (f.resolvedAt!.getTime() - f.createdAt.getTime()) / 86_400_000, 0) / resolved.length : null,
      },
      closureRatings: [...byProject.values()].map((v) => v.reduce((s, x) => s + x, 0) / v.length),
    },
    today
  );
}

async function printPart2Summary(
  ctx: Ctx,
  idByStory: Map<number, string>,
  contractorIds: Map<string, string>,
  info: { seconds: number; ratingSnapshots: number; catalogue: { renamed: number; added: number; retired: number } }
): Promise<void> {
  console.log(
    `   • Demo overlay part 2 (${info.seconds.toFixed(1)} s): facilities ${info.catalogue.renamed} renamed, ${info.catalogue.added} added, ${info.catalogue.retired} retired; rating snapshots written: ${info.ratingSnapshots}. Sites:`
  );
  let total = 0;
  for (const s of STORIES) {
    const projectId = idByStory.get(s.n)!;
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { codePrefix: true, status: true, constructionPhase: true } });
    const sites = await prisma.projectSite.findMany({
      where: { projectId },
      orderBy: { siteNumber: "asc" },
      include: { units: { include: { endSprint: { select: { endDate: true } }, lines: { select: { budgetedCostNgn: true, cumulativeCertifiedPct: true } } } } },
    });
    total += sites.length;
    const statuses = sites.map((site) => {
      const lines = site.units.flatMap((u) => u.lines.map((l) => ({ amountNgn: Number(l.budgetedCostNgn ?? 0), progressPct: Number(l.cumulativeCertifiedPct ?? 0) })));
      const status: SiteStatus = deriveSiteStatus({
        progressPct: weightedProgressPct(lines),
        hasUnitBehind: site.units.some((u) => u.endSprint && u.endSprint.endDate < ctx.today && u.lines.some((l) => Number(l.cumulativeCertifiedPct ?? 0) < 100)),
        started: project.status === "ACTIVE" || project.status === "ARCHIVED",
        handedOver: project.constructionPhase === "RETENTION_PERIOD" || project.constructionPhase === "COMPLETED_CLOSED",
      });
      return status;
    });
    const counts = [...new Set(statuses)].map((st) => `${SITE_STATUS_LABELS[st]} ${statuses.filter((x) => x === st).length}`).join(", ");
    const lgas = [...new Set(sites.map((x) => lgaByCode(x.lgaCode)?.name ?? x.lgaCode))].join(", ");
    const unlocated = sites.filter((x) => x.latitude === null).length;
    console.log(`     ${String(s.n).padStart(2)} ${project.codePrefix.padEnd(19)} ${String(sites.length).padStart(2)} site(s) in ${lgas}${unlocated ? ` (${unlocated} not located)` : ""}: ${counts}`);
  }
  console.log(`     ${total} sites. Contractors (rating: snapshot when written, else a local preview of the same facts):`);
  for (const c of CONTRACTORS) {
    const orgId = contractorIds.get(c.name)!;
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { contractorStatus: true } });
    const pcs = await prisma.projectContractor.findMany({ where: { organizationId: orgId }, select: { projectId: true, project: { select: { codePrefix: true } } } });
    const snapshot = await prisma.contractorRatingSnapshot.findUnique({ where: { organizationId: orgId } });
    const rating = snapshot ? `${snapshot.summary} (snapshot)` : `${(await ratingPreview(pcs.map((p) => p.projectId), ctx.today)).summary} (preview)`;
    console.log(
      `     - ${c.name.padEnd(36)} ${c.rc.padEnd(11)} ${CONTRACTOR_STATUS_LABELS[org.contractorStatus].padEnd(8)} ${pcs.map((p) => p.project.codePrefix).join(", ")}  ${rating}`
    );
  }
}

// =============================================================================================
// Part 3 (wave 3): Demo 2's contractor flagged, approved lists 2025–2026
// =============================================================================================

const DEMO2_BUDGET_NGN = 84_000_000;
const DEMO2_BEAP_ESTIMATE_NGN = 71_500_000;

// ---- 8. Contractor flag ------------------------------------------------------------------------

async function tenantFlagRule(tenantId: string): Promise<FlagRule> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { contractorPerformanceJson: true } });
  const parsed = ContractorPerformanceSettingsSchema.safeParse(tenant.contractorPerformanceJson ?? {});
  return (parsed.success ? parsed.data : ContractorPerformanceSettingsSchema.parse({})).flagRule;
}

/** Accepted monitoring reports with a workmanship answer, per project (the visit date counts). */
async function flagReportsByProject(projectIds: string[]): Promise<Map<string, FlagRuleReport[]>> {
  const subs = await prisma.visitSubmission.findMany({
    where: { projectId: { in: projectIds }, status: "APPROVED" },
    select: { id: true, projectId: true, visitId: true, answersJson: true, visit: { select: { plannedDate: true, visitKind: true } } },
  });
  const out = new Map<string, FlagRuleReport[]>();
  for (const s of subs) {
    const a = (s.answersJson as Array<{ path: string; value: unknown }>).find((x) => x.path === WORKMANSHIP_PATH);
    const workmanship = Number(a?.value);
    if (!Number.isFinite(workmanship) || workmanship < 1 || workmanship > 5) continue;
    const kind = visitKindNoun(s.visit.visitKind);
    out.set(s.projectId, [
      ...(out.get(s.projectId) ?? []),
      { visitSubmissionId: s.id, visitId: s.visitId, date: s.visit.plannedDate, workmanship, label: `${kind} of ${formatCalendarDate(s.visit.plannedDate)}` },
    ]);
  }
  return out;
}

/**
 * Demo 2's contractor flagged through the real service (`evaluateContractorFlags`). Until that service
 * lands (wave 3 runs it in parallel), an OPEN flag is written directly when the call raised none on
 * Demo 2 ("fallback while the service lands"). No action is decided: the demo decides it.
 */
async function flagDemo2Contractor(ctx: Ctx, idByStory: Map<number, string>): Promise<{ source: "service" | "fallback"; raisedByService: number }> {
  const demo2 = idByStory.get(2)!;
  // The overlay re-pointed contractors after the base seed: a flag left on a firm that is no longer the
  // project's contractor is stale.
  for (const f of await prisma.contractorFlag.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, projectId: true, organizationId: true } })) {
    const current = await prisma.projectContractor.count({ where: { projectId: f.projectId, organizationId: f.organizationId } });
    if (!current) await prisma.contractorFlag.delete({ where: { id: f.id } });
  }
  const raisedByService = await evaluateContractorFlags(ctx.tenantId, new Date());
  if ((await prisma.contractorFlag.count({ where: { projectId: demo2 } })) > 0) return { source: "service", raisedByService };

  // Fallback while the service lands: the same rule, the same evidence.
  const rule = await tenantFlagRule(ctx.tenantId);
  const { due, evidence } = contractorFlagDue((await flagReportsByProject([demo2])).get(demo2) ?? [], rule, ctx.today);
  if (!due) throw new Error("Demo overlay part 3: Demo 2's monitoring reports no longer meet the contractor flag rule");
  const contractor = await prisma.projectContractor.findFirstOrThrow({ where: { projectId: demo2 }, orderBy: { createdAt: "asc" }, include: { organization: true } });
  const raisedAt = new Date(`${evidence[0].date}T15:00:00.000Z`);
  const ruleJson = { reportCount: rule.reportCount, workmanshipAtOrBelow: rule.workmanshipAtOrBelow, withinDays: rule.withinDays };
  await prisma.$transaction(async (tx) => {
    const flag = await tx.contractorFlag.create({
      data: {
        tenantId: ctx.tenantId,
        organizationId: contractor.organizationId,
        projectId: demo2,
        status: "OPEN",
        ruleJson,
        evidenceJson: evidence as unknown as Prisma.InputJsonValue,
        raisedAt,
      },
    });
    await recordAuditEvent(tx, {
      tenantId: ctx.tenantId,
      projectId: demo2,
      actorType: "SYSTEM",
      actorId: "contractor-flags",
      actorDisplayName: "System (contractor flags)",
      action: "CONTRACTOR_FLAG_RAISED",
      summaryText: `${contractor.organization.name} flagged: ${contractorFlagSummary(ruleJson, evidence.length)}.`,
      payload: { flagId: flag.id, organizationId: contractor.organizationId, rule: ruleJson, evidence, seed: "fallback while the service lands" },
      createdAt: raisedAt,
    });
  });
  return { source: "fallback", raisedByService };
}

// ---- 9. Approved lists -------------------------------------------------------------------------

interface ApprovedRowSeed {
  stateCode: string;
  title: string;
  schools: string[];
  lgaCodes: string[];
  scope: string;
  estimate: number;
  lot: number;
  /** The story the row is for (linked); none = a row with no project on the platform yet. */
  story?: number;
}

/** Rows on the approved lists with no project on the platform (other states; realistic, fictional). */
const UNLINKED_DI_ROWS: Record<number, ApprovedRowSeed[]> = {
  2025: [
    { stateCode: "BA", lot: 2, title: "Construction of a Block of Two (2) Classrooms with Office & Store and Supply of Furniture at LGEA Primary School, Yelwa, Bauchi", schools: ["LGEA Primary School, Yelwa"], lgaCodes: ["BA-BAUCHI"], scope: "Block of two classrooms with office & store; VIP toilet block (4 compartments); pupils' desks and chairs (80)", estimate: 82_500_000 },
    { stateCode: "EK", lot: 1, title: "Renovation, Equipment and Furnishings of LGEA Primary School, Okesa, Ado-Ekiti", schools: ["LGEA Primary School, Okesa", "Government Junior Secondary School, Ajilosun"], lgaCodes: ["EK-ADO-EKITI"], scope: "2 × renovation of a classroom block; pupils' desks and chairs (120); computer room equipment (20)", estimate: 118_000_000 },
    { stateCode: "KE", lot: 2, title: "Construction of a Block of Two (2) Classrooms with Office & Store and Supply of Furniture at Model Primary School, Birnin Kebbi", schools: ["Model Primary School, Birnin Kebbi"], lgaCodes: ["KE-BIRNIN-KEBBI"], scope: "Block of two classrooms with office & store; pupils' desks and chairs (80)", estimate: 79_000_000 },
  ],
  2026: [
    { stateCode: "PL", lot: 1, title: "Construction of a Block of Two (2) Classrooms with Office & Store and Supply of Furniture at LGEA Primary School, Rayfield, Jos South", schools: ["LGEA Primary School, Rayfield"], lgaCodes: ["PL-JOS-SOUTH"], scope: "Block of two classrooms with office & store; VIP toilet block (4 compartments); pupils' desks and chairs (80)", estimate: 86_000_000 },
    { stateCode: "KW", lot: 2, title: "Renovation, Equipment and Furnishings of LGEA Primary School, Baboko, Ilorin West", schools: ["LGEA Primary School, Baboko", "Government Junior Secondary School, Oja-Oba"], lgaCodes: ["KW-ILORIN-WEST"], scope: "3 × renovation of a classroom block; pupils' desks and chairs (150); teachers' furniture", estimate: 142_000_000 },
    { stateCode: "DE", lot: 3, title: "Construction and Equipping of an ECCDE Centre at LGEA Primary School, Okere, Warri South", schools: ["LGEA Primary School, Okere"], lgaCodes: ["DE-WARRI-SOUTH"], scope: "ECCDE block (two playrooms, nap room and office); outdoor play equipment (6); child-size toilets", estimate: 74_000_000 },
  ],
};
const UNLINKED_BEAP_ROWS: Record<string, ApprovedRowSeed[]> = {
  "2025-EN": [{ stateCode: "EN", lot: 3, title: "Construction of VIP Toilets at Community Primary School, Nsukka", schools: ["Community Primary School, Nsukka"], lgaCodes: ["EN-NSUKKA"], scope: "VIP toilet block (4 compartments)", estimate: 14_800_000 }],
  "2025-RI": [{ stateCode: "RI", lot: 3, title: "Provision of a Motorized Borehole at LGEA Primary School, Rumuomasi", schools: ["LGEA Primary School, Rumuomasi"], lgaCodes: ["RI-PORT-HARCOURT"], scope: "Motorized borehole with overhead tank", estimate: 16_200_000 }],
  "2025-OY": [{ stateCode: "OY", lot: 3, title: "Construction of Perimeter Fencing at LGEA Primary School, Oke-Ado", schools: ["LGEA Primary School, Oke-Ado"], lgaCodes: ["OY-IBADAN-SOUTH-WEST"], scope: "Perimeter fence with gate (380 m)", estimate: 21_500_000 }],
  "2026-KN": [
    { stateCode: "KN", lot: 4, title: "Construction of a Block of Two (2) Classrooms at LGEA Primary School, Kumbotso", schools: ["LGEA Primary School, Kumbotso"], lgaCodes: ["KN-KUMBOTSO"], scope: "Block of two classrooms with office & store", estimate: 32_000_000 },
    { stateCode: "KN", lot: 4, title: "Construction of VIP Toilets at Government Junior Secondary School, Ungogo", schools: ["Government Junior Secondary School, Ungogo"], lgaCodes: ["KN-UNGOGO"], scope: "VIP toilet block (6 compartments)", estimate: 15_400_000 },
  ],
  "2026-SO": [{ stateCode: "SO", lot: 4, title: "Construction of Perimeter Fencing at LGEA Primary School, Gidan Igwai", schools: ["LGEA Primary School, Gidan Igwai"], lgaCodes: ["SO-WAMAKO"], scope: "Perimeter fence with gate (400 m)", estimate: 19_800_000 }],
  "2026-OG": [{ stateCode: "OG", lot: 4, title: "Construction of a Block of Two (2) Classrooms at LGEA Primary School, Ota", schools: ["LGEA Primary School, Ota"], lgaCodes: ["OG-ADO-ODO-OTA"], scope: "Block of two classrooms with office & store", estimate: 31_500_000 }],
};
/** First BEAP row number per state (the state's own numbering; Demo 2's row is BEAP/2026/KN/014). */
const BEAP_FIRST_NUMBER: Record<string, number> = { KN: 14, SO: 5, OG: 9, EN: 11, RI: 7, OY: 12 };
/** Scope of linked projects with no facility units yet. */
const SCOPE_WITHOUT_UNITS: Record<number, string> = {
  6: "2 × renovation of a classroom block; pupils' desks and chairs (120); teachers' furniture",
  8: "Block of two classrooms with office & store; perimeter fence with gate (420 m)",
  13: "Block of two classrooms with office & store; VIP toilet block (4 compartments); pupils' desks and chairs (80)",
};
/** Approved estimate = budget ÷ factor, so every linked project but Demo 2 is within ±5%. */
const ESTIMATE_FACTORS = [0.97, 1.03, 0.98, 1.02, 0.96, 1.04, 0.99, 1.01];

const lotTitleOf = (year: number, lot: number) => LOTS.find((l) => l.year === year && l.number === lot)!.title;
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** "3 × block of two classrooms with office & store; VIP toilet block (4 compartments); pupils' desks and chairs (80)". */
function facilityScopeOf(units: Array<{ label: string | null; plannedQuantity: Prisma.Decimal | null; facility: { name: string } }>): string {
  const counts = new Map<string, number>();
  for (const u of units) {
    const qty = u.plannedQuantity ? ` (${Number(u.plannedQuantity)})` : "";
    const text = `${lowerFirst(u.label ?? u.facility.name)}${qty}`;
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  const parts = [...counts].map(([text, n]) => (n > 1 ? `${n} × ${text}` : text));
  return parts.length ? parts.join("; ").replace(/^./, (c) => c.toUpperCase()) : "";
}

/** A linked project's row from its sites, units and budget (Demo 2: the +17% approved BEAP estimate). */
async function rowForStory(s: Story, projectId: string): Promise<ApprovedRowSeed> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      name: true,
      totalBudgetNgn: true,
      sites: { orderBy: { siteNumber: "asc" }, select: { schoolName: true, lgaCode: true } },
      facilityUnits: { orderBy: [{ sortOrder: "asc" }, { code: "asc" }], select: { label: true, plannedQuantity: true, facility: { select: { name: true } } } },
    },
  });
  const budget = Number(project.totalBudgetNgn ?? 0);
  const estimate = s.n === 2 ? DEMO2_BEAP_ESTIMATE_NGN : Math.round(budget / ESTIMATE_FACTORS[s.n % ESTIMATE_FACTORS.length] / 100_000) * 100_000;
  return {
    story: s.n,
    stateCode: s.stateCode,
    lot: s.lot,
    title: project.name,
    schools: project.sites.length ? project.sites.map((x) => x.schoolName) : [s.school],
    lgaCodes: project.sites.length ? [...new Set(project.sites.map((x) => x.lgaCode))] : [s.lgaCode],
    scope: facilityScopeOf(project.facilityUnits) || SCOPE_WITHOUT_UNITS[s.n] || "As per the needs assessment",
    estimate,
  };
}

/**
 * Per intervention year with projects (2025, 2026): one Approved Projects & Implementation Schedule
 * (Direct Intervention, approved by the Executive Secretary the October before) with a row per DI
 * project plus rows in other states, and one Approved BEAP (Matching Grants, approved by the UBEC
 * Board) per state with a Matching Grants project that year. Every project of those years is linked
 * to its row (written directly; no audit). 2027 has no list yet, so draft #11 stays unlinked.
 */
async function approvedLists(ctx: Ctx, idByStory: Map<number, string>): Promise<Array<{ listId: string; title: string; kind: ApprovedListKind }>> {
  const out: Array<{ listId: string; title: string; kind: ApprovedListKind }> = [];
  const writeList = async (
    year: number,
    kind: ApprovedListKind,
    stateCode: string | null,
    title: string,
    approvedBy: string,
    approvedOn: string,
    rows: ApprovedRowSeed[],
    refOf: (row: ApprovedRowSeed, i: number) => string
  ) => {
    const list = await prisma.approvedList.create({ data: { tenantId: ctx.tenantId, interventionYear: year, kind, stateCode, title, approvedBy, approvedOn } });
    for (const [i, r] of rows.entries()) {
      const row = await prisma.approvedListRow.create({
        data: {
          listId: list.id,
          rowRef: refOf(r, i),
          projectTitle: r.title,
          schoolNamesJson: r.schools,
          stateCode: r.stateCode,
          lgaCodes: r.lgaCodes,
          facilityScope: r.scope,
          costEstimateNgn: r.estimate,
          lotTitle: lotTitleOf(year, r.lot),
          sortOrder: (i + 1) * 10,
        },
      });
      if (r.story) await prisma.project.update({ where: { id: idByStory.get(r.story)! }, data: { approvedListRowId: row.id } });
    }
    out.push({ listId: list.id, title, kind });
  };

  for (const year of [2025, 2026]) {
    const stories = STORIES.filter((s) => s.year === year);
    // Direct Intervention: by lot, then state name.
    const di = [...(await Promise.all(stories.filter((s) => s.model === "DI").map((s) => rowForStory(s, idByStory.get(s.n)!)))), ...UNLINKED_DI_ROWS[year]].sort(
      (a, b) => a.lot - b.lot || stateByCode(a.stateCode)!.name.localeCompare(stateByCode(b.stateCode)!.name) || a.title.localeCompare(b.title)
    );
    await writeList(
      year,
      "DI_SCHEDULE",
      null,
      `Approved Projects & Implementation Schedule ${year}`,
      "Executive Secretary, UBEC",
      `${year - 1}-10-14`,
      di,
      (r, i) => `DI/${year}/${r.stateCode}/${String(i + 1).padStart(3, "0")}`
    );
    // Matching Grants: one BEAP per state, the project's row first.
    const mgStates = [...new Set(stories.filter((s) => s.model === "MG").map((s) => s.stateCode))];
    for (const [k, stateCode] of mgStates.entries()) {
      const linked = await Promise.all(stories.filter((s) => s.model === "MG" && s.stateCode === stateCode).map((s) => rowForStory(s, idByStory.get(s.n)!)));
      const rows = [...linked, ...(UNLINKED_BEAP_ROWS[`${year}-${stateCode}`] ?? [])];
      const first = BEAP_FIRST_NUMBER[stateCode] ?? 1;
      await writeList(
        year,
        "MG_BEAP",
        stateCode,
        `Approved BEAP ${year}: ${stateByCode(stateCode)!.name} State`,
        "UBEC Board",
        `${year - 1}-10-${String(21 + k).padStart(2, "0")}`,
        rows,
        (_r, i) => `BEAP/${year}/${stateCode}/${String(first + i).padStart(3, "0")}`
      );
    }
  }
  return out;
}

async function printPart3Summary(
  ctx: Ctx,
  idByStory: Map<number, string>,
  lists: Array<{ listId: string; title: string; kind: ApprovedListKind }>,
  flag: { source: "service" | "fallback"; raisedByService: number }
): Promise<void> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { budgetMismatchTolerancePct: true } });
  console.log(`   • Demo overlay part 3: approved lists (tolerance ±${tenant.budgetMismatchTolerancePct}%):`);
  let rowsTotal = 0;
  let linkedTotal = 0;
  const mismatches: string[] = [];
  for (const l of lists) {
    const rows = await prisma.approvedListRow.findMany({
      where: { listId: l.listId },
      orderBy: { sortOrder: "asc" },
      select: { rowRef: true, costEstimateNgn: true, projects: { select: { codePrefix: true, totalBudgetNgn: true } } },
    });
    const linked = rows.filter((r) => r.projects.length);
    rowsTotal += rows.length;
    linkedTotal += linked.length;
    for (const r of linked) {
      for (const p of r.projects) {
        const m = budgetMismatch(p.totalBudgetNgn === null ? null : Number(p.totalBudgetNgn), Number(r.costEstimateNgn), tenant.budgetMismatchTolerancePct, l.kind);
        if (m.flagged) mismatches.push(`${p.codePrefix} (${r.rowRef}): ${m.summary}`);
      }
    }
    console.log(`     - ${l.title.padEnd(52)} ${String(rows.length).padStart(2)} rows, ${linked.length} linked`);
  }
  const unlinked = await prisma.project.findMany({ where: { id: { in: [...idByStory.values()] }, approvedListRowId: null }, select: { codePrefix: true } });
  console.log(`     ${lists.length} lists, ${rowsTotal} rows, ${linkedTotal} linked; projects not linked: ${unlinked.map((p) => p.codePrefix).join(", ") || "none"}`);
  console.log(`     Budget mismatches: ${mismatches.length ? mismatches.join("; ") : "none"}`);

  // Flags: what is open, and which projects meet the rule today (only Demo 2 should).
  const rule = await tenantFlagRule(ctx.tenantId);
  const reports = await flagReportsByProject([...idByStory.values()]);
  const due = STORIES.filter((s) => contractorFlagDue(reports.get(idByStory.get(s.n)!) ?? [], rule, ctx.today).due);
  const flags = await prisma.contractorFlag.findMany({
    where: { tenantId: ctx.tenantId },
    select: { status: true, evidenceJson: true, organization: { select: { name: true } }, project: { select: { codePrefix: true } }, _count: { select: { actions: true } } },
  });
  console.log(
    `     Contractor flags (${flag.source === "service" ? `raised by evaluateContractorFlags: ${flag.raisedByService}` : "fallback while the service lands: the service raised none"}):`
  );
  for (const f of flags) {
    console.log(`     - ${f.status} ${f.organization.name} on ${f.project.codePrefix}: ${(f.evidenceJson as unknown[]).length} report(s) as evidence, ${f._count.actions} action(s)`);
  }
  const unexpected = due.filter((s) => s.n !== 2);
  console.log(`     Projects meeting the flag rule today: ${due.map((s) => `#${s.n}`).join(", ") || "none"}${unexpected.length ? "  WARNING: only Demo 2 (#2) should" : ""}`);
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

// =============================================================================================
// Click-through fixes (2026-11-26): records the normal seed wrote before the re-coding
// =============================================================================================

/** "UBEC/PV/2026/0105-01" style references the normal seed wrote, keyed on the old project number. */
const OLD_VOUCHER = /^UBEC\/PV\/(\d{4})\/0\d{3}-(.+)$/;

/**
 * Contract references, document titles, contract sums and payments of the relocated projects in
 * their new story (WEB-R6-10, WEB-DEMO23-07, WEB-IRL-REG-02): contract references in the overlay's
 * style ("UBEC/DI/2025/LA/0101"; Matching Grants "<State>SUBEB/MG/..."), "Contract agreement" and
 * "Acceptance of award" titles naming the project's own reference and contractor, the lessons
 * learned report naming the project's school, payment vouchers in the lot/batch style, a contract
 * sum on every live project, payments on the completed projects that had none (through the real
 * service), and no budget below its contract sum (Demo 2 keeps its budget-mismatch story).
 * Returns the old → new voucher references (notifications quote them).
 */
async function tidyRelocatedRecords(ctx: Ctx, idByStory: Map<number, string>): Promise<Map<string, string>> {
  const voucherRenames = new Map<string, string>();
  for (const s of STORIES) {
    const projectId = idByStory.get(s.n)!;
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { status: true, contractReference: true, contractors: { select: { organization: { select: { name: true } } } } },
    });
    if (s.source && project.contractReference) {
      // As the new projects' references: "UBEC/DI/2026/FC/0101", "ENSUBEB/MG/2025/0301".
      const lotBatch = `${String(s.lot).padStart(2, "0")}${String(s.batch).padStart(2, "0")}`;
      const ref = s.model === "MG" ? `${s.stateCode}SUBEB/MG/${s.year}/${lotBatch}` : `UBEC/DI/${s.year}/${s.stateCode}/${lotBatch}`;
      await prisma.project.update({ where: { id: projectId }, data: { contractReference: ref } });
      project.contractReference = ref;
    }
    const contractor = project.contractors[0]?.organization.name ?? null;
    for (const d of await prisma.projectDocument.findMany({ where: { projectId }, select: { id: true, title: true } })) {
      let title = d.title;
      if (/^Contract agreement( |$)/.test(title) && project.contractReference) title = `Contract agreement ${project.contractReference}`;
      if (/^Acceptance of award, /.test(title) && contractor) title = `Acceptance of award, ${contractor}`;
      if (/^Lessons learned report: /.test(title)) title = `Lessons learned report: ${s.school}`;
      if (title !== d.title) await prisma.projectDocument.update({ where: { id: d.id }, data: { title } });
    }
    for (const p of await prisma.projectPayment.findMany({ where: { projectId }, select: { id: true, reference: true } })) {
      const m = OLD_VOUCHER.exec(p.reference);
      if (!m) continue;
      const reference = voucherRef(s, m[2]);
      voucherRenames.set(p.reference, reference);
      await prisma.projectPayment.update({ where: { id: p.id }, data: { reference } });
    }
  }

  // Contract sums: the completed and closing projects the normal seed left without one.
  for (const n of [4, 5, 9, 10]) {
    const projectId = idByStory.get(n)!;
    const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { contractSumNgn: true, totalBudgetNgn: true } });
    if (p.contractSumNgn !== null) continue;
    const budget = Number(p.totalBudgetNgn);
    const lines = Number((await prisma.boqItem.aggregate({ where: { projectId }, _sum: { budgetedCostNgn: true } }))._sum.budgetedCostNgn ?? 0);
    const sum = lines >= budget * 0.8 && lines <= budget ? lines : Math.round((budget * 0.96) / 10_000) * 10_000;
    await prisma.project.update({ where: { id: projectId }, data: { contractSumNgn: sum } });
  }

  // Payments where the story needs them and the normal seed recorded none (real service; an archived
  // project is reopened for the moment it takes, as the guard would refuse the write).
  const plans: Record<number, Array<{ kind: "INTERIM" | "FINAL" | "RETENTION_RELEASE"; share: number; on: (d: Dates) => string; description: string }>> = {
    4: [
      { kind: "INTERIM", share: 0.45, on: (d) => addDays(d.kickoff, 45), description: "Interim payment 1: renovation works" },
      { kind: "INTERIM", share: 0.35, on: (d) => addDays(d.kickoff, 150), description: "Interim payment 2: furniture and finishes" },
      { kind: "FINAL", share: 0.2, on: (d) => d.completion, description: "Final payment after the Certificate of Completion" },
    ],
    5: [
      { kind: "INTERIM", share: 0.45, on: (d) => addDays(d.kickoff, 45), description: "Interim payment 1: renovation works" },
      { kind: "INTERIM", share: 0.35, on: (d) => addDays(d.kickoff, 150), description: "Interim payment 2: computer room" },
    ],
    9: [
      { kind: "INTERIM", share: 0.4, on: (d) => addDays(d.kickoff, 60), description: "Interim payment 1: boreholes" },
      { kind: "INTERIM", share: 0.4, on: (d) => addDays(d.kickoff, 150), description: "Interim payment 2: toilet blocks" },
      { kind: "FINAL", share: 0.2, on: (d) => d.completion, description: "Final payment after the Certificate of Completion" },
      { kind: "RETENTION_RELEASE", share: 0, on: (d) => d.retentionEnd, description: "Release of retention at the end of the defects liability period" },
    ],
    10: [
      { kind: "INTERIM", share: 0.5, on: (d) => addDays(d.kickoff, 30), description: "Interim payment 1: toilet blocks" },
      { kind: "FINAL", share: 0.5, on: (d) => d.completion, description: "Final payment after the Certificate of Completion" },
      { kind: "RETENTION_RELEASE", share: 0, on: (d) => d.retentionEnd, description: "Release of retention at the end of the defects liability period" },
    ],
  };
  type Dates = { kickoff: string; completion: string; retentionEnd: string };
  for (const [nText, plan] of Object.entries(plans)) {
    const n = Number(nText);
    const projectId = idByStory.get(n)!;
    if ((await prisma.projectPayment.count({ where: { projectId } })) > 0) continue;
    const p = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { status: true, archivedAt: true, contractSumNgn: true, kickoffDate: true, kickoffHeldAt: true, practicalCompletionDate: true, retentionEndDate: true },
    });
    const kickoff = p.kickoffDate ?? (p.kickoffHeldAt ? zonedCalendarDate(p.kickoffHeldAt, TZ) : addDays(ctx.today, -200));
    const completion = p.practicalCompletionDate ?? addDays(ctx.today, -2);
    const dates: Dates = { kickoff, completion: completion > ctx.today ? ctx.today : completion, retentionEnd: p.retentionEndDate && p.retentionEndDate <= ctx.today ? p.retentionEndDate : ctx.today };
    const sum = Number(p.contractSumNgn ?? 0);
    if (sum <= 0) continue;
    const archived = p.status === "ARCHIVED";
    if (archived) await prisma.project.update({ where: { id: projectId }, data: { status: "ACTIVE" } });
    try {
      let serial = 1;
      for (const step of plan) {
        const paidOn = step.on(dates) > ctx.today ? ctx.today : step.on(dates);
        let gross = round2(sum * step.share);
        if (step.kind === "RETENTION_RELEASE") {
          gross = Number((await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { retentionHeldNgn: true } })).retentionHeldNgn);
          if (gross <= 0) continue;
        }
        await recordPayment(projectId, ctx.finance, {
          kind: step.kind,
          paidOn,
          grossAmountNgn: gross,
          reference: voucherRef(story0(n), step.kind === "RETENTION_RELEASE" ? "RR" : serial++),
          description: step.description,
        });
      }
    } finally {
      if (archived) await prisma.project.update({ where: { id: projectId }, data: { status: "ARCHIVED", archivedAt: p.archivedAt } });
    }
  }

  // No budget below its contract sum (the register's commitment and the approved lists follow the budget).
  for (const s of STORIES) {
    if (s.n === 2) continue; // Demo 2: the budget-mismatch story sets its own budget.
    const projectId = idByStory.get(s.n)!;
    const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { contractSumNgn: true, totalBudgetNgn: true } });
    if (p.contractSumNgn === null || Number(p.contractSumNgn) <= Number(p.totalBudgetNgn)) continue;
    const budget = Math.ceil((Number(p.contractSumNgn) * 1.02) / 500_000) * 500_000;
    await prisma.project.update({ where: { id: projectId }, data: { totalBudgetNgn: budget } });
  }
  return voucherRenames;
}

const at10 = (date: string) => new Date(`${date}T10:00:00.000Z`);

/**
 * Stage bar dates in story order (WEB-R6-30): the normal seed activated projects on the seed day or
 * on a fixed date, and its closeout services ran on the seed day. Activation goes between the award
 * and the kick-off; a phase change goes to the date its story implies (handover the day after the
 * accepted final evaluation, the defects liability period from its start, closure at its end); a
 * Certificate of Completion counts from its completion date. Nothing else reads these timestamps
 * as story facts (KPIs count issue dates, which stay).
 */
async function alignStageDates(ctx: Ctx, idByStory: Map<number, string>): Promise<number> {
  let changed = 0;
  for (const projectId of idByStory.values()) {
    const p = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: {
        status: true,
        activatedAt: true,
        kickoffHeldAt: true,
        contractAwardDate: true,
        constructionPhase: true,
        constructionPhaseChangedAt: true,
        retentionStartDate: true,
        retentionEndDate: true,
        importedAt: true,
      },
    });
    if (p.status === "DRAFT") continue;
    const data: Prisma.ProjectUpdateInput = {};
    if (p.kickoffHeldAt && !p.importedAt) {
      const kickoff = zonedCalendarDate(p.kickoffHeldAt, TZ);
      const activated = p.activatedAt ? zonedCalendarDate(p.activatedAt, TZ) : null;
      if (!activated || activated > kickoff || (p.contractAwardDate && activated < p.contractAwardDate)) {
        const afterAward = p.contractAwardDate ? addDays(p.contractAwardDate, 3) : addDays(kickoff, -7);
        data.activatedAt = at10(afterAward < kickoff ? afterAward : addDays(kickoff, -1));
      }
    }
    let phaseDate: string | null = null;
    if (p.constructionPhase === "RETENTION_PERIOD") phaseDate = p.retentionStartDate;
    if (p.constructionPhase === "COMPLETED_CLOSED") phaseDate = p.retentionEndDate;
    if (p.constructionPhase === "HANDOVER_IN_PROGRESS") {
      const evaluation = await prisma.visit.findFirst({
        where: { projectId, visitKind: "FINAL_EVALUATION", status: "APPROVED" },
        orderBy: { plannedDate: "desc" },
        select: { plannedDate: true },
      });
      phaseDate = evaluation ? addDays(evaluation.plannedDate, 1) : null;
    }
    if (phaseDate && phaseDate < ctx.today && (!p.constructionPhaseChangedAt || zonedCalendarDate(p.constructionPhaseChangedAt, TZ) > phaseDate)) {
      data.constructionPhaseChangedAt = at10(phaseDate);
    }
    if (Object.keys(data).length > 0) {
      await prisma.project.update({ where: { id: projectId }, data });
      changed += 1;
    }
    for (const c of await prisma.completionCertificate.findMany({ where: { projectId, status: { not: "REVOKED" } }, select: { id: true, createdAt: true, completionDate: true } })) {
      if (c.completionDate < zonedCalendarDate(c.createdAt, TZ)) {
        await prisma.completionCertificate.update({ where: { id: c.id }, data: { createdAt: at10(c.completionDate) } });
      }
    }
  }
  return changed;
}

/**
 * The relocated projects' stored text still quoted the normal seed's codes and vouchers
 * (WEB-R6-06): notification titles and bodies, certificate numbers and their signature statements,
 * document titles and sign-off statements, checklist notes, visit comments and responses, finding
 * text and default case summaries. Old codes become the lot/batch code ("LOT 1 BATCH 1"; with the
 * year in notifications, which are read outside the project); a certificate number keeps the stored
 * code style the service writes ("COC-2025-LOT-1-BATCH-1-01"). Job-written texts that quote the
 * stored code ("2026-LOT-4-BATCH-1 has stalled") get the readable form too. A changed signature or
 * sign-off statement gets its hash recomputed as the services compute it. The audit ledger is never
 * touched (hash-chained): its entries keep the codes of the day they were written. Stored PDFs
 * (certificates, specimen documents, the closure pack) still print the old codes inside.
 */
async function recodeStoredText(idByStory: Map<number, string>, voucherRenames: Map<string, string>): Promise<number> {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rules = STORIES.map((s) => ({
    source: s.source ? new RegExp(`\\b${escape(s.source)}(?![0-9])`, "g") : null,
    coc: s.source ? `COC-${s.source}-` : null,
    raw: code0(s),
    rawWord: new RegExp(`(?<![-/A-Za-z0-9])${escape(code0(s))}(?![-0-9])`, "g"),
    plain: formatProjectCode(code0(s)),
    withYear: formatProjectCodeWithYear(code0(s)),
  }));
  const vouchers = [...voucherRenames.entries()];
  const rewrite = (text: string, label: "plain" | "withYear"): string => {
    let t = text;
    for (const [from, to] of vouchers) t = t.split(from).join(to);
    for (const r of rules) {
      if (r.coc) t = t.split(r.coc).join(`COC-${r.raw}-`);
      if (r.source) t = t.replace(r.source, r[label]);
      t = t.replace(r.rawWord, r[label]);
    }
    return t;
  };
  const ids = [...idByStory.values()];
  let rows = 0;
  const changedFields = <T extends Record<string, string | null>>(row: T, label: "plain" | "withYear"): Partial<T> | null => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      if (typeof v !== "string") continue;
      const next = rewrite(v, label);
      if (next !== v) out[k] = next;
    }
    return Object.keys(out).length ? (out as Partial<T>) : null;
  };

  for (const n of await prisma.webNotification.findMany({ where: { projectId: { in: ids } }, select: { id: true, title: true, description: true } })) {
    const d = changedFields({ title: n.title, description: n.description }, "withYear");
    if (d) {
      await prisma.webNotification.update({ where: { id: n.id }, data: d });
      rows += 1;
    }
  }
  for (const n of await prisma.mobileNotification.findMany({ where: { projectId: { in: ids } }, select: { id: true, title: true, message: true } })) {
    const d = changedFields({ title: n.title, message: n.message }, "withYear");
    if (d) {
      await prisma.mobileNotification.update({ where: { id: n.id }, data: d });
      rows += 1;
    }
  }
  for (const x of await prisma.projectDocument.findMany({ where: { projectId: { in: ids } }, select: { id: true, title: true } })) {
    const d = changedFields({ title: x.title }, "plain");
    if (d) {
      await prisma.projectDocument.update({ where: { id: x.id }, data: d });
      rows += 1;
    }
  }
  for (const x of await prisma.closureChecklistItemState.findMany({ where: { projectId: { in: ids } }, select: { id: true, notes: true, waivedReason: true } })) {
    const d = changedFields({ notes: x.notes, waivedReason: x.waivedReason }, "plain");
    if (d) {
      await prisma.closureChecklistItemState.update({ where: { id: x.id }, data: d });
      rows += 1;
    }
  }
  for (const x of await prisma.visitResponse.findMany({ where: { visit: { projectId: { in: ids } } }, select: { id: true, comment: true } })) {
    const d = changedFields({ comment: x.comment }, "plain");
    if (d) {
      await prisma.visitResponse.update({ where: { id: x.id }, data: d });
      rows += 1;
    }
  }
  for (const x of await prisma.visitComment.findMany({ where: { visit: { projectId: { in: ids } } }, select: { id: true, text: true } })) {
    const d = changedFields({ text: x.text }, "plain");
    if (d) {
      await prisma.visitComment.update({ where: { id: x.id }, data: d });
      rows += 1;
    }
  }
  for (const x of await prisma.visit.findMany({ where: { projectId: { in: ids }, cancelledReason: { not: null } }, select: { id: true, cancelledReason: true } })) {
    const d = changedFields({ cancelledReason: x.cancelledReason }, "plain");
    if (d) {
      await prisma.visit.update({ where: { id: x.id }, data: d });
      rows += 1;
    }
  }
  for (const x of await prisma.finding.findMany({ where: { projectId: { in: ids } }, select: { id: true, title: true, description: true, resolvedNotes: true } })) {
    const d = changedFields({ title: x.title, description: x.description, resolvedNotes: x.resolvedNotes }, "plain");
    if (d) {
      await prisma.finding.update({ where: { id: x.id }, data: d });
      rows += 1;
    }
  }
  for (const x of await prisma.contractorDefaultCase.findMany({ where: { projectId: { in: ids } }, select: { id: true, summary: true, outcomeNotes: true } })) {
    const d = changedFields({ summary: x.summary, outcomeNotes: x.outcomeNotes }, "plain");
    if (d) {
      await prisma.contractorDefaultCase.update({ where: { id: x.id }, data: d });
      rows += 1;
    }
  }
  for (const x of await prisma.projectPayment.findMany({ where: { projectId: { in: ids } }, select: { id: true, description: true } })) {
    const d = changedFields({ description: x.description }, "plain");
    if (d) {
      await prisma.projectPayment.update({ where: { id: x.id }, data: d });
      rows += 1;
    }
  }

  // Certificates: number, then every signature statement with its hash (as completion.service).
  for (const c of await prisma.completionCertificate.findMany({
    where: { projectId: { in: ids } },
    include: { signatures: true },
  })) {
    const certificateNumber = rewrite(c.certificateNumber, "plain");
    if (certificateNumber !== c.certificateNumber) {
      await prisma.completionCertificate.update({ where: { id: c.id }, data: { certificateNumber } });
      rows += 1;
    }
    const scopeHash = crypto.createHash("sha256").update(c.scopeSummary).digest("hex");
    for (const sig of c.signatures) {
      const statement = rewrite(sig.statement, "plain");
      if (statement === sig.statement && certificateNumber === c.certificateNumber) continue;
      let statementHash: string;
      if (sig.isBeneficiary) {
        const evidence = sig.evidenceDocumentId
          ? await prisma.projectDocumentVersion.findFirst({ where: { documentId: sig.evidenceDocumentId }, orderBy: { version: "asc" }, select: { sha256: true } })
          : null;
        statementHash = crypto
          .createHash("sha256")
          .update(`${c.id}|${certificateNumber}|${sig.slotKey}|beneficiary|${sig.beneficiaryName}|${evidence?.sha256 ?? ""}|${sig.recordedByUserId}|${statement}`)
          .digest("hex");
      } else {
        statementHash = crypto
          .createHash("sha256")
          .update(`${c.id}|${certificateNumber}|${c.completionDate}|${scopeHash}|${sig.slotKey}|${sig.userId}|${statement}`)
          .digest("hex");
      }
      await prisma.completionCertificateSignature.update({ where: { id: sig.id }, data: { statement, statementHash } });
      rows += 1;
    }
  }
  // Document sign-offs: statement and hash (as documents.service).
  for (const so of await prisma.projectDocumentSignOff.findMany({ where: { document: { projectId: { in: ids } } } })) {
    const statement = rewrite(so.statement, "plain");
    if (statement === so.statement) continue;
    const version = await prisma.projectDocumentVersion.findUnique({ where: { documentId_version: { documentId: so.documentId, version: so.version } }, select: { sha256: true } });
    const statementHash = signOffStatementHash({ documentId: so.documentId, version: so.version, versionSha256: version?.sha256 ?? "", userId: so.userId, statement });
    await prisma.projectDocumentSignOff.update({ where: { id: so.id }, data: { statement, statementHash } });
    rows += 1;
  }
  return rows;
}

export async function seedDemoOverlay(): Promise<void> {
  const started = Date.now();
  const tenant = await prisma.tenant.findUnique({ where: { slug: PROGRAMME_TENANT_SLUG } });
  if (!tenant) return;
  const tenantId = tenant.id;
  const today = zonedCalendarDate(new Date(), TZ);

  const roleIds = await rolesAndLogins(tenantId);
  const flagship = await prisma.organization.findFirstOrThrow({ where: { tenantId, name: UBEC_ORG_NAME } });
  const subebByState = await subebs(tenantId, flagship.id, roleIds.chairman);
  // Wave 2 (D2): owners are derived from the project state, so each SUBEB carries its state code.
  for (const [stateCode, id] of subebByState) await prisma.organization.update({ where: { id }, data: { stateCode } });
  await prisma.organization.updateMany({ where: { tenantId, name: { contains: "Lagos State Universal Basic Education Board" } }, data: { stateCode: "LA" } });
  const regionByState = await regions(tenantId);

  const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: UBEC_ADMIN_EMAIL } });
  const lotIds = new Map<string, string>();
  for (const l of LOTS) {
    const row = await prisma.projectLot.create({ data: { tenantId, interventionYear: l.year, number: l.number, title: l.title, createdByUserId: adminUser.id } });
    lotIds.set(lotKey(l.year, l.number), row.id);
  }

  // Type rules: CoC slots in the client's titles, the new SUBEBs as Matching Grants owners.
  await mergeTypeConfig(tenantId, (config, code) => ({
    ...config,
    ownership:
      code === "CO_FUNDED"
        ? { ...config.ownership, allowedOwningOrganizationIds: [...new Set([...(config.ownership.allowedOwningOrganizationIds ?? []), ...subebByState.values()])] }
        : config.ownership,
    closure: { ...config.closure, cocSignatories: (code === "CO_FUNDED" ? MATCHING_COC_SLOTS : DIRECT_COC_SLOTS) as ProjectTypeConfig["closure"]["cocSignatories"] },
  }));

  const ctx: Ctx = {
    tenantId,
    today,
    admin: await payloadFor(UBEC_ADMIN_EMAIL),
    dpp: await payloadFor(DPP_EMAIL),
    finance: await payloadFor(FINANCE_EMAIL),
    monitor: await payloadFor(UBEC_ME_EMAIL),
    lagosMe: await payloadFor(LAGOS_ME_EMAIL),
    resident: await payloadFor(RESIDENT_SUPERVISOR_EMAIL),
    flagshipId: flagship.id,
    subebByState,
    regionByState,
    lotIds,
    types: new Map((await prisma.projectType.findMany({ where: { tenantId } })).map((t) => [t.code, t])),
    roleIds,
    defaultRadiusMeters: tenant.defaultGeofenceRadiusMeters,
  };
  // Part 2: the client's facility names first, so every BoQ line written below carries them.
  const catalogue = await facilityCatalogue(tenantId);

  // ---- Existing projects (#1–#11) --------------------------------------------------------------
  const idByStory = new Map<number, string>();
  for (const s of STORIES.filter((x) => x.source)) {
    const p = await prisma.project.findFirstOrThrow({
      where: { tenantId, codePrefix: s.source! },
      select: { id: true, tenantId: true, codePrefix: true, status: true, setupState: true, projectTypeId: true },
    });
    if (s.source === "PRG-201") {
      // The Matching Grants draft becomes a Direct Intervention draft (owner and funder from the type).
      await prisma.project.update({ where: { id: p.id }, data: { owningOrganizationId: null, lenderOrganizationId: null } });
      await prisma.$transaction((tx) =>
        applyProjectTypeToProject(tx, { ...p, owningOrganizationId: null, lenderOrganizationId: null }, ctx.types.get("CENTRAL")!.id, ctx.admin)
      );
    }
    await relocate(ctx, p.id, s);
    idByStory.set(s.n, p.id);
  }
  // DPP, ES and Finance see every project (projects:view_all_tenant); the Lagos SUBEB M&E officer keeps
  // her Matching Grants assignments (now Sokoto, Enugu and Rivers).

  // Demo 1 on track (light demo data, written directly): work phases 1 and 2 verified met (seedR4 left
  // phase 1 partly met). Part 2 adds its sites and the weekly monitoring reports that raise progress
  // (the last one five days ago), so the units' progress comes from those reports.
  const demo1 = idByStory.get(1)!;
  await prisma.projectSprint.updateMany({
    where: { projectId: demo1, number: { in: [1, 2] } },
    data: { verificationOutcome: "MET", verifiedAt: new Date(), verifiedByUserId: ctx.monitor.userId, verificationNotes: "Work phase deliverables in place and to specification." },
  });

  // Demo 2 in trouble (light demo data, written directly): six schools in three LGAs; the classroom
  // blocks at sites 1 and 3 are behind (work phase 2 has ended), phase 1 partly met, and paid well
  // ahead of the work done.
  const demo2 = idByStory.get(2)!;
  // Part 3: budget ₦84.0m against the approved BEAP's ₦71.5m (+17%, the budget-mismatch red flag).
  await prisma.project.update({ where: { id: demo2 }, data: { totalBudgetNgn: DEMO2_BUDGET_NGN } });
  // In execution (WEB-R6-14): the kick-off was held and the contractor mobilised before the first
  // monitoring visit, dated as the document register dated them (kick-off two weeks before the first
  // visit, award a month before it), so the stage reads Execution and the register's letters fit.
  const demo2FirstVisit = await prisma.visit.findFirst({ where: { projectId: demo2 }, orderBy: { plannedDate: "asc" }, select: { plannedDate: true } });
  const demo2Kickoff = addDays(demo2FirstVisit?.plannedDate ?? addDays(today, -58), -14);
  const demo2KickoffDaysAgo = Math.round((Date.parse(today) - Date.parse(demo2Kickoff)) / 86_400_000);
  await contractHistory(ctx, demo2, "KNSUBEB/MG/2026/0401", demo2KickoffDaysAgo, { award: addDays(demo2Kickoff, -30), signed: addDays(demo2Kickoff, -20) });
  if ((await prisma.boqItem.count({ where: { projectId: demo2 } })) === 0) {
    const demo2Sites = await createSites(ctx, demo2, 2);
    // Work phase 1 starts once the contractor is on site (a week after the kick-off).
    const phase1Start = Math.min(-(demo2KickoffDaysAgo - 7), -40);
    const sum = await lightScope(
      ctx,
      demo2,
      [["Substructure", phase1Start, -36], ["Superstructure and roofing", -35, -5], ["Finishes, toilets and furniture", -4, 50]],
      DEMO2_UNITS,
      demo2Sites
    );
    await prisma.projectSprint.updateMany({
      where: { projectId: demo2, number: 1 },
      data: { verificationOutcome: "PARTLY_MET", verifiedAt: new Date(), verifiedByUserId: ctx.monitor.userId, verificationNotes: "Foundations late; ground floor slab not cast." },
    });
    await pay(ctx, demo2, story0(2), "INTERIM", 40, sum * 0.35, "Interim payment 1: substructure", 1);
    await pay(ctx, demo2, story0(2), "INTERIM", 15, sum * 0.3, "Interim payment 2: superstructure", 2);
  }

  // ---- New projects (#12–#18): light demo data ---------------------------------------------------
  const contractors = new Map<string, string>();
  for (const name of ["Arewa Classic Builders Ltd", "Zuma Rock Construction Company Ltd", "Eastline Engineering Nigeria Ltd", "Olumo Works & Services Ltd"]) {
    contractors.set(name, (await prisma.organization.create({ data: { tenantId, name, categories: ["CONTRACTOR"] } })).id);
  }
  const sahel = (await prisma.organization.findFirstOrThrow({ where: { tenantId, name: "Sahel Build & Civil Works Ltd" } })).id;
  const story = story0;

  // #12 Delta (Asaba), execution on track: phase 1 done, phase 2 under way; a routine visit raised progress 6 days ago.
  {
    const id = await newProject(ctx, story(12), { contractorId: contractors.get("Zuma Rock Construction Company Ltd")!, budget: 85_000_000, activatedDaysAgo: 75, assign: [ctx.monitor, ctx.resident] });
    await contractHistory(ctx, id, "UBEC/DI/2026/DE/0102", 70);
    const sum = await lightScope(ctx, id, [["Substructure", -45, -10], ["Superstructure and roofing", -9, 40], ["Finishes, toilets and furniture", 41, 90]], classroomBlock([55, 10, 0]));
    await prisma.projectSprint.updateMany({ where: { projectId: id, number: 1 }, data: { verificationOutcome: "MET", verifiedAt: new Date(), verifiedByUserId: ctx.monitor.userId, verificationNotes: "Substructure complete." } });
    await acceptedVisit(ctx, id, ctx.resident, 6, "ROUTINE", "Routine monitoring visit: block walls at lintel level; materials on site; workers in PPE.", true);
    await pay(ctx, id, story(12), "INTERIM", 20, sum * 0.25, "Interim payment 1: substructure", 1);
    idByStory.set(12, id);
  }

  // #13 Kano, imported from the register: ongoing at 45%, no scope yet (the imported % shows).
  {
    const id = await newProject(ctx, story(13), { contractorId: sahel, budget: 78_000_000, activatedDaysAgo: 40, assign: [ctx.monitor, ctx.resident] });
    const importedAt = new Date(`${addDays(today, -40)}T09:30:00.000Z`);
    await prisma.project.update({
      where: { id },
      data: { importedAt, importedProgressPct: 45, importedStatus: "ONGOING", certifiedProgressPct: 45, activatedAt: importedAt, contractSumNgn: 76_500_000, contractReference: "UBEC/DI/2025/KN/0202" },
    });
    await prisma.$transaction((tx) => syncContractMilestones(tx, id));
    await prisma.projectContractMilestone.updateMany({
      where: { projectId: id, status: { in: ["PENDING", "DUE", "OVERDUE"] }, anchor: { notIn: ["COC_ISSUED", "PROJECT_CLOSED"] } },
      data: { status: "WAIVED", waivedReason: "Imported from the project register: the project was already under way.", completedAt: importedAt, completedByUserId: ctx.admin.userId },
    });
    await acceptedVisit(ctx, id, ctx.resident, 8, "ROUTINE", "Routine monitoring visit: roofing in progress on the classroom block; toilet pit dug.");
    await pay(ctx, id, story(13), "INTERIM", 45, 76_500_000 * 0.3, "Interim payment 1 (before import)", 1);
    idByStory.set(13, id);
  }

  // #14 Kaduna, execution near the end; the final payment was recorded before the CoC (exception).
  {
    const id = await newProject(ctx, story(14), { contractorId: contractors.get("Arewa Classic Builders Ltd")!, budget: 88_000_000, activatedDaysAgo: 160, assign: [ctx.monitor, ctx.resident] });
    await contractHistory(ctx, id, "UBEC/DI/2026/KD/0104", 150);
    const sum = await lightScope(ctx, id, [["Substructure", -125, -90], ["Superstructure and roofing", -89, -30], ["Finishes, toilets and furniture", -29, 20]], classroomBlock([100, 80, 50]));
    await prisma.projectSprint.updateMany({ where: { projectId: id, number: { in: [1, 2] } }, data: { verificationOutcome: "MET", verifiedAt: new Date(), verifiedByUserId: ctx.monitor.userId } });
    await acceptedVisit(ctx, id, ctx.resident, 9, "ROUTINE", "Routine monitoring visit: finishes under way; toilet block roofed; first furniture delivered.", true);
    await pay(ctx, id, story(14), "INTERIM", 100, sum * 0.35, "Interim payment 1: substructure", 1);
    await pay(ctx, id, story(14), "INTERIM", 45, sum * 0.3, "Interim payment 2: superstructure and roofing", 2);
    await pay(ctx, id, story(14), "FINAL", 3, sum * 0.2, "Final payment (recorded before the Certificate of Completion)", 3);
    idByStory.set(14, id);
  }

  // #15 Borno, stalled: no accepted visit has raised progress since work phase 1 started 70 days ago.
  {
    const id = await newProject(ctx, story(15), { contractorId: sahel, budget: 92_000_000, activatedDaysAgo: 90, assign: [ctx.monitor, ctx.resident] });
    await contractHistory(ctx, id, "UBEC/DI/2026/BO/0105", 85);
    const sum = await lightScope(ctx, id, [["Substructure", -70, -20], ["Superstructure and roofing", -19, 40], ["Finishes, toilets and furniture", 41, 90]], classroomBlock([20, 0, 0]));
    await prisma.projectSprint.updateMany({
      where: { projectId: id, number: 1 },
      data: { verificationOutcome: "NOT_MET", verifiedAt: new Date(), verifiedByUserId: ctx.monitor.userId, verificationNotes: "Substructure not finished; site idle." },
    });
    await acceptedVisit(ctx, id, ctx.resident, 50, "ROUTINE", "Routine monitoring visit: foundations cast; site idle on the day, contractor's crew demobilised for the season.");
    await pay(ctx, id, story(15), "INTERIM", 60, sum * 0.15, "Mobilisation advance", 1);
    idByStory.set(15, id);
  }

  // #16 Oyo (Matching Grants), handover response recorded, waiting for the M&E Officer's review.
  // Simplified: no Certificate of Completion (the Oyo SUBEB has no signatories seeded).
  {
    const id = await newProject(ctx, story(16), { contractorId: contractors.get("Olumo Works & Services Ltd")!, budget: 46_000_000, activatedDaysAgo: 260, assign: [ctx.monitor, ctx.lagosMe] });
    await contractHistory(ctx, id, "OYSUBEB/MG/2025/0303", 250);
    const sum = await lightScope(ctx, id, [["Borehole and overhead tank", -230, -150], ["VIP toilets", -149, -40]], [
      { facility: "BOREHOLE", label: "Motorized borehole with 5,000-litre overhead tank", startSprint: 1, endSprint: 1, progressPct: 100, lines: [["Motorized borehole, complete with pump and tank stand", "item", 1, 14_500_000]] },
      { facility: "TOILET", label: "VIP toilet block (6 compartments)", startSprint: 2, endSprint: 2, progressPct: 100, lines: [["VIP toilet block, complete", "item", 2, 13_200_000]] },
    ]);
    await pay(ctx, id, story(16), "INTERIM", 160, sum * 0.5, "Interim payment 1: borehole", 1);
    await pay(ctx, id, story(16), "INTERIM", 35, sum * 0.35, "Interim payment 2: toilets", 2);
    await acceptedVisit(
      ctx,
      id,
      ctx.lagosMe,
      12,
      "FINAL_EVALUATION",
      "Final evaluation: boreholes and toilets complete and in use at four schools; at the Model ECCDE Centre, Moniya the toilet block still needs doors and finishes (punch list)."
    );
    await changeProjectPhase({ projectId: id, webUser: ctx.admin, input: { to: "HANDOVER_IN_PROGRESS" } });
    await prisma.visit.deleteMany({ where: { projectId: id, status: "PROPOSED" } });
    await recordHandoverResponse(id, ctx.lagosMe, {
      stakeholderType: "END_USER",
      decision: "ACCEPTED",
      submitterName: "Mrs Adebola Ogunleye",
      submitterRole: "Head teacher",
      feedbackText: "We accept the borehole and the toilets. Thank you.",
      snags: [],
      attest: true,
    });
    idByStory.set(16, id);
  }

  // #17 Ogun (Matching Grants), mobilising: kick-off held 9 days ago, mobilisation due in 5 days.
  {
    const id = await newProject(ctx, story(17), { contractorId: contractors.get("Olumo Works & Services Ltd")!, budget: 64_000_000, activatedDaysAgo: 12, assign: [ctx.lagosMe, ctx.resident] });
    const contractor = await prisma.projectContractor.findFirstOrThrow({ where: { projectId: id }, include: { organization: true } });
    await contractHistory(ctx, id, "OGSUBEB/MG/2026/0403", 9, {
      mobilised: false,
      invitees: [
        { group: "OWNER", name: ctx.lagosMe.fullName, email: ctx.lagosMe.email, userId: ctx.lagosMe.userId, organizationId: ctx.lagosMe.organizationId },
        { group: "MONITOR", name: ctx.monitor.fullName, email: ctx.monitor.email, userId: ctx.monitor.userId, organizationId: ctx.monitor.organizationId },
        { group: "CONTRACTOR", name: contractor.organization.name, email: null, organizationId: contractor.organizationId },
        { group: "BENEFICIARY", name: "Principal", email: null },
      ],
    });
    await prisma.projectContractMilestone.updateMany({
      where: { projectId: id, key: "acceptance-letter" },
      data: { status: "DONE", completedAt: new Date(`${addDays(today, -26)}T10:00:00.000Z`), completedNotes: "Acceptance letter received." },
    });
    await lightScope(ctx, id, [["Classroom block", 5, 70], ["Perimeter fence", 71, 120]], [
      { facility: "CLASSROOM", label: "Block of two classrooms", startSprint: 1, endSprint: 1, progressPct: 0, lines: [["Block of two classrooms, complete", "item", 1, 38_000_000]] },
      { facility: "FENCE", label: "Perimeter fence with gate (420 m)", startSprint: 2, endSprint: 2, progressPct: 0, lines: [["Block perimeter fence with steel gate", "m", 420, 52_000]] },
    ]);
    idByStory.set(17, id);
  }

  // #18 Anambra, ECCDE centre complete: final evaluation accepted, CoC drafted by the Director,
  // Physical Planning and waiting for its signatures.
  {
    const id = await newProject(ctx, story(18), { contractorId: contractors.get("Eastline Engineering Nigeria Ltd")!, budget: 72_000_000, activatedDaysAgo: 210, assign: [ctx.monitor, ctx.resident] });
    await contractHistory(ctx, id, "UBEC/DI/2026/AN/0301", 200);
    const sum = await lightScope(ctx, id, [["ECCDE block", -175, -80], ["Play area and equipment", -79, -10]], [
      { facility: "CRECHE", label: "ECCDE block (two playrooms, nap room and office)", startSprint: 1, endSprint: 1, progressPct: 100, lines: [["ECCDE block, complete", "item", 1, 48_000_000]] },
      { facility: "PLAY_EQUIPMENT", label: "Outdoor play equipment", startSprint: 2, endSprint: 2, progressPct: 100, plannedQuantity: 6, lines: [["Play equipment set, installed", "nr", 6, 1_900_000]] },
      { facility: "TOILET", label: "Child-size toilets", startSprint: 2, endSprint: 2, progressPct: 100, lines: [["Child-size toilet block, complete", "item", 1, 8_500_000]] },
    ]);
    await pay(ctx, id, story(18), "INTERIM", 120, sum * 0.45, "Interim payment 1: ECCDE block", 1);
    await pay(ctx, id, story(18), "INTERIM", 30, sum * 0.4, "Interim payment 2: play area and toilets", 2);
    await acceptedVisit(ctx, id, ctx.monitor, 4, "FINAL_EVALUATION", "Final evaluation: ECCDE centre complete and furnished; play equipment installed; no outstanding punch list items.");
    await changeProjectPhase({ projectId: id, webUser: ctx.admin, input: { to: "HANDOVER_IN_PROGRESS" } });
    await prisma.visit.deleteMany({ where: { projectId: id, status: "PROPOSED" } });
    await draftCompletionCertificate(id, ctx.dpp, { completionDate: addDays(today, -3) });
    idByStory.set(18, id);
  }

  // ---- Part 2 (wave 2): sites, contractor register, Demo 1 monitoring story, rating reports ---------
  const part2Started = Date.now();
  const contractorIds = await contractorRegister(ctx, idByStory);
  for (const s of STORIES) {
    const projectId = idByStory.get(s.n)!;
    const siteIds =
      (await prisma.projectSite.count({ where: { projectId } })) > 0
        ? (await prisma.projectSite.findMany({ where: { projectId }, orderBy: { siteNumber: "asc" }, select: { id: true } })).map((x) => x.id)
        : await createSites(ctx, projectId, s.n);
    await placeUnits(ctx, projectId, siteIds, SITE_PLANS[s.n]);
  }
  await demo1MonitoringStory(ctx, demo1);
  await ratingReports(ctx, idByStory);
  // #17's contractor stays Inactive until its signed contract is on file: make sure none is.
  await prisma.projectDocument.deleteMany({ where: { projectId: idByStory.get(17)!, documentType: { code: "CONTRACT" } } });
  // Published visits that have not started get a form with the new units and sites (as "Rebuild form" does).
  for (const v of await prisma.visit.findMany({
    where: { projectId: { in: [...idByStory.values()] }, status: "PLANNED", checkInAt: null, formSnapshotId: { not: null } },
    select: { id: true, projectId: true, visitKind: true, plannedDate: true, pickedFacilityIds: true, formSnapshotId: true, formHash: true },
  })) {
    await prisma.$transaction((tx) => freezeVisitForm(tx, v, { timezone: TZ, builtByUserId: null }), { timeout: 60_000 });
  }
  const ratingSnapshots = await refreshContractorRatingSnapshots(tenantId);
  const part2Seconds = (Date.now() - part2Started) / 1000;

  // Default case chains: the Executive Secretary (DI) or the SUBEB Executive Chairman (MG) decides.
  for (const s of STORIES) await writeDefaultCaseChain(ctx, idByStory.get(s.n)!, s.model);

  // Certificates already drafted keep their slots; their labels follow the client's titles.
  for (const c of await prisma.completionCertificate.findMany({ where: { project: { tenantId } }, select: { id: true, slotsJson: true } })) {
    const slots = (c.slotsJson as Array<Record<string, unknown>>).map((slot) => ({ ...slot, label: SLOT_LABELS[String(slot.key)] ?? slot.label }));
    await prisma.completionCertificate.update({ where: { id: c.id }, data: { slotsJson: slots as unknown as Prisma.InputJsonValue } });
  }

  // Click-through fixes (2026-11-26): references, titles, contract sums and payments in the new story,
  // budgets at or above the contract sum (before the approved lists read the budgets), stage dates.
  const voucherRenames = await tidyRelocatedRecords(ctx, idByStory);
  const stageDatesAligned = await alignStageDates(ctx, idByStory);

  // ---- Part 3 (wave 3): approved lists and links, Demo 2's contractor flagged ----------------------
  const lists = await approvedLists(ctx, idByStory);
  const flag = await flagDemo2Contractor(ctx, idByStory);

  // ---- Needs pipeline wave 5 (M3): where each project came from -----------------------------------
  // The normal seed's history matched the PRG projects before they were re-coded, relocated and
  // re-dated: it is written again from the overlay's projects (closed cycles of their years).
  await clearConvertedHistory(tenantId);
  const history = await seedConvertedHistory(tenantId, [...idByStory.values()], { today, openYear: needsOpenYear(today) });
  console.log(
    `   • Demo overlay needs pipeline: ${history.proposals} converted proposal(s) in ${history.cycles} closed cycle(s), ${history.outOfCycle} approved out-of-cycle request(s) (#11); #13 imported from the register.`
  );

  // Badges, alerts and KPI trends from the overlaid data (as seedAlerts and seedPhase16 do).
  for (const id of idByStory.values()) {
    const p = await prisma.project.findUniqueOrThrow({ where: { id }, select: { status: true } });
    if (p.status === "ACTIVE") await refreshScheduleBadge(id);
  }
  await seedAlerts();
  await prisma.kpiSnapshot.deleteMany({ where: { tenantId } });
  const kpis = await snapshotTenantKpis(tenantId, new Date(), { backfillMonths: 5 });
  // Last, after every writer of notifications: old codes and vouchers out of the stored text.
  const recoded = await recodeStoredText(idByStory, voucherRenames);
  console.log(`   • Demo overlay tidy-up: ${voucherRenames.size} voucher(s) renamed, ${stageDatesAligned} project(s) with stage dates aligned, ${recoded} stored text row(s) re-coded.`);

  // ---- Printed tables -----------------------------------------------------------------------------
  const rows = await prisma.project.findMany({
    where: { id: { in: [...idByStory.values()] } },
    select: { id: true, codePrefix: true, status: true, constructionPhase: true, scheduleStatus: true, alertStateJson: true, stateLocation: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  console.log(`   • Demo overlay (${((Date.now() - started) / 1000).toFixed(1)} s; KPIs: ${kpis}). Projects:`);
  for (const s of STORIES) {
    const r = byId.get(idByStory.get(s.n)!)!;
    const alerts = Object.keys((r.alertStateJson as Record<string, unknown>) ?? {}).join(",");
    console.log(
      `     ${String(s.n).padStart(2)} ${r.codePrefix.padEnd(19)} ${(s.source ?? "new").padEnd(8)} ${s.model} ${(r.stateLocation ?? "").padEnd(26)} ${r.status}/${r.constructionPhase} ${r.scheduleStatus ?? "-"}${alerts ? ` [${alerts}]` : ""}  ${s.story}`
    );
  }
  await printPart2Summary(ctx, idByStory, contractorIds, {
    seconds: part2Seconds,
    ratingSnapshots,
    catalogue,
  });
  await printPart3Summary(ctx, idByStory, lists, flag);
  console.log("   • Demo logins (password Password123!):");
  for (const [role, login, inDemo] of [
    ["System Administrator", UBEC_ADMIN_EMAIL, "settings, users, form library"],
    ["Executive Secretary", ES_EMAIL, "dashboard, alerts, default decision"],
    ["Director, Physical Planning", DPP_EMAIL, "creates projects, contractor, kick-off, CoC"],
    ["Finance Officer", FINANCE_EMAIL, "payments"],
    ["M&E Officer", UBEC_ME_EMAIL, "reviews reports, findings, handovers"],
    ["M&E Officer (SUBEB)", LAGOS_ME_EMAIL, "Matching Grants monitoring visits and handovers"],
    ["Resident Supervisor (field app only)", RESIDENT_SUPERVISOR_EMAIL, "field monitoring visits"],
    ["Independent M&E (COREN-certified firm)", INDEPENDENT_ME_EMAIL, "independent monitoring visits"],
    ["SUBEB Executive Chairman (Kano)", KANO_ADMIN_EMAIL, "Kano SUBEB projects"],
    ["SUBEB Executive Chairman (Sokoto)", SOKOTO_ADMIN_EMAIL, "decides the Sokoto default case"],
    ["SUBEB Executive Chairman (Lagos)", LAGOS_ADMIN_EMAIL, "Lagos SUBEB"],
  ] as const) {
    console.log(`     - ${role.padEnd(40)} ${login.padEnd(30)} ${inDemo}`);
  }
}
