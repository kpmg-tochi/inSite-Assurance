import { Prisma } from "@prisma/client";
import {
  addDays,
  buildLotBatchCode,
  CocSignatorySlotInput,
  defaultContractDefaultChain,
  fundingSourceText,
  lgaByCode,
  ProjectTypeConfig,
  ProjectTypeConfigSchema,
  ProjectTypeSnapshot,
  stateByCode,
  zonedCalendarDate,
  zoneOfState,
} from "@insite/shared";
import { prisma } from "../config/prisma";
import { WebJwtPayload } from "../middleware/auth.middleware";
import { recordAuditEvent } from "../modules/audit/audit.service";
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
import { KANO_SUBEB_NAME, ME_CONSULTANTS_NAME, PROGRAMME_TENANT_SLUG, UBEC_ORG_NAME } from "./seedPhase11";
import { heldKickoff, payloadFor } from "./seedPhase13";
import { approvedFinalEvaluation } from "./seedPhase15";
import {
  INDEPENDENT_ME_EMAIL,
  KANO_ADMIN_EMAIL,
  LAGOS_ADMIN_EMAIL,
  LAGOS_ME_EMAIL,
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
 * 3. Projects (North 10 / South 8), relocated to real LGAs, re-coded `{year}-LOT-{n}-BATCH-{m}` with
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
 * | 12 | 2026-LOT-1-BATCH-2 (new)  | FCT (NC)     | Gwagwalada      | DI    | Execution, on track                                         |
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
 */

const TZ = "Africa/Lagos";

const ROLE = {
  ES: "EXECUTIVE_SECRETARY",
  DPP: "DIRECTOR_PHYSICAL_PLANNING",
  FINANCE: "FINANCE_OFFICER",
} as const;

const ES_EMAIL = "es@ubec.test";
const DPP_EMAIL = "dpp@ubec.test";
const FINANCE_EMAIL = "finance@ubec.test";
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
  { n: 12, source: null, model: "DI", year: 2026, lot: 1, batch: 2, stateCode: "FC", lgaCode: "FC-GWAGWALADA", school: "LEA Primary School, Gwagwalada", name: "Construction of a Block of Two (2) Classrooms with Office & Store and Supply of Furniture at LEA Primary School, Gwagwalada", lat: 8.9427, lng: 7.0835, story: "Execution, on track" },
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
  "payments:view",
  "lessons:view",
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
    "UBEC HQ ICT: users, roles, workspace settings, form library, facilities, project types and visit plan rules. In the demo also covers the Director Legal and Internal Audit steps."
  );
  const chairman = await rename(
    UBEC_ROLE.SUBEB_ADMIN,
    "SUBEB Executive Chairman",
    "Heads a State Universal Basic Education Board: sees the SUBEB's Matching Grants projects, decides their contractor default cases and signs their Certificates of Completion."
  );
  await rename(
    UBEC_ROLE.UBEC_ME,
    "M&E Officer",
    "Monitoring & Evaluation on assigned projects (web and field app): mobilisation checks, baseline and quarterly monitoring, evaluations; reviews Resident Supervisor reports; raises and follows findings; handover review; CoC signature."
  );
  await rename(
    UBEC_ROLE.SUBEB_ME,
    "M&E Officer (SUBEB)",
    "A SUBEB's Monitoring & Evaluation on assigned Matching Grants projects (web and field app): visits, evaluations, handover responses and the SUBEB's CoC signature."
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
    const role = await prisma.role.create({ data: { tenantId, code, name, description, surface: "WEB", fieldPersonaType: "NONE", isSystemDefault: false } });
    await setPermissions(role.id, keys);
    created[code] = role.id;
  }

  const passwordHash = (await prisma.user.findUniqueOrThrow({ where: { email: UBEC_ADMIN_EMAIL } })).passwordHash;
  const flagship = await prisma.organization.findFirstOrThrow({ where: { tenantId, name: UBEC_ORG_NAME } });
  for (const [email, fullName, roleId, phone] of [
    [ES_EMAIL, "Aminu Yusuf", created[ROLE.ES], "+234 803 555 0201"],
    [DPP_EMAIL, "Ifeoma Nwosu", created[ROLE.DPP], "+234 803 555 0202"],
    [FINANCE_EMAIL, "Babatunde Adewale", created[ROLE.FINANCE], "+234 803 555 0203"],
  ] as const) {
    await prisma.user.create({ data: { tenantId, email, fullName, passwordHash, roleId, organizationId: flagship.id, phoneNumber: phone } });
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
  startSprint: number;
  endSprint: number;
  progressPct: number;
  plannedQuantity?: number;
  lines: LineSeed[];
}

/** Light demo data, written directly: work phases, facility units with progress and BoQ lines. */
async function lightScope(ctx: Ctx, projectId: string, sprints: Array<[name: string, start: number, end: number]>, units: UnitSeed[]): Promise<number> {
  const sprintIds: string[] = [];
  for (const [i, [name, start, end]] of sprints.entries()) {
    const row = await prisma.projectSprint.create({
      data: { projectId, number: i + 1, name, startDate: addDays(ctx.today, start), endDate: addDays(ctx.today, end), deliverables: name },
    });
    sprintIds.push(row.id);
  }
  let total = 0;
  for (const [i, u] of units.entries()) {
    const facility = await prisma.facility.findUniqueOrThrow({ where: { tenantId_code: { tenantId: ctx.tenantId, code: u.facility } } });
    const unit = await prisma.facilityUnit.create({
      data: {
        projectId,
        facilityId: facility.id,
        code: `U${String(i + 1).padStart(2, "0")}`,
        label: u.label,
        plannedQuantity: u.plannedQuantity ?? null,
        quantityUnit: u.plannedQuantity ? "nr" : null,
        startSprintId: sprintIds[u.startSprint - 1],
        endSprintId: sprintIds[u.endSprint - 1],
        sortOrder: (i + 1) * 10,
        progressPct: u.progressPct,
        progressAsOf: u.progressPct > 0 ? addDays(ctx.today, -7) : null,
      },
    });
    for (const [j, [description, unitOfMeasure, qty, rate]] of u.lines.entries()) {
      const amount = round2(qty * rate);
      total += amount;
      await prisma.boqItem.create({
        data: {
          projectId,
          facilityUnitId: unit.id,
          wbsCode: `${String(i + 1).padStart(2, "0")}.${String(j + 1).padStart(2, "0")}`,
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
    summaryText: `The routine visit of ${visitDate} raised the progress of ${units.length} facility unit(s).`,
    payload: { visitId: visit.id, progressIncrease: { asOf: visitDate, units: units.map((u) => ({ unitId: u.id, from: null, to: Number(u.progressPct) })) } },
  });
}

/** Contract dates and every contract milestone before completion done (light demo data). */
async function contractHistory(ctx: Ctx, projectId: string, ref: string, kickoffDaysAgo: number, mobilised = true) {
  const kickoff = addDays(ctx.today, -kickoffDaysAgo);
  await prisma.project.update({
    where: { id: projectId },
    data: {
      contractReference: ref,
      contractAwardDate: addDays(kickoff, -20),
      contractSignedDate: addDays(kickoff, -12),
      kickoffDate: kickoff,
      kickoffHeldAt: new Date(`${kickoff}T09:00:00.000Z`),
    },
  });
  await prisma.$transaction(async (tx) => {
    await syncContractMilestones(tx, projectId);
    await recomputeMilestoneDates(tx, projectId);
  });
  if (!mobilised) return;
  await prisma.projectContractMilestone.updateMany({
    where: { projectId, status: { in: ["PENDING", "DUE", "OVERDUE"] }, anchor: { notIn: ["COC_ISSUED", "PROJECT_CLOSED"] } },
    data: { status: "DONE", completedAt: new Date(`${addDays(kickoff, 14)}T10:00:00.000Z`), completedNotes: "Done (demo history)." },
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

async function pay(ctx: Ctx, projectId: string, code: string, kind: "INTERIM" | "FINAL", daysAgo: number, gross: number, description: string, n: number) {
  await recordPayment(projectId, ctx.finance, {
    kind,
    paidOn: addDays(ctx.today, -daysAgo),
    grossAmountNgn: round2(gross),
    reference: `UBEC/PV/${code}/${String(n).padStart(2, "0")}`,
    description,
  });
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

export async function seedDemoOverlay(): Promise<void> {
  const started = Date.now();
  const tenant = await prisma.tenant.findUnique({ where: { slug: PROGRAMME_TENANT_SLUG } });
  if (!tenant) return;
  const tenantId = tenant.id;
  const today = zonedCalendarDate(new Date(), TZ);

  const roleIds = await rolesAndLogins(tenantId);
  const flagship = await prisma.organization.findFirstOrThrow({ where: { tenantId, name: UBEC_ORG_NAME } });
  const subebByState = await subebs(tenantId, flagship.id, roleIds.chairman);
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
  };

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
  // phase 1 partly met) and a routine visit five days ago that raised the units' progress.
  const demo1 = idByStory.get(1)!;
  await prisma.projectSprint.updateMany({
    where: { projectId: demo1, number: { in: [1, 2] } },
    data: { verificationOutcome: "MET", verifiedAt: new Date(), verifiedByUserId: ctx.monitor.userId, verificationNotes: "Work phase deliverables in place and to specification." },
  });
  await prisma.facilityUnit.updateMany({ where: { projectId: demo1, code: "U01" }, data: { progressPct: 86 } });
  await prisma.facilityUnit.updateMany({ where: { projectId: demo1, code: "U02" }, data: { progressPct: 40 } });
  await prisma.$transaction((tx) => refreshProjectProgress(tx, demo1));
  await acceptedVisit(ctx, demo1, ctx.resident, 5, "ROUTINE", "Routine visit: plastering and painting under way on the classroom block; toilet block walls up.", true);

  // Demo 2 in trouble (light demo data, written directly; wave 2 replaces it with six sites): work phases
  // with the classroom block behind (phase 1 partly met) and paid well ahead of the work done.
  const demo2 = idByStory.get(2)!;
  if ((await prisma.boqItem.count({ where: { projectId: demo2 } })) === 0) {
    const sum = await lightScope(ctx, demo2, [["Substructure", -100, -45], ["Superstructure and roofing", -44, -5], ["Finishes, toilets and furniture", -4, 50]], classroomBlock([45, 0, 0]));
    await prisma.projectSprint.updateMany({
      where: { projectId: demo2, number: 1 },
      data: { verificationOutcome: "PARTLY_MET", verifiedAt: new Date(), verifiedByUserId: ctx.monitor.userId, verificationNotes: "Foundations late; ground floor slab not cast." },
    });
    await pay(ctx, demo2, code0(story0(2)), "INTERIM", 70, sum * 0.35, "Interim payment 1: substructure", 1);
    await pay(ctx, demo2, code0(story0(2)), "INTERIM", 20, sum * 0.3, "Interim payment 2: superstructure", 2);
  }

  // ---- New projects (#12–#18): light demo data ---------------------------------------------------
  const contractors = new Map<string, string>();
  for (const name of ["Arewa Classic Builders Ltd", "Zuma Rock Construction Company Ltd", "Eastline Engineering Nigeria Ltd", "Olumo Works & Services Ltd"]) {
    contractors.set(name, (await prisma.organization.create({ data: { tenantId, name, categories: ["CONTRACTOR"] } })).id);
  }
  const sahel = (await prisma.organization.findFirstOrThrow({ where: { tenantId, name: "Sahel Build & Civil Works Ltd" } })).id;
  const story = story0;
  const code = (n: number) => code0(story0(n));

  // #12 FCT, execution on track: phase 1 done, phase 2 under way; a routine visit raised progress 6 days ago.
  {
    const id = await newProject(ctx, story(12), { contractorId: contractors.get("Zuma Rock Construction Company Ltd")!, budget: 85_000_000, activatedDaysAgo: 75, assign: [ctx.monitor, ctx.resident] });
    await contractHistory(ctx, id, "UBEC/DI/2026/FC/0102", 70);
    const sum = await lightScope(ctx, id, [["Substructure", -45, -10], ["Superstructure and roofing", -9, 40], ["Finishes, toilets and furniture", 41, 90]], classroomBlock([55, 10, 0]));
    await prisma.projectSprint.updateMany({ where: { projectId: id, number: 1 }, data: { verificationOutcome: "MET", verifiedAt: new Date(), verifiedByUserId: ctx.monitor.userId, verificationNotes: "Substructure complete." } });
    await acceptedVisit(ctx, id, ctx.resident, 6, "ROUTINE", "Routine visit: block walls at lintel level; materials on site; workers in PPE.", true);
    await pay(ctx, id, code(12), "INTERIM", 20, sum * 0.25, "Interim payment 1: substructure", 1);
    idByStory.set(12, id);
  }

  // #13 Kano, imported from the register: ongoing at 45%, no scope yet (the imported % shows).
  {
    const id = await newProject(ctx, story(13), { contractorId: sahel, budget: 78_000_000, activatedDaysAgo: 40, assign: [ctx.monitor, ctx.resident] });
    const importedAt = new Date(`${addDays(today, -40)}T09:30:00.000Z`);
    await prisma.project.update({
      where: { id },
      data: { importedAt, importedProgressPct: 45, importedStatus: "Ongoing", certifiedProgressPct: 45, activatedAt: importedAt, contractSumNgn: 76_500_000, contractReference: "UBEC/DI/2025/KN/0202" },
    });
    await prisma.$transaction((tx) => syncContractMilestones(tx, id));
    await prisma.projectContractMilestone.updateMany({
      where: { projectId: id, status: { in: ["PENDING", "DUE", "OVERDUE"] }, anchor: { notIn: ["COC_ISSUED", "PROJECT_CLOSED"] } },
      data: { status: "WAIVED", waivedReason: "Imported from the project register: the project was already under way.", completedAt: importedAt, completedByUserId: ctx.admin.userId },
    });
    await acceptedVisit(ctx, id, ctx.resident, 8, "ROUTINE", "Routine visit: roofing in progress on the classroom block; toilet pit dug.");
    await pay(ctx, id, code(13), "INTERIM", 30, 76_500_000 * 0.3, "Interim payment 1 (before import)", 1);
    idByStory.set(13, id);
  }

  // #14 Kaduna, execution near the end; the final payment was recorded before the CoC (exception).
  {
    const id = await newProject(ctx, story(14), { contractorId: contractors.get("Arewa Classic Builders Ltd")!, budget: 88_000_000, activatedDaysAgo: 160, assign: [ctx.monitor, ctx.resident] });
    await contractHistory(ctx, id, "UBEC/DI/2026/KD/0104", 150);
    const sum = await lightScope(ctx, id, [["Substructure", -125, -90], ["Superstructure and roofing", -89, -30], ["Finishes, toilets and furniture", -29, 20]], classroomBlock([95, 80, 50]));
    await prisma.projectSprint.updateMany({ where: { projectId: id, number: { in: [1, 2] } }, data: { verificationOutcome: "MET", verifiedAt: new Date(), verifiedByUserId: ctx.monitor.userId } });
    await acceptedVisit(ctx, id, ctx.resident, 9, "ROUTINE", "Routine visit: finishes under way; toilet block roofed; first furniture delivered.", true);
    await pay(ctx, id, code(14), "INTERIM", 100, sum * 0.35, "Interim payment 1: substructure", 1);
    await pay(ctx, id, code(14), "INTERIM", 45, sum * 0.3, "Interim payment 2: superstructure and roofing", 2);
    await pay(ctx, id, code(14), "FINAL", 3, sum * 0.2, "Final payment (recorded before the Certificate of Completion)", 3);
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
    await acceptedVisit(ctx, id, ctx.resident, 50, "ROUTINE", "Routine visit: foundations cast; site idle on the day, contractor's crew demobilised for the season.");
    await pay(ctx, id, code(15), "INTERIM", 60, sum * 0.15, "Mobilisation advance", 1);
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
    await pay(ctx, id, code(16), "INTERIM", 160, sum * 0.5, "Interim payment 1: borehole", 1);
    await pay(ctx, id, code(16), "INTERIM", 35, sum * 0.35, "Interim payment 2: toilets", 2);
    await acceptedVisit(ctx, id, ctx.lagosMe, 12, "FINAL_EVALUATION", "Final evaluation: borehole yield good, toilets complete and in use; no outstanding snags.");
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
    await contractHistory(ctx, id, "OGSUBEB/MG/2026/0403", 9, false);
    await prisma.projectContractMilestone.updateMany({
      where: { projectId: id, key: "acceptance-letter" },
      data: { status: "DONE", completedAt: new Date(`${addDays(today, -26)}T10:00:00.000Z`), completedNotes: "Acceptance letter received." },
    });
    const contractor = await prisma.projectContractor.findFirstOrThrow({ where: { projectId: id }, include: { organization: true } });
    await heldKickoff({
      projectId: id,
      date: addDays(today, -9),
      minutesDocumentId: null,
      invitees: [
        { group: "OWNER", name: ctx.lagosMe.fullName, email: ctx.lagosMe.email, userId: ctx.lagosMe.userId, organizationId: ctx.lagosMe.organizationId },
        { group: "MONITOR", name: ctx.monitor.fullName, email: ctx.monitor.email, userId: ctx.monitor.userId, organizationId: ctx.monitor.organizationId },
        { group: "CONTRACTOR", name: contractor.organization.name, email: null, organizationId: contractor.organizationId },
        { group: "BENEFICIARY", name: "Principal", email: null },
      ],
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
    await pay(ctx, id, code(18), "INTERIM", 120, sum * 0.45, "Interim payment 1: ECCDE block", 1);
    await pay(ctx, id, code(18), "INTERIM", 30, sum * 0.4, "Interim payment 2: play area and toilets", 2);
    await acceptedVisit(ctx, id, ctx.monitor, 4, "FINAL_EVALUATION", "Final evaluation: ECCDE centre complete and furnished; play equipment installed; no outstanding snags.");
    await changeProjectPhase({ projectId: id, webUser: ctx.admin, input: { to: "HANDOVER_IN_PROGRESS" } });
    await prisma.visit.deleteMany({ where: { projectId: id, status: "PROPOSED" } });
    await draftCompletionCertificate(id, ctx.dpp, { completionDate: addDays(today, -3) });
    idByStory.set(18, id);
  }

  // Default case chains: the Executive Secretary (DI) or the SUBEB Executive Chairman (MG) decides.
  for (const s of STORIES) await writeDefaultCaseChain(ctx, idByStory.get(s.n)!, s.model);

  // Certificates already drafted keep their slots; their labels follow the client's titles.
  for (const c of await prisma.completionCertificate.findMany({ where: { project: { tenantId } }, select: { id: true, slotsJson: true } })) {
    const slots = (c.slotsJson as Array<Record<string, unknown>>).map((slot) => ({ ...slot, label: SLOT_LABELS[String(slot.key)] ?? slot.label }));
    await prisma.completionCertificate.update({ where: { id: c.id }, data: { slotsJson: slots as unknown as Prisma.InputJsonValue } });
  }

  // Badges, alerts and KPI trends from the overlaid data (as seedAlerts and seedPhase16 do).
  for (const id of idByStory.values()) {
    const p = await prisma.project.findUniqueOrThrow({ where: { id }, select: { status: true } });
    if (p.status === "ACTIVE") await refreshScheduleBadge(id);
  }
  await seedAlerts();
  await prisma.kpiSnapshot.deleteMany({ where: { tenantId } });
  const kpis = await snapshotTenantKpis(tenantId, new Date(), { backfillMonths: 5 });

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
  console.log("   • Demo logins (password Password123!):");
  for (const [role, login, inDemo] of [
    ["System Administrator", UBEC_ADMIN_EMAIL, "settings, users, form library"],
    ["Executive Secretary", ES_EMAIL, "dashboard, alerts, default decision"],
    ["Director, Physical Planning", DPP_EMAIL, "creates projects, contractor, kick-off, CoC"],
    ["Finance Officer", FINANCE_EMAIL, "payments"],
    ["M&E Officer", UBEC_ME_EMAIL, "reviews reports, findings, handovers"],
    ["M&E Officer (SUBEB)", LAGOS_ME_EMAIL, "Matching Grants visits and handovers"],
    ["Resident Supervisor (field app only)", RESIDENT_SUPERVISOR_EMAIL, "field visits"],
    ["Independent M&E (COREN-certified firm)", INDEPENDENT_ME_EMAIL, "independent visits"],
    ["SUBEB Executive Chairman (Kano)", KANO_ADMIN_EMAIL, "Kano SUBEB projects"],
    ["SUBEB Executive Chairman (Sokoto)", SOKOTO_ADMIN_EMAIL, "decides the Sokoto default case"],
    ["SUBEB Executive Chairman (Lagos)", LAGOS_ADMIN_EMAIL, "Lagos SUBEB"],
  ] as const) {
    console.log(`     - ${role.padEnd(40)} ${login.padEnd(30)} ${inDemo}`);
  }
}
