/**
 * Writes the UBEC demo pack to `saas_updates/demo_pack/` (run `npm run demo:pack` from `server/`):
 * the filled needs-assessment workbook for the demo project, with dates relative to today, and the
 * specimen PDFs the presenter uploads live. Re-running overwrites the folder's generated files.
 * Needs no database: the workbook uses the UBEC workspace's default lists. The workbook is parsed
 * back with the real parser and the script fails if it has any error.
 */
import fs from "fs";
import path from "path";
import { validateRegisterRow, zonedCalendarDate } from "@insite/shared";
import { buildScopeWorkbook, parseScopeWorkbook } from "../modules/scope/workbook/scopeWorkbook";
import { renderDemoDocument } from "../db/demoDocuments";
import { DEMO_LINES, DEMO_PROJECT, DEMO_REGISTER_FILE, DEMO_UNITS, DEMO_WORKBOOK_FILE, demoDates, demoDocumentContext, demoFacilities, demoPackDocuments, demoRegisterRows, demoRegisterWorkbookData, demoWorkbookData } from "./demoProject";
import { buildRegisterWorkbook } from "../modules/projectRegister/registerWorkbook";

const OUT = path.resolve(__dirname, "../../../saas_updates/demo_pack");

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
  if (parsed.units.length !== DEMO_UNITS.length || parsed.lines.length !== DEMO_LINES.length || parsed.sprints.length !== 2) {
    throw new Error(`The demo workbook read back ${parsed.units.length} units, ${parsed.lines.length} lines, ${parsed.sprints.length} sprints`);
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

  const dates = demoDates(today);
  console.log(`Demo pack for ${today} written to ${OUT}`);
  console.log(`  ${DEMO_WORKBOOK_FILE}: ${parsed.units.length} units, ${parsed.lines.length} lines (NGN ${total.toLocaleString("en-NG")}), sprint 1 ${dates.sprints[0].startDate}..${dates.sprints[0].endDate}, sprint 2 ${dates.sprints[1].startDate}..${dates.sprints[1].endDate}; ${parsed.warnings.length} warning(s)`);
  for (const d of docs) console.log(`  ${d.file}`);
  const live = registerRows.filter((r) => r.status !== "Not started").length;
  console.log(`  ${DEMO_REGISTER_FILE}: ${registerRows.length} projects (${registerRows.length - live} not started, ${live} ongoing or completed)`);
  console.log(`  Project code to type when creating the draft: ${DEMO_PROJECT.code}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
