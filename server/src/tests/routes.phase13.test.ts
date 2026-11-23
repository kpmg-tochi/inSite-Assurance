/**
 * Phase 13 route and job tests: contract step anchors and recompute, the document register
 * (contractor visibility, sign-offs, versions), manual milestone completion gated on signed
 * documents, the kick-off (notice lead time, quorum, automatic milestones, anchor move), automatic
 * mobilisation from an in-geofence check-in, the milestone-deadlines job (one notification per
 * state, one default case per overdue milestone), the CONTRACT_DEFAULT chain with organisation
 * scope, termination side effects, replacement keeping history, programme of works, CP evidence
 * and the third chain.
 *
 * Uses a project created here; dates are relative to today (the services read the clock).
 */
import { resetTestDatabase } from './helpers/testDb';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Express } from 'express';
import request from 'supertest';
import { addDays, zonedCalendarDate } from '@insite/shared';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let signFieldAgentToken: typeof import('../middleware/auth.middleware')['signFieldAgentToken'];
let jobs: typeof import('../jobs');
let messaging: typeof import('../integrations/messaging');
let storage: typeof import('../integrations/storage.service');

const PASSWORD = 'Password123!';
const tokens: Record<string, string> = {};
const today = zonedCalendarDate(new Date(), 'Africa/Lagos');
const noonOf = (date: string) => new Date(`${date}T11:00:00.000Z`);
const ids = {
  tenant: '',
  project: '',
  other: '',
  ownerOrg: '',
  otherOrg: '',
  subOrg: '',
  main: '',
  sub: '',
  items: [] as string[],
  contractorRole: '',
  mainSession: '',
  subSession: '',
  minutesDoc: '',
  cpDoc: '',
  mainCase: '',
  replacement: '',
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
const url = (path: string) => `/api/v1/projects/${ids.project}${path}`;
const auditCount = (action: string) => prisma.auditLog.count({ where: { projectId: ids.project, action: action as never } });

async function milestones(email = 'monitor@insite.ng') {
  const res = await request(app).get(url('/milestones')).set(await web(email));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data as { milestones: Array<{ id: string; key: string; projectContractorId: string | null; dueDate: string | null; status: string; anchorDateOverride: string | null }> };
}
const find = (m: Awaited<ReturnType<typeof milestones>>, key: string, pc: string | null = null) =>
  m.milestones.find((x) => x.key === key && x.projectContractorId === pc)!;

/** Uploads a file through the real presign and registers it. */
async function fileDocument(email: string, typeCode: string, title: string, extra: Record<string, unknown> = {}) {
  const h = await web(email);
  const body = Buffer.from(`%PDF-1.4 ${title} ${crypto.randomUUID()}`);
  const presign = await request(app)
    .post(url('/evidence/presign'))
    .set(h)
    .send({ mediaType: 'PROJECT_DOCUMENT', fileName: 'doc.pdf', mimeType: 'application/pdf', byteSize: body.length });
  assert.equal(presign.status, 200, JSON.stringify(presign.body));
  await storage.storageService.putLocalObject(presign.body.data.objectKey, body, 'application/pdf');
  const type = await prisma.documentType.findUniqueOrThrow({ where: { tenantId_code: { tenantId: ids.tenant, code: typeCode } } });
  const res = await request(app)
    .post(url('/documents'))
    .set(h)
    .send({ documentTypeId: type.id, title, objectKey: presign.body.data.objectKey, ...extra });
  return { res, objectKey: presign.body.data.objectKey as string, body };
}

async function session(p: { roleId: string; name: string; contractorId: string }) {
  const { createJoinCode } = await import('../modules/projects/joinCodes.service');
  const role = await prisma.role.findUniqueOrThrow({ where: { id: p.roleId } });
  const project = await prisma.project.findUniqueOrThrow({ where: { id: ids.project } });
  const contractor = await prisma.projectContractor.findUniqueOrThrow({ where: { id: p.contractorId } });
  const code =
    (await prisma.projectJoinCode.findFirst({ where: { projectId: ids.project, roleId: role.id, projectContractorId: p.contractorId, isActive: true } })) ??
    (await createJoinCode(prisma, { projectId: ids.project, codePrefix: project.codePrefix, role, contractor, includeTradeCode: true }));
  const s = await prisma.fieldAgentSession.create({
    data: {
      projectId: ids.project,
      origin: 'JOIN_CODE',
      joinCodeId: code.id,
      roleId: p.roleId,
      roleNameSnapshot: p.name,
      fieldPersonaType: 'CONTRACTOR_EXECUTOR',
      projectContractorId: p.contractorId,
      agentFullName: p.name,
      agentPhoneNumber: `+23480${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`,
      deviceId: crypto.randomUUID(),
      assuranceStatus: 'APPROVED',
    },
  });
  return s.id;
}

const TEMPLATES = [
  { key: 'kickoff-notice', label: 'Kick-off notice sent', anchor: 'KICKOFF', offsetValue: -7, completionMode: 'AUTO_KICKOFF_NOTICE_SENT' },
  { key: 'kickoff-held', label: 'Kick-off held', anchor: 'KICKOFF', offsetValue: 0, completionMode: 'AUTO_KICKOFF_QUORUM' },
  { key: 'minutes-signed', label: 'Minutes signed', anchor: 'KICKOFF', offsetValue: 7, requiredDocumentTypeCodes: ['KICKOFF_MINUTES'] },
  { key: 'programme', label: 'Programme accepted', anchor: 'KICKOFF', offsetValue: 0, completionMode: 'AUTO_SCHEDULE_BASELINE_SET' },
  {
    key: 'mobilised',
    label: 'Contractor mobilised',
    anchor: 'KICKOFF',
    offsetValue: 14,
    completionMode: 'AUTO_CONTRACTOR_ON_SITE',
    perContractor: true,
    responsibleRoleCode: 'CONTRACTOR',
    responsibleScope: 'CONTRACTOR',
  },
];

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  ({ signFieldAgentToken } = await import('../middleware/auth.middleware'));
  jobs = await import('../jobs');
  jobs.registerAllJobs();
  messaging = await import('../integrations/messaging');
  storage = await import('../integrations/storage.service');
  const { createApp } = await import('../app');
  app = createApp();
  const { ProjectTypeConfigSchema } = await import('@insite/shared');
  const { syncContractMilestones } = await import('../modules/contracts/milestones.service');
  const { provisionDefaultDocumentTypes } = await import('../modules/documents/documentTypes.service');

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'kpmg-nigeria' } });
  ids.tenant = tenant.id;
  await provisionDefaultDocumentTypes(prisma, tenant.id);
  const edo = await prisma.project.findFirstOrThrow({ where: { tenantId: tenant.id, codePrefix: 'EDO-410' } });
  ids.other = edo.id;
  const g = edo.geofenceGeoJson as { center?: { latitude: number; longitude: number } };
  sitePoint = g.center ?? { latitude: 6.3176, longitude: 5.6145 };
  const role = (code: string) => prisma.role.findFirstOrThrow({ where: { tenantId: tenant.id, code } });
  ids.contractorRole = (await role('CONTRACTOR_ENGINEER')).id;
  const orgAdmin = await role('ORGANIZATION_ADMIN');
  const contractorWebRole = await role('CONTRACTOR');
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@insite.ng' } });
  const monitor = await prisma.user.findUniqueOrThrow({ where: { email: 'monitor@insite.ng' } });
  const contractorUser = await prisma.user.findUniqueOrThrow({ where: { email: 'contractor@insite.ng' } });

  ids.ownerOrg = (await prisma.organization.create({ data: { tenantId: tenant.id, name: 'P13 Owner Authority', categories: ['CLIENT_OWNER'] } })).id;
  ids.otherOrg = (await prisma.organization.create({ data: { tenantId: tenant.id, name: 'P13 Other Authority', categories: ['CLIENT_OWNER'] } })).id;
  ids.subOrg = (await prisma.organization.create({ data: { tenantId: tenant.id, name: 'P13 Roofing Ltd', categories: ['CONTRACTOR'] } })).id;
  const mkUser = (email: string, fullName: string, roleId: string, organizationId: string) =>
    prisma.user.create({ data: { tenantId: tenant.id, email, passwordHash: admin.passwordHash, fullName, roleId, organizationId } });
  const exec = await mkUser('p13.exec@insite.ng', 'Owner Executive', orgAdmin.id, ids.ownerOrg);
  const exec2 = await mkUser('p13.exec2@insite.ng', 'Other Executive', orgAdmin.id, ids.otherOrg);
  const subco = await mkUser('p13.subco@insite.ng', 'Roofing Manager', contractorWebRole.id, ids.subOrg);

  const config = ProjectTypeConfigSchema.parse({
    contractMilestones: TEMPLATES,
    kickoff: { requiredStakeholderGroups: ['OWNER', 'CONTRACTOR'], noticeLeadDays: 7 },
    documentRequirements: { beforeMobilisation: ['MOBILISATION_AGREEMENT'] },
  });
  const project = await prisma.project.create({
    data: {
      tenantId: tenant.id,
      name: 'Contract Test School',
      codePrefix: 'CTR-130',
      stateLocation: 'Edo State',
      status: 'ACTIVE',
      activatedAt: new Date(),
      timezone: 'Africa/Lagos',
      geofenceMode: edo.geofenceMode,
      geofenceGeoJson: edo.geofenceGeoJson ?? undefined,
      geofenceToleranceMeters: edo.geofenceToleranceMeters,
      totalBudgetNgn: 1_000_000,
      contractorExecutionMode: 'MULTI_PRIME_SEPARATE_IPC',
      owningOrganizationId: ids.ownerOrg,
      monitorOrganizationId: monitor.organizationId,
      contractAwardDate: addDays(today, -20),
      contractSignedDate: addDays(today, -15),
      kickoffDate: addDays(today, 20),
      projectTypeSnapshotJson: {
        projectTypeId: crypto.randomUUID(),
        code: 'CENTRAL_TEST',
        name: 'Central test',
        colour: null,
        version: 1,
        workflowTemplateId: null,
        config,
        appliedAt: new Date().toISOString(),
      } as never,
    },
  });
  ids.project = project.id;
  for (const userId of [monitor.id, contractorUser.id, exec.id, exec2.id, subco.id]) {
    await prisma.userProjectAssignment.create({ data: { userId, projectId: project.id } });
  }
  ids.main = (
    await prisma.projectContractor.create({
      data: { projectId: project.id, organizationId: contractorUser.organizationId, tradeCategory: 'Civil works', tradeCode: 'CIV', isMainContractor: true },
    })
  ).id;
  ids.sub = (await prisma.projectContractor.create({ data: { projectId: project.id, organizationId: ids.subOrg, tradeCategory: 'Roofing', tradeCode: 'ROF' } })).id;
  const tranche = await prisma.facilityTranche.create({ data: { projectId: project.id, trancheNumber: 1, name: 'Whole project', allocatedAmountNgn: 1_000_000, targetCompletionPct: 100 } });
  for (const [n, pc] of [[1, ids.main], [2, ids.sub]] as const) {
    const item = await prisma.boqItem.create({
      data: {
        projectId: project.id,
        trancheId: tranche.id,
        projectContractorId: pc,
        wbsCode: `0${n}.01`,
        section: 'BILL 1',
        description: `Block ${n}`,
        unit: 'm2',
        totalQuantity: 100,
        rateNgn: 1000,
        budgetedCostNgn: 100000,
      },
    });
    ids.items.push(item.id);
  }
  await prisma.$transaction((tx) => syncContractMilestones(tx, project.id));
  ids.mainSession = await session({ roleId: ids.contractorRole, name: 'Main Engineer', contractorId: ids.main });
  ids.subSession = await session({ roleId: ids.contractorRole, name: 'Roofing Engineer', contractorId: ids.sub });
});

after(async () => {
  await prisma?.$disconnect();
});

describe('Phase 13', () => {
  it('generates milestones from the type (one per contractor) with dates from the anchors', async () => {
    const m = await milestones();
    assert.equal(m.milestones.length, 6);
    assert.equal(find(m, 'kickoff-notice').dueDate, addDays(today, 13));
    assert.equal(find(m, 'mobilised', ids.main).dueDate, addDays(today, 34));
    assert.equal(find(m, 'mobilised', ids.sub).dueDate, addDays(today, 34));
  });

  it('contract step on a live project: moving the kick-off needs milestones:manage and a reason, and recomputes', async () => {
    const before = await auditCount('MILESTONE_DATES_RECOMPUTED');
    const noReason = await request(app).put(url('/setup/contract')).set(await web('admin@insite.ng')).send({ kickoffDate: addDays(today, 10) });
    assert.equal(noReason.status, 409, JSON.stringify(noReason.body));
    assert.equal(noReason.body.error.code, 'CHANGE_REASON_REQUIRED');
    const bad = await request(app)
      .put(url('/setup/contract'))
      .set(await web('admin@insite.ng'))
      .send({ kickoffDate: addDays(today, -30), changeReason: 'Earlier kick-off agreed' });
    // Checked against the stored award date (the body alone passes the schema).
    assert.equal(bad.status, 422, 'kick-off before award is refused');
    assert.equal(bad.body.error.code, 'CONTRACT_DATES_OUT_OF_ORDER');
    const ok = await request(app)
      .put(url('/setup/contract'))
      .set(await web('admin@insite.ng'))
      .send({ kickoffDate: addDays(today, 10), changeReason: 'Kick-off brought forward by the owner' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.data.contract.kickoffDate, addDays(today, 10));
    assert.deepEqual(ok.body.data.contract.requiredAnchors, ['KICKOFF']);
    const m = await milestones();
    assert.equal(find(m, 'kickoff-notice').dueDate, addDays(today, 3));
    assert.equal(find(m, 'mobilised', ids.sub).dueDate, addDays(today, 24));
    assert.equal(await auditCount('MILESTONE_DATES_RECOMPUTED'), before + 1);
  });

  it('documents: contractor visibility, sign-offs per version, media access', async () => {
    const minutes = await fileDocument('monitor@insite.ng', 'KICKOFF_MINUTES', 'Kick-off minutes');
    assert.equal(minutes.res.status, 201, JSON.stringify(minutes.res.body));
    ids.minutesDoc = minutes.res.body.data.id;
    assert.equal(minutes.res.body.data.current.sha256, crypto.createHash('sha256').update(minutes.body).digest('hex'));
    assert.equal(minutes.res.body.data.awaitingSignOff, true);
    const cp = await fileDocument('monitor@insite.ng', 'CP_EVIDENCE', 'Soil report');
    ids.cpDoc = cp.res.body.data.id;
    const again = await request(app)
      .post(url('/documents'))
      .set(await web('monitor@insite.ng'))
      .send({ documentTypeId: cp.res.body.data.documentType.id, title: 'Same file', objectKey: cp.objectKey });
    assert.equal(again.status, 409);

    // The contractor side: shared types and its own uploads only.
    const own = await fileDocument('contractor@insite.ng', 'MOBILISATION_AGREEMENT', 'Our mobilisation agreement', { projectContractorId: ids.sub });
    assert.equal(own.res.status, 403, 'cannot file for another contractor');
    const own2 = await fileDocument('contractor@insite.ng', 'MOBILISATION_AGREEMENT', 'Our mobilisation agreement');
    assert.equal(own2.res.status, 201, JSON.stringify(own2.res.body));
    assert.equal(own2.res.body.data.projectContractorId, ids.main);
    const list = await request(app).get(url('/documents')).set(await web('contractor@insite.ng'));
    assert.deepEqual(list.body.data.map((d: { title: string }) => d.title).sort(), ['Kick-off minutes', 'Our mobilisation agreement']);
    assert.equal((await request(app).get(url(`/documents/${ids.cpDoc}`)).set(await web('contractor@insite.ng'))).status, 404);
    const media = await request(app).get(url('/media')).query({ key: cp.objectKey, format: 'json' }).set(await web('contractor@insite.ng'));
    assert.equal(media.status, 400, 'a hidden document is not served through the media endpoint');
    const subList = await request(app).get(url('/documents')).set(await web('p13.subco@insite.ng'));
    assert.deepEqual(subList.body.data.map((d: { title: string }) => d.title), ['Kick-off minutes']);
    const dl = await request(app).get(url(`/documents/${ids.minutesDoc}/download`)).set(await web('contractor@insite.ng'));
    assert.equal(dl.status, 200);
    assert.match(dl.body.data.fileName, /-v1\.pdf$/);

    // Sign-offs: once per user and version; a new version needs its own.
    const sign = await request(app).post(url(`/documents/${ids.minutesDoc}/sign-off`)).set(await web('monitor@insite.ng')).send({ version: 1 });
    assert.equal(sign.status, 200, JSON.stringify(sign.body));
    assert.equal(sign.body.data.signOffs.length, 1);
    assert.equal(sign.body.data.signOffs[0].statementHash.length, 64);
    const twice = await request(app).post(url(`/documents/${ids.minutesDoc}/sign-off`)).set(await web('monitor@insite.ng')).send({ version: 1 });
    assert.equal(twice.body.error.code, 'ALREADY_SIGNED');
    assert.equal(await auditCount('DOCUMENT_SIGNED'), 1);
  });

  it('a manual milestone completes only when its documents are filed and signed', async () => {
    const id = find(await milestones(), 'minutes-signed').id;
    // A new, unsigned version replaces the signed one.
    const presign = await request(app)
      .post(url('/evidence/presign'))
      .set(await web('monitor@insite.ng'))
      .send({ mediaType: 'PROJECT_DOCUMENT', fileName: 'v2.pdf', mimeType: 'application/pdf', byteSize: 9 });
    await storage.storageService.putLocalObject(presign.body.data.objectKey, Buffer.from('%PDF-v2!!'), 'application/pdf');
    const v2 = await request(app).post(url(`/documents/${ids.minutesDoc}/versions`)).set(await web('monitor@insite.ng')).send({ objectKey: presign.body.data.objectKey });
    assert.equal(v2.status, 200, JSON.stringify(v2.body));
    assert.equal(v2.body.data.currentVersion, 2);
    assert.equal(v2.body.data.awaitingSignOff, true);
    const stale = await request(app).post(url(`/documents/${ids.minutesDoc}/sign-off`)).set(await web('admin@insite.ng')).send({ version: 1 });
    assert.equal(stale.body.error.code, 'VERSION_SUPERSEDED');

    const refused = await request(app).post(url(`/milestones/${id}/complete`)).set(await web('monitor@insite.ng')).send({});
    assert.equal(refused.status, 422);
    assert.equal(refused.body.error.code, 'MILESTONE_DOCUMENTS_MISSING');
    await request(app).post(url(`/documents/${ids.minutesDoc}/sign-off`)).set(await web('admin@insite.ng')).send({ version: 2 });
    const done = await request(app).post(url(`/milestones/${id}/complete`)).set(await web('monitor@insite.ng')).send({ notes: 'Signed by all parties' });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.data.milestones.find((m: { id: string }) => m.id === id).status, 'DONE');
    const auto = find(await milestones(), 'kickoff-held').id;
    const notManual = await request(app).post(url(`/milestones/${auto}/complete`)).set(await web('monitor@insite.ng')).send({});
    assert.equal(notManual.body.error.code, 'MILESTONE_NOT_MANUAL');
    assert.equal((await request(app).post(url(`/milestones/${auto}/waive`)).set(await web('monitor@insite.ng')).send({ reason: 'not needed' })).status, 403);
  });

  it('kick-off: notice lead time, quorum, automatic milestones and moving the anchor', async () => {
    const h = await web('monitor@insite.ng');
    const kickoff = await request(app).get(url('/kickoff')).set(h);
    assert.equal(kickoff.status, 200);
    assert.ok(kickoff.body.data.suggestedInvitees.some((i: { stakeholderGroup: string }) => i.stakeholderGroup === 'CONTRACTOR'));
    const saved = await request(app)
      .put(url('/kickoff'))
      .set(h)
      .send({
        scheduledAt: `${addDays(today, 2)}T09:00:00.000Z`,
        location: 'Site office',
        invitees: [
          { stakeholderGroup: 'OWNER', name: 'Owner Executive', email: 'p13.exec@insite.ng' },
          { stakeholderGroup: 'CONTRACTOR', name: 'Main contractor', email: 'contractor@insite.ng' },
          { stakeholderGroup: 'MONITOR', name: 'Monitor', email: null },
        ],
      });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const short = await request(app).post(url('/kickoff/send-notice')).set(h).send({});
    assert.equal(short.status, 422);
    assert.equal(short.body.error.code, 'NOTICE_LEAD_TIME_SHORT');
    const outboxBefore = messaging.consoleOutbox.length;
    const sent = await request(app).post(url('/kickoff/send-notice')).set(h).send({ waiveLeadTimeReason: 'Owner asked for an early start' });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(messaging.consoleOutbox.length - outboxBefore, 2);
    const statuses = sent.body.data.meeting.invitees.map((i: { noticeStatus: string }) => i.noticeStatus).sort();
    assert.deepEqual(statuses, ['NO_EMAIL', 'SENT', 'SENT']);
    assert.equal(find(await milestones(), 'kickoff-notice').status, 'DONE');

    const invitees = sent.body.data.meeting.invitees as Array<{ id: string; stakeholderGroup: string }>;
    const owner = invitees.find((i) => i.stakeholderGroup === 'OWNER')!;
    const contractor = invitees.find((i) => i.stakeholderGroup === 'CONTRACTOR')!;
    const noQuorum = await request(app)
      .post(url('/kickoff/held'))
      .set(h)
      .send({ heldAt: new Date().toISOString(), attendance: [{ inviteeId: owner.id, attended: true }, { inviteeId: contractor.id, attended: false }] });
    assert.equal(noQuorum.status, 422);
    assert.deepEqual(noQuorum.body.error.details.missingGroups, ['CONTRACTOR']);
    const held = await request(app)
      .post(url('/kickoff/held'))
      .set(h)
      .send({
        heldAt: new Date().toISOString(),
        attendance: invitees.map((i) => ({ inviteeId: i.id, attended: i.stakeholderGroup !== 'MONITOR' })),
        minutesDocumentId: ids.minutesDoc,
      });
    assert.equal(held.status, 200, JSON.stringify(held.body));
    assert.equal(held.body.data.meeting.quorumMet, true);
    assert.equal(held.body.data.plannedKickoffDate, today, 'held today, so the anchor moved');
    const m = await milestones();
    assert.equal(find(m, 'kickoff-held').status, 'DONE');
    assert.equal(find(m, 'mobilised', ids.main).dueDate, addDays(today, 14));
    assert.equal((await request(app).post(url('/kickoff/held')).set(h).send({ heldAt: new Date().toISOString(), attendance: [] })).body.error.code, 'KICKOFF_ALREADY_HELD');
  });

  it('the first in-geofence check-in of a contractor completes its mobilisation milestone only', async () => {
    const res = await request(app)
      .post(url('/telemetry'))
      .set(field(ids.subSession))
      .send({ pings: [{ clientPingId: crypto.randomUUID(), ...sitePoint, accuracyMeters: 5, isMocked: false, pingSource: 'MANUAL_CHECKIN', capturedAt: new Date().toISOString() }] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const m = await milestones();
    assert.equal(find(m, 'mobilised', ids.sub).status, 'DONE');
    assert.notEqual(find(m, 'mobilised', ids.main).status, 'DONE');
    // Idempotent: a second ping changes nothing.
    const completions = await auditCount('MILESTONE_COMPLETED');
    await request(app)
      .post(url('/telemetry'))
      .set(field(ids.subSession))
      .send({ pings: [{ clientPingId: crypto.randomUUID(), ...sitePoint, accuracyMeters: 5, isMocked: false, pingSource: 'MANUAL_CHECKIN', capturedAt: new Date().toISOString() }] });
    assert.equal(await auditCount('MILESTONE_COMPLETED'), completions);
    const compliance = await request(app).get(url('/mobilisation-compliance')).set(await web('monitor@insite.ng'));
    const sub = compliance.body.data.find((r: { projectContractorId: string }) => r.projectContractorId === ids.sub);
    const main = compliance.body.data.find((r: { projectContractorId: string }) => r.projectContractorId === ids.main);
    assert.equal(sub.onSite, true);
    assert.deepEqual(sub.missingDocuments.map((d: { code: string }) => d.code), ['MOBILISATION_AGREEMENT']);
    assert.equal(main.onSite, false);
    assert.deepEqual(main.missingDocuments, [], 'the main contractor filed its agreement');
  });

  it('milestone-deadlines job: DUE then OVERDUE, one notification per state, one default case', async () => {
    const notes = () => prisma.webNotification.count({ where: { projectId: ids.project, category: 'CONTRACT_MILESTONE' } });
    const start = await notes();
    await jobs.runJobOnce('milestone-deadlines', noonOf(addDays(today, 14)));
    const mainRow = find(await milestones(), 'mobilised', ids.main);
    const stored = await prisma.projectContractMilestone.findUniqueOrThrow({ where: { id: mainRow.id } });
    assert.equal(stored.status, 'DUE');
    const afterDue = await notes();
    assert.ok(afterDue > start);
    const dueNote = await prisma.webNotification.findFirstOrThrow({ where: { projectId: ids.project, category: 'CONTRACT_MILESTONE', title: { startsWith: 'Due today' } } });
    const contractorOrg = (await prisma.projectContractor.findUniqueOrThrow({ where: { id: ids.main } })).organizationId;
    assert.equal(dueNote.targetOrganizationId, contractorOrg, 'aimed at the responsible contractor');
    assert.ok(dueNote.targetRoleId, 'aimed at the responsible role');
    await jobs.runJobOnce('milestone-deadlines', noonOf(addDays(today, 15)));
    const afterOverdue = await notes();
    assert.equal((await prisma.projectContractMilestone.findUniqueOrThrow({ where: { id: mainRow.id } })).status, 'OVERDUE');
    await jobs.runJobOnce('milestone-deadlines', noonOf(addDays(today, 16)));
    assert.equal(await notes(), afterOverdue, 'no second notification for the same state');
    const cases = await prisma.contractorDefaultCase.findMany({ where: { projectId: ids.project } });
    assert.equal(cases.length, 1, 'only the contractor that did not check in');
    assert.equal(cases[0].projectContractorId, ids.main);
    assert.equal(cases[0].trigger, 'MILESTONE_OVERDUE');
    ids.mainCase = cases[0].id;
    const manual = await request(app)
      .post(url('/default-cases'))
      .set(await web('monitor@insite.ng'))
      .send({ projectContractorId: ids.main, summary: 'A second case for the same contractor' });
    assert.equal(manual.body.error.code, 'DEFAULT_CASE_ALREADY_OPEN');
  });

  it('default case: review, organisation-scoped decision, termination side effects', async () => {
    // An open claim and a live session of the contractor before the decision.
    const contractorUser = await prisma.user.findUniqueOrThrow({ where: { email: 'contractor@insite.ng' } });
    const tranche = await prisma.facilityTranche.findFirstOrThrow({ where: { projectId: ids.project } });
    const ipc = await prisma.ipcClaim.create({
      data: {
        projectId: ids.project,
        trancheId: tranche.id,
        projectContractorId: ids.main,
        ipcNumber: 1,
        periodStart: new Date(),
        periodEnd: new Date(),
        totalClaimedAmountNgn: 1000,
        submittedByUserId: contractorUser.id,
      },
    });
    await prisma.boqItem.update({ where: { id: ids.items[0] }, data: { cumulativeCertifiedPct: 40 } });

    const act = (email: string, body: Record<string, unknown>) =>
      web(email).then((h) => request(app).post(url(`/default-cases/${ids.mainCase}/act`)).set(h).send(body));
    assert.equal((await act('monitor@insite.ng', { decision: 'RETURN', notes: 'nothing to return' })).body.error.code, 'NOTHING_TO_RETURN');
    const reviewed = await act('monitor@insite.ng', { decision: 'APPROVE', notes: 'Notice of default served' });
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
    assert.equal(reviewed.body.data.atDecisionStep, true);
    const wrongOrg = await act('p13.exec2@insite.ng', { decision: 'APPROVE', outcome: 'TERMINATED' });
    assert.equal(wrongOrg.status, 403);
    assert.equal(wrongOrg.body.error.code, 'NOT_STEP_ORGANIZATION');
    const noPermission = await act('monitor@insite.ng', { decision: 'APPROVE', outcome: 'TERMINATED' });
    assert.equal(noPermission.status, 403);
    const view = await request(app).get(url(`/default-cases/${ids.mainCase}`)).set(await web('p13.exec@insite.ng'));
    assert.equal(view.body.data.approval.canAct, true);
    assert.deepEqual(view.body.data.terminationBlockedBy.map((x: { ipcNumber: number }) => x.ipcNumber), [1]);

    // An active claim blocks termination until it is paid (lender decision), certified or not.
    for (const status of ['SUBMITTED', 'MONITOR_CERTIFIED'] as const) {
      await prisma.ipcClaim.update({ where: { id: ipc.id }, data: { status } });
      const blocked = await act('p13.exec@insite.ng', { decision: 'APPROVE', outcome: 'TERMINATED', notes: 'Failed to mobilise' });
      assert.equal(blocked.status, 409, status);
      assert.equal(blocked.body.error.code, 'ACTIVE_CLAIMS_BLOCK_TERMINATION');
      assert.equal(blocked.body.error.details.claims[0].ipcNumber, 1);
    }
    assert.equal((await prisma.projectContractor.findUniqueOrThrow({ where: { id: ids.main } })).contractStatus, 'ACTIVE');
    assert.equal(await prisma.approvalAction.count({ where: { subjectId: ids.mainCase, stepOrder: 2 } }), 0, 'nothing recorded');
    await prisma.ipcClaim.update({ where: { id: ipc.id }, data: { status: 'LENDER_DECIDED' } });
    const paid = await request(app).get(url(`/default-cases/${ids.mainCase}`)).set(await web('p13.exec@insite.ng'));
    assert.deepEqual(paid.body.data.terminationBlockedBy, []);
    const decided = await act('p13.exec@insite.ng', { decision: 'APPROVE', outcome: 'TERMINATED', notes: 'Failed to mobilise' });
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    assert.equal(decided.body.data.status, 'TERMINATED');

    const pc = await prisma.projectContractor.findUniqueOrThrow({ where: { id: ids.main } });
    assert.equal(pc.contractStatus, 'TERMINATED');
    assert.equal(await prisma.projectJoinCode.count({ where: { projectContractorId: ids.main, isActive: true } }), 0);
    assert.equal((await prisma.fieldAgentSession.findUniqueOrThrow({ where: { id: ids.mainSession } })).isActive, false);
    assert.equal((await prisma.ipcClaim.findUniqueOrThrow({ where: { id: ipc.id } })).status, 'LENDER_DECIDED', 'the paid claim stays as history');
    assert.equal(find(await milestones(), 'mobilised', ids.main).status, 'WAIVED');
    assert.equal(await auditCount('CONTRACTOR_TERMINATED'), 1);
    // A revoked session can no longer report.
    const revoked = await request(app).get(url('/milestones')).set(field(ids.mainSession));
    assert.ok(revoked.status === 401 || revoked.status === 403);
  });

  it('replacement: items not fully certified move, certified % and history stay, new milestones count from today', async () => {
    const h = await web('admin@insite.ng');
    const res = await request(app)
      .post(url(`/contractors/${ids.main}/replace`))
      .set(h)
      .send({ organization: { name: 'P13 Replacement Builders Ltd' }, tradeCategory: 'Civil works', tradeCode: 'CIV2' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    ids.replacement = res.body.data.projectContractorId;
    assert.equal(res.body.data.movedItemCount, 1);
    assert.equal(res.body.data.createdMilestoneCount, 1);
    const item = await prisma.boqItem.findUniqueOrThrow({ where: { id: ids.items[0] } });
    assert.equal(item.projectContractorId, ids.replacement);
    assert.equal(Number(item.cumulativeCertifiedPct), 40);
    assert.equal(await prisma.ipcClaim.count({ where: { projectContractorId: ids.main } }), 1, 'claims stay with the terminated contractor');
    const replacement = await prisma.projectContractor.findUniqueOrThrow({ where: { id: ids.replacement } });
    assert.equal(replacement.isMainContractor, true);
    assert.equal(replacement.replacesProjectContractorId, ids.main);
    const m = find(await milestones(), 'mobilised', ids.replacement);
    assert.equal(m.anchorDateOverride, today);
    assert.equal(m.dueDate, addDays(today, 14));
    const again = await request(app).post(url(`/contractors/${ids.main}/replace`)).set(h).send({ organization: { name: 'Another Ltd' }, tradeCategory: 'Civil', tradeCode: 'CIV3' });
    assert.equal(again.body.error.code, 'CONTRACTOR_ALREADY_REPLACED');
    assert.ok(res.body.data.issuedJoinCodes.length >= 0);
    const setup = await request(app).get(url('/setup')).set(h);
    const old = setup.body.data.parties.contractors.find((c: { id: string }) => c.id === ids.main);
    assert.equal(old.contractStatus, 'TERMINATED');
  });

  it('programme of works: the contractor proposes, the monitor accepts and the baseline is written', async () => {
    const sub = await web('p13.subco@insite.ng');
    const body = {
      plannedStartDate: addDays(today, 1),
      plannedEndDate: addDays(today, 120),
      items: [{ boqItemId: ids.items[1], plannedStartDate: addDays(today, 7), plannedEndDate: addDays(today, 40) }],
      dependencies: [],
    };
    const other = await request(app)
      .post(url('/programme-of-works'))
      .set(sub)
      .send({ ...body, items: [{ boqItemId: ids.items[0], plannedStartDate: addDays(today, 7), plannedEndDate: addDays(today, 40) }] });
    assert.equal(other.body.error.code, 'ITEM_OTHER_CONTRACTOR');
    const terminated = await request(app).post(url('/programme-of-works')).set(await web('contractor@insite.ng')).send(body);
    assert.equal(terminated.body.error.code, 'CONTRACTOR_TERMINATED');
    // Dependencies: the successor must be an item of the programme; the predecessor needs dates.
    const dep = { predecessorBoqItemId: ids.items[0], successorBoqItemId: ids.items[1], lagWorkdays: 1 };
    const undated = await request(app).post(url('/programme-of-works')).set(sub).send({ ...body, dependencies: [dep] });
    assert.equal(undated.status, 422);
    assert.equal(undated.body.error.details.issues[0].code, 'DEPENDENCY_UNDATED');
    const outside = await request(app)
      .post(url('/programme-of-works'))
      .set(sub)
      .send({ ...body, dependencies: [{ predecessorBoqItemId: ids.items[1], successorBoqItemId: ids.items[0], lagWorkdays: 0 }] });
    assert.equal(outside.body.error.code, 'DEPENDENCY_OUTSIDE_PROGRAMME');
    // The replacement's item is dated (as its own programme would have done); the link is now valid.
    await prisma.boqItem.update({ where: { id: ids.items[0] }, data: { plannedStartDate: addDays(today, 1), plannedEndDate: addDays(today, 3) } });
    const submitted = await request(app).post(url('/programme-of-works')).set(sub).send({ ...body, dependencies: [dep] });
    assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
    assert.equal(submitted.body.data.proposal.dependencies.length, 1);
    assert.equal((await request(app).post(url('/programme-of-works')).set(sub).send(body)).body.error.code, 'PROGRAMME_PENDING');
    assert.equal((await request(app).post(url(`/programme-of-works/${submitted.body.data.id}/decision`)).set(sub).send({ decision: 'ACCEPT' })).status, 403);
    const accepted = await request(app)
      .post(url(`/programme-of-works/${submitted.body.data.id}/decision`))
      .set(await web('monitor@insite.ng'))
      .send({ decision: 'ACCEPT', notes: 'Agreed at the site meeting' });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    const item = await prisma.boqItem.findUniqueOrThrow({ where: { id: ids.items[1] } });
    assert.equal(item.plannedStartDate, addDays(today, 7));
    const links = await prisma.boqItemDependency.findMany({ where: { projectId: ids.project } });
    assert.deepEqual(
      links.map((l) => [l.predecessorBoqItemId, l.successorBoqItemId, l.lagWorkdays]),
      [[ids.items[0], ids.items[1], 1]],
      'the accepted link is part of the baseline'
    );
    const project = await prisma.project.findUniqueOrThrow({ where: { id: ids.project } });
    assert.equal(project.plannedStartDate, addDays(today, 1));
    assert.equal(find(await milestones(), 'programme').status, 'DONE');
    // A live project's dated items do not move through a programme.
    const dated = await request(app).post(url('/programme-of-works')).set(sub).send(body);
    assert.equal(dated.body.error.code, 'ITEM_ALREADY_DATED');
  });

  it('CP evidence is a register document of the same project', async () => {
    const tranche = await prisma.facilityTranche.findFirstOrThrow({ where: { projectId: ids.project } });
    const cp = await prisma.conditionPrecedent.create({ data: { trancheId: tranche.id, referenceCode: 'CP-01', description: 'Soil report approved' } });
    const path = url(`/tranches/${tranche.id}/conditions/${cp.id}/status`);
    const h = await web('monitor@insite.ng');
    const elsewhere = await prisma.projectDocument.create({
      data: {
        projectId: ids.other,
        documentTypeId: (await prisma.documentType.findFirstOrThrow({ where: { tenantId: ids.tenant, code: 'OTHER' } })).id,
        title: 'Other project file',
        versions: { create: { version: 1, objectKey: `other-${crypto.randomUUID()}`, mimeType: 'application/pdf', byteSize: 1, sha256: 'x' } },
      },
    });
    assert.equal((await request(app).patch(path).set(h).send({ status: 'SATISFIED', evidenceDocumentId: elsewhere.id })).status, 404);
    const ok = await request(app).patch(path).set(h).send({ status: 'SATISFIED', evidenceDocumentId: ids.cpDoc });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal((await prisma.conditionPrecedent.findUniqueOrThrow({ where: { id: cp.id } })).evidenceDocumentId, ids.cpDoc);
  });

  it('the contract default chain is the third chain: shown with a default, validated when replaced', async () => {
    const h = await web('admin@insite.ng');
    const settings = await request(app).get(url('/process')).set(h);
    assert.equal(settings.status, 200);
    const chain = settings.body.data.contractDefaultChain;
    assert.equal(chain.steps.at(-1).requiredPermissionKey, 'contracts:decide_default');
    assert.equal(chain.steps.at(-1).organizationScope, 'PROJECT_OWNER');
    const bad = await request(app)
      .put(url('/process/chains/CONTRACT_DEFAULT'))
      .set(h)
      .send({ steps: [{ label: 'Only review', requiredPermissionKey: 'contracts:raise_default' }] });
    assert.equal(bad.status, 422);
    const good = await request(app)
      .put(url('/process/chains/CONTRACT_DEFAULT'))
      .set(h)
      .send({
        steps: [
          { label: 'Legal review', requiredPermissionKey: 'contracts:raise_default' },
          { label: 'Owner decision', requiredPermissionKey: 'contracts:decide_default', isSystemStep: true, organizationScope: 'PROJECT_OWNER_OR_ANCESTOR' },
        ],
      });
    assert.equal(good.status, 200, JSON.stringify(good.body));
    assert.equal(good.body.data.contractDefaultChain.version, chain.version + 1);
    // The case decided earlier keeps the version it ran on.
    const decided = await prisma.contractorDefaultCase.findUniqueOrThrow({ where: { id: ids.mainCase } });
    assert.equal(decided.chainVersion, chain.version);
  });
});
