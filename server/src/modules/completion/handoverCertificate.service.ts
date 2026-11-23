import { Prisma } from '@prisma/client';
import { HANDOVER_DECISION_LABELS } from '@insite/shared';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { storeGeneratedDocument } from '../documents/documents.service';
import { autoCompleteMilestones, webActor } from '../contracts/milestones.service';
import { generateHandoverCertificatePdf } from '../../integrations/closure-pdf.service';
import { brandingFor, issuedCertificate } from './completion.service';

type Tx = Prisma.TransactionClient;

/**
 * Phase 15 Step 4: reviewing an accepted handover response issues the handover certificate
 * (HANDOVER_CERTIFICATE in the register, signed off by the reviewer) and completes the handover
 * ceremony milestone. Called inside the review transaction.
 */
export async function issueHandoverCertificate(tx: Tx, projectId: string, submissionId: string, webUser: WebJwtPayload) {
  const s = await tx.handoverSubmission.findUniqueOrThrow({ where: { id: submissionId } });
  if (s.decision !== 'ACCEPTED' && s.decision !== 'ACCEPTED_WITH_SNAGS') return null;
  const project = await tx.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      tenantId: true,
      codePrefix: true,
      name: true,
      stateLocation: true,
      lgaLocation: true,
      beneficiaries: { where: { isPrimary: true }, select: { name: true }, take: 1 },
    },
  });
  const coc = await issuedCertificate(tx, projectId);
  const snagCount = Array.isArray(s.snagsJson) ? s.snagsJson.length : 0;
  const reviewedAt = s.reviewedAt ?? new Date();
  const pdf = await generateHandoverCertificatePdf({
    branding: await brandingFor(tx, projectId),
    project: { code: project.codePrefix, name: project.name, location: [project.lgaLocation, project.stateLocation].filter(Boolean).join(', ') || null },
    beneficiaryName: project.beneficiaries[0]?.name ?? null,
    submitterName: s.submitterName,
    submitterRole: s.submitterRole,
    decision: HANDOVER_DECISION_LABELS[s.decision],
    submittedAtIso: s.submittedAt.toISOString(),
    reviewedAtIso: reviewedAt.toISOString(),
    reviewedByName: `${webUser.fullName} (${webUser.roleName})`,
    reviewNotes: s.reviewNotes,
    snagCount,
    cocNumber: coc?.certificateNumber ?? null,
    cocIssuedAtIso: coc?.issuedAt?.toISOString() ?? null,
  });
  const statement = `I reviewed the handover response of ${s.submitterName} (${HANDOVER_DECISION_LABELS[s.decision].toLowerCase()}) and confirm this handover certificate.`;
  const stored = await storeGeneratedDocument(tx, {
    projectId,
    tenantId: project.tenantId,
    typeCode: 'HANDOVER_CERTIFICATE',
    title: `Handover certificate ${project.codePrefix}`,
    file: { body: pdf, mimeType: 'application/pdf', extension: 'pdf' },
    uploadedByUserId: webUser.userId,
    note: `Generated from the reviewed handover response of ${s.submitterName}`,
    signOffs: [{ userId: webUser.userId, roleId: webUser.roleId, organizationId: webUser.organizationId, statement }],
  });
  const completed = await autoCompleteMilestones(tx, {
    projectId,
    mode: 'AUTO_HANDOVER_ACCEPTED',
    at: reviewedAt,
    notes: `Handover accepted by ${s.submitterName} (${s.submitterRole}); handover certificate issued.`,
    actor: webActor(webUser),
  });
  await recordAuditEvent(tx, {
    projectId,
    actorType: 'WEB_USER',
    actorId: webUser.userId,
    actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
    action: 'HANDOVER_CERTIFICATE_ISSUED',
    summaryText:
      `Issued the handover certificate: ${s.submitterName} ${HANDOVER_DECISION_LABELS[s.decision].toLowerCase()}, ${snagCount} snag(s)` +
      (coc ? `, under ${coc.certificateNumber}.` : ' (no Certificate of Completion issued).'),
    payload: { handoverSubmissionId: s.id, documentId: stored.documentId, sha256: stored.sha256, snagCount, certificateId: coc?.id ?? null, completedMilestones: completed },
  });
  return stored.documentId;
}
