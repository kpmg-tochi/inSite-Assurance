/**
 * Redesign R2c unit tests (no database): the needs-assessment workbook generator and parser.
 * Files are built in memory; nothing is written to the repo.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { SCOPE_WORKBOOK_COLUMNS, SCOPE_WORKBOOK_PROJECT_FIELDS, SCOPE_WORKBOOK_VERSION } from '@insite/shared';
import {
  buildScopeWorkbook,
  parseScopeWorkbook,
  SCOPE_WORKBOOK_FIRST_DATA_ROW as FR,
  SCOPE_WORKBOOK_HEADER_ROW as HR,
  parseSheetDate,
  parseSheetNumber,
  WorkbookBuildData,
  WorkbookFacility,
} from '../modules/scope/workbook/scopeWorkbook';

const FACILITIES: WorkbookFacility[] = [
  { id: '00000000-0000-4000-8000-000000000001', code: 'CLASSROOM', name: 'Classroom', archetype: 'BUILDING_WORKS', isRetired: false },
  { id: '00000000-0000-4000-8000-000000000002', code: 'TOILET', name: 'Toilet', archetype: 'BUILDING_WORKS', isRetired: false },
  { id: '00000000-0000-4000-8000-000000000003', code: 'PUPILS_FURNITURE', name: "Pupils' furniture", archetype: 'SUPPLY_INSTALLATION', isRetired: false },
  { id: '00000000-0000-4000-8000-000000000004', code: 'HALL', name: 'Hall', archetype: 'BUILDING_WORKS', isRetired: true },
];

const DATA: WorkbookBuildData = {
  generatedAt: new Date('2026-11-24T08:00:00Z'),
  title: 'TST-001 · Test school',
  brandName: 'UBEC',
  project: { name: 'Test school', school: 'Test Primary School', region: 'North', lga: 'Kaduna North', budget: 5_000_000, latitude: 10.5, longitude: 7.4 },
  facilities: FACILITIES.filter((f) => !f.isRetired),
  regions: ['North', 'South'],
  deliveryModels: ['Central', 'Co-Funded'],
  sprints: [
    { number: 1, name: 'Substructure', startDate: '2027-01-04', endDate: '2027-02-26', deliverables: 'Foundations' },
    { number: 2, name: 'Superstructure', startDate: '2027-03-01', endDate: '2027-04-30', deliverables: '' },
  ],
  units: [
    { code: 'U01', facilityName: 'Toilet', label: 'Ground floor male toilet', plannedQuantity: null, quantityUnit: null, startSprint: 1, endSprint: 2 },
    { code: 'U02', facilityName: "Pupils' furniture", label: 'Desks', plannedQuantity: 120, quantityUnit: 'nr', startSprint: 2, endSprint: 2 },
  ],
  lines: [
    { wbsCode: '1.1', unitCode: 'U01', description: 'Blockwork 225 mm', unit: 'm2', totalQuantity: 120.5, rateNgn: 8000 },
    { wbsCode: '2.1', unitCode: 'U02', description: 'Supply of desks', unit: 'nr', totalQuantity: 120, rateNgn: 15000 },
  ],
};

async function load(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

async function edited(fn: (wb: ExcelJS.Workbook) => void, data: WorkbookBuildData = DATA): Promise<Buffer> {
  const wb = await load(await buildScopeWorkbook(data));
  fn(wb);
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

const parse = (buffer: Buffer) => parseScopeWorkbook(buffer, { facilities: FACILITIES });
const codes = (issues: Array<{ code: string }>) => issues.map((i) => i.code);
/** Row number now of a row that was row `r` when the headers sat in row 1. */
const at = (r: number) => r + FR - 2;

/** The Instructions row holding a label (Version, Generated, Project). */
function instructionsRow(wb: ExcelJS.Workbook, label: string): ExcelJS.Row {
  let found: ExcelJS.Row | undefined;
  wb.getWorksheet('Instructions')!.eachRow((row) => {
    if (row.getCell(1).value === label) found = row;
  });
  assert.ok(found, `no ${label} row`);
  return found!;
}

/**
 * A workbook laid out like the files downloaded before the title bands: headers in row 1, data from
 * row 2 (owners may still hold such copies).
 */
async function oldLayoutWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ins = wb.addWorksheet('Instructions');
  ins.getCell('A1').value = 'Needs-assessment workbook';
  ins.getCell('A3').value = 'Version';
  ins.getCell('B3').value = SCOPE_WORKBOOK_VERSION;
  const proj = wb.addWorksheet('Project');
  proj.getRow(1).values = ['Field', 'Value'];
  SCOPE_WORKBOOK_PROJECT_FIELDS.forEach((f, i) => (proj.getRow(i + 2).values = [f.label, f.key === 'name' ? 'Old school' : null]));
  const units = wb.addWorksheet('Facility units');
  units.getRow(1).values = [...SCOPE_WORKBOOK_COLUMNS.units];
  units.getRow(2).values = ['U01', 'Toilet', 'Ground floor male toilet', null, null, 1, 1];
  const boq = wb.addWorksheet('BoQ');
  boq.getRow(1).values = [...SCOPE_WORKBOOK_COLUMNS.boq];
  boq.getRow(2).values = ['1.1', 'U01', 'Blockwork 225 mm', 'm2', 10, 8000, { formula: 'IF(OR(E2="",F2=""),"",E2*F2)', result: 80000 }];
  const sprints = wb.addWorksheet('Sprints');
  sprints.getRow(1).values = [...SCOPE_WORKBOOK_COLUMNS.sprints];
  sprints.getRow(2).values = [1, 'Substructure', new Date(Date.UTC(2027, 0, 4)), new Date(Date.UTC(2027, 1, 26)), 'Foundations'];
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

describe('Redesign R2c: workbook generator', () => {
  it('has the sheets, a version stamp, a hidden Lists sheet, dropdowns and the amount formula', async () => {
    const wb = await load(await buildScopeWorkbook(DATA));
    assert.deepEqual(wb.worksheets.map((w) => w.name), ['Instructions', 'Project', 'Facility units', 'BoQ', 'Sprints', 'Lists']);
    assert.equal(instructionsRow(wb, 'Version').getCell(2).value, SCOPE_WORKBOOK_VERSION);
    const lists = wb.getWorksheet('Lists')!;
    assert.equal(lists.state, 'hidden');
    assert.equal(lists.getCell('A2').value, 'Classroom');
    assert.equal(lists.getCell('A4').value, "Pupils' furniture", 'retired facilities are not offered');
    const units = wb.getWorksheet('Facility units')!;
    assert.equal(units.getCell(`B${FR + 3}`).dataValidation?.type, 'list');
    assert.match(String(units.getCell(`B${FR + 3}`).dataValidation?.formulae?.[0]), /Lists!\$A\$2:\$A\$4/);
    assert.ok(String(units.getCell(`F${FR}`).dataValidation?.formulae?.[0]).startsWith(`Sprints!$A$${FR}:`), 'sprint list below the header');
    const boq = wb.getWorksheet('BoQ')!;
    assert.ok(String(boq.getCell(`B${FR}`).dataValidation?.formulae?.[0]).startsWith(`'Facility units'!$A$${FR}:`), 'Unit ID list below the header');
    const amount = boq.getCell(`G${FR}`).value as ExcelJS.CellFormulaValue;
    assert.equal(amount.formula, `IF(OR(E${FR}="",F${FR}=""),"",E${FR}*F${FR})`);
    assert.equal(wb.getWorksheet('Sprints')!.getCell(`C${FR}`).dataValidation?.type, 'date');
  });

  it('is styled for UBEC: title band, brand header row, borders, banded rows, protected Amount', async () => {
    const wb = await load(await buildScopeWorkbook(DATA));
    const boq = wb.getWorksheet('BoQ')!;
    assert.equal(boq.getCell('A1').value, 'UBEC · Needs assessment · BoQ');
    assert.equal((boq.getCell('A1').fill as ExcelJS.FillPattern).fgColor?.argb, 'FF122F2A', 'dark green title band');
    assert.equal(boq.getCell('A1').font?.color?.argb, 'FFFFFFFF');
    assert.match(String(boq.getCell('A2').value), /^TST-001 · Test school {2}\| /);
    assert.equal(boq.getCell(`C${HR}`).value, 'Description');
    assert.equal((boq.getCell(`C${HR}`).fill as ExcelJS.FillPattern).fgColor?.argb, 'FF00715D', 'brand green header');
    assert.equal(boq.getCell(`C${HR}`).font?.bold, true);
    assert.equal(boq.views[0].state, 'frozen');
    assert.equal(boq.views[0].ySplit, HR);
    assert.equal(boq.getCell(`C${FR + 500}`).border?.top?.style, 'thin', 'borders across the pre-sized rows');
    assert.equal(boq.getCell(`F${FR}`).numFmt, '"₦"#,##0.00');
    assert.equal(boq.getCell(`E${FR}`).numFmt, '#,##0.00');
    assert.notEqual(boq.getCell(`G${FR}`).protection?.locked, false, 'Amount is locked (the default)');
    assert.equal(boq.getCell(`A${FR}`).protection?.locked, false, 'inputs are not');
    const protection = (boq as unknown as { sheetProtection?: { sheet?: boolean } }).sheetProtection;
    assert.equal(protection?.sheet, true, 'the BoQ sheet is protected');
    const banding = JSON.stringify((boq as unknown as { conditionalFormattings: unknown[] }).conditionalFormattings);
    assert.match(banding, /MOD\(ROW\(\),2\)/);
    assert.match(String(wb.getWorksheet('Sprints')!.getCell(`C${FR}`).numFmt), /mmm/);
    assert.equal(wb.getWorksheet('Instructions')!.getCell('A1').value, 'UBEC · Needs assessment');
    const blank = await load(await buildScopeWorkbook({ ...DATA, title: null, brandName: null }));
    assert.equal(blank.getWorksheet('Instructions')!.getCell('A1').value, 'Needs assessment template');
    assert.equal(instructionsRow(blank, 'Project').getCell(2).value, '(blank template)');
  });

  it('round-trips: generate → parse gives the same data', async () => {
    const parsed = await parse(await buildScopeWorkbook(DATA));
    assert.deepEqual(parsed.issues, []);
    assert.equal(parsed.version, SCOPE_WORKBOOK_VERSION);
    assert.deepEqual(parsed.sprints, DATA.sprints);
    assert.deepEqual(
      parsed.units.map((u) => [u.code, u.facility.code, u.label, u.plannedQuantity, u.quantityUnit, u.startSprint, u.endSprint]),
      [
        ['U01', 'TOILET', 'Ground floor male toilet', null, null, 1, 2],
        ['U02', 'PUPILS_FURNITURE', 'Desks', 120, 'nr', 2, 2],
      ]
    );
    assert.deepEqual(
      parsed.lines.map((l) => [l.wbsCode, l.unitCode, l.description, l.unit, l.totalQuantity, l.rateNgn, l.amountNgn]),
      [
        ['1.1', 'U01', 'Blockwork 225 mm', 'm2', 120.5, 8000, 964000],
        ['2.1', 'U02', 'Supply of desks', 'nr', 120, 15000, 1800000],
      ]
    );
    assert.equal(parsed.project.name, 'Test school');
    assert.equal(parsed.project.region, 'North');
    assert.equal(parsed.project.latitude, '10.5');
  });

  it('a blank workbook parses with no errors and warns that there are no lines', async () => {
    const parsed = await parse(await buildScopeWorkbook({ ...DATA, project: {}, sprints: [], units: [], lines: [] }));
    assert.deepEqual(parsed.issues, []);
    assert.deepEqual(codes(parsed.warnings), ['NO_LINES']);
  });
});

describe('Redesign R2c: workbook parser', () => {
  it('finds columns by header name, in any order', async () => {
    const buffer = await edited((wb) => {
      const ws = wb.getWorksheet('BoQ')!;
      // Swap Description (C) and Rate (F), headers and values.
      for (let r = HR; r <= HR + 2; r++) {
        const c = ws.getCell(`C${r}`).value;
        ws.getCell(`C${r}`).value = ws.getCell(`F${r}`).value;
        ws.getCell(`F${r}`).value = c;
      }
    });
    const parsed = await parse(buffer);
    assert.deepEqual(parsed.issues, []);
    assert.equal(parsed.lines[0].description, 'Blockwork 225 mm');
    assert.equal(parsed.lines[0].rateNgn, 8000);
  });

  it('refuses another version stamp', async () => {
    const parsed = await parse(await edited((wb) => (instructionsRow(wb, 'Version').getCell(2).value = 'INSITE-SCOPE-v0')));
    assert.deepEqual(codes(parsed.issues), ['WORKBOOK_VERSION_MISMATCH']);
  });

  it('refuses a file that is not a workbook', async () => {
    const parsed = await parse(Buffer.from('Item no.,Description\n1,Wall\n'));
    assert.deepEqual(codes(parsed.issues), ['WORKBOOK_UNREADABLE']);
  });

  it('reports a missing column', async () => {
    const parsed = await parse(await edited((wb) => (wb.getWorksheet('BoQ')!.getCell(`D${HR}`).value = 'UoM')));
    const missing = parsed.issues.find((i) => i.code === 'WORKBOOK_COLUMN_MISSING');
    assert.ok(missing, JSON.stringify(parsed.issues));
    assert.equal(missing!.row, HR, 'reported on the header row');
    assert.equal(missing!.column, 'Unit of measure');
  });

  it('reads files laid out before the title bands (headers in row 1)', async () => {
    const parsed = await parse(await oldLayoutWorkbook());
    assert.deepEqual(parsed.issues, []);
    assert.equal(parsed.project.name, 'Old school');
    assert.deepEqual(parsed.sprints.map((s) => [s.number, s.startDate, s.endDate]), [[1, '2027-01-04', '2027-02-26']]);
    assert.deepEqual(parsed.units.map((u) => [u.code, u.facility.code]), [['U01', 'TOILET']]);
    assert.deepEqual(parsed.lines.map((l) => [l.row, l.wbsCode, l.amountNgn]), [[2, '1.1', 80000]]);
  });

  it('finds the header row below extra rows a user inserted above it', async () => {
    const buffer = await edited((wb) => {
      const ws = wb.getWorksheet('Sprints')!;
      ws.unMergeCells('A1:E1');
      ws.unMergeCells('A2:E2');
      ws.spliceRows(1, 0, ['Kano SUBEB copy'], []);
    });
    const parsed = await parse(buffer);
    assert.deepEqual(parsed.issues, []);
    assert.deepEqual(parsed.sprints.map((s) => s.number), [1, 2]);
  });

  it('flags pasted values row by row', async () => {
    const buffer = await edited((wb) => {
      const units = wb.getWorksheet('Facility units')!;
      units.getRow(at(4)).values = ['U03', 'Swimming pool', 'Pool', null, null, 1, 1]; // unknown facility
      units.getRow(at(5)).values = ['U04', "Pupils' furniture", 'Chairs', null, null, 1, 1]; // missing quantity
      units.getRow(at(6)).values = ['U05', 'Toilet', 'Female toilet', null, null, 1, 7]; // unknown sprint
      units.getRow(at(7)).values = ['U06', 'Hall', 'Old hall', null, null, 1, 1]; // retired
      const boq = wb.getWorksheet('BoQ')!;
      boq.getRow(at(4)).values = ['3.1', 'U99', 'Plaster', 'm2', 10, 500]; // unknown Unit ID
      boq.getRow(at(5)).values = ['3.2', 'U01', 'Paint', 'gallons', 10, 500]; // unknown unit of measure
      boq.getRow(at(6)).values = ['3.3', 'U01', 'Doors', 'nr', '', 500]; // missing quantity
      boq.getRow(at(7)).values = ['1.1', 'U01', 'Duplicate', 'nr', 1, 1]; // duplicate item no.
      const sprints = wb.getWorksheet('Sprints')!;
      sprints.getRow(at(4)).values = [3, 'Finishes', '2027-02-30', '2027-05-31']; // bad date
    });
    const parsed = await parse(buffer);
    // Expected rows below are in the old layout; at() maps them to the rows now.
    const byRow = parsed.issues.map((i) => `${i.sheet}:${(i.row ?? 0) - (FR - 2)}:${i.code}`);
    for (const expected of [
      'Facility units:4:UNKNOWN_FACILITY',
      'Facility units:5:MISSING_QUANTITY',
      'Facility units:6:UNKNOWN_SPRINT',
      'Facility units:7:FACILITY_RETIRED',
      'BoQ:4:UNKNOWN_UNIT_ID',
      'BoQ:5:UNKNOWN_UNIT_OF_MEASURE',
      'BoQ:6:MISSING_QUANTITY',
      'BoQ:7:DUPLICATE_ITEM_NO',
      'Sprints:4:BAD_DATE',
    ]) {
      assert.ok(byRow.includes(expected), `missing ${expected} in ${byRow.join(', ')}`);
    }
  });

  it('flags overlapping sprints and numbers out of date order', async () => {
    const overlap = await parse(
      await edited((wb) => (wb.getWorksheet('Sprints')!.getCell(`C${at(3)}`).value = new Date(Date.UTC(2027, 1, 20))))
    );
    assert.ok(overlap.issues.some((i) => i.code === 'OVERLAPPING_SPRINTS' && i.row === at(3)), JSON.stringify(overlap.issues));
    const order = await parse(
      await edited((wb) => {
        const ws = wb.getWorksheet('Sprints')!;
        ws.getCell(`A${at(2)}`).value = 2;
        ws.getCell(`A${at(3)}`).value = 1;
      })
    );
    assert.ok(codes(order.issues).includes('SPRINT_NUMBER_ORDER'));
  });

  it('allows a retired facility the project already uses', async () => {
    const buffer = await edited((wb) => (wb.getWorksheet('Facility units')!.getRow(at(4)).values = ['U03', 'Hall', 'Old hall', null, null, 1, 1]));
    const parsed = await parseScopeWorkbook(buffer, { facilities: FACILITIES, allowedRetiredFacilityIds: new Set([FACILITIES[3].id]) });
    assert.deepEqual(parsed.issues, []);
  });

  it('recomputes amounts and ignores the sheet value', async () => {
    const parsed = await parse(await edited((wb) => (wb.getWorksheet('BoQ')!.getCell(`G${FR}`).value = 1)));
    assert.equal(parsed.lines[0].amountNgn, 964000);
    assert.ok(parsed.warnings.some((w) => w.code === 'AMOUNT_RECOMPUTED' && w.row === FR));
  });

  it('reads numbers and dates as people type them', () => {
    assert.equal(parseSheetNumber('12,500'), 12500);
    assert.equal(parseSheetNumber('₦8,500,000.50'), 8500000.5);
    assert.equal(parseSheetNumber(''), null);
    assert.ok(Number.isNaN(parseSheetNumber('abc')));
    assert.equal(parseSheetDate('2027-01-04'), '2027-01-04');
    assert.equal(parseSheetDate('04/01/2027'), '2027-01-04', 'day first');
    assert.equal(parseSheetDate(new Date(Date.UTC(2027, 0, 4))), '2027-01-04');
    assert.equal(parseSheetDate(46391), '2027-01-04', 'Excel serial');
    assert.equal(parseSheetDate('31/02/2027'), null);
  });
});
