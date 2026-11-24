import { Prisma } from "@prisma/client";
import { RadialGeofence, STANDARDS_LIBRARY } from "@insite/shared";
import { prisma } from "../config/prisma";
import { recordAuditEvent } from "../modules/audit/audit.service";
import { applyTemplateConfig } from "../modules/process/processConfig.service";
import { projectObjectPrefix } from "../integrations/storage.service";
import { seedStarterTemplates } from "../modules/process/workflowTemplates.service";

/**
 * Phase 7 seed:
 * - the three starter workflow templates;
 * - default process rows and chains for every seeded live project (Phase 3 / 4 behaviour);
 * - EDO-410, an M&E-only project with report approval, with two
 *   standards from the starter library, so two projects in one tenant run different processes.
 */

type SeedRole = { id: string; name: string };

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000);

export async function seedPhase7(p: {
  tenantId: string;
  monitorOrgId: string;
  lenderOrgId: string;
  civilContractorOrgId: string;
  monitorUserId: string;
  lenderUserId: string;
  monitorRoleId: string;
  passwordHash: string;
  residentRole: SeedRole;
}) {
  await seedStarterTemplates(prisma, p.tenantId);

  // Every existing project gets the default process explicitly.
  const projects = await prisma.project.findMany({
    where: { tenantId: p.tenantId },
    select: { id: true, tenantId: true, codePrefix: true, status: true, setupState: true },
  });
  const standard = await prisma.workflowTemplate.findFirstOrThrow({ where: { tenantId: p.tenantId, isDefault: true } });
  for (const project of projects) {
    await prisma.$transaction((tx) => applyTemplateConfig(tx, project, standard));
  }

  // ------------------------------------------------------------------------
  // EDO-410: M&E-only oversight
  // ------------------------------------------------------------------------
  const geofence: RadialGeofence = {
    mode: "RADIAL",
    siteLabel: "Ikpoba Hill primary health centre",
    center: { latitude: 6.3176, longitude: 5.6145 },
    radiusMeters: 250,
  };
  const at = daysAgo(2).toISOString();
  const edo = await prisma.project.create({
    data: {
      tenantId: p.tenantId,
      status: "ACTIVE",
      activatedAt: daysAgo(2),
      createdByUserId: p.monitorUserId,
      activatedByUserId: p.monitorUserId,
      name: "Edo Primary Health Centres — Ikpoba Hill Renovation",
      codePrefix: "EDO-410",
      stateLocation: "Edo State",
      lgaLocation: "Ikpoba-Okha",
      description: "Grant-funded renovation monitored by independent M&E officers; releases follow verified milestones.",
      totalBudgetNgn: 420_000_000,
      timezone: "Africa/Lagos",
      geofenceMode: "RADIAL",
      geofenceGeoJson: geofence as unknown as Prisma.InputJsonValue,
      monitorOrganizationId: p.monitorOrgId,
      lenderOrganizationId: p.lenderOrgId,
      setupState: {
        steps: Object.fromEntries(
          ["basics", "parties", "site", "facility", "boq", "reporting", "process", "standards", "team"].map((id) => [
            id,
            { savedAt: at, savedByUserId: p.monitorUserId, completedAt: at, completedByUserId: p.monitorUserId },
          ]),
        ),
      } as unknown as Prisma.InputJsonValue,
    },
  });
  await prisma.projectContractor.create({
    data: {
      projectId: edo.id,
      organizationId: p.civilContractorOrgId,
      tradeCategory: "Building works",
      tradeCode: "BLD",
    },
  });
  for (const [wbs, desc, unit, qty, rate] of [
    ["01.01", "Reinforced concrete column and beam repairs", "m3", 60, 1_250_000],
    ["01.02", "Sandcrete blockwork walls (225mm)", "m2", 1_800, 45_000],
    ["01.03", "Roof structure and long-span aluminium roofing", "m2", 950, 98_000],
  ] as const) {
    await prisma.boqItem.create({
      data: {
        projectId: edo.id,
        wbsCode: wbs,
        section: "BILL 1 — STRUCTURE AND ROOFING",
        description: desc,
        unit,
        totalQuantity: qty,
        rateNgn: rate,
        budgetedCostNgn: qty * rate,
      },
    });
  }
  // Its own licensed M&E verifier (web only), so earlier phases' fixtures keep their project lists.
  const verifier = await prisma.user.create({
    data: {
      tenantId: p.tenantId,
      email: "verifier@insite.ng",
      passwordHash: p.passwordHash,
      fullName: "Engr. Osaro Igbinedion, MNSE",
      roleId: p.monitorRoleId,
      organizationId: p.monitorOrgId,
    },
  });
  await prisma.userProjectAssignment.createMany({
    data: [
      { userId: verifier.id, projectId: edo.id },
      { userId: p.lenderUserId, projectId: edo.id },
    ],
  });

  const meTemplate = await prisma.workflowTemplate.findFirstOrThrow({
    where: { tenantId: p.tenantId, name: "M&E-only oversight" },
  });
  await prisma.$transaction(async (tx) => {
    await applyTemplateConfig(
      tx,
      { id: edo.id, tenantId: p.tenantId, codePrefix: edo.codePrefix, status: "DRAFT", setupState: edo.setupState },
      meTemplate,
    );
  });

  for (const code of ["CONC-SLUMP", "BLOCK-NIS87"]) {
    const entry = STANDARDS_LIBRARY.find((s) => s.code === code)!;
    await prisma.projectStandardSpecification.create({
      data: {
        projectId: edo.id,
        code: entry.code,
        title: entry.title,
        category: entry.category,
        specificationText: entry.specificationText,
        applicableWbsCodes: (code === "CONC-SLUMP" ? ["01.01"] : ["01.02"]) as unknown as Prisma.InputJsonValue,
        isMandatory: entry.isMandatory || code === "CONC-SLUMP",
        createdByUserId: p.monitorUserId,
      },
    });
  }
  await prisma.projectNeedsAssessmentDocument.create({
    data: {
      projectId: edo.id,
      title: "Ikpoba Hill community health needs assessment (seed fixture)",
      documentType: "COMMUNITY_NEEDS_ASSESSMENT",
      objectKey: `${projectObjectPrefix(p.tenantId, edo.id)}project_document/seed-needs-assessment.pdf`,
      mimeType: "application/pdf",
      byteSize: 1,
      uploadedByUserId: p.monitorUserId,
    },
  });

  await recordAuditEvent(prisma, {
    projectId: edo.id,
    actorType: "WEB_USER",
    actorId: p.monitorUserId,
    actorDisplayName: "Seed",
    action: "PROJECT_ACTIVATED",
    summaryText: "Seeded M&E-only project EDO-410 (report approval on).",
    payload: { codePrefix: "EDO-410", workflowTemplate: meTemplate.name },
  });

}
