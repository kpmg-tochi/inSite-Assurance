import path from 'node:path';

/** Seeded web logins (saas_updates/ui_verification_and_design_plan.md, Environment). */
export const PASSWORD = 'Password123!';

export const ROLES = {
  admin: 'admin@insite.ng',
  monitor: 'monitor@insite.ng',
  lender: 'lender@insite.ng',
  lto: 'lto@insite.ng',
  contractor: 'contractor@insite.ng',
  verifier: 'verifier@insite.ng',
} as const;

export type Role = keyof typeof ROLES;

export const API_BASE = 'http://localhost:4000/api/v1';

/** Saved sign-in state per role (git-ignored: it holds a live token). */
export function storageStateFor(role: Role): string {
  return path.join(__dirname, '..', '..', '..', '.playwright', 'auth', `${role}.json`);
}

/** Screenshot path under qa/screenshots/web/<role>/<area>__<state>.png */
export function shotPath(role: Role | string, area: string, state: string): string {
  return path.join(__dirname, '..', '..', '..', 'screenshots', 'web', role, `${area}__${state}.png`);
}
