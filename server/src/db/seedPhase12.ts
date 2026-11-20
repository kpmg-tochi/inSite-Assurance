import { Prisma } from "@prisma/client";
import { ProjectTypeConfigSchema, TenantCredentialPolicy } from "@insite/shared";
import { prisma } from "../config/prisma";
import { provisionDefaultRegistrationBodies } from "../modules/credentials/registrationBodies.service";
import { PROGRAMME_TENANT_SLUG } from "./seedPhase11";

/**
 * Phase 12 seed: configurable professional registration and fixed-amount payment milestones.
 * - Every tenant gets the six default registration bodies (tenant provisioning does the same).
 * - Programme tenant: registration OPTIONAL for certifiers and field assurance, on the tenant and on
 *   both project types; both types default new payment milestones to FIXED_ON_COMPLETION with
 *   direct milestone release. Type versions stay 1; project snapshots get the same config.
 * - A programme monitor with no registration on the profile (programme.monitor@insite.ng) and a
 *   funding-authority approver (programme.funder@insite.ng), both on the live Central project.
 * - Central project PRG-102: three fixed payment milestones (30% substructure, 40% superstructure,
 *   30% finishes and WASH) with BOQ items mapped to each, 5% retention.
 * Other tenants keep no policy, so they behave as before (REQUIRED).
 */
export async function seedPhase12(p: { passwordHash: string }) {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  for (const t of tenants) await provisionDefaultRegistrationBodies(prisma, t.id);

  const tenant = await prisma.tenant.findUnique({ where: { slug: PROGRAMME_TENANT_SLUG } });
  if (!tenant) return;
  const policy: TenantCredentialPolicy = { certifier: "OPTIONAL", fieldAssurance: "OPTIONAL" };
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { credentialPolicyJson: policy as unknown as Prisma.InputJsonValue },
  });

  // Project types: credentials and payments. A seed write in place (version unchanged), as if the
  // Phase 11 seed had created the types with these settings; project snapshots are refreshed too.
  const types = await prisma.projectType.findMany({ where: { tenantId: tenant.id } });
  for (const type of types) {
    const config = ProjectTypeConfigSchema.parse({
      ...(type.configJson as Record<string, unknown>),
      credentials: { certifier: "OPTIONAL", fieldAssurance: "OPTIONAL" },
      payments: {
        defaultBasis: "FIXED_ON_COMPLETION",
        defaultCompletionRule: "ALL_ITEMS_COMPLETE",
        mechanism: "MILESTONE_DIRECT_DISBURSEMENT",
      },
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

  // People: a monitor without a registration (policy OPTIONAL lets them verify) and an approver.
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
        fullName: "Ngozi Eze (Programme Monitor, no registration on file)",
        roleId: monitorRole.id,
        organizationId: monitorOrg.id,
        professionalRegistrationBodyCode: null,
        professionalRegistrationNumber: null,
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
        fullName: "Ibrahim Sule (Funding authority approver)",
        roleId: lenderRole.id,
        organizationId: flagship.id,
      },
    });
    await prisma.userProjectAssignment.create({ data: { userId: funder.id, projectId: central.id } });
  }

  // Central project: three fixed payment milestones with mapped BOQ items, 5% retention.
  const budget = Number(central.totalBudgetNgn ?? 240_000_000);
  await prisma.project.update({
    where: { id: central.id },
    data: { retentionPercentage: 5, retentionDurationMonths: 12 },
  });
  const contractor = await prisma.projectContractor.findFirst({ where: { projectId: central.id, isMainContractor: true } });
  const milestones = [
    {
      n: 1,
      name: "Payment milestone 1 — Substructure",
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
      name: "Payment milestone 2 — Superstructure",
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
      name: "Payment milestone 3 — Finishes and WASH",
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
    const tranche = await prisma.facilityTranche.create({
      data: {
        projectId: central.id,
        trancheNumber: m.n,
        name: m.name,
        allocatedAmountNgn: allocated,
        targetCompletionPct: 100,
        paymentBasis: "FIXED_ON_COMPLETION",
        completionRule: "ALL_ITEMS_COMPLETE",
        fixedReleaseAmountNgn: null, // the allocated amount
        completionRequiredItemPct: 100,
        conditionsPrecedent: {
          create: [
            {
              referenceCode: `CP-${String(m.n).padStart(2, "0")}`,
              description: `Monitor's site visit report for ${m.name.split(" — ")[1].toLowerCase()} on file`,
              isMandatoryForRelease: true,
              status: m.n === 1 ? "SATISFIED" : "PENDING",
            },
          ],
        },
      },
    });
    const itemBudget = Math.round((allocated / m.items.length) * 100) / 100;
    for (const [wbsCode, description, unit, qty] of m.items) {
      await prisma.boqItem.create({
        data: {
          projectId: central.id,
          trancheId: tranche.id,
          trancheMappingConfirmedByMonitor: true,
          projectContractorId: contractor?.id ?? null,
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
