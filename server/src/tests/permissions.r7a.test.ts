/**
 * Redesign R7a unit tests: the permission catalogue named after the new model.
 * - No legacy key survives in the catalogue, every rename target exists.
 * - Default roles grant only catalogue keys, without duplicates.
 * - Every permission key the server, web and mobile check in code is in the catalogue (a typo or a
 *   forgotten rename would otherwise lock everyone out of a route silently).
 * - Approval chains refuse a legacy key.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ApprovalStepConfigSchema,
  DEFAULT_TENANT_ROLES,
  PERMISSION_CATEGORY_META,
  RENAMED_PERMISSION_KEYS,
  REPORT_APPROVAL_PERMISSION_KEY,
  SYSTEM_PERMISSIONS_CATALOG,
} from '@insite/shared';

const CATALOG_KEYS = new Set(SYSTEM_PERMISSIONS_CATALOG.map((p) => p.key));
const REPO_ROOT = path.resolve(__dirname, '../../..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'tests') continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Quoted `area:action` literals passed to a permission check. */
function permissionKeysCheckedIn(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  const keys: string[] = [];
  const call = /\b(requirePermission|requireAnyAuthWithWebPermission|hasWebPermission|hasPermission)\(([^)]*)\)/g;
  for (const m of src.matchAll(call)) {
    for (const k of m[2].matchAll(/['"`]([a-z_]+:[a-z_]+)['"`]/g)) keys.push(k[1]);
  }
  return keys;
}

describe('Redesign R7a: permission catalogue', () => {
  it('groups the catalogue into the flow categories (eight in R7a, plus the needs pipeline), every one used, keys unique', () => {
    assert.deepEqual(Object.keys(PERMISSION_CATEGORY_META), [
      'TENANT_ADMIN',
      'FORMS_FACILITIES',
      'NEEDS_FUNDING',
      'PORTFOLIO_PROJECTS',
      'SCOPE_SPRINTS',
      'CONTRACT_KICKOFF',
      'VISITS_FINDINGS',
      'PAYMENTS',
      'COMPLETION_CLOSURE',
    ]);
    assert.equal(CATALOG_KEYS.size, SYSTEM_PERMISSIONS_CATALOG.length);
    for (const category of Object.keys(PERMISSION_CATEGORY_META)) {
      assert.ok(SYSTEM_PERMISSIONS_CATALOG.some((p) => p.category === category), `${category} has no permission`);
    }
  });

  it('keeps no legacy key and maps every renamed key to a catalogue key', () => {
    for (const [oldKey, newKey] of Object.entries(RENAMED_PERMISSION_KEYS)) {
      assert.equal(CATALOG_KEYS.has(oldKey), false, `${oldKey} is still in the catalogue`);
      if (newKey !== null) assert.ok(CATALOG_KEYS.has(newKey), `${oldKey} maps to unknown ${newKey}`);
    }
    for (const prefix of ['boq:', 'schedule:', 'reports:', 'inspections:', 'field:', 'sessions:', 'retention:']) {
      assert.equal(
        SYSTEM_PERMISSIONS_CATALOG.some((p) => p.key.startsWith(prefix)),
        false,
        `a ${prefix} key is still in the catalogue`,
      );
    }
  });

  it('has no lender-era or AI wording in names and descriptions', () => {
    // "BoQ lines" are the new model's scope lines; the old wording was "BOQ" (the lender product).
    const stale = /\b(IPC|tranche|valuation|hold[- ]point|lender|executive matrix|whistleblower|Clerk of Works)\b/i;
    const staleExact = /\b(BOQ|AI)\b/;
    for (const p of SYSTEM_PERMISSIONS_CATALOG) {
      const text = `${p.name} ${p.description}`;
      assert.equal(stale.test(text) || staleExact.test(text), false, `${p.key}: "${p.name}: ${p.description}"`);
    }
  });

  it('grants only catalogue keys in the default roles, without duplicates', () => {
    for (const role of DEFAULT_TENANT_ROLES) {
      assert.equal(new Set(role.permissionKeys).size, role.permissionKeys.length, `${role.code} repeats a key`);
      for (const key of role.permissionKeys) assert.ok(CATALOG_KEYS.has(key), `${role.code} grants unknown ${key}`);
    }
    const admin = DEFAULT_TENANT_ROLES.find((r) => r.code === 'TENANT_SUPER_ADMIN')!;
    assert.equal(admin.permissionKeys.length, CATALOG_KEYS.size, 'the tenant admin holds every permission');
  });

  it('checks only catalogue keys in server, web and mobile code', () => {
    const unknown: string[] = [];
    for (const dir of ['server/src', 'web/src', 'mobile/src']) {
      for (const file of sourceFiles(path.join(REPO_ROOT, dir))) {
        for (const key of permissionKeysCheckedIn(file)) {
          if (!CATALOG_KEYS.has(key)) unknown.push(`${path.relative(REPO_ROOT, file)}: ${key}`);
        }
      }
    }
    assert.deepEqual(unknown, []);
  });

  it('points the default visit review step at visits:review and refuses a legacy key in a chain', () => {
    assert.equal(REPORT_APPROVAL_PERMISSION_KEY, 'visits:review');
    assert.equal(ApprovalStepConfigSchema.safeParse({ label: 'QS approval', requiredPermissionKey: 'visits:review' }).success, true);
    assert.equal(
      ApprovalStepConfigSchema.safeParse({ label: 'QS approval', requiredPermissionKey: 'reports:approve_completion' }).success,
      false,
    );
  });
});
