/**
 * Redesign R5a route tests: the mobile baseline pack v2 (D-R5.3) for a provisioned account.
 *
 * resident.supervisor@ (provisioned mobile, Independent Resident) is assigned to PRG-102 and PRG-105
 * (seedR4). PRG-102 is mobilising (kick-off held 16 days ago, contractor on site due in 5 days) with
 * three upcoming sprints and units U01–U03 (U03: 120 nr pupils' furniture); PRG-105 is in
 * construction with sprints 1 −98..−60, 2 −59..−15, 3 −14..+80 and units U01–U02 (seedR2, seedPhase13).
 */
import { resetTestDatabase } from './helpers/testDb';
import { makeTestDeviceKey } from './helpers/fieldAuth';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Express } from 'express';
import request from 'supertest';
import { MobileBaselinePackSchema, type MobileBaselinePack } from '@insite/shared';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
const ids: Record<string, string> = {};
let token = '';

async function pack(projectId: string, auth = token) {
  return request(app).get(`/api/v1/auth/mobile/projects/${projectId}/baseline`).set({ Authorization: `Bearer ${auth}` });
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  const { createApp } = await import('../app');
  app = createApp();
  ids.prg102 = (await prisma.project.findFirstOrThrow({ where: { codePrefix: 'PRG-102' } })).id;
  ids.prg105 = (await prisma.project.findFirstOrThrow({ where: { codePrefix: 'PRG-105' } })).id;
  ids.lkk = (await prisma.project.findFirstOrThrow({ where: { codePrefix: 'LKK-402' } })).id;
  const key = makeTestDeviceKey();
  const login = await request(app).post('/api/v1/auth/mobile/login').send({
    email: 'resident.supervisor@ubec.test',
    password: 'Password123!',
    deviceId: 'r5-pack-device',
    deviceModel: 'Pixel 8',
    deviceOs: 'Android 15',
    devicePublicKey: key.publicKey,
    devicePublicKeyAlg: 'ED25519',
  });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  token = login.body.data.accessToken as string;
});

describe('Redesign R5a: mobile baseline pack v2', () => {
  it('PRG-102: mobilising, three upcoming sprints, its units and the contractor-on-site milestone', async () => {
    const res = await pack(ids.prg102);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const p = MobileBaselinePackSchema.parse(res.body.data) as MobileBaselinePack;
    assert.equal(p.packVersion, 2);
    assert.equal(p.projectStatus, 'ACTIVE');
    assert.equal(p.stage?.current, 'MOBILISATION');
    assert.ok(p.workWeekDays.length > 0);
    assert.ok(p.contractorName, 'the contractor organisation is named');

    assert.deepEqual(p.sprints.map((s) => s.number), [1, 2, 3]);
    assert.ok(p.sprints.every((s) => s.status === 'UPCOMING'), JSON.stringify(p.sprints.map((s) => s.status)));
    assert.ok(p.sprints[0].name.length > 0);

    const codes = p.facilityUnits.map((u) => u.code).sort();
    assert.deepEqual(codes, ['U01', 'U02', 'U03']);
    const furniture = p.facilityUnits.find((u) => u.code === 'U03')!;
    assert.equal(furniture.plannedQuantity, 120);
    assert.equal(furniture.archetype, 'SUPPLY_INSTALLATION');
    assert.ok(p.facilityUnits.every((u) => u.facilityName && u.startSprintNumber !== null && u.endSprintNumber !== null));

    assert.ok(p.mobilisation, 'the contractor-on-site milestone is open');
    assert.ok(p.mobilisation!.startedOn && p.mobilisation!.deadline);
    assert.ok(p.mobilisation!.startedOn! < p.mobilisation!.deadline!);
    assert.equal(p.mobilisation!.status, 'PENDING');
    assert.equal(typeof p.openDefectCount, 'number');
  });

  it('PRG-105: in construction with an active sprint, ended sprints and two units', async () => {
    const res = await pack(ids.prg105);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const p = MobileBaselinePackSchema.parse(res.body.data) as MobileBaselinePack;
    assert.equal(p.stage?.current, 'CONSTRUCTION');
    assert.deepEqual(p.sprints.map((s) => s.number), [1, 2, 3]);
    assert.equal(p.sprints[2].status, 'ACTIVE');
    assert.ok(['ENDED', 'LATE', 'VERIFIED'].includes(p.sprints[0].status), p.sprints[0].status);
    assert.deepEqual(p.facilityUnits.map((u) => u.code).sort(), ['U01', 'U02']);
    assert.equal(p.mobilisation, null, 'the contractor is on site');
    for (const f of p.openFindings) {
      assert.ok(f.raisedDate <= f.escalatesOn);
      if (f.unitId) assert.ok(f.unitLabel);
    }
    // Redesign R5e: the pre-R5 app's fields are gone.
    for (const legacy of ['reportingCadence', 'cadence', 'boqItems', 'holdPoints', 'inspections']) {
      assert.ok(!(legacy in res.body.data), `the pack still carries ${legacy}`);
    }
  });

  it('open findings match the project and carry facility names', async () => {
    const open = await prisma.finding.findMany({ where: { projectId: ids.prg105, status: 'OPEN' } });
    const res = await pack(ids.prg105);
    const p = res.body.data as MobileBaselinePack;
    assert.equal(p.openFindings.length, open.length);
    for (const f of p.openFindings) if (f.facilityId) assert.ok(f.facilityName);
  });

  it('refuses a project the account is not assigned to', async () => {
    const res = await pack(ids.lkk);
    assert.ok([403, 404].includes(res.status), String(res.status));
  });
});
