/**
 * Writes the UBEC demo pack to `saas_updates/demo_pack/` (run `npm run demo:pack` from `server/`):
 * the filled needs-assessment workbook for the demo project, with dates relative to today, and the
 * specimen PDFs the presenter uploads live. Re-running overwrites the folder's generated files.
 * Needs no database: the workbook uses the UBEC workspace's default lists. The workbook is parsed
 * back with the real parser and the script fails if it has any error. Client demo updates (wave 2):
 * the workbook carries the State, the lot title and a Sites sheet (three schools in two LGAs), so it
 * also serves New project → Upload needs assessment.
 */
import fs from "fs";
import path from "path";
import { validateRegisterRow, zonedCalendarDate } from "@insite/shared";
import { buildScopeWorkbook, parseScopeWorkbook } from "../modules/scope/workbook/scopeWorkbook";
import { renderDemoDocument } from "../db/demoDocuments";
import { DEMO_LINES, DEMO_PROJECT, DEMO_REGISTER_FILE, DEMO_SITES, DEMO_UNITS, DEMO_WORKBOOK_FILE, demoDates, demoDocumentContext, demoFacilities, demoPackDocuments, demoRegisterRows, demoRegisterWorkbookData, demoWorkbookData } from "./demoProject";
import { buildRegisterWorkbook } from "../modules/projectRegister/registerWorkbook";
import { buildApprovedListWorkbook, parseApprovedListWorkbook, type ApprovedListHeaderInput, type ApprovedListRowInput } from "../modules/approvedLists/approvedListWorkbook";

const OUT = path.resolve(__dirname, "../../../saas_updates/demo_pack");

/**
 * Client demo updates E3 (wave 4): a filled approved list to upload on the Needs assessment page. The
 * 2027 Approved Projects & Implementation Schedule: the seeded lists are 2025 and 2026, so it is a new
 * list on both the normal seed and the demo overlay. Project ID is left blank (no project code is the
 * same on both databases); on the overlay, typing 2027-LOT-1-BATCH-1 on row 1 links draft #11.
 */
const APPROVED_LIST_FILE = "15 Approved list upload.xlsx";
const APPROVED_LIST_HEADER: ApprovedListHeaderInput = {
  interventionYear: 2027,
  kind: "DI_SCHEDULE",
  approvedBy: "Executive Secretary, UBEC",
  approvedOn: "2026-10-14",
};
const RENOVATION = "Renovation, Equipment and Furnishings of Public Schools";
const CLASSROOMS = "Construction of a Block of Two (2) Classrooms with Office & Store and Supply of Furniture";
const APPROVED_LIST_ROWS: ApprovedListRowInput[] = [
  { rowRef: "DI/2027/FC/001", projectTitle: "Renovation, Equipment and Furnishings of LEA Primary School, Bwari", schools: "LEA Primary School, Bwari", state: "Federal Capital Territory", lgas: "Bwari", facilityScope: "Renovation of 6 classrooms, 1 toilet block, 120 pupils' desks", costEstimate: 38_500_000, lotTitle: RENOVATION },
  { rowRef: "DI/2027/KN/002", projectTitle: `${CLASSROOMS} at LGEA Primary School, Gwarzo`, schools: "LGEA Primary School, Gwarzo", state: "Kano", lgas: "Gwarzo", facilityScope: "2 classrooms, office & store, 60 pupils' desks", costEstimate: 46_200_000, lotTitle: CLASSROOMS },
  { rowRef: "DI/2027/KN/003", projectTitle: "Provision of a Motorized Borehole and VIP Toilets at LGEA Primary School, Bichi", schools: "LGEA Primary School, Bichi", state: "Kano", lgas: "Bichi", facilityScope: "1 motorised borehole, 1 VIP toilet block (8 cubicles)", costEstimate: 24_800_000, lotTitle: "Provision of Water, Sanitation and Hygiene (WASH) Facilities in Public Schools" },
  { rowRef: "DI/2027/LA/004", projectTitle: "Renovation, Equipment and Furnishings of Junior Grammar School, Ikorodu", schools: "Junior Grammar School, Ikorodu", state: "Lagos", lgas: "Ikorodu", facilityScope: "Renovation of 8 classrooms, science laboratory equipment", costEstimate: 41_000_000, lotTitle: RENOVATION },
  { rowRef: "DI/2027/BO/005", projectTitle: "Construction and Equipping of an ECCDE Centre at Central Primary School, Konduga", schools: "Central Primary School, Konduga", state: "Borno", lgas: "Konduga", facilityScope: "1 ECCDE block (2 playrooms), play equipment, 1 toilet block", costEstimate: 52_300_000, lotTitle: "Construction and Equipping of Early Childhood Care Development and Education (ECCDE) Centres" },
  { rowRef: "DI/2027/SO/006", projectTitle: `${CLASSROOMS} at Model Primary School, Wamako`, schools: "Model Primary School, Wamako\nWamako Nomadic Primary School", state: "Sokoto", lgas: "Wamako", facilityScope: "2 classrooms, office & store, 60 pupils' desks (two schools)", costEstimate: 45_750_000, lotTitle: CLASSROOMS },
];

async function main() {
  const today = process.argv[2] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2]) ? process.argv[2] : zonedCalendarDate(new Date(), "Africa/Lagos");
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) {
    if (f.endsWith(".pdf") || f.endsWith(".xlsx")) fs.rmSync(path.join(OUT, f));
  }

  // 1. The needs-assessment workbook, built and then read back by the real code.
  const workbook = await buildScopeWorkbook(demoWorkbookData(today));
  const parsed = await parseScopeWorkbook(workbook, { facilities: demoFacilities() });
  if (parsed.issues.length) {
    throw new Error(`The demo workbook does not import cleanly:\n${parsed.issues.map((i) => `${i.sheet} row ${i.row}: ${i.message}`).join("\n")}`);
  }
  if (parsed.units.length !== DEMO_UNITS.length || parsed.lines.length !== DEMO_LINES.length || parsed.sprints.length !== 2 || parsed.sites.length !== DEMO_SITES.length || parsed.units.some((u) => u.siteNumber === null)) {
    throw new Error(`The demo workbook read back ${parsed.units.length} units, ${parsed.lines.length} lines, ${parsed.sprints.length} work phases, ${parsed.sites.length} sites`);
  }
  fs.writeFileSync(path.join(OUT, DEMO_WORKBOOK_FILE), workbook);
  const total = parsed.lines.reduce((s, l) => s + l.amountNgn, 0);

  // 2. The documents uploaded during the demo.
  const docs = demoPackDocuments(today);
  for (const d of docs) {
    fs.writeFileSync(path.join(OUT, d.file), await renderDemoDocument(d.code, demoDocumentContext(today, d.date)));
  }

  // 3. UBEC IRL: the project register import (rows checked by the shared row rules; the route test
  // routes.irl.register.test.ts imports the same file on a freshly seeded database).
  const registerRows = demoRegisterRows(today);
  const rowErrors = registerRows.flatMap((r, i) => validateRegisterRow(r).issues.map((x) => `row ${i + 1} ${x.column}: ${x.message}`));
  if (rowErrors.length) throw new Error(`The demo register rows are invalid:\n${rowErrors.join("\n")}`);
  fs.writeFileSync(path.join(OUT, DEMO_REGISTER_FILE), await buildRegisterWorkbook(demoRegisterWorkbookData(today)));

  // 4. Client demo updates E3 (wave 4): the approved list upload, read back with the real parser.
  const approvedList = await buildApprovedListWorkbook({ generatedAt: new Date(), brandName: "UBEC", header: APPROVED_LIST_HEADER, rows: APPROVED_LIST_ROWS });
  const listParsed = await parseApprovedListWorkbook(approvedList);
  const listIssues = [...listParsed.issues, ...listParsed.rows.flatMap((r) => r.issues)];
  if (listIssues.length || listParsed.rows.length !== APPROVED_LIST_ROWS.length) {
    throw new Error(`The demo approved list does not read back cleanly:\n${listIssues.map((i) => `${i.sheet}: ${i.message}`).join("\n")}`);
  }
  fs.writeFileSync(path.join(OUT, APPROVED_LIST_FILE), approvedList);
  const listTotal = listParsed.rows.reduce((s, r) => s + (r.costEstimateNgn ?? 0), 0);

  const dates = demoDates(today);
  console.log(`Demo pack for ${today} written to ${OUT}`);
  console.log(`  ${DEMO_WORKBOOK_FILE}: ${parsed.units.length} units, ${parsed.lines.length} lines (NGN ${total.toLocaleString("en-NG")}), work phase 1 ${dates.sprints[0].startDate}..${dates.sprints[0].endDate}, work phase 2 ${dates.sprints[1].startDate}..${dates.sprints[1].endDate}; ${parsed.sites.length} sites in ${new Set(parsed.sites.map((x) => x.lgaCode)).size} LGAs of ${DEMO_PROJECT.state}; lot "${DEMO_PROJECT.lotTitle}"; ${parsed.warnings.length} warning(s)`);
  for (const d of docs) console.log(`  ${d.file}`);
  const live = registerRows.filter((r) => r.status !== "Not started").length;
  console.log(`  ${DEMO_REGISTER_FILE}: ${registerRows.length} projects (${registerRows.length - live} not started, ${live} ongoing or completed)`);
  console.log(`  ${APPROVED_LIST_FILE}: ${listParsed.header.title}, ${listParsed.rows.length} rows (NGN ${listTotal.toLocaleString("en-NG")})`);
  console.log(`  Project code to type when creating the draft: ${DEMO_PROJECT.code}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
