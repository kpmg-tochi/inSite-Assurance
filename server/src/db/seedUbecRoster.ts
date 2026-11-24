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
 */
export const UBEC_ADMIN_EMAIL = "admin@ubec.test";
export const KANO_ADMIN_EMAIL = "kano.admin@ubec.test";
export const LAGOS_ADMIN_EMAIL = "lagos.admin@ubec.test";
export const UBEC_ME_EMAIL = "me.officer@ubec.test";
export const LAGOS_ME_EMAIL = "lagos.me@ubec.test";
export const INDEPENDENT_ME_EMAIL = "independent.me@ubec.test";
export const RESIDENT_SUPERVISOR_EMAIL = "resident.supervisor@ubec.test";

/** Role codes of the UBEC tenant's catalogue (the four default codes are kept, renamed). */
export const UBEC_ROLE = {
  ADMIN: "TENANT_SUPER_ADMIN",
  SUBEB_ADMIN: "ORGANIZATION_ADMIN",
  UBEC_ME: "UBEC_ME_OFFICER",
  SUBEB_ME: "SUBEB_ME_OFFICER",
  INDEPENDENT_ME: "MONITOR",
  RESIDENT_SUPERVISOR: "INDEPENDENT_RESIDENT",
} as const;

/**
 * What a field account needs (owner decision 2026-11-24: every M&E role also works on the field app).
 * A role with surface BOTH is a provisioned role (redesign R1d): its holders sign in on the phone
 * with their web account, `effectiveMobileRole` returns the main role, and
 * `findOrCreateProvisionedSession` opens a field session per visible project.
 */
const FIELD_PERMISSIONS = ["field:submit_report", "field:raise_incident", "visits:submit"];
const FIELD_ROLE = { surface: "BOTH" as const, fieldPersonaType: "INDEPENDENT_VERIFIER" as const, assuranceWeight: 1.0 };

/** Default roles the UBEC tenant does not use (no roster user holds them). */
const UNUSED_DEFAULT_ROLE_CODES = ["LENDER", "MONITOR_INSPECTOR"];

/** What every M&E officer does: visits, findings, documents, handover review, defects, CoC signing. */
const ME_OFFICER_PERMISSIONS = [
  "boq:view",
  "schedule:view_variance",
  "reports:view_all",
  "reports:raise_query",
  "reports:approve_completion",
  "inspections:view",
  "inspections:submit",
  "inspections:manage_findings",
  "visits:view",
  "visits:plan",
  "sprints:verify",
  "findings:receive_escalations",
  "documents:view",
  "documents:upload",
  "handover:record_response",
  "handover:review_feedback",
  "retention:manage_defects",
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
    await db.rolePermission.createMany({ data: keys.map((k) => ({ roleId, permissionId: permIds.get(k)! })) });
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
      description: "Independent monitoring and evaluation by a COREN-certified firm, on the projects it is assigned to: web and field app (ad hoc independent visits).",
      ...FIELD_ROLE,
    },
  });
  await setPermissions(independent.id, [
    "projects:view_assigned",
    "boq:view",
    "schedule:view_variance",
    "reports:view_all",
    "reports:raise_query",
    "inspections:view",
    "inspections:submit",
    "visits:view",
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
      description: "UBEC State/Zonal Office Resident Supervisor: weekly supervision visits on the field app (mobile only).",
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
    await setPermissions(role.id, ["projects:view_assigned", ...ME_OFFICER_PERMISSIONS, ...FIELD_PERMISSIONS]);
  }
}
