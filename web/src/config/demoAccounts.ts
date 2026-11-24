/**
 * Seeded demo accounts. Only ever loaded through `loadDemoAccounts()`, behind the build-time demo
 * flag, so these emails and the shared password are absent from non-demo bundles.
 */
export const DEMO_PASSWORD = "Password123!";

export const SEEDED_DEMO_ACCOUNTS = [
  {
    roleCode: "TENANT_SUPER_ADMIN",
    roleTitle: "Platform & Tenant Super Admin",
    name: "Adaeze Nwosu",
    organization: "KPMG Advisory",
    email: "admin@insite.ng",
    credential: "Platform & RBAC Admin",
    initials: "AN",
  },
  {
    roleCode: "MONITOR",
    roleTitle: "Independent Monitor (Certifier)",
    name: "QS Tunde Adebayo",
    organization: "KPMG Advisory",
    email: "monitor@insite.ng",
    credential: "QSRBN #3842",
    initials: "TA",
  },
  {
    roleCode: "LENDER",
    roleTitle: "Lender / Guarantor (Approver)",
    name: "Chidinma Okafor, CFA",
    organization: "InfraCredit",
    email: "lender@insite.ng",
    credential: "ICAN #MB/049120",
    initials: "CO",
  },
  {
    roleCode: "LENDER_TECHNICAL_OFFICER",
    roleTitle: "Lender Technical Officer (Certify + Approve)",
    name: "Engr. Ifeoma Eze",
    organization: "InfraCredit",
    email: "lto@insite.ng",
    credential: "COREN #R.33017",
    initials: "IE",
  },
];

export type DemoAccount = (typeof SEEDED_DEMO_ACCOUNTS)[number];
