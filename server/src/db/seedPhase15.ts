import crypto from "crypto";
import { Prisma } from "@prisma/client";
import {
  addDays,
  ClosureChecklistItemTemplateInput,
  ContractMilestoneTemplateInput,
  ProjectTypeConfigSchema,
  ProjectTypeSnapshot,
  zonedCalendarDate,
} from "@insite/shared";
import { prisma } from "../config/prisma";
import { WebJwtPayload } from "../middleware/auth.middleware";
import { projectObjectPrefix, storageService } from "../integrations/storage.service";
import { syncContractMilestones } from "../modules/contracts/milestones.service";
import { parseSections } from "../modules/inspections/checklistTemplates.service";
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
import { PROGRAMME_TENANT_SLUG } from "./seedPhase11";

/**
 * Phase 15 seed: closure rules on both programme project types (default CoC slots, every gate on,
 * a final evaluation before the CoC, closure checklists, the handover ceremony and, for Co-Funded,
 * the post-closure evaluation), then through the real services:
 * - PRG-103 (Central): final evaluation approved, CoC issued (owner admins + beneficiary paper copy),
 *   handover accepted with the handover certificate, now in its defects liability period;
 * - PRG-241 (Co-Funded, South): the same, then rated, two lessons published and closed; its
 *   post-closure evaluation (close + 14 days) and audit sign-off are pending, so it cannot be archived.
 *
 * Like Phases 13 and 14, the types' config and the projects' snapshots are written without a version
 * bump (seed only). Adds south.me@insite.ng (Organisation Administrator, South) as the second
 * signatory for South-owned projects.
 */

const BEFORE_CLOSE: ClosureChecklistItemTemplateInput[] = [
  { key: "coc-filed", label: "Certificate of Completion filed and signed", kind: "DOCUMENT_TYPE", documentTypeCode: "COMPLETION_CERTIFICATE" },
  { key: "handover-certificate", label: "Handover certificate filed", kind: "DOCUMENT_TYPE", documentTypeCode: "HANDOVER_CERTIFICATE" },
  { key: "contractors-rated", label: "Contractors rated at completion", kind: "CONTRACTOR_RATINGS", ratingStage: "COMPLETION" },
  { key: "lessons-learned", label: "Lessons learned published", kind: "LESSONS_LEARNED" },
  { key: "as-built", label: "As-built drawings and O&M manuals handed over", kind: "MANUAL" },
];

const CO_FUNDED_BEFORE_ARCHIVE: ClosureChecklistItemTemplateInput[] = [
  { key: "post-closure-evaluation", label: "Post-closure evaluation (2 weeks after closure)", kind: "CONTRACT_MILESTONE", milestoneKey: "post-closure-evaluation" },
  { key: "archive-audit", label: "Archiving and audit sign-off", kind: "AUDIT_SIGNOFF" },
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

/** An approved final evaluation inspection with passing answers (as the mobile app would file it). */
export async function approvedFinalEvaluation(p: {
  tenantId: string;
  projectId: string;
  reporter: WebJwtPayload;
  visitDate: string;
  /** Phase 16 reuses this for baseline surveys. */
  visitType?: "FINAL_EVALUATION" | "BASELINE";
  templateCode?: string;
  summary?: string;
}) {
  const template = await prisma.inspectionChecklistTemplate.findFirstOrThrow({
    where: { tenantId: p.tenantId, code: p.templateCode ?? "FINAL_EVALUATION", isArchived: false },
    orderBy: { version: "desc" },
  });
  const answers = parseSections(template.sectionsJson).flatMap((s) =>
    s.items.map((item) => ({
      itemKey: item.key,
      value:
        item.responseType === "RATING_1_5" ? 4 : item.responseType === "PASS_FAIL_NA" ? "PASS" : item.responseType === "YES_NO" ? "YES" : item.responseType === "NUMBER" ? 1 : item.responseType === "TEXT" ? "None outstanding." : null,
      comment: null,
      clientCaptureIds: [],
    }))
  );
  const at = new Date(`${p.visitDate}T11:00:00.000Z`);
  return prisma.siteInspectionReport.create({
    data: {
      clientReportId: crypto.randomUUID(),
      projectId: p.projectId,
      visitType: p.visitType ?? "FINAL_EVALUATION",
      templateId: template.id,
      templateVersion: template.version,
      visitDate: p.visitDate,
      reporterUserId: p.reporter.userId,
      reporterName: p.reporter.fullName,
      reporterRoleId: p.reporter.roleId,
      reporterRoleName: p.reporter.roleName,
      answersJson: answers as unknown as Prisma.InputJsonValue,
      overallFinding: "SATISFACTORY",
      summaryText: p.summary ?? "Final evaluation: all deliverables in place and functional; finishes good. No outstanding snags at evaluation.",
      status: "APPROVED",
      confirmedAt: at,
      approvedAt: addHours(at, 26),
      aiCheckStatus: "SKIPPED",
    },
  });
}

const addHours = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000);

/** Writes the beneficiary's signed paper copy where an upload would land; returns its object key. */
export async function paperCopy(tenantId: string, projectId: string, label: string) {
  const body = Buffer.from(`%PDF-1.4\n% ${label}: Certificate of Completion signed on paper by the beneficiary (seed)\n%%EOF\n`, "utf8");
  const key = `${projectObjectPrefix(tenantId, projectId)}project_document/seed-coc-${crypto.randomUUID()}.pdf`;
  await storageService.putServerObject(key, body, "application/pdf");
  return key;
}

/** An accepted handover response from the head of the institution, reviewed by the monitor. */
export async function acceptedHandover(p: { projectId: string; createdByUserId: string; reviewer: WebJwtPayload; headName: string; snags: number }) {
  const link = await prisma.handoverLink.create({
    data: {
      projectId: p.projectId,
      tokenHash: crypto.randomBytes(32).toString("hex"),
      label: "Head of institution",
      recipientName: p.headName,
      recipientContact: "head@example.org",
      stakeholderType: "END_USER",
      handoverSummary: "Handover of the completed works to the institution.",
      expiresAt: new Date(Date.now() - 86_400_000),
      createdByUserId: p.createdByUserId,
    },
  });
  const submission = await prisma.handoverSubmission.create({
    data: {
      handoverLinkId: link.id,
      projectId: p.projectId,
      decision: p.snags ? "ACCEPTED_WITH_SNAGS" : "ACCEPTED",
      submitterName: p.headName,
      submitterRole: "Head of institution",
      feedbackText: p.snags ? "We accept the works. Two classroom doors stick and one tap drips." : "We accept the works. Thank you.",
      snagsJson: p.snags
        ? [
            { title: "Classroom doors", location: "Block A", description: "Two doors stick at the frame.", photos: [] },
            { title: "Dripping tap", location: "Toilet block", description: "Hand-washing tap drips.", photos: [] },
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
        beforeArchive: coFunded ? CO_FUNDED_BEFORE_ARCHIVE : [],
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

  // The second South signatory (Head of M&E for South-owned projects).
  const south = await prisma.organization.findFirstOrThrow({ where: { tenantId: programme.id, name: { endsWith: "South" } } });
  const southAdminRow = await prisma.user.findUniqueOrThrow({ where: { email: "south.admin@insite.ng" } });
  await prisma.user.create({
    data: {
      tenantId: programme.id,
      email: "south.me@insite.ng",
      passwordHash: southAdminRow.passwordHash,
      fullName: "Bisi Adeyemi (Delivery Entity South, M&E)",
      roleId: southAdminRow.roleId,
      organizationId: south.id,
    },
  });

  const admin = await payloadFor("programme.admin@insite.ng");
  const flagshipAdmin = await payloadFor("flagship.admin@insite.ng");
  const monitor = await payloadFor("programme.monitor@insite.ng");
  const southAdmin = await payloadFor("south.admin@insite.ng");
  const southMe = await payloadFor("south.me@insite.ng");
  const today = zonedCalendarDate(new Date(), "Africa/Lagos");
  const byCode = new Map(projects.map((p) => [p.codePrefix, p]));

  // Earlier contract milestones of the two projects are long done (contract and kick-off dates set).
  for (const code of ["PRG-103", "PRG-241"]) {
    const p = byCode.get(code)!;
    await prisma.project.update({
      where: { id: p.id },
      data: {
        contractReference: code === "PRG-103" ? "PA/CEN/2025/103" : "RDE-S/CF/2025/241",
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
      data: { status: "DONE", completedAt: new Date(`${addDays(today, -250)}T10:00:00.000Z`), completedNotes: "Done (seeded history)." },
    });
  }

  // ---- PRG-103 (Central): CoC issued, handover accepted, in its liability period -------------
  const prg103 = byCode.get("PRG-103")!;
  await approvedFinalEvaluation({ tenantId: programme.id, projectId: prg103.id, reporter: monitor, visitDate: addDays(today, -3) });
  await changeProjectPhase({ projectId: prg103.id, webUser: admin, input: { to: "HANDOVER_IN_PROGRESS" } });
  await issueCertificate({
    tenantId: programme.id,
    projectId: prg103.id,
    drafter: admin,
    signers: [admin, flagshipAdmin],
    beneficiaryName: "Dr Sani Garba (Principal)",
    completionDate: addDays(today, -2),
  });
  await acceptedHandover({ projectId: prg103.id, createdByUserId: admin.userId, reviewer: monitor, headName: "Dr Sani Garba", snags: 2 });
  await changeProjectPhase({ projectId: prg103.id, webUser: admin, input: { to: "RETENTION_PERIOD" } });

  // ---- PRG-241 (Co-Funded, South): closed; post-closure evaluation and audit pending ----------
  const prg241 = byCode.get("PRG-241")!;
  await approvedFinalEvaluation({ tenantId: programme.id, projectId: prg241.id, reporter: monitor, visitDate: addDays(today, -6) });
  await changeProjectPhase({ projectId: prg241.id, webUser: admin, input: { to: "HANDOVER_IN_PROGRESS" } });
  await issueCertificate({
    tenantId: programme.id,
    projectId: prg241.id,
    drafter: southAdmin,
    signers: [southAdmin, southMe],
    beneficiaryName: "Mrs Funke Alabi (Head teacher)",
    completionDate: addDays(today, -5),
  });
  await acceptedHandover({ projectId: prg241.id, createdByUserId: southAdmin.userId, reviewer: monitor, headName: "Mrs Funke Alabi", snags: 0 });
  await changeProjectPhase({ projectId: prg241.id, webUser: admin, input: { to: "RETENTION_PERIOD" } });

  const contractor231 = await prisma.projectContractor.findFirstOrThrow({ where: { projectId: prg241.id } });
  const criteria = await tenantRatingCriteria(prisma, programme.id);
  for (const [rater, scores, comments] of [
    [monitor, [4, 4, 5, 3, 4], "Solid delivery; slow to answer two findings."],
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
  await changeProjectPhase({ projectId: prg241.id, webUser: admin, input: { to: "COMPLETED_CLOSED" } });
}
