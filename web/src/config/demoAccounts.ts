/**
 * Seeded demo accounts. Only ever loaded through `loadDemoAccounts()`, behind the build-time demo
 * flag, so these emails and the shared password are absent from non-demo bundles.
 *
 * The UBEC demo cast's web logins, in demo order (the login page pre-fills accounts[0]), as the demo
 * overlay seeds them (`SEED_PROFILE=ubec-demo npm run prisma:seed`, server/src/db/seedDemoOverlay.ts,
 * which prints the same table). With the normal seed es@, dpp@, finance@ and sokoto.admin@ do not
 * exist and the other roles keep their earlier names. The Resident Supervisor
 * (resident.supervisor@ubec.test) is mobile-only (refused on the web, R7b) and the SUBEB M&E Officer
 * (lagos.me@ubec.test) is seeded but not listed. `credential` is one line of what to show with the login.
 */
export const DEMO_PASSWORD = "Password123!";

export const SEEDED_DEMO_ACCOUNTS = [
  {
    roleCode: "EXECUTIVE_SECRETARY",
    roleTitle: "Executive Secretary",
    name: "Aminu Yusuf",
    organization: "Universal Basic Education Commission (UBEC)",
    email: "es@ubec.test",
    credential: "Programme dashboard, alerts and KPIs; decides Direct Intervention default cases",
    initials: "AY",
  },
  {
    roleCode: "DIRECTOR_PHYSICAL_PLANNING",
    roleTitle: "Director, Physical Planning",
    name: "Ifeoma Nwosu",
    organization: "Universal Basic Education Commission (UBEC)",
    email: "dpp@ubec.test",
    credential: "Creates projects, picks the contractor, runs the kick-off; drafts and signs the CoC",
    initials: "IN",
  },
  {
    roleCode: "FINANCE_OFFICER",
    roleTitle: "Finance Officer",
    name: "Babatunde Adewale",
    organization: "Universal Basic Education Commission (UBEC)",
    email: "finance@ubec.test",
    credential: "Records payments; sees \"Paid ahead of work done\" and payment exceptions",
    initials: "BA",
  },
  {
    roleCode: "UBEC_ME_OFFICER",
    roleTitle: "M&E Officer",
    name: "Ngozi Eze",
    organization: "Universal Basic Education Commission (UBEC)",
    email: "me.officer@ubec.test",
    credential: "Reviews monitoring reports, raises and follows findings, reviews handovers",
    initials: "NE",
  },
  {
    roleCode: "TENANT_SUPER_ADMIN",
    roleTitle: "System Administrator",
    name: "Hauwa Bello",
    organization: "Universal Basic Education Commission (UBEC)",
    email: "admin@ubec.test",
    credential: "Users, roles, workspace settings, form library and project types",
    initials: "HB",
  },
  {
    roleCode: "ORGANIZATION_ADMIN",
    roleTitle: "SUBEB Executive Chairman (Sokoto)",
    name: "Abubakar Shehu",
    organization: "Sokoto State Universal Basic Education Board (SUBEB)",
    email: "sokoto.admin@ubec.test",
    credential: "Sokoto SUBEB's projects; decides the Matching Grants default case waiting for him",
    initials: "AS",
  },
  {
    roleCode: "ORGANIZATION_ADMIN",
    roleTitle: "SUBEB Executive Chairman (Kano)",
    name: "Aisha Musa",
    organization: "Kano State Universal Basic Education Board (SUBEB)",
    email: "kano.admin@ubec.test",
    credential: "Sees Kano SUBEB's Matching Grants projects only (the project in trouble)",
    initials: "AM",
  },
  {
    roleCode: "ORGANIZATION_ADMIN",
    roleTitle: "SUBEB Executive Chairman (Lagos)",
    name: "Chidi Okeke",
    organization: "Lagos State Universal Basic Education Board (SUBEB)",
    email: "lagos.admin@ubec.test",
    credential: "Lagos SUBEB's view of the programme",
    initials: "CO",
  },
  {
    roleCode: "MONITOR",
    roleTitle: "Independent M&E (COREN-certified firm)",
    name: "Engr. Emeka Obi",
    organization: "Independent M&E Consultants (COREN-certified)",
    email: "independent.me@ubec.test",
    credential: "Independent monitoring visits and findings on the projects it is engaged on",
    initials: "EO",
  },
];

export type DemoAccount = (typeof SEEDED_DEMO_ACCOUNTS)[number];
