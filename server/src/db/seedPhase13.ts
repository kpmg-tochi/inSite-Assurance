import crypto from "crypto";
import { Prisma } from "@prisma/client";
import {
  addDays,
  defaultContractDefaultChain,
  ContractMilestoneTemplateInput,
  defaultSignOffStatement,
  ProjectTypeConfigSchema,
  ProjectTypeSnapshot,
  zonedCalendarDate,
} from "@insite/shared";
import { prisma } from "../config/prisma";
import { WebJwtPayload } from "../middleware/auth.middleware";
import { projectObjectPrefix, storageService } from "../integrations/storage.service";
import { provisionDefaultDocumentTypes } from "../modules/documents/documentTypes.service";
import { signOffStatementHash } from "../modules/documents/documents.service";
import { completeMilestone, recomputeMilestoneDates, syncContractMilestones } from "../modules/contracts/milestones.service";
import { actOnDefaultCase, openDefaultCase } from "../modules/contracts/defaultCases.service";
import { SYSTEM_ACTOR } from "../modules/contracts/milestones.service";
import { getProcessConfig, writeChainVersion } from "../modules/process/processConfig.service";
import { PROGRAMME_TENANT_SLUG } from "./seedPhase11";
import { LAGOS_ADMIN_EMAIL, UBEC_ADMIN_EMAIL, UBEC_ME_EMAIL, UBEC_ROLE } from "./seedUbecRoster";
import { DemoDocumentContext, demoDocumentTitle, renderDemoDocument } from "./demoDocuments";

/**
 * Phase 13 seed: document types for every tenant; contract milestone templates, kick-off rules,
 * document requirements and default cases on both programme project types (the UBEC administrator
 * acts for the Director Legal); then
 * - PRG-102 (Direct Intervention) mid-mobilisation: contract awarded and signed, kick-off held 16 days ago with
 *   quorum, minutes filed and signed, mobilisation due in 5 days;
 * - PRG-221 (Matching Grants) with mobilisation overdue (kick-off 20 days ago, +14) and a default case
 *   that Legal has reviewed, now waiting for the Lagos SUBEB Executive Chairman's decision.
 *
 * Like Phase 14, the types' config and the projects' snapshots are written without a version bump
 * (seed only). Dates are relative to the seed day. Document files are written to local storage when
 * S3 is not configured (otherwise only the register rows exist).
 */

/** Direct Intervention (type code CENTRAL): UBEC Project Cycle Manual, Direct Intervention sections 5-6. */
const DIRECT_INTERVENTION: ContractMilestoneTemplateInput[] = [
  { key: "acceptance-letter", label: "Acceptance letter received", anchor: "CONTRACT_AWARD", offsetValue: 3, requiredDocumentTypeCodes: ["ACCEPTANCE_LETTER"], responsibleScope: "PROJECT_OWNER" },
  { key: "kickoff-notice", label: "Kick-off notice sent", anchor: "KICKOFF", offsetValue: -7, completionMode: "AUTO_KICKOFF_NOTICE_SENT", responsibleScope: "PROJECT_OWNER" },
  { key: "kickoff-held", label: "Kick-off meeting held", anchor: "KICKOFF", offsetValue: 0, completionMode: "AUTO_KICKOFF_QUORUM", responsibleScope: "PROJECT_OWNER" },
  { key: "minutes-signed", label: "Kick-off minutes signed", anchor: "KICKOFF", offsetValue: 7, requiredDocumentTypeCodes: ["KICKOFF_MINUTES"], responsibleScope: "PROJECT_OWNER" },
  { key: "letter-of-introduction", label: "Letter of introduction issued", anchor: "KICKOFF", offsetValue: 7, requiredDocumentTypeCodes: ["LETTER_OF_INTRODUCTION"], responsibleScope: "PROJECT_OWNER" },
  { key: "supervisor-assignment", label: "Supervisor assigned", anchor: "KICKOFF", offsetValue: 7, requiredDocumentTypeCodes: ["SUPERVISOR_ASSIGNMENT"], responsibleScope: "MONITOR" },
  {
    key: "mobilisation-documents",
    label: "Mobilisation documents complete",
    anchor: "KICKOFF",
    offsetValue: 14,
    requiredDocumentTypeCodes: ["MOBILISATION_AGREEMENT", "SITE_POSSESSION_FORM"],
    perContractor: true,
    responsibleScope: "CONTRACTOR",
  },
  {
    key: "contractor-mobilised",
    label: "Contractor mobilised on site",
    anchor: "KICKOFF",
    offsetValue: 21,
    completionMode: "AUTO_CONTRACTOR_ON_SITE",
    perContractor: true,
    responsibleScope: "CONTRACTOR",
  },
];

/**
 * Matching Grants (type code CO_FUNDED): programme of works and mobilisation plan at or before the
 * kick-off, minutes approved and uploaded within 3 working days (instead of the Direct Intervention
 * week), mobilisation within 14 calendar days.
 */
const MATCHING_GRANTS: ContractMilestoneTemplateInput[] = [
  ...DIRECT_INTERVENTION.filter((t) => t.key !== "contractor-mobilised" && t.key !== "minutes-signed"),
  { key: "programme-of-works", label: "Programme of works accepted", anchor: "KICKOFF", offsetValue: 0, completionMode: "AUTO_SCHEDULE_BASELINE_SET", responsibleScope: "CONTRACTOR" },
  { key: "mobilisation-plan", label: "Mobilisation plan submitted", anchor: "KICKOFF", offsetValue: 0, requiredDocumentTypeCodes: ["MOBILISATION_PLAN"], perContractor: true, responsibleScope: "CONTRACTOR" },
  {
    key: "minutes-approved",
    label: "Kick-off minutes approved and uploaded",
    anchor: "KICKOFF",
    offsetValue: 3,
    offsetUnit: "WORKING_DAYS",
    requiredDocumentTypeCodes: ["KICKOFF_MINUTES"],
    signOffPermissionKey: "kickoff:manage",
    responsibleScope: "PROJECT_OWNER",
  },
  { ...DIRECT_INTERVENTION.find((t) => t.key === "contractor-mobilised")!, offsetValue: 14 },
];

const KICKOFF = { requiredStakeholderGroups: ["OWNER", "MONITOR", "CONTRACTOR", "BENEFICIARY"] as const, noticeLeadDays: 7 };
const DOCUMENT_REQUIREMENTS = { beforeActivation: [], beforeMobilisation: ["MOBILISATION_AGREEMENT", "SITE_POSSESSION_FORM"] };

/**
 * UBEC rebrand: the project's default case chain in the manual's words. A failure to mobilise goes
 * to the Director Legal; termination is decided by the Executive Secretary (Direct Intervention) or
 * the SUBEB Executive Chairman (Matching Grants). Same steps and scopes as the default chain (the
 * decision step is limited to the owning organisation), written as the project's chain version.
 */
export async function labelDefaultCaseChain(projectId: string, typeCode: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { tenantId: true, owningOrganizationId: true } });
    const legal = await tx.role.findFirst({ where: { tenantId: project.tenantId, code: UBEC_ROLE.ADMIN }, select: { id: true } });
    const [review, decision] = defaultContractDefaultChain({ hasOwner: Boolean(project.owningOrganizationId), legalRoleId: legal?.id ?? null });
    const steps = [
      { ...review, label: "Director Legal review" },
      { ...decision, label: typeCode === "CO_FUNDED" ? "SUBEB Executive Chairman decision" : "Executive Secretary (ES) decision" },
    ];
    await writeChainVersion(tx, projectId, "CONTRACT_DEFAULT", steps, await getProcessConfig(projectId, tx));
  });
}

export async function payloadFor(email: string): Promise<WebJwtPayload> {
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

/** The specimen context of a seeded project (name, school, contractor, contract dates). */
export async function projectDocumentContext(projectId: string, date: string): Promise<DemoDocumentContext> {
  const p = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      name: true,
      codePrefix: true,
      stateLocation: true,
      lgaLocation: true,
      contractReference: true,
      contractSumNgn: true,
      contractAwardDate: true,
      contractSignedDate: true,
      kickoffDate: true,
      beneficiaries: { where: { isPrimary: true }, select: { name: true }, take: 1 },
      contractors: { select: { organization: { select: { name: true } } }, take: 1 },
      sprints: { select: { name: true, startDate: true, endDate: true, deliverables: true }, orderBy: { number: "asc" } },
    },
  });
  return {
    projectName: p.name,
    projectCode: p.codePrefix,
    school: p.beneficiaries[0]?.name ?? null,
    contractor: p.contractors[0]?.organization.name ?? null,
    contractReference: p.contractReference,
    contractSumNgn: p.contractSumNgn === null ? null : Number(p.contractSumNgn),
    state: p.stateLocation,
    lga: p.lgaLocation,
    date,
    awardDate: p.contractAwardDate,
    signedDate: p.contractSignedDate,
    kickoffDate: p.kickoffDate,
    residentSupervisor: "Musa Danladi",
    meOfficer: "Ngozi Eze",
    sprints: p.sprints,
  };
}

/**
 * A register document with a specimen PDF for its type (`demoDocuments.ts`), filled from the
 * project (written to local storage in development).
 */
export async function fileDocument(p: {
  tenantId: string;
  projectId: string;
  typeCode: string;
  title: string;
  uploadedByUserId: string;
  projectContractorId?: string | null;
  createdAt: Date;
  /** Overrides on the project's specimen context (e.g. the kick-off date of the minutes). */
  context?: DemoDocumentContext;
}) {
  const type = await prisma.documentType.findUniqueOrThrow({ where: { tenantId_code: { tenantId: p.tenantId, code: p.typeCode } } });
  const context = { ...(await projectDocumentContext(p.projectId, p.createdAt.toISOString().slice(0, 10))), ...(p.context ?? {}) };
  const body = await renderDemoDocument(p.typeCode, context);
  const objectKey = `${projectObjectPrefix(p.tenantId, p.projectId)}project_document/seed-${crypto.randomUUID()}.pdf`;
  if (!storageService.isCloudConfigured()) await storageService.putLocalObject(objectKey, body, "application/pdf");
  return prisma.projectDocument.create({
    data: {
      projectId: p.projectId,
      documentTypeId: type.id,
      title: p.title,
      uploadedByUserId: p.uploadedByUserId,
      projectContractorId: p.projectContractorId ?? null,
      createdAt: p.createdAt,
      versions: {
        create: {
          version: 1,
          objectKey,
          mimeType: "application/pdf",
          byteSize: body.length,
          sha256: crypto.createHash("sha256").update(body).digest("hex"),
          uploadedByUserId: p.uploadedByUserId,
          uploadedAt: p.createdAt,
        },
      },
    },
    include: { versions: true },
  });
}

export async function signDocument(doc: Awaited<ReturnType<typeof fileDocument>>, user: WebJwtPayload, signedAt: Date) {
  const statement = defaultSignOffStatement(doc.title, 1);
  await prisma.projectDocumentSignOff.create({
    data: {
      documentId: doc.id,
      version: 1,
      userId: user.userId,
      roleId: user.roleId,
      organizationId: user.organizationId,
      statement,
      statementHash: signOffStatementHash({ documentId: doc.id, version: 1, versionSha256: doc.versions[0].sha256, userId: user.userId, statement }),
      signedAt,
    },
  });
}

/** The kick-off as held on `date` with one attendee per required group (and the notice sent a week before). */
export async function heldKickoff(p: { projectId: string; date: string; minutesDocumentId: string | null; invitees: Array<{ group: string; name: string; email: string | null; userId?: string | null; organizationId?: string | null }> }) {
  const at = new Date(`${p.date}T09:00:00.000Z`);
  await prisma.kickoffMeeting.create({
    data: {
      projectId: p.projectId,
      scheduledAt: at,
      location: "Site office",
      noticeSentAt: new Date(at.getTime() - 8 * 86_400_000),
      heldAt: at,
      quorumMet: true,
      minutesDocumentId: p.minutesDocumentId,
      invitees: {
        create: p.invitees.map((i) => ({
          stakeholderGroup: i.group,
          name: i.name,
          email: i.email,
          userId: i.userId ?? null,
          organizationId: i.organizationId ?? null,
          attended: true,
        })),
      },
    },
  });
  await prisma.project.update({ where: { id: p.projectId }, data: { kickoffHeldAt: at } });
  // Dates first (the kick-off date was just set), then the automatic completions.
  await prisma.$transaction((tx) => recomputeMilestoneDates(tx, p.projectId));
  // The automatic kick-off milestones, as the notice and the held record would have done.
  for (const [key, completedAt, notes] of [
    ["kickoff-notice", new Date(at.getTime() - 8 * 86_400_000), "Kick-off notice sent to the invitees."],
    ["kickoff-held", at, "Kick-off held with quorum."],
  ] as const) {
    await prisma.projectContractMilestone.updateMany({
      where: { projectId: p.projectId, key },
      data: { status: "DONE", completedAt, completedNotes: notes },
    });
  }
}

export async function seedPhase13() {
  // Document types for every tenant.
  for (const t of await prisma.tenant.findMany({ select: { id: true } })) await provisionDefaultDocumentTypes(prisma, t.id);

  const programme = await prisma.tenant.findUniqueOrThrow({ where: { slug: PROGRAMME_TENANT_SLUG } });

  // UBEC roster: no Legal login. The UBEC administrator acts for the Director Legal, so the type's
  // Legal role is the administrator's role (TENANT_SUPER_ADMIN, "UBEC Administrator").

  // Type config: milestones, kick-off, documents, default cases (no version bump, as Phase 14).
  const types = await prisma.projectType.findMany({ where: { tenantId: programme.id } });
  const configs = new Map<string, unknown>();
  for (const type of types) {
    const config = ProjectTypeConfigSchema.parse({
      ...ProjectTypeConfigSchema.parse(type.configJson),
      contractMilestones: type.code === "CO_FUNDED" ? MATCHING_GRANTS : DIRECT_INTERVENTION,
      kickoff: KICKOFF,
      documentRequirements: DOCUMENT_REQUIREMENTS,
      defaultCases: { legalRoleCode: UBEC_ROLE.ADMIN, autoOpenOnOverdueMobilisation: true },
    });
    await prisma.projectType.update({ where: { id: type.id }, data: { configJson: config as unknown as Prisma.InputJsonValue } });
    configs.set(type.id, config);
  }
  const projects = await prisma.project.findMany({
    where: { tenantId: programme.id },
    select: { id: true, codePrefix: true, projectTypeId: true, projectTypeSnapshotJson: true, timezone: true },
  });
  for (const p of projects) {
    const config = p.projectTypeId ? configs.get(p.projectTypeId) : null;
    if (!config || !p.projectTypeSnapshotJson) continue;
    const snapshot = { ...(p.projectTypeSnapshotJson as unknown as ProjectTypeSnapshot), config };
    await prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id: p.id }, data: { projectTypeSnapshotJson: snapshot as unknown as Prisma.InputJsonValue } });
      await syncContractMilestones(tx, p.id);
    });
    await labelDefaultCaseChain(p.id, types.find((t) => t.id === p.projectTypeId)!.code);
  }

  const byCode = new Map(projects.map((p) => [p.codePrefix, p]));
  const today = zonedCalendarDate(new Date(), "Africa/Lagos");
  const daysAgo = (n: number) => new Date(`${addDays(today, -n)}T10:00:00.000Z`);
  const admin = await payloadFor(UBEC_ADMIN_EMAIL);
  const monitorUser = await payloadFor(UBEC_ME_EMAIL);
  const southAdmin = await payloadFor(LAGOS_ADMIN_EMAIL);

  // ---- PRG-102 (Direct Intervention): mid-mobilisation -------------------------------------------------
  const prg102 = byCode.get("PRG-102")!;
  const kickoff102 = addDays(today, -16);
  await prisma.project.update({
    where: { id: prg102.id },
    data: {
      contractReference: "UBEC/DI/2026/102",
      contractAwardDate: addDays(today, -40),
      contractSignedDate: addDays(today, -30),
      contractSumNgn: 232_000_000,
      kickoffDate: kickoff102,
    },
  });
  const contractor102 = await prisma.projectContractor.findFirstOrThrow({ where: { projectId: prg102.id }, include: { organization: true } });
  const beneficiary102 = await prisma.projectBeneficiary.findFirst({ where: { projectId: prg102.id, isPrimary: true } });
  await fileDocument({ tenantId: programme.id, projectId: prg102.id, typeCode: "CONTRACT", title: demoDocumentTitle("CONTRACT", { contractReference: "UBEC/DI/2026/102" }), uploadedByUserId: admin.userId, createdAt: daysAgo(30) });
  await fileDocument({ tenantId: programme.id, projectId: prg102.id, typeCode: "ACCEPTANCE_LETTER", title: demoDocumentTitle("ACCEPTANCE_LETTER", { contractor: contractor102.organization.name }), uploadedByUserId: admin.userId, createdAt: daysAgo(38) });
  const minutes102 = await fileDocument({ tenantId: programme.id, projectId: prg102.id, typeCode: "KICKOFF_MINUTES", title: demoDocumentTitle("KICKOFF_MINUTES", { kickoffDate: kickoff102 }), uploadedByUserId: admin.userId, createdAt: daysAgo(15) });
  await signDocument(minutes102, admin, daysAgo(14));
  await signDocument(minutes102, monitorUser, daysAgo(13));
  const agreement102 = await fileDocument({ tenantId: programme.id, projectId: prg102.id, typeCode: "MOBILISATION_AGREEMENT", title: demoDocumentTitle("MOBILISATION_AGREEMENT"), uploadedByUserId: admin.userId, projectContractorId: contractor102.id, createdAt: daysAgo(10) });
  await signDocument(agreement102, admin, daysAgo(9));
  await heldKickoff({
    projectId: prg102.id,
    date: kickoff102,
    minutesDocumentId: minutes102.id,
    invitees: [
      { group: "OWNER", name: admin.fullName, email: admin.email, userId: admin.userId, organizationId: admin.organizationId },
      { group: "MONITOR", name: monitorUser.fullName, email: monitorUser.email, userId: monitorUser.userId, organizationId: monitorUser.organizationId },
      { group: "CONTRACTOR", name: contractor102.organization.name, email: null, organizationId: contractor102.organizationId },
      { group: "BENEFICIARY", name: beneficiary102?.contactName ?? "Head teacher", email: beneficiary102?.contactEmail ?? null },
    ],
  });
  // Done through the real service: the minutes are filed and signed.
  for (const key of ["acceptance-letter", "minutes-signed"]) {
    const m = await prisma.projectContractMilestone.findFirstOrThrow({ where: { projectId: prg102.id, key } });
    await completeMilestone(prg102.id, m.id, admin, key === "minutes-signed" ? "Signed by the owner and the monitor." : null);
  }

  // ---- PRG-221 (Matching Grants): mobilisation overdue, default case at the decision step ----------------
  const prg221 = byCode.get("PRG-221")!;
  const kickoff221 = addDays(today, -20);
  await prisma.project.update({
    where: { id: prg221.id },
    data: {
      contractReference: "LASUBEB/MG/2026/221",
      contractAwardDate: addDays(today, -45),
      contractSignedDate: addDays(today, -35),
      contractSumNgn: 81_500_000,
      kickoffDate: kickoff221,
    },
  });
  const contractor221 = await prisma.projectContractor.findFirstOrThrow({ where: { projectId: prg221.id }, include: { organization: true } });
  const minutes221 = await fileDocument({ tenantId: programme.id, projectId: prg221.id, typeCode: "KICKOFF_MINUTES", title: demoDocumentTitle("KICKOFF_MINUTES", { kickoffDate: kickoff221 }), uploadedByUserId: southAdmin.userId, createdAt: daysAgo(19) });
  await signDocument(minutes221, southAdmin, daysAgo(18));
  await heldKickoff({
    projectId: prg221.id,
    date: kickoff221,
    minutesDocumentId: minutes221.id,
    invitees: [
      { group: "OWNER", name: southAdmin.fullName, email: southAdmin.email, userId: southAdmin.userId, organizationId: southAdmin.organizationId },
      { group: "MONITOR", name: monitorUser.fullName, email: monitorUser.email, userId: monitorUser.userId, organizationId: monitorUser.organizationId },
      { group: "CONTRACTOR", name: contractor221.organization.name, email: null, organizationId: contractor221.organizationId },
      { group: "BENEFICIARY", name: "Principal, Ikeja Junior Secondary School", email: null },
    ],
  });
  await fileDocument({ tenantId: programme.id, projectId: prg221.id, typeCode: "ACCEPTANCE_LETTER", title: demoDocumentTitle("ACCEPTANCE_LETTER", { contractor: contractor221.organization.name }), uploadedByUserId: southAdmin.userId, createdAt: daysAgo(43) });
  for (const key of ["acceptance-letter", "minutes-approved"]) {
    const m = await prisma.projectContractMilestone.findFirstOrThrow({ where: { projectId: prg221.id, key } });
    await completeMilestone(prg221.id, m.id, southAdmin, null);
  }
  await prisma.$transaction(async (tx) => {
    const mobilised = await tx.projectContractMilestone.findFirstOrThrow({ where: { projectId: prg221.id, key: "contractor-mobilised" } });
    await tx.projectContractMilestone.update({ where: { id: mobilised.id }, data: { status: "OVERDUE", lastNotifiedStatus: "OVERDUE", lastNotifiedAt: new Date() } });
    await openDefaultCase(tx, {
      projectId: prg221.id,
      projectContractorId: contractor221.id,
      trigger: "MILESTONE_OVERDUE",
      milestoneId: mobilised.id,
      summary: `${contractor221.organization.name} has not checked in on site; "${mobilised.label}" was due on ${mobilised.dueDate}.`,
      actor: SYSTEM_ACTOR,
    });
  });
  const theCase = await prisma.contractorDefaultCase.findFirstOrThrow({ where: { projectId: prg221.id } });
  // Legal has reviewed it (the UBEC administrator acting for the Director Legal); it now waits for
  // the Lagos SUBEB Executive Chairman's decision (the Lagos SUBEB administrator acts for him).
  await actOnDefaultCase(prg221.id, theCase.id, admin, {
    decision: "APPROVE",
    notes: "Notice of default served on the contractor; no reply within 5 days. Recommend a short cure period or termination.",
  });
}
