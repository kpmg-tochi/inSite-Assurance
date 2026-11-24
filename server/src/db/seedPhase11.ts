import { Prisma } from "@prisma/client";
import {
  DEFAULT_PROJECT_PROCESS_CONFIG,
  defaultReportChain,
  RadialGeofence,
  SaveProjectTypeRequestInput,
  SaveProjectTypeRequestSchema,
  WorkflowTemplateConfig,
} from "@insite/shared";
import { prisma } from "../config/prisma";
import { WebJwtPayload } from "../middleware/auth.middleware";
import { provisionDefaultRoles } from "../modules/rbac/rbac.service";
import { seedStarterTemplates } from "../modules/process/workflowTemplates.service";
import { createProjectType } from "../modules/projectTypes/projectTypes.service";
import { createProjectDraft, saveProjectSetupStep } from "../modules/projects/projectSetup.service";

/**
 * Phase 11 seed: a second tenant run as a programme with two delivery models.
 * - Organisation hierarchy: flagship "Programme Authority" with subsidiaries North and South.
 * - Regions North and South, each with two areas.
 * - Workflow templates and project types "Central Delivery Model" (owned and funded by the
 *   flagship) and "Co-Funded Delivery Model" (owned and funded by a subsidiary), with
 *   organisation-scoped approval steps (default cases).
 * - Terminology: funder "Funding authority".
 * - One draft of each type, plus a live Co-Funded project per subsidiary and a live Central
 *   project, so organisation-tree visibility can be shown.
 * - An "Organisation Administrator" per organisation (flagship, North, South).
 *
 * Projects are created through the real setup services, so type application, snapshots and
 * audit entries are genuine. Live projects are then switched on directly (no BOQ).
 */

export const PROGRAMME_TENANT_SLUG = "programme-authority";

function webPayload(
  user: { id: string; email: string; fullName: string; tenantId: string; organizationId: string },
  role: { id: string; code: string; name: string },
  permissions: string[],
): WebJwtPayload {
  return {
    tokenType: "WEB_USER",
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    tenantId: user.tenantId,
    isPlatformSuperAdmin: false,
    roleId: role.id,
    roleCode: role.code,
    roleName: role.name,
    permissions,
    organizationId: user.organizationId,
    mustChangePassword: false,
  };
}

const geofence = (label: string, latitude: number, longitude: number): RadialGeofence => ({
  mode: "RADIAL",
  siteLabel: label,
  center: { latitude, longitude },
  radiusMeters: 200,
});

export async function seedPhase11(p: { passwordHash: string }) {
  const tenant = await prisma.tenant.create({
    data: {
      name: "Programme Authority (demo programme)",
      slug: PROGRAMME_TENANT_SLUG,
      status: "ACTIVE",
      defaultCurrency: "NGN",
      timezone: "Africa/Lagos",
      brandingConfig: {
        primaryColorHex: "#1D4ED8",
        tagline: "Schools Infrastructure Programme",
        pdfHeaderTitle: "Programme Authority — Monitoring Report",
      } as unknown as Prisma.InputJsonValue,
      terminologyLabels: {
        funderParty: { singular: "Funding authority", plural: "Funding authorities" },
      } as unknown as Prisma.InputJsonValue,
    },
  });
  const roles = await provisionDefaultRoles(prisma, tenant.id);
  const role = (code: string) => roles.get(code)!;
  await seedStarterTemplates(prisma, tenant.id);

  // Organisation hierarchy.
  const flagship = await prisma.organization.create({
    data: { tenantId: tenant.id, name: "Programme Authority", categories: ["CLIENT_OWNER", "FINANCIER_LENDER"] },
  });
  const north = await prisma.organization.create({
    data: {
      tenantId: tenant.id,
      name: "Regional Delivery Entity – North",
      categories: ["CLIENT_OWNER", "FINANCIER_LENDER"],
      parentOrganizationId: flagship.id,
    },
  });
  const south = await prisma.organization.create({
    data: {
      tenantId: tenant.id,
      name: "Regional Delivery Entity – South",
      categories: ["CLIENT_OWNER", "FINANCIER_LENDER"],
      parentOrganizationId: flagship.id,
    },
  });
  const monitor = await prisma.organization.create({
    data: { tenantId: tenant.id, name: "Programme Monitoring Consultants", categories: ["ADVISORY_MONITOR"] },
  });
  const contractor = await prisma.organization.create({
    data: { tenantId: tenant.id, name: "Sahel Build & Civil Works Ltd", categories: ["CONTRACTOR"] },
  });

  // Regions (two levels).
  const regionN = await prisma.region.create({ data: { tenantId: tenant.id, name: "North", code: "N" } });
  const regionS = await prisma.region.create({ data: { tenantId: tenant.id, name: "South", code: "S" } });
  const kano = await prisma.region.create({ data: { tenantId: tenant.id, name: "Kano", code: "N-KAN", parentRegionId: regionN.id } });
  await prisma.region.create({ data: { tenantId: tenant.id, name: "Kaduna", code: "N-KAD", parentRegionId: regionN.id } });
  const lagos = await prisma.region.create({ data: { tenantId: tenant.id, name: "Lagos", code: "S-LAG", parentRegionId: regionS.id } });
  await prisma.region.create({ data: { tenantId: tenant.id, name: "Enugu", code: "S-ENU", parentRegionId: regionS.id } });

  // Users: a tenant administrator and one organisation administrator per organisation.
  const permsOf = async (roleId: string) =>
    (await prisma.rolePermission.findMany({ where: { roleId }, select: { permission: { select: { key: true } } } })).map(
      (rp) => rp.permission.key,
    );
  const adminRole = role("TENANT_SUPER_ADMIN");
  const orgAdminRole = role("ORGANIZATION_ADMIN");
  const admin = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: "programme.admin@insite.ng",
      passwordHash: p.passwordHash,
      fullName: "Hauwa Bello (Programme Administrator)",
      roleId: adminRole.id,
      organizationId: flagship.id,
    },
  });
  for (const [email, fullName, orgId] of [
    ["flagship.admin@insite.ng", "Kunle Ade (Programme Authority)", flagship.id],
    ["north.admin@insite.ng", "Aisha Musa (Delivery Entity North)", north.id],
    ["south.admin@insite.ng", "Chidi Okeke (Delivery Entity South)", south.id],
  ] as const) {
    await prisma.user.create({
      data: { tenantId: tenant.id, email, passwordHash: p.passwordHash, fullName, roleId: orgAdminRole.id, organizationId: orgId },
    });
  }
  const adminPayload = webPayload(admin, adminRole, await permsOf(adminRole.id));

  // Workflow templates (redesign R1b: payments happen outside the platform; no disbursement chain).
  const centralTemplateConfig: WorkflowTemplateConfig = {
    process: {
      ...DEFAULT_PROJECT_PROCESS_CONFIG,
      requireReportApproval: true,
      enableHandoverModule: true,
      enableRetentionModule: true,
    },
    reportChain: defaultReportChain(),
  };
  const coFundedTemplateConfig: WorkflowTemplateConfig = {
    ...centralTemplateConfig,
  };
  const centralTemplate = await prisma.workflowTemplate.create({
    data: {
      tenantId: tenant.id,
      name: "Central delivery process",
      description: "Report approval, handover and retention for Central Delivery Model projects.",
      configJson: centralTemplateConfig as unknown as Prisma.InputJsonValue,
    },
  });
  const coFundedTemplate = await prisma.workflowTemplate.create({
    data: {
      tenantId: tenant.id,
      name: "Co-funded delivery process",
      description: "Report approval, handover and retention for Co-Funded Delivery Model projects.",
      configJson: coFundedTemplateConfig as unknown as Prisma.InputJsonValue,
    },
  });

  // Project types.
  const reportingDefaults = { reportingCadence: "WEEKLY" as const, workdayStartTime: "07:30", workdayEndTime: "16:30" };
  const central: SaveProjectTypeRequestInput = {
    code: "CENTRAL",
    name: "Central Delivery Model",
    description: "Delivered and funded centrally by the Programme Authority.",
    colour: "#6546FC",
    workflowTemplateId: centralTemplate.id,
    isDefault: true,
    isActive: true,
    config: {
      ownership: {
        owningOrganizationRequired: true,
        allowedOwningOrganizationIds: [flagship.id],
        defaultOwningOrganizationId: flagship.id,
      },
      parties: {
        monitorRequired: true,
        funderRequired: true,
        beneficiaryRequired: true,
        regionRequired: true,
        funderDefault: "FIXED",
        defaultFunderOrganizationId: flagship.id,
      },
      reportingDefaults,
    },
  };
  const coFunded: SaveProjectTypeRequestInput = {
    code: "CO_FUNDED",
    name: "Co-Funded Delivery Model",
    description: "Delivered and funded by a regional delivery entity, itself funded by the Programme Authority.",
    colour: "#0E9F6E",
    workflowTemplateId: coFundedTemplate.id,
    isDefault: false,
    isActive: true,
    config: {
      ownership: {
        owningOrganizationRequired: true,
        allowedOwningOrganizationIds: [north.id, south.id],
        defaultOwningOrganizationId: null,
      },
      parties: {
        monitorRequired: true,
        funderRequired: true,
        beneficiaryRequired: true,
        regionRequired: true,
        funderDefault: "OWNER",
        defaultFunderOrganizationId: null,
      },
      reportingDefaults: { ...reportingDefaults, reportingCadence: "BI_WEEKLY" },
    },
  };
  const centralType = await createProjectType(adminPayload, SaveProjectTypeRequestSchema.parse(central));
  const coFundedType = await createProjectType(adminPayload, SaveProjectTypeRequestSchema.parse(coFunded));

  // Projects through the real services.
  async function project(spec: {
    code: string;
    name: string;
    typeId: string;
    regionId: string;
    ownerId: string | null;
    beneficiary: string;
    budget: number;
    live?: { lat: number; lng: number; label: string };
  }) {
    const draft = await createProjectDraft(adminPayload, {
      name: spec.name,
      codePrefix: spec.code,
      stateLocation: spec.regionId === kano.id ? "Kano State" : "Lagos State",
      lgaLocation: null,
      description: null,
      totalBudgetNgn: spec.budget,
      projectTypeId: spec.typeId,
      regionId: spec.regionId,
    });
    await saveProjectSetupStep(draft.projectId, "parties", adminPayload, {
      ...(spec.ownerId ? { owningOrganizationId: spec.ownerId } : {}),
      monitorOrganization: { id: monitor.id },
      contractors: [{ organization: { id: contractor.id }, tradeCategory: "Civil works", tradeCode: "CIV" }],
      beneficiaries: [
        {
          name: spec.beneficiary,
          beneficiaryType: "SCHOOL",
          contactName: "Head teacher",
          contactEmail: `headteacher.${spec.code.toLowerCase()}@example.org`,
          isPrimary: true,
        },
      ],
    });
    if (spec.live) {
      await prisma.project.update({
        where: { id: draft.projectId },
        data: {
          status: "ACTIVE",
          activatedAt: new Date(),
          activatedByUserId: admin.id,
          geofenceMode: "RADIAL",
          geofenceGeoJson: geofence(spec.live.label, spec.live.lat, spec.live.lng) as unknown as Prisma.InputJsonValue,
        },
      });
    }
    return draft.projectId;
  }

  await project({
    code: "PRG-101",
    name: "Central — Kano Model Primary School (draft)",
    typeId: centralType.id,
    regionId: kano.id,
    ownerId: null, // the type's default owner (the flagship) is applied
    beneficiary: "Kano Model Primary School",
    budget: 180_000_000,
  });
  await project({
    code: "PRG-201",
    name: "Co-Funded — Lagos Community Secondary School (draft)",
    typeId: coFundedType.id,
    regionId: lagos.id,
    ownerId: south.id,
    beneficiary: "Lagos Community Secondary School",
    budget: 95_000_000,
  });
  await project({
    code: "PRG-102",
    name: "Central — Kano Girls' Science College",
    typeId: centralType.id,
    regionId: kano.id,
    ownerId: null,
    beneficiary: "Kano Girls' Science College",
    budget: 240_000_000,
    live: { lat: 12.0022, lng: 8.592, label: "Girls' Science College, Kano" },
  });
  await project({
    code: "PRG-211",
    name: "Co-Funded — Kano Township Primary School",
    typeId: coFundedType.id,
    regionId: kano.id,
    ownerId: north.id,
    beneficiary: "Kano Township Primary School",
    budget: 70_000_000,
    live: { lat: 11.9964, lng: 8.5167, label: "Township Primary School, Kano" },
  });
  await project({
    code: "PRG-221",
    name: "Co-Funded — Ikeja Junior Secondary School",
    typeId: coFundedType.id,
    regionId: lagos.id,
    ownerId: south.id,
    beneficiary: "Ikeja Junior Secondary School",
    budget: 85_000_000,
    live: { lat: 6.6018, lng: 3.3515, label: "Junior Secondary School, Ikeja" },
  });
  // Phase 15 (advanced to handover, retention and closure by seedPhase15).
  await project({
    code: "PRG-103",
    name: "Central — Kano Technical College",
    typeId: centralType.id,
    regionId: kano.id,
    ownerId: null,
    beneficiary: "Kano Technical College",
    budget: 150_000_000,
    live: { lat: 12.0151, lng: 8.5309, label: "Technical College, Kano" },
  });
  await project({
    code: "PRG-241",
    name: "Co-Funded — Surulere Community Primary School",
    typeId: coFundedType.id,
    regionId: lagos.id,
    ownerId: south.id,
    beneficiary: "Surulere Community Primary School",
    budget: 64_000_000,
    live: { lat: 6.4995, lng: 3.3536, label: "Community Primary School, Surulere" },
  });

  return { tenantId: tenant.id };
}
