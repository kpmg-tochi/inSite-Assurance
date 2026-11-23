import { Prisma } from "@prisma/client";
import type { PerimeterGeofence, RadialGeofence } from "@insite/shared";
import { prisma } from "../config/prisma";
import { recordAuditEvent } from "../modules/audit/audit.service";
import { createJoinCode } from "../modules/projects/joinCodes.service";

/**
 * Phase 6 seed: an organisation directory with tags, a multi-prime project with three contractor
 * packages, a perimeter-geofence project, and a draft with three setup steps complete.
 * LKK-402 and ABJ-108 (seeded before this) are the single-contractor projects.
 */

type SeedRole = { id: string; code: string; codeSuffix: string | null; name: string; fieldPersonaType: string };

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000);

function stepState(stepIds: string[], userId: string) {
  const at = daysAgo(1).toISOString();
  return {
    steps: Object.fromEntries(
      stepIds.map((id) => [id, { savedAt: at, savedByUserId: userId, completedAt: at, completedByUserId: userId }]),
    ),
    team: { joinCodeRoleIds: null },
  } as unknown as Prisma.InputJsonValue;
}

export async function seedPhase6Projects(p: {
  tenantId: string;
  monitorOrgId: string;
  lenderOrgId: string;
  civilContractorOrgId: string;
  monitorUserId: string;
  contractorUserId: string;
  contractorRoleId: string;
  passwordHash: string;
  residentRole: SeedRole;
  contractorEngineerRole: SeedRole;
}) {
  // ------------------------------------------------------------------------
  // Organisation directory
  // ------------------------------------------------------------------------
  const voltaic = await prisma.organization.create({
    data: {
      tenantId: p.tenantId,
      name: "Voltaic Power Systems Ltd",
      categories: ["CONTRACTOR"],
      registrationNumber: "RC-902114",
      contactEmail: "projects@voltaic.example",
    },
  });
  const aquaflow = await prisma.organization.create({
    data: {
      tenantId: p.tenantId,
      name: "AquaFlow MEP Services Ltd",
      categories: ["CONTRACTOR"],
      registrationNumber: "RC-775031",
    },
  });
  await prisma.organization.create({
    data: {
      tenantId: p.tenantId,
      name: "Kano State Ministry of Health",
      categories: ["CLIENT_OWNER", "GOVERNMENT_MDA"],
    },
  });
  await prisma.organization.create({
    data: {
      tenantId: p.tenantId,
      name: "Northern Infrastructure Development Fund",
      categories: ["FINANCIER_LENDER"],
    },
  });
  await prisma.organization.create({
    data: {
      tenantId: p.tenantId,
      name: "Legacy Works Partnership (dissolved)",
      categories: ["CONTRACTOR"],
      isArchived: true,
    },
  });

  // A web user for the second multi-prime contractor, so two contractors can run claims.
  const electricalUser = await prisma.user.create({
    data: {
      tenantId: p.tenantId,
      email: "electrical@insite.ng",
      passwordHash: p.passwordHash,
      fullName: "Engr. Ifeoma Okafor, MNSE",
      roleId: p.contractorRoleId,
      organizationId: voltaic.id,
      professionalRegistrationBodyCode: "COREN",
      professionalRegistrationNumber: "R.61844",
    },
  });

  // ------------------------------------------------------------------------
  // KAN-210: multi-prime, three packages, radial geofence
  // ------------------------------------------------------------------------
  const kanGeofence: RadialGeofence = {
    mode: "RADIAL",
    siteLabel: "Kano General Hospital Annex site",
    center: { latitude: 12.0022, longitude: 8.592 },
    radiusMeters: 250,
  };
  const kan = await prisma.project.create({
    data: {
      tenantId: p.tenantId,
      status: "ACTIVE",
      activatedAt: daysAgo(30),
      createdByUserId: p.monitorUserId,
      activatedByUserId: p.monitorUserId,
      name: "Kano General Hospital Annex & Utilities",
      codePrefix: "KAN-210",
      stateLocation: "Kano State",
      lgaLocation: "Kano Municipal",
      description: "Three-storey clinical annex with its electrical and mechanical services, delivered by three prime contractors.",
      totalBudgetNgn: 3200000000,
      reportingCadence: "DAILY",
      timezone: "Africa/Lagos",
      geofenceMode: "RADIAL",
      geofenceGeoJson: kanGeofence as unknown as Prisma.InputJsonValue,
      monitorOrganizationId: p.monitorOrgId,
      lenderOrganizationId: p.lenderOrgId,
      contractorExecutionMode: "MULTI_PRIME_SEPARATE_IPC",
      setupState: stepState(["basics", "parties", "site", "facility", "boq", "reporting", "team"], p.monitorUserId),
    },
  });
  const civ = await prisma.projectContractor.create({
    data: {
      projectId: kan.id,
      organizationId: p.civilContractorOrgId,
      tradeCategory: "Civil and structural works",
      tradeCode: "CIV",
      isMainContractor: true,
      allocatedBudgetNgn: 1800000000,
      plannedMobilizationDate: daysAgo(28),
    },
  });
  const elec = await prisma.projectContractor.create({
    data: {
      projectId: kan.id,
      organizationId: voltaic.id,
      tradeCategory: "Electrical works",
      tradeCode: "ELEC",
      allocatedBudgetNgn: 800000000,
      plannedMobilizationDate: daysAgo(14),
    },
  });
  const mep = await prisma.projectContractor.create({
    data: {
      projectId: kan.id,
      organizationId: aquaflow.id,
      tradeCategory: "Mechanical and plumbing",
      tradeCode: "MEP",
      allocatedBudgetNgn: 600000000,
      allowFieldReporting: true,
    },
  });
  const kanItems: Array<{
    wbs: string; section: string; desc: string; unit: string; qty: number; rate: number;
    contractor: string; hold?: boolean;
  }> = [
    { wbs: "01.01", section: "BILL 1 — SUBSTRUCTURE", desc: "Reinforced concrete pad foundations and ground beams", unit: "m3", qty: 420, rate: 1_450_000, contractor: civ.id, hold: true },
    { wbs: "01.02", section: "BILL 1 — SUPERSTRUCTURE", desc: "Reinforced concrete frame, columns, beams and suspended slabs", unit: "m3", qty: 610, rate: 1_520_000, contractor: civ.id },
    { wbs: "02.01", section: "BILL 2 — ELECTRICAL", desc: "Supply and install 500kVA transformer and main distribution board", unit: "item", qty: 1, rate: 185_000_000, contractor: elec.id },
    { wbs: "02.02", section: "BILL 2 — ELECTRICAL", desc: "Conduit, cabling and wiring for lighting and power circuits", unit: "m", qty: 18_000, rate: 22_500, contractor: elec.id },
    { wbs: "03.01", section: "BILL 3 — MECHANICAL & PLUMBING", desc: "Cold and hot water supply pipework including pumps", unit: "m", qty: 6_400, rate: 38_000, contractor: mep.id },
    { wbs: "03.02", section: "BILL 3 — MECHANICAL & PLUMBING", desc: "Medical gas pipeline and outlets to wards", unit: "item", qty: 1, rate: 160_000_000, contractor: mep.id },
  ];
  for (const i of kanItems) {
    await prisma.boqItem.create({
      data: {
        projectId: kan.id,
        projectContractorId: i.contractor,
        wbsCode: i.wbs,
        section: i.section,
        description: i.desc,
        unit: i.unit,
        totalQuantity: i.qty,
        rateNgn: i.rate,
        budgetedCostNgn: i.qty * i.rate,
        isHoldPoint: Boolean(i.hold),
        holdPointInstruction: i.hold ? "Photograph reinforcement before the pour." : null,
      },
    });
  }
  await createJoinCode(prisma, { projectId: kan.id, codePrefix: kan.codePrefix, role: p.residentRole });
  for (const c of [civ, elec, mep]) {
    await createJoinCode(prisma, {
      projectId: kan.id,
      codePrefix: kan.codePrefix,
      role: p.contractorEngineerRole,
      contractor: { id: c.id, tradeCode: c.tradeCode },
      includeTradeCode: true,
    });
  }
  await prisma.userProjectAssignment.createMany({
    data: [
      { userId: p.monitorUserId, projectId: kan.id },
      { userId: p.contractorUserId, projectId: kan.id },
      { userId: electricalUser.id, projectId: kan.id },
    ],
  });
  await recordAuditEvent(prisma, {
    projectId: kan.id,
    actorType: "WEB_USER",
    actorId: p.monitorUserId,
    actorDisplayName: "Seed",
    action: "PROJECT_ACTIVATED",
    summaryText: "Set Kano General Hospital Annex (KAN-210) active with three prime contractors.",
    payload: { codePrefix: "KAN-210", contractorExecutionMode: "MULTI_PRIME_SEPARATE_IPC", contractorCount: 3 },
  });

  // ------------------------------------------------------------------------
  // OGN-305: perimeter geofence, single contractor, 50 m tolerance override
  // ------------------------------------------------------------------------
  const ognGeofence: PerimeterGeofence = {
    mode: "PERIMETER",
    siteLabel: "Ogun Agro-Processing Estate, Phase 1 plot",
    perimeterCoordinates: [
      [3.395, 6.945],
      [3.405, 6.945],
      [3.408, 6.952],
      [3.4, 6.957],
      [3.393, 6.951],
      [3.395, 6.945],
    ],
  };
  const ogn = await prisma.project.create({
    data: {
      tenantId: p.tenantId,
      status: "ACTIVE",
      activatedAt: daysAgo(10),
      createdByUserId: p.monitorUserId,
      activatedByUserId: p.monitorUserId,
      name: "Ogun Agro-Processing Estate — Phase 1 Infrastructure",
      codePrefix: "OGN-305",
      stateLocation: "Ogun State",
      lgaLocation: "Obafemi Owode",
      description: "Estate roads, drainage, water reticulation and a processing shed inside an irregular plot boundary.",
      totalBudgetNgn: 1850000000,
      reportingCadence: "WEEKLY",
      timezone: "Africa/Lagos",
      geofenceMode: "PERIMETER",
      geofenceGeoJson: ognGeofence as unknown as Prisma.InputJsonValue,
      geofenceToleranceMeters: 50,
      monitorOrganizationId: p.monitorOrgId,
      lenderOrganizationId: p.lenderOrgId,
      contractorExecutionMode: "SINGLE_CONTRACTOR",
      setupState: stepState(["basics", "parties", "site", "facility", "boq", "reporting", "team"], p.monitorUserId),
    },
  });
  const ognContractor = await prisma.projectContractor.create({
    data: {
      projectId: ogn.id,
      organizationId: aquaflow.id,
      tradeCategory: "Civil and water works",
      tradeCode: "GEN",
      isMainContractor: true,
    },
  });
  for (const [wbs, desc, unit, qty, rate] of [
    ["01.01", "Estate road sub-base and 40mm asphalt surfacing", "m2", 24_000, 38_000],
    ["01.02", "Precast concrete U-drains along estate roads", "m", 3_200, 95_000],
    ["02.01", "HDPE water reticulation mains and service connections", "m", 5_500, 41_000],
  ] as const) {
    await prisma.boqItem.create({
      data: {
        projectId: ogn.id,
        projectContractorId: ognContractor.id,
        wbsCode: wbs,
        section: "BILL 1 — ESTATE INFRASTRUCTURE",
        description: desc,
        unit,
        totalQuantity: qty,
        rateNgn: rate,
        budgetedCostNgn: qty * rate,
      },
    });
  }
  await createJoinCode(prisma, { projectId: ogn.id, codePrefix: ogn.codePrefix, role: p.residentRole });
  await createJoinCode(prisma, {
    projectId: ogn.id,
    codePrefix: ogn.codePrefix,
    role: p.contractorEngineerRole,
    contractor: { id: ognContractor.id, tradeCode: ognContractor.tradeCode },
    includeTradeCode: false,
  });
  await prisma.userProjectAssignment.createMany({
    data: [{ userId: p.monitorUserId, projectId: ogn.id }],
  });

  // ------------------------------------------------------------------------
  // ENU-501: a draft with basics, parties and site saved
  // ------------------------------------------------------------------------
  const enuGeofence: RadialGeofence = {
    mode: "RADIAL",
    siteLabel: "Coal Camp water works",
    center: { latitude: 6.4302, longitude: 7.4889 },
    radiusMeters: 400,
  };
  const enu = await prisma.project.create({
    data: {
      tenantId: p.tenantId,
      status: "DRAFT",
      createdByUserId: p.monitorUserId,
      name: "Enugu Coal Camp Water Scheme Rehabilitation",
      codePrefix: "ENU-501",
      stateLocation: "Enugu State",
      lgaLocation: "Enugu North",
      totalBudgetNgn: 950000000,
      timezone: "Africa/Lagos",
      geofenceMode: "RADIAL",
      geofenceGeoJson: enuGeofence as unknown as Prisma.InputJsonValue,
      monitorOrganizationId: p.monitorOrgId,
      lenderOrganizationId: p.lenderOrgId,
      contractorExecutionMode: "SINGLE_CONTRACTOR",
      setupState: stepState(["basics", "parties", "site"], p.monitorUserId),
      contractors: {
        create: {
          organizationId: aquaflow.id,
          tradeCategory: "Water works",
          tradeCode: "WTR",
          isMainContractor: true,
        },
      },
    },
  });
  await prisma.userProjectAssignment.create({ data: { userId: p.monitorUserId, projectId: enu.id } });
  await recordAuditEvent(prisma, {
    projectId: enu.id,
    actorType: "WEB_USER",
    actorId: p.monitorUserId,
    actorDisplayName: "Seed",
    action: "PROJECT_DRAFT_CREATED",
    summaryText: 'Started draft project "Enugu Coal Camp Water Scheme Rehabilitation" (ENU-501).',
    payload: { codePrefix: "ENU-501" },
  });
}
