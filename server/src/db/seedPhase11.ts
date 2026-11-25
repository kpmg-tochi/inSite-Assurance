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
import { KANO_ADMIN_EMAIL, LAGOS_ADMIN_EMAIL, tailorUbecRoles, UBEC_ADMIN_EMAIL, UBEC_ROLE } from "./seedUbecRoster";

/**
 * Phase 11 seed: a second tenant run as a programme with two delivery models, branded for UBEC
 * (Universal Basic Education Commission; UBEC Project Cycle Manual, Feb 2026).
 * - Organisation hierarchy: flagship UBEC (HQ) with the Kano and Lagos State Universal Basic
 *   Education Boards (SUBEBs) below it.
 * - Regions: geopolitical zones North West (Kano, Kaduna) and South West (Lagos, Ogun).
 * - Workflow templates and project types "Direct Intervention" (UBEC-led: owned and funded by UBEC)
 *   and "Matching Grants" (SUBEB-led: owned and funded by a SUBEB), with organisation-scoped
 *   approval steps (default cases: the Executive Secretary decides for Direct Intervention, the
 *   SUBEB Executive Chairman for Matching Grants; chains labelled in seedPhase13).
 * - Terminology: funder "Funding authority".
 * - One draft of each type, plus a live Matching Grants project per SUBEB and a live Direct
 *   Intervention project, so organisation-tree visibility can be shown.
 * - The UBEC roster (seedUbecRoster): the role catalogue in the client's words, the UBEC administrator
 *   and a SUBEB administrator for Kano and for Lagos.
 *
 * Projects are created through the real setup services, so type application, snapshots and
 * audit entries are genuine. Live projects are then switched on directly (no BOQ).
 */

export const PROGRAMME_TENANT_SLUG = "programme-authority";

/** UBEC rebrand: organisation names other seeds and tests look up. */
export const UBEC_ORG_NAME = "Universal Basic Education Commission (UBEC)";
export const KANO_SUBEB_NAME = "Kano State Universal Basic Education Board (SUBEB)";
export const LAGOS_SUBEB_NAME = "Lagos State Universal Basic Education Board (SUBEB)";
export const ME_CONSULTANTS_NAME = "Independent M&E Consultants (COREN-certified)";

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
      name: "Universal Basic Education Commission (UBEC)",
      slug: PROGRAMME_TENANT_SLUG,
      status: "ACTIVE",
      defaultCurrency: "NGN",
      timezone: "Africa/Lagos",
      brandingConfig: {
        primaryColorHex: "#00715D",
        navyColorHex: "#122F2A",
        logoUrl: "/client/ubec-logo.png",
        tagline: "Project Monitoring Portal",
        pdfHeaderTitle: "UBEC Project Monitoring Portal — Monitoring Report",
      } as unknown as Prisma.InputJsonValue,
      terminologyLabels: {
        funderParty: { singular: "Funding authority", plural: "Funding authorities" },
        // UBEC IRL: the client's own project ID (Project.externalReference).
        externalReference: { singular: "UBEC project ID", plural: "UBEC project IDs" },
      } as unknown as Prisma.InputJsonValue,
    },
  });
  await provisionDefaultRoles(prisma, tenant.id);
  // UBEC roster: the client's role names, M&E roles, unused default roles deleted (seedUbecRoster).
  await tailorUbecRoles(prisma, tenant.id);
  const role = (code: string) => prisma.role.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenant.id, code } } });
  await seedStarterTemplates(prisma, tenant.id);

  // Organisation hierarchy: UBEC HQ above the State Universal Basic Education Boards.
  const flagship = await prisma.organization.create({
    data: { tenantId: tenant.id, name: UBEC_ORG_NAME, categories: ["CLIENT_OWNER", "FINANCIER_LENDER"] },
  });
  const north = await prisma.organization.create({
    data: {
      tenantId: tenant.id,
      name: KANO_SUBEB_NAME,
      categories: ["CLIENT_OWNER", "FINANCIER_LENDER"],
      parentOrganizationId: flagship.id,
    },
  });
  const south = await prisma.organization.create({
    data: {
      tenantId: tenant.id,
      name: LAGOS_SUBEB_NAME,
      categories: ["CLIENT_OWNER", "FINANCIER_LENDER"],
      parentOrganizationId: flagship.id,
    },
  });
  const monitor = await prisma.organization.create({
    data: { tenantId: tenant.id, name: ME_CONSULTANTS_NAME, categories: ["ADVISORY_MONITOR"] },
  });
  const contractor = await prisma.organization.create({
    data: { tenantId: tenant.id, name: "Sahel Build & Civil Works Ltd", categories: ["CONTRACTOR"] },
  });

  // Regions (two levels): geopolitical zone, then state. Codes kept from the earlier seed.
  const regionN = await prisma.region.create({ data: { tenantId: tenant.id, name: "North West", code: "N" } });
  const regionS = await prisma.region.create({ data: { tenantId: tenant.id, name: "South West", code: "S" } });
  const kano = await prisma.region.create({ data: { tenantId: tenant.id, name: "Kano", code: "N-KAN", parentRegionId: regionN.id } });
  await prisma.region.create({ data: { tenantId: tenant.id, name: "Kaduna", code: "N-KAD", parentRegionId: regionN.id } });
  const lagos = await prisma.region.create({ data: { tenantId: tenant.id, name: "Lagos", code: "S-LAG", parentRegionId: regionS.id } });
  await prisma.region.create({ data: { tenantId: tenant.id, name: "Ogun", code: "S-OGU", parentRegionId: regionS.id } });

  // Users: the UBEC administrator and one SUBEB administrator per SUBEB (UBEC roster).
  const permsOf = async (roleId: string) =>
    (await prisma.rolePermission.findMany({ where: { roleId }, select: { permission: { select: { key: true } } } })).map(
      (rp) => rp.permission.key,
    );
  const adminRole = await role(UBEC_ROLE.ADMIN);
  const orgAdminRole = await role(UBEC_ROLE.SUBEB_ADMIN);
  const admin = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: UBEC_ADMIN_EMAIL,
      passwordHash: p.passwordHash,
      fullName: "Hauwa Bello",
      phoneNumber: "+234 803 555 0101",
      roleId: adminRole.id,
      organizationId: flagship.id,
    },
  });
  for (const [email, fullName, orgId] of [
    [KANO_ADMIN_EMAIL, "Aisha Musa", north.id],
    [LAGOS_ADMIN_EMAIL, "Chidi Okeke", south.id],
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
      name: "Direct Intervention process",
      description: "Visit report approval, handover and retention for Direct Intervention projects (UBEC-led).",
      configJson: centralTemplateConfig as unknown as Prisma.InputJsonValue,
    },
  });
  const coFundedTemplate = await prisma.workflowTemplate.create({
    data: {
      tenantId: tenant.id,
      name: "Matching Grants process",
      description: "Visit report approval, handover and retention for Matching Grants projects (SUBEB-led).",
      configJson: coFundedTemplateConfig as unknown as Prisma.InputJsonValue,
    },
  });

  // Project types.
  const central: SaveProjectTypeRequestInput = {
    code: "CENTRAL",
    name: "Direct Intervention",
    description:
      "UBEC-led projects: owned and funded by UBEC, Director Physical Planning as process owner, kick-off and supervision by the UBEC State/Zonal Offices, M&E by UBEC HQ.",
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
    },
  };
  const coFunded: SaveProjectTypeRequestInput = {
    code: "CO_FUNDED",
    name: "Matching Grants",
    description:
      "SUBEB-led projects under the Matching Grants programme: the State Universal Basic Education Board owns and delivers the project; UBEC State/Zonal representatives join monitoring and completion verification.",
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
    name: "Kano Model Primary School (draft)",
    typeId: centralType.id,
    regionId: kano.id,
    ownerId: null, // the type's default owner (UBEC HQ) is applied
    beneficiary: "Kano Model Primary School",
    budget: 180_000_000,
  });
  await project({
    code: "PRG-201",
    name: "Lagos Community Secondary School (draft)",
    typeId: coFundedType.id,
    regionId: lagos.id,
    ownerId: south.id,
    beneficiary: "Lagos Community Secondary School",
    budget: 95_000_000,
  });
  await project({
    code: "PRG-102",
    name: "Kano Girls' Science College",
    typeId: centralType.id,
    regionId: kano.id,
    ownerId: null,
    beneficiary: "Kano Girls' Science College",
    budget: 240_000_000,
    live: { lat: 12.0022, lng: 8.592, label: "Girls' Science College, Kano" },
  });
  await project({
    code: "PRG-211",
    name: "Kano Township Primary School",
    typeId: coFundedType.id,
    regionId: kano.id,
    ownerId: north.id,
    beneficiary: "Kano Township Primary School",
    budget: 70_000_000,
    live: { lat: 11.9964, lng: 8.5167, label: "Township Primary School, Kano" },
  });
  await project({
    code: "PRG-221",
    name: "Ikeja Junior Secondary School",
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
    name: "Kano Technical College",
    typeId: centralType.id,
    regionId: kano.id,
    ownerId: null,
    beneficiary: "Kano Technical College",
    budget: 150_000_000,
    live: { lat: 12.0151, lng: 8.5309, label: "Technical College, Kano" },
  });
  await project({
    code: "PRG-241",
    name: "Surulere Community Primary School",
    typeId: coFundedType.id,
    regionId: lagos.id,
    ownerId: south.id,
    beneficiary: "Surulere Community Primary School",
    budget: 64_000_000,
    live: { lat: 6.4995, lng: 3.3536, label: "Community Primary School, Surulere" },
  });

  return { tenantId: tenant.id };
}
