import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import {
  ClosureGate,
  CLOSURE_GATE_META,
  CocSignatorySlot,
  CocSignatorySlotSchema,
  CocSlotDto,
  CompletionCertificateDto,
  DraftCompletionCertificateRequest,
  HANDOVER_CEREMONY_MILESTONE_KEY,
  ProjectCompletionDto,
  ProjectTypeClosureConfig,
  ProjectTypeClosureConfigSchema,
  RecordBeneficiarySignatureRequest,
  SignCompletionCertificateRequest,
  UpdateCompletionCertificateRequest,
  defaultBeneficiaryAttestation,
  defaultCocStatement,
  resolveProjectTypeConfig,
  resolveTerminology,
  resolveTerm,
  zonedCalendarDate,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { hasWebPermission, WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { createWebNotification } from '../notifications/notifications.service';
import { loadProjectOrgContext, organizationScopeAllows, ProjectOrgContext } from '../process/approvalChain';
import { registerUploadedDocumentTx, storeGeneratedDocument } from '../documents/documents.service';
import {
  autoCompleteMilestones,
  recomputeMilestoneDates,
  reopenMilestones,
  webActor,
} from '../contracts/milestones.service';
import { parseTenantBranding } from '../rbac/rbac.service';
import { storageService } from '../../integrations/storage.service';
import { generateCompletionCertificatePdf, PdfBranding } from '../../integrations/closure-pdf.service';
import { projectToday } from '../closeout/closeoutGate';

/**
 * Phase 15: the Certificate of Completion (CoC).
 *
 *   final evaluation approved → draft → signatures (slots from the project type) → ISSUED
 *   (PDF in the register, practical completion date, handover ceremony milestone, notifications)
 *
 * A certificate can be revoked with a reason until a handover is accepted. One live certificate per
 * project (partial unique index). The CoC gates handover → liability period, the final payment and
 * closure when the project type says so (`closure.requireCocFor`).
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

const actorName = (u: WebJwtPayload) => `${u.fullName} (${u.roleName})`;
const LIVE_STATUSES = ['DRAFT', 'PENDING_SIGNATURES', 'ISSUED'] as const;

// ---------------------------------------------------------------------------
// Configuration and gates
// ---------------------------------------------------------------------------

/** The closure rules of a project: its type's, or the defaults for a project without a type. */
export function closureConfigOf(snapshot: unknown): ProjectTypeClosureConfig {
  return resolveProjectTypeConfig(snapshot)?.closure ?? ProjectTypeClosureConfigSchema.parse({});
}

/** Whether a gate is on. Projects without a type keep today's behaviour (no gate). */
export function cocGateOn(snapshot: unknown, gate: ClosureGate): boolean {
  const config = resolveProjectTypeConfig(snapshot);
  return Boolean(config?.closure.requireCocFor.includes(gate));
}

export async function issuedCertificate(db: Db, projectId: string) {
  return db.completionCertificate.findFirst({ where: { projectId, status: 'ISSUED' } });
}

/** The reason a gate refuses, or null when it is off or satisfied. */
export async function cocGateReason(db: Db, projectId: string, gate: ClosureGate, snapshot?: unknown): Promise<string | null> {
  const snap =
    snapshot !== undefined
      ? snapshot
      : (await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { projectTypeSnapshotJson: true } })).projectTypeSnapshotJson;
  if (!cocGateOn(snap, gate)) return null;
  if (await issuedCertificate(db, projectId)) return null;
  return `${CLOSURE_GATE_META[gate].label} needs an issued Certificate of Completion. Draft it and collect the signatures on the Certificate tab of Completion & handover.`;
}

export async function assertCocGate(db: Db, projectId: string, gate: ClosureGate) {
  const reason = await cocGateReason(db, projectId, gate);
  if (reason) throw new AppError(reason, 409, 'COC_REQUIRED', { gate });
}

// ---------------------------------------------------------------------------
// Final evaluation
// ---------------------------------------------------------------------------

export interface FinalEvaluation {
  /** The visit id. */
  id: string;
  visitId: string;
  visitDate: string;
  approvedAt: Date | null;
  confirmedAt: Date;
  overallFinding: string;
  summaryText: string;
  reporterName: string;
}

/**
 * The latest accepted final evaluation: an accepted FINAL_EVALUATION visit (redesign R4d; R5f deleted
 * the legacy Phase 14 inspections).
 */
export async function latestFinalEvaluation(db: Db, projectId: string): Promise<FinalEvaluation | null> {
  const visit = await db.visitSubmission.findFirst({
    where: { projectId, status: 'APPROVED', visit: { visitKind: 'FINAL_EVALUATION', status: 'APPROVED' } },
    orderBy: [{ visit: { plannedDate: 'desc' } }, { approvedAt: 'desc' }],
    select: { visitId: true, approvedAt: true, confirmedAt: true, overallFinding: true, summaryText: true, reporterName: true, visit: { select: { plannedDate: true } } },
  });
  if (!visit) return null;
  return {
    id: visit.visitId,
    visitId: visit.visitId,
    visitDate: visit.visit.plannedDate,
    approvedAt: visit.approvedAt,
    confirmedAt: visit.confirmedAt,
    overallFinding: visit.overallFinding,
    summaryText: visit.summaryText,
    reporterName: visit.reporterName,
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const CERT_INCLUDE = { signatures: { orderBy: { signedAt: 'asc' } } } satisfies Prisma.CompletionCertificateInclude;
type CertRow = Prisma.CompletionCertificateGetPayload<{ include: typeof CERT_INCLUDE }>;

function slotsOf(cert: { slotsJson: Prisma.JsonValue }): CocSignatorySlot[] {
  const raw = Array.isArray(cert.slotsJson) ? cert.slotsJson : [];
  return raw.map((s) => CocSignatorySlotSchema.parse(s));
}

interface ProjectParties extends ProjectOrgContext {
  monitorOrganizationId: string | null;
}

async function partiesOf(db: Db, projectId: string): Promise<ProjectParties> {
  const [ctx, p] = await Promise.all([
    loadProjectOrgContext(db, projectId),
    db.project.findUniqueOrThrow({ where: { id: projectId }, select: { monitorOrganizationId: true } }),
  ]);
  return { ...ctx, monitorOrganizationId: p.monitorOrganizationId };
}

function scopeAllows(slot: CocSignatorySlot, organizationId: string, parties: ProjectParties): boolean {
  if (slot.organizationScope === 'MONITOR') return parties.monitorOrganizationId !== null && parties.monitorOrganizationId === organizationId;
  return organizationScopeAllows(slot.organizationScope, organizationId, parties);
}

function scopeReason(slot: CocSignatorySlot): string {
  switch (slot.organizationScope) {
    case 'PROJECT_OWNER':
      return `"${slot.label}" is signed by someone in the project's owning organisation.`;
    case 'PROJECT_OWNER_OR_ANCESTOR':
      return `"${slot.label}" is signed by someone in the owning organisation or an organisation above it.`;
    case 'FUNDER':
      return `"${slot.label}" is signed by someone in the funding organisation.`;
    case 'MONITOR':
      return `"${slot.label}" is signed by someone in the monitoring organisation.`;
    default:
      return `You cannot sign "${slot.label}".`;
  }
}

/** Why the user cannot sign the slot now (null = may sign). */
function staffSlotRefusal(cert: CertRow, slot: CocSignatorySlot, webUser: WebJwtPayload, parties: ProjectParties): string | null {
  if (cert.status !== 'DRAFT' && cert.status !== 'PENDING_SIGNATURES') return 'The certificate is not open for signatures.';
  if (cert.signatures.some((s) => s.slotKey === slot.key)) return 'This slot is already signed.';
  if (slot.isBeneficiary) {
    return hasWebPermission(webUser, 'completion:draft_certificate')
      ? null
      : "Recording the beneficiary's signed copy needs completion:draft_certificate.";
  }
  if (!hasWebPermission(webUser, slot.permissionKey)) return `Signing "${slot.label}" needs ${slot.permissionKey}.`;
  if (slot.roleCode && webUser.roleCode !== slot.roleCode) return `"${slot.label}" is signed by the ${slot.roleCode} role.`;
  if (!scopeAllows(slot, webUser.organizationId, parties)) return scopeReason(slot);
  const mine = cert.signatures.find((s) => s.userId === webUser.userId);
  if (mine) return `You already signed as "${mine.slotLabel}". Each slot needs a different person.`;
  return null;
}

async function serializeCertificates(db: Db, rows: CertRow[], webUser: WebJwtPayload | null, parties: ProjectParties | null): Promise<CompletionCertificateDto[]> {
  const userIds = new Set<string>();
  for (const c of rows) {
    userIds.add(c.createdByUserId);
    for (const s of c.signatures) {
      if (s.userId) userIds.add(s.userId);
      if (s.recordedByUserId) userIds.add(s.recordedByUserId);
    }
  }
  const roleIds = rows.flatMap((c) => c.signatures.map((s) => s.roleId)).filter((v): v is string => Boolean(v));
  const orgIds = rows.flatMap((c) => c.signatures.map((s) => s.organizationId)).filter((v): v is string => Boolean(v));
  const [users, roles, orgs] = await Promise.all([
    userIds.size ? db.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, fullName: true } }) : [],
    roleIds.length ? db.role.findMany({ where: { id: { in: roleIds } }, select: { id: true, name: true } }) : [],
    orgIds.length ? db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [],
  ]);
  const userName = new Map(users.map((u) => [u.id, u.fullName]));
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  return rows.map((c) => {
    const slots: CocSlotDto[] = slotsOf(c).map((slot) => {
      const sig = c.signatures.find((s) => s.slotKey === slot.key) ?? null;
      const refusal = webUser && parties ? staffSlotRefusal(c, slot, webUser, parties) : 'Not signed in.';
      return {
        key: slot.key,
        label: slot.label,
        isBeneficiary: slot.isBeneficiary,
        organizationScope: slot.organizationScope,
        permissionKey: slot.permissionKey,
        roleCode: slot.roleCode,
        signature: sig
          ? {
              userId: sig.userId,
              signerName: sig.isBeneficiary ? sig.beneficiaryName ?? 'Beneficiary' : (sig.userId && userName.get(sig.userId)) || 'Unknown user',
              roleName: sig.roleId ? roleName.get(sig.roleId) ?? null : null,
              organizationName: sig.organizationId ? orgName.get(sig.organizationId) ?? null : null,
              isBeneficiary: sig.isBeneficiary,
              beneficiaryRole: sig.beneficiaryRole,
              evidenceDocumentId: sig.evidenceDocumentId,
              recordedByName: sig.recordedByUserId ? userName.get(sig.recordedByUserId) ?? null : null,
              statement: sig.statement,
              statementHash: sig.statementHash,
              signedAt: sig.signedAt.toISOString(),
            }
          : null,
        canSign: !sig && refusal === null,
        cannotSignReason: sig ? null : refusal,
      };
    });
    return {
      id: c.id,
      certificateNumber: c.certificateNumber,
      status: c.status,
      scopeSummary: c.scopeSummary,
      completionDate: c.completionDate,
      finalEvaluationVisitId: c.finalEvaluationVisitId,
      documentId: c.documentId,
      issuedAt: c.issuedAt?.toISOString() ?? null,
      revokedAt: c.revokedAt?.toISOString() ?? null,
      revokedReason: c.revokedReason,
      createdByName: userName.get(c.createdByUserId) ?? null,
      createdAt: c.createdAt.toISOString(),
      slots,
      signedCount: c.signatures.length,
    };
  });
}

async function acceptedReviewedHandover(db: Db, projectId: string) {
  return db.handoverSubmission.findFirst({
    where: { projectId, decision: { in: ['ACCEPTED', 'ACCEPTED_WITH_SNAGS'] }, reviewedAt: { not: null } },
    orderBy: { reviewedAt: 'desc' },
  });
}

async function suggestedScope(db: Db, projectId: string, evaluation: Awaited<ReturnType<typeof latestFinalEvaluation>>) {
  const p = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { name: true, description: true, contractReference: true, _count: { select: { boqItems: true } } },
  });
  const parts = [
    `Completion of the works for ${p.name}${p.contractReference ? ` under contract ${p.contractReference}` : ''}`,
    p._count.boqItems ? `covering the ${p._count.boqItems} items of the bill of quantities` : null,
  ].filter(Boolean);
  let text = `${parts.join(', ')}.`;
  if (p.description) text += ` ${p.description}`;
  if (evaluation) text += ` Final evaluation of ${evaluation.visitDate}: ${evaluation.overallFinding.replace('_', ' ').toLowerCase()}.`;
  return text.slice(0, 4000);
}

const DRAFTABLE_PHASES = ['ACTIVE_CONSTRUCTION', 'HANDOVER_IN_PROGRESS'];

async function draftRefusal(db: Db, projectId: string, config: ProjectTypeClosureConfig, evaluationId: string | null): Promise<string | null> {
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { status: true, constructionPhase: true } });
  if (project.status !== 'ACTIVE') return 'Only an active project gets a Certificate of Completion.';
  if (!DRAFTABLE_PHASES.includes(project.constructionPhase)) return 'A certificate is drafted during construction or handover.';
  if (await db.completionCertificate.count({ where: { projectId, status: { in: [...LIVE_STATUSES] } } })) return 'The project already has a certificate.';
  if (config.requireFinalEvaluationBeforeCoc && !evaluationId) {
    return 'An accepted final evaluation visit is needed before the certificate can be drafted.';
  }
  return null;
}

/** GET /projects/:projectId/completion */
export async function getProjectCompletion(projectId: string, webUser: WebJwtPayload): Promise<ProjectCompletionDto> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { constructionPhase: true, projectTypeSnapshotJson: true },
  });
  const config = closureConfigOf(project.projectTypeSnapshotJson);
  const [rows, evaluation, parties, accepted] = await Promise.all([
    prisma.completionCertificate.findMany({ where: { projectId }, include: CERT_INCLUDE, orderBy: { createdAt: 'desc' } }),
    latestFinalEvaluation(prisma, projectId),
    partiesOf(prisma, projectId),
    acceptedReviewedHandover(prisma, projectId),
  ]);
  const certs = await serializeCertificates(prisma, rows, webUser, parties);
  const current = certs.find((c) => c.status !== 'REVOKED') ?? null;
  const refusal = await draftRefusal(prisma, projectId, config, evaluation?.id ?? null);
  const ceremony = await prisma.projectContractMilestone.findFirst({
    where: { projectId, OR: [{ anchor: 'COC_ISSUED' }, { key: HANDOVER_CEREMONY_MILESTONE_KEY }] },
    orderBy: { sortOrder: 'asc' },
  });
  const handoverCert = await prisma.projectDocument.findFirst({
    where: { projectId, isArchived: false, documentType: { code: 'HANDOVER_CERTIFICATE' } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  let revokeReason: string | null = null;
  if (!current) revokeReason = 'There is no certificate to revoke.';
  else if (accepted) revokeReason = 'The handover has been accepted, so the certificate can no longer be revoked.';
  else if (!hasWebPermission(webUser, 'completion:revoke_certificate')) revokeReason = 'Revoking needs completion:revoke_certificate.';
  return {
    projectId,
    phase: project.constructionPhase,
    rules: {
      requireFinalEvaluationBeforeCoc: config.requireFinalEvaluationBeforeCoc,
      requireCocFor: resolveProjectTypeConfig(project.projectTypeSnapshotJson) ? config.requireCocFor : [],
      handoverDueDaysAfterCoc: config.handoverDueDaysAfterCoc,
      beneficiarySignatureMode: config.beneficiarySignatureMode,
    },
    finalEvaluation: {
      required: config.requireFinalEvaluationBeforeCoc,
      visitId: evaluation?.visitId ?? null,
      visitDate: evaluation?.visitDate ?? null,
      approvedAt: evaluation?.approvedAt?.toISOString() ?? evaluation?.confirmedAt.toISOString() ?? null,
    },
    certificate: current,
    revoked: certs.filter((c) => c.status === 'REVOKED'),
    canDraft: refusal === null && hasWebPermission(webUser, 'completion:draft_certificate'),
    draftBlockedReason: refusal ?? (hasWebPermission(webUser, 'completion:draft_certificate') ? null : 'Drafting needs completion:draft_certificate.'),
    canRevoke: revokeReason === null,
    revokeBlockedReason: revokeReason,
    handoverCeremony: ceremony
      ? { milestoneId: ceremony.id, dueDate: ceremony.dueDate, status: ceremony.status, completedAt: ceremony.completedAt?.toISOString() ?? null }
      : null,
    handoverCertificateDocumentId: handoverCert?.id ?? null,
    suggestedScopeSummary: await suggestedScope(prisma, projectId, evaluation),
  };
}

// ---------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------

async function lockProject(tx: Tx, projectId: string) {
  await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId}::uuid FOR UPDATE`;
}

/** POST /projects/:projectId/completion/certificate */
export async function draftCompletionCertificate(projectId: string, webUser: WebJwtPayload, input: DraftCompletionCertificateRequest) {
  await prisma.$transaction(async (tx) => {
    await lockProject(tx, projectId);
    const project = await tx.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { codePrefix: true, timezone: true, projectTypeSnapshotJson: true },
    });
    const config = closureConfigOf(project.projectTypeSnapshotJson);
    const evaluation = await latestFinalEvaluation(tx, projectId);
    const refusal = await draftRefusal(tx, projectId, config, evaluation?.id ?? null);
    if (refusal) {
      const needsEvaluation = config.requireFinalEvaluationBeforeCoc && !evaluation;
      throw new AppError(refusal, needsEvaluation ? 422 : 409, needsEvaluation ? 'FINAL_EVALUATION_REQUIRED' : 'COC_DRAFT_NOT_ALLOWED', {
        linkTo: needsEvaluation ? `/app/projects/${projectId}/visits` : null,
      });
    }
    if (input.completionDate > projectToday(project.timezone)) {
      throw new AppError('The completion date cannot be in the future.', 422, 'COMPLETION_DATE_IN_FUTURE');
    }
    const n = (await tx.completionCertificate.count({ where: { projectId } })) + 1;
    const certificateNumber = `COC-${project.codePrefix}-${String(n).padStart(2, '0')}`;
    const scopeSummary = input.scopeSummary ?? (await suggestedScope(tx, projectId, evaluation));
    const cert = await tx.completionCertificate.create({
      data: {
        projectId,
        certificateNumber,
        status: 'DRAFT',
        scopeSummary,
        completionDate: input.completionDate,
        finalEvaluationVisitId: evaluation?.visitId ?? null,
        slotsJson: config.cocSignatories as unknown as Prisma.InputJsonValue,
        createdByUserId: webUser.userId,
      },
    });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'COC_DRAFTED',
      summaryText: `Drafted Certificate of Completion ${certificateNumber} (completion ${input.completionDate}); ${config.cocSignatories.length} signatory slot(s).`,
      payload: {
        certificateId: cert.id,
        certificateNumber,
        completionDate: input.completionDate,
        finalEvaluationVisitId: evaluation?.visitId ?? null,
        slots: config.cocSignatories.map((s) => ({ key: s.key, label: s.label, isBeneficiary: s.isBeneficiary })),
      },
    });
  });
  return getProjectCompletion(projectId, webUser);
}

async function loadLiveCertificate(tx: Tx, projectId: string): Promise<CertRow> {
  const live = await tx.completionCertificate.findFirst({ where: { projectId, status: { in: [...LIVE_STATUSES] } }, select: { id: true } });
  if (!live) throw new AppError('The project has no Certificate of Completion', 404, 'COC_NOT_FOUND');
  await tx.$queryRaw`SELECT id FROM "completion_certificates" WHERE id = ${live.id}::uuid FOR UPDATE`;
  return tx.completionCertificate.findUniqueOrThrow({ where: { id: live.id }, include: CERT_INCLUDE });
}

/** PUT /projects/:projectId/completion/certificate: scope and date, while nobody has signed. */
export async function updateCompletionCertificate(projectId: string, webUser: WebJwtPayload, input: UpdateCompletionCertificateRequest) {
  await prisma.$transaction(async (tx) => {
    const cert = await loadLiveCertificate(tx, projectId);
    if (cert.status !== 'DRAFT') throw new AppError('Signing has started, so the certificate can no longer be edited. Revoke it to start again.', 409, 'COC_NOT_DRAFT');
    const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { timezone: true } });
    if (input.completionDate && input.completionDate > projectToday(project.timezone)) {
      throw new AppError('The completion date cannot be in the future.', 422, 'COMPLETION_DATE_IN_FUTURE');
    }
    await tx.completionCertificate.update({
      where: { id: cert.id },
      data: { scopeSummary: input.scopeSummary ?? cert.scopeSummary, completionDate: input.completionDate ?? cert.completionDate },
    });
  });
  return getProjectCompletion(projectId, webUser);
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

function staffStatementHash(cert: CertRow, slotKey: string, userId: string, statement: string) {
  const scopeHash = crypto.createHash('sha256').update(cert.scopeSummary).digest('hex');
  return crypto
    .createHash('sha256')
    .update(`${cert.id}|${cert.certificateNumber}|${cert.completionDate}|${scopeHash}|${slotKey}|${userId}|${statement}`)
    .digest('hex');
}

function findSlot(cert: CertRow, slotKey: string): CocSignatorySlot {
  const slot = slotsOf(cert).find((s) => s.key === slotKey);
  if (!slot) throw new AppError('No such signatory slot on this certificate', 404, 'COC_SLOT_NOT_FOUND');
  return slot;
}

function uniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** POST /projects/:projectId/completion/certificate/sign */
export async function signCompletionCertificate(projectId: string, webUser: WebJwtPayload, input: SignCompletionCertificateRequest) {
  try {
    await prisma.$transaction(async (tx) => {
      const cert = await loadLiveCertificate(tx, projectId);
      const slot = findSlot(cert, input.slotKey);
      if (slot.isBeneficiary) {
        throw new AppError("The beneficiary's slot is recorded from the signed paper copy.", 409, 'COC_BENEFICIARY_SLOT');
      }
      const parties = await partiesOf(tx, projectId);
      const refusal = staffSlotRefusal(cert, slot, webUser, parties);
      if (refusal) {
        const code = refusal.startsWith('You already signed') ? 'COC_ALREADY_SIGNED_ANOTHER_SLOT' : refusal.includes('already signed') ? 'COC_SLOT_SIGNED' : 'COC_CANNOT_SIGN';
        throw new AppError(refusal, code === 'COC_CANNOT_SIGN' ? 403 : 409, code);
      }
      const statement = input.statement ?? defaultCocStatement(cert.certificateNumber, slot.label);
      const statementHash = staffStatementHash(cert, slot.key, webUser.userId, statement);
      await tx.completionCertificateSignature.create({
        data: {
          certificateId: cert.id,
          slotKey: slot.key,
          slotLabel: slot.label,
          userId: webUser.userId,
          roleId: webUser.roleId,
          organizationId: webUser.organizationId,
          statement,
          statementHash,
        },
      });
      await recordAuditEvent(tx, {
        projectId,
        actorType: 'WEB_USER',
        actorId: webUser.userId,
        actorDisplayName: actorName(webUser),
        action: 'COC_SIGNED',
        summaryText: `Signed Certificate of Completion ${cert.certificateNumber} as "${slot.label}".`,
        payload: { certificateId: cert.id, slotKey: slot.key, statementHash },
      });
      await afterSignature(tx, projectId, cert.id, webUser);
    });
  } catch (error) {
    if (uniqueConflict(error)) throw new AppError('This slot was signed at the same time, or you already signed another slot.', 409, 'COC_SLOT_SIGNED');
    throw error;
  }
  return getProjectCompletion(projectId, webUser);
}

/** POST /projects/:projectId/completion/certificate/beneficiary (RECORDED_BY_STAFF) */
export async function recordBeneficiarySignature(projectId: string, webUser: WebJwtPayload, input: RecordBeneficiarySignatureRequest) {
  try {
    await prisma.$transaction(async (tx) => {
      const cert = await loadLiveCertificate(tx, projectId);
      const slot = findSlot(cert, input.slotKey);
      if (!slot.isBeneficiary) throw new AppError('This is not the beneficiary slot', 409, 'COC_NOT_BENEFICIARY_SLOT');
      const parties = await partiesOf(tx, projectId);
      const refusal = staffSlotRefusal(cert, slot, webUser, parties);
      if (refusal) throw new AppError(refusal, refusal.includes('needs') ? 403 : 409, refusal.includes('needs') ? 'COC_CANNOT_SIGN' : 'COC_SLOT_SIGNED');
      const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { tenantId: true } });
      const statement = input.statement ?? defaultBeneficiaryAttestation(cert.certificateNumber, input.beneficiaryName);
      const doc = await registerUploadedDocumentTx(tx, {
        projectId,
        tenantId: project.tenantId,
        typeCode: 'COMPLETION_CERTIFICATE',
        title: `${cert.certificateNumber} — beneficiary signed copy`,
        objectKey: input.objectKey,
        note: 'beneficiary signed copy',
        uploadedByUserId: webUser.userId,
        // R7: the recorder's attestation is the sign-off, so the register does not show the copy as awaiting one.
        signOff: { userId: webUser.userId, roleId: webUser.roleId, organizationId: webUser.organizationId, statement },
      });
      const statementHash = crypto
        .createHash('sha256')
        .update(`${cert.id}|${cert.certificateNumber}|${slot.key}|beneficiary|${input.beneficiaryName}|${doc.sha256}|${webUser.userId}|${statement}`)
        .digest('hex');
      await tx.completionCertificateSignature.create({
        data: {
          certificateId: cert.id,
          slotKey: slot.key,
          slotLabel: slot.label,
          isBeneficiary: true,
          beneficiaryName: input.beneficiaryName,
          beneficiaryRole: input.beneficiaryRole,
          evidenceDocumentId: doc.documentId,
          recordedByUserId: webUser.userId,
          statement,
          statementHash,
        },
      });
      await recordAuditEvent(tx, {
        projectId,
        actorType: 'WEB_USER',
        actorId: webUser.userId,
        actorDisplayName: actorName(webUser),
        action: 'COC_SIGNED',
        summaryText: `Recorded the beneficiary's signature on ${cert.certificateNumber}: ${input.beneficiaryName} (${input.beneficiaryRole}), signed paper copy filed and attested.`,
        payload: { certificateId: cert.id, slotKey: slot.key, beneficiary: true, evidenceDocumentId: doc.documentId, evidenceSha256: doc.sha256, statementHash },
      });
      await afterSignature(tx, projectId, cert.id, webUser);
    });
  } catch (error) {
    if (uniqueConflict(error)) throw new AppError('This slot was signed at the same time.', 409, 'COC_SLOT_SIGNED');
    throw error;
  }
  return getProjectCompletion(projectId, webUser);
}

/** First signature: PENDING_SIGNATURES. Last: issue. */
async function afterSignature(tx: Tx, projectId: string, certificateId: string, webUser: WebJwtPayload) {
  const cert = await tx.completionCertificate.findUniqueOrThrow({ where: { id: certificateId }, include: CERT_INCLUDE });
  const slots = slotsOf(cert);
  const signed = new Set(cert.signatures.map((s) => s.slotKey));
  if (slots.every((s) => signed.has(s.key))) {
    await issueCertificate(tx, projectId, cert, webUser);
  } else if (cert.status === 'DRAFT') {
    await tx.completionCertificate.update({ where: { id: cert.id }, data: { status: 'PENDING_SIGNATURES' } });
  }
}

// ---------------------------------------------------------------------------
// Issuing
// ---------------------------------------------------------------------------

export async function brandingFor(db: Db, projectId: string): Promise<PdfBranding & { terminologyLabels: unknown }> {
  const p = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { timezone: true, tenant: { select: { name: true, brandingConfig: true, terminologyLabels: true } } },
  });
  const branding = parseTenantBranding(p.tenant.brandingConfig);
  return {
    tenantName: p.tenant.name,
    headerTitle: branding.pdfHeaderTitle || undefined,
    footerDisclaimer: branding.pdfFooterDisclaimer || undefined,
    primaryColorHex: branding.primaryColorHex || undefined,
    timeZone: p.timezone,
    terminologyLabels: p.tenant.terminologyLabels,
  };
}

/** Renders the certificate (draft or issued) from the database. */
export async function renderCertificatePdf(db: Db, projectId: string, cert: CertRow): Promise<Buffer> {
  const [project, branding, dtos] = await Promise.all([
    db.project.findUniqueOrThrow({
      where: { id: projectId },
      select: {
        codePrefix: true,
        name: true,
        stateLocation: true,
        lgaLocation: true,
        contractReference: true,
        owningOrganization: { select: { name: true } },
        lenderOrganization: { select: { name: true } },
        monitorOrganization: { select: { name: true } },
        beneficiaries: { where: { isPrimary: true }, select: { name: true }, take: 1 },
        contractors: { orderBy: [{ createdAt: 'asc' }], select: { contractStatus: true, organization: { select: { name: true } } } },
      },
    }),
    brandingFor(db, projectId),
    serializeCertificates(db, [cert], null, null),
  ]);
  const terms = resolveTerminology(branding.terminologyLabels);
  const evaluation = cert.finalEvaluationVisitId
    ? await db.visitSubmission
        .findFirst({
          where: { visitId: cert.finalEvaluationVisitId, status: 'APPROVED' },
          select: { overallFinding: true, reporterName: true, visit: { select: { plannedDate: true } } },
        })
        .then((s) => (s ? { visitDate: s.visit.plannedDate, overallFinding: s.overallFinding as string, reporterName: s.reporterName } : null))
    : null;
  const dto = dtos[0];
  return generateCompletionCertificatePdf({
    branding,
    issued: cert.status === 'ISSUED',
    certificateNumber: cert.certificateNumber,
    status: cert.status,
    project: {
      code: project.codePrefix,
      name: project.name,
      location: [project.lgaLocation, project.stateLocation].filter(Boolean).join(', ') || null,
      contractReference: project.contractReference,
    },
    parties: [
      { label: 'Owning organisation', name: project.owningOrganization?.name ?? null },
      { label: resolveTerm(terms, 'funderParty'), name: project.lenderOrganization?.name ?? null },
      { label: resolveTerm(terms, 'monitorParty'), name: project.monitorOrganization?.name ?? null },
    ],
    beneficiaryName: project.beneficiaries[0]?.name ?? null,
    contractors: project.contractors.map((c) => `${c.organization.name}${c.contractStatus === 'TERMINATED' ? ' (terminated)' : ''}`),
    completionDate: cert.completionDate,
    scopeSummary: cert.scopeSummary,
    finalEvaluation: evaluation
      ? `Final evaluation of ${evaluation.visitDate} by ${evaluation.reporterName}: ${evaluation.overallFinding.replace('_', ' ').toLowerCase()}.`
      : null,
    issuedAtIso: cert.issuedAt?.toISOString() ?? null,
    slots: dto.slots.map((s) => ({
      label: s.label,
      signed: s.signature
        ? {
            name: s.signature.signerName,
            roleName: s.signature.isBeneficiary ? s.signature.beneficiaryRole : s.signature.roleName,
            organizationName: s.signature.isBeneficiary ? project.beneficiaries[0]?.name ?? null : s.signature.organizationName,
            signedAtIso: s.signature.signedAt,
            statement: s.signature.statement,
            statementHash: s.signature.statementHash,
            recordedBy: s.signature.recordedByName,
          }
        : null,
    })),
  });
}

async function issueCertificate(tx: Tx, projectId: string, cert: CertRow, webUser: WebJwtPayload) {
  const now = new Date();
  const project = await tx.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      tenantId: true,
      timezone: true,
      practicalCompletionDate: true,
      projectTypeSnapshotJson: true,
      owningOrganizationId: true,
      monitorOrganizationId: true,
      contractors: { select: { organizationId: true } },
    },
  });
  const config = closureConfigOf(project.projectTypeSnapshotJson);
  await tx.completionCertificate.update({ where: { id: cert.id }, data: { status: 'ISSUED', issuedAt: now } });
  const issued = await tx.completionCertificate.findUniqueOrThrow({ where: { id: cert.id }, include: CERT_INCLUDE });
  const pdf = await renderCertificatePdf(tx, projectId, issued);
  const stored = await storeGeneratedDocument(tx, {
    projectId,
    tenantId: project.tenantId,
    typeCode: 'COMPLETION_CERTIFICATE',
    title: `Certificate of Completion ${cert.certificateNumber}`,
    file: { body: pdf, mimeType: 'application/pdf', extension: 'pdf' },
    uploadedByUserId: webUser.userId,
    note: 'Issued certificate (generated when the last signatory signed)',
    // The staff signatories genuinely signed what this PDF shows.
    signOffs: issued.signatures
      .filter((s) => s.userId)
      .map((s) => ({ userId: s.userId!, roleId: s.roleId, organizationId: s.organizationId, statement: s.statement })),
  });
  await tx.completionCertificate.update({ where: { id: cert.id }, data: { documentId: stored.documentId } });

  const practicalSet = !project.practicalCompletionDate;
  if (practicalSet) await tx.project.update({ where: { id: projectId }, data: { practicalCompletionDate: cert.completionDate } });

  // The handover ceremony: the type's milestone anchored on the CoC, or one created now.
  const anchored = await tx.projectContractMilestone.count({ where: { projectId, anchor: 'COC_ISSUED' } });
  if (!anchored) {
    await tx.projectContractMilestone.create({
      data: {
        projectId,
        key: HANDOVER_CEREMONY_MILESTONE_KEY,
        label: 'Handover ceremony held',
        description: 'A formal handover to the beneficiary, due after the Certificate of Completion is issued. Done when an accepted handover response is reviewed.',
        anchor: 'COC_ISSUED',
        offsetValue: config.handoverDueDaysAfterCoc,
        offsetUnit: 'CALENDAR_DAYS',
        completionMode: 'AUTO_HANDOVER_ACCEPTED',
        responsibleOrganizationScope: 'PROJECT_OWNER',
        sortOrder: 9000,
      },
    });
  }
  await recomputeMilestoneDates(tx, projectId, now);
  const actor = webActor(webUser);
  await autoCompleteMilestones(tx, {
    projectId,
    mode: 'AUTO_COC_ISSUED',
    at: now,
    notes: `Certificate of Completion ${cert.certificateNumber} issued.`,
    actor,
  });
  // A handover already accepted before the certificate (unusual) completes the ceremony at once.
  const accepted = await acceptedReviewedHandover(tx, projectId);
  if (accepted) {
    await autoCompleteMilestones(tx, { projectId, mode: 'AUTO_HANDOVER_ACCEPTED', onlyDated: true, at: now, notes: 'Handover already accepted.', actor });
  }
  const ceremony = await tx.projectContractMilestone.findFirst({ where: { projectId, anchor: 'COC_ISSUED' }, orderBy: { sortOrder: 'asc' } });

  await recordAuditEvent(tx, {
    projectId,
    actorType: 'WEB_USER',
    actorId: webUser.userId,
    actorDisplayName: actorName(webUser),
    action: 'COC_ISSUED',
    summaryText:
      `Issued Certificate of Completion ${cert.certificateNumber} (completion ${cert.completionDate}) after ${issued.signatures.length} signature(s)` +
      (practicalSet ? `; practical completion set to ${cert.completionDate}` : '') +
      (ceremony?.dueDate ? `; handover ceremony due ${ceremony.dueDate}.` : '.'),
    payload: {
      certificateId: cert.id,
      certificateNumber: cert.certificateNumber,
      documentId: stored.documentId,
      sha256: stored.sha256,
      signatures: issued.signatures.map((s) => ({ slotKey: s.slotKey, userId: s.userId, beneficiary: s.isBeneficiary, statementHash: s.statementHash })),
      practicalCompletionDate: practicalSet ? cert.completionDate : null,
      handoverCeremonyDue: ceremony?.dueDate ?? null,
    },
  });

  // Owner organisation, monitor and contractors.
  const targets = new Set<string>(
    [project.owningOrganizationId, project.monitorOrganizationId, ...project.contractors.map((c) => c.organizationId)].filter((v): v is string => Boolean(v))
  );
  for (const organizationId of targets) {
    await createWebNotification(tx, {
      projectId,
      targetPermissionKey: 'projects:view_assigned',
      targetOrganizationId: organizationId,
      category: 'COMPLETION_CERTIFICATE',
      title: `Certificate of Completion ${cert.certificateNumber} issued`,
      description: `Completion date ${cert.completionDate}.${ceremony?.dueDate ? ` The handover ceremony is due by ${ceremony.dueDate}.` : ''}`,
      actionUrl: `/app/projects/${projectId}/completion?tab=certificate`,
      metadata: { certificateId: cert.id, documentId: stored.documentId },
    });
  }
}

// ---------------------------------------------------------------------------
// Revoking
// ---------------------------------------------------------------------------

/** POST /projects/:projectId/completion/certificate/revoke */
export async function revokeCompletionCertificate(projectId: string, webUser: WebJwtPayload, reason: string) {
  await prisma.$transaction(async (tx) => {
    await lockProject(tx, projectId);
    const cert = await loadLiveCertificate(tx, projectId);
    if (await acceptedReviewedHandover(tx, projectId)) {
      throw new AppError('The handover has been accepted, so the certificate can no longer be revoked.', 409, 'COC_REVOKE_AFTER_HANDOVER');
    }
    const now = new Date();
    await tx.completionCertificate.update({
      where: { id: cert.id },
      data: { status: 'REVOKED', revokedAt: now, revokedReason: reason, revokedByUserId: webUser.userId },
    });
    if (cert.documentId) {
      await tx.projectDocument.update({ where: { id: cert.documentId }, data: { isArchived: true, archivedReason: `Certificate revoked: ${reason}` } });
    }
    const actor = webActor(webUser);
    const reopened =
      cert.status === 'ISSUED'
        ? await reopenMilestones(tx, { projectId, mode: 'AUTO_COC_ISSUED', reason: `Certificate ${cert.certificateNumber} revoked: ${reason}`, actor })
        : 0;
    // Milestones anchored on the certificate lose their date until a new one is issued.
    await recomputeMilestoneDates(tx, projectId, now);
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'COC_REVOKED',
      summaryText: `Revoked Certificate of Completion ${cert.certificateNumber} (${cert.status.toLowerCase().replace('_', ' ')}): ${reason}`,
      payload: { certificateId: cert.id, previousStatus: cert.status, reason, reopenedMilestones: reopened },
    });
    if (cert.status === 'ISSUED') {
      await createWebNotification(tx, {
        projectId,
        targetPermissionKey: 'projects:view_assigned',
        hideFromProjectContractors: true,
        category: 'COMPLETION_CERTIFICATE',
        title: `Certificate of Completion ${cert.certificateNumber} revoked`,
        description: reason,
        actionUrl: `/app/projects/${projectId}/completion?tab=certificate`,
        metadata: { certificateId: cert.id },
      });
    }
  });
  return getProjectCompletion(projectId, webUser);
}

/** GET .../completion/certificate/pdf: the issued PDF from the register, or a draft rendered now. */
export async function completionCertificatePdf(projectId: string): Promise<{ body: Buffer; fileName: string }> {
  const cert = await prisma.completionCertificate.findFirst({
    where: { projectId, status: { in: [...LIVE_STATUSES] } },
    include: { ...CERT_INCLUDE, document: { include: { versions: { orderBy: { version: 'desc' }, take: 1 } } } },
  });
  if (!cert) throw new AppError('The project has no Certificate of Completion', 404, 'COC_NOT_FOUND');
  const stored = cert.status === 'ISSUED' ? cert.document?.versions[0] : undefined;
  if (stored) {
    const body = await storageService.getObjectBuffer(stored.objectKey);
    if (body) return { body, fileName: `${cert.certificateNumber}.pdf` };
  }
  return { body: await renderCertificatePdf(prisma, projectId, cert), fileName: `${cert.certificateNumber}-draft.pdf` };
}

/** The issue date of the current certificate in the project zone (handover certificate, pack). */
export async function issuedCertificateSummary(db: Db, projectId: string) {
  const cert = await issuedCertificate(db, projectId);
  if (!cert) return null;
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { timezone: true } });
  return { id: cert.id, number: cert.certificateNumber, issuedAt: cert.issuedAt, issuedDate: cert.issuedAt ? zonedCalendarDate(cert.issuedAt, p.timezone) : null, documentId: cert.documentId };
}
