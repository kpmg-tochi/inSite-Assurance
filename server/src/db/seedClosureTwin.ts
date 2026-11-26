import { Prisma } from "@prisma/client";
import { addDays, RadialGeofence, zonedCalendarDate } from "@insite/shared";
import { prisma } from "../config/prisma";
import { createProjectDraft, saveProjectSetupStep } from "../modules/projects/projectSetup.service";
import { syncContractMilestones } from "../modules/contracts/milestones.service";
import { recordPayment } from "../modules/payments/payments.service";
import { changeProjectPhase } from "../modules/closeout/projectPhase.service";
import { draftCompletionCertificate, recordBeneficiarySignature, signCompletionCertificate } from "../modules/completion/completion.service";
import { completeClosureItem } from "../modules/completion/closure.service";
import { rateContractor, tenantRatingCriteria } from "../modules/completion/ratings.service";
import { createLesson, publishLesson } from "../modules/completion/lessons.service";
import { ME_CONSULTANTS_NAME, PROGRAMME_TENANT_SLUG, UBEC_ORG_NAME } from "./seedPhase11";
import { labelDefaultCaseChain, payloadFor } from "./seedPhase13";
import { acceptedHandover, approvedFinalEvaluation, paperCopy } from "./seedPhase15";
import { RESIDENT_SUPERVISOR_EMAIL, UBEC_ADMIN_EMAIL, UBEC_ME_EMAIL } from "./seedUbecRoster";

/**
 * Demo twin for closure (runs after seedR4, before seedDocumentRegisters). The live demo project can
 * reach the defects liability period in one sitting, but closing it for real means waiting out the
 * liability period; this twin has done that, through the real services:
 *
 * | Project | State                                                                                       |
 * | ------- | ------------------------------------------------------------------------------------------- |
 * | PRG-106 | DI, Kano. Kick-off ~19 months ago; two interim payments and a final payment (5% retention   |
 * |         | held); final evaluation accepted; CoC issued (admin + M&E officer + beneficiary paper copy); |
 * |         | handover accepted without snags (recorded by the admin, reviewed by the M&E officer);        |
 * |         | liability period (12 months) ended ~4 weeks ago; retention released after it (no exception); |
 * |         | contractor rated by both; a lesson published; as-built drawings ticked.                     |
 * |         | Left for the demo: "Close the project" (Overview), upload the closeout report (Closure tab), |
 * |         | archive (project settings), export the closure pack.                                        |
 */

export const CLOSURE_TWIN_CODE = "PRG-106";

const geofence: RadialGeofence = {
  mode: "RADIAL",
  siteLabel: "Central Primary School, Gwale",
  center: { latitude: 11.9867, longitude: 8.4925 },
  radiusMeters: 150,
};

export async function seedClosureTwin() {
  const programme = await prisma.tenant.findUniqueOrThrow({ where: { slug: PROGRAMME_TENANT_SLUG } });
  const today = zonedCalendarDate(new Date(), "Africa/Lagos");
  const admin = await payloadFor(UBEC_ADMIN_EMAIL);
  const monitor = await payloadFor(UBEC_ME_EMAIL);
  const org = (name: string) => prisma.organization.findFirstOrThrow({ where: { tenantId: programme.id, name } });
  const monitorOrg = await org(ME_CONSULTANTS_NAME);
  await org(UBEC_ORG_NAME);
  const contractorOrg = await org("Sahel Build & Civil Works Ltd");
  const central = await prisma.projectType.findFirstOrThrow({ where: { tenantId: programme.id, code: "CENTRAL" } });
  const kano = await prisma.region.findFirstOrThrow({ where: { tenantId: programme.id, code: "N-KAN" } });

  const draft = await createProjectDraft(admin, {
    name: "Gwale Central Primary School",
    codePrefix: CLOSURE_TWIN_CODE,
    stateLocation: "Kano State",
    lgaLocation: "Gwale",
    description: "Two-classroom block, toilet block and borehole (Direct Intervention).",
    totalBudgetNgn: 98_000_000,
    projectTypeId: central.id,
    regionId: kano.id,
  });
  const projectId = draft.projectId;
  await saveProjectSetupStep(projectId, "parties", admin, {
    monitorOrganization: { id: monitorOrg.id },
    contractors: [{ organization: { id: contractorOrg.id }, tradeCategory: "Civil works", tradeCode: "CIV" }],
    beneficiaries: [
      {
        name: "Gwale Central Primary School",
        beneficiaryType: "SCHOOL",
        contactName: "Head teacher",
        contactEmail: "headteacher.prg-106@example.org",
        isPrimary: true,
      },
    ],
  });
  const kickoff = addDays(today, -575);
  await prisma.project.update({
    where: { id: projectId },
    data: {
      status: "ACTIVE",
      activatedAt: new Date(`${addDays(kickoff, -30)}T10:00:00.000Z`),
      activatedByUserId: admin.userId,
      geofenceMode: "RADIAL",
      geofenceGeoJson: geofence as unknown as Prisma.InputJsonValue,
      contractReference: "UBEC/DI/2025/106",
      // Needs pipeline N0: Direct Intervention mobilisation counts 21 days from award. Awarded a week
      // before the kick-off, the contractor mobilised on the day it was due (kick-off + 14, below).
      contractAwardDate: addDays(kickoff, -7),
      contractSignedDate: addDays(kickoff, -4),
      contractSumNgn: 96_000_000,
      kickoffDate: kickoff,
      kickoffHeldAt: new Date(`${kickoff}T09:00:00.000Z`),
      plannedStartDate: addDays(kickoff, 21),
      plannedEndDate: addDays(today, -410),
      retentionPercentage: 5,
      retentionDurationMonths: 12,
      certifiedProgressPct: 100,
    },
  });
  const resident = await prisma.user.findUniqueOrThrow({ where: { email: RESIDENT_SUPERVISOR_EMAIL } });
  await prisma.userProjectAssignment.createMany({ data: [monitor.userId, resident.id].map((userId) => ({ userId, projectId })), skipDuplicates: true });
  await labelDefaultCaseChain(projectId, "CENTRAL");

  // Every contract milestone before completion is long done (as seedPhase15 does for PRG-103).
  await prisma.$transaction((tx) => syncContractMilestones(tx, projectId));
  await prisma.projectContractMilestone.updateMany({
    where: { projectId, status: { in: ["PENDING", "DUE", "OVERDUE"] }, anchor: { notIn: ["COC_ISSUED", "PROJECT_CLOSED"] } },
    data: { status: "DONE", completedAt: new Date(`${addDays(kickoff, 14)}T10:00:00.000Z`), completedNotes: "Done." },
  });

  // The bill, measured complete (legacy lines without facility units: the project predates R2).
  for (const [wbsCode, section, description, unit, qty, rate] of [
    ["01.01", "CLASSROOM BLOCK", "Two-classroom block, substructure and superstructure", "item", 1, 52_000_000],
    ["02.01", "TOILET BLOCK", "Toilet block, 6 cubicles", "item", 1, 24_000_000],
    ["03.01", "BOREHOLE", "Motorised borehole with 5,000-litre overhead tank", "item", 1, 20_000_000],
  ] as const) {
    await prisma.boqItem.create({
      data: { projectId, wbsCode, section, description, unit, totalQuantity: qty, rateNgn: rate, budgetedCostNgn: qty * rate, cumulativeCertifiedPct: 100 },
    });
  }

  // Payments recorded by Finance (the administrator); 5% retention held on each.
  for (const [paidOn, gross, reference, description] of [
    [addDays(today, -500), 38_000_000, "UBEC/PV/2025/0106-01", "Interim payment 1: substructure"],
    [addDays(today, -450), 40_000_000, "UBEC/PV/2025/0106-02", "Interim payment 2: superstructure and roofing"],
  ] as const) {
    await recordPayment(projectId, admin, { kind: "INTERIM", paidOn, grossAmountNgn: gross, reference, description });
  }

  // Completion: final evaluation accepted, CoC issued, handover accepted, liability period started.
  const completion = addDays(today, -396);
  await approvedFinalEvaluation({ tenantId: programme.id, projectId, reporter: monitor, visitDate: addDays(today, -398) });
  await changeProjectPhase({ projectId, webUser: admin, input: { to: "HANDOVER_IN_PROGRESS" } });
  await draftCompletionCertificate(projectId, admin, { completionDate: completion });
  await signCompletionCertificate(projectId, admin, { slotKey: "head-physical-planning" });
  await signCompletionCertificate(projectId, monitor, { slotKey: "head-me" });
  await recordBeneficiarySignature(projectId, admin, {
    slotKey: "beneficiary",
    beneficiaryName: "Mallam Sani Abdullahi (Head teacher)",
    beneficiaryRole: "Head teacher",
    objectKey: await paperCopy(programme.id, projectId, "Mallam Sani Abdullahi (Head teacher)"),
    attest: true,
  });
  await acceptedHandover({ projectId, createdByUserId: admin.userId, reviewer: monitor, headName: "Mallam Sani Abdullahi", snags: 0 });
  await changeProjectPhase({ projectId, webUser: admin, input: { to: "RETENTION_PERIOD", practicalCompletionDate: completion } });
  await recordPayment(projectId, admin, {
    kind: "FINAL",
    paidOn: addDays(today, -380),
    grossAmountNgn: 18_000_000,
    reference: "UBEC/PV/2025/0106-03",
    description: "Final payment after the Certificate of Completion",
  });
  // Retention released after the liability period ended (no exception: CoC issued, period over, no defects).
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { retentionHeldNgn: true, retentionEndDate: true } });
  await recordPayment(projectId, admin, {
    kind: "RETENTION_RELEASE",
    paidOn: addDays(project.retentionEndDate ?? addDays(today, -30), 5),
    grossAmountNgn: Number(project.retentionHeldNgn),
    reference: "UBEC/PV/2026/0106-RR",
    description: "Release of retention at the end of the defects liability period",
  });

  // Before closing: ratings, a lesson, as-built drawings.
  const contractor = await prisma.projectContractor.findFirstOrThrow({ where: { projectId } });
  const criteria = await tenantRatingCriteria(prisma, programme.id);
  for (const [rater, scores, comments] of [
    [monitor, [4, 4, 4, 5, 4], "On time and to specification; quick to clear the final snags."],
    [admin, [4, 5, 4, 4, 4], "Reliable contractor; good site safety record."],
  ] as const) {
    await rateContractor(projectId, rater, {
      projectContractorId: contractor.id,
      stage: "COMPLETION",
      criteria: criteria.map((c, i) => ({ key: c.key, score: scores[i] ?? 4 })),
      comments,
    });
  }
  const lesson = await createLesson(projectId, monitor, {
    category: "SITE_DELIVERY",
    title: "Check PPE from the first mobilisation check",
    description: "Workers on the borehole crew had no helmets in the first two weeks; the finding was raised only on the first routine monitoring visit.",
    recommendation: "Put PPE in the mobilisation agreement and check it on the mobilisation check, not only during construction.",
    stage: "MOBILISATION",
    tags: ["safety", "ppe", "mobilisation"],
    sharedWithContractor: true,
  });
  await publishLesson(projectId, lesson.id, monitor);
  await completeClosureItem(projectId, "BEFORE_CLOSE", "as-built", admin, "As-built drawings and the borehole pump manual received by the school.");

  // The completion notice proposed a final evaluation visit; the accepted one above already covers it.
  await prisma.visit.deleteMany({ where: { projectId, status: "PROPOSED" } });
}
