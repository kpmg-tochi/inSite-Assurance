/**
 * Redesign R3 route tests: the form library (R3b) and visit form preview and snapshots (R3c).
 *
 * Main tenant: admin@ (platform + tenant super admin), monitor@ (forms:manage), lender@ (neither
 * forms:manage nor project_types:manage, but visits:view), lto@ (given a role with only
 * project_types:manage here). Programme tenant (UBEC): admin@ubec.test (forms:manage and
 * project types); PRG-105 (live, sprints, a customised Toilet). LKK-402 (main tenant) has sprint 1
 * units below 100% (the Routine carry-over); EDO-410 has no units (legacy).
 */
import { resetTestDatabase } from './helpers/testDb';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import {
  assembleVisitForm,
  assemblyInputFromBundle,
  canonicalVisitFormSnapshot,
  DEFAULT_FORM_LIBRARY,
  unitsActiveInSprint,
  VisitFormLibraryBundleSchema,
  VisitFormSnapshot,
  zonedCalendarDate,
} from '@insite/shared';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;

const PASSWORD = 'Password123!';
const ADMIN = 'admin@insite.ng';
const MONITOR = 'monitor@insite.ng';
const LENDER = 'lender@insite.ng';
const LTO = 'lto@insite.ng';
/** UBEC roster: the form library is managed by the UBEC administrator (M&E officers have no forms:manage). */
const P_MONITOR = 'admin@ubec.test';
const P_ADMIN = 'admin@ubec.test';
const ids: Record<string, string> = {};

const tokens: Record<string, string> = {};
async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}

const today = () => zonedCalendarDate(new Date(), 'Africa/Lagos');
const section = (code: string, fields: unknown[], title = 'Test section') => ({ code, title, fields });

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  const { createApp } = await import('../app');
  app = createApp();
  ids.tenant = (await prisma.user.findUniqueOrThrow({ where: { email: MONITOR } })).tenantId;
  ids.programme = (await prisma.user.findUniqueOrThrow({ where: { email: P_MONITOR } })).tenantId;
  ids.prg105 = (await prisma.project.findFirstOrThrow({ where: { codePrefix: 'PRG-105' } })).id;
  ids.lkk402 = (await prisma.project.findFirstOrThrow({ where: { codePrefix: 'LKK-402' } })).id;
  ids.edo410 = (await prisma.project.findFirstOrThrow({ where: { codePrefix: 'EDO-410' } })).id;
});

describe('Redesign R3b: form library provisioning', () => {
  it('every seeded tenant has the default library; the programme Toilet is customised', async () => {
    for (const t of await prisma.tenant.findMany({ select: { id: true } })) {
      assert.equal(await prisma.formSection.count({ where: { tenantId: t.id } }), DEFAULT_FORM_LIBRARY.sections.length);
      assert.equal(await prisma.facilitySubForm.count({ where: { tenantId: t.id, subject: 'ARCHETYPE' } }), 4);
      assert.equal(await prisma.visitFormTemplate.count({ where: { tenantId: t.id } }), 7);
    }
    const res = await request(app).get('/api/v1/form-library').set(await web(P_MONITOR));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const toilet = res.body.data.facilities.find((f: { code: string }) => f.code === 'TOILET');
    assert.equal(toilet.source, 'FACILITY');
    assert.equal(res.body.data.facilitySubForms.length, 1);
    const classroom = res.body.data.facilities.find((f: { code: string }) => f.code === 'CLASSROOM');
    assert.equal(classroom.source, 'ARCHETYPE');
    // 50 facilities resolve to a sub-form with one per-facility row.
    assert.equal(res.body.data.facilities.length, 50);
    assert.ok(res.body.data.facilities.every((f: { subFormId: string | null }) => f.subFormId));
  });

  it('a new tenant gets the library at creation; an emptied one gets it back on first read', async () => {
    const res = await request(app).post('/api/v1/rbac/tenants').set(await web(ADMIN)).send({ name: 'R3 Forms Tenant', slug: 'r3-forms' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const tenantId = res.body.data.id as string;
    assert.equal(await prisma.formSection.count({ where: { tenantId } }), 10);
    assert.equal(await prisma.facilitySubForm.count({ where: { tenantId } }), 4);
    assert.equal(await prisma.visitFormTemplate.count({ where: { tenantId } }), 7);
    await prisma.visitFormTemplate.deleteMany({ where: { tenantId } });
    await prisma.formSection.deleteMany({ where: { tenantId } });
    await prisma.facilitySubForm.deleteMany({ where: { tenantId } });
    const { ensureFormLibrary } = await import('../modules/forms/formLibraryProvisioning');
    await ensureFormLibrary(prisma, tenantId);
    assert.equal(await prisma.visitFormTemplate.count({ where: { tenantId } }), 7);
  });

  it('reading needs forms:manage or project_types:manage; writing needs forms:manage', async () => {
    assert.equal((await request(app).get('/api/v1/form-library').set(await web(LENDER))).status, 403);
    const role = await prisma.role.create({ data: { tenantId: ids.tenant, name: 'Type editor (R3 test)', code: 'R3_TYPE_EDITOR' } });
    const perm = await prisma.permission.findUniqueOrThrow({ where: { key: 'project_types:manage' } });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
    await prisma.user.update({ where: { email: LTO }, data: { roleId: role.id } });
    assert.equal((await request(app).get('/api/v1/form-library').set(await web(LTO))).status, 200);
    const write = await request(app)
      .post('/api/v1/form-library/sections')
      .set(await web(LTO))
      .send(section('R3_DENIED', [{ key: 'a', label: 'Question', type: 'YES_NO' }]));
    assert.equal(write.status, 403);
  });
});

describe('Redesign R3b: sections and templates', () => {
  it('creates a section, edits it in place while unused, and keeps codes immutable', async () => {
    const created = await request(app)
      .post('/api/v1/form-library/sections')
      .set(await web(MONITOR))
      .send(section('SITE_SECURITY', [{ key: 'guard', label: 'Guard on duty', type: 'YES_NO' }], 'Site security'));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.data.version, 1);
    const edited = await request(app)
      .put('/api/v1/form-library/sections/SITE_SECURITY')
      .set(await web(MONITOR))
      .send(section('SITE_SECURITY', [{ key: 'guard', label: 'Security guard on duty', type: 'YES_NO' }], 'Site security'));
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.data.version, 1, 'unused: edited in place');
    assert.equal(edited.body.data.fields[0].label, 'Security guard on duty');
    const renamed = await request(app)
      .put('/api/v1/form-library/sections/SITE_SECURITY')
      .set(await web(MONITOR))
      .send(section('SITE_SECURITY_2', [{ key: 'guard', label: 'Guard', type: 'YES_NO' }]));
    assert.equal(renamed.status, 422);
    assert.equal(renamed.body.error.code, 'FORM_CODE_LOCKED');
    const dup = await request(app)
      .post('/api/v1/form-library/sections')
      .set(await web(MONITOR))
      .send(section('SITE_SECURITY', [{ key: 'guard', label: 'Guard', type: 'YES_NO' }]));
    assert.equal(dup.status, 409);
    const retyped = await request(app)
      .put('/api/v1/form-library/sections/SITE_SECURITY')
      .set(await web(MONITOR))
      .send(section('SITE_SECURITY', [{ key: 'guard', label: 'Guards on duty', type: 'NUMBER' }]));
    assert.equal(retyped.status, 422);
    assert.equal(retyped.body.error.code, 'FIELD_KEY_TYPE_CHANGED');
    const placeholder = await request(app)
      .put('/api/v1/form-library/sections/SITE_SECURITY')
      .set(await web(MONITOR))
      .send(section('SITE_SECURITY', [{ key: 'guard', label: 'All {count} guards on duty', type: 'YES_NO' }]));
    assert.equal(placeholder.status, 400, 'placeholders only in sub-forms');
  });

  it('templates check their sections; a listed section cannot be archived', async () => {
    const unknown = await request(app)
      .post('/api/v1/form-library/templates')
      .set(await web(MONITOR))
      .send({ code: 'AD_HOC_SECURITY', name: 'Security spot check', visitKind: 'AD_HOC', blocks: [{ type: 'SECTION', sectionCode: 'NOPE' }] });
    assert.equal(unknown.status, 422);
    assert.equal(unknown.body.error.code, 'SECTION_NOT_FOUND');
    const facilitiesOnMobilisation = await request(app)
      .post('/api/v1/form-library/templates')
      .set(await web(MONITOR))
      .send({ code: 'MOB_FAC', name: 'Mobilisation with facilities', visitKind: 'MOBILISATION_CHECK', blocks: [{ type: 'FACILITIES' }] });
    assert.equal(facilitiesOnMobilisation.status, 400);
    const created = await request(app)
      .post('/api/v1/form-library/templates')
      .set(await web(MONITOR))
      .send({
        code: 'AD_HOC_SECURITY',
        name: 'Security spot check',
        visitKind: 'AD_HOC',
        blocks: [{ type: 'FACILITIES' }, { type: 'SECTION', sectionCode: 'SITE_SECURITY' }],
      });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const archive = await request(app).patch('/api/v1/form-library/sections/SITE_SECURITY').set(await web(MONITOR)).send({ archived: true });
    assert.equal(archive.status, 409);
    assert.equal(archive.body.error.code, 'SECTION_IN_USE');
    assert.equal((await request(app).patch('/api/v1/form-library/templates/AD_HOC_SECURITY').set(await web(MONITOR)).send({ archived: true })).status, 200);
    const archived = await request(app).patch('/api/v1/form-library/sections/SITE_SECURITY').set(await web(MONITOR)).send({ archived: true });
    assert.equal(archived.status, 200, JSON.stringify(archived.body));
    assert.equal(archived.body.data.isArchived, true);
    const restoreTemplate = await request(app).patch('/api/v1/form-library/templates/AD_HOC_SECURITY').set(await web(MONITOR)).send({ archived: false });
    assert.equal(restoreTemplate.status, 409, 'its section is archived');
  });

  it('records FORM_COMPONENT_SAVED audit events', async () => {
    const events = await prisma.auditLog.findMany({ where: { tenantId: ids.tenant, action: 'FORM_COMPONENT_SAVED' } });
    const modes = new Set(events.map((e) => (e.payload as { mode?: string } | null)?.mode));
    for (const m of ['created', 'edited', 'archived']) assert.ok(modes.has(m), `mode ${m}`);
  });
});

describe('Redesign R3b: facility sub-forms', () => {
  it('customise → edit → reset returns the facility to its archetype default', async () => {
    const classroom = await prisma.facility.findUniqueOrThrow({ where: { tenantId_code: { tenantId: ids.tenant, code: 'CLASSROOM' } } });
    const custom = await request(app).post(`/api/v1/form-library/subforms/facility/${classroom.id}`).set(await web(MONITOR)).send({});
    assert.equal(custom.status, 201, JSON.stringify(custom.body));
    assert.equal(custom.body.data.subject, 'FACILITY');
    assert.equal(custom.body.data.fields.length, DEFAULT_FORM_LIBRARY.archetypeSubForms.BUILDING_WORKS.length, 'a copy of the default');
    assert.equal((await request(app).post(`/api/v1/form-library/subforms/facility/${classroom.id}`).set(await web(MONITOR)).send({})).status, 409);
    const fields = [...custom.body.data.fields, { key: 'blackboard', label: 'Blackboard fitted in all {count} {facility}', type: 'YES_NO' }];
    const saved = await request(app).put(`/api/v1/form-library/subforms/facility/${classroom.id}`).set(await web(MONITOR)).send({ fields });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const changedType = await request(app)
      .put(`/api/v1/form-library/subforms/facility/${classroom.id}`)
      .set(await web(MONITOR))
      .send({ fields: [{ key: 'stage', label: 'Stage reached', type: 'SHORT_TEXT' }] });
    assert.equal(changedType.status, 422, 'the archetype default made "stage" a choice');
    let lib = await request(app).get('/api/v1/form-library').set(await web(MONITOR));
    assert.equal(lib.body.data.facilities.find((f: { code: string }) => f.code === 'CLASSROOM').source, 'FACILITY');
    const facilities = await request(app).get('/api/v1/facilities').set(await web(MONITOR));
    assert.deepEqual(facilities.body.data.find((f: { code: string }) => f.code === 'CLASSROOM').subForm, { source: 'FACILITY', version: 1 });
    const reset = await request(app).post(`/api/v1/form-library/subforms/facility/${classroom.id}/reset`).set(await web(MONITOR));
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    assert.equal(reset.body.data.source, 'ARCHETYPE');
    lib = await request(app).get('/api/v1/form-library').set(await web(MONITOR));
    const building = lib.body.data.archetypeSubForms.find((s: { archetype: string }) => s.archetype === 'BUILDING_WORKS');
    assert.equal(lib.body.data.facilities.find((f: { code: string }) => f.code === 'CLASSROOM').subFormId, building.id);
    assert.equal((await request(app).put(`/api/v1/form-library/subforms/facility/${classroom.id}`).set(await web(MONITOR)).send({ fields })).status, 404);
  });

  it("refuses another tenant's facility", async () => {
    const toilet = await prisma.facility.findUniqueOrThrow({ where: { tenantId_code: { tenantId: ids.programme, code: 'TOILET' } } });
    assert.equal((await request(app).post(`/api/v1/form-library/subforms/facility/${toilet.id}`).set(await web(MONITOR)).send({})).status, 404);
    assert.equal((await request(app).post('/api/v1/form-library/subforms/facility/not-a-uuid').set(await web(MONITOR)).send({})).status, 404);
  });

  it('a re-archetyped facility follows the new default; pluralName round-trips', async () => {
    const fence = await prisma.facility.findUniqueOrThrow({ where: { tenantId_code: { tenantId: ids.tenant, code: 'GATE_HOUSE' } } });
    const patched = await request(app).patch(`/api/v1/facilities/${fence.id}`).set(await web(MONITOR)).send({ archetype: 'EXTERNAL_WORKS', pluralName: 'Gatehouses' });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
    assert.equal(patched.body.data.pluralName, 'Gatehouses');
    const lib = await request(app).get('/api/v1/form-library').set(await web(MONITOR));
    const external = lib.body.data.archetypeSubForms.find((s: { archetype: string }) => s.archetype === 'EXTERNAL_WORKS');
    assert.equal(lib.body.data.facilities.find((f: { code: string }) => f.code === 'GATE_HOUSE').subFormId, external.id);
    const cleared = await request(app).patch(`/api/v1/facilities/${fence.id}`).set(await web(MONITOR)).send({ archetype: 'BUILDING_WORKS', pluralName: '' });
    assert.equal(cleared.body.data.pluralName, null);
  });
});

describe('Redesign R3b: project type visitForms', () => {
  it('round-trips visitForms and refuses unknown or wrong-kind templates', async () => {
    const list = await request(app).get('/api/v1/project-types').set(await web(P_ADMIN));
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const type = list.body.data.find((t: { code: string }) => t.code === 'CENTRAL') ?? list.body.data[0];
    const full = await request(app).get(`/api/v1/project-types/${type.id}`).set(await web(P_ADMIN));
    assert.equal(full.body.data.config.visitForms.templateCodeByVisitKind.ROUTINE, 'ROUTINE');
    const body = (routine: string) => ({
      code: full.body.data.code,
      name: full.body.data.name,
      description: full.body.data.description,
      colour: full.body.data.colour,
      workflowTemplateId: full.body.data.workflowTemplateId,
      isDefault: full.body.data.isDefault,
      isActive: full.body.data.isActive,
      config: { ...full.body.data.config, visitForms: { templateCodeByVisitKind: { ...full.body.data.config.visitForms.templateCodeByVisitKind, ROUTINE: routine } } },
    });
    const missing = await request(app).put(`/api/v1/project-types/${type.id}`).set(await web(P_ADMIN)).send(body('NOPE'));
    assert.equal(missing.status, 422);
    assert.equal(missing.body.error.code, 'VISIT_FORM_TEMPLATE_NOT_FOUND');
    const wrongKind = await request(app).put(`/api/v1/project-types/${type.id}`).set(await web(P_ADMIN)).send(body('BASELINE'));
    assert.equal(wrongKind.status, 422);
    assert.equal(wrongKind.body.error.code, 'TEMPLATE_KIND_MISMATCH');
    const ok = await request(app).put(`/api/v1/project-types/${type.id}`).set(await web(P_ADMIN)).send(body('ROUTINE'));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.data.config.visitForms.templateCodeByVisitKind.ROUTINE, 'ROUTINE');
  });
});

describe('Redesign R3c: visit form preview and snapshots', () => {
  const preview = async (email: string, projectId: string, body: Record<string, unknown>) =>
    request(app).post(`/api/v1/projects/${projectId}/visit-form/preview`).set(await web(email)).send(body);
  const facilityBlocks = (s: VisitFormSnapshot) => s.blocks.filter((b) => b.kind === 'FACILITY');

  it('builds every kind for PRG-105 with the sprint units, per-unit fields and the customised Toilet', async () => {
    const units = await prisma.facilityUnit.findMany({
      where: { projectId: ids.prg105 },
      include: { startSprint: true, endSprint: true, facility: true },
    });
    const sprint = await prisma.projectSprint.findFirstOrThrow({ where: { projectId: ids.prg105, startDate: { lte: today() }, endDate: { gte: today() } } });
    const expected = unitsActiveInSprint(
      units.map((u) => ({ id: u.id, startSprintNumber: u.startSprint?.number ?? null, endSprintNumber: u.endSprint?.number ?? null })),
      sprint.number
    )
      .map((u) => u.id)
      .sort();
    const routine = await preview(P_MONITOR, ids.prg105, { visitKind: 'ROUTINE', visitDate: today() });
    assert.equal(routine.status, 200, JSON.stringify(routine.body));
    const snap = routine.body.data.snapshot as VisitFormSnapshot;
    assert.equal(snap.context.sprint?.number, sprint.number);
    assert.deepEqual(facilityBlocks(snap).flatMap((b) => b.units.map((u) => u.id)).sort(), expected);
    const toiletUnit = units.find((u) => u.facility.code === 'TOILET')!;
    const toilet = facilityBlocks(snap).find((b) => b.facility?.code === 'TOILET')!;
    assert.ok(toilet.fields.some((f) => f.path === `f:TOILET/plumbing-connected@${toiletUnit.id}`), 'customised per-unit field');
    const photos = toilet.fields.find((f) => f.key === 'progress-photos')!;
    assert.deepEqual(photos.photo?.slots.map((s) => s.unitId), [toiletUnit.id]);
    assert.match(routine.body.data.contentSha256, /^[0-9a-f]{64}$/);

    for (const kind of ['MOBILISATION_CHECK', 'POST_CLOSURE_EVALUATION']) {
      const r = await preview(P_MONITOR, ids.prg105, { visitKind: kind, visitDate: today() });
      assert.equal(r.status, 200, kind);
      assert.equal(facilityBlocks(r.body.data.snapshot).length, 0, kind);
    }
    for (const kind of ['BASELINE', 'FINAL_EVALUATION']) {
      const r = await preview(P_MONITOR, ids.prg105, { visitKind: kind, visitDate: today() });
      assert.equal(facilityBlocks(r.body.data.snapshot).flatMap((b: { units: unknown[] }) => b.units).length, units.length, kind);
    }
    const quarterly = await preview(P_MONITOR, ids.prg105, { visitKind: 'QUARTERLY_ME', visitDate: today() });
    assert.ok(quarterly.body.data.snapshot.blocks.some((b: { key: string }) => b.key === 's:VALUATION_ESTIMATE'));
    const adHoc = await preview(P_MONITOR, ids.prg105, { visitKind: 'AD_HOC', visitDate: today(), pickedFacilityIds: [toiletUnit.facilityId] });
    assert.deepEqual(facilityBlocks(adHoc.body.data.snapshot).map((b) => b.facility?.code), ['TOILET']);
    const borehole = await prisma.facility.findUniqueOrThrow({ where: { tenantId_code: { tenantId: ids.programme, code: 'BOREHOLE' } } });
    const outside = await preview(P_MONITOR, ids.prg105, { visitKind: 'AD_HOC', visitDate: today(), pickedFacilityIds: [borehole.id] });
    assert.equal(outside.status, 422);
    assert.equal(outside.body.error.code, 'FACILITY_NOT_IN_SCOPE');
    // R4: the seed published visits (their snapshots are the only ones stored).
    assert.equal(await prisma.visitFormSnapshot.count(), await prisma.visit.count({ where: { formSnapshotId: { not: null } } }), 'a preview stores nothing');
  });

  it('Routine carries over earlier-sprint units below 100% (LKK-402)', async () => {
    const r = await preview(MONITOR, ids.lkk402, { visitKind: 'ROUTINE', visitDate: today() });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const codes = facilityBlocks(r.body.data.snapshot).flatMap((b) => b.units.map((u) => u.code)).sort();
    assert.deepEqual(codes, ['U01', 'U02', 'U03', 'U04']);
    assert.equal(r.body.data.snapshot.context.sprint.number, 2);
  });

  it('a legacy project without units gets the fixed sections and a warning', async () => {
    const routine = await preview(MONITOR, ids.edo410, { visitKind: 'ROUTINE', visitDate: today() });
    assert.equal(routine.status, 200, JSON.stringify(routine.body));
    assert.equal(facilityBlocks(routine.body.data.snapshot).length, 0);
    assert.ok(routine.body.data.warnings.some((w: { code: string }) => w.code === 'NO_SPRINT_FOR_DATE'));
    const final = await preview(MONITOR, ids.edo410, { visitKind: 'FINAL_EVALUATION', visitDate: today() });
    assert.ok(final.body.data.warnings.some((w: { code: string }) => w.code === 'NO_FACILITIES_IN_SCOPE'));
  });

  it("refuses another tenant's project and callers without the permission", async () => {
    assert.equal((await preview(MONITOR, ids.prg105, { visitKind: 'ROUTINE', visitDate: today() })).status, 404);
    // lender@ has visits:view: allowed.
    assert.equal((await preview(LENDER, ids.lkk402, { visitKind: 'ROUTINE', visitDate: today() })).status, 200);
  });

  it('a stored snapshot marks its versions used: the next save versions them and the snapshot never changes', async () => {
    const { freezeVisitFormSnapshot, hashVisitFormSnapshot } = await import('../modules/forms/visitForm.service');
    // R4: seeded published visits already use some versions; count the ones this test adds.
    const seededRoutine = await prisma.visitFormSnapshot.count({ where: { visitKind: { in: ['ROUTINE', 'QUARTERLY_ME'] } } }); // the templates that list PROGRESS
    const frozen = await prisma.$transaction((tx) => freezeVisitFormSnapshot(tx, { projectId: ids.prg105, visitKind: 'ROUTINE', visitDate: today() }));
    const row = await prisma.visitFormSnapshot.findUniqueOrThrow({ where: { id: frozen.id } });
    assert.equal(row.contentSha256, hashVisitFormSnapshot(frozen.snapshot));
    assert.ok(row.sectionIds.length > 0 && row.subFormIds.length > 0);

    const lib = await request(app).get('/api/v1/form-library').set(await web(P_MONITOR));
    const progress = lib.body.data.sections.find((s: { code: string }) => s.code === 'PROGRESS');
    assert.equal(progress.usageCount, 1 + seededRoutine);
    const saved = await request(app)
      .put('/api/v1/form-library/sections/PROGRESS')
      .set(await web(P_MONITOR))
      .send({ code: 'PROGRESS', title: progress.title, description: progress.description, fields: [...progress.fields, { key: 'night-work', label: 'Night work seen', type: 'YES_NO', required: false }] });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.data.version, 2, 'used: versioned');
    const versions = await request(app).get('/api/v1/form-library/sections/PROGRESS/versions').set(await web(P_MONITOR));
    assert.deepEqual(versions.body.data.map((v: { version: number; usageCount: number }) => [v.version, v.usageCount]), [
      [2, 0],
      [1, 1 + seededRoutine],
    ]);
    const routineTpl = lib.body.data.templates.find((t: { code: string }) => t.code === 'ROUTINE');
    const tplSaved = await request(app)
      .put('/api/v1/form-library/templates/ROUTINE')
      .set(await web(P_MONITOR))
      .send({ code: 'ROUTINE', name: 'Routine visit (v2)', visitKind: 'ROUTINE', blocks: routineTpl.blocks });
    assert.equal(tplSaved.body.data.version, 2);
    const toiletKey = lib.body.data.facilitySubForms[0].subjectKey as string;
    const toiletId = toiletKey.split(':')[1];
    const sub = await request(app)
      .put(`/api/v1/form-library/subforms/facility/${toiletId}`)
      .set(await web(P_MONITOR))
      .send({ fields: lib.body.data.facilitySubForms[0].fields });
    assert.equal(sub.body.data.version, 2, 'customised Toilet used by the snapshot');

    const after = await prisma.visitFormSnapshot.findUniqueOrThrow({ where: { id: frozen.id } });
    assert.equal(canonicalVisitFormSnapshot(after.snapshotJson as unknown as VisitFormSnapshot), canonicalVisitFormSnapshot(frozen.snapshot));
    const rebuilt = await preview(P_MONITOR, ids.prg105, { visitKind: 'ROUTINE', visitDate: today() });
    assert.notEqual(rebuilt.body.data.contentSha256, row.contentSha256, 'a new form picks up the new versions');
    assert.ok(rebuilt.body.data.snapshot.blocks[0].fields.some((f: { key: string }) => f.key === 'night-work'));
  });

  it('phone-side assembly from the bundle hashes the same as the server', async () => {
    const { buildVisitFormLibraryBundle, buildVisitForm } = await import('../modules/forms/visitForm.service');
    const builtAt = new Date('2026-11-24T09:00:00.000Z');
    const toilet = await prisma.facility.findUniqueOrThrow({ where: { tenantId_code: { tenantId: ids.programme, code: 'TOILET' } } });
    const server = await buildVisitForm(prisma, ids.prg105, { visitKind: 'AD_HOC', visitDate: today(), pickedFacilityIds: [toilet.id], builtAt });
    // The phone receives the bundle as JSON.
    const bundle = VisitFormLibraryBundleSchema.parse(JSON.parse(JSON.stringify(await buildVisitFormLibraryBundle(prisma, ids.prg105))));
    const { snapshot } = assembleVisitForm(
      assemblyInputFromBundle(bundle, { visitKind: 'AD_HOC', visitDate: today(), builtAt: '2030-01-01T00:00:00.000Z', pickedFacilityIds: [toilet.id] })
    );
    const phoneHash = createHash('sha256').update(canonicalVisitFormSnapshot(snapshot), 'utf8').digest('hex');
    assert.equal(phoneHash, server.contentSha256);
  });
});
