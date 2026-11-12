import crypto from "crypto";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import {
  LinearCorridorGeofence,
  RadialGeofence,
  verifyPointAgainstGeofence,
} from "@insite/shared";
import { prisma } from "../src/config/prisma";
import { recordAuditEvent } from "../src/modules/audit/audit.service";

async function main() {
  console.log("🌱 Starting InSite Assurance database seed...");

  // Clean existing records in reverse dependency order
  await prisma.trancheDecision.deleteMany();
  await prisma.valuationReport.deleteMany();
  await prisma.monitorQuery.deleteMany();
  await prisma.ipcSupportingDocument.deleteMany();
  await prisma.ipcLineItem.deleteMany();
  await prisma.ipcClaim.deleteMany();
  await prisma.evidenceMedia.deleteMany();
  await prisma.fieldEvidenceLog.deleteMany();
  await prisma.boqItem.deleteMany();
  await prisma.conditionPrecedent.deleteMany();
  await prisma.facilityTranche.deleteMany();
  await prisma.fieldAgentSession.deleteMany();
  await prisma.projectJoinCode.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();

  const defaultPasswordHash = await bcrypt.hash("Password123!", 10);

  // 1. Create Organizations
  const monitorOrg = await prisma.organization.create({
    data: {
      name: "KPMG Infrastructure & Project Monitoring Advisory",
      roleType: "MONITOR",
    },
  });

  const lenderOrg = await prisma.organization.create({
    data: {
      name: "InfraCredit Guarantee & Project Finance Desk",
      roleType: "LENDER",
    },
  });

  const contractorOrg = await prisma.organization.create({
    data: {
      name: "Julius & Sons Civil Engineering Nigeria Ltd",
      roleType: "CONTRACTOR",
    },
  });

  // 2. Create Demo Web Users (All passwords: Password123!)
  const monitorUser = await prisma.user.create({
    data: {
      email: "monitor@insite.ng",
      passwordHash: defaultPasswordHash,
      fullName: "QS Tunde Adebayo, FNIQS",
      role: "MONITOR",
      organizationId: monitorOrg.id,
      professionalLicenseType: "QSRBN",
      professionalLicenseNumber: "3842",
    },
  });

  const lenderUser = await prisma.user.create({
    data: {
      email: "lender@insite.ng",
      passwordHash: defaultPasswordHash,
      fullName: "Chidinma Okafor, CFA",
      role: "LENDER",
      organizationId: lenderOrg.id,
      professionalLicenseType: "ICAN",
      professionalLicenseNumber: "MB/049120",
    },
  });

  const contractorUser = await prisma.user.create({
    data: {
      email: "contractor@insite.ng",
      passwordHash: defaultPasswordHash,
      fullName: "Engr. Musa Danladi, MNSE",
      role: "CONTRACTOR",
      organizationId: contractorOrg.id,
      professionalLicenseType: "COREN",
      professionalLicenseNumber: "R.49201",
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
      contractorOrganizationId: contractorOrg.id,
    },
  });

  const lkkJoinIns = await prisma.projectJoinCode.create({
    data: {
      projectId: lkkProject.id,
      code: "LKK-402-INS",
      independenceTier: "MONITOR_INSPECTOR",
    },
  });

  const lkkJoinCow = await prisma.projectJoinCode.create({
    data: {
      projectId: lkkProject.id,
      code: "LKK-402-COW",
      independenceTier: "INDEPENDENT_RESIDENT",
    },
  });

  const lkkJoinCon = await prisma.projectJoinCode.create({
    data: {
      projectId: lkkProject.id,
      code: "LKK-402-CON",
      independenceTier: "CONTRACTOR_ENGINEER",
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
      independenceTier: "INDEPENDENT_RESIDENT",
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
      independenceTier: "CONTRACTOR_ENGINEER",
      agentFullName: "Chukwudi Nnamdi (Contractor Site Engr)",
      agentPhoneNumber: "+2348091124500",
      deviceId: "ANDROID-CON-33109",
      deviceModel: "Redmi Note 13 Pro",
      deviceOs: "Android 14",
      lastSyncAt: new Date(),
    },
  });

  // Verify real corridor chainages using @insite/shared Turf.js engine
  const cowGeoCheck = verifyPointAgainstGeofence(
    { longitude: 3.57, latitude: 6.4502 },
    lkkCorridorGeofence,
  );

  const cowEvidenceLog = await prisma.fieldEvidenceLog.create({
    data: {
      projectId: lkkProject.id,
      boqItemId: boqCulvertConcrete.id,
      fieldSessionId: cowSession.id,
      clientCaptureId: crypto.randomUUID(),
      independenceTier: "INDEPENDENT_RESIDENT",
      status: "CONFIRMED",
      latitude: 6.4502,
      longitude: 3.57,
      gpsAccuracyMeters: 4.2,
      isMockLocation: false,
      isWithinGeofence: cowGeoCheck.isWithinGeofence,
      chainageKm: cowGeoCheck.chainageKm,
      chainageLabel: cowGeoCheck.chainageFormatted,
      corridorOffsetMeters: cowGeoCheck.corridorOffsetMeters,
      verificationBadgeText: cowGeoCheck.verificationBadgeText,
      devicePitchDeg: 68.5,
      deviceRollDeg: 1.4,
      deviceSignatureHash: crypto.randomBytes(32).toString("hex"),
      rawWhisperTranscript:
        "We dey for chainage fourteen plus two hundred this afternoon. Contractor don cast twelve meters of the box culvert wall and use forty bags of Dangote cement, plus two trips of granite. Rain delay the second cell.",
      confirmedSummary:
        "Cast 12m of box culvert wall at KM 14+210. 40 bags of cement and 2 trips of granite used. Blocker: Heavy rain halted pouring on Cell 2.",
      confirmedQuantities: [
        {
          materialOrWork: "Box culvert wall cast",
          quantity: 12,
          unit: "m",
          boqWbsCodeHint: "02.01.2",
        },
        {
          materialOrWork: "Dangote 42.5R Cement used",
          quantity: 40,
          unit: "bags",
          boqWbsCodeHint: "02.01.2",
        },
        {
          materialOrWork: "Crushed granite aggregate",
          quantity: 2,
          unit: "trips",
          boqWbsCodeHint: "02.01.2",
        },
      ] as unknown as Prisma.InputJsonValue,
      siteBlockers: [
        "Heavy rainfall halted concrete pour on Cell 2 at KM 14+210",
      ] as unknown as Prisma.InputJsonValue,
      visionObservationSummary:
        "Visible timber shuttering and fresh concrete pour on single culvert cell; second cell excavation flooded with rainwater.",
      wasEditedByAgent: false,
      confirmationSignatureHash: crypto.randomBytes(16).toString("hex"),
      capturedAtDevice: new Date(Date.now() - 1000 * 60 * 60 * 18),
      confirmedAt: new Date(Date.now() - 1000 * 60 * 60 * 17),
    },
  });

  const conGeoCheck = verifyPointAgainstGeofence(
    { longitude: 3.588, latitude: 6.4518 },
    lkkCorridorGeofence,
  );

  const conEvidenceLog = await prisma.fieldEvidenceLog.create({
    data: {
      projectId: lkkProject.id,
      boqItemId: boqStoneBase.id,
      fieldSessionId: conSession.id,
      clientCaptureId: crypto.randomUUID(),
      independenceTier: "CONTRACTOR_ENGINEER",
      status: "CONFIRMED",
      latitude: 6.4518,
      longitude: 3.588,
      gpsAccuracyMeters: 6.8,
      isMockLocation: false,
      isWithinGeofence: conGeoCheck.isWithinGeofence,
      chainageKm: conGeoCheck.chainageKm,
      chainageLabel: conGeoCheck.chainageFormatted,
      corridorOffsetMeters: conGeoCheck.corridorOffsetMeters,
      verificationBadgeText: conGeoCheck.verificationBadgeText,
      deviceSignatureHash: crypto.randomBytes(32).toString("hex"),
      rawTextNote:
        "Spread and compacted 18,500 m2 of crushed stone base between KM 15+800 and KM 16+400.",
      confirmedSummary:
        "Contractor self-report: Spread and compacted 18,500 m2 of crushed stone base course.",
      confirmedQuantities: [
        {
          materialOrWork: "Crushed stone base laid",
          quantity: 18500,
          unit: "m2",
          boqWbsCodeHint: "03.01.1",
        },
      ] as unknown as Prisma.InputJsonValue,
      capturedAtDevice: new Date(Date.now() - 1000 * 60 * 60 * 10),
      confirmedAt: new Date(Date.now() - 1000 * 60 * 60 * 9),
    },
  });

  // Active IPC Claim #2 on LKK-402 showing all 4 Evidence Strength Ratings
  const lkkIpc2 = await prisma.ipcClaim.create({
    data: {
      projectId: lkkProject.id,
      trancheId: lkkTranche2.id,
      ipcNumber: 2,
      periodStart: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30),
      periodEnd: new Date(),
      contractorCoverNote:
        "Interim Payment Certificate #2 covering completed earthworks balance, box culvert reinforcement and concrete works up to KM 16+000, stone base course, and utility relocation.",
      totalClaimedAmountNgn: 1284500000,
      status: "AI_RECONCILED",
      aiExecutiveSummary:
        "Reconciliation flagged 2 critical discrepancies: (1) Contractor claims 85% completion on Culvert Concrete (02.01.2), but Independent Resident CoW logs confirm only 52% poured and Cell 2 at KM 14+210 is delayed by flooding (CONTRADICTED); (2) Contractor claims 50% (₦340M) on Opaque Lump Sum (04.09.1) with zero field logs or itemized breakdown (UNSUPPORTED).",
    },
  });

  // Line Item 1: Earthworks (SUPPORTED)
  await prisma.ipcLineItem.create({
    data: {
      ipcClaimId: lkkIpc2.id,
      boqItemId: boqEarthworks.id,
      previousCertifiedPct: 90,
      contractorClaimedPct: 100,
      contractorClaimedNgn: 83250000,
      aiEvidenceRating: "SUPPORTED",
      aiRationale:
        "Final 10% earthworks sub-grade compaction (4,500 m3) is corroborated by Independent Resident CoW logs and field density test records within corridor.",
      visitPlannerFlag: false,
      missingHoldPointFlag: false,
      highestCorroboratingTier: "INDEPENDENT_RESIDENT",
      corroboratingEvidenceLogIds: [
        cowEvidenceLog.id,
      ] as unknown as Prisma.InputJsonValue,
      monitorCertifiedPct: 100,
      monitorCertifiedNgn: 83250000,
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
      highestCorroboratingTier: "INDEPENDENT_RESIDENT",
      corroboratingEvidenceLogIds: [
        cowEvidenceLog.id,
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
      highestCorroboratingTier: "INDEPENDENT_RESIDENT",
      corroboratingEvidenceLogIds: [
        cowEvidenceLog.id,
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
        "Claim of 35% (₦351.5M drawdown) relies exclusively on CONTRACTOR_ENGINEER self-reported logs at KM 16+210 without independent Monitor or Resident CoW corroboration.",
      visitPlannerFlag: true,
      visitPlannerReason:
        "High-value claim (₦351.5M) backed solely by Contractor Site Engineer self-report; requires Monitor physical verification at KM 15+800–KM 16+400.",
      missingHoldPointFlag: false,
      highestCorroboratingTier: "CONTRACTOR_ENGINEER",
      corroboratingEvidenceLogIds: [
        conEvidenceLog.id,
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
      highestCorroboratingTier: null,
    },
  });

  // Monitor Query on the Contradicted Culvert Concrete Line Item
  await prisma.monitorQuery.create({
    data: {
      ipcLineItemId: contradictedLineItem.id,
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
      evidenceLogId: cowEvidenceLog.id,
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
      "Submitted Interim Payment Certificate (IPC) #2 requesting ₦1,284,500,000 across 5 BOQ items.",
    payload: { ipcNumber: 2, totalClaimedAmountNgn: 1284500000 },
  });

  await recordAuditEvent(prisma, {
    projectId: lkkProject.id,
    actorType: "AI_SYSTEM",
    actorId: "AZURE-GPT4O-RECONCILER",
    actorDisplayName: "inSite AI Reconciliation Co-Pilot",
    action: "AI_RECONCILIATION_COMPLETED",
    summaryText:
      "Evaluated IPC #2 against field evidence: 1 Supported, 2 Partially Supported, 1 Unsupported, 1 Contradicted.",
    payload: { ipcId: lkkIpc2.id, conflictCount: 2 },
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
      name: "Idu Industrial Park 15MW Captive Solar & 33kV Substation Facility",
      codePrefix: "ABJ-108",
      stateLocation: "FCT Abuja",
      lgaLocation: "AMAC — Idu Industrial Layout",
      description:
        "15MWp ground-mounted solar PV plant, inverter skids, 33/11kV step-up transformer substation, and perimeter civil works.",
      totalBudgetNgn: 4200000000,
      disbursedToDateNgn: 2100000000,
      certifiedProgressPct: 68.0,
      reportingCadence: "WEEKLY",
      geofenceMode: "RADIAL",
      geofenceGeoJson: abjRadialGeofence as unknown as Prisma.InputJsonValue,
      portfolioHealth: "EVIDENCE_SUPPORTED",
      monitorOrganizationId: monitorOrg.id,
      lenderOrganizationId: lenderOrg.id,
      contractorOrganizationId: contractorOrg.id,
    },
  });

  await prisma.projectJoinCode.createMany({
    data: [
      {
        projectId: abjProject.id,
        code: "ABJ-108-INS",
        independenceTier: "MONITOR_INSPECTOR",
      },
      {
        projectId: abjProject.id,
        code: "ABJ-108-COW",
        independenceTier: "INDEPENDENT_RESIDENT",
      },
      {
        projectId: abjProject.id,
        code: "ABJ-108-CON",
        independenceTier: "CONTRACTOR_ENGINEER",
      },
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

  console.log("✅ Seed complete!");
  console.log(
    "   • Monitor Login:    monitor@insite.ng    / Password123! (QSRBN #3842)",
  );
  console.log(
    "   • Lender Login:     lender@insite.ng     / Password123! (ICAN #MB/049120)",
  );
  console.log(
    "   • Contractor Login: contractor@insite.ng / Password123! (COREN #R.49201)",
  );
  console.log(
    "   • Mobile Join Codes: LKK-402-INS, LKK-402-COW, LKK-402-CON | ABJ-108-INS, ABJ-108-COW, ABJ-108-CON",
  );
}

main()
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
