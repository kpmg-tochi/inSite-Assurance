/**
 * Field demo cast for the sign-in screen's quick login (client demo, demo builds only).
 *
 * Import this module ONLY behind the inline build-time flag
 * (`process.env.EXPO_PUBLIC_DEMO_MODE === "true" ? require(...) : null`): Expo inlines the flag at
 * bundle time and Metro drops the dead branch and its dependency in production bundles, so these
 * emails and the shared password are left out of non-demo builds.
 *
 * Mobile-capable logins of the demo overlay (`SEED_PROFILE=ubec-demo npm run prisma:seed`,
 * server/src/db/seedDemoOverlay.ts; saas_updates/client_demo_updates/demo_accounts.md), role titles
 * as the overlay names them. Each tap is a normal password sign-in through the usual sign-in path.
 */
export const DEMO_PASSWORD = 'Password123!';

export interface DemoFieldAccount {
  email: string;
  name: string;
  roleTitle: string;
  organization: string;
  initials: string;
}

export const DEMO_FIELD_ACCOUNTS: readonly DemoFieldAccount[] = [
  {
    email: 'resident.supervisor@ubec.test',
    name: 'Musa Danladi',
    roleTitle: 'Resident Supervisor',
    organization: 'UBEC',
    initials: 'MD',
  },
  {
    email: 'me.officer@ubec.test',
    name: 'Ngozi Eze',
    roleTitle: 'M&E Officer',
    organization: 'UBEC',
    initials: 'NE',
  },
  {
    email: 'lagos.me@ubec.test',
    name: 'Bisi Adeyemi',
    roleTitle: 'M&E Officer (SUBEB)',
    organization: 'Lagos SUBEB',
    initials: 'BA',
  },
  {
    email: 'independent.me@ubec.test',
    name: 'Engr. Emeka Obi',
    roleTitle: 'Independent M&E (COREN-certified firm)',
    organization: 'Independent M&E Consultants',
    initials: 'EO',
  },
  // Needs pipeline wave 5: field verification of proposed projects (Kano Matching Grants).
  {
    email: 'kano.dpp@ubec.test',
    name: 'Kabiru Sule',
    roleTitle: 'SUBEB Director, Physical Planning (Kano)',
    organization: 'Kano SUBEB',
    initials: 'KS',
  },
];

/** Screen-reader label of a quick-login button. */
export function demoAccountA11yLabel(account: DemoFieldAccount): string {
  return `Sign in as ${account.name}, ${account.roleTitle}, ${account.organization}`;
}
