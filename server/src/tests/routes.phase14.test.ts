/**
 * Phase 14 route tests: site inspections (idempotency, answers against the template version,
 * captures from another project refused), findings aimed at the right contractor, the report
 * approval chain on inspections, the mobile pack and supervision workload. Redesign R4f removed
 * reporting streams, reporting obligations, missed-visit tracking and the inspection overview
 * (visits replace them): inspections carry no stream, no reporting period and, without a stream's
 * upload deadline, are never late. The first describe checks the removed endpoints and jobs are gone.
 *
 * Uses a project created here so the calendar is under test control.
 */
import { resetTestDatabase } from './helpers/testDb';
import { createFieldSession, fieldAuth } from './helpers/fieldAuth';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Express } from 'express';
import request from 'supertest';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let jobs: typeof import('../jobs');
let omission: typeof import('../modules/workday-reports/aiOmissionCheck');

const PASSWORD = 'Password123!';
const tokens: Record<string, string> = {};
const ids = {
  tenant: '',
  project: '',
  other: '',
  items: [] as string[],
  inspectorRole: '',
  residentRole: '',
  inspector: '',
  inspector2: '',
  resident: '',
  otherSession: '',
  mainContractor: '',
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
const field = (sessionId: string) => fieldAuth(prisma, sessionId);

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

/** R1d: a provisioned field account and its session on the project (join codes are gone). */
async function session(p: { projectId: string; roleId: string; name: string }) {
  return (await createFieldSession(prisma, { projectId: p.projectId, roleId: p.roleId, name: p.name })).sessionId;
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
  ids.other = edo.id;

  const role = (code: string) => prisma.role.findFirstOrThrow({ where: { tenantId: tenant.id, code } });
  ids.inspectorRole = (await role('MONITOR_INSPECTOR')).id;
  ids.residentRole = (await role('INDEPENDENT_RESIDENT')).id;

  // The project's one contractor (decision T): the seeded civil contractor organisation, no login (P2).
  const contractorOrg = await prisma.organization.findFirstOrThrow({ where: { tenantId: tenant.id, name: { startsWith: 'Julius & Sons' } } });
  ids.mainContractor = (
    await prisma.projectContractor.create({
      data: { projectId: ids.project, organizationId: contractorOrg.id, tradeCategory: 'Civil works', tradeCode: 'CIV' },
    })
  ).id;

  ids.inspector = await session({ projectId: ids.project, roleId: ids.inspectorRole, name: 'Inspector Bisi' });
  ids.inspector2 = await session({ projectId: ids.project, roleId: ids.inspectorRole, name: 'Inspector Tunde' });
  ids.resident = await session({ projectId: ids.project, roleId: ids.residentRole, name: 'Resident Ada' });
  ids.otherSession = await session({ projectId: ids.other, roleId: ids.inspectorRole, name: 'Elsewhere' });

  // A template of this test (the seed has others). Written directly: authoring moved to the form
  // library in redesign R3e, the runtime still reads checklist templates until R4.
  const created = await prisma.inspectionChecklistTemplate.create({
    data: { tenantId: tenant.id, code: 'TEST_ROUTINE', name: 'Test routine visit', visitTypes: ['ROUTINE'], version: 1, sectionsJson: SECTIONS },
  });
  ids.template = { id: created.id, version: created.version };
});

after(async () => {
  omission?.setInspectionCheckScheduler(null);
  await prisma?.$disconnect();
});

describe('Phase 14', () => {
  it('checklist template authoring is gone (redesign R3e): write routes answer 404, reads still work', async () => {
    const auth = await web('admin@insite.ng');
    const body = { code: 'R3E_GONE', name: 'Gone', visitTypes: ['ROUTINE'], sections: SECTIONS };
    assert.equal((await request(app).post('/api/v1/inspection-templates').set(auth).send(body)).status, 404);
    assert.equal((await request(app).put('/api/v1/inspection-templates/TEST_ROUTINE').set(auth).send(body)).status, 404);
    assert.equal((await request(app).post('/api/v1/inspection-templates/TEST_ROUTINE/archive').set(auth)).status, 404);
    const list = await request(app).get('/api/v1/inspection-templates').set(auth);
    assert.equal(list.status, 200);
    assert.ok(list.body.data.some((t: { code: string }) => t.code === 'TEST_ROUTINE'));
    assert.equal(await prisma.permission.count({ where: { key: 'inspections:manage_templates' } }), 0);
  });

  describe('redesign R4f', () => {
    it('reporting streams, obligations, the cadence overview and the inspection overview are gone', async () => {
      const monitor = await web('monitor@insite.ng');
      const base = `/api/v1/projects/${ids.project}`;
      for (const [method, url] of [
        ['get', `${base}/reporting-streams`],
        ['put', `${base}/reporting-streams`],
        ['get', `${base}/reporting-obligations`],
        ['get', `${base}/cadence`],
      ] as const) {
        const res = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[method](url).set(monitor).send({ streams: [] });
        assert.equal(res.status, 404, `${method} ${url} answered ${res.status}`);
      }
      // The overview route is gone; the path falls through to GET /inspections/:id, which answers 404 for a non-UUID id.
      const overview = await request(app).get(`${base}/inspections/overview`).set(monitor);
      assert.equal(overview.status, 404);
      const names = jobs.registeredJobs().map((j) => j.name);
      for (const gone of ['reporting-obligations', 'overdue-reports']) assert.ok(!names.includes(gone), gone);
    });
  });

  describe('site inspections', () => {
    let firstId = '';

    it('the mobile pack carries the templates (no streams since R4f)', async () => {
      const res = await request(app).get(`/api/v1/projects/${ids.project}/inspections/field-pack`).set(await field(ids.inspector));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body.data.streams, []);
      assert.equal(res.body.data.canSubmitInspections, true);
      assert.ok(res.body.data.templateIdByVisitType.ROUTINE, 'a routine template is offered');
      const resident = await request(app).get(`/api/v1/projects/${ids.project}/inspections/field-pack`).set(await field(ids.resident));
      assert.equal(resident.status, 200, JSON.stringify(resident.body));
      assert.deepEqual(resident.body.data.streams, []);
    });

    it('is idempotent on clientReportId; no stream or reporting period (R4f)', async () => {
      const photo = await capture(ids.project, ids.inspector);
      const body = inspectionBody({
        answers: [
          { itemKey: 'on-programme', value: 4, comment: null, clientCaptureIds: [] },
          { itemKey: 'site-photo', value: null, comment: null, clientCaptureIds: [photo] },
          { itemKey: 'ppe', value: 'YES', comment: null, clientCaptureIds: [] },
        ],
      });
      const first = await request(app).post(`/api/v1/projects/${ids.project}/inspections`).set(await field(ids.inspector)).send(body);
      assert.equal(first.status, 201, JSON.stringify(first.body));
      firstId = first.body.data.id;
      assert.equal(first.body.data.status, 'SUBMITTED');
      assert.equal(first.body.data.isLate, false);
      assert.equal(first.body.data.streamId, null);
      assert.equal(first.body.data.submissionDeadline, null);
      assert.equal(first.body.data.answers.find((a: { itemKey: string }) => a.itemKey === 'site-photo').captures.length, 1);
      const again = await request(app).post(`/api/v1/projects/${ids.project}/inspections`).set(await field(ids.inspector)).send(body);
      assert.equal(again.status, 200);
      assert.equal(again.body.data.id, firstId);
      const stolen = await request(app).post(`/api/v1/projects/${ids.project}/inspections`).set(await field(ids.inspector2)).send(body);
      assert.equal(stolen.status, 409);
      assert.equal(stolen.body.error.code, 'REPORT_ID_CONFLICT');
      assert.equal(await prisma.siteInspectionReport.count({ where: { projectId: ids.project } }), 1);
      const row = await prisma.siteInspectionReport.findUniqueOrThrow({ where: { id: firstId } });
      assert.equal(row.reportingPeriodStart, null);
      assert.equal(await prisma.auditLog.count({ where: { projectId: ids.project, action: 'INSPECTION_SUBMITTED' } }), 1);
    });

    it('validates answers against the stored template version', async () => {
      const missing = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspections`)
        .set(await field(ids.inspector))
        .send(inspectionBody({ answers: [{ itemKey: 'on-programme', value: 4, comment: null, clientCaptureIds: [] }] }));
      assert.equal(missing.status, 422);
      assert.equal(missing.body.error.code, 'INVALID_INSPECTION_ANSWERS');

      // A version 2 exists; version 1 stays valid for devices that still have it, and answers are
      // checked against the version they name.
      const v2row = await prisma.inspectionChecklistTemplate.create({
        data: {
          tenantId: ids.tenant,
          code: 'TEST_ROUTINE',
          name: 'Test routine visit',
          visitTypes: ['ROUTINE'],
          version: 2,
          sectionsJson: [...SECTIONS, { key: 'env', title: 'Environment', items: [{ key: 'waste', label: 'Waste managed', responseType: 'YES_NO', required: true, photoRequired: false, photoRequiredOnFail: false }] }],
        },
      });
      const v2 = { body: { data: { id: v2row.id } } };

      const wrongVersion = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspections`)
        .set(await field(ids.inspector))
        .send(inspectionBody({ templateVersion: 2 }));
      assert.equal(wrongVersion.status, 422);
      assert.equal(wrongVersion.body.error.code, 'TEMPLATE_VERSION_MISMATCH');

      const v1Answers = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspections`)
        .set(await field(ids.inspector))
        .send(inspectionBody({ templateId: v2.body.data.id, templateVersion: 2 }));
      assert.equal(v1Answers.status, 422, 'version 2 requires its new item');
      assert.equal(v1Answers.body.error.details.errors[0].itemKey, 'waste');
    });

    it('refuses captures from another project', async () => {
      const foreign = await capture(ids.other, ids.inspector);
      const res = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspections`)
        .set(await field(ids.inspector))
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
        .set(await field(ids.inspector))
        .send(inspectionBody({ answers: [{ itemKey: 'site-photo', value: null, comment: null, clientCaptureIds: [crypto.randomUUID()] }, { itemKey: 'on-programme', value: 4, clientCaptureIds: [] }, { itemKey: 'ppe', value: 'YES', clientCaptureIds: [] }] }));
      assert.equal(unregistered.status, 409);
      assert.equal(unregistered.body.error.code, 'CAPTURES_NOT_REGISTERED');
    });

    it('an upload long after the visit is accepted and not flagged late (no stream deadline since R4f)', async () => {
      const late = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspections`)
        .set(await field(ids.inspector))
        .send(
          inspectionBody({
            visitDate: '2025-09-29',
            confirmedAt: '2025-10-09T10:00:00.000Z',
            submissionGeotag: { ...sitePoint, accuracyMeters: 5, isMocked: false, capturedAt: '2025-10-09T10:00:00.000Z' },
          })
        );
      assert.equal(late.status, 201, JSON.stringify(late.body));
      assert.equal(late.body.data.isLate, false);
      assert.equal(late.body.data.submissionDeadline, null);
      assert.equal(late.body.data.streamId, null);
    });
  });

  describe('findings', () => {
    let findingId = '';

    it('failed items raise findings against the project contractor; nothing is aimed at the contractor (R1d)', async () => {
      const res = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspections`)
        .set(await field(ids.inspector))
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
      // The contractor has no login: no notification aimed at its organisation, none to field devices.
      assert.equal(await prisma.webNotification.count({ where: { projectId: ids.project, category: 'INSPECTION_FINDING', targetOrganizationId: { not: null } } }), 0);
      assert.equal(await prisma.mobileNotification.count({ where: { projectId: ids.project, type: 'INSPECTION_FINDING' } }), 0);
    });

    it('a finding raised by hand needs a failed item; staff see every finding', async () => {
      const inspection = await prisma.siteInspectionReport.findFirstOrThrow({ where: { projectId: ids.project, overallFinding: 'MAJOR_ISSUES' } });
      const notFailed = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspections/${inspection.id}/findings`)
        .set(await web('monitor@insite.ng'))
        .send({ checklistItemKey: 'on-programme', projectContractorId: ids.mainContractor, description: 'Not a failed item', severity: 'MINOR' });
      assert.equal(notFailed.status, 422);
      assert.equal(notFailed.body.error.code, 'FINDING_ITEM_NOT_FAILED');
      const raised = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspections/${inspection.id}/findings`)
        .set(await web('monitor@insite.ng'))
        .send({ checklistItemKey: 'ppe', projectContractorId: ids.mainContractor, description: 'Roofers without harnesses', severity: 'CRITICAL' });
      assert.equal(raised.status, 201, JSON.stringify(raised.body));
      assert.equal(await prisma.auditLog.count({ where: { projectId: ids.project, action: 'INSPECTION_FINDING_RAISED' } }), 1);

      const monitorView = await request(app).get(`/api/v1/projects/${ids.project}/inspection-findings`).set(await web('monitor@insite.ng'));
      assert.equal(monitorView.body.data.length, 2);
      const officerView = await request(app).get(`/api/v1/projects/${ids.project}/inspection-findings`).set(await field(ids.inspector2));
      assert.equal(officerView.status, 200, JSON.stringify(officerView.body));
      assert.equal(officerView.body.data.length, 2);
      assert.ok(officerView.body.data.every((x: { canResolve: boolean }) => x.canResolve));
    });

    it('an officer resolves a finding with their own photos; others cannot dismiss without the permission', async () => {
      const notMine = await capture(ids.project, ids.inspector);
      const refused = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspection-findings/${findingId}/resolve`)
        .set(await field(ids.inspector2))
        .send({ notes: 'Using a colleague photo', clientCaptureIds: [notMine] });
      assert.equal(refused.status, 403);
      assert.equal(refused.body.error.code, 'CAPTURE_NOT_OWNED');
      const photo = await capture(ids.project, ids.inspector2);
      const res = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspection-findings/${findingId}/resolve`)
        .set(await field(ids.inspector2))
        .send({ notes: 'Harnesses issued and in use', clientCaptureIds: [photo] });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.status, 'RESOLVED');
      assert.equal(res.body.data.resolutionCaptures.length, 1);
      assert.equal(await prisma.auditLog.count({ where: { projectId: ids.project, action: 'INSPECTION_FINDING_RESOLVED' } }), 1);
      const open = await prisma.inspectionFinding.findFirstOrThrow({ where: { projectId: ids.project, status: 'OPEN' } });
      const lenderDismiss = await request(app)
        .post(`/api/v1/projects/${ids.project}/inspection-findings/${open.id}/dismiss`)
        .set(await web('lender@insite.ng'))
        .send({ reason: 'We would rather not' });
      assert.equal(lenderDismiss.status, 403);
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

    it('lists filter by finding and lateness', async () => {
      const monitor = await web('monitor@insite.ng');
      const late = await request(app).get(`/api/v1/projects/${ids.project}/inspections?late=true`).set(monitor);
      assert.equal(late.status, 200);
      assert.equal(late.body.data.length, 0, 'nothing is late without a stream deadline (R4f)');
      const all = await request(app).get(`/api/v1/projects/${ids.project}/inspections`).set(monitor);
      assert.ok(all.body.data.length >= 1);
      const major = await request(app).get(`/api/v1/projects/${ids.project}/inspections?overallFinding=MAJOR_ISSUES`).set(monitor);
      assert.equal(major.body.data.length, 1);
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
