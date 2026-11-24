/**
 * Seeded demo accounts. Only ever loaded through `loadDemoAccounts()`, behind the build-time demo
 * flag, so these emails and the shared password are absent from non-demo bundles.
 *
 * The UBEC demo roster's four web logins, in demo order (the login page pre-fills accounts[0]).
 * Names and organisations match the seed (server/src/db/seedUbecRoster.ts and the phase seeds).
 * The SUBEB M&E officer, the Independent M&E and the mobile-only Resident Supervisor are seeded
 * but not listed here. `credential` is a short note on what to show with the login.
 */
export const DEMO_PASSWORD = "Password123!";

export const SEEDED_DEMO_ACCOUNTS = [
  {
    roleCode: "TENANT_SUPER_ADMIN",
    roleTitle: "UBEC Administrator",
    name: "Hauwa Bello",
    organization: "Universal Basic Education Commission (UBEC)",
    email: "admin@ubec.test",
    credential: "Settings, every project, payments; acts for Legal, the ES and Audit",
    initials: "HB",
  },
  {
    roleCode: "ORGANIZATION_ADMIN",
    roleTitle: "SUBEB Administrator (Kano)",
    name: "Aisha Musa",
    organization: "Kano State Universal Basic Education Board (SUBEB)",
    email: "kano.admin@ubec.test",
    credential: "Sees Kano SUBEB's projects only",
    initials: "AM",
  },
  {
    roleCode: "ORGANIZATION_ADMIN",
    roleTitle: "SUBEB Administrator (Lagos)",
    name: "Chidi Okeke",
    organization: "Lagos State Universal Basic Education Board (SUBEB)",
    email: "lagos.admin@ubec.test",
    credential: "Matching Grants owner; decides default cases for the Executive Chairman",
    initials: "CO",
  },
  {
    roleCode: "UBEC_ME_OFFICER",
    roleTitle: "UBEC M&E Officer",
    name: "Ngozi Eze",
    organization: "Universal Basic Education Commission (UBEC)",
    email: "me.officer@ubec.test",
    credential: "Visit planner and review, findings, sprint verification, CoC signature",
    initials: "NE",
  },
];

export type DemoAccount = (typeof SEEDED_DEMO_ACCOUNTS)[number];
