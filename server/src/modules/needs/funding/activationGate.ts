import { Prisma } from '@prisma/client';
import { resolveProjectTypeConfig } from '@insite/shared';
import { AppError } from '../../../middleware/error.middleware';
import { cycleConfig } from '../needsSupport';

/**
 * Needs pipeline wave 4 (B5, D-N.13, A5): what activation needs from a project's origin. Called by
 * `activateProject` inside its transaction, before the setup checks.
 *
 * - Origin (409 PROJECT_ORIGIN_REQUIRED): a draft whose programme runs the needs pipeline (the type
 *   snapshot's `needsPipeline.enabled`) needs an origin: a converted proposal (NEEDS_PIPELINE), an
 *   approved out-of-cycle request (OUT_OF_CYCLE), the register import (REGISTER_IMPORT) or LEGACY.
 *   Programmes without the pipeline have no way to give an origin, so they are not gated (wave 4
 *   decision).
 * - Counterpart (409 COUNTERPART_EVIDENCE_REQUIRED): a project converted from a proposal whose cycle
 *   froze `requireCounterpartEvidenceBeforeActivation` needs the counterpart evidence recorded on the
 *   approved BEAP that funded it. Only annual proposals are funded through a BEAP: an out-of-cycle
 *   request has no BEAP to carry the evidence, so it is not gated on it (wave 4 decision B-12).
 */
export async function assertActivationOrigin(tx: Prisma.TransactionClient, projectId: string): Promise<void> {
  const project = await tx.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      origin: true,
      projectTypeSnapshotJson: true,
      needsProposal: { select: { id: true, reference: true, route: true, cycle: { select: { id: true, configSnapshotJson: true } } } },
    },
  });
  const typeConfig = resolveProjectTypeConfig(project.projectTypeSnapshotJson);
  if (!project.origin && typeConfig?.needsPipeline.enabled) {
    throw new AppError(
      'This project has no origin: a project of this programme goes live only from a funded proposed project or an approved out-of-cycle request.',
      409,
      'PROJECT_ORIGIN_REQUIRED'
    );
  }
  const proposal = project.needsProposal;
  if (!proposal || proposal.route !== 'ANNUAL') return;
  if (!cycleConfig(proposal.cycle).requireCounterpartEvidenceBeforeActivation) return;
  const beap = await tx.needsSubmission.findFirst({
    where: { cycleId: proposal.cycle.id, kind: 'BEAP', status: 'APPROVED', items: { some: { proposalId: proposal.id, included: true } } },
    orderBy: { decidedAt: 'desc' },
    select: { counterpartEvidenceDocumentId: true },
  });
  if (!beap?.counterpartEvidenceDocumentId) {
    throw new AppError(
      `The State's counterpart funding evidence is not recorded on the BEAP that funded ${proposal.reference}. Record it on the cycle's BEAP before activating.`,
      409,
      'COUNTERPART_EVIDENCE_REQUIRED'
    );
  }
}
