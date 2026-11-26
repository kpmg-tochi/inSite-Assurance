import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_FIELD_ACCOUNTS, DEMO_PASSWORD, demoAccountA11yLabel } from './demoAccounts';

describe('demo quick login (client demo, demo builds only)', () => {
  it('lists the overlay field cast, mobile-capable logins only, in demo order', () => {
    assert.deepEqual(
      DEMO_FIELD_ACCOUNTS.map((a) => a.email),
      ['resident.supervisor@ubec.test', 'me.officer@ubec.test', 'lagos.me@ubec.test', 'independent.me@ubec.test']
    );
    assert.deepEqual(
      DEMO_FIELD_ACCOUNTS.map((a) => a.roleTitle),
      ['Resident Supervisor', 'M&E Officer', 'M&E Officer (SUBEB)', 'Independent M&E (COREN-certified firm)']
    );
  });

  it('uses only reserved .test emails and the seeded password', () => {
    for (const a of DEMO_FIELD_ACCOUNTS) assert.match(a.email, /@ubec\.test$/);
    assert.equal(DEMO_PASSWORD, 'Password123!');
  });

  it('every account has a name, initials and a spoken label naming the person and role', () => {
    for (const a of DEMO_FIELD_ACCOUNTS) {
      assert.ok(a.name.trim() && a.organization.trim());
      assert.match(a.initials, /^[A-Z]{2}$/);
      const label = demoAccountA11yLabel(a);
      assert.ok(label.startsWith(`Sign in as ${a.name}`));
      assert.ok(label.includes(a.roleTitle));
    }
  });
});
