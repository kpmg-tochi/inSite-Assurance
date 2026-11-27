/**
 * Needs pipeline wave 2, Track A (no database): the needs assessment template v2 (`INSITE-NEEDS-v2`)
 * builder and parser, the old v1 scope workbook (A3) and the committed fixtures (A4).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  ceilingBreaches,
  DEFAULT_ESSENTIAL_FACILITY_GROUPS,
  essentialFacilityGaps,
  findDuplicateMatches,
  hasSupervisionLine,
  lineAmount,
  NEEDS_TEMPLATE_SHEETS,
  NEEDS_TEMPLATE_VERSION,
  ParsedNeedsAssessmentSchema,
  rateVariances,
  SCOPE_WORKBOOK_VERSION,
  zoneOfState,
  type DuplicateCandidate,
  type ParsedNeedsAssessment,
} from '@insite/shared';
import { buildNeedsWorkbook, LEGACY_TEMPLATE_WARNING, NEEDS_BOQ_COLUMNS, parseNeedsWorkbook } from '../modules/needs/workbook/needsWorkbook';
import { buildScopeWorkbook } from '../modules/scope/workbook/scopeWorkbook';
import { fillNeedsWorkbook } from './fixtures/needs/fillNeedsWorkbook';
import { FIXTURE_FACILITIES, fixtureBuildData, fixtureParseContext, fixtureStage, requiredFieldsFor } from './fixtures/needs/needsFixtureContext';
import { BATCH_SPECS, FIXTURE_SPECS, FIXTURE_STANDARD, V1_SPEC, type NeedsFixtureSpec } from './fixtures/needs/needsFixtureSpecs';
import { NEEDS_FIXTURE_FACTS, needsBatchFixtures, needsFixture, needsFixtureBase64, type NeedsFixtureName } from './fixtures/needs/needsFixtures';

const S = NEEDS_TEMPLATE_SHEETS;
const spec = (name: string) => FIXTURE_SPECS.find((s) => s.name === name)!;

async function blankFilled(s: NeedsFixtureSpec, opts: Parameters<typeof fillNeedsWorkbook>[2] = {}) {
  const { buffer } = await buildNeedsWorkbook(fixtureBuildData(s.programme));
  return fillNeedsWorkbook(buffer, s, opts);
}

async function parseFixture(name: NeedsFixtureName) {
  const s = spec(name);
  return parseNeedsWorkbook(needsFixture(name), fixtureParseContext(s.programme, fixtureStage(s)));
}

/** What a spec should parse to. */
function expectedParsed(s: NeedsFixtureSpec, programme: string): ParsedNeedsAssessment {
  const lines = s.lines.map((l) => ({
    wbsCode: l.wbsCode,
    unitId: l.unitId,
    itemCode: l.itemCode,
    description: l.description,
    unit: l.unit as never,
    totalQuantity: l.quantity,
    rateNgn: l.rate,
    amountNgn: lineAmount(l.quantity, l.rate),
  }));
  const subtotal = Math.round(lines.reduce((a, l) => a + l.amountNgn, 0) * 100) / 100;
  const pct = (p: number) => Math.round(((subtotal * p) / 100) * 100) / 100;
  return ParsedNeedsAssessmentSchema.parse({
    templateVersion: NEEDS_TEMPLATE_VERSION,
    costingStandardVersion: 1,
    project: {
      title: s.project.title,
      programme,
      interventionYear: s.project.interventionYear,
      stateCode: s.project.stateCode,
      justification: s.project.justification,
      assumptions: s.project.assumptions,
      beneficiaries: s.project.beneficiaries,
      estimatedDurationMonths: s.project.estimatedDurationMonths,
    },
    sites: s.sites,
    breakdownRows: s.rows.map((r) => {
      const own = lines.filter((l) => l.unitId === r.unitId);
      return {
        unitId: r.unitId,
        siteNumber: r.siteNumber,
        facilityCode: r.facility,
        interventionAction: r.action,
        existingQuantity: r.existingQuantity,
        existingCondition: r.condition,
        requiredQuantity: r.requiredQuantity,
        proposedQuantity: r.proposedQuantity,
        unitOfMeasure: r.unit,
        preliminaryCostNgn: own.length ? Math.round(own.reduce((a, l) => a + l.amountNgn, 0) * 100) / 100 : r.preliminaryCostNgn,
        technicalJustification: r.justification,
        criticality: r.priority,
        supportingEvidence: r.evidence,
      };
    }),
    boqLines: lines,
    costingSummary: lines.length
      ? {
          subtotalNgn: subtotal,
          supervisionMonitoringPct: s.supervisionMonitoringPct,
          supervisionMonitoringNgn: pct(s.supervisionMonitoringPct),
          contingencyPct: s.contingencyPct,
          contingencyNgn: pct(s.contingencyPct),
          totalNgn: Math.round((subtotal + pct(s.supervisionMonitoringPct) + pct(s.contingencyPct)) * 100) / 100,
        }
      : null,
  });
}

describe('Needs template v2: builder', () => {
  it('names the blank and pre-filled files and stamps the version', async () => {
    const blank = await buildNeedsWorkbook(fixtureBuildData('DI'));
    assert.equal(blank.fileName, 'UBEC needs assessment 2027 Direct Intervention.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(blank.buffer as unknown as ArrayBuffer);
    assert.deepEqual(
      wb.worksheets.map((w) => w.name),
      [S.INSTRUCTIONS, S.PROJECT, S.SITES, S.BREAKDOWN, S.BOQ, S.COSTING, S.RATES, S.LISTS]
    );
    assert.equal(wb.getWorksheet(S.LISTS)!.state, 'hidden');
    assert.equal(wb.getWorksheet(S.INSTRUCTIONS)!.getCell('B4').value, NEEDS_TEMPLATE_VERSION);
    assert.equal(wb.getWorksheet(S.INSTRUCTIONS)!.getCell('B5').value, '1');
    // Header row 3, BoQ Amount a formula, the standard's rates on the Rates sheet.
    const boq = wb.getWorksheet(S.BOQ)!;
    assert.equal(boq.getCell(3, 1).value, 'Item no.');
    assert.match(String((boq.getCell(4, NEEDS_BOQ_COLUMNS.length).value as ExcelJS.CellFormulaValue).formula), /F4\*G4/);
    assert.match(String((boq.getCell(4, 7).value as ExcelJS.CellFormulaValue).formula), /VLOOKUP\(C4,Rates!/);
    assert.equal(wb.getWorksheet(S.RATES)!.getCell('A4').value, FIXTURE_STANDARD.rates[0].itemCode);

    const mg = await buildNeedsWorkbook(fixtureBuildData('MG'));
    assert.equal(mg.fileName, 'UBEC needs assessment 2027 Matching Grants.xlsx');
    const mgWb = new ExcelJS.Workbook();
    await mgWb.xlsx.load(mg.buffer as unknown as ArrayBuffer);
    const proj = mgWb.getWorksheet(S.PROJECT)!;
    const values: Record<string, unknown> = {};
    proj.eachRow((row) => (values[String(row.getCell(1).value)] = row.getCell(2).value));
    assert.equal(values['Programme'], 'Matching Grants');
    assert.equal(values['Intervention year'], 2027);
    assert.equal(values['State'], 'Kano');
  });

  it('round trip: blank template, filled in, parses to the expected content', async () => {
    const s = spec('di-design-valid');
    const r = await parseNeedsWorkbook(await blankFilled(s), fixtureParseContext('DI', 'DESIGN'));
    assert.deepEqual(r.issues, []);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.templateVersion, NEEDS_TEMPLATE_VERSION);
    assert.equal(r.isLegacyTemplate, false);
    assert.deepEqual(r.parsed, expectedParsed(s, 'Direct Intervention'));
  });

  it('a pre-filled build re-parses to the same content (DI and MG)', async () => {
    for (const name of ['di-design-valid', 'mg-complete-valid', 'di-draft-valid'] as const) {
      const s = spec(name);
      const first = await parseFixture(name);
      assert.ok(first.parsed, name);
      const pre = await buildNeedsWorkbook(fixtureBuildData(s.programme, { prefill: first.parsed, proposalReference: s.programme === 'DI' ? '2027-DI-001' : '2027-MG-KN-001' }));
      assert.equal(pre.fileName, s.programme === 'DI' ? '2027-DI-001 needs assessment.xlsx' : '2027-MG-KN-001 needs assessment.xlsx');
      const again = await parseNeedsWorkbook(pre.buffer, fixtureParseContext(s.programme, fixtureStage(s)));
      assert.deepEqual(again.issues, [], name);
      assert.deepEqual(again.parsed, first.parsed, name);
    }
  });
});

describe('Needs template v2: fixtures', () => {
  it('the helper reads the committed files', () => {
    assert.ok(needsFixture('di-draft-valid').length > 1000);
    assert.equal(Buffer.from(needsFixtureBase64('di-draft-valid'), 'base64').length, needsFixture('di-draft-valid').length);
    const batch = needsBatchFixtures();
    assert.deepEqual(
      batch.map((b) => [b.fileName, b.valid]),
      [
        ['batch-1.xlsx', true],
        ['batch-2.xlsx', true],
        ['batch-3.xlsx', true],
        ['batch-4.xlsx', false],
        ['batch-5.xlsx', true],
      ]
    );
  });

  it('every valid fixture parses without issues and agrees with its facts', async () => {
    for (const s of FIXTURE_SPECS.filter((x) => x.valid)) {
      const r = await parseFixture(s.name as NeedsFixtureName);
      assert.deepEqual(r.issues, [], s.name);
      assert.deepEqual(r.warnings, [], s.name);
      const p = r.parsed!;
      const facts = NEEDS_FIXTURE_FACTS[s.name as NeedsFixtureName];
      assert.equal(p.project.title, facts.title);
      assert.equal(p.project.stateCode, facts.stateCode);
      assert.equal(p.project.interventionYear, facts.interventionYear);
      assert.deepEqual(p.sites.map((x) => x.schoolName), facts.schoolNames);
      assert.deepEqual(p.sites.map((x) => x.lgaCode), facts.lgaCodes);
      assert.equal(p.sites.length, facts.siteCount);
      assert.equal(p.breakdownRows.length, facts.breakdownRowCount);
      assert.equal(p.boqLines.length, facts.boqLineCount);
      assert.deepEqual(p.breakdownRows.map((x) => x.unitId), facts.unitIds);
      assert.equal(p.costingStandardVersion, 1);
      assert.deepEqual(p, expectedParsed(s, s.programme === 'DI' ? 'Direct Intervention' : 'Matching Grants'), s.name);
    }
  });

  it('the invalid fixtures give their row issues', async () => {
    const rowErrors = await parseFixture('row-errors');
    assert.equal(rowErrors.parsed, null);
    assert.deepEqual(
      rowErrors.issues.map((i) => [i.sheet, i.row, i.column]),
      [
        [S.SITES, 5, 'LGA'],
        [S.BREAKDOWN, 4, 'Facility'],
        [S.BREAKDOWN, 5, 'Existing quantity'],
        [S.BOQ, 6, 'Unit ID'],
      ]
    );
    assert.match(rowErrors.issues[0].reason, /LGA of Kano, not of Niger/);
    assert.match(rowErrors.issues[3].reason, /U99/);

    const mgNoBoq = await parseFixture('mg-no-boq');
    assert.equal(mgNoBoq.parsed, null);
    assert.deepEqual(
      mgNoBoq.issues.map((i) => i.reason.split(' is required')[0]),
      ['BoQ', 'Preliminary cost']
    );

    const batch4 = needsBatchFixtures()[3];
    const r4 = await parseNeedsWorkbook(batch4.buffer, fixtureParseContext('DI'));
    assert.deepEqual(
      r4.issues.map((i) => [i.sheet, i.row, i.column]),
      [
        [S.BREAKDOWN, 4, 'Intervention action'],
        [S.BREAKDOWN, 5, 'Proposed quantity'],
      ]
    );
    for (const [i, b] of needsBatchFixtures().entries()) {
      if (!b.valid) continue;
      const r = await parseNeedsWorkbook(b.buffer, fixtureParseContext('DI'));
      assert.deepEqual(r.issues, [], b.fileName);
      assert.equal(r.parsed!.sites[0].schoolName, BATCH_SPECS[i].sites[0].schoolName);
    }
  });

  it('each fixture raises exactly the flags it is named for (shared rules, as Track B applies them)', async () => {
    const parsedByName = new Map<string, ParsedNeedsAssessment>();
    for (const s of FIXTURE_SPECS.filter((x) => x.valid)) parsedByName.set(s.name, (await parseFixture(s.name as NeedsFixtureName)).parsed!);
    for (const [i, b] of needsBatchFixtures().entries()) {
      if (b.valid) parsedByName.set(BATCH_SPECS[i].name, (await parseNeedsWorkbook(b.buffer, fixtureParseContext('DI'))).parsed!);
    }
    for (const [name, p] of parsedByName) {
      const zone = zoneOfState(p.project.stateCode);
      const gaps = essentialFacilityGaps(p.breakdownRows, p.sites, DEFAULT_ESSENTIAL_FACILITY_GROUPS);
      assert.deepEqual(gaps.map((g) => g.groupLabel), name === 'essential-gap' ? ['Water'] : [], name);
      const variances = rateVariances(p.boqLines, FIXTURE_STANDARD, zone, 15);
      assert.deepEqual(variances.map((v) => [v.itemCode, v.variancePct]), name === 'rate-variance' ? [['FUR-PUP-2', 30]] : [], name);
      assert.deepEqual(ceilingBreaches(p.breakdownRows, p.boqLines, FIXTURE_STANDARD), [], name);
      if (p.boqLines.length) assert.equal(hasSupervisionLine(p.costingSummary), name !== 'missing-sm-line', name);
    }
    // Duplicates: only duplicate-of-di-draft's site matches another file's (the draft's site 1); the
    // design version is the draft's own proposal.
    const candidates: DuplicateCandidate[] = [];
    for (const [name, p] of parsedByName) {
      if (name === 'di-design-valid') continue;
      for (const s of p.sites) candidates.push({ ...s, source: 'PROPOSAL', id: name, reference: name, siteNumber: s.siteNumber });
    }
    for (const [name, p] of parsedByName) {
      const self = name === 'di-design-valid' ? 'di-draft-valid' : name;
      for (const s of p.sites) {
        const matches = findDuplicateMatches(s, candidates.filter((c) => c.id !== self), 100);
        const expected = name === 'duplicate-of-di-draft' ? ['di-draft-valid'] : self === 'di-draft-valid' && s.siteNumber === 1 ? ['duplicate-of-di-draft'] : [];
        assert.deepEqual(matches.map((m) => m.candidate.id), expected, `${name} site ${s.siteNumber}`);
      }
    }
  });

  it('every school name is distinct across fixtures, except the design version and the deliberate duplicate', () => {
    const names = [...FIXTURE_SPECS.filter((s) => s.name !== 'di-design-valid' && s.name !== 'duplicate-of-di-draft'), ...BATCH_SPECS]
      .flatMap((s) => s.sites.map((x) => x.schoolName.toLowerCase()))
      .concat(V1_SPEC.site.schoolName.toLowerCase());
    assert.equal(new Set(names).size, names.length);
  });
});

describe('Needs template v2: parser rules', () => {
  it('finds the header row when rows are inserted above it', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(needsFixture('di-design-valid') as unknown as ArrayBuffer);
    for (const name of [S.SITES, S.BREAKDOWN, S.BOQ]) {
      const ws = wb.getWorksheet(name)!;
      ws.unMergeCells('A1');
      ws.unMergeCells('A2');
      ws.spliceRows(1, 0, ['Inserted note'], ['Another note']);
    }
    const buffer = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const r = await parseNeedsWorkbook(buffer, fixtureParseContext('DI', 'DESIGN'));
    assert.deepEqual(r.issues, []);
    const original = (await parseFixture('di-design-valid')).parsed!;
    assert.deepEqual(r.parsed, original);
  });

  it('minimum fields per stage (DI identification, DI design, MG identification)', async () => {
    const draft = needsFixture('di-draft-valid');
    assert.deepEqual((await parseNeedsWorkbook(draft, fixtureParseContext('DI', 'IDENTIFICATION'))).issues, []);
    const atDesign = await parseNeedsWorkbook(draft, fixtureParseContext('DI', 'DESIGN'));
    assert.deepEqual(atDesign.issues, [{ sheet: S.BOQ, row: null, column: null, reason: 'BoQ is required at this stage.' }]);
    // DRAWINGS is in the design fields but never checked by the parser.
    assert.ok(requiredFieldsFor('DI', 'DESIGN').includes('DRAWINGS'));
    assert.deepEqual((await parseNeedsWorkbook(needsFixture('di-design-valid'), fixtureParseContext('DI', 'DESIGN'))).issues, []);
    assert.deepEqual((await parseNeedsWorkbook(needsFixture('mg-complete-valid'), fixtureParseContext('MG', 'IDENTIFICATION'))).issues, []);
    // MG without a BoQ passes the DI identification fields.
    assert.deepEqual((await parseNeedsWorkbook(needsFixture('mg-no-boq'), fixtureParseContext('MG', 'IDENTIFICATION', { requiredFields: requiredFieldsFor('DI', 'IDENTIFICATION') }))).issues, []);

    // Need, justification, sites and breakdown missing.
    const empty: NeedsFixtureSpec = { ...spec('di-draft-valid'), project: { ...spec('di-draft-valid').project, title: '', justification: '' }, sites: [], rows: [] };
    const r = await parseNeedsWorkbook(await blankFilled(empty), fixtureParseContext('DI'));
    assert.deepEqual(
      r.issues.map((i) => [i.sheet, i.column, i.reason.split(' is required')[0]]),
      [
        [S.PROJECT, 'Project title', 'The need (project title)'],
        [S.SITES, null, 'Sites'],
        [S.BREAKDOWN, null, 'Intervention and facilities breakdown'],
        [S.PROJECT, 'Justification', 'Justification'],
      ]
    );
  });

  it('wrong or blank intervention year', async () => {
    const s = spec('di-draft-valid');
    const wrong = await parseNeedsWorkbook(await blankFilled(s, { yearOverride: 2026 }), fixtureParseContext('DI'));
    assert.equal(wrong.parsed, null);
    assert.deepEqual(wrong.issues.map((i) => [i.sheet, i.column]), [[S.PROJECT, 'Intervention year']]);
    assert.match(wrong.issues[0].reason, /2026.*2027/);
    const blank = await parseNeedsWorkbook(await blankFilled(s, { yearOverride: null }), fixtureParseContext('DI'));
    assert.deepEqual(blank.issues, []);
    assert.equal(blank.parsed!.project.interventionYear, 2027);
    assert.equal(blank.warnings.length, 1);
  });

  it('wrong, blank or derived State', async () => {
    const mg = spec('mg-complete-valid');
    const wrong = await parseNeedsWorkbook(await blankFilled(mg, { stateNameOverride: 'Lagos' }), fixtureParseContext('MG'));
    assert.equal(wrong.parsed, null);
    assert.equal(wrong.issues[0].column, 'State');
    assert.match(wrong.issues[0].reason, /Lagos; the cycle is for Kano/);

    const blankMg = await parseNeedsWorkbook(await blankFilled(mg, { blankState: true }), fixtureParseContext('MG'));
    assert.deepEqual(blankMg.issues, []);
    assert.equal(blankMg.parsed!.project.stateCode, 'KN');
    assert.match(blankMg.warnings[0].reason, /cycle's State \(Kano\)/);

    // A DI file without a State takes it from its sites' LGAs.
    const blankDi = await parseNeedsWorkbook(await blankFilled(spec('di-draft-valid'), { blankState: true }), fixtureParseContext('DI'));
    assert.deepEqual(blankDi.issues, []);
    assert.equal(blankDi.parsed!.project.stateCode, 'NI');
    assert.equal(blankDi.warnings.length, 1);

    // A DI file naming Kaduna: the Niger LGAs are not in it.
    const otherState = await parseNeedsWorkbook(await blankFilled(spec('di-draft-valid'), { stateNameOverride: 'Kaduna' }), fixtureParseContext('DI'));
    assert.deepEqual(otherState.issues.map((i) => [i.sheet, i.row, i.column]), [
      [S.SITES, 4, 'LGA'],
      [S.SITES, 5, 'LGA'],
    ]);
  });

  it('recomputes amounts when the Amount cell is wrong', async () => {
    const s = spec('di-design-valid');
    const r = await parseNeedsWorkbook(await blankFilled(s, { amountOverrides: { 0: 1 } }), fixtureParseContext('DI', 'DESIGN'));
    assert.deepEqual(r.issues, []);
    assert.equal(r.parsed!.boqLines[0].amountNgn, lineAmount(s.lines[0].quantity, s.lines[0].rate));
    assert.deepEqual(r.warnings.map((w) => [w.sheet, w.row, w.column]), [[S.BOQ, 4, 'Amount']]);
  });

  it('a blank rate with a known item code takes the standard rate (warning)', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(needsFixture('di-design-valid') as unknown as ArrayBuffer);
    wb.getWorksheet(S.BOQ)!.getCell(4, 7).value = null;
    const r = await parseNeedsWorkbook(Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer), fixtureParseContext('DI', 'DESIGN'));
    assert.deepEqual(r.issues, []);
    assert.equal(r.parsed!.boqLines[0].rateNgn, 3_200_000);
    assert.deepEqual(r.warnings.map((w) => w.column), ['Rate']);
  });

  it('refuses a retired facility', async () => {
    const facilities = FIXTURE_FACILITIES.map((f) => (f.code === 'CLASSROOM' ? { ...f, isRetired: true } : f));
    const r = await parseNeedsWorkbook(needsFixture('di-draft-valid'), fixtureParseContext('DI', 'IDENTIFICATION', { facilities }));
    assert.equal(r.parsed, null);
    assert.deepEqual(r.issues.map((i) => [i.sheet, i.row, i.column]), [
      [S.BREAKDOWN, 4, 'Facility'],
      [S.BREAKDOWN, 8, 'Facility'],
    ]);
    assert.match(r.issues[0].reason, /retired/);
  });

  it('warns when the file was built on another costing standard version', async () => {
    const r = await parseNeedsWorkbook(
      needsFixture('di-design-valid'),
      fixtureParseContext('DI', 'DESIGN', { costingStandard: { version: 2, standard: FIXTURE_STANDARD } })
    );
    assert.deepEqual(r.issues, []);
    assert.equal(r.parsed!.costingStandardVersion, 1);
    assert.deepEqual(r.warnings.map((w) => [w.sheet, w.column]), [[S.INSTRUCTIONS, 'Costing standard version']]);
  });

  it('not a workbook, or a workbook without the stamp: one file-level issue', async () => {
    const notXlsx = await parseNeedsWorkbook(Buffer.from('hello, this is not a spreadsheet'), fixtureParseContext('DI'));
    assert.deepEqual(notXlsx.issues.length, 1);
    assert.equal(notXlsx.issues[0].sheet, S.FILE);
    assert.equal(notXlsx.templateVersion, null);

    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Sheet1').getCell('A1').value = 'Some list';
    const noStamp = await parseNeedsWorkbook(Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer), fixtureParseContext('DI'));
    assert.equal(noStamp.issues.length, 1);
    assert.equal(noStamp.issues[0].sheet, S.FILE);
    assert.match(noStamp.issues[0].reason, /no version stamp/);
  });
});

describe('Needs template v2: old v1 scope workbook (A3)', () => {
  it('reads sites and BoQ lines with no breakdown, a warning, and BREAKDOWN waived', async () => {
    const r = await parseNeedsWorkbook(needsFixture('v1-scope-workbook'), fixtureParseContext('DI', 'IDENTIFICATION'));
    assert.deepEqual(r.issues, []);
    assert.equal(r.isLegacyTemplate, true);
    assert.equal(r.templateVersion, SCOPE_WORKBOOK_VERSION);
    assert.deepEqual(r.warnings.map((w) => w.reason), [LEGACY_TEMPLATE_WARNING]);
    const p = r.parsed!;
    const facts = NEEDS_FIXTURE_FACTS['v1-scope-workbook'];
    assert.equal(p.templateVersion, SCOPE_WORKBOOK_VERSION);
    assert.equal(p.project.title, facts.title);
    assert.equal(p.project.stateCode, facts.stateCode);
    assert.equal(p.project.interventionYear, facts.interventionYear);
    assert.deepEqual(p.sites.map((s) => s.schoolName), facts.schoolNames);
    assert.deepEqual(p.sites.map((s) => s.lgaCode), facts.lgaCodes);
    assert.equal(p.breakdownRows.length, 0);
    assert.equal(p.boqLines.length, facts.boqLineCount);
    assert.deepEqual([...new Set(p.boqLines.map((l) => l.unitId))], facts.unitIds);
    assert.equal(p.boqLines[0].itemCode, null);
    // No summary in a v1 file: the cycle standard's percentages.
    assert.equal(p.costingSummary!.supervisionMonitoringPct, 5);
  });

  it('a v1 file without BoQ lines is refused at Matching Grants identification; a v1 file of another State too', async () => {
    const noLines = await buildScopeWorkbook({
      generatedAt: new Date('2026-11-26T00:00:00Z'),
      title: null,
      brandName: 'UBEC',
      project: { name: 'Kano school', state: 'Kano', interventionYear: 2027, strategicJustification: 'Needed.' },
      facilities: [{ code: 'CLASSROOM', name: 'Classroom' }],
      regions: [],
      deliveryModels: [],
      sprints: [],
      units: [],
      lines: [],
      sites: [{ siteNumber: 1, schoolName: 'Unguwar Rimi Primary School', schoolLevel: 'PRIMARY', lga: 'Gwale', address: null, latitude: null, longitude: null }],
    });
    const mg = await parseNeedsWorkbook(noLines, fixtureParseContext('MG', 'IDENTIFICATION'));
    assert.equal(mg.isLegacyTemplate, true);
    assert.deepEqual(mg.issues.map((i) => i.reason.split(' is required')[0]), ['BoQ', 'Preliminary cost']);

    const wrongState = await parseNeedsWorkbook(needsFixture('v1-scope-workbook'), fixtureParseContext('MG', 'IDENTIFICATION'));
    assert.equal(wrongState.parsed, null);
    assert.ok(wrongState.issues.some((i) => i.column === 'State' && /Niger; the cycle is for Kano/.test(i.reason)));
  });
});
