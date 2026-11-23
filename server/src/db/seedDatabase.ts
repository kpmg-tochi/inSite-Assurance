import crypto from "crypto";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import {
  DEFAULT_GEOFENCE_TOLERANCE_METERS,
  DEFAULT_TENANT_ROLES,
  LinearCorridorGeofence,
  RadialGeofence,
  SYSTEM_PERMISSIONS_CATALOG,
  verifyPointAgainstGeofence,
  calendarDateInTimeZone,
} from "@insite/shared";
import { prisma } from "../config/prisma";
import { recordAuditEvent } from "../modules/audit/audit.service";
import { provisionDefaultRoles } from "../modules/rbac/rbac.service";
import { randomJoinCodeSegment } from "../modules/projects/joinCodes.service";
import { evaluateGeofence } from "../utils/geofenceEvaluation";
import { seedPhase6Projects } from "./seedPhase6";
import { seedPhase7 } from "./seedPhase7";
import { seedPhase9 } from "./seedPhase9";
import { seedPhase10 } from "./seedPhase10";
import { seedPhase11 } from "./seedPhase11";
import { seedPhase12 } from "./seedPhase12";
import { seedPhase14 } from "./seedPhase14";
import { seedPhase13 } from "./seedPhase13";
import { projectObjectPrefix } from "../integrations/storage.service";
import { CADENCE_PROJECT_SELECT, cadenceSettingsOf, periodKeyForDate } from "../modules/cadence/cadence.service";

/** Phase 8: the reporting period fields of a seeded report on a work day. */
async function seedPeriodFields(projectId: string, workdayDate: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: CADENCE_PROJECT_SELECT });
  const key = periodKeyForDate(cadenceSettingsOf(project), workdayDate);
  return { reportingPeriodStart: key.periodStart, reportingPeriodEnd: key.periodEnd, dueAt: key.dueAt };
}

let activeSeedPromise: Promise<void> | null = null;

export async function seedDatabase(): Promise<void> {
  if (activeSeedPromise) {
    return activeSeedPromise;
  }

  activeSeedPromise = runSeed().finally(() => {
    activeSeedPromise = null;
  });

  return activeSeedPromise;
}

// ---------------------------------------------------------------------------
// Phase 4 seed helper: evidence is a confirmed workday report plus its captures.
// Seeded captures have no stored object and no device signature; they carry the SEED_FIXTURE
// flag so the UI shows them as unverified fixtures, never as verified evidence.
// ---------------------------------------------------------------------------

const SEED_TIMEZONE = "Africa/Lagos";

type SeedCapture = {
  mediaType: "SITE_PHOTO" | "VOICE_NOTE" | "MILL_CERTIFICATE";
  caption?: string;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters?: number;
  capturedAt: Date;
  transcript?: string;
};

type SeedSession = {
  id: string;
  roleId: string;
  roleNameSnapshot: string;
  fieldPersonaType: Prisma.FieldAgentSessionGetPayload<object>["fieldPersonaType"];
  assuranceWeight: number;
};

async function seedCaptures(params: {
  tenantId: string;
  projectId: string;
  session: SeedSession;
  boqItemId: string;
  workdayReportId: string;
  geofence: unknown;
  captures: SeedCapture[];
}) {
  for (const c of params.captures) {
    const located = c.latitude !== null && c.longitude !== null;
    const geo = evaluateGeofence(
      params.geofence,
      located ? { latitude: c.latitude as number, longitude: c.longitude as number } : null,
      DEFAULT_GEOFENCE_TOLERANCE_METERS,
    );
    const ext = c.mediaType === "VOICE_NOTE" ? "m4a" : "jpg";
    const sha = crypto.randomBytes(32).toString("hex");
    await prisma.fieldEvidenceLog.create({
      data: {
        projectId: params.projectId,
        boqItemId: params.boqItemId,
        fieldSessionId: params.session.id,
        clientCaptureId: crypto.randomUUID(),
        workdayReportId: params.workdayReportId,
        reporterRoleId: params.session.roleId,
        reporterRoleName: params.session.roleNameSnapshot,
        fieldPersonaType: params.session.fieldPersonaType,
        assuranceWeight: params.session.assuranceWeight,
        status: "REGISTERED",
        caption: c.caption ?? null,
        locationAvailable: located,
        latitude: c.latitude,
        longitude: c.longitude,
        gpsAccuracyMeters: located ? c.accuracyMeters ?? 5 : null,
        isMockLocation: false,
        isWithinGeofence: geo.isWithinGeofence,
        geofenceStatus: geo.geofenceStatus,
        distanceOutsideMeters: geo.distanceOutsideMeters,
        chainageKm: geo.chainageKm,
        chainageLabel: geo.chainageLabel,
        corridorOffsetMeters: geo.corridorOffsetMeters,
        distanceFromSiteMeters: geo.distanceFromSiteMeters,
        signatureVerified: null,
        serverSha256: sha,
        clientSha256: sha,
        integrityPassed: true,
        integrityFlags: ["SEED_FIXTURE"] as unknown as Prisma.InputJsonValue,
        transcriptionStatus: c.mediaType === "VOICE_NOTE" ? (c.transcript ? "DONE" : "PENDING") : "NOT_APPLICABLE",
        transcript: c.transcript ?? null,
        transcriptionEngine: c.transcript ? "SEED_FIXTURE" : null,
        capturedAtDevice: c.capturedAt,
        mediaAttachments: {
          create: {
            tenantId: params.tenantId,
            projectId: params.projectId,
            mediaType: c.mediaType,
            objectKey: `${projectObjectPrefix(params.tenantId, params.projectId)}seed/${crypto.randomUUID()}.${ext}`,
            mimeType: c.mediaType === "VOICE_NOTE" ? "audio/mp4" : "image/jpeg",
            byteSize: 1,
            sha256FileHash: sha,
            perceptualHash: null,
            durationSeconds: c.mediaType === "VOICE_NOTE" ? 24 : null,
          },
        },
      },
    });
  }
}

async function seedReportWithCaptures(params: {
  tenantId: string;
  projectId: string;
  session: SeedSession;
  boqItem: { id: string; unit: string };
  geofence: unknown;
  summaryText: string;
  reportedQuantity: number;
  unitOfMeasure?: string;
  isHoldPointClaimed?: boolean;
  delaysOrBlockers?: string;
  confirmedAt: Date;
  captures: SeedCapture[];
}) {
  const anchor = params.captures.find((c) => c.latitude !== null && c.longitude !== null);
  const geo = anchor
    ? evaluateGeofence(
        params.geofence,
        { latitude: anchor.latitude as number, longitude: anchor.longitude as number },
        DEFAULT_GEOFENCE_TOLERANCE_METERS,
      )
    : null;
  const report = await prisma.workdayReport.create({
    data: {
      ...(await seedPeriodFields(params.projectId, calendarDateInTimeZone(params.confirmedAt, SEED_TIMEZONE))),
      clientReportId: crypto.randomUUID(),
      projectId: params.projectId,
      reporterSessionId: params.session.id,
      wbsItemId: params.boqItem.id,
      workdayDate: calendarDateInTimeZone(params.confirmedAt, SEED_TIMEZONE),
      reporterTimezone: SEED_TIMEZONE,
      status: "CONFIRMED",
      revisionNumber: 1,
      summaryText: params.summaryText,
      reportedQuantity: params.reportedQuantity,
      unitOfMeasure: params.unitOfMeasure ?? params.boqItem.unit,
      isHoldPointClaimed: params.isHoldPointClaimed ?? false,
      delaysOrBlockers: params.delaysOrBlockers ?? null,
      submissionGeotag: anchor && geo
        ? ({
            latitude: anchor.latitude,
            longitude: anchor.longitude,
            accuracyMeters: anchor.accuracyMeters ?? 5,
            altitudeMeters: null,
            isMocked: false,
            capturedAt: params.confirmedAt.toISOString(),
            isWithinGeofence: geo.isWithinGeofence,
            geofenceStatus: geo.geofenceStatus,
            distanceOutsideMeters: geo.distanceOutsideMeters,
            chainageLabel: geo.chainageLabel,
            distanceFromSiteMeters: geo.distanceFromSiteMeters,
          } as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
      geofenceStatus: geo?.geofenceStatus ?? null,
      signatureVerified: null,
      aiCheckStatus: "SKIPPED",
      aiReasoning: "Seed fixture; no omission check ran.",
      humanConfirmedAt: params.confirmedAt,
      createdAt: params.confirmedAt,
    },
  });
  await seedCaptures({
    tenantId: params.tenantId,
    projectId: params.projectId,
    session: params.session,
    boqItemId: params.boqItem.id,
    workdayReportId: report.id,
    geofence: params.geofence,
    captures: params.captures,
  });
  return report;
}

const hoursAgo = (h: number) => new Date(Date.now() - 1000 * 60 * 60 * h);

async function runSeed(): Promise<void> {
  console.log("🌱 Starting InSite Assurance database seed...");

  // Clean existing records in reverse dependency order
  await prisma.pushToken.deleteMany();
  // Phase 13 (documents before their types; CP evidence and kick-off links are SetNull).
  await prisma.programmeOfWorksSubmission.deleteMany();
  await prisma.contractorDefaultCase.deleteMany();
  await prisma.kickoffMeeting.deleteMany();
  await prisma.projectDocument.deleteMany();
  await prisma.projectContractMilestone.deleteMany();
  await prisma.documentType.deleteMany();
  // Phase 14
  await prisma.inspectionFinding.deleteMany();
  await prisma.siteInspectionReport.deleteMany();
  await prisma.projectReportingStream.deleteMany();
  await prisma.inspectionChecklistTemplate.deleteMany();
  await prisma.incidentReport.deleteMany();
  await prisma.webNotificationRead.deleteMany();
  await prisma.webNotification.deleteMany();
  await prisma.wbsChatMessage.deleteMany();
  await prisma.reportQuery.deleteMany();
  await prisma.workdayReport.deleteMany();
  await prisma.siteTelemetryPing.deleteMany();
  await prisma.morningDeliverableBrief.deleteMany();
  await prisma.mobileNotification.deleteMany();
  await prisma.approvalAction.deleteMany();
  await prisma.approvalStep.deleteMany();
  // Phase 10 (release requests restrict deleting valuations; tickets restrict deleting contractors).
  await prisma.retentionReleaseRequest.deleteMany();
  await prisma.retentionDefectTicket.deleteMany();
  await prisma.handoverSubmission.deleteMany();
  await prisma.handoverLink.deleteMany();
  await prisma.trancheDecision.deleteMany();
  await prisma.valuationReport.deleteMany();
  await prisma.milestoneVerification.deleteMany();
  await prisma.projectStandardSpecification.deleteMany();
  await prisma.projectNeedsAssessmentDocument.deleteMany();
  await prisma.projectProcessConfig.deleteMany();
  // Phase 11: types reference templates and are referenced by projects; regions and organisations
  // reference themselves. Clear the pointers first.
  await prisma.projectBeneficiary.deleteMany();
  await prisma.project.updateMany({ data: { projectTypeId: null, regionId: null, owningOrganizationId: null } });
  await prisma.projectType.deleteMany();
  await prisma.region.updateMany({ data: { parentRegionId: null } });
  await prisma.region.deleteMany();
  await prisma.workflowTemplate.deleteMany();
  await prisma.monitorQuery.deleteMany();
  await prisma.ipcSupportingDocument.deleteMany();
  await prisma.ipcLineItem.deleteMany();
  await prisma.ipcClaim.deleteMany();
  await prisma.evidenceMedia.deleteMany();
  await prisma.fieldEvidenceLog.deleteMany();
  await prisma.boqItem.deleteMany();
  await prisma.boqRevision.deleteMany();
  await prisma.conditionPrecedent.deleteMany();
  await prisma.facilityTranche.deleteMany();
  await prisma.fieldAgentSession.deleteMany();
  await prisma.mobileDevice.deleteMany();
  await prisma.projectJoinCode.deleteMany();
  await prisma.projectContractor.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.userProjectAssignment.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.updateMany({ data: { parentOrganizationId: null } });
  await prisma.organization.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.role.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.professionalRegistrationBody.deleteMany(); // Phase 12
  await prisma.tenant.deleteMany();

  const defaultPasswordHash = await bcrypt.hash("Password123!", 10);

  // 0. Seed Canonical System Permissions Catalog
  const permissionByKey = new Map<string, string>();
  for (const p of SYSTEM_PERMISSIONS_CATALOG) {
    const createdPerm = await prisma.permission.create({
      data: {
        key: p.key,
        name: p.name,
        description: p.description,
        category: p.category,
        surface: p.surface,
      },
    });
    permissionByKey.set(p.key, createdPerm.id);
  }

  // 0b. Create Default Multi-Tenant Workspace
  const defaultTenant = await prisma.tenant.create({
    data: {
      name: "KPMG Nigeria Infrastructure & Capital Advisory",
      slug: "kpmg-nigeria",
      status: "ACTIVE",
      defaultCurrency: "NGN",
      timezone: "Africa/Lagos",
      brandingConfig: {
        logoUrl: "/KPMG-logo.svg",
        primaryColorHex: "#00338D",
        navyColorHex: "#0C233C",
        tagline: "Capital Advisory",
        pdfHeaderTitle: "InSite Assurance — Disbursement Evidence & Valuation Report",
        pdfFooterDisclaimer:
          "Independent Project Monitoring Certification | Powered by InSite Assurance",
      } as unknown as Prisma.InputJsonValue,
    },
  });

  // Default roles come from the single shared definition (DEFAULT_TENANT_ROLES).
  const rolesByCode = await provisionDefaultRoles(prisma, defaultTenant.id);
  const roleByCode = (code: string) => {
    const role = rolesByCode.get(code);
    if (!role) throw new Error(`Default role ${code} missing from DEFAULT_TENANT_ROLES`);
    return role;
  };
  const superAdminRole = roleByCode("TENANT_SUPER_ADMIN");
  const monitorRole = roleByCode("MONITOR");
  const lenderRole = roleByCode("LENDER");
  const contractorRole = roleByCode("CONTRACTOR");
  // Phase 5: monitor inspectors sign in with their account instead of a join code (decision G).
  const monitorInspectorMobileRole = await prisma.role.update({
    where: { id: roleByCode("MONITOR_INSPECTOR").id },
    data: { onboardingMode: "PROVISIONED_ACCOUNT", requiresIdentityAssurance: false },
  });
  const residentCowMobileRole = roleByCode("INDEPENDENT_RESIDENT");
  const contractorEngineerMobileRole = roleByCode("CONTRACTOR_ENGINEER");

  // 1. Create Organizations
  const monitorOrg = await prisma.organization.create({
    data: {
      tenantId: defaultTenant.id,
      name: "KPMG Infrastructure & Project Monitoring Advisory",
      categories: ["ADVISORY_MONITOR"],
      registrationNumber: "RC-114592",
      contactEmail: "monitoring@insite.ng",
    },
  });

  const lenderOrg = await prisma.organization.create({
    data: {
      tenantId: defaultTenant.id,
      name: "InfraCredit Guarantee & Project Finance Desk",
      categories: ["FINANCIER_LENDER"],
    },
  });

  const contractorOrg = await prisma.organization.create({
    data: {
      tenantId: defaultTenant.id,
      name: "Julius & Sons Civil Engineering Nigeria Ltd",
      categories: ["CONTRACTOR"],
      registrationNumber: "RC-338210",
    },
  });

  // 2. Create Demo Web Users (All passwords: Password123!)
  await prisma.user.create({
    data: {
      tenantId: defaultTenant.id,
      email: "admin@insite.ng",
      passwordHash: defaultPasswordHash,
      fullName: "Adaeze Nwosu, FCA",
      isPlatformSuperAdmin: true,
      roleId: superAdminRole.id,
      organizationId: monitorOrg.id,
      professionalRegistrationBodyCode: "ICAN",
      professionalRegistrationNumber: "FCA/019284",
    },
  });

  const monitorUser = await prisma.user.create({
    data: {
      tenantId: defaultTenant.id,
      email: "monitor@insite.ng",
      passwordHash: defaultPasswordHash,
      fullName: "QS Tunde Adebayo, FNIQS",
      roleId: monitorRole.id,
      // Web: Independent Monitor. Field: Monitor Inspector, signed in on the mobile app.
      mobileRoleId: monitorInspectorMobileRole.id,
      phoneNumber: "+234 803 555 0142",
      organizationId: monitorOrg.id,
      professionalRegistrationBodyCode: "QSRBN",
      professionalRegistrationNumber: "3842",
    },
  });

  // Second lender-side user (D-3.1 demo). A custom role holding both certify and approve, so the
  // demo can show that whoever certifies a valuation cannot record the decision on it.
  const dualPermissionKeys = [
    ...new Set([
      ...DEFAULT_TENANT_ROLES.find((r) => r.code === "LENDER")!.permissionKeys,
      "ipc:certify_valuation",
      "reports:raise_query",
    ]),
  ];
  const dualPermissions = await prisma.permission.findMany({
    where: { key: { in: dualPermissionKeys } },
    select: { id: true },
  });
  const lenderTechnicalRole = await prisma.role.create({
    data: {
      tenantId: defaultTenant.id,
      name: "Lender Technical Officer",
      code: "LENDER_TECHNICAL_OFFICER",
      description:
        "Lender-side engineer who may certify valuations and approve releases, but never both on the same IPC.",
      surface: "WEB",
      fieldPersonaType: "NONE",
      assuranceWeight: 1.0,
      isSystemDefault: false,
      rolePermissions: {
        create: dualPermissions.map((perm) => ({ permissionId: perm.id })),
      },
    },
  });

  await prisma.user.create({
    data: {
      tenantId: defaultTenant.id,
      email: "lto@insite.ng",
      passwordHash: defaultPasswordHash,
      fullName: "Engr. Ifeoma Eze, FNSE",
      roleId: lenderTechnicalRole.id,
      organizationId: lenderOrg.id,
      professionalRegistrationBodyCode: "COREN",
      professionalRegistrationNumber: "R.33017",
    },
  });

  await prisma.user.create({
    data: {
      tenantId: defaultTenant.id,
      email: "lender@insite.ng",
      passwordHash: defaultPasswordHash,
      fullName: "Chidinma Okafor, CFA",
      roleId: lenderRole.id,
      organizationId: lenderOrg.id,
      professionalRegistrationBodyCode: "ICAN",
      professionalRegistrationNumber: "MB/049120",
    },
  });

  const contractorUser = await prisma.user.create({
    data: {
      tenantId: defaultTenant.id,
      email: "contractor@insite.ng",
      passwordHash: defaultPasswordHash,
      fullName: "Engr. Musa Danladi, MNSE",
      roleId: contractorRole.id,
      organizationId: contractorOrg.id,
      professionalRegistrationBodyCode: "COREN",
      professionalRegistrationNumber: "R.49201",
    },
  });

  // ==========================================================================
  // PROJECT 1: LKK-402 (Linear Corridor Mode — Road & Culvert Infrastructure)
  // ==========================================================================
  const lkkCorridorGeofence: LinearCorridorGeofence = {
    mode: "LINEAR_CORRIDOR",
    corridorLabel:
      "Lekki–Epe Industrial Access Corridor (KM 12+000 to KM 18+500)",
    centerlineCoordinates: [
      [3.55, 6.45],
      [3.575, 6.451],
      [3.6, 6.4525],
      [3.61, 6.453],
    ],
    corridorHalfWidthMeters: 100,
    startChainageKm: 12.0,
  };

  const lkkProject = await prisma.project.create({
    data: {
      tenantId: defaultTenant.id,
      name: "Lekki–Epe Industrial Access Dual-Carriageway & Drainage Upgrade",
      codePrefix: "LKK-402",
      stateLocation: "Lagos State",
      lgaLocation: "Ibeju-Lekki / Epe LGA",
      description:
        "6.5km industrial access dual-carriageway including reinforced concrete box culverts, storm drainage channels, crushed stone base, and 50mm asphaltic wearing course.",
      totalBudgetNgn: 6850000000,
      disbursedToDateNgn: 1712500000,
      certifiedProgressPct: 28.5,
      reportingCadence: "DAILY",
      geofenceMode: "LINEAR_CORRIDOR",
      geofenceGeoJson: lkkCorridorGeofence as unknown as Prisma.InputJsonValue,
      portfolioHealth: "EVIDENCE_CONFLICT",
      monitorOrganizationId: monitorOrg.id,
      lenderOrganizationId: lenderOrg.id,
      // Phase 6: live, single contractor.
      status: "ACTIVE",
      activatedAt: new Date(Date.now() - 60 * 24 * 3600 * 1000),
      createdByUserId: monitorUser.id,
      activatedByUserId: monitorUser.id,
      contractorExecutionMode: "SINGLE_CONTRACTOR",
      contractors: {
        create: {
          organizationId: contractorOrg.id,
          tradeCategory: "Civil works",
          tradeCode: "CIV",
          isMainContractor: true,
          allowFieldReporting: true,
        },
      },
    },
    include: { contractors: true },
  });
  const lkkContractorId = lkkProject.contractors[0].id;

  const lkkJoinCow = await prisma.projectJoinCode.create({
    data: {
      projectId: lkkProject.id,
      roleId: residentCowMobileRole.id,
      code: `LKK-402-COW-${randomJoinCodeSegment()}`,
    },
  });

  const lkkJoinCon = await prisma.projectJoinCode.create({
    data: {
      projectId: lkkProject.id,
      roleId: contractorEngineerMobileRole.id,
      projectContractorId: lkkContractorId,
      code: `LKK-402-CON-${randomJoinCodeSegment()}`,
    },
  });

  // Tranches for LKK-402
  const lkkTranche1 = await prisma.facilityTranche.create({
    data: {
      projectId: lkkProject.id,
      trancheNumber: 1,
      name: "Tranche 1 — Mobilization, Site Clearance & Earthworks",
      allocatedAmountNgn: 1712500000,
      releasedAmountNgn: 1712500000,
      targetCompletionPct: 25,
      isReleased: true,
      conditionsPrecedent: {
        create: [
          {
            referenceCode: "CP-01",
            description:
              "Executed Advance Payment Guarantee (APG) from Tier-1 Commercial Bank",
            isMandatoryForRelease: true,
            status: "SATISFIED",
          },
          {
            referenceCode: "CP-02",
            description:
              "Lagos State Ministry of Environment EIA Approval Certificate",
            isMandatoryForRelease: true,
            status: "SATISFIED",
          },
        ],
      },
    },
  });

  const lkkTranche2 = await prisma.facilityTranche.create({
    data: {
      projectId: lkkProject.id,
      trancheNumber: 2,
      name: "Tranche 2 — Reinforced Box Culverts, Line Drains & Stone Base",
      allocatedAmountNgn: 2740000000,
      releasedAmountNgn: 0,
      targetCompletionPct: 65,
      isReleased: false,
      conditionsPrecedent: {
        create: [
          {
            referenceCode: "CP-03",
            description:
              "Independent Monitor (QSRBN/COREN) Certification of Tranche 1 Utilisation",
            isMandatoryForRelease: true,
            status: "SATISFIED",
          },
          {
            referenceCode: "CP-04",
            description:
              "28-Day Concrete Cube Crushing Test Certificates for Culverts KM 12–KM 15 (>= 25 N/mm2)",
            isMandatoryForRelease: true,
            status: "PENDING",
          },
        ],
      },
    },
  });

  await prisma.facilityTranche.create({
    data: {
      projectId: lkkProject.id,
      trancheNumber: 3,
      name: "Tranche 3 — Asphaltic Binder, Wearing Course & Street Lighting",
      allocatedAmountNgn: 2397500000,
      releasedAmountNgn: 0,
      targetCompletionPct: 100,
      isReleased: false,
    },
  });

  // BOQ Items for LKK-402
  const boqEarthworks = await prisma.boqItem.create({
    data: {
      projectId: lkkProject.id,
      trancheId: lkkTranche1.id,
      aiSuggestedTrancheId: lkkTranche1.id,
      trancheMappingConfirmedByMonitor: true,
      wbsCode: "01.02.1",
      section: "BILL NO. 1 — SITE CLEARANCE & EARTHWORKS",
      description:
        "Excavate unsuitable topsoil and fill with approved laterite sub-grade compacted to 98% BS MDD",
      unit: "m3",
      totalQuantity: 45000,
      rateNgn: 18500,
      budgetedCostNgn: 832500000,
      isHoldPoint: false,
      cumulativeCertifiedPct: 90,
    },
  });

  const boqCulvertReinforcement = await prisma.boqItem.create({
    data: {
      projectId: lkkProject.id,
      trancheId: lkkTranche2.id,
      aiSuggestedTrancheId: lkkTranche2.id,
      trancheMappingConfirmedByMonitor: true,
      wbsCode: "02.01.1",
      section: "BILL NO. 2 — DRAINAGE & BOX CULVERTS",
      description:
        "Supply, cut, bend and fix Y16 & Y20 High Yield Steel Reinforcement for 2-Cell 1800x1800mm Box Culverts (KM 14+200)",
      unit: "tons",
      totalQuantity: 320,
      rateNgn: 1450000,
      budgetedCostNgn: 464000000,
      isHoldPoint: true,
      holdPointInstruction:
        "MANDATORY HOLD POINT: Must capture geotagged photo of tied reinforcement & spacers plus Mill Certificate BEFORE concrete pour.",
      cumulativeCertifiedPct: 45,
    },
  });

  const boqCulvertConcrete = await prisma.boqItem.create({
    data: {
      projectId: lkkProject.id,
      trancheId: lkkTranche2.id,
      aiSuggestedTrancheId: lkkTranche2.id,
      trancheMappingConfirmedByMonitor: true,
      wbsCode: "02.01.2",
      section: "BILL NO. 2 — DRAINAGE & BOX CULVERTS",
      description:
        "Provide and place Grade C30 ready-mix structural concrete in Box Culvert base, walls, and deck slab (KM 12+500 to KM 16+000)",
      unit: "m3",
      totalQuantity: 4200,
      rateNgn: 195000,
      budgetedCostNgn: 819000000,
      isHoldPoint: true,
      holdPointInstruction:
        "Requires slump test photo at pour and 28-day cube crushing certificate.",
      cumulativeCertifiedPct: 35,
    },
  });

  const boqStoneBase = await prisma.boqItem.create({
    data: {
      projectId: lkkProject.id,
      trancheId: lkkTranche2.id,
      aiSuggestedTrancheId: lkkTranche2.id,
      trancheMappingConfirmedByMonitor: true,
      wbsCode: "03.01.1",
      section: "BILL NO. 3 — PAVEMENT & STONE BASE",
      description:
        "Provide, lay and compact 200mm thick crushed granite wet-mix macadam stone base course",
      unit: "m2",
      totalQuantity: 95000,
      rateNgn: 14800,
      budgetedCostNgn: 1406000000,
      isHoldPoint: false,
      cumulativeCertifiedPct: 10,
    },
  });

  const boqOpaqueLumpSum = await prisma.boqItem.create({
    data: {
      projectId: lkkProject.id,
      trancheId: lkkTranche2.id,
      aiSuggestedTrancheId: lkkTranche2.id,
      trancheMappingConfirmedByMonitor: false,
      wbsCode: "04.09.1",
      section: "BILL NO. 4 — AUXILIARY & UTILITY RELOCATION WORKS",
      description:
        "Provisional Lump Sum for Relocation of Existing Underground Services, Community Liaison & Associated Civil Works",
      unit: "LS",
      totalQuantity: 1,
      rateNgn: 680000000,
      budgetedCostNgn: 680000000,
      isHoldPoint: false,
      isOpaqueLumpSum: true,
      opacityWarningReason:
        'Unbundled Lump Sum ("LS") item exceeding ₦680M (9.9% of total budget) lacks measurable unit quantities or schedule of rates breakdown [QSRBN IPCM Guideline].',
      cumulativeCertifiedPct: 0,
    },
  });

  // Field Agent Sessions on LKK-402
  const cowSession = await prisma.fieldAgentSession.create({
    data: {
      projectId: lkkProject.id,
      joinCodeId: lkkJoinCow.id,
      roleId: residentCowMobileRole.id,
      roleNameSnapshot: residentCowMobileRole.name,
      fieldPersonaType: residentCowMobileRole.fieldPersonaType,
      assuranceWeight: residentCowMobileRole.assuranceWeight,
      agentFullName: "Engr. Segun Oladipo (Resident CoW)",
      agentPhoneNumber: "+2348034129801",
      deviceId: "ANDROID-COW-88412",
      deviceModel: "Samsung Galaxy A54 5G",
      deviceOs: "Android 14",
      lastSyncAt: new Date(),
    },
  });

  const conSession = await prisma.fieldAgentSession.create({
    data: {
      projectId: lkkProject.id,
      joinCodeId: lkkJoinCon.id,
      projectContractorId: lkkContractorId,
      roleId: contractorEngineerMobileRole.id,
      roleNameSnapshot: contractorEngineerMobileRole.name,
      fieldPersonaType: contractorEngineerMobileRole.fieldPersonaType,
      assuranceWeight: contractorEngineerMobileRole.assuranceWeight,
      agentFullName: "Chukwudi Nnamdi (Contractor Site Engr)",
      agentPhoneNumber: "+2348091124500",
      deviceId: "ANDROID-CON-33109",
      deviceModel: "Redmi Note 13 Pro",
      deviceOs: "Android 14",
      assuranceStatus: "APPROVED",
      idDocumentType: "NIN_SLIP",
      idDocumentUrl: "https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=600&q=80",
      selfieImageUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=600&q=80",
      livenessScore: null,
      livenessPassed: false,
      registrationNumber: "R.55102",
      registrationBodyCode: "COREN",
      experienceSummary: "8 years highway and drainage structural works. Resident Site Engineer for Julius & Sons.",
      reviewedByUserId: monitorUser.id,
      reviewedAt: new Date(Date.now() - 14 * 24 * 3600 * 1000),
      lastSyncAt: new Date(),
    },
  });

  await prisma.fieldAgentSession.create({
    data: {
      projectId: lkkProject.id,
      joinCodeId: lkkJoinCon.id,
      projectContractorId: lkkContractorId,
      roleId: contractorEngineerMobileRole.id,
      roleNameSnapshot: contractorEngineerMobileRole.name,
      fieldPersonaType: contractorEngineerMobileRole.fieldPersonaType,
      assuranceWeight: contractorEngineerMobileRole.assuranceWeight,
      agentFullName: "Engr. Babatunde Fashanu",
      agentPhoneNumber: "+2348023456789",
      deviceId: "TECNO-CAMON-20-PRO",
      deviceModel: "Tecno Camon 20 Pro 5G",
      deviceOs: "Android 13",
      assuranceStatus: "PENDING_APPROVAL",
      idDocumentType: "FRSC_DRIVERS_LICENSE",
      idDocumentUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=600&q=80",
      selfieImageUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=600&q=80",
      livenessScore: null,
      livenessPassed: false,
      registrationNumber: "R.61044",
      registrationBodyCode: "COREN",
      experienceSummary: "10 years reinforced concrete box culverts, soil stabilization, and quality control on highway corridors. Project Site Engineer, Julius & Sons Civil Engineering.",
      lastSyncAt: new Date(),
    },
  });

  // Verify real corridor chainages using @insite/shared Turf.js engine
  const cowGeoCheck = verifyPointAgainstGeofence(
    { longitude: 3.57, latitude: 6.4502 },
    lkkCorridorGeofence,
  );

  const cowEvidenceReport = await seedReportWithCaptures({
    tenantId: lkkProject.tenantId,
    projectId: lkkProject.id,
    session: cowSession,
    boqItem: boqCulvertConcrete,
    geofence: lkkCorridorGeofence,
    summaryText:
      "Cast box culvert wall on Cell 1 at KM 14+210. Heavy rain halted pouring on Cell 2.",
    reportedQuantity: 12,
    delaysOrBlockers: "Heavy rainfall halted concrete pour on Cell 2 at KM 14+210",
    confirmedAt: hoursAgo(17),
    captures: [
      {
        mediaType: "SITE_PHOTO",
        caption: "Cell 1 wall pour, timber shuttering in place",
        latitude: 6.4502,
        longitude: 3.57,
        accuracyMeters: 4.2,
        capturedAt: hoursAgo(18),
      },
      {
        mediaType: "VOICE_NOTE",
        latitude: 6.4502,
        longitude: 3.57,
        accuracyMeters: 4.2,
        capturedAt: hoursAgo(18),
        transcript:
          "We dey for chainage fourteen plus two hundred this afternoon. Contractor don cast the box culvert wall. Rain delay the second cell.",
      },
    ],
  });

  const conEvidenceReport = await seedReportWithCaptures({
    tenantId: lkkProject.tenantId,
    projectId: lkkProject.id,
    session: conSession,
    boqItem: boqStoneBase,
    geofence: lkkCorridorGeofence,
    summaryText:
      "Contractor self-report: spread and compacted crushed stone base course between KM 15+800 and KM 16+400.",
    reportedQuantity: 18500,
    confirmedAt: hoursAgo(9),
    captures: [
      {
        mediaType: "SITE_PHOTO",
        caption: "Compacted stone base, KM 16+000",
        latitude: 6.4518,
        longitude: 3.588,
        accuracyMeters: 6.8,
        capturedAt: hoursAgo(10),
      },
    ],
  });

  // Active IPC Claim #2 on LKK-402 showing all 4 Evidence Strength Ratings
  const lkkIpc2 = await prisma.ipcClaim.create({
    data: {
      projectId: lkkProject.id,
      trancheId: lkkTranche2.id,
      projectContractorId: lkkContractorId,
      ipcNumber: 2,
      periodStart: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30),
      periodEnd: new Date(),
      contractorCoverNote:
        "Interim Payment Certificate #2 covering completed earthworks balance, box culvert reinforcement and concrete works up to KM 16+000, stone base course, and utility relocation.",
      // Sum of the four line amounts below. Server-assigned numbering starts after this.
      totalClaimedAmountNgn: 1263400000,
      // An open monitor query exists on this IPC, so the consistent state is QUERIED_BY_MONITOR.
      status: "QUERIED_BY_MONITOR",
      submittedByUserId: contractorUser.id,
      aiExecutiveSummary:
        "Reconciliation flagged 2 critical discrepancies: (1) Contractor claims 85% completion on Culvert Concrete (02.01.2), but Independent Resident CoW logs confirm only 52% poured and Cell 2 at KM 14+210 is delayed by flooding (CONTRADICTED); (2) Contractor claims 50% (₦340M) on Opaque Lump Sum (04.09.1) with zero field logs or itemized breakdown (UNSUPPORTED).",
    },
  });

  // Line Item 2: Culvert Reinforcement (PARTIALLY_SUPPORTED — missing pre-pour hold point photo for KM 15+400)
  await prisma.ipcLineItem.create({
    data: {
      ipcClaimId: lkkIpc2.id,
      boqItemId: boqCulvertReinforcement.id,
      previousCertifiedPct: 45,
      contractorClaimedPct: 80,
      contractorClaimedNgn: 162400000,
      aiEvidenceRating: "PARTIALLY_SUPPORTED",
      aiRationale:
        "Steel waybills and reinforcement tying verified at KM 14+200 (up to 65%), but Mandatory Hold-Point pre-pour inspection photo for KM 15+400 culvert cell is missing.",
      visitPlannerFlag: true,
      visitPlannerReason:
        "Mandatory Hold-Point pre-pour reinforcement inspection required at KM 15+400 before concrete placement.",
      missingHoldPointFlag: true,
      highestCorroboratingRoleName: residentCowMobileRole.name,
      highestCorroboratingWeight: residentCowMobileRole.assuranceWeight,
      corroboratingEvidenceLogIds: [
        cowEvidenceReport.id,
      ] as unknown as Prisma.InputJsonValue,
    },
  });

  // Line Item 3: Culvert Concrete (CONTRADICTED)
  const contradictedLineItem = await prisma.ipcLineItem.create({
    data: {
      ipcClaimId: lkkIpc2.id,
      boqItemId: boqCulvertConcrete.id,
      previousCertifiedPct: 35,
      contractorClaimedPct: 85,
      contractorClaimedNgn: 409500000,
      aiEvidenceRating: "CONTRADICTED",
      aiRationale:
        "Contractor claims 85% completion (3,570 m3), directly contradicted by Resident Clerk of Works voice/photo log at KM 14+210 showing Cell 2 unpoured due to flooding and cumulative verified pour at ~52%.",
      visitPlannerFlag: true,
      visitPlannerReason:
        "₦196.5M variance between Contractor IPC claim (85%) and Independent Resident CoW field log (~52%) at KM 14+210.",
      missingHoldPointFlag: true,
      highestCorroboratingRoleName: residentCowMobileRole.name,
      highestCorroboratingWeight: residentCowMobileRole.assuranceWeight,
      corroboratingEvidenceLogIds: [
        cowEvidenceReport.id,
      ] as unknown as Prisma.InputJsonValue,
    },
  });

  // Line Item 4: Stone Base (PARTIALLY_SUPPORTED — Contractor self-report only)
  await prisma.ipcLineItem.create({
    data: {
      ipcClaimId: lkkIpc2.id,
      boqItemId: boqStoneBase.id,
      previousCertifiedPct: 10,
      contractorClaimedPct: 35,
      contractorClaimedNgn: 351500000,
      aiEvidenceRating: "PARTIALLY_SUPPORTED",
      aiRationale:
        "Claim of 35% (₦351.5M drawdown) relies exclusively on Contractor Site Engineer self-reported logs at KM 16+210 without independent Monitor or Resident CoW corroboration.",
      visitPlannerFlag: true,
      visitPlannerReason:
        "High-value claim (₦351.5M) backed solely by Contractor Site Engineer self-report; requires Monitor physical verification at KM 15+800–KM 16+400.",
      missingHoldPointFlag: false,
      highestCorroboratingRoleName: contractorEngineerMobileRole.name,
      highestCorroboratingWeight: contractorEngineerMobileRole.assuranceWeight,
      corroboratingEvidenceLogIds: [
        conEvidenceReport.id,
      ] as unknown as Prisma.InputJsonValue,
    },
  });

  // Line Item 5: Opaque Lump Sum (UNSUPPORTED)
  await prisma.ipcLineItem.create({
    data: {
      ipcClaimId: lkkIpc2.id,
      boqItemId: boqOpaqueLumpSum.id,
      previousCertifiedPct: 0,
      contractorClaimedPct: 50,
      contractorClaimedNgn: 340000000,
      aiEvidenceRating: "UNSUPPORTED",
      aiRationale:
        "Zero geotagged field evidence logs or third-party utility invoices attached to support ₦340M (50%) drawdown on unbundled Provisional Lump Sum item.",
      visitPlannerFlag: true,
      visitPlannerReason:
        "Unbundled ₦340M Lump Sum claim with zero supporting field logs or third-party utility clearance certificates.",
      missingHoldPointFlag: false,
      highestCorroboratingRoleName: null,
      highestCorroboratingWeight: null,
    },
  });

  // Monitor Query on the Contradicted Culvert Concrete Line Item
  await prisma.monitorQuery.create({
    data: {
      ipcLineItemId: contradictedLineItem.id,
      raisedByUserId: monitorUser.id,
      status: "OPEN",
      queryReason:
        "IPC #2 claims 85% completion on Box Culvert Concrete (02.01.2), whereas Resident Clerk of Works geotagged evidence at KM 14+210 confirms Cell 2 has not been poured and cumulative progress is 52%. Please submit revised measurement sheets and 28-day cube test certificates.",
      requestedProofTypes: [
        "LAB_CUBE_TEST_CERT",
        "SITE_PHOTO",
      ] as unknown as Prisma.InputJsonValue,
    },
  });

  // Record Hash-Chained Audit Trail for LKK-402
  await recordAuditEvent(prisma, {
    projectId: lkkProject.id,
    actorType: "WEB_USER",
    actorId: monitorUser.id,
    actorDisplayName: `${monitorUser.fullName} (QSRBN #3842)`,
    action: "PROJECT_CREATED",
    summaryText:
      "Established baseline for Lekki–Epe Industrial Access Dual-Carriageway (LKK-402) with Linear Corridor Geofence (KM 12+000 to KM 18+500).",
    payload: { codePrefix: "LKK-402", budgetNgn: 6850000000 },
  });

  await recordAuditEvent(prisma, {
    projectId: lkkProject.id,
    actorType: "FIELD_AGENT",
    actorId: cowSession.id,
    actorDisplayName: "Engr. Segun Oladipo (INDEPENDENT_RESIDENT)",
    action: "EVIDENCE_CONFIRMED",
    summaryText:
      "Confirmed voice & photo log at Chainage KM 14+210: 12m box culvert wall cast, 40 bags of cement used; Cell 2 delayed by rain.",
    payload: {
      workdayReportId: cowEvidenceReport.id,
      chainage: cowGeoCheck.chainageFormatted,
      quantities: [{ item: "Cement", qty: 40, unit: "bags" }],
    },
  });

  await recordAuditEvent(prisma, {
    projectId: lkkProject.id,
    actorType: "WEB_USER",
    actorId: contractorUser.id,
    actorDisplayName: `${contractorUser.fullName} (Contractor)`,
    action: "IPC_SUBMITTED",
    summaryText:
      "Submitted Interim Payment Certificate (IPC) #2 requesting ₦1,263,400,000 across 4 BOQ items.",
    payload: { ipcNumber: 2, totalClaimedAmountNgn: 1263400000 },
  });

  await recordAuditEvent(prisma, {
    projectId: lkkProject.id,
    actorType: "AI_SYSTEM",
    // Seeded ratings are demo fixtures; no rating engine ran, so none is named.
    actorId: "SEED_FIXTURE",
    actorDisplayName: "Demo seed data (no rating engine ran)",
    action: "AI_RECONCILIATION_COMPLETED",
    summaryText:
      "Demo fixture ratings for IPC #2: 0 Supported, 2 Partially Supported, 1 Unsupported, 1 Contradicted.",
    payload: { ipcId: lkkIpc2.id, conflictCount: 2, ratingEngine: null },
  });

  // Mobile Notifications on LKK-402 (mix of recent unread actionable/passive + older read items)
  const nowMs = Date.now();
  const todayStr = new Date().toISOString().slice(0, 10);

  // Seed a queried Workday Report (Rev #1 -> Monitor Query -> Resubmitted Rev #2) + an active OPEN queried report
  const culvertRev1 = await prisma.workdayReport.create({
    data: {
      ...(await seedPeriodFields(lkkProject.id, todayStr)),
      projectId: lkkProject.id,
      reporterSessionId: conSession.id,
      wbsItemId: boqCulvertConcrete.id,
      workdayDate: todayStr,
      status: "CONFIRMED",
      revisionNumber: 1,
      summaryText:
        "Poured concrete on Cell 1 walls at KM 14+210 (28 m3). Shuttering stripped on Section A.",
      reportedQuantity: 28,
      clientReportId: crypto.randomUUID(),
      reporterTimezone: SEED_TIMEZONE,
      aiCheckStatus: "DONE",
      aiCheckEngine: "SEED_FIXTURE",
      unitOfMeasure: boqCulvertConcrete.unit,
      isHoldPointClaimed: true,
      submissionGeotag: {
        latitude: 6.4502,
        longitude: 3.57,
        accuracyMeters: 5.5,
        isMocked: false,
        isWithinGeofence: true,
        chainageLabel: "KM 14+210",
        distanceFromSiteMeters: null,
        capturedAt: new Date(nowMs - 1000 * 60 * 60 * 5).toISOString(),
      } as unknown as Prisma.InputJsonValue,
      aiReasoning:
        "AI Omission Check flagged missing geotagged slump-test / concrete pour photos with no omission reason.",
      humanConfirmedAt: new Date(nowMs - 1000 * 60 * 60 * 5),
      createdAt: new Date(nowMs - 1000 * 60 * 60 * 5),
    },
  });

  const culvertOpenQuery = await prisma.reportQuery.create({
    data: {
      projectId: lkkProject.id,
      boqItemId: boqCulvertConcrete.id,
      workdayReportId: culvertRev1.id,
      raisedByUserId: monitorUser.id,
      source: "MONITOR",
      status: "RESUBMITTED",
      monitorComment:
        "Missing slump test reading and close-up geotagged photo of Box Culvert Cell 1 concrete finish before certifying 28 m3.",
      createdAt: new Date(nowMs - 1000 * 60 * 60 * 3),
      respondedAt: new Date(nowMs - 1000 * 60 * 45),
    },
  });

  const culvertRev2 = await prisma.workdayReport.create({
    data: {
      ...(await seedPeriodFields(lkkProject.id, todayStr)),
      projectId: lkkProject.id,
      reporterSessionId: conSession.id,
      wbsItemId: boqCulvertConcrete.id,
      workdayDate: todayStr,
      status: "CONFIRMED",
      revisionNumber: 2,
      parentReportId: culvertRev1.id,
      resolvedQueryId: culvertOpenQuery.id,
      summaryText:
        "Poured 28 m3 Grade C30 concrete on Cell 1 walls at KM 14+210 | Query Clarification: Attached slump cone photo (75mm reading) & surface vibration finish photo taken at chainage.",
      reportedQuantity: 28,
      unitOfMeasure: boqCulvertConcrete.unit,
      isHoldPointClaimed: true,
      clientReportId: crypto.randomUUID(),
      reporterTimezone: SEED_TIMEZONE,
      aiCheckStatus: "DONE",
      aiCheckEngine: "SEED_FIXTURE",
      submissionGeotag: {
        latitude: 6.4502,
        longitude: 3.57,
        accuracyMeters: 4.8,
        isMocked: false,
        isWithinGeofence: true,
        chainageLabel: "KM 14+210",
        distanceFromSiteMeters: null,
        capturedAt: new Date(nowMs - 1000 * 60 * 45).toISOString(),
      } as unknown as Prisma.InputJsonValue,
      aiReasoning:
        "Re-parsed WBS 02.01.2 chat after MONITOR query: slump test reading (75mm) and geotagged photo verification confirmed.",
      humanConfirmedAt: new Date(nowMs - 1000 * 60 * 45),
      createdAt: new Date(nowMs - 1000 * 60 * 45),
    },
  });

  await seedCaptures({
    tenantId: lkkProject.tenantId,
    projectId: lkkProject.id,
    session: conSession,
    boqItemId: boqCulvertConcrete.id,
    workdayReportId: culvertRev2.id,
    geofence: lkkCorridorGeofence,
    captures: [
      {
        mediaType: "SITE_PHOTO",
        caption: "Slump test reading 75mm and Box Culvert Cell 1 finish",
        latitude: 6.4502,
        longitude: 3.57,
        accuracyMeters: 4.8,
        capturedAt: new Date(nowMs - 1000 * 60 * 50),
      },
    ],
  });

  const rebarReportRev1 = await prisma.workdayReport.create({
    data: {
      ...(await seedPeriodFields(lkkProject.id, todayStr)),
      projectId: lkkProject.id,
      reporterSessionId: conSession.id,
      wbsItemId: boqCulvertReinforcement.id,
      workdayDate: todayStr,
      status: "CONFIRMED",
      revisionNumber: 1,
      summaryText:
        "Cut and fixed 6.5 tons Y16/Y20 steel reinforcement cages for Culvert Cell 2 at KM 14+200.",
      reportedQuantity: 6.5,
      clientReportId: crypto.randomUUID(),
      reporterTimezone: SEED_TIMEZONE,
      aiCheckStatus: "DONE",
      aiCheckEngine: "SEED_FIXTURE",
      unitOfMeasure: boqCulvertReinforcement.unit,
      isHoldPointClaimed: true,
      submissionGeotag: {
        latitude: 6.4501,
        longitude: 3.5698,
        accuracyMeters: 6.0,
        isMocked: false,
        isWithinGeofence: true,
        chainageLabel: "KM 14+200",
        distanceFromSiteMeters: null,
        capturedAt: new Date(nowMs - 1000 * 60 * 30).toISOString(),
      } as unknown as Prisma.InputJsonValue,
      aiReasoning:
        "AI Omission Check flagged missing mandatory Hold-Point rebar spacer photo and Mill Certificate with no omission reason documented.",
      humanConfirmedAt: new Date(nowMs - 1000 * 60 * 30),
      createdAt: new Date(nowMs - 1000 * 60 * 30),
    },
  });

  const rebarOpenQuery = await prisma.reportQuery.create({
    data: {
      projectId: lkkProject.id,
      boqItemId: boqCulvertReinforcement.id,
      workdayReportId: rebarReportRev1.id,
      source: "AI_OMISSION_CHECK",
      status: "OPEN",
      aiOmissionPayload: {
        omittedItems: [
          "Geotagged photo of tied reinforcement & concrete cover spacers",
          "Mill Certificate or delivery batch proof",
        ],
        expectedRequirement:
          "MANDATORY HOLD POINT: Must capture geotagged photo of tied reinforcement & spacers plus Mill Certificate BEFORE concrete pour.",
        reasonProvidedInReport: false,
        clarificationQuestion:
          "Required Hold-Point reinforcement photo & Mill Certificate for WBS 02.01.1 were omitted without a reason. Please attach geotagged photos or explain why they were postponed, then re-submit.",
      } as unknown as Prisma.InputJsonValue,
      createdAt: new Date(nowMs - 1000 * 60 * 14),
    },
  });

  await prisma.wbsChatMessage.createMany({
    data: [
      {
        projectId: lkkProject.id,
        boqItemId: boqCulvertConcrete.id,
        workdayReportId: culvertRev1.id,
        reportQueryId: culvertOpenQuery.id,
        fieldSessionId: conSession.id,
        senderName: monitorUser.fullName,
        senderRole: "MONITOR",
        messageType: "MONITOR_QUERY",
        textContent: culvertOpenQuery.monitorComment!,
        createdAt: new Date(nowMs - 1000 * 60 * 60 * 3),
      },
      {
        projectId: lkkProject.id,
        boqItemId: boqCulvertConcrete.id,
        workdayReportId: culvertRev2.id,
        reportQueryId: culvertOpenQuery.id,
        fieldSessionId: conSession.id,
        senderName: conSession.agentFullName,
        senderRole: "ENGINEER",
        messageType: "QUERY_RESPONSE",
        textContent:
          "Attached slump cone photo (75mm reading) & Cell 1 vibration finish at KM 14+210; re-submitted Rev #2.",
        createdAt: new Date(nowMs - 1000 * 60 * 45),
      },
      {
        projectId: lkkProject.id,
        boqItemId: boqCulvertReinforcement.id,
        workdayReportId: rebarReportRev1.id,
        reportQueryId: rebarOpenQuery.id,
        fieldSessionId: conSession.id,
        senderName: "inSite AI Co-Pilot",
        senderRole: "AI_CO_PILOT",
        messageType: "AI_QUERY",
        textContent:
          "Required Hold-Point reinforcement photo & Mill Certificate for WBS 02.01.1 were omitted without a reason. Please attach geotagged photos or explain why they were postponed, then re-submit.",
        createdAt: new Date(nowMs - 1000 * 60 * 14),
      },
    ],
  });

  await prisma.webNotification.createMany({
    data: [
      {
        projectId: lkkProject.id,
        targetPermissionKey: "reports:view_all",
        category: "REPORT_RESUBMITTED",
        title: "Report Resubmitted · WBS 02.01.2 (Rev #2)",
        description:
          "Chukwudi Nnamdi uploaded slump cone proof (75mm) and re-submitted Box Culvert Concrete report for review.",
        actionUrl: `/app/projects/${lkkProject.id}/audit?tab=presence&wbsItemId=${boqCulvertConcrete.id}&reportId=${culvertRev2.id}`,
        metadata: {
          wbsItemId: boqCulvertConcrete.id,
          wbsCode: boqCulvertConcrete.wbsCode,
          workdayReportId: culvertRev2.id,
          revisionNumber: 2,
        } as unknown as Prisma.InputJsonValue,
        createdAt: new Date(nowMs - 1000 * 60 * 45),
      },
      {
        projectId: lkkProject.id,
        targetPermissionKey: "reports:view_all",
        category: "AI_OMISSION_FLAG",
        title: "AI Omission Query · WBS 02.01.1",
        description:
          "Hold-Point rebar photo & Mill Certificate omitted on WBS 02.01.1 report; auto-query dispatched to field engineer.",
        actionUrl: `/app/projects/${lkkProject.id}/audit?tab=presence&wbsItemId=${boqCulvertReinforcement.id}&reportId=${rebarReportRev1.id}`,
        metadata: {
          wbsItemId: boqCulvertReinforcement.id,
          wbsCode: boqCulvertReinforcement.wbsCode,
          workdayReportId: rebarReportRev1.id,
        } as unknown as Prisma.InputJsonValue,
        createdAt: new Date(nowMs - 1000 * 60 * 14),
      },
      {
        projectId: lkkProject.id,
        targetPermissionKey: "ipc:trigger_ai_reconcile",
        category: "CONFLICT_FLAG",
        title: "Pre-Pour Hold-Point Contradiction",
        description:
          "WBS 02.01.2 IPC #2 claim of 85% contradicts Resident CoW field log at KM 14+210.",
        actionUrl: `/app/projects/${lkkProject.id}/reconciliation`,
        metadata: { wbsCode: "02.01.2", ipcNumber: 2 } as unknown as Prisma.InputJsonValue,
        createdAt: new Date(nowMs - 1000 * 60 * 60 * 10),
      },
    ],
  });

  await prisma.mobileNotification.createMany({
    data: [
      {
        projectId: lkkProject.id,
        fieldSessionId: conSession.id,
        type: "REPORT_QUERY",
        actionType: "OPEN_WBS_CHAT",
        requiresAction: true,
        title: "Missing Evidence Query · WBS 02.01.1",
        message:
          "Required Hold-Point reinforcement photo & Mill Certificate for WBS 02.01.1 were omitted without a reason. Please attach geotagged photos or explain why they were postponed, then re-submit.",
        metadata: {
          wbsItemId: boqCulvertReinforcement.id,
          wbsCode: boqCulvertReinforcement.wbsCode,
          workdayReportId: rebarReportRev1.id,
          reportQueryId: rebarOpenQuery.id,
          querySource: "AI_OMISSION_CHECK",
        } as unknown as Prisma.InputJsonValue,
        createdAt: new Date(nowMs - 1000 * 60 * 14), // 14m ago
      },
      {
        projectId: lkkProject.id,
        fieldSessionId: conSession.id,
        type: "BACKLOG_REVIEW_REQUIRED",
        actionType: "OPEN_REPORT_SUMMARY",
        requiresAction: true,
        title: "Review Queued Report · WBS 02.01.2",
        message:
          "Offline workday summary drafted for Box Culvert concrete pour (18 m3). Review AI summary and submit.",
        metadata: {
          wbsItemId: boqCulvertConcrete.id,
          wbsCode: boqCulvertConcrete.wbsCode,
          draftSummary:
            "Placed 18 m3 Grade C30 structural concrete in Box Culvert Cell 1 walls & deck slab at KM 14+210; slump test 75mm recorded.",
          draftQuantity: 18,
          unit: boqCulvertConcrete.unit,
        } as unknown as Prisma.InputJsonValue,
        createdAt: new Date(nowMs - 1000 * 60 * 60 * 3), // 3h ago
      },
      {
        projectId: lkkProject.id,
        fieldSessionId: conSession.id,
        type: "ASSURANCE_PENDING",
        actionType: "NONE",
        requiresAction: false,
        title: "Assurance Verification Queued",
        message:
          "Your COREN and NIN credentials have been queued with KPMG Project Monitoring Desk. Offline field logs remain active.",
        metadata: {} as unknown as Prisma.InputJsonValue,
        createdAt: new Date(nowMs - 1000 * 60 * 60 * 8), // 8h ago
      },
      {
        projectId: lkkProject.id,
        fieldSessionId: conSession.id,
        type: "HOLD_POINT_ALERT",
        actionType: "OPEN_WBS_CHAT",
        requiresAction: true,
        title: "Mandatory Hold Point · WBS 02.01.1",
        message:
          "Upload geotagged tied reinforcement photo & Mill Certificate before commencing Box Culvert concrete pour.",
        metadata: {
          wbsItemId: boqCulvertReinforcement.id,
          wbsCode: boqCulvertReinforcement.wbsCode,
        } as unknown as Prisma.InputJsonValue,
        createdAt: new Date(nowMs - 1000 * 60 * 60 * 24 * 2), // 2d ago
      },
      {
        projectId: lkkProject.id,
        fieldSessionId: conSession.id,
        type: "ASSURANCE_APPROVED",
        actionType: "NONE",
        requiresAction: false,
        title: "Identity Assurance Approved",
        message:
          "KPMG Monitor approved your contractor identity and COREN credentials for LKK-402.",
        metadata: {} as unknown as Prisma.InputJsonValue,
        createdAt: new Date(nowMs - 1000 * 60 * 60 * 24 * 5), // 5d ago
      },
      {
        projectId: lkkProject.id,
        fieldSessionId: conSession.id,
        type: "MORNING_DELIVERABLE_READY",
        actionType: "OPEN_WBS_CHAT",
        requiresAction: false,
        title: "Morning Plan A Brief · WBS 03.01.1",
        message:
          "Today's deliverable targets 1,500 m2 of crushed granite stone base compaction between KM 15+800 and KM 16+400.",
        metadata: {
          wbsItemId: boqStoneBase.id,
          wbsCode: boqStoneBase.wbsCode,
        } as unknown as Prisma.InputJsonValue,
        createdAt: new Date(nowMs - 1000 * 60 * 60 * 24 * 14), // 2w ago
      },
    ],
  });

  // Older items the contractor has already read. Read state is per field session.
  const alreadyRead = await prisma.mobileNotification.findMany({
    where: {
      fieldSessionId: conSession.id,
      title: { in: ["Identity Assurance Approved", "Morning Plan A Brief · WBS 03.01.1"] },
    },
    select: { id: true, createdAt: true },
  });
  await prisma.mobileNotificationRead.createMany({
    data: alreadyRead.map((n) => ({
      notificationId: n.id,
      fieldSessionId: conSession.id,
      readAt: new Date(n.createdAt.getTime() + 86_400_000),
    })),
  });

  // ==========================================================================
  // PROJECT 2: ABJ-108 (Radial Geofence Mode — Solar & Substation Facility)
  // ==========================================================================
  const abjRadialGeofence: RadialGeofence = {
    mode: "RADIAL",
    siteLabel: "Idu Industrial Park 15MW Solar Substation Plot B4",
    center: { latitude: 9.0485, longitude: 7.3492 },
    radiusMeters: 350,
  };

  const abjProject = await prisma.project.create({
    data: {
      tenantId: defaultTenant.id,
      name: "Idu Industrial Park 15MW Captive Solar & 33kV Substation Facility",
      codePrefix: "ABJ-108",
      stateLocation: "FCT Abuja",
      lgaLocation: "AMAC — Idu Industrial Layout",
      description:
        "15MWp ground-mounted solar PV plant, inverter skids, 33/11kV step-up transformer substation, and perimeter civil works.",
      totalBudgetNgn: 4200000000,
      disbursedToDateNgn: 2100000000,
      certifiedProgressPct: 68.0,
      // Daily: the seeded PV-module reports are three days apart (one report per item and period).
      reportingCadence: "DAILY",
      geofenceMode: "RADIAL",
      geofenceGeoJson: abjRadialGeofence as unknown as Prisma.InputJsonValue,
      portfolioHealth: "EVIDENCE_SUPPORTED",
      monitorOrganizationId: monitorOrg.id,
      lenderOrganizationId: lenderOrg.id,
      status: "ACTIVE",
      activatedAt: new Date(Date.now() - 120 * 24 * 3600 * 1000),
      createdByUserId: monitorUser.id,
      activatedByUserId: monitorUser.id,
      contractorExecutionMode: "SINGLE_CONTRACTOR",
      contractors: {
        create: {
          organizationId: contractorOrg.id,
          tradeCategory: "Civil and electrical works",
          tradeCode: "GEN",
          isMainContractor: true,
          allowFieldReporting: true,
        },
      },
    },
    include: { contractors: true },
  });
  const abjContractorId = abjProject.contractors[0].id;

  await prisma.projectJoinCode.create({
    data: {
      projectId: abjProject.id,
      roleId: contractorEngineerMobileRole.id,
      projectContractorId: abjContractorId,
      code: `ABJ-108-CON-${randomJoinCodeSegment()}`,
    },
  });

  const abjJoinCow = await prisma.projectJoinCode.create({
    data: {
      projectId: abjProject.id,
      roleId: residentCowMobileRole.id,
      code: `ABJ-108-COW-${randomJoinCodeSegment()}`,
    },
  });

  // Assign Contractor User explicitly to LKK-402 & ABJ-108 (since Contractor lacks projects:view_all_tenant)
  await prisma.userProjectAssignment.createMany({
    data: [
      {
        userId: contractorUser.id,
        projectId: lkkProject.id,
      },
      {
        userId: contractorUser.id,
        projectId: abjProject.id,
      },
      // The monitor sees every project on the web through projects:view_all_tenant; explicit
      // assignments make the mobile project list independent of that permission.
      { userId: monitorUser.id, projectId: lkkProject.id },
      { userId: monitorUser.id, projectId: abjProject.id },
    ],
  });

  const abjTranche1 = await prisma.facilityTranche.create({
    data: {
      projectId: abjProject.id,
      trancheNumber: 1,
      name: "Tranche 1 — Civil Foundations, Piling & Transformer Plinths",
      allocatedAmountNgn: 2100000000,
      releasedAmountNgn: 2100000000,
      targetCompletionPct: 50,
      isReleased: true,
    },
  });

  await prisma.boqItem.create({
    data: {
      projectId: abjProject.id,
      trancheId: abjTranche1.id,
      aiSuggestedTrancheId: abjTranche1.id,
      trancheMappingConfirmedByMonitor: true,
      wbsCode: "01.01.1",
      section: "BILL NO. 1 — SUBSTATION CIVIL & TRANSFORMER PLINTHS",
      description:
        "Construct reinforced concrete 33kV Transformer Plinths and Oil Bund Walls",
      unit: "m3",
      totalQuantity: 850,
      rateNgn: 220000,
      budgetedCostNgn: 187000000,
      isHoldPoint: true,
      holdPointInstruction:
        "Capture earthing copper grid & holding-down bolts prior to concrete pour.",
      cumulativeCertifiedPct: 100,
    },
  });

  // Tranche 2 is open with no IPC yet: the demo path for a full claim-to-release cycle.
  // CP-A2 is pending, so a release is blocked until it is satisfied or waived (D-3.2).
  const abjTranche2 = await prisma.facilityTranche.create({
    data: {
      projectId: abjProject.id,
      trancheNumber: 2,
      name: "Tranche 2 — PV Modules, Inverters & Step-Up Transformer",
      allocatedAmountNgn: 2100000000,
      releasedAmountNgn: 0,
      targetCompletionPct: 100,
      isReleased: false,
      conditionsPrecedent: {
        create: [
          {
            referenceCode: "CP-A1",
            description: "Insurance certificate (Contractor's All Risks) for PV plant works",
            isMandatoryForRelease: true,
            status: "SATISFIED",
            verifiedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 20),
            statusChangedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 20),
          },
          {
            referenceCode: "CP-A2",
            description: "Executed grid interconnection agreement with the distribution company",
            isMandatoryForRelease: true,
            status: "PENDING",
          },
        ],
      },
    },
  });

  const abjPvModules = await prisma.boqItem.create({
    data: {
      projectId: abjProject.id,
      trancheId: abjTranche2.id,
      aiSuggestedTrancheId: abjTranche2.id,
      trancheMappingConfirmedByMonitor: true,
      wbsCode: "02.01.1",
      section: "BILL NO. 2 — PV GENERATION",
      description: "Supply and install monocrystalline PV modules on fixed-tilt mounting structures",
      unit: "kWp",
      totalQuantity: 15000,
      rateNgn: 90000,
      budgetedCostNgn: 1350000000,
      isHoldPoint: false,
      cumulativeCertifiedPct: 0,
    },
  });

  const abjTransformer = await prisma.boqItem.create({
    data: {
      projectId: abjProject.id,
      trancheId: abjTranche2.id,
      aiSuggestedTrancheId: abjTranche2.id,
      trancheMappingConfirmedByMonitor: true,
      wbsCode: "02.02.1",
      section: "BILL NO. 2 — SUBSTATION EQUIPMENT",
      description: "Supply, install and test 33/11kV 20MVA step-up transformer",
      unit: "nr",
      totalQuantity: 2,
      rateNgn: 260000000,
      budgetedCostNgn: 520000000,
      isHoldPoint: true,
      holdPointInstruction: "Photograph nameplate and earthing connections before energisation.",
      cumulativeCertifiedPct: 0,
    },
  });

  const abjCowSession = await prisma.fieldAgentSession.create({
    data: {
      projectId: abjProject.id,
      joinCodeId: abjJoinCow.id,
      roleId: residentCowMobileRole.id,
      roleNameSnapshot: residentCowMobileRole.name,
      fieldPersonaType: residentCowMobileRole.fieldPersonaType,
      assuranceWeight: residentCowMobileRole.assuranceWeight,
      agentFullName: "Engr. Hauwa Bello (Resident CoW)",
      agentPhoneNumber: "+2348031177420",
      deviceId: "ANDROID-COW-ABJ-2201",
      deviceModel: "Samsung Galaxy A35",
      deviceOs: "Android 14",
      lastSyncAt: new Date(),
    },
  });

  const abjEvidence = [
    {
      boqItem: abjPvModules,
      summary: "Installed and torqued 3,200 kWp of PV modules on rows A1–A16.",
      quantity: 3200,
      hoursAgo: 72,
    },
    {
      boqItem: abjPvModules,
      summary: "Installed 2,900 kWp of PV modules on rows B1–B14; string cabling in progress.",
      quantity: 2900,
      hoursAgo: 30,
    },
    {
      boqItem: abjTransformer,
      summary: "Transformer T1 set on plinth; nameplate and earthing connections photographed.",
      quantity: 1,
      hoursAgo: 26,
    },
  ];
  for (const e of abjEvidence) {
    await seedReportWithCaptures({
      tenantId: abjProject.tenantId,
      projectId: abjProject.id,
      session: abjCowSession,
      boqItem: e.boqItem,
      geofence: abjRadialGeofence,
      summaryText: e.summary,
      reportedQuantity: e.quantity,
      confirmedAt: hoursAgo(e.hoursAgo - 1),
      captures: [
        {
          mediaType: "SITE_PHOTO",
          latitude: 9.0489,
          longitude: 7.3497,
          accuracyMeters: 4.0,
          capturedAt: hoursAgo(e.hoursAgo),
        },
      ],
    });
  }

  await recordAuditEvent(prisma, {
    projectId: abjProject.id,
    actorType: "WEB_USER",
    actorId: monitorUser.id,
    actorDisplayName: `${monitorUser.fullName} (QSRBN #3842)`,
    action: "PROJECT_CREATED",
    summaryText:
      "Established baseline for Idu Industrial Park 15MW Solar & Substation (ABJ-108) with 350m Radial Geofence.",
    payload: { codePrefix: "ABJ-108", budgetNgn: 4200000000 },
  });

  await seedPhase6Projects({
    tenantId: defaultTenant.id,
    monitorOrgId: monitorOrg.id,
    lenderOrgId: lenderOrg.id,
    civilContractorOrgId: contractorOrg.id,
    monitorUserId: monitorUser.id,
    contractorUserId: contractorUser.id,
    contractorRoleId: contractorRole.id,
    passwordHash: defaultPasswordHash,
    residentRole: residentCowMobileRole,
    contractorEngineerRole: contractorEngineerMobileRole,
  });

  await seedPhase7({
    tenantId: defaultTenant.id,
    monitorOrgId: monitorOrg.id,
    lenderOrgId: lenderOrg.id,
    civilContractorOrgId: contractorOrg.id,
    monitorUserId: monitorUser.id,
    lenderUserId: (await prisma.user.findUniqueOrThrow({ where: { email: "lender@insite.ng" } })).id,
    monitorRoleId: monitorRole.id,
    passwordHash: defaultPasswordHash,
    residentRole: residentCowMobileRole,
  });

  // Phase 9: schedule baselines (one project on schedule, one four weeks behind with a pending revision).
  await seedPhase9();

  // Phase 10: one project in handover (pending link), one in its defects liability period.
  await seedPhase10({
    tenantId: defaultTenant.id,
    monitorOrgId: monitorOrg.id,
    lenderOrgId: lenderOrg.id,
    civilContractorOrgId: contractorOrg.id,
    monitorUserId: monitorUser.id,
  });

  // Phase 11: a second tenant run as a programme (delivery models, organisation hierarchy, terminology).
  await seedPhase11({ passwordHash: defaultPasswordHash });
  // Phase 12: registration bodies, programme credential policy and fixed payment milestones.
  await seedPhase12({ passwordHash: defaultPasswordHash });
  // Phase 14: checklist templates, reporting streams, inspections, findings and a supervisor over the limit.
  await seedPhase14();
  // Phase 13: document types, contract milestones, kick-off records and a default case (after 14: it merges the type config).
  await seedPhase13();

  console.log("✅ Seed complete!");
  console.log(
    "   • Super Admin Login: admin@insite.ng      / Password123! (Platform & Tenant Super Admin)",
  );
  console.log(
    "   • Monitor Login:     monitor@insite.ng    / Password123! (QSRBN #3842; also mobile sign-in as Monitor Inspector)",
  );
  console.log(
    "   • Lender Login:      lender@insite.ng     / Password123! (ICAN #MB/049120)",
  );
  console.log(
    "   • Lender Tech:       lto@insite.ng        / Password123! (certify + approve; D-3.1 demo)",
  );
  console.log(
    "   • Contractor Login:  contractor@insite.ng / Password123! (COREN #R.49201)",
  );
  console.log(
    "   • Programme tenant:  programme.admin@insite.ng (tenant admin); flagship.admin@, north.admin@, south.admin@ insite.ng (Organisation Administrators) / Password123!",
  );
  const seededCodes = await prisma.projectJoinCode.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
    select: { code: true },
  });
  console.log(
    `   • Mobile Join Codes: ${seededCodes.map((c) => c.code).join(", ")}`,
  );
}
