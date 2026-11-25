/**
 * UBEC IRL unit tests (no database): the project register row rules and code numbering
 * (shared/src/utils/projectRegister.ts), the register workbook round trip, and the needs assessment's
 * new Project rows (intervention year, funding source; old files without them still parse).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  assignRegisterCodes,
  dominantCodeSeries,
  nextFreeProjectCode,
  parseRegisterImportStatus,
  ProjectBasicsStepSchema,
  ProjectListFiltersSchema,
  ProjectRegisterFiltersSchema,
  PROJECT_REGISTER_COLUMNS,
  PROJECT_REGISTER_TEMPLATE_VERSION,
  validateRegisterRow,
} from '@insite/shared';
import { buildRegisterWorkbook } from '../modules/projectRegister/registerWorkbook';
import { buildScopeWorkbook, parseScopeWorkbook } from '../modules/scope/workbook/scopeWorkbook';
import { demoFacilities, demoRegisterRows, demoRegisterWorkbookData, demoWorkbookData } from '../scripts/demoProject';

const codesOf = (r: ReturnType<typeof validateRegisterRow>) => r.issues.map((i) => i.code);
const base = { name: 'Classroom block, GPS Bichi', state: 'Kano', budget: '₦12,500,000' };

describe('UBEC IRL: register row rules', () => {
  it('accepts a minimal draft row and reads numbers, dates and statuses as people type them', () => {
    const r = validateRegisterRow({ ...base, contractAwardDate: '05/01/2025', contractSignedDate: new Date('2025-01-20T00:00:00Z'), interventionYear: '2025', fundingSource: ' UBEC Intervention Fund ' });
    assert.deepEqual(r.issues, []);
    assert.equal(r.values.status, 'NOT_STARTED');
    assert.equal(r.values.budgetNgn, 12_500_000);
    assert.equal(r.values.contractAwardDate, '2025-01-05');
    assert.equal(r.values.contractSignedDate, '2025-01-20');
    assert.equal(r.values.interventionYear, 2025);
    assert.equal(r.values.fundingSource, 'UBEC Intervention Fund');
    assert.equal(r.values.percentComplete, null);
    assert.equal(parseRegisterImportStatus('In progress'), 'ONGOING');
    assert.equal(parseRegisterImportStatus('COMPLETE'), 'COMPLETED');
    assert.equal(parseRegisterImportStatus(''), 'NOT_STARTED');
    assert.equal(parseRegisterImportStatus('paused'), null);
  });

  it('falls back to the contract sum for the budget and needs one of them', () => {
    assert.equal(validateRegisterRow({ name: 'Project A', state: 'Kano', contractSum: 9_000_000 }).values.budgetNgn, 9_000_000);
    assert.deepEqual(codesOf(validateRegisterRow({ name: 'Project A', state: 'Kano' })), ['BUDGET_REQUIRED']);
  });

  it('checks required fields, codes, years, GPS and date order', () => {
    assert.deepEqual(codesOf(validateRegisterRow({ budget: 1 })), ['MISSING_VALUE', 'MISSING_VALUE']);
    assert.deepEqual(codesOf(validateRegisterRow({ ...base, code: 'prg-12' })), ['INVALID_CODE']);
    assert.equal(validateRegisterRow({ ...base, code: 'prg-120' }).values.code, 'PRG-120');
    assert.deepEqual(codesOf(validateRegisterRow({ ...base, interventionYear: 1999 })), ['INVALID_YEAR']);
    assert.deepEqual(codesOf(validateRegisterRow({ ...base, latitude: 12 })), ['INVALID_GPS']);
    assert.deepEqual(codesOf(validateRegisterRow({ ...base, latitude: 120, longitude: 8 })), ['INVALID_GPS']);
    assert.deepEqual(codesOf(validateRegisterRow({ ...base, plannedStartDate: '2026-05-01', plannedCompletionDate: '2026-04-01' })), ['DATES_OUT_OF_ORDER']);
    assert.deepEqual(codesOf(validateRegisterRow({ ...base, contractAwardDate: 'next week' })), ['BAD_DATE']);
    assert.deepEqual(codesOf(validateRegisterRow({ ...base, status: 'Paused' })), ['UNKNOWN_STATUS']);
  });

  it('asks a live row for GPS, contractor and % complete; a fraction reads as a percentage', () => {
    assert.deepEqual(codesOf(validateRegisterRow({ ...base, status: 'Ongoing' })).sort(), ['CONTRACTOR_REQUIRED', 'GPS_REQUIRED', 'PERCENT_REQUIRED'].sort());
    const ok = validateRegisterRow({ ...base, status: 'Ongoing', latitude: 12.2, longitude: 8.2, contractor: 'Sahel Build', percentComplete: 0.45 });
    assert.deepEqual(ok.issues, []);
    assert.equal(ok.values.percentComplete, 45);
    const done = validateRegisterRow({ ...base, status: 'Completed', latitude: 12.2, longitude: 8.2, contractor: 'Sahel Build' });
    assert.equal(done.values.percentComplete, 100);
    const notStarted = validateRegisterRow({ ...base, percentComplete: 20 });
    assert.equal(notStarted.values.percentComplete, null);
    assert.deepEqual(notStarted.warnings.map((w) => w.code), ['PERCENT_IGNORED']);
  });

  it('numbers codes after the highest of the main series; a taken code gets the next of its own series', () => {
    assert.equal(dominantCodeSeries(['PRG-101', 'PRG-242', 'LKK-402']), 'PRG');
    assert.equal(dominantCodeSeries([]), 'PRJ');
    assert.equal(nextFreeProjectCode('PRG', new Set(['PRG-101', 'PRG-242'])), 'PRG-243');
    assert.equal(nextFreeProjectCode('PRG', new Set(['PRG-999'])), null);
    const out = assignRegisterCodes([{ code: null }, { code: 'PRG-101' }, { code: 'ABJ-500' }, { code: 'ABJ-500' }, { code: null }], ['PRG-101', 'PRG-242', 'ABJ-105']);
    assert.deepEqual(out.map((o) => o.code), ['PRG-243', 'PRG-244', 'ABJ-500', 'ABJ-501', 'PRG-245']);
    assert.deepEqual(out.map((o) => o.assigned), [true, true, false, true, true]);
    assert.match(out[1].note ?? '', /PRG-101 is already used/);
  });

  it('accepts the register fields and filters in the shared schemas', () => {
    const basics = { name: 'Project A', codePrefix: 'PRG-120', stateLocation: 'Kano', totalBudgetNgn: 1 };
    assert.equal(ProjectBasicsStepSchema.safeParse({ ...basics, interventionYear: 2101 }).success, false);
    assert.equal(ProjectBasicsStepSchema.safeParse({ ...basics, interventionYear: null, externalReference: null }).success, true);
    assert.equal(ProjectBasicsStepSchema.safeParse({ ...basics, externalReference: 'a\nb' }).success, false);
    assert.equal(ProjectListFiltersSchema.parse({ interventionYear: '2025' }).interventionYear, 2025);
    assert.equal(ProjectRegisterFiltersSchema.safeParse({ status: 'drafts' }).success, false);
  });
});

describe('UBEC IRL: register workbook', () => {
  it('writes the demo pack rows under the headers, with the version stamp and every demo row valid', async () => {
    const today = '2026-12-01';
    for (const row of demoRegisterRows(today)) assert.deepEqual(validateRegisterRow(row).issues, [], String(row.name));
    const buffer = await buildRegisterWorkbook(demoRegisterWorkbookData(today, new Date('2026-12-01T08:00:00Z')));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    assert.deepEqual(wb.worksheets.map((w) => w.name), ['Instructions', 'Projects', 'Lists']);
    assert.equal(wb.getWorksheet('Lists')!.state, 'hidden');
    assert.equal(wb.getWorksheet('Instructions')!.getCell('B4').value, PROJECT_REGISTER_TEMPLATE_VERSION);
    const ws = wb.getWorksheet('Projects')!;
    const headers = (ws.getRow(3).values as unknown[]).slice(1);
    assert.equal(headers.length, PROJECT_REGISTER_COLUMNS.length);
    assert.equal(headers[1], 'UBEC project ID');
    assert.equal(ws.getCell('C4').value, demoRegisterRows(today)[0].name);
    assert.ok(ws.getCell(`${String.fromCharCode(65 + PROJECT_REGISTER_COLUMNS.findIndex((c) => c.key === 'contractAwardDate'))}6`).value instanceof Date);
  });
});

describe('UBEC IRL: needs assessment register rows', () => {
  it('writes and reads intervention year and funding source on the Project sheet', async () => {
    const data = demoWorkbookData('2026-12-01');
    const parsed = await parseScopeWorkbook(await buildScopeWorkbook(data), { facilities: demoFacilities() });
    assert.deepEqual(parsed.issues, []);
    assert.equal(parsed.project.interventionYear, '2026');
    assert.equal(parsed.project.fundingSource, 'UBEC Intervention Fund');
  });

  it('still reads a file made before the rows existed', async () => {
    const data = demoWorkbookData('2026-12-01');
    const buffer = await buildScopeWorkbook({ ...data, project: { ...data.project, interventionYear: null, fundingSource: null } });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Project')!;
    ws.eachRow((row) => {
      if (['Intervention year', 'Funding source'].includes(String(row.getCell(1).value))) row.getCell(1).value = null;
    });
    const parsed = await parseScopeWorkbook(Buffer.from(await wb.xlsx.writeBuffer()), { facilities: demoFacilities() });
    assert.deepEqual(parsed.issues, []);
    assert.equal(parsed.project.interventionYear, undefined);
    assert.equal(parsed.project.name, data.project.name);
  });
});
