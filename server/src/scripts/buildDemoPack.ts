/**
 * Writes the UBEC demo pack to `saas_updates/demo_pack/` (run `npm run demo:pack` from `server/`):
 * the specimen PDFs the presenter uploads live (dates relative to today), the register import and the
 * approved list upload. Re-running overwrites the folder's generated files.
 * Needs no database. Generated workbooks are read back with the real parsers and the script fails on
 * any error. Needs pipeline wave 4 (M5): the D1 needs assessment workbook is no longer part of the
 * pack (the flow is gone). Wave 5 (N9, M4) adds the pipeline's files (`demoNeeds.ts`): the appropriated
 * schedule of the open Direct Intervention cycle (funds the seeded Y-DI-001 … 003), a needs assessment to
 * upload on its own and a batch of five with one invalid file (the invalid one must read back with row
 * errors, every other file without any).
 */
import fs from "fs";
import path from "path";
import { validateRegisterRow, zonedCalendarDate } from "@insite/shared";
import { renderDemoDocument } from "../db/demoDocuments";
import { DEMO_PROJECT, DEMO_REGISTER_FILE, demoDocumentContext, demoPackDocuments, demoRegisterRows, demoRegisterWorkbookData } from "./demoProject";
import { buildRegisterWorkbook } from "../modules/projectRegister/registerWorkbook";
import { buildApprovedListWorkbook, parseApprovedListWorkbook, type ApprovedListHeaderInput, type ApprovedListRowInput } from "../modules/approvedLists/approvedListWorkbook";
import { buildDemoAppropriatedSchedule, buildDemoNeedsUploads, DEMO_APPROPRIATION_FILE } from "./demoNeeds";

const OUT = path.resolve(__dirname, "../../../saas_updates/demo_pack");

/**
 * Client demo updates E3 (wave 4): a filled approved list to upload on the Needs assessment page.
 * Needs pipeline wave 5 (D-N.12): the funding gate now writes the open year's list (the appropriation
 * imports the Direct Intervention schedule, and an upload cannot replace it), so the manual upload is
 * for past years: the 2024 Approved Projects & Implementation Schedule (the seeded lists are 2025 and
 * 2026, so it is a new list on both databases). Project ID is left blank.
 */
const APPROVED_LIST_FILE = "15 Approved list upload.xlsx";
const APPROVED_LIST_HEADER: ApprovedListHeaderInput = {
  interventionYear: 2024,
  kind: "DI_SCHEDULE",
  approvedBy: "Executive Secretary, UBEC",
  approvedOn: "2023-10-16",
};
const RENOVATION = "Renovation, Equipment and Furnishings of Public Schools";
const CLASSROOMS = "Construction of a Block of Two (2) Classrooms with Office & Store and Supply of Furniture";
const APPROVED_LIST_ROWS: ApprovedListRowInput[] = [
  { rowRef: "DI/2024/FC/001", projectTitle: "Renovation, Equipment and Furnishings of LEA Primary School, Bwari", schools: "LEA Primary School, Bwari", state: "Federal Capital Territory", lgas: "Bwari", facilityScope: "Renovation of 6 classrooms, 1 toilet block, 120 pupils' desks", costEstimate: 38_500_000, lotTitle: RENOVATION },
  { rowRef: "DI/2024/KN/002", projectTitle: `${CLASSROOMS} at LGEA Primary School, Gwarzo`, schools: "LGEA Primary School, Gwarzo", state: "Kano", lgas: "Gwarzo", facilityScope: "2 classrooms, office & store, 60 pupils' desks", costEstimate: 46_200_000, lotTitle: CLASSROOMS },
  { rowRef: "DI/2024/KN/003", projectTitle: "Provision of a Motorized Borehole and VIP Toilets at LGEA Primary School, Bichi", schools: "LGEA Primary School, Bichi", state: "Kano", lgas: "Bichi", facilityScope: "1 motorised borehole, 1 VIP toilet block (8 cubicles)", costEstimate: 24_800_000, lotTitle: "Provision of Water, Sanitation and Hygiene (WASH) Facilities in Public Schools" },
  { rowRef: "DI/2024/LA/004", projectTitle: "Renovation, Equipment and Furnishings of Junior Grammar School, Ikorodu", schools: "Junior Grammar School, Ikorodu", state: "Lagos", lgas: "Ikorodu", facilityScope: "Renovation of 8 classrooms, science laboratory equipment", costEstimate: 41_000_000, lotTitle: RENOVATION },
  { rowRef: "DI/2024/BO/005", projectTitle: "Construction and Equipping of an ECCDE Centre at Central Primary School, Konduga", schools: "Central Primary School, Konduga", state: "Borno", lgas: "Konduga", facilityScope: "1 ECCDE block (2 playrooms), play equipment, 1 toilet block", costEstimate: 52_300_000, lotTitle: "Construction and Equipping of Early Childhood Care Development and Education (ECCDE) Centres" },
  { rowRef: "DI/2024/SO/006", projectTitle: `${CLASSROOMS} at Model Primary School, Wamako`, schools: "Model Primary School, Wamako\nWamako Nomadic Primary School", state: "Sokoto", lgas: "Wamako", facilityScope: "2 classrooms, office & store, 60 pupils' desks (two schools)", costEstimate: 45_750_000, lotTitle: CLASSROOMS },
];

async function main() {
  const today = process.argv[2] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2]) ? process.argv[2] : zonedCalendarDate(new Date(), "Africa/Lagos");
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) {
    if (f.endsWith(".pdf") || f.endsWith(".xlsx")) fs.rmSync(path.join(OUT, f));
  }

  // 1. Needs pipeline wave 4 (M5): the D1 needs assessment workbook ("Dawakin Tofa needs assessment.xlsx",
  // New project → Upload needs assessment) is no longer written: the D1 flow is gone and wave 5 adds the
  // template v2 files of the pipeline. `demoWorkbookData` stays for routes.demo.test.ts.

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

  // 5. Needs pipeline wave 5 (M4): the appropriated schedule and the needs assessments to upload.
  const schedule = await buildDemoAppropriatedSchedule(today);
  fs.writeFileSync(path.join(OUT, DEMO_APPROPRIATION_FILE(schedule.year)), schedule.buffer);
  const uploads = await buildDemoNeedsUploads(today);
  for (const u of uploads) fs.writeFileSync(path.join(OUT, u.fileName), u.buffer);

  console.log(`Demo pack for ${today} written to ${OUT}`);
  for (const d of docs) console.log(`  ${d.file}`);
  const live = registerRows.filter((r) => r.status !== "Not started").length;
  console.log(`  ${DEMO_REGISTER_FILE}: ${registerRows.length} projects (${registerRows.length - live} not started, ${live} ongoing or completed)`);
  console.log(`  ${APPROVED_LIST_FILE}: ${listParsed.header.title}, ${listParsed.rows.length} rows (NGN ${listTotal.toLocaleString("en-NG")})`);
  console.log(`  ${DEMO_APPROPRIATION_FILE(schedule.year)}: ${schedule.rows.map((r) => `${r.reference} NGN ${r.appropriatedNgn.toLocaleString("en-NG")}`).join("; ")}`);
  for (const u of uploads) console.log(`  ${u.fileName}: ${u.spec.valid ? "reads cleanly" : `${u.issues} row error(s), as intended`}`);
  console.log(`  Demo project (seeded proposal ${schedule.rows[0].reference}): ${DEMO_PROJECT.name}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
