import { addDays, DEFAULT_FACILITIES, nextWorkdayOnOrAfter } from "@insite/shared";
import type { WorkbookBuildData, WorkbookFacility, WorkbookLine, WorkbookSprint, WorkbookUnit } from "../modules/scope/workbook/scopeWorkbook";
import type { DemoDocumentCode, DemoDocumentContext } from "../db/demoDocuments";
import type { RegisterRowRaw } from "@insite/shared";
import type { RegisterWorkbookData } from "../modules/projectRegister/registerWorkbook";

/**
 * The project created live in the UBEC demo (Direct Intervention, Kano): its needs assessment, its
 * dates relative to the demo day, and the documents the presenter uploads. Shared by the demo-pack
 * generator (`buildDemoPack.ts`) and the route test that walks the demo (`routes.demo.test.ts`).
 */

export const DEMO_PROJECT = {
  name: "WASH upgrade, Government Primary School Dawakin Tofa",
  code: "PRG-110",
  school: "Government Primary School, Dawakin Tofa",
  stateLocation: "Kano State",
  /** Region list entry (an area of North West). */
  region: "Kano",
  lga: "Dawakin Tofa",
  siteAddress: "School compound, Dawakin Tofa town, Dawakin Tofa LGA, Kano State",
  /** Approximate point for the demo (inside the 150 m default radius it creates). */
  latitude: 12.1006,
  longitude: 8.3354,
  deliveryModel: "Direct Intervention",
  typeCode: "CENTRAL",
  budgetNgn: 48_500_000,
  contractSumNgn: 46_490_000,
  /** UBEC IRL register fields (filled from the needs assessment). */
  interventionYear: 2026,
  fundingSource: "UBEC Intervention Fund",
  contractReference: "UBEC/DI/2026/110",
  contractor: "Kurmi Waterworks & Construction Ltd",
  headTeacher: "Mallam Ibrahim Yusuf (Head teacher)",
  strategicJustification:
    "The school (about 900 pupils) has no working toilets and no safe water on site; pupils walk to a hand pump 600 m away. The needs assessment rated WASH as the school's first priority.",
  assumptions: "Water table at 60–80 m (yield to be confirmed by the drilling test). The school keeps pupils clear of the works area. Works continue through the dry season.",
} as const;

/** A unit: Unit ID, facility (catalogue code and name), label, start/end sprint. */
export const DEMO_UNITS: Array<WorkbookUnit & { facilityCode: string }> = [
  { code: "T1", facilityCode: "TOILET", facilityName: "Toilet", label: "Toilet block, 8 cubicles (boys and girls)", plannedQuantity: null, quantityUnit: null, startSprint: 1, endSprint: 2 },
  { code: "BH1", facilityCode: "BOREHOLE", facilityName: "Borehole", label: "Motorised borehole with overhead tank", plannedQuantity: null, quantityUnit: null, startSprint: 1, endSprint: 2 },
  { code: "SP1", facilityCode: "SOLAR_POWER", facilityName: "Solar power", label: "Solar power for the borehole pump", plannedQuantity: null, quantityUnit: null, startSprint: 2, endSprint: 2 },
];

export const DEMO_LINES: WorkbookLine[] = [
  { wbsCode: "01.01", unitCode: "T1", description: "Excavation, blinding and strip foundations for the toilet block", unit: "m3", totalQuantity: 42, rateNgn: 38_000 },
  { wbsCode: "01.02", unitCode: "T1", description: "225 mm sandcrete block walls, plastered and painted", unit: "m2", totalQuantity: 310, rateNgn: 18_500 },
  { wbsCode: "01.03", unitCode: "T1", description: "Roof: timber trusses and long-span aluminium sheets", unit: "m2", totalQuantity: 96, rateNgn: 24_000 },
  { wbsCode: "01.04", unitCode: "T1", description: "WC pans, urinals and hand-washing basins with plumbing, septic tank and soakaway", unit: "LS", totalQuantity: 1, rateNgn: 8_400_000 },
  { wbsCode: "02.01", unitCode: "BH1", description: "Drill, case and develop a 150 mm borehole (80 m), with yield test", unit: "m", totalQuantity: 80, rateNgn: 95_000 },
  { wbsCode: "02.02", unitCode: "BH1", description: "Steel tank stand with a 5,000-litre overhead tank", unit: "item", totalQuantity: 1, rateNgn: 6_500_000 },
  { wbsCode: "02.03", unitCode: "BH1", description: "Water reticulation to the toilet block and four taps", unit: "m", totalQuantity: 120, rateNgn: 22_000 },
  { wbsCode: "03.01", unitCode: "SP1", description: "1.5 kW solar submersible pump with controller, and 8 × 400 W panels on a frame", unit: "set", totalQuantity: 1, rateNgn: 9_500_000 },
];

const WORK_WEEK = [1, 2, 3, 4, 5];

/** The demo's dates, relative to the demo day (`today`, YYYY-MM-DD in Africa/Lagos). */
export function demoDates(today: string) {
  // Sprint 1 starts on the first working day about three weeks out (just after the 21-day mobilisation).
  const sprint1Start = nextWorkdayOnOrAfter(addDays(today, 22), WORK_WEEK);
  const sprint1End = addDays(sprint1Start, 5 * 7 - 1);
  const sprint2Start = addDays(sprint1End, 1);
  const sprint2End = addDays(sprint2Start, 6 * 7 - 1);
  return {
    today,
    awardDate: addDays(today, -14),
    acceptanceDate: addDays(today, -12),
    signedDate: addDays(today, -7),
    /** Planned and held on the demo day. */
    kickoffDate: today,
    plannedCompletion: sprint2End,
    sprints: [
      { number: 1, name: "Sprint 1: foundations and drilling", startDate: sprint1Start, endDate: sprint1End, deliverables: "Toilet block substructure and walls; borehole drilled, cased and yield-tested." },
      { number: 2, name: "Sprint 2: roofing, fittings and power", startDate: sprint2Start, endDate: sprint2End, deliverables: "Toilet block roofed and fitted; tank stand, reticulation and taps; solar pump installed and tested." },
    ] satisfies WorkbookSprint[],
  };
}

/** The facility list as the UBEC workspace has it (the 50 defaults). */
export function demoFacilities(): WorkbookFacility[] {
  return DEFAULT_FACILITIES.map((f, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, code: f.code, name: f.name, archetype: f.archetype, isRetired: false }));
}

/** What the filled needs-assessment workbook contains (the builder's input). */
export function demoWorkbookData(today: string, generatedAt = new Date()): WorkbookBuildData {
  const d = demoDates(today);
  return {
    generatedAt,
    title: `${DEMO_PROJECT.code} · ${DEMO_PROJECT.name}`,
    brandName: "UBEC",
    project: {
      name: DEMO_PROJECT.name,
      school: DEMO_PROJECT.school,
      region: DEMO_PROJECT.region,
      lga: DEMO_PROJECT.lga,
      siteAddress: DEMO_PROJECT.siteAddress,
      latitude: DEMO_PROJECT.latitude,
      longitude: DEMO_PROJECT.longitude,
      deliveryModel: DEMO_PROJECT.deliveryModel,
      budget: DEMO_PROJECT.budgetNgn,
      interventionYear: DEMO_PROJECT.interventionYear,
      fundingSource: DEMO_PROJECT.fundingSource,
      strategicJustification: DEMO_PROJECT.strategicJustification,
      assumptions: DEMO_PROJECT.assumptions,
    },
    facilities: demoFacilities().map((f) => ({ code: f.code, name: f.name })),
    // The UBEC workspace's lists (seedPhase11), sorted by name as the server sorts them.
    regions: ["Kaduna", "Kano", "Lagos", "North West", "Ogun", "South West"],
    deliveryModels: ["Direct Intervention", "Matching Grants"],
    sprints: d.sprints,
    units: DEMO_UNITS.map(({ facilityCode: _code, ...u }) => u),
    lines: DEMO_LINES,
  };
}

export const DEMO_WORKBOOK_FILE = "Dawakin Tofa needs assessment.xlsx";

/** The specimen context of the demo project's documents. */
export function demoDocumentContext(today: string, date: string = today): DemoDocumentContext {
  const d = demoDates(today);
  return {
    projectName: DEMO_PROJECT.name,
    projectCode: DEMO_PROJECT.code,
    school: DEMO_PROJECT.school,
    contractor: DEMO_PROJECT.contractor,
    contractReference: DEMO_PROJECT.contractReference,
    contractSumNgn: DEMO_PROJECT.contractSumNgn,
    state: DEMO_PROJECT.stateLocation,
    lga: DEMO_PROJECT.lga,
    date,
    awardDate: d.awardDate,
    signedDate: d.signedDate,
    kickoffDate: d.kickoffDate,
    mobilisationDays: 21,
    residentSupervisor: "Musa Danladi",
    meOfficer: "Ngozi Eze",
    scope: DEMO_UNITS.map((u) => u.label),
    sprints: d.sprints,
    beneficiarySignatory: DEMO_PROJECT.headTeacher,
  };
}

/** The PDFs the presenter uploads, in demo order: file name, type, register title, when, document date. */
export function demoPackDocuments(today: string): Array<{ file: string; code: DemoDocumentCode; typeCode: string; title: string; when: string; date: string }> {
  const d = demoDates(today);
  return [
    { file: "01 Letter of award.pdf", code: "AWARD_LETTER", typeCode: "AWARD_LETTER", title: "Letter of award", when: "After activation, Documents: contract evidence", date: d.awardDate },
    { file: "02 Acceptance of award.pdf", code: "ACCEPTANCE_LETTER", typeCode: "ACCEPTANCE_LETTER", title: `Acceptance of award, ${DEMO_PROJECT.contractor}`, when: "Documents (completes 'Acceptance letter received')", date: d.acceptanceDate },
    { file: "03 Contract agreement.pdf", code: "CONTRACT", typeCode: "CONTRACT", title: `Contract agreement ${DEMO_PROJECT.contractReference}`, when: "Documents", date: d.signedDate },
    { file: "04 Kick-off agenda and briefing pack.pdf", code: "KICKOFF_BRIEFING_PACK", typeCode: "KICKOFF_BRIEFING_PACK", title: "Kick-off agenda and briefing pack", when: "Kick-off tab: 'Briefing pack (sent with the notice)'", date: addDays(today, -1) },
    { file: "05 Kick-off meeting minutes.pdf", code: "KICKOFF_MINUTES", typeCode: "KICKOFF_MINUTES", title: `Kick-off meeting minutes, ${fmt(today)}`, when: "Kick-off tab: 'Minutes' when recording the meeting as held; then sign off (owner + M&E)", date: today },
    { file: "06 Letter of introduction to the Head Teacher.pdf", code: "LETTER_OF_INTRODUCTION", typeCode: "LETTER_OF_INTRODUCTION", title: "Letter of introduction to the Head Teacher", when: "Documents, after the kick-off (the Resident Supervisor says it was presented)", date: today },
    { file: "07 Resident Supervisor assignment.pdf", code: "SUPERVISOR_ASSIGNMENT", typeCode: "SUPERVISOR_ASSIGNMENT", title: "Resident Supervisor assignment, Musa Danladi", when: "Documents, after the kick-off", date: today },
    { file: "08 Mobilisation agreement (PPE clause).pdf", code: "MOBILISATION_AGREEMENT", typeCode: "MOBILISATION_AGREEMENT", title: "Mobilisation agreement (incl. PPE on site)", when: "Documents, contractor: Kurmi; sign off. Its PPE clause is what the inspector's finding pays off", date: today },
    { file: "09 Site possession form.pdf", code: "SITE_POSSESSION_FORM", typeCode: "SITE_POSSESSION_FORM", title: `Site possession form, ${fmt(today)}`, when: "Documents, contractor: Kurmi; sign off (completes 'Mobilisation documents complete' with the agreement)", date: today },
    { file: "10 Programme of works.pdf", code: "PROGRAMME_OF_WORKS", typeCode: "PROGRAMME_OF_WORKS", title: "Programme of works, by sprint", when: "Optional: Documents; its sign-off records the programme as accepted", date: today },
    { file: "11 Mobilisation plan.pdf", code: "MOBILISATION_PLAN", typeCode: "MOBILISATION_PLAN", title: "Contractor's mobilisation plan", when: "Optional: Documents", date: today },
    { file: "12 Certificate of Completion - signed paper copy.pdf", code: "COC_SIGNED_COPY", typeCode: "COMPLETION_CERTIFICATE", title: "Certificate of Completion, signed paper copy", when: "Completion & handover → Certificate: 'Record signed copy' (beneficiary slot)", date: today },
    { file: "13 Closeout report.pdf", code: "CLOSEOUT_REPORT", typeCode: "CLOSEOUT_REPORT", title: `Closeout report: ${DEMO_PROJECT.school}`, when: "Completion & handover → Closure: 'Upload closeout report' (PRG-106 or the live project)", date: today },
  ];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmt(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

// ---------------------------------------------------------------------------
// UBEC IRL: the project register import (demo pack file 14)
// ---------------------------------------------------------------------------

export const DEMO_REGISTER_FILE = "14 Project register import.xlsx";

/**
 * Six projects of the existing UBEC register, in the import template: two not started (drafts), three
 * ongoing and one completed (live imported projects), Kano and Lagos, Direct Intervention and Matching
 * Grants. Codes are left blank (numbered after the highest PRG code). Two contractors are new
 * organisations; "Sahel Build & Civil Works Ltd" is already in the seeded workspace. Dates are relative
 * to the demo day. Imports cleanly on a freshly seeded database (routes.irl.register.test.ts).
 */
export function demoRegisterRows(today: string): RegisterRowRaw[] {
  const d = (days: number) => addDays(today, days);
  const DI = "Direct Intervention";
  const MG = "Matching Grants";
  return [
    {
      externalReference: "UBEC/DI/2026/KN/031",
      name: "Renovation of a three-classroom block, LGEA Primary School Gwarzo",
      school: "LGEA Primary School, Gwarzo",
      state: "Kano",
      lga: "Gwarzo",
      projectType: DI,
      budget: 32_000_000,
      interventionYear: 2026,
      fundingSource: "UBEC Intervention Fund",
      status: "Not started",
    },
    {
      externalReference: "UBEC/MG/2026/LA/012",
      name: "Perimeter fence and gatehouse, Agege Junior Secondary School",
      school: "Agege Junior Secondary School",
      state: "Lagos",
      lga: "Agege",
      projectType: MG,
      owner: "Lagos State Universal Basic Education Board (SUBEB)",
      budget: 18_500_000,
      interventionYear: 2026,
      fundingSource: "Matching grant (SUBEB counterpart)",
      status: "Not started",
    },
    {
      externalReference: "UBEC/DI/2025/KN/014",
      name: "Two-classroom block with head teacher's office, Government Primary School Bichi",
      school: "Government Primary School, Bichi",
      state: "Kano",
      lga: "Bichi",
      siteAddress: "School compound, Bichi town, Bichi LGA, Kano State",
      latitude: 12.2336,
      longitude: 8.2412,
      projectType: DI,
      contractor: "Sahel Build & Civil Works Ltd",
      contractSum: 41_200_000,
      budget: 43_000_000,
      contractAwardDate: d(-300),
      contractSignedDate: d(-290),
      plannedStartDate: d(-270),
      plannedCompletionDate: d(60),
      interventionYear: 2025,
      fundingSource: "UBEC Intervention Fund",
      status: "Ongoing",
      percentComplete: 55,
    },
    {
      externalReference: "UBEC/MG/2025/LA/007",
      name: "WASH facilities, Ikorodu Community Primary School",
      school: "Ikorodu Community Primary School",
      state: "Lagos",
      lga: "Ikorodu",
      latitude: 6.6194,
      longitude: 3.5105,
      projectType: MG,
      owner: "Lagos State Universal Basic Education Board (SUBEB)",
      contractor: "Eko Waterline Engineering Ltd",
      contractSum: 27_800_000,
      contractAwardDate: d(-200),
      contractSignedDate: d(-190),
      plannedStartDate: d(-170),
      plannedCompletionDate: d(90),
      interventionYear: 2025,
      fundingSource: "Matching grant (SUBEB counterpart)",
      status: "Ongoing",
      percentComplete: 30,
    },
    {
      externalReference: "UBEC/MG/2025/KN/019",
      name: "Library and ICT room, Dala Junior Secondary School",
      school: "Dala Junior Secondary School",
      state: "Kano",
      lga: "Dala",
      latitude: 12.0045,
      longitude: 8.5011,
      projectType: MG,
      owner: "Kano State Universal Basic Education Board (SUBEB)",
      contractor: "Sahel Build & Civil Works Ltd",
      contractSum: 36_500_000,
      contractAwardDate: d(-330),
      contractSignedDate: d(-320),
      plannedStartDate: d(-300),
      plannedCompletionDate: d(30),
      interventionYear: 2025,
      fundingSource: "Matching grant (SUBEB counterpart)",
      status: "Ongoing",
      percentComplete: 72,
    },
    {
      externalReference: "UBEC/DI/2024/KN/022",
      name: "Solar-powered borehole, Tudun Wada Model Primary School",
      school: "Tudun Wada Model Primary School",
      state: "Kano",
      lga: "Tudun Wada",
      latitude: 11.2512,
      longitude: 8.4058,
      projectType: DI,
      contractor: "Gwale Borehole Services Ltd",
      contractSum: 14_900_000,
      contractAwardDate: d(-520),
      contractSignedDate: d(-510),
      plannedStartDate: d(-490),
      plannedCompletionDate: d(-60),
      interventionYear: 2024,
      fundingSource: "UBEC Intervention Fund",
      status: "Completed",
      percentComplete: 100,
    },
  ];
}

/** The register import file as the UBEC workspace's template would hold it (lists as seeded). */
export function demoRegisterWorkbookData(today: string, generatedAt = new Date()): RegisterWorkbookData {
  return {
    generatedAt,
    brandName: "UBEC",
    term: "UBEC project ID",
    states: ["Kaduna", "Kano", "Lagos", "Ogun"],
    projectTypes: ["Direct Intervention", "Matching Grants"],
    owners: [
      "Independent M&E Consultants (COREN-certified)",
      "Kano State Universal Basic Education Board (SUBEB)",
      "Lagos State Universal Basic Education Board (SUBEB)",
      "Universal Basic Education Commission (UBEC)",
    ],
    contractors: ["Sahel Build & Civil Works Ltd"],
    rows: demoRegisterRows(today),
  };
}
