import { Prisma } from "@prisma/client";
import { addCalendarMonths, RadialGeofence, zonedCalendarDate } from "@insite/shared";
import { prisma } from "../config/prisma";
import { recordAuditEvent } from "../modules/audit/audit.service";
import { applyTemplateConfig } from "../modules/process/processConfig.service";
import { seedRecordedPayment } from "./seedPayments";

/**
 * Phase 10 seed (dates relative to today):
 * - OGN-501 in handover, with no handover response recorded yet (R1d: no public link; staff record
 *   the beneficiary's response from the signed paper copy).
 * - KWR-502 in its defects liability period: practical completion two months ago, 12-month period,
 *   5% retention held on its recorded payment (redesign R1b), and two defect tickets (one assigned and overdue, one fixed and waiting for
 *   verification).
 * Both have one recorded interim payment with 5% retention held (payments are made outside the
 * platform and recorded). Both have the handover and retention modules on and are assigned to the
 * verifier and the lender. The contractor has no login (R1d); it is the liable party on the tickets.
 */

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000);
const STEPS = ["basics", "parties", "site", "facility", "boq", "reporting", "process", "standards", "team"];

export async function seedPhase10(p: {
  tenantId: string;
  monitorOrgId: string;
  lenderOrgId: string;
  civilContractorOrgId: string;
  monitorUserId: string;
}) {
  const verifier = await prisma.user.findUniqueOrThrow({ where: { email: "verifier@insite.ng" } });
  const lender = await prisma.user.findUniqueOrThrow({ where: { email: "lender@insite.ng" } });
  const standard = await prisma.workflowTemplate.findFirstOrThrow({ where: { tenantId: p.tenantId, isDefault: true } });
  const at = daysAgo(400).toISOString();
  const today = zonedCalendarDate(new Date(), "Africa/Lagos");

  async function createProject(data: {
    codePrefix: string;
    name: string;
    stateLocation: string;
    lgaLocation: string;
    center: { latitude: number; longitude: number };
    budget: number;
    /** Gross amount of the one recorded interim payment; 5% retention is held on it. */
    paidGross: number;
    progress: number;
    extra: Prisma.ProjectUncheckedCreateInput extends infer T ? Partial<T> : never;
  }) {
    const geofence: RadialGeofence = { mode: "RADIAL", siteLabel: data.name, center: data.center, radiusMeters: 400 };
    const project = await prisma.project.create({
      data: {
        tenantId: p.tenantId,
        status: "ACTIVE",
        activatedAt: daysAgo(400),
        createdByUserId: p.monitorUserId,
        activatedByUserId: p.monitorUserId,
        name: data.name,
        codePrefix: data.codePrefix,
        stateLocation: data.stateLocation,
        lgaLocation: data.lgaLocation,
        description: "Phase 10 fixture: end of project life (handover, retention and defects).",
        totalBudgetNgn: data.budget,
        certifiedProgressPct: data.progress,
        reportingCadence: "WEEKLY",
        timezone: "Africa/Lagos",
        geofenceMode: "RADIAL",
        geofenceGeoJson: geofence as unknown as Prisma.InputJsonValue,
        monitorOrganizationId: p.monitorOrgId,
        lenderOrganizationId: p.lenderOrgId,
        retentionPercentage: 5,
        retentionDurationMonths: 12,
        retentionReleaseAtCompletionPct: 50,
        setupState: {
          steps: Object.fromEntries(
            STEPS.map((id) => [id, { savedAt: at, savedByUserId: p.monitorUserId, completedAt: at, completedByUserId: p.monitorUserId }]),
          ),
        } as unknown as Prisma.InputJsonValue,
        ...data.extra,
      },
    });
    const contractor = await prisma.projectContractor.create({
      data: {
        projectId: project.id,
        organizationId: p.civilContractorOrgId,
        tradeCategory: "Civil works",
        tradeCode: "CIV",
      },
    });
    await seedRecordedPayment({
      projectId: project.id,
      kind: "INTERIM",
      paidOn: zonedCalendarDate(daysAgo(70), "Africa/Lagos"),
      grossAmountNgn: data.paidGross,
      retentionHeldNgn: Math.round(data.paidGross * 5) / 100,
      reference: `PV/${data.codePrefix}/001`,
      description: "Main works",
      recordedByName: "Seed finance officer",
    });
    await prisma.boqItem.create({
      data: {
        projectId: project.id,
        wbsCode: "01.01",
        section: "BILL 1 — MAIN WORKS",
        description: "Main works (lump sum)",
        unit: "item",
        totalQuantity: 1,
        rateNgn: data.budget,
        budgetedCostNgn: data.budget,
        cumulativeCertifiedPct: data.progress,
      },
    });
    await prisma.$transaction(async (tx) => {
      await applyTemplateConfig(
        tx,
        { id: project.id, tenantId: p.tenantId, codePrefix: project.codePrefix, status: "DRAFT", setupState: project.setupState },
        standard,
      );
      await tx.projectProcessConfig.update({
        where: { projectId: project.id },
        data: { enableHandoverModule: true, enableRetentionModule: true },
      });
    });
    await prisma.userProjectAssignment.createMany({
      data: [
        { userId: verifier.id, projectId: project.id },
        { userId: lender.id, projectId: project.id },
      ],
    });
    return { project, contractor };
  }

  // ------------------------------------------------------------------------
  // OGN-501: in handover, response not recorded yet
  // ------------------------------------------------------------------------
  const ogun = await createProject({
    codePrefix: "OGN-501",
    name: "Ogun Rural Water Scheme — Ilaro Boreholes",
    stateLocation: "Ogun State",
    lgaLocation: "Yewa South",
    center: { latitude: 6.889, longitude: 3.0145 },
    budget: 180_000_000,
    paidGross: 180_000_000,
    progress: 100,
    extra: { constructionPhase: "HANDOVER_IN_PROGRESS", constructionPhaseChangedAt: daysAgo(3) },
  });
  await recordAuditEvent(prisma, {
    projectId: ogun.project.id,
    actorType: "WEB_USER",
    actorId: verifier.id,
    actorDisplayName: "Seed",
    action: "PROJECT_PHASE_CHANGED",
    summaryText: "Seeded OGN-501 in handover; the beneficiary's response is still to be recorded.",
    payload: { from: "ACTIVE_CONSTRUCTION", to: "HANDOVER_IN_PROGRESS" },
  });

  // ------------------------------------------------------------------------
  // KWR-502: in its defects liability period, retention held, two tickets
  // ------------------------------------------------------------------------
  const practical = zonedCalendarDate(daysAgo(61), "Africa/Lagos");
  const kwara = await createProject({
    codePrefix: "KWR-502",
    name: "Kwara Feeder Road — Oke-Oyi to Alapa",
    stateLocation: "Kwara State",
    lgaLocation: "Ilorin East",
    center: { latitude: 8.5844, longitude: 4.7395 },
    budget: 250_000_000,
    paidGross: 250_000_000,
    progress: 100,
    extra: {
      constructionPhase: "RETENTION_PERIOD",
      constructionPhaseChangedAt: daysAgo(61),
      practicalCompletionDate: practical,
      retentionStartDate: practical,
      retentionEndDate: addCalendarMonths(practical, 12),
    },
  });
  await prisma.retentionDefectTicket.create({
    data: {
      projectId: kwara.project.id,
      ticketNumber: 1,
      projectContractorId: kwara.contractor.id,
      title: "Culvert headwall cracked at chainage 4+250",
      description: "Vertical crack through the downstream headwall; water seeping behind the wing wall.",
      location: "Ch. 4+250, downstream side",
      severity: "HIGH",
      status: "ASSIGNED",
      assignedAt: daysAgo(20),
      dueDate: zonedCalendarDate(daysAgo(5), "Africa/Lagos"),
      raisedByUserId: verifier.id,
      createdAt: daysAgo(20),
    },
  });
  await prisma.retentionDefectTicket.create({
    data: {
      projectId: kwara.project.id,
      ticketNumber: 2,
      projectContractorId: kwara.contractor.id,
      title: "Pothole on the Alapa approach",
      description: "Pothole about 1 m across in the asphalt surface, 300 m before the Alapa junction.",
      location: "Alapa approach",
      severity: "MEDIUM",
      status: "RECTIFIED_PENDING_VERIFICATION",
      assignedAt: daysAgo(30),
      dueDate: today,
      rectificationNotes: "Cut, cleaned and patched with hot asphalt; compacted.",
      rectifiedAt: daysAgo(2),
      rectifiedByLabel: "Contractor (reported to the officer)",
      raisedByUserId: verifier.id,
      createdAt: daysAgo(30),
    },
  });

}
