import {
  CostingStandardSchema,
  DEFAULT_COSTING_STANDARD,
  DEFAULT_FACILITIES,
  standardRateFor,
  zoneOfState,
  type CostingStandard,
  type ExistingCondition,
  type FacilityCriticality,
  type InterventionAction,
  type SchoolLevel,
} from "@insite/shared";
import type { NeedsFileContext, NeedsFileLine, NeedsFileRow, NeedsFileSite, NeedsFileSpec } from "../modules/needs/workbook/fillNeedsWorkbook";
import type { NeedsWorkbookFacility } from "../modules/needs/workbook/needsWorkbook";
import { DEMO_LINES, DEMO_PROJECT, DEMO_SITES, DEMO_UNITS } from "../scripts/demoProject";

/**
 * Needs pipeline wave 5 (N9): the content of the needs assessments the seed uploads into the open
 * cycles and of the demo pack's upload files, as people would type them into template v2. Pure (no
 * database): `seedNeedsPipeline.ts` builds and uploads the files through the real services, the demo
 * pack (`scripts/buildDemoPack.ts`) builds its files and the appropriated schedule from the same specs,
 * and `routes.demo.test.ts` reads the expected references from here.
 *
 * Year: the open cycles are for the year after the run day (the cycle for year Y runs in Y − 1), so the
 * references (`<Y>-DI-001` …) follow the run day like every other seeded date.
 *
 * Places: every school is distinct and kilometres from every other, so nothing is flagged as a
 * duplicate except the one meant to be (`<Y>-DI-007`, the same school as `<Y>-DI-006`). The States are
 * ones the seeded and overlay projects do not use, except Kano (the Dawakin Tofa proposal, the demo
 * project: its sites, units and BoQ are the demo pack's `DEMO_SITES`, `DEMO_UNITS` and `DEMO_LINES`).
 */

export const NEEDS_SEED_TZ = "Africa/Lagos";

/** The open cycles' intervention year: the year after the run day (YYYY-MM-DD). */
export function needsOpenYear(today: string): number {
  return Number(today.slice(0, 4)) + 1;
}

export const SEED_COSTING_STANDARD: CostingStandard = CostingStandardSchema.parse(DEFAULT_COSTING_STANDARD);

/** The normal seed's catalogue (the 50 defaults; the overlay renames them, same codes). */
export function defaultWorkbookFacilities(): NeedsWorkbookFacility[] {
  return DEFAULT_FACILITIES.map((f, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, code: f.code, name: f.name, isRetired: false }));
}

/** The file context of a cycle with the seeded costing standard (version 1). */
export function seedFileContext(programme: "DI" | "MG", year: number, facilities: NeedsWorkbookFacility[] = defaultWorkbookFacilities()): NeedsFileContext {
  return {
    tenantShortName: "UBEC",
    programmeName: programme === "DI" ? "Direct Intervention" : "Matching Grants",
    interventionYear: year,
    stateCode: programme === "MG" ? "KN" : null,
    costingStandard: { version: 1, standard: SEED_COSTING_STANDARD },
    facilities,
  };
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function stdRate(itemCode: string, stateCode: string): number {
  const rate = standardRateFor(SEED_COSTING_STANDARD, itemCode, zoneOfState(stateCode));
  if (rate === null) throw new Error(`Unknown item code ${itemCode}`);
  return rate;
}
const stdItem = (itemCode: string) => SEED_COSTING_STANDARD.rates.find((r) => r.itemCode === itemCode)!;

/** A BoQ line at the standard rate × `factor`. */
function line(wbsCode: string, unitId: string, itemCode: string, quantity: number, stateCode: string, factor = 1): NeedsFileLine {
  const std = stdItem(itemCode);
  return { wbsCode, unitId, itemCode, description: std.description, unit: std.unitOfMeasure, quantity, rate: Math.round(stdRate(itemCode, stateCode) * factor) };
}

function row(
  unitId: string,
  siteNumber: number,
  facility: string,
  action: InterventionAction | string,
  existingQuantity: number | null,
  condition: ExistingCondition,
  requiredQuantity: number,
  proposedQuantity: number | null,
  priority: FacilityCriticality,
  justification: string,
  extra: Partial<NeedsFileRow> = {}
): NeedsFileRow {
  return { unitId, siteNumber, facility, action, existingQuantity, condition, requiredQuantity, proposedQuantity, unit: "nr", preliminaryCostNgn: null, justification, priority, evidence: null, ...extra };
}

function site(siteNumber: number, schoolName: string, lgaCode: string, latitude: number, longitude: number, extra: Partial<NeedsFileSite> = {}): NeedsFileSite {
  return { siteNumber, schoolName, schoolLevel: "PRIMARY", lgaCode, address: null, latitude, longitude, enrolment: null, ...extra };
}

/** An existing facility in working order, recorded without work (meets the essential-facilities rule). */
const working = (unitId: string, siteNumber: number, facility: string, qty = 1) =>
  row(unitId, siteNumber, facility, "RENOVATION", qty, "FUNCTIONAL", qty, 0, "ESSENTIAL", "In working order; no work needed.");

/** A one-site proposal with classrooms (new or renovated), a toilet block and solar, water as given. */
function schoolSpec(p: {
  name: string;
  year: number;
  stateCode: string;
  title: string;
  justification: string;
  beneficiaries: string;
  months: number;
  school: NeedsFileSite;
  classrooms: { action: "NEW_CONSTRUCTION" | "RENOVATION"; existing: number; condition: ExistingCondition; count: number };
  water: "BOREHOLE" | "WORKING" | "NONE";
  desks?: number;
  /** Rate factor per item code (a desk rate 30 % above the standard …). */
  factors?: Record<string, number>;
  assumptions?: string | null;
}): NeedsFileSpec {
  const s = p.stateCode;
  const f = (code: string) => p.factors?.[code] ?? 1;
  const cls = p.classrooms.action === "NEW_CONSTRUCTION" ? "CLS-NEW" : "CLS-REN";
  const rows: NeedsFileRow[] = [
    row("U01", 1, "CLASSROOM", p.classrooms.action, p.classrooms.existing, p.classrooms.condition, p.classrooms.count, p.classrooms.count, "HIGH", "Classes are taught in unsafe or overcrowded rooms."),
    row("U02", 1, "TOILET", "NEW_CONSTRUCTION", 0, "ABSENT", 1, 1, "ESSENTIAL", "No usable toilet on site."),
    row("U03", 1, "SOLAR_POWER", "NEW_CONSTRUCTION", 0, "ABSENT", 1, 1, "ESSENTIAL", "The school is off grid."),
  ];
  const lines: NeedsFileLine[] = [line("1.01", "U01", cls, p.classrooms.count, s, f(cls)), line("2.01", "U02", "TLT-NEW", 1, s, f("TLT-NEW")), line("3.01", "U03", "SOL-5KVA", 1, s, f("SOL-5KVA"))];
  if (p.water === "BOREHOLE") {
    rows.push(row("U04", 1, "BOREHOLE", "NEW_CONSTRUCTION", 0, "ABSENT", 1, 1, "ESSENTIAL", "No safe water within 1 km of the school."));
    lines.push(line("4.01", "U04", "BHL-SOLAR", 1, s, f("BHL-SOLAR")));
  } else if (p.water === "WORKING") {
    rows.push(working("U04", 1, "BOREHOLE"));
  }
  if (p.desks) {
    rows.push(row("U05", 1, "PUPILS_FURNITURE", "FURNISHING", 0, "ABSENT", p.desks, p.desks, "MEDIUM", "Pupils sit on the floor."));
    lines.push(line("5.01", "U05", "FUR-PUP-2", p.desks, s, f("FUR-PUP-2")));
  }
  return {
    name: p.name,
    programme: "DI",
    valid: true,
    project: { title: p.title, interventionYear: p.year, stateCode: s, justification: p.justification, assumptions: p.assumptions ?? null, beneficiaries: p.beneficiaries, estimatedDurationMonths: p.months },
    sites: [p.school],
    rows,
    lines,
    supervisionMonitoringPct: 5,
    contingencyPct: 5,
  };
}

/** The Quantity Surveyor's costed version: every coded line at the standard rate unless `keep` names a factor. */
export function costedVersion(spec: NeedsFileSpec, keep: Record<string, number> = {}): NeedsFileSpec {
  return {
    ...spec,
    project: { ...spec.project, assumptions: `${spec.project.assumptions ? `${spec.project.assumptions} ` : ""}Costed by UBEC Physical Planning against costing standard v1.` },
    lines: spec.lines.map((l) => (l.itemCode ? { ...l, rate: Math.round(stdRate(l.itemCode, spec.project.stateCode) * (keep[l.itemCode] ?? 1)) } : l)),
  };
}

// ---------------------------------------------------------------------------
// Direct Intervention, the open cycle (12 annual proposals)
// ---------------------------------------------------------------------------

/** The demo project as a needs assessment (Kano, three schools, the demo's units and BoQ). */
function dawakinTofa(year: number): NeedsFileSpec {
  const lgaCode = (name: string) => (name === "Tofa" ? "KN-TOFA" : "KN-DAWAKIN-TOFA");
  const unit = (code: string) => DEMO_UNITS.find((u) => u.code === code)!;
  return {
    name: "di-dawakin-tofa",
    programme: "DI",
    valid: true,
    project: {
      title: DEMO_PROJECT.name,
      interventionYear: year,
      stateCode: "KN",
      justification: DEMO_PROJECT.strategicJustification,
      assumptions: DEMO_PROJECT.assumptions,
      beneficiaries: "About 900 pupils at Dawakin Tofa, 420 at Kwa and 610 at Tofa JSS",
      estimatedDurationMonths: 4,
    },
    sites: DEMO_SITES.map((s) => ({
      siteNumber: s.siteNumber,
      schoolName: s.schoolName,
      schoolLevel: s.schoolLevel as SchoolLevel,
      lgaCode: lgaCode(s.lga),
      address: s.address,
      latitude: s.latitude,
      longitude: s.longitude,
      enrolment: s.siteNumber === 1 ? 900 : s.siteNumber === 2 ? 420 : 610,
    })),
    rows: [
      row("T1", 1, "TOILET", "NEW_CONSTRUCTION", 0, "ABSENT", 2, 2, "ESSENTIAL", `${unit("T1").label}: the school has no working toilet for about 900 pupils.`, { unit: "nr", evidence: "Head teacher's letter; site photos" }),
      working("X12", 1, "SOLAR_POWER"),
      row("BH1", 2, "BOREHOLE", "NEW_CONSTRUCTION", 0, "ABSENT", 1, 1, "ESSENTIAL", `${unit("BH1").label}: pupils fetch water from a hand pump 600 m away.`),
      working("X21", 2, "TOILET"),
      working("X22", 2, "SOLAR_POWER"),
      row("SP1", 3, "SOLAR_POWER", "NEW_CONSTRUCTION", 0, "ABSENT", 1, 1, "ESSENTIAL", `${unit("SP1").label}: the hand pump cannot serve 610 pupils.`),
      working("X31", 3, "TOILET", 2),
      working("X32", 3, "BOREHOLE"),
    ],
    lines: DEMO_LINES.map((l) => ({ wbsCode: l.wbsCode, unitId: l.unitCode, itemCode: null, description: l.description, unit: l.unit, quantity: l.totalQuantity, rate: l.rateNgn })),
    supervisionMonitoringPct: 5,
    contingencyPct: 5,
  };
}

export interface SeedDiProposal {
  /** Sequence in the cycle: the reference is `<Y>-DI-<nnn>`. */
  n: number;
  spec: NeedsFileSpec;
  /** Where the seed leaves it. */
  story: string;
}

/** The 2027-style Direct Intervention proposals, in upload order (references 001 … 012). */
export function diSeedProposals(year: number): SeedDiProposal[] {
  const kebbiSchool = site(1, "Model Primary School Argungu", "KE-ARGUNGU", 12.7448, 4.5251, { enrolment: 560 });
  return [
    { n: 1, spec: dawakinTofa(year), story: "Ranked 1st, approved: at Funding, waiting for the appropriation (the demo project)" },
    {
      n: 2,
      spec: schoolSpec({
        name: "di-jos-north",
        year,
        stateCode: "PL",
        title: "Classroom block and WASH, LGEA Primary School Tudun Wada, Jos North",
        justification: "Six classes share three rooms; no toilet or water on site.",
        beneficiaries: "740 pupils",
        months: 8,
        school: site(1, "LGEA Primary School Tudun Wada, Jos", "PL-JOS-NORTH", 9.8965, 8.8583, { enrolment: 740 }),
        classrooms: { action: "NEW_CONSTRUCTION", existing: 3, condition: "PARTLY_FUNCTIONAL", count: 2 },
        water: "BOREHOLE",
        desks: 60,
        factors: { "FUR-PUP-2": 1.3 },
      }),
      story: "Ranked 2nd, approved: at Funding; its desk rate (30 % above the standard) was acknowledged at costing",
    },
    {
      n: 3,
      spec: schoolSpec({
        name: "di-ilorin-west",
        year,
        stateCode: "KW",
        title: "Renovation of classrooms and WASH, Baboko Community Primary School, Ilorin West",
        justification: "Roofs leak in five of six classrooms; the toilet block collapsed in 2026.",
        beneficiaries: "520 pupils",
        months: 6,
        school: site(1, "Baboko Community Primary School, Ilorin", "KW-ILORIN-WEST", 8.4966, 4.5421, { enrolment: 520 }),
        classrooms: { action: "RENOVATION", existing: 6, condition: "DILAPIDATED", count: 5 },
        water: "WORKING",
      }),
      story: "Ranked 3rd (one sub-criterion divergent by 2 points), approved: at Funding",
    },
    {
      n: 4,
      spec: schoolSpec({
        name: "di-bauchi",
        year,
        stateCode: "BA",
        title: "Classroom block and WASH, Central Primary School Dass",
        justification: "Two classes are taught under trees; no sanitation.",
        beneficiaries: "610 pupils",
        months: 8,
        school: site(1, "Central Primary School Dass", "BA-DASS", 9.9937, 9.5156, { enrolment: 610 }),
        classrooms: { action: "NEW_CONSTRUCTION", existing: 2, condition: "NON_FUNCTIONAL", count: 2 },
        water: "BOREHOLE",
      }),
      story: "Ranked 4th, above the line, excluded by the Executive Secretary at approval: not funded, carried forward",
    },
    {
      n: 5,
      spec: schoolSpec({
        name: "di-ekiti",
        year,
        stateCode: "EK",
        title: "Classroom renovation and solar, St Paul's Primary School Efon",
        justification: "Four classrooms need new roofs; the school is off grid.",
        beneficiaries: "380 pupils",
        months: 5,
        school: site(1, "St Paul's Primary School, Efon-Alaaye", "EK-EFON", 7.6556, 4.9238, { enrolment: 380 }),
        classrooms: { action: "RENOVATION", existing: 4, condition: "DILAPIDATED", count: 4 },
        water: "WORKING",
      }),
      story: "Ranked 5th, below the funding line: not funded, carried forward",
    },
    {
      n: 6,
      spec: schoolSpec({
        name: "di-argungu",
        year,
        stateCode: "KE",
        title: "Classrooms, toilets and solar, Model Primary School Argungu",
        justification: "Overcrowded classrooms and no sanitation; the community has a hand pump.",
        beneficiaries: "560 pupils",
        months: 7,
        school: kebbiSchool,
        classrooms: { action: "NEW_CONSTRUCTION", existing: 4, condition: "PARTLY_FUNCTIONAL", count: 2 },
        water: "NONE",
      }),
      story: "At Validation: essential-facility gap (no water row) waiting for the M&E officer's justification",
    },
    {
      n: 7,
      spec: {
        name: "di-argungu-library",
        programme: "DI",
        valid: true,
        project: {
          title: "Library and borehole, Argungu Model Primary School",
          interventionYear: year,
          stateCode: "KE",
          justification: "The school has no library and no safe water.",
          assumptions: null,
          beneficiaries: "560 pupils",
          estimatedDurationMonths: 6,
        },
        // Same school as <Y>-DI-006 (other word order and case, same LGA, a few metres away).
        sites: [site(1, "ARGUNGU  model primary school", "KE-ARGUNGU", 12.74485, 4.52515, { enrolment: 560 })],
        rows: [
          row("L01", 1, "LIBRARY", "NEW_CONSTRUCTION", 0, "ABSENT", 1, 1, "HIGH", "No library at the school."),
          row("L02", 1, "BOREHOLE", "NEW_CONSTRUCTION", 0, "ABSENT", 1, 1, "ESSENTIAL", "No safe water on site."),
          working("L03", 1, "TOILET"),
          working("L04", 1, "SOLAR_POWER"),
        ],
        lines: [line("1.01", "L01", "LIB-NEW", 1, "KE"), line("2.01", "L02", "BHL-SOLAR", 1, "KE")],
        supervisionMonitoringPct: 5,
        contingencyPct: 5,
      },
      story: "At Validation: possible duplicate of <Y>-DI-006 (same school) for the M&E officer to resolve",
    },
    {
      n: 8,
      spec: schoolSpec({
        name: "di-imo",
        year,
        stateCode: "IM",
        title: "Classroom renovation and WASH, Community Primary School Ikeduru",
        justification: "Classrooms damaged by erosion; the toilet block is unusable.",
        beneficiaries: "430 pupils",
        months: 6,
        school: site(1, "Community Primary School Atta, Ikeduru", "IM-IKEDURU", 5.5764, 7.1235, { enrolment: 430 }),
        classrooms: { action: "RENOVATION", existing: 6, condition: "DILAPIDATED", count: 6 },
        water: "BOREHOLE",
      }),
      story: "Returned by the M&E officer at Validation (enrolment not evidenced): waiting for Procurement's correction",
    },
    {
      n: 9,
      spec: schoolSpec({
        name: "di-cross-river",
        year,
        stateCode: "CR",
        title: "Classroom block and WASH, Government Primary School Akamkpa",
        justification: "Classes are taught in a church hall 2 km from the school.",
        beneficiaries: "350 pupils",
        months: 8,
        school: site(1, "Government Primary School Akamkpa", "CR-AKAMKPA", 5.3125, 8.3527, { enrolment: 350 }),
        classrooms: { action: "NEW_CONSTRUCTION", existing: 0, condition: "ABSENT", count: 2 },
        water: "BOREHOLE",
      }),
      story: "Validated: at needs assessment completion (Design), waiting for the drawings",
    },
    {
      n: 10,
      spec: schoolSpec({
        name: "di-adamawa",
        year,
        stateCode: "AD",
        title: "Classrooms and furniture, LGEA Primary School Girei",
        justification: "Two condemned classrooms; pupils sit on the floor.",
        beneficiaries: "480 pupils",
        months: 7,
        school: site(1, "LGEA Primary School Girei", "AD-GIREI", 9.3627, 12.5487, { enrolment: 480 }),
        classrooms: { action: "NEW_CONSTRUCTION", existing: 2, condition: "NON_FUNCTIONAL", count: 2 },
        water: "WORKING",
        desks: 80,
      }),
      story: "At Costing: the costed version prices desks 30 % above the standard (rate variance open)",
    },
    {
      n: 11,
      spec: schoolSpec({
        name: "di-zamfara",
        year,
        stateCode: "ZA",
        title: "Classroom block and WASH, Model Primary School Gusau",
        justification: "Classrooms burnt in 2026; classes held in tents.",
        beneficiaries: "690 pupils",
        months: 8,
        school: site(1, "Model Primary School Gusau", "ZA-GUSAU", 12.1628, 6.6614, { enrolment: 690 }),
        classrooms: { action: "NEW_CONSTRUCTION", existing: 3, condition: "NON_FUNCTIONAL", count: 3 },
        water: "BOREHOLE",
      }),
      story: "Uploaded, not yet submitted (Identification, draft)",
    },
    {
      n: 12,
      spec: schoolSpec({
        name: "di-nasarawa",
        year,
        stateCode: "NA",
        title: "Classroom renovation, LGEA Primary School Keffi",
        justification: "Classrooms need repairs after the 2026 rains.",
        beneficiaries: "300 pupils",
        months: 4,
        school: site(1, "LGEA Primary School Keffi", "NA-KEFFI", 8.8466, 7.8736, { enrolment: 300 }),
        classrooms: { action: "RENOVATION", existing: 4, condition: "PARTLY_FUNCTIONAL", count: 4 },
        water: "WORKING",
      }),
      story: "Not validated: the State renovated the school in 2026 (site verification)",
    },
  ];
}

/** Reference of the n-th proposal of a Direct Intervention cycle. */
export const diReference = (year: number, n: number) => `${year}-DI-${String(n).padStart(3, "0")}`;

/** The proposals the normal seed leaves at Funding (approved, waiting for the appropriation). */
export const DI_FUNDING_SEQUENCES = [1, 2, 3] as const;

/** The costed version of each proposal that reaches Costing: desks on 002 and 010 stay 30 % above the standard. */
export function diCostedSpec(p: SeedDiProposal): NeedsFileSpec {
  if (p.n === 2 || p.n === 10) return costedVersion(p.spec, { "FUR-PUP-2": 1.3 });
  return costedVersion(p.spec);
}

// ---------------------------------------------------------------------------
// Matching Grants, Kano (open cycle)
// ---------------------------------------------------------------------------

export const mgReference = (year: number, n: number) => `${year}-MG-KN-${String(n).padStart(3, "0")}`;

function kanoSpec(year: number, n: number, p: { title: string; school: NeedsFileSite; classrooms: number; justification: string; beneficiaries: string }): NeedsFileSpec {
  const s = "KN";
  return {
    name: `mg-kano-${n}`,
    programme: "MG",
    valid: true,
    project: { title: p.title, interventionYear: year, stateCode: s, justification: p.justification, assumptions: `State counterpart funds are in the Kano ${year} budget.`, beneficiaries: p.beneficiaries, estimatedDurationMonths: 7 },
    sites: [p.school],
    rows: [
      row("U01", 1, "CLASSROOM", "NEW_CONSTRUCTION", 3, "NON_FUNCTIONAL", p.classrooms, p.classrooms, "HIGH", "Classrooms condemned by the State engineer."),
      row("U02", 1, "TOILET", "NEW_CONSTRUCTION", 0, "ABSENT", 1, 1, "ESSENTIAL", "No usable toilet on site."),
      row("U03", 1, "BOREHOLE", "NEW_CONSTRUCTION", 0, "ABSENT", 1, 1, "ESSENTIAL", "No safe water within 1 km."),
      working("U04", 1, "SOLAR_POWER"),
    ],
    lines: [line("1.01", "U01", "CLS-NEW", p.classrooms, s), line("2.01", "U02", "TLT-NEW", 1, s), line("3.01", "U03", "BHL-SOLAR", 1, s)],
    supervisionMonitoringPct: 5,
    contingencyPct: 5,
  };
}

export interface SeedMgProposal {
  n: number;
  spec: NeedsFileSpec;
  story: string;
}

export function mgSeedProposals(year: number): SeedMgProposal[] {
  return [
    {
      n: 1,
      spec: kanoSpec(year, 1, {
        title: "Classrooms and WASH, Rano Central Primary School",
        school: site(1, "Rano Central Primary School", "KN-RANO", 11.5583, 8.5832, { enrolment: 780 }),
        classrooms: 3,
        justification: "Three condemned classrooms and no sanitation at a school on the State priority list.",
        beneficiaries: "780 pupils",
      }),
      story: "On the Kano BEAP, in UBEC Physical Planning review",
    },
    {
      n: 2,
      spec: kanoSpec(year, 2, {
        title: "Classrooms and WASH, Wudil Model Junior Secondary School",
        school: site(1, "Wudil Model Junior Secondary School", "KN-WUDIL", 11.8098, 8.8392, { schoolLevel: "JSS", enrolment: 920 }),
        classrooms: 2,
        justification: "Two classrooms collapsed in the 2026 rains; no toilets.",
        beneficiaries: "920 students",
      }),
      story: "On the Kano BEAP, in UBEC Physical Planning review",
    },
    {
      n: 3,
      spec: kanoSpec(year, 3, {
        title: "Classrooms and WASH, Gaya Township Primary School",
        school: site(1, "Gaya Township Primary School", "KN-GAYA", 11.8619, 9.0039, { enrolment: 640 }),
        classrooms: 2,
        justification: "Late submission: classes in a dilapidated block; no water or toilets.",
        beneficiaries: "640 pupils",
      }),
      story: "Submitted late: at Field verification, waiting for the SUBEB's site visit",
    },
  ];
}

// ---------------------------------------------------------------------------
// Demo pack: files uploaded live into the open Direct Intervention cycle
// ---------------------------------------------------------------------------

/** One file uploaded on its own: two schools in Gombe. */
export function demoPackSingleSpec(year: number): NeedsFileSpec {
  const s = "GO";
  return {
    name: "demo-gombe",
    programme: "DI",
    valid: true,
    project: {
      title: "Classrooms and WASH, Kumo and Akko schools",
      interventionYear: year,
      stateCode: s,
      justification: "Two primary schools in Akko LGA with condemned classrooms, no toilets and no safe water.",
      assumptions: "Sites are free of encumbrance; the communities provide access.",
      beneficiaries: "1,120 pupils",
      estimatedDurationMonths: 8,
    },
    sites: [
      site(1, "Kumo Central Primary School", "GO-AKKO", 10.0479, 11.2155, { address: "Kumo town, Akko LGA", enrolment: 680 }),
      site(2, "LGEA Primary School Tumu", "GO-AKKO", 10.1123, 11.0851, { enrolment: 440 }),
    ],
    rows: [
      row("U01", 1, "CLASSROOM", "NEW_CONSTRUCTION", 4, "NON_FUNCTIONAL", 2, 2, "HIGH", "Two classrooms condemned by the State engineer."),
      row("U02", 1, "TOILET", "NEW_CONSTRUCTION", 0, "ABSENT", 1, 1, "ESSENTIAL", "No toilet for 680 pupils."),
      row("U03", 1, "BOREHOLE", "NEW_CONSTRUCTION", 0, "ABSENT", 1, 1, "ESSENTIAL", "Pupils fetch water from a stream."),
      working("U04", 1, "SOLAR_POWER"),
      row("U05", 2, "CLASSROOM", "RENOVATION", 4, "DILAPIDATED", 4, 4, "HIGH", "Roofs leak in all four classrooms."),
      row("U06", 2, "TOILET", "RENOVATION", 1, "PARTLY_FUNCTIONAL", 1, 1, "ESSENTIAL", "Fittings broken; the pit is full."),
      row("U07", 2, "SOLAR_POWER", "NEW_CONSTRUCTION", 0, "ABSENT", 1, 1, "ESSENTIAL", "The school is off grid."),
      working("U08", 2, "OVERHEAD_TANK"),
    ],
    lines: [
      line("1.01", "U01", "CLS-NEW", 2, s),
      line("2.01", "U02", "TLT-NEW", 1, s),
      line("3.01", "U03", "BHL-SOLAR", 1, s),
      line("5.01", "U05", "CLS-REN", 4, s),
      line("6.01", "U06", "TLT-REN", 1, s),
      line("7.01", "U07", "SOL-5KVA", 1, s),
    ],
    supervisionMonitoringPct: 5,
    contingencyPct: 5,
  };
}

/** A batch of five (one school each); `valid: false` on the fourth (row errors). */
export function demoPackBatchSpecs(year: number): NeedsFileSpec[] {
  const wash = (k: number, stateCode: string, school: NeedsFileSite, withBoq: boolean): NeedsFileSpec => ({
    name: `demo-batch-${k}`,
    programme: "DI",
    valid: true,
    project: {
      title: `WASH and solar, ${school.schoolName}`,
      interventionYear: year,
      stateCode,
      justification: "No sanitation, no safe water and no power at the school.",
      assumptions: null,
      beneficiaries: school.enrolment ? `${school.enrolment} pupils` : null,
      estimatedDurationMonths: 4,
    },
    sites: [school],
    rows: [
      row("B01", 1, "TOILET", "NEW_CONSTRUCTION", 0, "ABSENT", 1, 1, "ESSENTIAL", "No toilet on site.", withBoq ? {} : { preliminaryCostNgn: 6_800_000 }),
      row("B02", 1, "BOREHOLE", "NEW_CONSTRUCTION", 0, "ABSENT", 1, 1, "ESSENTIAL", "No safe water within 1 km.", withBoq ? {} : { preliminaryCostNgn: 7_500_000 }),
      row("B03", 1, "SOLAR_POWER", "NEW_CONSTRUCTION", 0, "ABSENT", 1, 1, "ESSENTIAL", "The school is off grid.", withBoq ? {} : { preliminaryCostNgn: 6_200_000 }),
    ],
    lines: withBoq ? [line("1.01", "B01", "TLT-NEW", 1, stateCode), line("2.01", "B02", "BHL-SOLAR", 1, stateCode), line("3.01", "B03", "SOL-5KVA", 1, stateCode)] : [],
    supervisionMonitoringPct: 5,
    contingencyPct: 5,
  });
  const fourth = wash(4, "ON", site(1, "St Peter's Primary School, Ikare", "ON-AKOKO-NORTH-EAST", 7.5304, 5.7596), false);
  return [
    wash(1, "TA", site(1, "Central Primary School Jalingo", "TA-JALINGO", 8.8937, 11.3596, { enrolment: 510 }), false),
    wash(2, "JI", site(1, "Model Primary School Dutse", "JI-DUTSE", 11.7562, 9.3389, { enrolment: 470 }), true),
    wash(3, "OS", site(1, "Baptist Primary School, Ede", "OS-EDE-NORTH", 7.7397, 4.4359, { enrolment: 390 }), true),
    {
      ...fourth,
      valid: false,
      rows: [
        // Not an intervention action; no proposed quantity; a facility the catalogue does not have.
        { ...fourth.rows[0], action: "Build it" },
        { ...fourth.rows[1], proposedQuantity: null },
        { ...fourth.rows[2], facility: "Swimming pool" },
      ],
    },
    wash(5, "ED", site(1, "Oredo Model Primary School, Benin", "ED-OREDO", 6.3176, 5.6145, { enrolment: 620 }), true),
  ];
}
