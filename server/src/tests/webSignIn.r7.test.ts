/**
 * Redesign R7 unit tests: the web sign-in surface rule (`webSignInAllowed`). A main role with surface
 * MOBILE has no web access; WEB and BOTH keep it; a platform super admin is never refused.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertWebSignInAllowed, webSignInAllowed, WEB_ACCESS_NOT_ALLOWED_MESSAGE } from '../modules/auth/webAccess';

describe('R7: web sign-in surface rule', () => {
  it('refuses a mobile-only role', () => {
    assert.equal(webSignInAllowed({ surface: 'MOBILE', isPlatformSuperAdmin: false }), false);
  });

  it('allows BOTH and WEB roles', () => {
    assert.equal(webSignInAllowed({ surface: 'BOTH', isPlatformSuperAdmin: false }), true);
    assert.equal(webSignInAllowed({ surface: 'WEB', isPlatformSuperAdmin: false }), true);
  });

  it('never refuses a platform super admin', () => {
    assert.equal(webSignInAllowed({ surface: 'MOBILE', isPlatformSuperAdmin: true }), true);
    assert.equal(webSignInAllowed({ surface: 'WEB', isPlatformSuperAdmin: true }), true);
  });

  it('throws 403 WEB_ACCESS_NOT_ALLOWED with the field-app message', () => {
    assert.throws(
      () => assertWebSignInAllowed({ surface: 'MOBILE', isPlatformSuperAdmin: false }),
      (err: { statusCode: number; code: string; message: string }) =>
        err.statusCode === 403 &&
        err.code === 'WEB_ACCESS_NOT_ALLOWED' &&
        err.message === WEB_ACCESS_NOT_ALLOWED_MESSAGE &&
        err.message === 'This account is for the field app. Sign in on the mobile app instead.'
    );
    assert.doesNotThrow(() => assertWebSignInAllowed({ surface: 'BOTH', isPlatformSuperAdmin: false }));
  });
});
