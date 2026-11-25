/**
 * Redesign R3 unit tests (no database): the default form library, field checks, placeholders, the
 * sprint rule, visit form assembly and answer validation.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assembleVisitForm,
  assemblyInputFromBundle,
  canonicalVisitFormSnapshot,
  DEFAULT_FORM_LIBRARY,
  FacilityArchetype,
  FacilitySubFormDefinitionSchema,
  facilityNoun,
  FormField,
  FormFieldInput,
  FormFieldSchema,
  plannedQuantityOf,
  renderPlaceholders,
  SaveFacilitySubFormRequestSchema,
  SaveFormSectionRequestSchema,
  SaveVisitFormTemplateRequestSchema,
  sprintForDate,
  validateFormFields,
  validateVisitAnswers,
  VisitFormAnswerInput,
  VisitFormAssemblyError,
  VisitFormLibraryBundle,
  VisitFormLibraryBundleSchema,
  VisitFormSnapshot,
  VisitFormSnapshotSchema,
  VisitKind,
  VisitKindEnum,
} from '@insite/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let idSeq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++idSeq).padStart(12, '0')}`;

const field = (f: FormFieldInput): FormField => FormFieldSchema.parse(f);

interface Fixture {
  bundle: VisitFormLibraryBundle;
  ids: Record<string, string>;
}

/** A project with TOILET ×3, PUPILS_FURNITURE ×1 (120 nr), BOREHOLE ×1, CLASSROOM (legacy, no sprints). */
function fixture(opts: { toiletFields?: FormFieldInput[] } = {}): Fixture {
  const ids: Record<string, string> = {};
  const id = (k: string) => (ids[k] ??= uuid());
  const sections = DEFAULT_FORM_LIBRARY.sections.map((s) => ({
    id: id(`section:${s.code}`),
    code: s.code,
    version: 1,
    title: s.title,
    description: s.description ?? null,
    fields: s.fields.map(field),
  }));
  const subForms = (Object.entries(DEFAULT_FORM_LIBRARY.archetypeSubForms) as Array<[FacilityArchetype, FormFieldInput[]]>).map(([a, fields]) => ({
    id: id(`subform:${a}`),
    subjectKey: `ARCHETYPE:${a}`,
    version: 1,
    fields: FacilitySubFormDefinitionSchema.parse({ fields }).fields,
  }));
  const facilities = [
    { code: 'TOILET', name: 'Toilet', archetype: 'BUILDING_WORKS' as const, sortOrder: 40 },
    { code: 'CLASSROOM', name: 'Classroom', archetype: 'BUILDING_WORKS' as const, sortOrder: 10 },
    { code: 'PUPILS_FURNITURE', name: "Pupils' furniture", archetype: 'SUPPLY_INSTALLATION' as const, sortOrder: 200 },
    { code: 'BOREHOLE', name: 'Borehole', archetype: 'UTILITIES' as const, sortOrder: 420 },
  ].map((f) => ({ id: id(`facility:${f.code}`), pluralName: null, ...f, subFormId: id(`subform:${f.archetype}`) }));
  if (opts.toiletFields) {
    const custom = { id: id('subform:TOILET'), subjectKey: `FACILITY:${id('facility:TOILET')}`, version: 2, fields: opts.toiletFields.map(field) };
    subForms.push(custom);
    facilities[0].subFormId = custom.id;
  }
  const sprints = [
    { id: id('sprint:1'), number: 1, name: 'Sprint 1', startDate: '2026-01-01', endDate: '2026-01-31', deliverables: 'Substructure' },
    { id: id('sprint:2'), number: 2, name: 'Sprint 2', startDate: '2026-02-01', endDate: '2026-02-28', deliverables: 'Roofing' },
    { id: id('sprint:3'), number: 3, name: 'Sprint 3', startDate: '2026-03-10', endDate: '2026-04-10', deliverables: 'Finishes and supply' },
  ];
  const unit = (key: string, facility: string, label: string, s: number | null, e: number | null, sortOrder: number, qty: number | null = null) => ({
    id: id(`unit:${key}`),
    code: key,
    label,
    facilityId: id(`facility:${facility}`),
    plannedQuantity: qty,
    quantityUnit: qty === null ? null : 'nr',
    startSprintNumber: s,
    endSprintNumber: e,
    sortOrder,
  });
  const units = [
    unit('U03', 'TOILET', "Teachers' lounge female toilet", 2, 3, 3),
    unit('U01', 'TOILET', 'Ground floor male toilet', 1, 2, 1),
    unit('U02', 'TOILET', 'Ground floor female toilet', 1, 2, 2),
    unit('U04', 'PUPILS_FURNITURE', "Pupils' desks and chairs", 3, 3, 4, 120),
    unit('U05', 'BOREHOLE', 'Borehole', 1, 1, 5),
    unit('U06', 'CLASSROOM', 'Block A classroom 1', null, null, 6),
  ];
  const templates = DEFAULT_FORM_LIBRARY.templates.map((t) => {
    const parsed = SaveVisitFormTemplateRequestSchema.parse(t);
    return { id: id(`template:${parsed.code}`), code: parsed.code, version: 1, name: parsed.name, visitKind: parsed.visitKind, blocks: parsed.blocks };
  });
  const bundle = VisitFormLibraryBundleSchema.parse({
    projectId: id('project'),
    templates,
    sections,
    subForms,
    facilities,
    units,
    sprints,
    completedUnitIds: [],
  });
  return { bundle, ids };
}

function build(fx: Fixture, kind: VisitKind, visitDate: string, extra: Partial<Parameters<typeof assemblyInputFromBundle>[1]> = {}) {
  return assembleVisitForm(assemblyInputFromBundle(fx.bundle, { visitKind: kind, visitDate, builtAt: '2026-02-10T08:00:00.000Z', ...extra }));
}

const facilityBlocks = (s: VisitFormSnapshot) => s.blocks.filter((b) => b.kind === 'FACILITY');
const unitIdsOf = (s: VisitFormSnapshot) => facilityBlocks(s).flatMap((b) => b.units.map((u) => u.code));

// ---------------------------------------------------------------------------

describe('Redesign R3: default form library', () => {
  it('has 10 sections, 4 archetype sub-forms and a template for every visit kind', () => {
    assert.equal(DEFAULT_FORM_LIBRARY.sections.length, 10);
    assert.equal(Object.keys(DEFAULT_FORM_LIBRARY.archetypeSubForms).length, 4);
    assert.equal(DEFAULT_FORM_LIBRARY.templates.length, 7);
    for (const kind of VisitKindEnum.options) {
      assert.ok(DEFAULT_FORM_LIBRARY.templates.some((t) => t.code === kind && t.visitKind === kind), `template for ${kind}`);
    }
  });

  it('every component passes the save schemas and validateFormFields', () => {
    for (const s of DEFAULT_FORM_LIBRARY.sections) {
      const r = SaveFormSectionRequestSchema.safeParse(s);
      assert.ok(r.success, `${s.code}: ${!r.success && JSON.stringify(r.error.issues)}`);
    }
    for (const [a, fields] of Object.entries(DEFAULT_FORM_LIBRARY.archetypeSubForms)) {
      const r = SaveFacilitySubFormRequestSchema.safeParse({ fields });
      assert.ok(r.success, `${a}: ${!r.success && JSON.stringify(r.error.issues)}`);
    }
    for (const t of DEFAULT_FORM_LIBRARY.templates) assert.ok(SaveVisitFormTemplateRequestSchema.safeParse(t).success, t.code);
  });

  it("every template's section codes exist", () => {
    const codes = new Set(DEFAULT_FORM_LIBRARY.sections.map((s) => s.code));
    for (const t of DEFAULT_FORM_LIBRARY.templates) {
      for (const b of t.blocks) if (b.type === 'SECTION') assert.ok(codes.has(b.sectionCode), `${t.code} → ${b.sectionCode}`);
    }
  });
});

describe('Redesign R3: placeholders and plurals', () => {
  const b = (name: string, pluralName: string | null = null) => ({ name, pluralName, archetype: 'BUILDING_WORKS' as const });
  it('pluralises facility names', () => {
    assert.equal(facilityNoun(b('Toilet'), 3), 'toilets');
    assert.equal(facilityNoun(b('Toilet'), 1), 'toilet');
    assert.equal(facilityNoun(b('ICT lab'), 2), 'ICT labs');
    assert.equal(facilityNoun(b('Library'), 2), 'libraries');
    assert.equal(facilityNoun(b('Football pitch'), 2), 'football pitches');
    assert.equal(facilityNoun(b('Staff quarters', 'Staff quarters'), 2), 'staff quarters');
    assert.equal(facilityNoun({ name: "Pupils' furniture", archetype: 'SUPPLY_INSTALLATION' }, 3), "pupils' furniture");
  });

  it('renders every placeholder', () => {
    const units = [
      { label: 'Ground floor male toilet', plannedQuantity: null, quantityUnit: null },
      { label: 'Ground floor female toilet', plannedQuantity: null, quantityUnit: null },
      { label: "Teachers' lounge female toilet", plannedQuantity: null, quantityUnit: null },
    ];
    assert.equal(renderPlaceholders('Are all {count} {facility} roofed?', { facility: b('Toilet'), units }), 'Are all 3 toilets roofed?');
    assert.equal(renderPlaceholders('{facility} installed', { facility: b('Borehole'), units: units.slice(0, 1) }), 'Borehole installed');
    assert.equal(
      renderPlaceholders('Units: {units}', { facility: b('Toilet'), units: units.slice(0, 2) }),
      'Units: Ground floor male toilet, Ground floor female toilet'
    );
    const supply = { name: 'Desk', archetype: 'SUPPLY_INSTALLATION' as const };
    const qty = [
      { label: 'A', plannedQuantity: 80, quantityUnit: 'nr' },
      { label: 'B', plannedQuantity: 40, quantityUnit: 'nr' },
    ];
    assert.equal(renderPlaceholders('{plannedQty} {uom} planned', { facility: supply, units: qty }), '120 nr planned');
  });

  it('lists mixed quantity units instead of summing them', () => {
    const r = plannedQuantityOf([
      { label: 'Desks', plannedQuantity: 120, quantityUnit: 'nr' },
      { label: 'Chairs', plannedQuantity: 40, quantityUnit: 'set' },
    ]);
    assert.equal(r.total, null);
    assert.equal(r.uom, '');
    assert.equal(r.text, '120 nr, 40 set');
  });
});

describe('Redesign R3: validateFormFields', () => {
  const codes = (fields: FormFieldInput[], context: 'SECTION' | 'SUBFORM', previousKeyTypes?: Record<string, FormField['type']>) =>
    validateFormFields(fields.map(field), { context, previousKeyTypes }).map((i) => i.code);

  it('allows placeholders only in sub-forms, and only known ones', () => {
    assert.deepEqual(codes([{ key: 'a', label: 'All {count} done?', type: 'YES_NO' }], 'SECTION'), ['PLACEHOLDER_NOT_ALLOWED']);
    assert.deepEqual(codes([{ key: 'a', label: 'All {total} done?', type: 'YES_NO' }], 'SUBFORM'), ['UNKNOWN_PLACEHOLDER']);
    assert.deepEqual(codes([{ key: 'a', label: 'All {count} {facility} done?', type: 'YES_NO' }], 'SUBFORM'), []);
  });

  it('enforces the scope / photo-mode matrix', () => {
    assert.deepEqual(codes([{ key: 'a', label: 'Progress', type: 'PERCENTAGE', scope: 'PER_UNIT' }], 'SECTION'), ['SCOPE_NOT_ALLOWED']);
    assert.deepEqual(codes([{ key: 'a', label: 'Photos', type: 'PHOTO', photo: { mode: 'ONE_PER_UNIT' } }], 'SECTION'), ['PHOTO_MODE_NOT_ALLOWED']);
    assert.deepEqual(codes([{ key: 'a', label: 'Photos', type: 'PHOTO', photo: { mode: 'ONE_PER_UNIT' } }], 'SUBFORM'), []);
    assert.deepEqual(codes([{ key: 'a', label: 'Photos', type: 'PHOTO', scope: 'PER_UNIT', photo: { mode: 'ONE_PER_UNIT' } }], 'SUBFORM'), ['PHOTO_MODE_NOT_ALLOWED']);
    assert.deepEqual(codes([{ key: 'a', label: 'Count', type: 'NUMBER', boundedByPlannedQuantity: true }], 'SECTION'), ['BOUND_NOT_ALLOWED']);
  });

  it('checks rules and signals against the type and context', () => {
    assert.deepEqual(codes([{ key: 'a', label: 'Fenced', type: 'YES_NO', rules: [{ when: { atMost: 2 }, then: 'REQUIRE_COMMENT' }] }], 'SECTION'), [
      'RULE_CONDITION_INVALID',
    ]);
    assert.deepEqual(codes([{ key: 'a', label: 'Fenced', type: 'YES_NO', rules: [{ when: { equals: 'NA' }, then: 'REQUIRE_COMMENT' }] }], 'SECTION'), [
      'RULE_CONDITION_INVALID',
    ]);
    assert.deepEqual(codes([{ key: 'a', label: 'Qty', type: 'NUMBER', rules: [{ when: { atLeast: 'PLANNED' }, then: 'REQUIRE_PHOTO' }] }], 'SUBFORM'), [
      'RULE_CONDITION_INVALID',
    ]);
    assert.deepEqual(codes([{ key: 'a', label: 'On site', type: 'YES_NO', signal: { kind: 'CONTRACTOR_ON_SITE', when: { equals: 'YES' } } }], 'SUBFORM'), [
      'SIGNAL_CONTEXT',
    ]);
    assert.deepEqual(codes([{ key: 'a', label: 'Done', type: 'YES_NO', signal: { kind: 'UNIT_COMPLETE' } }], 'SUBFORM'), ['SIGNAL_CONDITION_REQUIRED']);
  });

  it('refuses a key that changes type across versions', () => {
    assert.deepEqual(codes([{ key: 'stage', label: 'Stage', type: 'SHORT_TEXT' }], 'SUBFORM', { stage: 'SINGLE_CHOICE' }), ['FIELD_KEY_TYPE_CHANGED']);
    assert.deepEqual(codes([{ key: 'stage', label: 'Stage', type: 'SHORT_TEXT' }], 'SUBFORM', { stage: 'SHORT_TEXT' }), []);
  });
});

describe('Redesign R3: sprintForDate', () => {
  const sprints = [
    { startDate: '2026-01-01', endDate: '2026-01-31', n: 1 },
    { startDate: '2026-03-10', endDate: '2026-04-10', n: 3 },
    { startDate: '2026-02-01', endDate: '2026-02-28', n: 2 },
  ];
  it('covers inside, gap, after the last and before the first', () => {
    assert.equal(sprintForDate(sprints, '2026-02-15')?.n, 2);
    assert.equal(sprintForDate(sprints, '2026-03-05')?.n, 2, 'gap: the latest sprint that started');
    assert.equal(sprintForDate(sprints, '2026-06-01')?.n, 3, 'after the last');
    assert.equal(sprintForDate(sprints, '2025-12-31'), null, 'before sprint 1');
    assert.equal(sprintForDate([], '2026-01-01'), null);
  });
});

describe('Redesign R3: assembleVisitForm', () => {
  it('Mobilisation and Post-closure have no facility blocks', () => {
    const fx = fixture();
    for (const kind of ['MOBILISATION_CHECK', 'POST_CLOSURE_EVALUATION'] as const) {
      const { snapshot } = build(fx, kind, '2026-02-10');
      assert.equal(facilityBlocks(snapshot).length, 0, kind);
      assert.ok(snapshot.blocks.length > 0);
    }
  });

  it('Baseline and Final include every unit, legacy units too', () => {
    const fx = fixture();
    for (const kind of ['BASELINE', 'FINAL_EVALUATION'] as const) {
      const { snapshot } = build(fx, kind, '2026-02-10');
      assert.deepEqual(unitIdsOf(snapshot).sort(), ['U01', 'U02', 'U03', 'U04', 'U05', 'U06'], kind);
    }
  });

  it('Baseline warns about a sub-form without questions for the kind (supply)', () => {
    const fx = fixture();
    const { snapshot, warnings } = build(fx, 'BASELINE', '2026-02-10');
    const supply = facilityBlocks(snapshot).find((b) => b.facility?.code === 'PUPILS_FURNITURE')!;
    assert.equal(supply.fields.length, 0);
    assert.equal(supply.units.length, 1);
    assert.ok(warnings.some((w) => w.code === 'SUBFORM_EMPTY_FOR_KIND' && w.facilityId === fx.ids['facility:PUPILS_FURNITURE']));
  });

  it('Routine takes the sprint units plus earlier units not reported complete; Quarterly the same', () => {
    const fx = fixture();
    const routine = build(fx, 'ROUTINE', '2026-02-10').snapshot;
    assert.equal(routine.context.sprint?.number, 2);
    assert.deepEqual(unitIdsOf(routine), ['U01', 'U02', 'U03', 'U05'], 'toilets active in sprint 2, borehole carried over from sprint 1');
    assert.deepEqual(unitIdsOf(build(fx, 'QUARTERLY_ME', '2026-02-10').snapshot), unitIdsOf(routine));
    const done = build(fx, 'ROUTINE', '2026-02-10', { completedUnitIds: [fx.ids['unit:U05']] }).snapshot;
    assert.deepEqual(unitIdsOf(done), ['U01', 'U02', 'U03']);
  });

  it('Routine before sprint 1 warns and includes no facilities', () => {
    const fx = fixture();
    const { snapshot, warnings } = build(fx, 'ROUTINE', '2025-12-01');
    assert.equal(snapshot.context.sprint, null);
    assert.equal(facilityBlocks(snapshot).length, 0);
    assert.ok(warnings.some((w) => w.code === 'NO_SPRINT_FOR_DATE'));
    assert.ok(warnings.some((w) => w.code === 'NO_FACILITIES_IN_SCOPE'));
  });

  it('Ad hoc takes the picked facilities only', () => {
    const fx = fixture();
    const { snapshot } = build(fx, 'AD_HOC', '2026-02-10', { pickedFacilityIds: [fx.ids['facility:BOREHOLE']] });
    assert.deepEqual(unitIdsOf(snapshot), ['U05']);
  });

  it('groups by facility sortOrder then unit sortOrder, with the visit-kind filter and rendered placeholders', () => {
    const fx = fixture();
    const { snapshot } = build(fx, 'ROUTINE', '2026-02-10');
    const blocks = facilityBlocks(snapshot);
    assert.deepEqual(
      blocks.map((b) => b.facility?.code),
      ['TOILET', 'BOREHOLE']
    );
    const toilet = blocks[0];
    assert.deepEqual(
      toilet.units.map((u) => u.code),
      ['U01', 'U02', 'U03']
    );
    const keys = toilet.fields.map((f) => f.key);
    assert.ok(!keys.includes('existing-condition'), 'baseline-only field filtered out');
    assert.ok(!keys.includes('delivered-as-specified'), 'final-only field filtered out');
    const workmanship = toilet.fields.find((f) => f.key === 'workmanship-ok')!;
    assert.equal(workmanship.label, 'Workmanship acceptable (3 toilets)');
    assert.equal(workmanship.labelTemplate, 'Workmanship acceptable ({count} {facility})');
    assert.equal(workmanship.path, 'f:TOILET/workmanship-ok');
    const photos = toilet.fields.find((f) => f.key === 'progress-photos')!;
    assert.equal(photos.photo?.mode, 'ONE_PER_UNIT');
    assert.deepEqual(
      photos.photo?.slots.map((s) => s.label),
      ['Ground floor male toilet', 'Ground floor female toilet', "Teachers' lounge female toilet"]
    );
    // Sections around the facility slot keep the template order.
    assert.deepEqual(
      snapshot.blocks.map((b) => b.key),
      ['s:PROGRESS', 'f:TOILET', 'f:BOREHOLE', 's:WORKMANSHIP', 's:MATERIALS', 's:HEALTH_SAFETY', 's:ENVIRONMENT']
    );
    assert.ok(VisitFormSnapshotSchema.safeParse(snapshot).success);
  });

  it('repeats per-unit fields per unit with unit paths', () => {
    const fx = fixture({
      toiletFields: [
        { key: 'percent', label: '% complete of {units}', type: 'PERCENTAGE', scope: 'PER_UNIT' },
        { key: 'plumbing', label: 'Plumbing connected', type: 'YES_NO', scope: 'PER_UNIT', rules: [{ when: { equals: 'YES' }, then: 'REQUIRE_PHOTO' }] },
      ],
    });
    const toilet = facilityBlocks(build(fx, 'ROUTINE', '2026-02-10').snapshot)[0];
    assert.equal(toilet.fields.length, 6);
    const u1 = fx.ids['unit:U01'];
    const first = toilet.fields[0];
    assert.equal(first.path, `f:TOILET/percent@${u1}`);
    assert.equal(first.unitId, u1);
    assert.equal(first.label, '% complete of Ground floor male toilet');
  });

  it('shows the planned quantity on bounded supply fields', () => {
    const fx = fixture();
    const supply = facilityBlocks(build(fx, 'FINAL_EVALUATION', '2026-04-01').snapshot).find((b) => b.facility?.code === 'PUPILS_FURNITURE')!;
    const qty = supply.fields.find((f) => f.key === 'quantity-delivered')!;
    assert.equal(qty.label, "Quantity of pupils' furniture delivered (of 120 nr)");
    assert.equal(qty.plannedQuantity, 120);
  });

  it('appends re-checks after the last block', () => {
    const fx = fixture();
    const recheck = { id: uuid(), kind: 'FINDING' as const, title: 'Cracked lintel', description: null, severity: 'MAJOR' as const, raisedDate: '2026-01-20', facilityId: null, unitId: null };
    const { snapshot } = build(fx, 'ROUTINE', '2026-02-10', { rechecks: [recheck] });
    const last = snapshot.blocks[snapshot.blocks.length - 1];
    assert.equal(last.kind, 'RECHECK');
    assert.equal(last.fields[0].path, `r:${recheck.id}`);
    assert.equal(last.fields[0].label, 'Follow-up check: Cracked lintel. Rectified?');
  });

  it('refuses a form larger than the cap', () => {
    const many: FormFieldInput[] = Array.from({ length: 40 }, (_, i) => ({ key: `q${i}`, label: `Question ${i}`, type: 'YES_NO', scope: 'PER_UNIT' }));
    const fx = fixture({ toiletFields: many });
    const toiletId = fx.ids['facility:TOILET'];
    fx.bundle.units.push(
      ...Array.from({ length: 15 }, (_, i) => ({
        id: uuid(),
        code: `X${i}`,
        label: `Extra toilet ${i}`,
        facilityId: toiletId,
        plannedQuantity: null,
        quantityUnit: null,
        startSprintNumber: 1,
        endSprintNumber: 3,
        sortOrder: 100 + i,
      }))
    );
    assert.throws(() => build(fx, 'ROUTINE', '2026-02-10'), (e: unknown) => e instanceof VisitFormAssemblyError && e.code === 'FORM_TOO_LARGE');
  });

  it('is deterministic; builtAt is left out of the canonical form', () => {
    const fx = fixture();
    const a = build(fx, 'ROUTINE', '2026-02-10').snapshot;
    const b = build(fx, 'ROUTINE', '2026-02-10', { builtAt: '2030-01-01T00:00:00.000Z' }).snapshot;
    assert.notEqual(a.builtAt, b.builtAt);
    assert.equal(canonicalVisitFormSnapshot(a), canonicalVisitFormSnapshot(b));
    // Key order does not matter (jsonb reorders keys).
    const reverseKeys = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(reverseKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)])) : v;
    assert.equal(canonicalVisitFormSnapshot(reverseKeys(a) as VisitFormSnapshot), canonicalVisitFormSnapshot(a));
    assert.notEqual(canonicalVisitFormSnapshot(build(fx, 'ROUTINE', '2026-02-11').snapshot), canonicalVisitFormSnapshot(a));
  });

  it('refuses a template of another kind', () => {
    const fx = fixture();
    const input = assemblyInputFromBundle(fx.bundle, { visitKind: 'ROUTINE', visitDate: '2026-02-10', builtAt: 'x' });
    assert.throws(() => assembleVisitForm({ ...input, visitKind: 'BASELINE' }), (e: unknown) => e instanceof VisitFormAssemblyError && e.code === 'TEMPLATE_KIND_MISMATCH');
  });
});

describe('Redesign R3: validateVisitAnswers', () => {
  const fx = fixture();
  const recheckId = uuid();
  const { snapshot } = build(fx, 'ROUTINE', '2026-02-10', {
    rechecks: [{ id: recheckId, kind: 'FINDING', title: 'Cracked lintel', description: null, severity: 'MAJOR', raisedDate: '2026-01-20', facilityId: null, unitId: null }],
  });
  const u = (k: string) => fx.ids[`unit:${k}`];
  const photo = (unitId: string | null = null) => ({ clientCaptureId: uuid(), unitId, kind: 'PHOTO' as const });

  /** A complete, valid set of answers for the Routine snapshot. */
  function goodAnswers(): VisitFormAnswerInput[] {
    return [
      { path: 's:PROGRESS/on-programme', value: 4 },
      { path: 's:PROGRESS/overall-completion', value: 45 },
      { path: 's:PROGRESS/progress-photos', captures: [photo(), photo()] },
      { path: 'f:TOILET/stage', value: 'roofing' },
      { path: 'f:TOILET/percent-complete', value: 60 },
      { path: 'f:TOILET/workmanship-ok', value: 'YES' },
      { path: 'f:TOILET/progress-photos', captures: [photo(u('U01')), photo(u('U02')), photo(u('U03'))] },
      { path: 'f:BOREHOLE/installed', value: 'YES' },
      { path: 'f:BOREHOLE/functional', value: 'YES' },
      { path: 'f:BOREHOLE/utility-photo', captures: [photo()] },
      { path: 's:WORKMANSHIP/workmanship', value: 4 },
      { path: 's:MATERIALS/materials-to-spec', value: 'YES' },
      { path: 's:MATERIALS/test-certificates', value: 'NA' },
      { path: 's:HEALTH_SAFETY/ppe-worn', value: 'YES' },
      { path: 's:HEALTH_SAFETY/site-fenced', value: 'YES' },
      { path: 's:HEALTH_SAFETY/incidents', value: 'NO' },
      { path: 's:ENVIRONMENT/waste-managed', value: 'YES' },
      { path: 's:ENVIRONMENT/erosion-controlled', value: 'YES' },
      { path: `r:${recheckId}`, value: 'YES', captures: [photo()] },
    ];
  }
  const replace = (answers: VisitFormAnswerInput[], path: string, patch: Partial<VisitFormAnswerInput>) =>
    answers.map((a) => (a.path === path ? { ...a, ...patch } : a));

  it('accepts a complete form and reports signals and re-check results', () => {
    const r = validateVisitAnswers(snapshot, goodAnswers());
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.photoGaps, []);
    assert.equal(r.valid, true);
    assert.deepEqual(r.findingsToRaise, []);
    assert.deepEqual(r.signals.unitComplete, [u('U05')], 'borehole functional → complete');
    assert.deepEqual(r.signals.percentComplete.map((p) => [p.value, p.unitIds.length]), [[60, 3]]);
    assert.deepEqual(r.recheckResults, [{ recheckId, resolved: true }]);
  });

  it('refuses unknown and repeated paths, missing required values and bad values', () => {
    const answers = goodAnswers().filter((a) => a.path !== 's:HEALTH_SAFETY/site-fenced');
    answers.push({ path: 's:NOPE/x', value: 1 }, { path: 's:PROGRESS/on-programme', value: 3 });
    const r = validateVisitAnswers(snapshot, replace(answers, 's:MATERIALS/materials-to-spec', { value: 'MAYBE' }));
    const codes = r.errors.map((e) => `${e.code}:${e.path}`).sort();
    assert.deepEqual(codes, [
      'DUPLICATE_PATH:s:PROGRESS/on-programme',
      'INVALID_VALUE:s:MATERIALS/materials-to-spec',
      'REQUIRED:s:HEALTH_SAFETY/site-fenced',
      'UNKNOWN_PATH:s:NOPE/x',
    ]);
    assert.equal(r.valid, false);
    // N/A only where allowed.
    const na = validateVisitAnswers(snapshot, replace(goodAnswers(), 's:HEALTH_SAFETY/ppe-worn', { value: 'NA' }));
    assert.deepEqual(na.errors.map((e) => e.code), ['INVALID_VALUE']);
    // Options and ranges.
    assert.deepEqual(validateVisitAnswers(snapshot, replace(goodAnswers(), 'f:TOILET/stage', { value: 'painting' })).errors.map((e) => e.code), ['INVALID_VALUE']);
    assert.deepEqual(validateVisitAnswers(snapshot, replace(goodAnswers(), 's:PROGRESS/on-programme', { value: 6 })).errors.map((e) => e.code), ['INVALID_VALUE']);
    assert.deepEqual(validateVisitAnswers(snapshot, replace(goodAnswers(), 'f:TOILET/percent-complete', { value: 101 })).errors.map((e) => e.code), ['INVALID_VALUE']);
  });

  it('applies conditional rules: comment errors, photo gaps and findings', () => {
    const answers = replace(goodAnswers(), 'f:TOILET/workmanship-ok', { value: 'NO' });
    const r = validateVisitAnswers(snapshot, answers);
    assert.deepEqual(r.errors.map((e) => e.code), ['COMMENT_REQUIRED']);
    assert.deepEqual(r.photoGaps.map((g) => g.code), ['PHOTO_REQUIRED_BY_RULE']);
    assert.equal(r.findingsToRaise.length, 1);
    const f = r.findingsToRaise[0];
    assert.equal(f.severity, 'MAJOR');
    assert.equal(f.facilityId, fx.ids['facility:TOILET']);
    assert.equal(f.unitId, null);
    assert.equal(f.answerText, 'No');
    const fixed = validateVisitAnswers(snapshot, replace(answers, 'f:TOILET/workmanship-ok', { value: 'NO', comment: 'Plaster cracking', captures: [photo()] }));
    assert.equal(fixed.valid, true);
    assert.deepEqual(fixed.photoGaps, []);
    // Ratings at or below 2 raise a finding and need a comment.
    const low = validateVisitAnswers(snapshot, replace(goodAnswers(), 's:PROGRESS/on-programme', { value: 2 }));
    assert.deepEqual(low.errors.map((e) => e.code), ['COMMENT_REQUIRED']);
    assert.deepEqual(low.findingsToRaise.map((x) => [x.sectionCode, x.severity]), [['PROGRESS', 'MINOR']]);
  });

  it('reports a missing one-per-unit photo per unit, geotag and boundary facts as photo gaps', () => {
    const missing = replace(goodAnswers(), 'f:TOILET/progress-photos', { captures: [photo(u('U01'))] });
    const r = validateVisitAnswers(snapshot, missing);
    assert.equal(r.valid, true, 'photo gaps are not errors');
    assert.deepEqual(
      r.photoGaps.map((g) => [g.code, g.unitId]),
      [
        ['UNIT_PHOTO_MISSING', u('U02')],
        ['UNIT_PHOTO_MISSING', u('U03')],
      ]
    );
    const wrongUnit = validateVisitAnswers(snapshot, replace(goodAnswers(), 'f:TOILET/progress-photos', { captures: [photo(u('U05'))] }));
    assert.ok(wrongUnit.errors.some((e) => e.code === 'UNKNOWN_UNIT'));
    const p1 = photo();
    const p2 = photo();
    const facts = validateVisitAnswers(snapshot, replace(goodAnswers(), 's:PROGRESS/progress-photos', { captures: [p1, p2] }), [
      { clientCaptureId: p1.clientCaptureId, geotagged: false, insideBoundary: null },
      { clientCaptureId: p2.clientCaptureId, geotagged: true, insideBoundary: false },
    ]);
    assert.deepEqual(facts.photoGaps.map((g) => g.code).sort(), ['PHOTO_NOT_GEOTAGGED', 'PHOTO_OUTSIDE_BOUNDARY']);
    const fewer = validateVisitAnswers(snapshot, replace(goodAnswers(), 's:PROGRESS/progress-photos', { captures: [photo()] }));
    assert.deepEqual(fewer.photoGaps.map((g) => g.code), ['PHOTO_MISSING']);
  });

  it('whole-facility UNIT_COMPLETE covers every unit of the block', () => {
    const r = validateVisitAnswers(snapshot, replace(goodAnswers(), 'f:TOILET/stage', { value: 'complete' }));
    assert.deepEqual(r.signals.unitComplete.sort(), [u('U01'), u('U02'), u('U03'), u('U05')].sort());
  });

  it('re-check answered No needs a comment; Yes needs a photo', () => {
    const no = validateVisitAnswers(snapshot, replace(goodAnswers(), `r:${recheckId}`, { value: 'NO', captures: [] }));
    assert.deepEqual(no.errors.map((e) => e.code), ['COMMENT_REQUIRED']);
    assert.deepEqual(no.recheckResults, [{ recheckId, resolved: false }]);
    const yes = validateVisitAnswers(snapshot, replace(goodAnswers(), `r:${recheckId}`, { value: 'YES', captures: [] }));
    assert.deepEqual(yes.photoGaps.map((g) => g.code), ['PHOTO_REQUIRED_BY_RULE']);
  });

  it('refuses a delivered quantity above the planned one without a comment; at planned the unit is complete', () => {
    const final = build(fx, 'FINAL_EVALUATION', '2026-04-01').snapshot;
    const answer = (value: number, comment: string | null = null): VisitFormAnswerInput[] => [{ path: 'f:PUPILS_FURNITURE/quantity-delivered', value, comment }];
    const above = validateVisitAnswers(final, answer(130));
    assert.ok(above.errors.some((e) => e.code === 'QUANTITY_ABOVE_PLANNED'));
    const explained = validateVisitAnswers(final, answer(130, 'Ten spare desks delivered'));
    assert.ok(!explained.errors.some((e) => e.code === 'QUANTITY_ABOVE_PLANNED'));
    const exact = validateVisitAnswers(final, answer(120));
    assert.ok(exact.signals.unitComplete.includes(u('U04')));
    assert.deepEqual(exact.signals.quantityDelivered.map((q) => [q.value, q.plannedQuantity]), [[120, 120]]);
    const partial = validateVisitAnswers(final, answer(60));
    assert.ok(!partial.signals.unitComplete.includes(u('U04')));
  });

  it('reports findings per unit for per-unit fields and the contractor-on-site signal', () => {
    const fx2 = fixture({
      toiletFields: [{ key: 'plumbing', label: 'Plumbing connected', type: 'YES_NO', scope: 'PER_UNIT', rules: [{ when: { equals: 'NO' }, then: 'RAISE_FINDING', severity: 'MINOR' }] }],
    });
    const s2 = build(fx2, 'ROUTINE', '2026-02-10').snapshot;
    const u2 = fx2.ids['unit:U02'];
    const r = validateVisitAnswers(s2, [{ path: `f:TOILET/plumbing@${u2}`, value: 'NO' }]);
    assert.deepEqual(r.findingsToRaise.map((f) => [f.unitId, f.severity]), [[u2, 'MINOR']]);

    const mob = build(fx, 'MOBILISATION_CHECK', '2026-02-10').snapshot;
    const on = validateVisitAnswers(mob, [{ path: 's:MOBILISATION/contractor-on-site', value: 'YES' }]);
    assert.equal(on.signals.contractorOnSite, true);
    const off = validateVisitAnswers(mob, [{ path: 's:MOBILISATION/contractor-on-site', value: 'NO', comment: 'Gate locked' }]);
    assert.equal(off.signals.contractorOnSite, false);
  });
});
