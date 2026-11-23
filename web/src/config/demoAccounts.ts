/**
 * Seeded demo accounts. Only ever loaded through `loadDemoAccounts()`, behind the build-time demo
 * flag, so these emails and the shared password are absent from non-demo bundles.
 *
 * Demo branch (UBEC): the UBEC programme logins come first, in demo-plan order; the labels of
 * the second tenant's accounts match the UBEC seed profile (`npm run prisma:seed:ubec`).
 */
export const DEMO_PASSWORD = "Password123!";

export const SEEDED_DEMO_ACCOUNTS = [
  {
    roleCode: "TENANT_SUPER_ADMIN",
    roleTitle: "UBEC Programme Administrator",
    name: "Hauwa Bello",
    organization: "UBEC",
    email: "programme.admin@insite.ng",
    credential: "Tenant Super Admin",
    initials: "HB",
  },
  {
    roleCode: "ORGANIZATION_ADMIN",
    roleTitle: "SUBEB Administrator (Kano)",
    name: "Aisha Musa",
    organization: "Kano State SUBEB",
    email: "north.admin@insite.ng",
    credential: "Organisation Admin",
    initials: "AM",
  },
  {
    roleCode: "MONITOR",
    roleTitle: "M&E Officer",
    name: "Ngozi Eze",
    organization: "UBEC Quality Assurance",
    email: "me.officer@insite.ng",
    credential: "Supervisor",
    initials: "NE",
  },
  {
    roleCode: "LENDER",
    roleTitle: "Funding Authority Approver",
    name: "Ibrahim Sule",
    organization: "UBEC",
    email: "programme.funder@insite.ng",
    credential: "Release approver",
    initials: "IS",
  },
  {
    roleCode: "TENANT_SUPER_ADMIN",
    roleTitle: "Platform & Tenant Super Admin",
    name: "Adaeze Nwosu",
    organization: "UBEC Special Projects",
    email: "admin@insite.ng",
    credential: "Platform & RBAC Admin",
    initials: "AN",
  },
  {
    roleCode: "MONITOR",
    roleTitle: "Independent Monitor (Certifier)",
    name: "QS Tunde Adebayo",
    organization: "UBEC Quality Assurance",
    email: "monitor@insite.ng",
    credential: "QSRBN #3842",
    initials: "TA",
  },
  {
    roleCode: "LENDER",
    roleTitle: "Funder (Approver)",
    name: "Chidinma Okafor, CFA",
    organization: "UBEC Finance & Accounts",
    email: "lender@insite.ng",
    credential: "ICAN #MB/049120",
    initials: "CO",
  },
  {
    roleCode: "LENDER_TECHNICAL_OFFICER",
    roleTitle: "Funder Technical Officer (Certify + Approve)",
    name: "Engr. Ifeoma Eze",
    organization: "UBEC Finance & Accounts",
    email: "lto@insite.ng",
    credential: "COREN #R.33017",
    initials: "IE",
  },
  {
    roleCode: "CONTRACTOR",
    roleTitle: "Main Contractor (Claimant)",
    name: "Engr. Musa Danladi",
    organization: "Contractor B",
    email: "contractor@insite.ng",
    credential: "COREN #R.49201",
    initials: "MD",
  },
];

export type DemoAccount = (typeof SEEDED_DEMO_ACCOUNTS)[number];
