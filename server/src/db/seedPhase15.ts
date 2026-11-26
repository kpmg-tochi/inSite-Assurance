import crypto from "crypto";
import { Prisma } from "@prisma/client";
import {
  addDays,
  ClosureChecklistItemTemplateInput,
  ContractMilestoneTemplateInput,
  DEVICE_SIGNATURE_ALGORITHM,
  ProjectTypeConfigSchema,
  ProjectTypeSnapshot,
  zonedCalendarDate,
} from "@insite/shared";
import { prisma } from "../config/prisma";
import { WebJwtPayload } from "../middleware/auth.middleware";
import { projectObjectPrefix, storageService } from "../integrations/storage.service";
import { syncContractMilestones } from "../modules/contracts/milestones.service";
import { ensureFacilities } from "../modules/facilities/facilities.service";
import { ensureFormLibrary } from "../modules/forms/formLibraryProvisioning";
import { freezeVisitFormSnapshot } from "../modules/forms/visitForm.service";
import { answersFor } from "./seedR4";
import { changeProjectPhase } from "../modules/closeout/projectPhase.service";
import { reviewHandoverSubmission } from "../modules/closeout/handover.service";
import {
  draftCompletionCertificate,
  recordBeneficiarySignature,
  signCompletionCertificate,
} from "../modules/completion/completion.service";
import { completeClosureItem } from "../modules/completion/closure.service";
import { rateContractor, tenantRatingCriteria } from "../modules/completion/ratings.service";
import { createLesson, publishLesson } from "../modules/completion/lessons.service";
import { LAGOS_SUBEB_NAME, PROGRAMME_TENANT_SLUG } from "./seedPhase11";
import { LAGOS_ADMIN_EMAIL, LAGOS_ME_EMAIL, UBEC_ADMIN_EMAIL, UBEC_ME_EMAIL, UBEC_ROLE } from "./seedUbecRoster";
import { renderDemoDocument } from "./demoDocuments";
import { projectDocumentContext } from "./seedPhase13";

/**
 * Phase 15 seed: closure rules on both programme project types (default CoC slots, every gate on,
 * a final evaluation before the CoC, closure checklists, the handover ceremony and, for Matching Grants,
 * the post-closure evaluation), then through the real services:
 * - PRG-103 (Direct Intervention): final evaluation approved, CoC issued (owner admins + beneficiary paper copy),
 *   handover accepted with the handover certificate, now in its defects liability period;
 * - PRG-241 (Matching Grants, Lagos SUBEB): the same, then rated, two lessons published and closed; its
 *   post-closure evaluation (close + 14 days), closeout report and audit sign-off are pending, so it cannot be archived.
 *
 * Like Phases 13 and 14, the types' config and the projects' snapshots are written without a version
 * bump (seed only). Adds lagos.me@ubec.test (SUBEB M&E Officer, Lagos SUBEB) as the second signatory
 * for Lagos SUBEB-owned projects. PRG-103 is signed by the UBEC administrator and the UBEC M&E officer.
 */

const BEFORE_CLOSE: ClosureChecklistItemTemplateInput[] = [
  { key: "coc-filed", label: "Certificate of Completion filed and signed", kind: "DOCUMENT_TYPE", documentTypeCode: "COMPLETION_CERTIFICATE" },
  { key: "handover-certificate", label: "Handover certificate filed", kind: "DOCUMENT_TYPE", documentTypeCode: "HANDOVER_CERTIFICATE" },
  { key: "contractors-rated", label: "Contractors rated at completion", kind: "CONTRACTOR_RATINGS", ratingStage: "COMPLETION" },
  // No "Lessons learned published" item: for UBEC the closeout report carries the lessons (the project
  // page has no lessons panel), so the item could only be waived (found in the R7 demo dry run).
  { key: "as-built", label: "As-built drawings and O&M manuals handed over", kind: "MANUAL" },
];

/** UBEC rebrand: lessons learned come in the closeout report, uploaded per project (both types). */
const CLOSEOUT_REPORT_ITEM: ClosureChecklistItemTemplateInput = {
  key: "closeout-report",
  label: "Lessons learned report filed (final evaluation, lessons learned, beneficiary feedback)",
  kind: "DOCUMENT_TYPE",
  documentTypeCode: "CLOSEOUT_REPORT",
};

const DIRECT_BEFORE_ARCHIVE: ClosureChecklistItemTemplateInput[] = [CLOSEOUT_REPORT_ITEM];

const MATCHING_GRANTS_BEFORE_ARCHIVE: ClosureChecklistItemTemplateInput[] = [
  CLOSEOUT_REPORT_ITEM,
  { key: "post-closure-evaluation", label: "Post-closure evaluation (2 weeks after closure)", kind: "CONTRACT_MILESTONE", milestoneKey: "post-closure-evaluation" },
  { key: "archive-audit", label: "Archiving and audit sign-off (Audit Department)", kind: "AUDIT_SIGNOFF" },
];

const HANDOVER_CEREMONY: ContractMilestoneTemplateInput = {
  key: "handover-ceremony",
  label: "Handover ceremony held",
  description: "Formal handover to the beneficiary within a week of the Certificate of Completion.",
  anchor: "COC_ISSUED",
  offsetValue: 7,
  completionMode: "AUTO_HANDOVER_ACCEPTED",
  responsibleScope: "PROJECT_OWNER",
};

const POST_CLOSURE: ContractMilestoneTemplateInput = {
  key: "post-closure-evaluation",
  label: "Post-closure evaluation",
  description: "Evaluation two weeks after closure; completed once the evaluation report is filed.",
  anchor: "PROJECT_CLOSED",
  offsetValue: 14,
  requiredDocumentTypeCodes: ["FINAL_EVALUATION_REPORT"],
  responsibleScope: "MONITOR",
};

async function payloadFor(email: string): Promise<WebJwtPayload> {
  const u = await prisma.user.findUniqueOrThrow({
    where: { email },
    include: { role: { include: { rolePermissions: { include: { permission: { select: { key: true } } } } } } },
  });
  return {
    tokenType: "WEB_USER",
    userId: u.id,
    email: u.email,
    fullName: u.fullName,
    tenantId: u.tenantId,
    isPlatformSuperAdmin: false,
    roleId: u.roleId,
    roleCode: u.role.code,
    roleName: u.role.name,
    permissions: u.role.rolePermissions.map((rp) => rp.permission.key),
    organizationId: u.organizationId,
    mustChangePassword: false,
  };
}

/**
 * An accepted final evaluation visit (redesign R5f: replaces the legacy Phase 14 inspection the seed
 * wrote here). Seed only: the form is frozen through the real form library (provisioned here if
 * seedR3 has not run yet; provisioning is idempotent) and the visit and its approved submission are
 * written directly, as if the officer had submitted it and every approval step had passed. The
 * reporter is a web user, so the submission names a seed field session for them.
 */
export async function approvedFinalEvaluation(p: {
  tenantId: string;
  projectId: string;
  reporter: WebJwtPayload;
  visitDate: string;
  /** Phase 16 reuses this for baseline visits. */
  visitKind?: "FINAL_EVALUATION" | "BASELINE";
  summary?: string;
}) {
  const visitKind = p.visitKind ?? "FINAL_EVALUATION";
  await ensureFacilities(prisma, p.tenantId);
  await ensureFormLibrary(prisma, p.tenantId);
  const at = new Date(`${p.visitDate}T11:00:00.000Z`);
  // Every session belongs to an account on a device (R1d): a seed device for the reporter.
  let device = await prisma.mobileDevice.findFirst({ where: { userId: p.reporter.userId, deviceId: SEED_EVALUATION_DEVICE } });
  if (!device) {
    const raw = crypto.randomBytes(32);
    device = await prisma.mobileDevice.create({
      data: {
        userId: p.reporter.userId,
        deviceId: SEED_EVALUATION_DEVICE,
        deviceModel: "Seed evaluation device",
        publicKey: raw.toString("base64"),
        publicKeyAlg: DEVICE_SIGNATURE_ALGORITHM,
        publicKeyId: crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16),
      },
    });
  }
  const session =
    (await prisma.fieldAgentSession.findFirst({ where: { userId: p.reporter.userId, projectId: p.projectId, deviceId: SEED_EVALUATION_DEVICE } })) ??
    (await prisma.fieldAgentSession.create({
      data: {
        projectId: p.projectId,
        userId: p.reporter.userId,
        mobileDeviceId: device.id,
        roleId: p.reporter.roleId,
        roleNameSnapshot: p.reporter.roleName,
        agentFullName: p.reporter.fullName,
        agentPhoneNumber: "",
        deviceId: SEED_EVALUATION_DEVICE,
        isActive: false,
      },
    }));
  return prisma.$transaction(
    async (tx) => {
      const form = await freezeVisitFormSnapshot(tx, { projectId: p.projectId, visitKind, visitDate: p.visitDate, builtAt: at, builtByUserId: p.reporter.userId });
      const visit = await tx.visit.create({
        data: {
          projectId: p.projectId,
          visitKind,
          status: "APPROVED",
          originalPlannedDate: p.visitDate,
          plannedDate: p.visitDate,
          confirmation: "CONFIRMED",
          confirmedAt: at,
          formSnapshotId: form.id,
          formHash: form.contentSha256,
          formAssembledAt: at,
          submissionDeadline: p.visitDate,
          publishedAt: at,
          publishedByUserId: p.reporter.userId,
          createdByUserId: p.reporter.userId,
          assignees: { create: { userId: p.reporter.userId, isLead: true } },
        },
      });
      await tx.visitSubmission.create({
        data: {
          clientSubmissionId: crypto.randomUUID(),
          visitId: visit.id,
          projectId: p.projectId,
          submittedByUserId: p.reporter.userId,
          fieldSessionId: session.id,
          reporterName: p.reporter.fullName,
          reporterRoleName: p.reporter.roleName,
          formSnapshotId: form.id,
          formHash: form.contentSha256,
          answersJson: answersFor(form.snapshot) as unknown as Prisma.InputJsonValue,
          overallFinding: "SATISFACTORY",
          summaryText: p.summary ?? "Final evaluation: all deliverables in place and functional; finishes good. No outstanding snags at evaluation.",
          confirmedAt: at,
          receivedAt: at,
          status: "APPROVED",
          approvedAt: addHours(at, 26),
        },
      });
      return visit;
    },
    { timeout: 60_000 }
  );
}

const SEED_EVALUATION_DEVICE = "SEED-EVALUATION";

const addHours = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000);

/** Writes the beneficiary's signed paper copy where an upload would land; returns its object key. */
export async function paperCopy(tenantId: string, projectId: string, label: string) {
  const context = await projectDocumentContext(projectId, zonedCalendarDate(new Date(), "Africa/Lagos"));
  const body = await renderDemoDocument("COC_SIGNED_COPY", { ...context, beneficiarySignatory: label });
  const key = `${projectObjectPrefix(tenantId, projectId)}project_document/seed-coc-${crypto.randomUUID()}.pdf`;
  await storageService.putServerObject(key, body, "application/pdf");
  return key;
}

/** An accepted handover response from the head of the institution, recorded by staff (R1d) and reviewed by the monitor. */
export async function acceptedHandover(p: { projectId: string; createdByUserId: string; reviewer: WebJwtPayload; headName: string; snags: number }) {
  const submission = await prisma.handoverSubmission.create({
    data: {
      projectId: p.projectId,
      stakeholderType: "END_USER",
      recordedByUserId: p.createdByUserId,
      decision: p.snags ? "ACCEPTED_WITH_SNAGS" : "ACCEPTED",
      submitterName: p.headName,
      submitterRole: "Head of institution",
      feedbackText: p.snags ? "We accept the works. Two classroom doors stick and one tap drips." : "We accept the works. Thank you.",
      snagsJson: p.snags
        ? [
            { title: "Classroom doors", location: "Block A", description: "Two doors stick at the frame." },
            { title: "Dripping tap", location: "Toilet block", description: "Hand-washing tap drips." },
          ]
        : [],
    },
  });
  await reviewHandoverSubmission(p.projectId, submission.id, p.reviewer, { notes: p.snags ? "Snags to be tracked as defects." : undefined });
}

async function issueCertificate(p: {
  tenantId: string;
  projectId: string;
  drafter: WebJwtPayload;
  signers: [WebJwtPayload, WebJwtPayload];
  beneficiaryName: string;
  completionDate: string;
}) {
  await draftCompletionCertificate(p.projectId, p.drafter, { completionDate: p.completionDate });
  await signCompletionCertificate(p.projectId, p.signers[0], { slotKey: "head-physical-planning" });
  await signCompletionCertificate(p.projectId, p.signers[1], { slotKey: "head-me" });
  await recordBeneficiarySignature(p.projectId, p.drafter, {
    slotKey: "beneficiary",
    beneficiaryName: p.beneficiaryName,
    beneficiaryRole: "Head of institution",
    objectKey: await paperCopy(p.tenantId, p.projectId, p.beneficiaryName),
    attest: true,
  });
}

export async function seedPhase15() {
  const programme = await prisma.tenant.findUniqueOrThrow({ where: { slug: PROGRAMME_TENANT_SLUG } });

  // Type config: closure rules and milestones (no version bump, as Phases 13 and 14).
  const types = await prisma.projectType.findMany({ where: { tenantId: programme.id } });
  const configs = new Map<string, unknown>();
  for (const type of types) {
    const current = ProjectTypeConfigSchema.parse(type.configJson);
    const coFunded = type.code === "CO_FUNDED";
    const config = ProjectTypeConfigSchema.parse({
      ...current,
      contractMilestones: [...current.contractMilestones, HANDOVER_CEREMONY, ...(coFunded ? [POST_CLOSURE] : [])],
      closure: {
        requireFinalEvaluationBeforeCoc: true,
        requireCocFor: ["HANDOVER_TO_RETENTION", "FINAL_PAYMENT", "PROJECT_CLOSE"],
        handoverDueDaysAfterCoc: 7,
        beforeClose: BEFORE_CLOSE,
        beforeArchive: coFunded ? MATCHING_GRANTS_BEFORE_ARCHIVE : DIRECT_BEFORE_ARCHIVE,
        shareRatingsWithContractor: false,
      },
    });
    await prisma.projectType.update({ where: { id: type.id }, data: { configJson: config as unknown as Prisma.InputJsonValue } });
    configs.set(type.id, config);
  }
  const projects = await prisma.project.findMany({
    where: { tenantId: programme.id },
    select: { id: true, codePrefix: true, projectTypeId: true, projectTypeSnapshotJson: true },
  });
  for (const p of projects) {
    const config = p.projectTypeId ? configs.get(p.projectTypeId) : null;
    if (!config || !p.projectTypeSnapshotJson) continue;
    const snapshot = { ...(p.projectTypeSnapshotJson as unknown as ProjectTypeSnapshot), config };
    await prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id: p.id }, data: { projectTypeSnapshotJson: snapshot as unknown as Prisma.InputJsonValue } });
      await syncContractMilestones(tx, p.id);
    });
  }

  // The SUBEB M&E officer for Lagos (UBEC roster): Matching Grants evaluations and the second
  // Lagos SUBEB signatory on the Certificate of Completion (Head of M&E slot).
  const south = await prisma.organization.findFirstOrThrow({ where: { tenantId: programme.id, name: LAGOS_SUBEB_NAME } });
  const southAdminRow = await prisma.user.findUniqueOrThrow({ where: { email: LAGOS_ADMIN_EMAIL } });
  const subebMeRole = await prisma.role.findUniqueOrThrow({ where: { tenantId_code: { tenantId: programme.id, code: UBEC_ROLE.SUBEB_ME } } });
  await prisma.user.create({
    data: {
      tenantId: programme.id,
      email: LAGOS_ME_EMAIL,
      passwordHash: southAdminRow.passwordHash,
      fullName: "Bisi Adeyemi",
      phoneNumber: "+234 803 555 0131",
      roleId: subebMeRole.id,
      organizationId: south.id,
    },
  });

  // Assignment-based visibility (UBEC roster): the Lagos SUBEB M&E officer is on the Lagos projects she
  // evaluates and signs (PRG-221, PRG-241; seedPhase16 adds PRG-242).
  const lagosMe = await prisma.user.findUniqueOrThrow({ where: { email: LAGOS_ME_EMAIL } });
  await prisma.userProjectAssignment.createMany({
    data: projects.filter((p) => ["PRG-221", "PRG-241"].includes(p.codePrefix)).map((p) => ({ userId: lagosMe.id, projectId: p.id })),
    skipDuplicates: true,
  });

  const admin = await payloadFor(UBEC_ADMIN_EMAIL);
  // UBEC roster: the UBEC M&E officer is the second UBEC signatory (Head of M&E) and reviews visits
  // and handovers on Direct Intervention projects; the Lagos SUBEB M&E officer does it for Lagos.
  const monitor = await payloadFor(UBEC_ME_EMAIL);
  const southAdmin = await payloadFor(LAGOS_ADMIN_EMAIL);
  const southMe = await payloadFor(LAGOS_ME_EMAIL);
  const today = zonedCalendarDate(new Date(), "Africa/Lagos");
  const byCode = new Map(projects.map((p) => [p.codePrefix, p]));

  // Earlier contract milestones of the two projects are long done (contract and kick-off dates set).
  for (const code of ["PRG-103", "PRG-241"]) {
    const p = byCode.get(code)!;
    await prisma.project.update({
      where: { id: p.id },
      data: {
        contractReference: code === "PRG-103" ? "UBEC/DI/2025/103" : "LASUBEB/MG/2025/241",
        contractAwardDate: addDays(today, -300),
        contractSignedDate: addDays(today, -290),
        kickoffDate: addDays(today, -280),
        kickoffHeldAt: new Date(`${addDays(today, -280)}T09:00:00.000Z`),
        retentionPercentage: 5,
        retentionDurationMonths: code === "PRG-103" ? 12 : 6,
      },
    });
    await prisma.$transaction((tx) => syncContractMilestones(tx, p.id));
    await prisma.projectContractMilestone.updateMany({
      where: { projectId: p.id, status: { in: ["PENDING", "DUE", "OVERDUE"] }, anchor: { notIn: ["COC_ISSUED", "PROJECT_CLOSED"] } },
      data: { status: "DONE", completedAt: new Date(`${addDays(today, -250)}T10:00:00.000Z`), completedNotes: "Done." },
    });
  }

  // ---- PRG-103 (Direct Intervention): CoC issued, handover accepted, in its liability period -------------
  const prg103 = byCode.get("PRG-103")!;
  await approvedFinalEvaluation({ tenantId: programme.id, projectId: prg103.id, reporter: monitor, visitDate: addDays(today, -3) });
  await changeProjectPhase({ projectId: prg103.id, webUser: admin, input: { to: "HANDOVER_IN_PROGRESS" } });
  await issueCertificate({
    tenantId: programme.id,
    projectId: prg103.id,
    drafter: admin,
    signers: [admin, monitor],
    beneficiaryName: "Dr Sani Garba (Principal)",
    completionDate: addDays(today, -2),
  });
  await acceptedHandover({ projectId: prg103.id, createdByUserId: admin.userId, reviewer: monitor, headName: "Dr Sani Garba", snags: 2 });
  await changeProjectPhase({ projectId: prg103.id, webUser: admin, input: { to: "RETENTION_PERIOD" } });

  // ---- PRG-241 (Matching Grants, Lagos SUBEB): closed; post-closure evaluation, closeout report and audit pending
  const prg241 = byCode.get("PRG-241")!;
  await approvedFinalEvaluation({ tenantId: programme.id, projectId: prg241.id, reporter: southMe, visitDate: addDays(today, -6) });
  await changeProjectPhase({ projectId: prg241.id, webUser: admin, input: { to: "HANDOVER_IN_PROGRESS" } });
  await issueCertificate({
    tenantId: programme.id,
    projectId: prg241.id,
    drafter: southAdmin,
    signers: [southAdmin, southMe],
    beneficiaryName: "Mrs Funke Alabi (Head teacher)",
    completionDate: addDays(today, -5),
  });
  await acceptedHandover({ projectId: prg241.id, createdByUserId: southAdmin.userId, reviewer: southMe, headName: "Mrs Funke Alabi", snags: 0 });
  await changeProjectPhase({ projectId: prg241.id, webUser: admin, input: { to: "RETENTION_PERIOD" } });

  const contractor231 = await prisma.projectContractor.findFirstOrThrow({ where: { projectId: prg241.id } });
  const criteria = await tenantRatingCriteria(prisma, programme.id);
  for (const [rater, scores, comments] of [
    [southMe, [4, 4, 5, 3, 4], "Solid delivery; slow to answer two findings."],
    [southAdmin, [3, 4, 4, 4, 3], "Finished nine days late; quality good."],
  ] as const) {
    await rateContractor(prg241.id, rater, {
      projectContractorId: contractor231.id,
      stage: "COMPLETION",
      criteria: criteria.map((c, i) => ({ key: c.key, score: scores[i] ?? 4 })),
      comments,
    });
  }
  for (const lesson of [
    {
      category: "HANDOVER" as const,
      title: "Agree the handover ceremony date when the certificate is drafted",
      description: "The ceremony date was only agreed after the Certificate of Completion was issued, leaving three days to gather the community leaders.",
      recommendation: "Pencil in the ceremony with the beneficiary when the certificate is drafted, and confirm it on issue.",
      stage: "HANDOVER" as const,
      tags: ["handover", "scheduling", "community"],
      sharedWithContractor: false,
    },
    {
      category: "SITE_DELIVERY" as const,
      title: "Test borehole yield before the solar pump is ordered",
      description: "The pump ordered from the design yield was oversized for the tested yield and had to be swapped, delaying WASH completion by two weeks.",
      recommendation: "Make the yield test a hold point before procurement of pumps and tanks.",
      stage: "CONSTRUCTION" as const,
      tags: ["wash", "solar", "procurement"],
      sharedWithContractor: true,
    },
  ]) {
    const created = await createLesson(prg241.id, southAdmin, lesson);
    await publishLesson(prg241.id, created.id, southAdmin);
  }
  await completeClosureItem(prg241.id, "BEFORE_CLOSE", "as-built", southAdmin, "As-built drawings and O&M manuals received by the school.");
  // Seed-only shortcut: closing waits for the end of the defects liability period (owner decision
  // 2026-11-25). This story is built in one day, so the period is ended yesterday; PRG-106
  // (seedClosureTwin) carries a realistic 12-month history. The seed replacement rebuilds the timeline.
  await prisma.project.update({ where: { id: prg241.id }, data: { retentionEndDate: addDays(today, -1) } });
  await changeProjectPhase({ projectId: prg241.id, webUser: admin, input: { to: "COMPLETED_CLOSED" } });
}
