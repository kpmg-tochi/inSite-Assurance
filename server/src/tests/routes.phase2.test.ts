/**
 * Phase 2 route-level security tests. Runs against a disposable database rebuilt from migrations
 * (see helpers/testDb.ts). Run with `npm run test:routes --workspace=@insite/server`.
 */
import { TEST_DATABASE_URL, resetTestDatabase } from './helpers/testDb';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Express } from 'express';
import request from 'supertest';

type Prisma = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: Prisma;
let signFieldAgentToken: typeof import('../middleware/auth.middleware')['signFieldAgentToken'];
let recordAuditEvent: typeof import('../modules/audit/audit.service')['recordAuditEvent'];
let getAndVerifyProjectAuditTrail: typeof import('../modules/audit/audit.service')['getAndVerifyProjectAuditTrail'];

const PASSWORD = 'Password123!';

const ids = {
  tenantA: '',
  tenantB: '',
  lkk: '',
  abj: '',
  unassignedA: '',
  projectB: '',
  abjBoq: '',
  abjPayment: '',
  lkkBoq: '',
  lkkFieldSession: '',
  tenantBAdminEmail: 'admin@tenant-b.test',
};

async function login(email: string, password = PASSWORD): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  assert.equal(res.status, 200, `login ${email}: ${JSON.stringify(res.body)}`);
  return res.body.data.accessToken as string;
}

/** Logs in a user created with a temporary password and completes the forced password change. */
async function loginAndActivate(email: string, tempPassword: string): Promise<string> {
  const temp = await login(email, tempPassword);
  const newPassword = `${tempPassword}x9`;
  const res = await request(app)
    .post('/api/v1/auth/change-password')
    .set('Authorization', `Bearer ${temp}`)
    .send({ currentPassword: tempPassword, newPassword });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data.accessToken as string;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Every route mounted under /api/v1/projects that takes :projectId. */
function projectScopedRoutes(): Array<{ method: string; path: string }> {
  const out: Array<{ method: string; path: string }> = [];
  type Layer = {
    name: string;
    regexp: RegExp;
    handle: { stack?: Layer[] };
    route?: { path: string; methods: Record<string, boolean> };
  };
  const stack = (app as unknown as { _router: { stack: Layer[] } })._router.stack;
  for (const layer of stack) {
    if (layer.name !== 'router' || !layer.regexp.test('/api/v1/projects')) continue;
    for (const sub of layer.handle.stack ?? []) {
      if (!sub.route || !sub.route.path.includes(':projectId')) continue;
      for (const method of Object.keys(sub.route.methods)) {
        out.push({ method, path: `/api/v1/projects${sub.route.path}` });
      }
    }
  }
  return out;
}

function fillPath(path: string, projectId: string): string {
  return path.replace(':projectId', projectId).replace(/:[A-Za-z]+/g, () => crypto.randomUUID());
}

async function call(method: string, path: string, token: string) {
  const r = request(app);
  const req =
    method === 'get' ? r.get(path) :
    method === 'post' ? r.post(path) :
    method === 'put' ? r.put(path) :
    method === 'patch' ? r.patch(path) :
    r.delete(path);
  return req.set(bearer(token)).send({});
}

before(async () => {
  await resetTestDatabase();

  ({ prisma } = await import('../config/prisma'));
  ({ signFieldAgentToken } = await import('../middleware/auth.middleware'));
  ({ recordAuditEvent, getAndVerifyProjectAuditTrail } = await import('../modules/audit/audit.service'));
  const { createApp } = await import('../app');

  app = createApp();

  const tenantA = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'kpmg-nigeria' } });
  ids.tenantA = tenantA.id;
  const lkk = await prisma.project.findFirstOrThrow({ where: { tenantId: tenantA.id, codePrefix: 'LKK-402' } });
  const abj = await prisma.project.findFirstOrThrow({ where: { tenantId: tenantA.id, codePrefix: 'ABJ-108' } });
  ids.lkk = lkk.id;
  ids.abj = abj.id;
  ids.abjBoq = (await prisma.boqItem.findFirstOrThrow({ where: { projectId: abj.id } })).id;
  ids.abjPayment = (await prisma.projectPayment.findFirstOrThrow({ where: { projectId: abj.id } })).id;
  ids.lkkBoq = (await prisma.boqItem.findFirstOrThrow({ where: { projectId: lkk.id } })).id;
  ids.lkkFieldSession = (
    await prisma.fieldAgentSession.findFirstOrThrow({
      where: { projectId: lkk.id, isActive: true, role: { code: 'INDEPENDENT_RESIDENT' } },
    })
  ).id;

  // A tenant-A project nobody is assigned to.
  const unassigned = await prisma.project.create({
    data: {
      tenantId: tenantA.id,
      name: 'Unassigned Test Project',
      codePrefix: 'TST-001',
      stateLocation: 'Lagos State',
      totalBudgetNgn: 1000000,
      geofenceMode: 'RADIAL',
      geofenceGeoJson: { mode: 'RADIAL', center: { latitude: 6.5, longitude: 3.4 }, radiusMeters: 500 },
      monitorOrganizationId: lkk.monitorOrganizationId,
      lenderOrganizationId: lkk.lenderOrganizationId,
      status: 'ACTIVE',
    },
  });
  ids.unassignedA = unassigned.id;

  // Tenant B, provisioned through the platform admin API, with one project.
  const platformToken = await login('admin@insite.ng');
  const tRes = await request(app)
    .post('/api/v1/rbac/tenants')
    .set(bearer(platformToken))
    .send({
      name: 'Tenant B Advisory',
      slug: 'tenant-b',
      adminFullName: 'Bola Admin',
      adminEmail: ids.tenantBAdminEmail,
      adminPassword: 'TempPass123',
    });
  assert.equal(tRes.status, 201, JSON.stringify(tRes.body));
  ids.tenantB = tRes.body.data.id;
  const orgB = await prisma.organization.findFirstOrThrow({ where: { tenantId: ids.tenantB } });
  const projectB = await prisma.project.create({
    data: {
      tenantId: ids.tenantB,
      name: 'Tenant B Project',
      codePrefix: 'LKK-402', // same prefix as tenant A: prefixes are unique per tenant only
      stateLocation: 'Rivers State',
      totalBudgetNgn: 5000000,
      geofenceMode: 'RADIAL',
      geofenceGeoJson: { mode: 'RADIAL', center: { latitude: 4.8, longitude: 7.0 }, radiusMeters: 500 },
      monitorOrganizationId: orgB.id,
      lenderOrganizationId: orgB.id,
      status: 'ACTIVE',
      contractorExecutionMode: 'SINGLE_CONTRACTOR',
      contractors: {
        create: { organizationId: orgB.id, tradeCategory: 'General works', tradeCode: 'GEN', isMainContractor: true },
      },
    },
  });
  ids.projectB = projectB.id;
});

after(async () => {
  await prisma?.$disconnect();
});

describe('Phase 2 route security', { concurrency: false }, () => {
  it(`uses a disposable database (${new URL(TEST_DATABASE_URL).pathname})`, () => {
    assert.ok(new URL(TEST_DATABASE_URL).pathname.endsWith('_test'));
  });

  describe('authentication', () => {
    it('closes public registration outside demo mode', async () => {
      const res = await request(app).post('/api/v1/auth/register').send({
        fullName: 'Mallory',
        email: 'mallory@example.com',
        password: 'Password123!',
        tenantSlug: 'kpmg-nigeria',
        roleCode: 'TENANT_SUPER_ADMIN',
        organizationName: 'Evil Co',
      });
      assert.equal(res.status, 404);
    });

    it('issues tokens that carry identity only', async () => {
      const token = await login('monitor@insite.ng');
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      assert.deepEqual(Object.keys(claims).sort(), ['exp', 'iat', 'tenantId', 'tokenType', 'tokenVersion', 'userId']);
    });

    it('blocks login for an inactive user and revokes their existing token', async () => {
      const token = await login('lender@insite.ng');
      await prisma.user.update({ where: { email: 'lender@insite.ng' }, data: { isActive: false } });
      const { invalidateUserAuthCache } = await import('../middleware/auth.middleware');
      const lender = await prisma.user.findUniqueOrThrow({ where: { email: 'lender@insite.ng' } });
      invalidateUserAuthCache(lender.id);
      try {
        const loginRes = await request(app).post('/api/v1/auth/login').send({ email: 'lender@insite.ng', password: PASSWORD });
        assert.equal(loginRes.status, 401);
        const me = await request(app).get('/api/v1/auth/me').set(bearer(token));
        assert.equal(me.status, 401);
      } finally {
        await prisma.user.update({ where: { email: 'lender@insite.ng' }, data: { isActive: true } });
        invalidateUserAuthCache(lender.id);
      }
    });

    it('blocks login and API access for a suspended tenant', async () => {
      const activeToken = await loginAndActivate(ids.tenantBAdminEmail, 'TempPass123');
      await prisma.tenant.update({ where: { id: ids.tenantB }, data: { status: 'SUSPENDED' } });
      const { clearAuthCache } = await import('../middleware/auth.middleware');
      clearAuthCache();
      try {
        const res = await request(app).post('/api/v1/auth/login').send({ email: ids.tenantBAdminEmail, password: 'TempPass123x9' });
        assert.equal(res.status, 403);
        assert.equal(res.body.error.code, 'TENANT_SUSPENDED');
        const roles = await request(app).get('/api/v1/rbac/roles').set(bearer(activeToken));
        assert.equal(roles.status, 403);
      } finally {
        await prisma.tenant.update({ where: { id: ids.tenantB }, data: { status: 'ACTIVE' } });
        clearAuthCache();
      }
    });

    it('locks an account after repeated failed sign-ins', async () => {
      for (let i = 0; i < 5; i++) {
        const r = await request(app).post('/api/v1/auth/login').send({ email: 'contractor@insite.ng', password: 'wrong-password' });
        assert.equal(r.status, 401);
      }
      const locked = await request(app).post('/api/v1/auth/login').send({ email: 'contractor@insite.ng', password: PASSWORD });
      assert.equal(locked.status, 423);
      await prisma.user.update({ where: { email: 'contractor@insite.ng' }, data: { lockedUntil: null, failedLoginCount: 0 } });
    });

    it('forces a password change for admin-created users', async () => {
      const temp = await login(ids.tenantBAdminEmail, 'TempPass123x9');
      // Already changed above; a fresh admin-created user should be blocked until they change it.
      const created = await request(app)
        .post('/api/v1/rbac/users')
        .set(bearer(temp))
        .send({
          fullName: 'New Person',
          email: 'new.person@tenant-b.test',
          password: 'TempPass456',
          roleId: (await prisma.role.findFirstOrThrow({ where: { tenantId: ids.tenantB, code: 'LENDER' } })).id,
          organizationName: 'Tenant B Advisory',
        });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const newToken = await login('new.person@tenant-b.test', 'TempPass456');
      const blocked = await request(app).get('/api/v1/projects').set(bearer(newToken));
      assert.equal(blocked.status, 403);
      assert.equal(blocked.body.error.code, 'PASSWORD_CHANGE_REQUIRED');
      const me = await request(app).get('/api/v1/auth/me').set(bearer(newToken));
      assert.equal(me.status, 200);
      assert.equal(me.body.data.user.mustChangePassword, true);
    });
  });

  describe('tenant and project isolation', () => {
    it('refuses a tenant-A token on every project-scoped route of tenant B', async () => {
      const token = await login('monitor@insite.ng');
      const routes = projectScopedRoutes();
      assert.ok(routes.length > 30, `expected the full route table, got ${routes.length}`);
      const failures: string[] = [];
      for (const route of routes) {
        const res = await call(route.method, fillPath(route.path, ids.projectB), token);
        if (res.status !== 403 && res.status !== 404) {
          failures.push(`${route.method.toUpperCase()} ${route.path} -> ${res.status}`);
        }
      }
      assert.deepEqual(failures, []);
    });

    it('refuses a user without projects:view_all_tenant on an unassigned project', async () => {
      const token = await login('contractor@insite.ng');
      const res = await request(app).get(`/api/v1/projects/${ids.unassignedA}/baseline`).set(bearer(token));
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'FORBIDDEN_PROJECT_ASSIGNMENT');
      const assigned = await request(app).get(`/api/v1/projects/${ids.lkk}/baseline`).set(bearer(token));
      assert.equal(assigned.status, 200);
    });

    it('lists only visible projects', async () => {
      const contractor = await login('contractor@insite.ng');
      const res = await request(app).get('/api/v1/projects').set(bearer(contractor));
      assert.equal(res.status, 200);
      const codes = res.body.data.map((p: { id: string }) => p.id).sort();
      // Assigned, live projects only (Phase 6 seeds more; drafts never appear here).
      const assigned = await prisma.project.findMany({
        where: { status: { not: 'DRAFT' }, userAssignments: { some: { user: { email: 'contractor@insite.ng' } } } },
        select: { id: true },
      });
      assert.ok(codes.includes(ids.abj) && codes.includes(ids.lkk));
      assert.deepEqual(codes, assigned.map((p) => p.id).sort());
    });

    it('refuses a field agent on every project-scoped route of another project', async () => {
      const token = signFieldAgentToken({ sessionId: ids.lkkFieldSession });
      const failures: string[] = [];
      for (const route of projectScopedRoutes()) {
        const res = await call(route.method, fillPath(route.path, ids.abj), token);
        if (res.status !== 403 && res.status !== 404) {
          failures.push(`${route.method.toUpperCase()} ${route.path} -> ${res.status}`);
        }
      }
      assert.deepEqual(failures, []);
    });

    it('rejects unknown token types', async () => {
      const jwt = (await import('jsonwebtoken')).default;
      const { env } = await import('../config/env');
      const forged = jwt.sign({ tokenType: 'SOMETHING_ELSE', sessionId: ids.lkkFieldSession }, env.JWT_SECRET);
      const res = await request(app).get(`/api/v1/projects/${ids.lkk}/boq`).set(bearer(forged));
      assert.equal(res.status, 401);
    });
  });

  describe('session revocation', () => {
    it('refuses a revoked field session on the next request', async () => {
      const fieldToken = signFieldAgentToken({ sessionId: ids.lkkFieldSession });
      const ok = await request(app).get(`/api/v1/projects/${ids.lkk}/boq`).set(bearer(fieldToken));
      assert.equal(ok.status, 200); // also warms the auth cache

      const monitor = await login('monitor@insite.ng');
      const revoke = await request(app)
        .patch(`/api/v1/projects/${ids.lkk}/field-sessions/${ids.lkkFieldSession}/status`)
        .set(bearer(monitor))
        .send({ isActive: false, reason: 'Lost device' });
      assert.equal(revoke.status, 200, JSON.stringify(revoke.body));
      assert.equal(revoke.body.data.agentPinHash, undefined);

      const refused = await request(app).get(`/api/v1/projects/${ids.lkk}/boq`).set(bearer(fieldToken));
      assert.equal(refused.status, 403);
      assert.equal(refused.body.error.code, 'SESSION_REVOKED');

      await request(app)
        .patch(`/api/v1/projects/${ids.lkk}/field-sessions/${ids.lkkFieldSession}/status`)
        .set(bearer(monitor))
        .send({ isActive: true });
    });
  });

  describe('ownership of IDs in bodies (Step 3)', () => {
    it('rejects voiding a payment that belongs to another project', async () => {
      const lender = await login('lender@insite.ng');
      const res = await request(app)
        .post(`/api/v1/projects/${ids.lkk}/payments/${ids.abjPayment}/void`)
        .set(bearer(lender))
        .send({ reason: 'Wrong project, should never be found' });
      assert.equal(res.status, 404, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'PAYMENT_NOT_FOUND');
      const untouched = await prisma.projectPayment.findUniqueOrThrow({ where: { id: ids.abjPayment } });
      assert.equal(untouched.voidedAt, null);
    });

    it('rejects confirming a hold point on another project item', async () => {
      const monitor = await login('monitor@insite.ng');
      const res = await request(app)
        .patch(`/api/v1/projects/${ids.lkk}/boq/mappings`)
        .set(bearer(monitor))
        .send({ updates: [{ boqItemId: ids.abjBoq, isHoldPoint: false }] });
      assert.equal(res.status, 404);
    });

    it('rejects assigning a user to another tenant project', async () => {
      const admin = await login(ids.tenantBAdminEmail, 'TempPass123x9');
      const lenderRole = await prisma.role.findFirstOrThrow({ where: { tenantId: ids.tenantB, code: 'LENDER' } });
      const res = await request(app)
        .post('/api/v1/rbac/users')
        .set(bearer(admin))
        .send({
          fullName: 'Cross Tenant',
          email: 'cross@tenant-b.test',
          password: 'TempPass789',
          roleId: lenderRole.id,
          organizationName: 'Tenant B Advisory',
          projectIds: [ids.lkk],
        });
      assert.equal(res.status, 404);
    });
  });

  describe('RBAC', () => {
    it('applies a role edit on the next request', async () => {
      const monitor = await login('monitor@insite.ng');
      const before = await request(app).get(`/api/v1/projects/${ids.lkk}/audit-trail`).set(bearer(monitor));
      assert.equal(before.status, 200);

      const admin = await login('admin@insite.ng');
      const monitorRole = await prisma.role.findFirstOrThrow({
        where: { tenantId: ids.tenantA, code: 'MONITOR' },
        include: { rolePermissions: { include: { permission: true } } },
      });
      const originalIds = monitorRole.rolePermissions.map((rp) => rp.permissionId);
      const withoutLedger = monitorRole.rolePermissions
        .filter((rp) => rp.permission.key !== 'audit:view_ledger')
        .map((rp) => rp.permissionId);

      const edit = await request(app)
        .put(`/api/v1/rbac/roles/${monitorRole.id}`)
        .set(bearer(admin))
        .send({ permissionIds: withoutLedger });
      assert.equal(edit.status, 200, JSON.stringify(edit.body));

      const afterEdit = await request(app).get(`/api/v1/projects/${ids.lkk}/audit-trail`).set(bearer(monitor));
      assert.equal(afterEdit.status, 403);

      await request(app).put(`/api/v1/rbac/roles/${monitorRole.id}`).set(bearer(admin)).send({ permissionIds: originalIds });
    });

    it('stops a user manager from granting permissions they do not hold', async () => {
      const admin = await login(ids.tenantBAdminEmail, 'TempPass123x9');
      const perms = await prisma.permission.findMany({
        where: { key: { in: ['users:invite_manage', 'projects:view_assigned'] } },
      });
      const createRole = await request(app)
        .post('/api/v1/rbac/roles')
        .set(bearer(admin))
        .send({ name: 'User Manager', code: 'user_manager', surface: 'WEB', permissionIds: perms.map((p) => p.id) });
      assert.equal(createRole.status, 201, JSON.stringify(createRole.body));
      assert.equal(createRole.body.data.code, 'USER_MANAGER');

      const dup = await request(app)
        .post('/api/v1/rbac/roles')
        .set(bearer(admin))
        .send({ name: 'Dup', code: ' user_manager ', surface: 'WEB', permissionIds: perms.map((p) => p.id) });
      assert.equal(dup.status, 409);

      const createUser = await request(app)
        .post('/api/v1/rbac/users')
        .set(bearer(admin))
        .send({
          fullName: 'Uma Manager',
          email: 'uma@tenant-b.test',
          password: 'TempPassUma1',
          roleId: createRole.body.data.id,
          organizationName: 'Tenant B Advisory',
        });
      assert.equal(createUser.status, 201, JSON.stringify(createUser.body));
      const uma = await loginAndActivate('uma@tenant-b.test', 'TempPassUma1');

      const superRole = await prisma.role.findFirstOrThrow({ where: { tenantId: ids.tenantB, code: 'TENANT_SUPER_ADMIN' } });
      const escalate = await request(app)
        .put(`/api/v1/rbac/users/${createUser.body.data.id}/assignments`)
        .set(bearer(uma))
        .send({ roleId: superRole.id, projectIds: [] });
      assert.equal(escalate.status, 403);
      assert.equal(escalate.body.error.code, 'PERMISSION_ESCALATION');
    });

    it('prevents locking the tenant out of role management', async () => {
      const admin = await login(ids.tenantBAdminEmail, 'TempPass123x9');
      const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: ids.tenantBAdminEmail } });
      const deactivateSelf = await request(app)
        .put(`/api/v1/rbac/users/${adminUser.id}/assignments`)
        .set(bearer(admin))
        .send({ isActive: false, projectIds: [] });
      assert.equal(deactivateSelf.status, 409);
      assert.equal(deactivateSelf.body.error.code, 'LAST_TENANT_ADMIN');

      const superRole = await prisma.role.findFirstOrThrow({
        where: { tenantId: ids.tenantB, code: 'TENANT_SUPER_ADMIN' },
        include: { rolePermissions: { include: { permission: true } } },
      });
      const stripped = superRole.rolePermissions
        .filter((rp) => rp.permission.key !== 'roles:create_edit')
        .map((rp) => rp.permissionId);
      const strip = await request(app)
        .put(`/api/v1/rbac/roles/${superRole.id}`)
        .set(bearer(admin))
        .send({ permissionIds: stripped });
      assert.equal(strip.status, 409);
    });

    it('writes tenant-scope audit events for role and user changes', async () => {
      const admin = await login(ids.tenantBAdminEmail, 'TempPass123x9');
      const res = await request(app).get('/api/v1/rbac/audit-trail').set(bearer(admin));
      assert.equal(res.status, 200);
      assert.equal(res.body.data.chainIntegrityVerified, true);
      const actions = res.body.data.entries.map((e: { action: string }) => e.action);
      for (const expected of ['TENANT_CREATED', 'ROLE_CREATED', 'USER_CREATED']) {
        assert.ok(actions.includes(expected), `missing ${expected} in ${actions.join(',')}`);
      }
    });
  });

  describe('responses and confidentiality', () => {
    it('does not leak field-session secrets in the baseline', async () => {
      const monitor = await login('monitor@insite.ng');
      const res = await request(app).get(`/api/v1/projects/${ids.lkk}/baseline`).set(bearer(monitor));
      assert.equal(res.status, 200);
      const body = JSON.stringify(res.body);
      for (const secret of ['agentPinHash', 'deviceSecretHash', 'idDocumentUrl', 'selfieImageUrl', 'fieldSessions']) {
        assert.ok(!body.includes(secret), `baseline leaks ${secret}`);
      }
    });

    it('hides join codes from roles without mobilization:manage_roster', async () => {
      const lender = await login('lender@insite.ng');
      const res = await request(app).get(`/api/v1/projects/${ids.lkk}/baseline`).set(bearer(lender));
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.data.joinCodes, []);
    });

    it('shields whistleblower identity from the audit ledger and from viewers without the permission', async () => {
      const fieldToken = signFieldAgentToken({ sessionId: ids.lkkFieldSession });
      const session = await prisma.fieldAgentSession.findUniqueOrThrow({ where: { id: ids.lkkFieldSession } });
      const created = await request(app)
        .post(`/api/v1/projects/${ids.lkk}/incidents`)
        .set(bearer(fieldToken))
        .send({
          clientIncidentId: crypto.randomUUID(),
          category: 'WHISTLEBLOWING',
          title: 'Cement diversion',
          description: 'Bags of cement leaving site at night on a private truck.',
          isConfidentialWhistleblower: true,
        });
      assert.equal(created.status, 201, JSON.stringify(created.body));

      const monitor = await login('monitor@insite.ng');
      const ledger = await request(app).get(`/api/v1/projects/${ids.lkk}/audit-trail`).set(bearer(monitor));
      const entry = ledger.body.data.entries.find(
        (e: { payload: { incidentId?: string } }) => e.payload.incidentId === created.body.data.id
      );
      assert.ok(entry, 'incident audit entry missing');
      const entryText = JSON.stringify(entry);
      assert.ok(!entryText.includes(session.agentFullName), 'audit entry contains reporter name');
      assert.ok(!entryText.includes(session.id), 'audit entry contains reporter session ID');
      assert.equal(entry.actorDisplayName, 'Protected disclosure');

      const list = await request(app).get(`/api/v1/projects/${ids.lkk}/incidents`).set(bearer(monitor));
      const mine = list.body.data.find((i: { id: string }) => i.id === created.body.data.id);
      assert.equal(mine.reporterName, 'Protected disclosure');
      assert.equal(mine.reporterSessionId, null);

      const admin = await login('admin@insite.ng');
      const adminList = await request(app).get(`/api/v1/projects/${ids.lkk}/incidents`).set(bearer(admin));
      const adminView = adminList.body.data.find((i: { id: string }) => i.id === created.body.data.id);
      assert.equal(adminView.reporterName, session.agentFullName);
    });

    it('rejects object keys outside the project namespace', async () => {
      const fieldToken = signFieldAgentToken({ sessionId: ids.lkkFieldSession });
      const res = await request(app)
        .get(`/api/v1/projects/${ids.lkk}/media`)
        .query({ key: `tenants/${ids.tenantB}/projects/${ids.projectB}/site_photo/x.jpg` })
        .set(bearer(fieldToken));
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'INVALID_OBJECT_KEY');
    });

    it('enforces the presign content-type allow-list and size cap', async () => {
      const fieldToken = signFieldAgentToken({ sessionId: ids.lkkFieldSession });
      const badType = await request(app)
        .post(`/api/v1/projects/${ids.lkk}/evidence/presign`)
        .set(bearer(fieldToken))
        .send({ mediaType: 'SITE_PHOTO', fileName: 'x.exe', mimeType: 'application/x-msdownload', byteSize: 100 });
      assert.equal(badType.status, 415);
      const tooBig = await request(app)
        .post(`/api/v1/projects/${ids.lkk}/evidence/presign`)
        .set(bearer(fieldToken))
        .send({ mediaType: 'SITE_PHOTO', fileName: 'x.jpg', mimeType: 'image/jpeg', byteSize: 500 * 1024 * 1024 });
      assert.equal(tooBig.status, 413);
      const ok = await request(app)
        .post(`/api/v1/projects/${ids.lkk}/evidence/presign`)
        .set(bearer(fieldToken))
        .send({ mediaType: 'SITE_PHOTO', fileName: 'x.jpg', mimeType: 'image/jpeg', byteSize: 1000 });
      assert.equal(ok.status, 200);
      assert.ok(ok.body.data.objectKey.startsWith(`tenants/${ids.tenantA}/projects/${ids.lkk}/`));
    });
  });

  describe('join codes', () => {
    it('enforces maxUses and rotation', async () => {
      const monitor = await login('monitor@insite.ng');
      const role = await prisma.role.findFirstOrThrow({ where: { tenantId: ids.tenantA, code: 'INDEPENDENT_RESIDENT' } });
      // Phase 6: one active code per (project, role, contractor); a second one is refused.
      const duplicate = await request(app)
        .post(`/api/v1/projects/${ids.lkk}/join-codes`)
        .set(bearer(monitor))
        .send({ roleId: role.id, maxUses: 1 });
      assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));
      assert.equal(duplicate.body.error.code, 'ACTIVE_JOIN_CODE_EXISTS');
      const current = await prisma.projectJoinCode.findFirstOrThrow({
        where: { projectId: ids.lkk, roleId: role.id, isActive: true },
      });
      const issued = await request(app)
        .post(`/api/v1/projects/${ids.lkk}/join-codes/${current.id}/rotate`)
        .set(bearer(monitor))
        .send({ maxUses: 1 });
      assert.equal(issued.status, 201, JSON.stringify(issued.body));
      assert.match(issued.body.data.code, /^LKK-402-COW-[0-9A-HJKMNP-TV-Z]{6}$/);

      const join = (code: string, deviceId: string) =>
        request(app).post('/api/v1/auth/join-project').send({
          joinCode: code,
          agentFullName: 'Tunde Field',
          agentPhoneNumber: '+2348012345678',
          deviceId,
          livenessPassed: true,
          idDocumentUrl: 'https://evil.example/id.jpg',
        });

      const first = await join(issued.body.data.code, 'device-0001');
      assert.equal(first.status, 201, JSON.stringify(first.body));
      const session = await prisma.fieldAgentSession.findUniqueOrThrow({ where: { id: first.body.data.sessionProfile.sessionId } });
      assert.equal(session.livenessPassed, false, 'client-supplied liveness must be ignored');
      assert.equal(session.idDocumentUrl, null, 'client-supplied document URL must be ignored');

      const second = await join(issued.body.data.code, 'device-0002');
      assert.equal(second.status, 403);

      const rotated = await request(app)
        .post(`/api/v1/projects/${ids.lkk}/join-codes/${issued.body.data.id}/rotate`)
        .set(bearer(monitor))
        .send({ maxUses: 5 });
      assert.equal(rotated.status, 201);
      const old = await join(issued.body.data.code, 'device-0003');
      assert.equal(old.status, 404);
      const fresh = await join(rotated.body.data.code, 'device-0004');
      assert.equal(fresh.status, 201);
    });

    it('stops a contractor from issuing independent-verifier codes', async () => {
      const contractor = await login('contractor@insite.ng');
      const role = await prisma.role.findFirstOrThrow({ where: { tenantId: ids.tenantA, code: 'INDEPENDENT_RESIDENT' } });
      const res = await request(app)
        .post(`/api/v1/projects/${ids.lkk}/join-codes`)
        .set(bearer(contractor))
        .send({ roleId: role.id });
      assert.equal(res.status, 403);
    });
  });

  describe('audit chain', () => {
    it('stays valid under 20 concurrent writes', async () => {
      await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          recordAuditEvent(prisma, {
            projectId: ids.abj,
            actorType: 'AI_SYSTEM',
            actorId: 'TEST',
            actorDisplayName: 'Concurrency test',
            action: 'BASELINE_UPDATED',
            summaryText: `Concurrent write ${i}`,
          })
        )
      );
      const trail = await getAndVerifyProjectAuditTrail(ids.abj);
      assert.equal(trail.chainIntegrityVerified, true, `broken at ${trail.brokenAtEntryId}`);
      const seqs = trail.entries.map((e) => e.seq);
      assert.deepEqual(seqs, seqs.map((_, i) => i + 1));
    });
  });
});
