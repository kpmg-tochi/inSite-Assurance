import { Prisma } from "@prisma/client";
import { ProjectTypeConfigSchema } from "@insite/shared";
import { prisma } from "../config/prisma";
import { PROGRAMME_TENANT_SLUG } from "./seedPhase11";

/**
 * Phase 12 seed (redesign R1b removed payment milestones, R1d removed professional registration):
 * - Programme tenant: both project types default new projects to 5% retention over 12 months. Type
 *   versions stay 1; project snapshots get the same config.
 * - A programme monitor (programme.monitor@insite.ng) and a funding-authority finance officer
 *   (programme.funder@insite.ng), both on the live Central project.
 * - Central project PRG-102: a BOQ in three bills (substructure, superstructure, finishes and
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

  // People: a monitor and a finance officer.
  const monitorOrg = await prisma.organization.findFirst({
    where: { tenantId: tenant.id, name: "Programme Monitoring Consultants" },
  });
  const flagship = await prisma.organization.findFirst({ where: { tenantId: tenant.id, name: "Programme Authority" } });
  const monitorRole = await prisma.role.findFirst({ where: { tenantId: tenant.id, code: "MONITOR" } });
  const lenderRole = await prisma.role.findFirst({ where: { tenantId: tenant.id, code: "LENDER" } });
  if (monitorOrg && monitorRole) {
    const monitor = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: "programme.monitor@insite.ng",
        passwordHash: p.passwordHash,
        fullName: "Ngozi Eze (Programme Monitor)",
        roleId: monitorRole.id,
        organizationId: monitorOrg.id,
      },
    });
    await prisma.userProjectAssignment.create({ data: { userId: monitor.id, projectId: central.id } });
  }
  if (flagship && lenderRole) {
    const funder = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: "programme.funder@insite.ng",
        passwordHash: p.passwordHash,
        fullName: "Ibrahim Sule (Funding authority finance officer)",
        roleId: lenderRole.id,
        organizationId: flagship.id,
      },
    });
    await prisma.userProjectAssignment.create({ data: { userId: funder.id, projectId: central.id } });
  }

  // Central project: a BOQ in three bills, 5% retention.
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
