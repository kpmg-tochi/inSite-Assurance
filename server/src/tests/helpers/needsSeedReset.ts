/**
 * Needs pipeline wave 5 (N9): the normal seed now holds cycles (closed history cycles with the seeded
 * projects' converted proposals, the open Direct Intervention cycle, the open Kano Matching Grants
 * cycle, an out-of-cycle request; see `db/seedNeedsPipeline.ts`). Tests that open their own cycles
 * (unique per tenant, programme, year and scope) call this first, in `before()` right after
 * `resetTestDatabase()`, to start from the wave 4 state: programme rules and the costing standard stay
 * (unlocked again, as before any cycle opened); every cycle, proposal and what hangs off them goes; the
 * seeded projects that had a proposal are LEGACY again (their proposal link goes through the foreign key).
 *
 * The tenant ledger keeps the seed's pipeline entries (a hash chain is never cut): a test that counts
 * pipeline entries tenant-wide adds `seq: { gt: ledgerFloor }` with the floor this returns.
 */
type PrismaClientType = typeof import('../../config/prisma')['prisma'];

export async function clearSeededNeedsPipeline(prisma: PrismaClientType): Promise<{ ledgerFloor: bigint }> {
  await prisma.project.updateMany({ where: { needsProposalId: { not: null } }, data: { origin: 'LEGACY' } });
  await prisma.needsVerificationCapture.deleteMany();
  await prisma.needsVerificationSubmission.deleteMany();
  await prisma.needsVerification.deleteMany();
  await prisma.needsApprovalAction.deleteMany();
  await prisma.needsApprovalStep.deleteMany();
  await prisma.needsFundingRecord.deleteMany();
  await prisma.needsSubmissionItem.deleteMany();
  await prisma.needsSubmission.deleteMany();
  await prisma.needsScoreSheet.deleteMany();
  await prisma.needsCommitteeMember.deleteMany();
  await prisma.needsStageDecisionItem.deleteMany();
  await prisma.needsStageDecision.deleteMany();
  await prisma.needsValidationRecord.deleteMany();
  await prisma.needsProposalFlag.deleteMany();
  await prisma.needsProposalDocument.deleteMany();
  await prisma.needsFacilityBreakdownRow.deleteMany();
  await prisma.needsProposalSite.deleteMany();
  await prisma.needsProposal.updateMany({ data: { carriedFromId: null, mergedIntoId: null, currentVersionId: null } });
  await prisma.needsAssessmentVersion.deleteMany();
  await prisma.needsProposal.deleteMany();
  await prisma.needsCycleDocument.deleteMany();
  await prisma.needsCycle.deleteMany();
  await prisma.costingStandardVersion.updateMany({ data: { isLocked: false } });
  const last = await prisma.auditLog.aggregate({ _max: { seq: true } });
  return { ledgerFloor: last._max.seq ?? BigInt(0) };
}
