import { Prisma } from "@prisma/client";

type Db = Prisma.TransactionClient | typeof import("../config/prisma").prisma;

/**
 * UBEC demo roster (owner decisions 2026-11-24). Web logins: one UBEC administrator, two SUBEB
 * administrators and one UBEC M&E officer. The SUBEB M&E officer and the Independent M&E (COREN
 * firm) are seeded users too. The three M&E roles work on the web and the field app (surface BOTH);
 * the Resident Supervisor is mobile only. Legal, Finance, ICT Support,
 * Procurement, Audit and the Executive Secretary have no login: the UBEC administrator acts for them,
 * and each SUBEB administrator acts for its Executive Chairman. Every workflow step is kept.
 *
 * Emails use the reserved `.test` TLD: the seed sends real notifications, and a demo server with an
 * email provider must never reach real UBEC addresses.
 *
 * Needs pipeline (wave 1, D-N.25): the people of the annual needs assessment cycle are in the normal
 * seed, because its scenario tests need a distinct person per stage. UBEC HQ: the Executive Secretary,
 * the Director Physical Planning and the Finance Officer (moved here from the demo overlay, which
 * reuses them), a Procurement Officer and a Quantity Surveyor. Kano SUBEB: its Director Physical
 * Planning and Procurement Officer. Here these roles hold only their needs pipeline permissions (plan
 * section 8); the demo overlay adds the project permissions of its cast.
 */
export const UBEC_ADMIN_EMAIL = "admin@ubec.test";
export const KANO_ADMIN_EMAIL = "kano.admin@ubec.test";
export const LAGOS_ADMIN_EMAIL = "lagos.admin@ubec.test";
export const UBEC_ME_EMAIL = "me.officer@ubec.test";
export const LAGOS_ME_EMAIL = "lagos.me@ubec.test";
export const INDEPENDENT_ME_EMAIL = "independent.me@ubec.test";
export const RESIDENT_SUPERVISOR_EMAIL = "resident.supervisor@ubec.test";
// Needs pipeline (D-N.25)
export const ES_EMAIL = "es@ubec.test";
export const DPP_EMAIL = "dpp@ubec.test";
export const FINANCE_EMAIL = "finance@ubec.test";
export const PROCUREMENT_EMAIL = "procurement@ubec.test";
export const QS_EMAIL = "qs@ubec.test";
export const KANO_DPP_EMAIL = "kano.dpp@ubec.test";
export const KANO_PROCUREMENT_EMAIL = "kano.procurement@ubec.test";
// Wave 3 (parent plan 16.2 O-2): three SUBEB Steering Committee members (one umbrella role).
export const KANO_COMMITTEE_EMAILS = ["kano.committee1@ubec.test", "kano.committee2@ubec.test", "kano.committee3@ubec.test"] as const;

/** Role codes of the UBEC tenant's catalogue (the four default codes are kept, renamed). */
export const UBEC_ROLE = {
  ADMIN: "TENANT_SUPER_ADMIN",
  SUBEB_ADMIN: "ORGANIZATION_ADMIN",
  UBEC_ME: "UBEC_ME_OFFICER",
  SUBEB_ME: "SUBEB_ME_OFFICER",
  INDEPENDENT_ME: "MONITOR",
  RESIDENT_SUPERVISOR: "INDEPENDENT_RESIDENT",
  // Needs pipeline (D-N.25)
  ES: "EXECUTIVE_SECRETARY",
  DPP: "DIRECTOR_PHYSICAL_PLANNING",
  FINANCE: "FINANCE_OFFICER",
  PROCUREMENT: "PROCUREMENT_OFFICER",
  QS: "QUANTITY_SURVEYOR",
  SUBEB_DPP: "SUBEB_DIRECTOR_PHYSICAL_PLANNING",
  SUBEB_PROCUREMENT: "SUBEB_PROCUREMENT_OFFICER",
  SUBEB_COMMITTEE: "SUBEB_COMMITTEE_MEMBER",
} as const;

/**
 * Needs pipeline grants per role code (plan section 8). The UBEC Administrator (TENANT_SUPER_ADMIN)
 * holds every permission already. The demo overlay adds these to the permissions it sets.
 * One addition to the plan: the SUBEB Director Physical Planning also holds `needs:review_portfolio`,
 * because the SUBEB management review step needs a person other than the submitter (the SUBEB
 * Procurement Officer) and the Executive Chairman, who endorses next.
 */
export const NEEDS_PIPELINE_GRANTS: Record<string, string[]> = {
  PROCUREMENT_OFFICER: ["needs:view", "needs:submit", "needs:submit_portfolio", "procurement:plan_lots", "needs:score"],
  QUANTITY_SURVEYOR: ["needs:view", "needs:cost", "standards:manage"],
  DIRECTOR_PHYSICAL_PLANNING: ["needs:view", "needs:manage_cycle", "needs:review_portfolio", "needs:review_beap", "needs:score", "standards:manage"],
  UBEC_ME_OFFICER: ["needs:view", "needs:validate"],
  FINANCE_OFFICER: ["needs:view", "needs:record_funding", "needs:score"],
  EXECUTIVE_SECRETARY: ["needs:view", "needs:chair_committee", "needs:score", "needs:approve_portfolio", "needs:approve_beap", "needs:approve_out_of_cycle"],
  SUBEB_DIRECTOR_PHYSICAL_PLANNING: ["needs:view", "needs:manage_cycle", "needs:validate", "needs:cost", "needs:prepare_beap", "needs:score", "needs:review_portfolio"],
  SUBEB_PROCUREMENT_OFFICER: ["needs:view", "needs:submit", "needs:submit_portfolio", "needs:score"],
  // Parent plan 16.2 O-2: stands for the SUBEB directorates on the committee (M&E, Finance, Administration …).
  SUBEB_COMMITTEE_MEMBER: ["needs:view", "needs:score"],
  // The SUBEB Executive Chairman (the SUBEB Administrator acts for him); he also scores (wave 3, 16.2 O-2).
  ORGANIZATION_ADMIN: ["needs:view", "needs:chair_committee", "needs:score", "needs:review_portfolio", "needs:approve_portfolio", "needs:approve_out_of_cycle", "needs:override_separation"],
};

/** The pipeline roles the roster adds (web only), with the names the demo overlay also uses. */
export const NEEDS_PIPELINE_ROLES: Array<{ code: string; name: string; description: string }> = [
  {
    code: "EXECUTIVE_SECRETARY",
    name: "Executive Secretary",
    description: "UBEC's Executive Secretary: chairs the Direct Intervention Steering Committee, approves the Prioritised Project Portfolio, States' BEAPs and out-of-cycle projects.",
  },
  {
    code: "DIRECTOR_PHYSICAL_PLANNING",
    name: "Director, Physical Planning",
    description: "Process owner of the Direct Intervention needs assessment: opens the annual cycle, reviews the portfolio and States' BEAPs, sits on the Steering Committee and keeps the costing standards.",
  },
  {
    code: "FINANCE_OFFICER",
    name: "Finance Officer",
    description: "Finance & Accounts: records the budget submission and the appropriated schedule, and sits on the Steering Committee.",
  },
  {
    code: "PROCUREMENT_OFFICER",
    name: "Procurement Officer",
    description: "UBEC Procurement: uploads needs assessments as proposed projects, submits the Prioritised Project Portfolio, sits on the Steering Committee and plans the procurement lots.",
  },
  {
    code: "QUANTITY_SURVEYOR",
    name: "Quantity Surveyor",
    description: "UBEC Physical Planning: costs proposed projects against the costing standards and keeps the standards.",
  },
  {
    code: "SUBEB_DIRECTOR_PHYSICAL_PLANNING",
    name: "SUBEB Director, Physical Planning",
    description: "A SUBEB's Physical Planning: opens the State's Matching Grants cycle, verifies and costs proposed projects, reviews the portfolio for SUBEB management and prepares the BEAP.",
  },
  {
    code: "SUBEB_PROCUREMENT_OFFICER",
    name: "SUBEB Procurement Officer",
    description: "A SUBEB's Procurement: uploads the State's needs assessments as proposed projects and submits the Prioritised Project Portfolio.",
  },
  {
    code: "SUBEB_COMMITTEE_MEMBER",
    name: "SUBEB Steering Committee Member",
    description: "Sits on a SUBEB's Steering Committee for the State's Matching Grants needs assessment and scores the proposed projects. Stands for the SUBEB directorates on the committee (e.g. M&E, Finance, Administration).",
  },
];

/**
 * What a field account needs (owner decision 2026-11-24: every M&E role also works on the field app).
 * A role with surface BOTH is a provisioned role (redesign R1d): its holders sign in on the phone
 * with their web account, `effectiveMobileRole` returns the main role, and
 * `findOrCreateProvisionedSession` opens a field session per visible project.
 */
const FIELD_PERMISSIONS = ["visits:submit"];
const FIELD_ROLE = { surface: "BOTH" as const, fieldPersonaType: "INDEPENDENT_VERIFIER" as const, assuranceWeight: 1.0 };

/** Default roles the UBEC tenant does not use (no roster user holds them). */
const UNUSED_DEFAULT_ROLE_CODES = ["LENDER", "MONITOR_INSPECTOR"];

/** What every M&E officer does: visits, findings, documents, handover review, defects, CoC signing. */
const ME_OFFICER_PERMISSIONS = [
  "scope:view",
  "sprints:view_status",
  "visits:view",
  "visits:review",
  "incidents:view",
  "visits:submit",
  "findings:manage",
  "visits:plan",
  "sprints:verify",
  "findings:receive_escalations",
  "documents:view",
  "documents:upload",
  "handover:record_response",
  "handover:review_feedback",
  "defects:manage",
  "milestones:manage",
  "completion:sign_certificate",
  "contractors:rate_performance",
  "lessons:view",
  "lessons:manage",
  "kpis:view",
];

/**
 * Renames the default roles to the client's names, sets the M&E permissions, adds the UBEC and
 * SUBEB M&E officer roles and deletes the default roles nobody holds. Runs right after
 * `provisionDefaultRoles`, before any user, session or approval step can refer to a role.
 * `shared/src/defaultRoles.ts` is not changed: this is the UBEC tenant only.
 */
export async function tailorUbecRoles(db: Db, tenantId: string): Promise<void> {
  const permIds = new Map((await db.permission.findMany({ select: { id: true, key: true } })).map((p) => [p.key, p.id]));
  const setPermissions = async (roleId: string, keys: string[]) => {
    const missing = keys.filter((k) => !permIds.has(k));
    if (missing.length) throw new Error(`UBEC roles: unknown permissions ${missing.join(", ")}`);
    await db.rolePermission.deleteMany({ where: { roleId } });
    await db.rolePermission.createMany({ data: [...new Set(keys)].map((k) => ({ roleId, permissionId: permIds.get(k)! })) });
  };
  const byCode = async (code: string) => db.role.findUniqueOrThrow({ where: { tenantId_code: { tenantId, code } } });

  for (const code of UNUSED_DEFAULT_ROLE_CODES) {
    await db.role.deleteMany({ where: { tenantId, code } }); // role permissions cascade
  }

  await db.role.update({
    where: { id: (await byCode(UBEC_ROLE.ADMIN)).id },
    data: {
      name: "UBEC Administrator",
      description:
        "UBEC HQ administrator: settings, users and every project. In the demo also acts for the Director Legal, the Executive Secretary, Procurement, Finance & Accounts and the Audit Department.",
    },
  });
  await db.role.update({
    where: { id: (await byCode(UBEC_ROLE.SUBEB_ADMIN)).id },
    data: {
      name: "SUBEB Administrator",
      description:
        "Administers a State Universal Basic Education Board's Matching Grants projects and acts for its Executive Chairman: decides default cases and signs Certificates of Completion.",
    },
  });

  const independent = await byCode(UBEC_ROLE.INDEPENDENT_ME);
  await db.role.update({
    where: { id: independent.id },
    data: {
      name: "Independent M&E (COREN-certified firm)",
      description: "Independent monitoring and evaluation by a COREN-certified firm, on the projects it is assigned to: web and field app (ad hoc independent monitoring visits).",
      ...FIELD_ROLE,
    },
  });
  await setPermissions(independent.id, [
    "projects:view_assigned",
    "scope:view",
    "sprints:view_status",
    "visits:view",
    "incidents:view",
    "visits:submit",
    "documents:view",
    "documents:upload",
    "lessons:view",
    "kpis:view",
    ...FIELD_PERMISSIONS,
  ]);

  await db.role.update({
    where: { id: (await byCode(UBEC_ROLE.RESIDENT_SUPERVISOR)).id },
    data: {
      name: "Resident Supervisor",
      description: "UBEC State/Zonal Office Resident Supervisor: weekly monitoring visits on the field app (mobile only).",
    },
  });

  // Owner decision 2026-11-24: every M&E role sees only the projects it is assigned to (web and
  // phone): `projects:view_assigned`, no tenant-wide or organisation-tree visibility.
  for (const [code, name, description] of [
    [
      UBEC_ROLE.UBEC_ME,
      "UBEC M&E Officer",
      "UBEC Monitoring & Evaluation on the projects assigned to the officer: plans, carries out (field app) and reviews visits, verifies sprints, follows findings, runs final evaluations and signs Certificates of Completion for UBEC.",
    ],
    [
      UBEC_ROLE.SUBEB_ME,
      "SUBEB M&E Officer",
      "A SUBEB's Monitoring & Evaluation on the projects assigned to the officer: visits and evaluations of its Matching Grants projects (web and field app), post-closure evaluation, and its Certificate of Completion signature.",
    ],
  ] as const) {
    const role = await db.role.create({ data: { tenantId, code, name, description, ...FIELD_ROLE, isSystemDefault: false } });
    await setPermissions(role.id, ["projects:view_assigned", ...ME_OFFICER_PERMISSIONS, ...FIELD_PERMISSIONS, ...(NEEDS_PIPELINE_GRANTS[code] ?? [])]);
  }

  // Needs pipeline (D-N.25): the pipeline roles, and the Executive Chairman's grants on the SUBEB
  // Administrator role (added to what the default role holds).
  for (const r of NEEDS_PIPELINE_ROLES) {
    const role = await db.role.create({
      data: { tenantId, code: r.code, name: r.name, description: r.description, surface: "WEB", fieldPersonaType: "NONE", isSystemDefault: false },
    });
    await setPermissions(role.id, NEEDS_PIPELINE_GRANTS[r.code]);
  }
  const chairman = await byCode(UBEC_ROLE.SUBEB_ADMIN);
  await db.rolePermission.createMany({
    data: NEEDS_PIPELINE_GRANTS[UBEC_ROLE.SUBEB_ADMIN].map((k) => {
      if (!permIds.has(k)) throw new Error(`UBEC roles: unknown permission ${k}`);
      return { roleId: chairman.id, permissionId: permIds.get(k)! };
    }),
    skipDuplicates: true,
  });
}

/** Name and phone per pipeline login (the demo overlay shows the same people). */
export const NEEDS_PIPELINE_PEOPLE: Array<{ email: string; fullName: string; roleCode: string; organization: "UBEC" | "KANO_SUBEB"; phoneNumber: string }> = [
  { email: ES_EMAIL, fullName: "Aminu Yusuf", roleCode: UBEC_ROLE.ES, organization: "UBEC", phoneNumber: "+234 803 555 0201" },
  { email: DPP_EMAIL, fullName: "Ifeoma Nwosu", roleCode: UBEC_ROLE.DPP, organization: "UBEC", phoneNumber: "+234 803 555 0202" },
  { email: FINANCE_EMAIL, fullName: "Babatunde Adewale", roleCode: UBEC_ROLE.FINANCE, organization: "UBEC", phoneNumber: "+234 803 555 0203" },
  { email: PROCUREMENT_EMAIL, fullName: "Zainab Abdullahi", roleCode: UBEC_ROLE.PROCUREMENT, organization: "UBEC", phoneNumber: "+234 803 555 0205" },
  { email: QS_EMAIL, fullName: "Segun Adeyemi", roleCode: UBEC_ROLE.QS, organization: "UBEC", phoneNumber: "+234 803 555 0206" },
  { email: KANO_DPP_EMAIL, fullName: "Kabiru Sule", roleCode: UBEC_ROLE.SUBEB_DPP, organization: "KANO_SUBEB", phoneNumber: "+234 803 555 0207" },
  { email: KANO_PROCUREMENT_EMAIL, fullName: "Hadiza Ibrahim", roleCode: UBEC_ROLE.SUBEB_PROCUREMENT, organization: "KANO_SUBEB", phoneNumber: "+234 803 555 0208" },
  { email: KANO_COMMITTEE_EMAILS[0], fullName: "Musa Garba", roleCode: UBEC_ROLE.SUBEB_COMMITTEE, organization: "KANO_SUBEB", phoneNumber: "+234 803 555 0209" },
  { email: KANO_COMMITTEE_EMAILS[1], fullName: "Aisha Lawan", roleCode: UBEC_ROLE.SUBEB_COMMITTEE, organization: "KANO_SUBEB", phoneNumber: "+234 803 555 0210" },
  { email: KANO_COMMITTEE_EMAILS[2], fullName: "Yakubu Danjuma", roleCode: UBEC_ROLE.SUBEB_COMMITTEE, organization: "KANO_SUBEB", phoneNumber: "+234 803 555 0211" },
];

/** Creates the pipeline logins (password as the other seeded users). Runs once the organisations exist. */
export async function seedNeedsPipelinePeople(
  db: Db,
  p: { tenantId: string; passwordHash: string; ubecOrganizationId: string; kanoSubebOrganizationId: string }
): Promise<void> {
  for (const person of NEEDS_PIPELINE_PEOPLE) {
    const role = await db.role.findUniqueOrThrow({ where: { tenantId_code: { tenantId: p.tenantId, code: person.roleCode } } });
    await db.user.create({
      data: {
        tenantId: p.tenantId,
        email: person.email,
        fullName: person.fullName,
        passwordHash: p.passwordHash,
        roleId: role.id,
        organizationId: person.organization === "UBEC" ? p.ubecOrganizationId : p.kanoSubebOrganizationId,
        phoneNumber: person.phoneNumber,
      },
    });
  }
}
