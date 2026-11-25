import { AppError } from '../../middleware/error.middleware';

/**
 * Redesign R7: a user whose main role is mobile-only (surface MOBILE, e.g. the Resident Supervisor)
 * has no web sign-in. Roles with surface WEB or BOTH keep web access (a BOTH user signs in on the
 * web and the field app with the same credentials). A platform super admin is never refused.
 *
 * Checked when a web token is issued and on every web request, so tokens issued before a role
 * became mobile-only stop working too. Pure, so it is unit-tested on its own.
 *
 * This module must not import the auth middleware (the middleware imports it).
 */
export function webSignInAllowed(user: { surface: string; isPlatformSuperAdmin: boolean }): boolean {
  if (user.isPlatformSuperAdmin) return true;
  return user.surface !== 'MOBILE';
}

export const WEB_ACCESS_NOT_ALLOWED_MESSAGE =
  'This account is for the field app. Sign in on the mobile app instead.';

export function webAccessNotAllowed(): AppError {
  return new AppError(WEB_ACCESS_NOT_ALLOWED_MESSAGE, 403, 'WEB_ACCESS_NOT_ALLOWED');
}

/** Throws 403 WEB_ACCESS_NOT_ALLOWED when the user may not use the web portal. */
export function assertWebSignInAllowed(user: { surface: string; isPlatformSuperAdmin: boolean }): void {
  if (!webSignInAllowed(user)) throw webAccessNotAllowed();
}
