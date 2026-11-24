import { Prisma } from "@prisma/client";
import { ProjectTypeConfigSchema } from "@insite/shared";
import { prisma } from "../config/prisma";
import { ME_CONSULTANTS_NAME, PROGRAMME_TENANT_SLUG, UBEC_ORG_NAME } from "./seedPhase11";
import { INDEPENDENT_ME_EMAIL, UBEC_ME_EMAIL, UBEC_ROLE } from "./seedUbecRoster";

/**
 * Phase 12 seed (redesign R1b removed payment milestones, R1d removed professional registration):
 * - Programme tenant: both project types default new projects to 5% retention over 12 months. Type
 *   versions stay 1; project snapshots get the same config.
 * - The UBEC M&E officer (me.officer@ubec.test) and the Independent M&E (independent.me@ubec.test),
 *   both on the live Direct Intervention project PRG-102.
 * - Direct Intervention project PRG-102: a BOQ in three bills (substructure, superstructure, finishes and
 *   WASH), 5% retention.
 */
export async function seedPhase12(p: { passwordHash: string }) {
  const tenant = await prisma.tenant.findUnique({ where: { slug: PROGRAMME_TENANT_SLUG } });
  if (!tenant) return;

  // Project types: payments. A seed write in place (version unchanged), as if the
  // Phase 11 seed had created the types with these settings; project snapshots are refreshed too.
  const types = await prisma.projectType.findMany({ where: { tenantId: tenant.id } });
  for (const type of types) {
    const config = ProjectTypeConfigSchema.parse({
      ...(type.configJson as Record<string, unknown>),
      payments: { retentionPercentage: 5, retentionDurationMonths: 12 },
    });
    await prisma.projectType.update({
      where: { id: type.id },
      data: { configJson: config as unknown as Prisma.InputJsonValue },
    });
    const projects = await prisma.project.findMany({
      where: { projectTypeId: type.id },
      select: { id: true, projectTypeSnapshotJson: true },
    });
    for (const project of projects) {
      const snapshot = (project.projectTypeSnapshotJson ?? {}) as Record<string, unknown>;
      await prisma.project.update({
        where: { id: project.id },
        data: { projectTypeSnapshotJson: { ...snapshot, config } as unknown as Prisma.InputJsonValue },
      });
    }
  }

  const central = await prisma.project.findFirst({ where: { tenantId: tenant.id, codePrefix: "PRG-102" } });
  if (!central) return;

  // People (UBEC roster): the UBEC M&E officer (web login) and the Independent M&E from the
  // COREN-certified firm, both on PRG-102. Finance has no login: the UBEC administrator records payments.
  const monitorOrg = await prisma.organization.findFirstOrThrow({ where: { tenantId: tenant.id, name: ME_CONSULTANTS_NAME } });
  const ubec = await prisma.organization.findFirstOrThrow({ where: { tenantId: tenant.id, name: UBEC_ORG_NAME } });
  const roleId = async (code: string) => (await prisma.role.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenant.id, code } } })).id;
  for (const person of [
    { email: UBEC_ME_EMAIL, fullName: "Ngozi Eze", roleCode: UBEC_ROLE.UBEC_ME, organizationId: ubec.id, phoneNumber: "+234 803 555 0121" },
    { email: INDEPENDENT_ME_EMAIL, fullName: "Engr. Emeka Obi", roleCode: UBEC_ROLE.INDEPENDENT_ME, organizationId: monitorOrg.id, phoneNumber: "+234 803 555 0141" },
  ]) {
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: person.email,
        passwordHash: p.passwordHash,
        fullName: person.fullName,
        phoneNumber: person.phoneNumber,
        roleId: await roleId(person.roleCode),
        organizationId: person.organizationId,
      },
    });
    await prisma.userProjectAssignment.create({ data: { userId: user.id, projectId: central.id } });
  }

  // Direct Intervention project PRG-102: a BOQ in three bills, 5% retention.
  const budget = Number(central.totalBudgetNgn ?? 240_000_000);
  await prisma.project.update({
    where: { id: central.id },
    data: { retentionPercentage: 5, retentionDurationMonths: 12 },
  });
  const milestones = [
    {
      n: 1,
      name: "Substructure",
      share: 0.3,
      section: "BILL NO. 1 — SUBSTRUCTURE",
      items: [
        ["01.01", "Excavation and blinding to foundations", "m3", 420],
        ["01.02", "Reinforced concrete strip foundations", "m3", 180],
        ["01.03", "Ground floor slab, 150 mm", "m2", 1200],
      ],
    },
    {
      n: 2,
      name: "Superstructure",
      share: 0.4,
      section: "BILL NO. 2 — SUPERSTRUCTURE",
      items: [
        ["02.01", "Reinforced concrete columns and beams", "m3", 160],
        ["02.02", "225 mm sandcrete block walls", "m2", 2600],
        ["02.03", "Roof structure and long-span aluminium roofing", "m2", 1350],
      ],
    },
    {
      n: 3,
      name: "Finishes and WASH",
      share: 0.3,
      section: "BILL NO. 3 — FINISHES AND WASH",
      items: [
        ["03.01", "Plastering and painting", "m2", 5200],
        ["03.02", "Doors, windows and ironmongery", "item", 64],
        ["03.03", "Toilet block, borehole and hand-washing stations", "item", 1],
      ],
    },
  ] as const;
  for (const m of milestones) {
    const allocated = Math.round(budget * m.share * 100) / 100;
    const itemBudget = Math.round((allocated / m.items.length) * 100) / 100;
    for (const [wbsCode, description, unit, qty] of m.items) {
      await prisma.boqItem.create({
        data: {
          projectId: central.id,
          wbsCode,
          section: m.section,
          description,
          unit,
          totalQuantity: qty,
          rateNgn: Math.round((itemBudget / qty) * 100) / 100,
          budgetedCostNgn: itemBudget,
        },
      });
    }
  }
}
