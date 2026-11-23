/**
 * Phase 14 route and job tests: reporting streams (quarterly inspection stream beside a weekly item
 * stream), a missed quarterly visit, site inspections (idempotency, answers against the template
 * version, captures from another project refused, late uploads), findings aimed at the right
 * contractor, the report approval chain on inspections, the mobile pack and supervision workload.
 * A project without streams keeps the Phase 8 behaviour.
 *
 * Uses projects created here so the calendar is under test control. Calendar: 2025-03-31 is a
 * Monday, 2025-04-01 a Tuesday, 2025-06-30 a Monday, 2025-07-01 a Tuesday, 2025-09-30 a Tuesday.
 */
import { resetTestDatabase } from './helpers/testDb';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Express } from 'express';
import request from 'supertest';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let signFieldAgentToken: typeof import('../middleware/auth.middleware')['signFieldAgentToken'];
let jobs: typeof import('../jobs');
let omission: typeof import('../modules/workday-reports/aiOmissionCheck');

const PASSWORD = 'Password123!';
const tokens: Record<string, string> = {};
const ids = {
  tenant: '',
  project: '',
  plain: '',
  other: '',
  items: [] as string[],
  inspectorRole: '',
  residentRole: '',
  contractorRole: '',
  inspector: '',
  inspector2: '',
  resident: '',
  mainSession: '',
  subSession: '',
  otherSession: '',
  mainContractor: '',
  subContractor: '',
  subOrg: '',
  weeklyStream: '',
  quarterlyStream: '',
  template: { id: '', version: 1 },
};
let sitePoint = { latitude: 0, longitude: 0 };

async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}
const field = (sessionId: string) => ({ Authorization: `Bearer ${signFieldAgentToken({ sessionId })}` });

const SECTIONS = [
  {
    key: 'progress',
    title: 'Progress',
    items: [
      { key: 'on-programme', label: 'Works on programme', responseType: 'RATING_1_5', photoRequiredOnFail: true },
      { key: 'site-photo', label: 'Site photo', responseType: 'PHOTO_ONLY' },
    ],
  },
  { key: 'hse', title: 'Health and safety', items: [{ key: 'ppe', label: 'Workers wear PPE', responseType: 'YES_NO' }] },
];

function inspectionBody(over: Record<string, unknown> = {}) {
  return {
    clientReportId: crypto.randomUUID(),
    visitType: 'ROUTINE',
    templateId: ids.template.id,
    templateVersion: ids.template.version,
    visitDate: '2025-04-02',
    answers: [
      { itemKey: 'on-programme', value: 4, comment: null, clientCaptureIds: [] },
      { itemKey: 'site-photo', value: null, comment: null, clientCaptureIds: [] },
      { itemKey: 'ppe', value: 'YES', comment: null, clientCaptureIds: [] },
    ],
    overallFinding: 'SATISFACTORY',
    summaryText: 'Quarterly monitoring visit; works progressing to programme.',
    submissionGeotag: { ...sitePoint, accuracyMeters: 5, isMocked: false, capturedAt: '2025-04-03T10:00:00.000Z' },
    confirmedAt: '2025-04-03T10:00:00.000Z',
    ...over,
  };
}

async function session(p: { projectId: string; roleId: string; name: string; persona: 'INDEPENDENT_VERIFIER' | 'CONTRACTOR_EXECUTOR'; contractorId?: string | null }) {
  // The origin CHECK needs a join code; reuse the active one per project, role and contractor (partial unique index).
  const { createJoinCode } = await import('../modules/projects/joinCodes.service');
  const role = await prisma.role.findUniqueOrThrow({ where: { id: p.roleId } });
  const project = await prisma.project.findUniqueOrThrow({ where: { id: p.projectId } });
  const contractor = p.contractorId ? await prisma.projectContractor.findUniqueOrThrow({ where: { id: p.contractorId } }) : null;
  const code =
    (await prisma.projectJoinCode.findFirst({
      where: { projectId: p.projectId, roleId: role.id, projectContractorId: p.contractorId ?? null, isActive: true },
    })) ?? (await createJoinCode(prisma, { projectId: p.projectId, codePrefix: project.codePrefix, role, contractor }));
  const s = await prisma.fieldAgentSession.create({
    data: {
      projectId: p.projectId,
      origin: 'JOIN_CODE',
      joinCodeId: code.id,
      roleId: p.roleId,
      roleNameSnapshot: p.name,
      fieldPersonaType: p.persona,
      projectContractorId: p.contractorId ?? null,
      agentFullName: p.name,
      agentPhoneNumber: `+23480${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`,
      deviceId: crypto.randomUUID(),
      assuranceStatus: 'APPROVED',
    },
  });
  return s.id;
}

async function capture(projectId: string, sessionId: string) {
  const c = await prisma.fieldEvidenceLog.create({
    data: { projectId, fieldSessionId: sessionId, clientCaptureId: crypto.randomUUID(), locationAvailable: false, capturedAtDevice: new Date('2025-04-02T09:00:00Z') },
  });
  return c.clientCaptureId;
}

async function liveProject(code: string, name: string) {
  const edo = await prisma.project.findFirstOrThrow({ where: { tenantId: ids.tenant, codePrefix: 'EDO-410' } });
  const p = await prisma.project.create({
    data: {
      tenantId: ids.tenant,
      name,
      codePrefix: code,
      stateLocation: 'Edo State',
      status: 'ACTIVE',
      activatedAt: new Date('2025-01-01T00:00:00Z'),
      reportingCadence: 'WEEKLY',
      workWeekDays: [1, 2, 3, 4, 5, 6],
      timezone: 'Africa/Lagos',
      geofenceMode: edo.geofenceMode,
      geofenceGeoJson: edo.geofenceGeoJson ?? undefined,
      geofenceToleranceMeters: edo.geofenceToleranceMeters,
    },
  });
  for (const n of [1, 2]) {
    const item = await prisma.boqItem.create({
      data: {
        projectId: p.id,
        wbsCode: `0${n}.01`,
        section: 'BILL 1',
        description: `Classroom block ${n}`,
        unit: 'm2',
        totalQuantity: 100,
        rateNgn: 1000,
        budgetedCostNgn: 100000,
        planningTier: 'PLAN_A',
      },
    });
    if (code === 'INS-1401') ids.items.push(item.id);
  }
  const monitor = await prisma.user.findUniqueOrThrow({ where: { email: 'monitor@insite.ng' } });
  await prisma.userProjectAssignment.create({ data: { userId: monitor.id, projectId: p.id } });
  return p.id;
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  ({ signFieldAgentToken } = await import('../middleware/auth.middleware'));
  jobs = await import('../jobs');
  jobs.registerAllJobs();
  omission = await import('../modules/workday-reports/aiOmissionCheck');
  omission.setInspectionCheckScheduler(() => undefined);
  const { createApp } = await import('../app');
  app = createApp();

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'kpmg-nigeria' } });
  ids.tenant = tenant.id;
  const edo = await prisma.project.findFirstOrThrow({ where: { tenantId: tenant.id, codePrefix: 'EDO-410' } });
  const g = edo.geofenceGeoJson as { center?: { latitude: number; longitude: number } };
  sitePoint = g.center ?? { latitude: 6.3176, longitude: 5.6145 };

  ids.project = await liveProject('INS-1401', 'Inspection Test School');
  ids.plain = await liveProject('INS-1402', 'No Streams School');
  ids.other = edo.id;

  const role = (code: string) => prisma.role.findFirstOrThrow({ where: { tenantId: tenant.id, code } });
  ids.inspectorRole = (await role('MONITOR_INSPECTOR')).id;
  ids.residentRole = (await role('INDEPENDENT_RESIDENT')).id;
  ids.contractorRole = (await role('CONTRACTOR_ENGINEER')).id;

  // Main contractor = the seeded contractor@ organisation; a second package for a subcontractor.
  const contractorUser = await prisma.user.findUniqueOrThrow({ where: { email: 'contractor@insite.ng' } });
  await prisma.userProjectAssignment.create({ data: { userId: contractorUser.id, projectId: ids.project } });
  ids.mainContractor = (
    await prisma.projectContractor.create({
      data: { projectId: ids.project, organizationId: contractorUser.organizationId, tradeCategory: 'Civil works', tradeCode: 'CIV', isMainContractor: true },
    })
  ).id;
  ids.subOrg = (await prisma.organization.create({ data: { tenantId: tenant.id, name: 'Roofing Sub Ltd', categories: ['CONTRACTOR'] } })).id;
  ids.subContractor = (
    await prisma.projectContractor.create({ data: { projectId: ids.project, organizationId: ids.subOrg, tradeCategory: 'Roofing', tradeCode: 'ROF' } })
  ).id;

  ids.inspector = await session({ projectId: ids.project, roleId: ids.inspectorRole, name: 'Inspector Bisi', persona: 'INDEPENDENT_VERIFIER' });
  ids.inspector2 = await session({ projectId: ids.project, roleId: ids.inspectorRole, name: 'Inspector Tunde', persona: 'INDEPENDENT_VERIFIER' });
  ids.resident = await session({ projectId: ids.project, roleId: ids.residentRole, name: 'Resident Ada', persona: 'INDEPENDENT_VERIFIER' });
  ids.mainSession = await session({ projectId: ids.project, roleId: ids.contractorRole, name: 'Main Engineer', persona: 'CONTRACTOR_EXECUTOR', contractorId: ids.mainContractor });
  ids.subSession = await session({ projectId: ids.project, roleId: ids.contractorRole, name: 'Sub Engineer', persona: 'CONTRACTOR_EXECUTOR', contractorId: ids.subContractor });
  ids.otherSession = await session({ projectId: ids.other, roleId: ids.inspectorRole, name: 'Elsewhere', persona: 'INDEPENDENT_VERIFIER' });

  // A template of this test (the seed has others).
  const created = await request(app)
    .post('/api/v1/inspection-templates')
    .set(await web('admin@insite.ng'))
    .send({ code: 'TEST_ROUTINE', name: 'Test routine visit', visitTypes: ['ROUTINE'], sections: SECTIONS });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  ids.template = { id: created.body.data.id, version: created.body.data.version };
});

after(async () => {
  omission?.setInspectionCheckScheduler(null);
  await prisma?.$disconnect();
});

describe('Phase 14', () => {
  describe('reporting streams', () => {
    it('saves a weekly item stream and a quarterly inspection stream; quarterly periods are calendar quarters', async () => {
      const res = await request(app)
        .put(`/api/v1/projects/${ids.project}/reporting-streams`)
        .set(await web('monitor@insite.ng'))
        .send({
          streams: [
            { key: 'resident', label: 'Resident supervision', kind: 'ITEM_REPORTS', roleIds: [ids.residentRole], reportingCadence: 'WEEKLY' },
            {
              key: 'me-visit',
              label: 'M&E visit',
              kind: 'INSPECTION',
              roleIds: [ids.inspectorRole],
              reportingCadence: 'QUARTERLY',
              visitType: 'ROUTINE',
              submissionDeadlineDays: 7,
            },
          ],
        });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.usesImplicitDefault, false);
      const streams = res.body.data.streams as Array<{ id: string; key: string; settings: { reportingCadence: string } }>;
      ids.weeklyStream = streams.find((s) => s.key === 'resident')!.id;
      ids.quarterlyStream = streams.find((s) => s.key === 'me-visit')!.id;
      assert.equal(await prisma.auditLog.count({ where: { projectId: ids.project, action: 'REPORTING_STREAMS_SAVED' } }), 1);

      const bad = await request(app)
        .put(`/api/v1/projects/${ids.project}/reporting-streams`)
        .set(await web('monitor@insite.ng'))
        .send({ streams: [{ key: 'x', label: 'No visit type', kind: 'INSPECTION', roleIds: [ids.inspectorRole], reportingCadence: 'QUARTERLY' }] });
      assert.equal(bad.status, 400);
    });

    it('dispatch creates item obligations per stream and one inspection obligation per quarter', async () => {
      await jobs.runJobOnce('brief-dispatch', new Date('2025-04-01T07:30:00Z'));
      const obligations = await prisma.reportingObligation.findMany({ where: { projectId: ids.project } });
      const items = obligations.filter((o) => o.boqItemId);
      assert.equal(items.length, 2, 'one verifier obligation per scheduled item');
      assert.ok(items.every((o) => o.streamId === ids.weeklyStream && o.reporterScope === 'verifier' && o.periodStart === '2025-03-31'));
      const inspection = obligations.filter((o) => !o.boqItemId);
      assert.equal(inspection.length, 1);
      assert.equal(inspection[0].streamId, ids.quarterlyStream);
      assert.equal(inspection[0].reporterScope, 'inspection');
      assert.equal(inspection[0].periodStart, '2025-04-01');
      assert.equal(inspection[0].periodEnd, '2025-06-30');
      assert.equal(inspection[0].dueAt.toISOString(), '2025-06-30T16:00:00.000Z');
      assert.equal(inspection[0].lateAfter.toISOString(), '2025-07-07T16:00:00.000Z', 'late after the 7-day upload deadline');
      // INSPECTION streams get no briefs; dispatching again creates nothing new.
      await jobs.runJobOnce('brief-dispatch', new Date('2025-04-02T07:30:00Z'));
      assert.equal(await prisma.reportingObligation.count({ where: { projectId: ids.project } }), 3);
    });

    it('a resident report fulfils the weekly stream obligation', async () => {
      const confirmedAt = '2025-04-01T15:00:00.000Z';
      const res = await request(app)
        .post(`/api/v1/projects/${ids.project}/workday-reports`)
        .set(field(ids.resident))
        .send({
          clientReportId: crypto.randomUUID(),
          wbsItemId: ids.items[0],
          workdayDate: '2025-04-01',
          reporterTimezone: 'Africa/Lagos',
          summaryText: 'Blockwork to lintel level on the east wall.',
          reportedQuantity: 5,
          unitOfMeasure: 'm2',
          isHoldPointClaimed: false,
          clientCaptureIds: [],
          textNotes: [],
          submissionGeotag: { ...sitePoint, accuracyMeters: 5, isMocked: false, capturedAt: confirmedAt },
          confirmedAt,
          confirmedAsFinal: true,
        });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const o = await prisma.reportingObligation.findFirstOrThrow({ where: { projectId: ids.project, boqItemId: ids.items[0] } });
      assert.equal(o.status, 'SUBMITTED');
      assert.equal(o.workdayReportId, res.body.data.id);
    });

    it('a project without streams is unchanged: implicit stream, obligations without a stream', async () => {
      const view = await request(app).get(`/api/v1/projects/${ids.plain}/reporting-streams`).set(await web('monitor@insite.ng'));
      assert.equal(view.status, 200);
      assert.equal(view.body.data.usesImplicitDefault, true);
      assert.equal(view.body.data.defaultStream.label, 'Default');
      await prisma.projectJoinCode.create({ data: { projectId: ids.plain, roleId: ids.residentRole, code: 'INS-1402-COW-TEST' } });
      await jobs.runJobOnce('brief-dispatch', new Date('2025-04-07T07:30:00Z'));
      // Earlier dispatch ticks in this file already produced the previous week's rows; check this week only.
      const obligations = await prisma.reportingObligation.findMany({ where: { projectId: ids.plain, periodStart: '2025-04-07' } });
      assert.equal(obligations.length, 2, JSON.stringify(obligations.map((o) => [o.reporterScope, o.boqItemId, o.periodStart])));
      assert.ok(obligations.every((o) => o.streamId === null && o.boqItemId !== null));
      const all = await prisma.reportingObligation.findMany({ where: { projectId: ids.plain } });
      assert.ok(all.every((o) => o.streamId === null && o.boqItemId !== null));
    });

    it('a live shape change waits for the stream’s next period', async () => {
      const current = await request(app).get(`/api/v1/projects/${ids.project}/reporting-streams`).set(await web('monitor@insite.ng'));
      const streams = (current.body.data.streams as Array<Record<string, unknown>>).map((s) => ({
        id: s.id,
        key: s.key,
        label: s.label,
        kind: s.kind,
        roleIds: s.roleIds,
        reportingCadence: s.reportingCadence,
        visitType: s.visitType,
        submissionDeadlineDays: s.submissionDeadlineDays,
        quarterAnchorMonth: s.key === 'me-visit' ? 2 : s.quarterAnchorMonth,
      }));
      const res = await request(app).put(`/api/v1/projects/${ids.project}/reporting-streams`).set(await web('monitor@insite.ng')).send({ streams });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const me = (res.body.data.streams as Array<{ key: string; pendingChange: { effectiveFrom: string } | null; quarterAnchorMonth: number | null }>).find((s) => s.key === 'me-visit')!;
      assert.ok(me.pendingChange, 'the anchor change is pending');
      assert.equal(me.quarterAnchorMonth, null, 'the running quarter keeps its shape');
      // Put it back so the rest of the file keeps calendar quarters.
      const back = streams.map((s) => (s.key === 'me-visit' ? { ...s, quarterAnchorMonth: null } : s));
      const reverted = await request(app).put(`/api/v1/projects/${ids.project}/reporting-streams`).set(await web('monitor@insite.ng')).send({ streams: back });
      assert.equal(reverted.status, 200);
      assert.equal((reverted.body.data.streams as Array<{ key: string; pendingChange: unknown }>).find((s) => s.key === 'me-visit')!.pendingChange, null);
    });
  });

  describe('site inspections', () => {
    let firstId = '';

    it('the mobile pack carries the streams the session owes and its templates', async () => {
      const res = await request(app).get(`/api/v1/projects/${ids.project}/inspections/field-pack`).set(field(ids.inspector));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body.data.streams.map((s: { key: string }) => s.key), ['me-visit']);
      assert.equal(res.body.data.canSubmitInspections, true);
      assert.ok(res.body.data.templateIdByVisitType.ROUTINE, 'a routine template is offered');
      const resident = await request(app).get(`/api/v1/projects/${ids.project}/inspections/field-pack`).set(field(ids.resident));
      assert.deepEqual(resident.body.data.streams.map((s: { key: string }) => s.key), ['resident']);
    });

    it('is idempotent on clientReportId and fulfils the quarter', async () => {
      const photo = await capture(ids.project, ids.inspector);
      const body = inspectionBody({
        answers: [
          { itemKey: 'on-programme', value: 4, comment: null, clientCaptureIds: [] },
          { itemKey: 'site-photo', value: null, comment: null, clientCaptureIds: [photo] },
          { itemKey: 'ppe', value: 'YES', comment: null, clientCaptureIds: [] },
        ],
      });
      const first = await request(app).post(`/api/v1/projects/${ids.project}/inspections`).set(field(ids.inspector)).send(body);
      assert.equal(first.status, 201, JSON.stringify(first.body));
      firstId = first.body.data.id;
      assert.equal(first.body.data.status, 'SUBMITTED');
      assert.equal(first.body.data.isLate, false);
      assert.equal(first.body.data.streamId, ids.quarterlyStream);
      assert.equal(first.body.data.answers.find((a: { itemKey: string }) => a.itemKey === 'site-photo').captures.length, 1);
      const again = await request(app).post(`/api/v1/projects/${ids.project}/inspections`).set(field(ids.inspector)).send(body);
      assert.equal(again.status, 200);
      assert.equal(again.body.data.id, firstId);
      const stolen = await request(app).post(`/api/v1/projects/${ids.project}/inspections`).set(field(ids.inspector2)).send(body);
      assert.equal(stolen.status, 409);
      assert.equal(stolen.body.error.code, 'REPORT_ID_CONFLICT');
      assert.equal(await prisma.siteInspectionReport.count({ where: { projectId: ids.project } }), 1);
      const o = await prisma.reportingObligation.findFirstOrThrow({ where: { projectId: ids.project, boqItemId: null, periodStart: '2025-04-01' } });
      assert.equal(o.status, 'SUBMITTED');
      assert.equal(o.siteInspectionReportId, firstId);
      assert.equal(await prisma.auditLog.count({ where: { projectId: ids.project, action: 'INSPECTION_SUBMITTED' } }), 1);
    });

    it('validates answers against the stored template version', async () => {
      const missing = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspections`)
        .set(field(ids.inspector))
        .send(inspectionBody({ answers: [{ itemKey: 'on-programme', value: 4, comment: null, clientCaptureIds: [] }] }));
      assert.equal(missing.status, 422);
      assert.equal(missing.body.error.code, 'INVALID_INSPECTION_ANSWERS');

      // The template was used, so saving it creates version 2; version 1 stays valid for devices
      // that still have it, and answers are checked against the version they name.
      const v2 = await request(app)
        .put('/api/v1/inspection-templates/TEST_ROUTINE')
        .set(await web('admin@insite.ng'))
        .send({
          code: 'TEST_ROUTINE',
          name: 'Test routine visit',
          visitTypes: ['ROUTINE'],
          sections: [...SECTIONS, { key: 'env', title: 'Environment', items: [{ key: 'waste', label: 'Waste managed', responseType: 'YES_NO' }] }],
        });
      assert.equal(v2.status, 200, JSON.stringify(v2.body));
      assert.equal(v2.body.data.version, 2);
      assert.notEqual(v2.body.data.id, ids.template.id);

      const wrongVersion = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspections`)
        .set(field(ids.inspector))
        .send(inspectionBody({ templateVersion: 2 }));
      assert.equal(wrongVersion.status, 422);
      assert.equal(wrongVersion.body.error.code, 'TEMPLATE_VERSION_MISMATCH');

      const v1Answers = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspections`)
        .set(field(ids.inspector))
        .send(inspectionBody({ templateId: v2.body.data.id, templateVersion: 2 }));
      assert.equal(v1Answers.status, 422, 'version 2 requires its new item');
      assert.equal(v1Answers.body.error.details.errors[0].itemKey, 'waste');
    });

    it('refuses captures from another project', async () => {
      const foreign = await capture(ids.other, ids.inspector);
      const res = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspections`)
        .set(field(ids.inspector))
        .send(
          inspectionBody({
            answers: [
              { itemKey: 'on-programme', value: 4, comment: null, clientCaptureIds: [] },
              { itemKey: 'site-photo', value: null, comment: null, clientCaptureIds: [foreign] },
              { itemKey: 'ppe', value: 'YES', comment: null, clientCaptureIds: [] },
            ],
          })
        );
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'CAPTURE_OTHER_PROJECT');
      const unregistered = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspections`)
        .set(field(ids.inspector))
        .send(inspectionBody({ answers: [{ itemKey: 'site-photo', value: null, comment: null, clientCaptureIds: [crypto.randomUUID()] }, { itemKey: 'on-programme', value: 4, clientCaptureIds: [] }, { itemKey: 'ppe', value: 'YES', clientCaptureIds: [] }] }));
      assert.equal(unregistered.status, 409);
      assert.equal(unregistered.body.error.code, 'CAPTURES_NOT_REGISTERED');
    });

    it('a missed quarterly visit becomes MISSED; a late upload still meets it, flagged late', async () => {
      await jobs.runJobOnce('brief-dispatch', new Date('2025-07-01T07:30:00Z'));
      const q3 = await prisma.reportingObligation.findFirstOrThrow({ where: { projectId: ids.project, boqItemId: null, periodStart: '2025-07-01' } });
      assert.equal(q3.status, 'PENDING');
      await jobs.runJobOnce('overdue-reports', new Date('2025-10-08T08:00:00Z'));
      const missed = await prisma.reportingObligation.findUniqueOrThrow({ where: { id: q3.id } });
      assert.equal(missed.status, 'MISSED');
      const audit = await prisma.auditLog.findFirst({ where: { projectId: ids.project, action: 'REPORT_MISSED', summaryText: { contains: 'M&E visit' } } });
      assert.ok(audit, 'the missed visit is audited');
      const note = await prisma.webNotification.findFirst({ where: { projectId: ids.project, category: 'INSPECTION_MISSED' } });
      assert.ok(note);
      assert.equal(note.targetPermissionKey, 'inspections:view');

      const late = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspections`)
        .set(field(ids.inspector))
        .send(
          inspectionBody({
            visitDate: '2025-09-29',
            confirmedAt: '2025-10-09T10:00:00.000Z',
            submissionGeotag: { ...sitePoint, accuracyMeters: 5, isMocked: false, capturedAt: '2025-10-09T10:00:00.000Z' },
          })
        );
      assert.equal(late.status, 201, JSON.stringify(late.body));
      assert.equal(late.body.data.isLate, true);
      assert.equal(late.body.data.submissionDeadline, '2025-10-06');
      const met = await prisma.reportingObligation.findUniqueOrThrow({ where: { id: q3.id } });
      assert.equal(met.status, 'LATE');
    });
  });

  describe('findings', () => {
    let findingId = '';

    it('failed items raise findings aimed at the main contractor (web by organisation, mobile by package)', async () => {
      const res = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspections`)
        .set(field(ids.inspector))
        .send(
          inspectionBody({
            visitDate: '2025-04-20',
            confirmedAt: '2025-04-21T10:00:00.000Z',
            answers: [
              { itemKey: 'on-programme', value: 4, comment: null, clientCaptureIds: [] },
              { itemKey: 'site-photo', value: null, comment: null, clientCaptureIds: [] },
              { itemKey: 'ppe', value: 'NO', comment: 'Workers on the roof without harnesses', clientCaptureIds: [] },
            ],
            overallFinding: 'MAJOR_ISSUES',
          })
        );
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.data.findings.length, 1);
      const f = res.body.data.findings[0];
      findingId = f.id;
      assert.equal(f.projectContractorId, ids.mainContractor);
      assert.equal(f.severity, 'MAJOR');
      assert.equal(f.status, 'OPEN');

      const contractorUser = await prisma.user.findUniqueOrThrow({ where: { email: 'contractor@insite.ng' } });
      const webNote = await prisma.webNotification.findFirstOrThrow({ where: { projectId: ids.project, category: 'INSPECTION_FINDING' } });
      assert.equal(webNote.targetOrganizationId, contractorUser.organizationId);
      assert.ok(await prisma.mobileNotification.findFirst({ where: { fieldSessionId: ids.mainSession, type: 'INSPECTION_FINDING' } }));
      assert.equal(await prisma.mobileNotification.count({ where: { fieldSessionId: ids.subSession, type: 'INSPECTION_FINDING' } }), 0);
    });

    it('a finding raised by hand reaches the subcontractor only; each side sees its own', async () => {
      const inspection = await prisma.siteInspectionReport.findFirstOrThrow({ where: { projectId: ids.project, overallFinding: 'MAJOR_ISSUES' } });
      const notFailed = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspections/${inspection.id}/findings`)
        .set(await web('monitor@insite.ng'))
        .send({ checklistItemKey: 'on-programme', projectContractorId: ids.subContractor, description: 'Not a failed item', severity: 'MINOR' });
      assert.equal(notFailed.status, 422);
      assert.equal(notFailed.body.error.code, 'FINDING_ITEM_NOT_FAILED');
      const raised = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspections/${inspection.id}/findings`)
        .set(await web('monitor@insite.ng'))
        .send({ checklistItemKey: 'ppe', projectContractorId: ids.subContractor, description: 'Roofers without harnesses', severity: 'CRITICAL' });
      assert.equal(raised.status, 201, JSON.stringify(raised.body));
      assert.ok(await prisma.mobileNotification.findFirst({ where: { fieldSessionId: ids.subSession, type: 'INSPECTION_FINDING' } }));
      assert.equal(await prisma.auditLog.count({ where: { projectId: ids.project, action: 'INSPECTION_FINDING_RAISED' } }), 1);

      const mainView = await request(app).get(`/api/v1/projects/${ids.project}/inspection-findings`).set(await web('contractor@insite.ng'));
      assert.equal(mainView.status, 200, JSON.stringify(mainView.body));
      assert.deepEqual(mainView.body.data.map((f: { id: string }) => f.id), [findingId]);
      const subView = await request(app).get(`/api/v1/projects/${ids.project}/inspection-findings`).set(field(ids.subSession));
      assert.deepEqual(subView.body.data.map((f: { id: string }) => f.id), [raised.body.data.id]);
      const monitorView = await request(app).get(`/api/v1/projects/${ids.project}/inspection-findings`).set(await web('monitor@insite.ng'));
      assert.equal(monitorView.body.data.length, 2);
    });

    it('the contractor resolves its finding with photos; the other contractor cannot touch it', async () => {
      const otherSide = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspection-findings/${findingId}/resolve`)
        .set(field(ids.subSession))
        .send({ notes: 'Not ours but trying' });
      assert.equal(otherSide.status, 404);
      const photo = await capture(ids.project, ids.mainSession);
      const res = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspection-findings/${findingId}/resolve`)
        .set(field(ids.mainSession))
        .send({ notes: 'Harnesses issued and in use', clientCaptureIds: [photo] });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.status, 'RESOLVED');
      assert.equal(res.body.data.resolutionCaptures.length, 1);
      assert.equal(await prisma.auditLog.count({ where: { projectId: ids.project, action: 'INSPECTION_FINDING_RESOLVED' } }), 1);
      const contractorDismiss = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspection-findings/${findingId}/dismiss`)
        .set(await web('contractor@insite.ng'))
        .send({ reason: 'We would rather not' });
      assert.equal(contractorDismiss.status, 403);
    });
  });

  describe('approval chain on inspections', () => {
    it('with report approval on, an inspection waits for the chain; the inspector cannot approve their own', async () => {
      await prisma.projectProcessConfig.upsert({
        where: { projectId: ids.project },
        create: { projectId: ids.project, requireReportApproval: true },
        update: { requireReportApproval: true },
      });
      const res = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspections`)
        .set(await web('monitor@insite.ng'))
        .send(inspectionBody({ visitDate: '2025-05-02', confirmedAt: '2025-05-02T15:00:00.000Z', submissionGeotag: null }));
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.data.status, 'PENDING_APPROVAL');
      assert.ok(res.body.data.approval);
      const id = res.body.data.id;
      assert.ok(await prisma.webNotification.findFirst({ where: { projectId: ids.project, category: 'INSPECTION_PENDING_APPROVAL' } }));

      const own = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspections/${id}/review`)
        .set(await web('monitor@insite.ng'))
        .send({ decision: 'APPROVE' });
      assert.equal(own.status, 403);

      const approved = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspections/${id}/review`)
        .set(await web('admin@insite.ng'))
        .send({ decision: 'APPROVE' });
      assert.equal(approved.status, 200, JSON.stringify(approved.body));
      assert.equal(approved.body.data.status, 'APPROVED');
      const actions = await prisma.approvalAction.findMany({ where: { subjectType: 'SITE_INSPECTION', subjectId: id } });
      assert.equal(actions.length, 1);
      assert.equal(await prisma.auditLog.count({ where: { projectId: ids.project, action: 'INSPECTION_REVIEWED' } }), 1);

      const returned = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspections`)
        .set(await web('monitor@insite.ng'))
        .send(inspectionBody({ visitDate: '2025-05-03', confirmedAt: '2025-05-03T15:00:00.000Z', submissionGeotag: null }));
      const back = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspections/${returned.body.data.id}/review`)
        .set(await web('admin@insite.ng'))
        .send({ decision: 'RETURN', notes: 'Add the progress percentage' });
      assert.equal(back.status, 200);
      assert.equal(back.body.data.status, 'RETURNED');
      assert.equal(back.body.data.returnedNotes, 'Add the progress percentage');
    });

    it('lists filter by visit type, finding and lateness; the overview counts open findings and misses', async () => {
      const monitor = await web('monitor@insite.ng');
      const late = await request(app).get(`/api/v1/projects/${ids.project}/inspections?late=true`).set(monitor);
      assert.equal(late.status, 200);
      assert.ok(late.body.data.length >= 1 && late.body.data.every((i: { isLate: boolean }) => i.isLate));
      const major = await request(app).get(`/api/v1/projects/${ids.project}/inspections?overallFinding=MAJOR_ISSUES`).set(monitor);
      assert.equal(major.body.data.length, 1);
      const overview = await request(app).get(`/api/v1/projects/${ids.project}/inspections/overview`).set(monitor);
      assert.equal(overview.status, 200);
      assert.equal(overview.body.data.openFindings, 1);
      assert.equal(overview.body.data.baselineComplete, false);
      assert.ok(overview.body.data.lastByVisitType.ROUTINE);
    });
  });

  describe('omission check (inspection mode)', () => {
    it('flags required photo items without photos, engine RULES', async () => {
      const r = await prisma.siteInspectionReport.findFirstOrThrow({ where: { projectId: ids.project, overallFinding: 'MAJOR_ISSUES' } });
      await prisma.siteInspectionReport.update({ where: { id: r.id }, data: { aiCheckStatus: 'PENDING' } });
      assert.equal(await omission.runInspectionOmissionCheck(r.id), 'DONE');
      const after = await prisma.siteInspectionReport.findUniqueOrThrow({ where: { id: r.id } });
      assert.equal(after.aiCheckEngine, 'RULES');
      assert.deepEqual((after.aiFlagsJson as Array<{ itemKey: string }>).map((f) => f.itemKey), ['site-photo']);
    });
  });

  describe('supervision workload', () => {
    it('reports active projects and spread, warns above the type thresholds (seeded supervisor)', async () => {
      const programme = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } });
      void programme;
      const res = await request(app).get('/api/v1/supervision').set(await web('programme.admin@insite.ng'));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const officer = (res.body.data as Array<{ fullName: string; activeProjectCount: number; overSiteLimit: boolean; overSpread: boolean; spreadKm: number }>).find((s) =>
        s.fullName.startsWith('Ngozi Eze')
      );
      assert.ok(officer, 'the seeded M&E officer is a supervisor');
      // PRG-102, PRG-211, PRG-221 and (Phase 15) PRG-103 in its liability period; closed PRG-241 does not count.
      assert.equal(officer.activeProjectCount, 4);
      assert.equal(officer.overSiteLimit, true);
      assert.equal(officer.overSpread, true);
      assert.ok(officer.spreadKm > 500);
    });
  });
});
