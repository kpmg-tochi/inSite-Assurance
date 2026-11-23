import { Prisma } from '@prisma/client';
import {
  DirectMilestoneSuggestionDto,
  DirectMilestoneValuationDto,
  evaluateMilestoneCompletion,
  fixedMilestoneDue,
  MilestonePaymentTerms,
  MilestonePaymentTermsSchema,
  MilestoneVerificationLine,
  resolveRatingLabels,
  resolveTerminology,
  VerifyDirectMilestoneRequest,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { hasWebPermission, WebJwtPayload } from '../../middleware/auth.middleware';
import { generateValuationReportPdfBuffer } from '../../integrations/pdf-report.service';
import { parseTenantBranding } from '../rbac/rbac.service';
import { recordAuditEvent } from '../audit/audit.service';
import { getEvidenceForBoqItems } from '../evidence/evidenceProvider';
import { getProcessConfig } from '../process/processConfig.service';
import { contractorHeadline } from '../projects/contractors.service';
import { loadTrancheInProject, loadValuationReportInProject } from '../../utils/ownership';
import { serializeTrancheDecision, serializeValuationReport } from '../../utils/serializers';
import { normalizeUnit } from './reconciliationEngine';
import { refreshCertifiedProgress } from './reconciliation.service';
import { releaseGate, reviewGate, startValuationOnChain, valuationProgress } from './disbursementChain';
import { assertConstructionOngoing } from '../closeout/closeoutGate';
import { pdfReleaseDecision } from '../closeout/retention.service';
import { assertCertifierCredentials, credentialPolicyForProject } from '../credentials/credentialPolicy.service';

/**
 * Direct milestone release (Phase 7 Step 6): release against a verified milestone with no
 * contractor claim. The system builds the claim from verified progress (evidence provider
 * quantities, bounded like a certification); a licensed verifier certifies each item's cumulative
 * percentage, and the valuation then follows the same disbursement chain, bounds, CP and
 * segregation rules as an IPC valuation.
 */

type Tx = Prisma.TransactionClient;

const VERIFY = 'milestone:verify_direct_release';
const NGN_EPSILON = 0.005;
const roundNgn = (n: number) => Math.round(n * 100) / 100;
const roundPct = (n: number) => Math.round(n * 100) / 100;
const fmtNgn = (n: number) =>
  `NGN ${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function assertDirectMode(projectId: string) {
  const config = await getProcessConfig(projectId);
  if (config.disbursementMechanism !== 'MILESTONE_DIRECT_DISBURSEMENT') {
    throw new AppError(
      'This project releases money against contractor IPCs; direct milestone verification is off.',
      409,
      'DISBURSEMENT_MODE_IS_IPC'
    );
  }
  return config;
}

/** Evidence-derived cumulative percentage per BOQ item of a tranche (counted reports only). */
async function evidenceForTranche(db: Tx | typeof prisma, projectId: string, trancheId: string) {
  // Phase 13: items of a terminated contractor are not verified until they move to a replacement.
  const items = await db.boqItem.findMany({
    where: { projectId, trancheId, OR: [{ projectContractorId: null }, { projectContractor: { contractStatus: 'ACTIVE' } }] },
    orderBy: { wbsCode: 'asc' },
  });
  const evidence = await getEvidenceForBoqItems(projectId, items.map((i) => i.id), new Date(), db);
  return items.map((item) => {
    const unit = normalizeUnit(item.unit);
    // Usable evidence only: integrity passed and not outside the site.
    const usable = evidence.filter((e) => e.boqItemId === item.id && e.integrityPassed && e.isWithinGeofence !== false);
    const quantity = usable.reduce(
      (sum, e) => sum + e.quantities.filter((q) => normalizeUnit(q.unit) === unit).reduce((s, q) => s + q.quantity, 0),
      0
    );
    const total = Number(item.totalQuantity);
    const previous = Number(item.cumulativeCertifiedPct);
    const derived = total > 0 ? roundPct(Math.min(100, (quantity / total) * 100)) : 0;
    return {
      item,
      evidenceQuantity: quantity,
      evidenceReportCount: usable.length,
      previousCertifiedPct: previous,
      evidenceDerivedPct: derived,
      maxVerifiablePct: Math.max(previous, derived),
    };
  });
}

async function openDirectValuation(db: Tx | typeof prisma, trancheId: string) {
  const candidates = await db.valuationReport.findMany({
    where: { trancheId, source: 'MILESTONE_DIRECT', supersededAt: null },
    include: { trancheDecisions: true },
    orderBy: { certifiedAt: 'desc' },
  });
  return (
    candidates.find(
      (v) => !v.trancheDecisions.some((d) => !d.reversesDecisionId && !v.trancheDecisions.some((o) => o.reversesDecisionId === d.id))
    ) ?? null
  );
}

type TrancheTermsRow = {
  paymentBasis: string;
  completionRule: string | null;
  completionContractMilestoneKey: string | null;
  completionRequiredItemPct: Prisma.Decimal;
  targetCompletionPct: Prisma.Decimal;
  fixedReleaseAmountNgn: Prisma.Decimal | null;
  allocatedAmountNgn: Prisma.Decimal;
  releasedAmountNgn: Prisma.Decimal;
};

type EvidenceRow = Awaited<ReturnType<typeof evidenceForTranche>>[number];

/**
 * Phase 12: the payment terms of a tranche evaluated against per-item verified percentages. The
 * measured basis does not judge completion.
 */
/**
 * Phase 13: what the completion of a payment milestone also depends on: the contract milestone its
 * rule names (CONTRACT_MILESTONE_DONE), and items of a terminated contractor not fully certified
 * (they cannot be verified until moved to a replacement, so an item rule cannot be met).
 */
interface TermsExtras {
  contractMilestone: { label: string; done: boolean } | null;
  blockedWbsCodes: string[];
}

async function termsExtrasFor(db: Tx | typeof prisma, projectId: string, tranche: { id: string; completionRule: string | null; completionContractMilestoneKey: string | null }): Promise<TermsExtras> {
  let contractMilestone: TermsExtras['contractMilestone'] = null;
  if (tranche.completionRule === 'CONTRACT_MILESTONE_DONE' && tranche.completionContractMilestoneKey) {
    const rows = await db.projectContractMilestone.findMany({
      where: { projectId, key: tranche.completionContractMilestoneKey },
      select: { label: true, status: true },
    });
    // Per-contractor milestones: done when every contractor's row is done or waived.
    if (rows.length) contractMilestone = { label: rows[0].label, done: rows.every((r) => r.status === 'DONE' || r.status === 'WAIVED') };
  }
  const blocked = await db.boqItem.findMany({
    where: { projectId, trancheId: tranche.id, projectContractor: { contractStatus: 'TERMINATED' }, cumulativeCertifiedPct: { lt: 100 } },
    select: { wbsCode: true },
  });
  return { contractMilestone, blockedWbsCodes: blocked.map((b) => b.wbsCode) };
}

function paymentTermsFor(tranche: TrancheTermsRow, rows: EvidenceRow[], verifiedPct: (row: EvidenceRow) => number, extras: TermsExtras): MilestonePaymentTerms {
  const fixed = tranche.paymentBasis === 'FIXED_ON_COMPLETION';
  const completionRule = fixed ? ((tranche.completionRule ?? 'ALL_ITEMS_COMPLETE') as MilestonePaymentTerms['completionRule']) : null;
  const evaluated = evaluateMilestoneCompletion({
    rule: completionRule,
    contractMilestone: extras.contractMilestone,
    requiredItemPct: Number(tranche.completionRequiredItemPct),
    targetCompletionPct: Number(tranche.targetCompletionPct),
    items: rows.map((r) => ({
      boqItemId: r.item.id,
      wbsCode: r.item.wbsCode,
      budgetedCostNgn: Number(r.item.budgetedCostNgn),
      verifiedCumulativePct: verifiedPct(r),
    })),
  });
  const itemRule = completionRule === 'ALL_ITEMS_COMPLETE' || completionRule === 'WEIGHTED_PROGRESS_REACHED';
  const completion =
    itemRule && extras.blockedWbsCodes.length
      ? {
          ...evaluated,
          met: false,
          unmetReasons: [
            ...evaluated.unmetReasons,
            `Items of a terminated contractor are not fully certified (${extras.blockedWbsCodes.join(', ')}); move them to the replacement first.`,
          ],
        }
      : evaluated;
  const due = fixedMilestoneDue({
    fixedReleaseAmountNgn: tranche.fixedReleaseAmountNgn === null ? null : Number(tranche.fixedReleaseAmountNgn),
    allocatedAmountNgn: Number(tranche.allocatedAmountNgn),
    releasedAmountNgn: Number(tranche.releasedAmountNgn),
  });
  return {
    paymentBasis: fixed ? 'FIXED_ON_COMPLETION' : 'MEASURED',
    completionRule,
    completionRequiredItemPct: fixed && completionRule === 'ALL_ITEMS_COMPLETE' ? Number(tranche.completionRequiredItemPct) : null,
    targetCompletionPct: Number(tranche.targetCompletionPct),
    completionMet: fixed ? completion.met : null,
    unmetReasons: fixed ? completion.unmetReasons : [],
    weightedProgressPct: completion.weightedProgressPct,
    fixedReleaseAmountNgn: fixed ? due.fixedReleaseAmountNgn : null,
    alreadyReleasedNgn: due.alreadyReleasedNgn,
  };
}

export async function getDirectMilestoneSuggestion(projectId: string, trancheId: string): Promise<DirectMilestoneSuggestionDto> {
  const config = await assertDirectMode(projectId);
  const tranche = await loadTrancheInProject(prisma, projectId, trancheId);
  const [rows, open] = await Promise.all([evidenceForTranche(prisma, projectId, trancheId), openDirectValuation(prisma, trancheId)]);
  // Completion as it would stand if every item were verified at the most the evidence supports.
  const terms = paymentTermsFor(tranche, rows, (r) => r.maxVerifiablePct, await termsExtrasFor(prisma, projectId, tranche));
  return {
    trancheId,
    trancheName: tranche.name,
    openValuationId: open?.id ?? null,
    paymentBasis: terms.paymentBasis,
    completionRule: terms.completionRule,
    completionRequiredItemPct: Number(tranche.completionRequiredItemPct),
    targetCompletionPct: terms.targetCompletionPct,
    completionMet: terms.completionMet,
    unmetReasons: terms.unmetReasons,
    weightedProgressPct: terms.weightedProgressPct ?? 0,
    fixedReleaseAmountNgn: terms.fixedReleaseAmountNgn,
    alreadyReleasedNgn: terms.alreadyReleasedNgn,
    items: rows.map((r) => ({
      boqItemId: r.item.id,
      wbsCode: r.item.wbsCode,
      description: r.item.description,
      unit: r.item.unit,
      totalQuantity: Number(r.item.totalQuantity),
      budgetedCostNgn: Number(r.item.budgetedCostNgn),
      previousCertifiedPct: r.previousCertifiedPct,
      evidenceQuantity: r.evidenceQuantity,
      evidenceReportCount: r.evidenceReportCount,
      evidenceDerivedPct: r.evidenceDerivedPct,
      maxVerifiablePct: r.maxVerifiablePct,
      isHoldPoint: config.enableHoldPoints && r.item.isHoldPoint,
    })),
  };
}

class DryRun extends Error {
  constructor(readonly result: unknown) {
    super('dry run');
  }
}

/** POST /projects/:projectId/milestones/direct-verify */
export async function verifyDirectMilestone(params: {
  projectId: string;
  webUser: WebJwtPayload;
  input: VerifyDirectMilestoneRequest;
}) {
  const { projectId, webUser, input } = params;
  // D-3.1: held through a role, never by bypass.
  if (!webUser.permissions.includes(VERIFY)) {
    throw new AppError(`This action requires the ${VERIFY} permission on your role`, 403, 'FORBIDDEN_PERMISSION');
  }
  await assertDirectMode(projectId);
  await assertConstructionOngoing(projectId, 'milestone verifications');

  try {
    return await prisma.$transaction(async (tx) => {
      await loadTrancheInProject(tx, projectId, input.trancheId);
      await tx.$queryRaw`SELECT id FROM "FacilityTranche" WHERE id = ${input.trancheId}::uuid FOR UPDATE`;
      const tranche = await tx.facilityTranche.findUniqueOrThrow({ where: { id: input.trancheId } });
      if (tranche.isReleased) throw new AppError('This tranche has been fully released', 409, 'TRANCHE_FULLY_RELEASED');
      const open = await openDirectValuation(tx, tranche.id);
      if (open) {
        throw new AppError(
          'A verification on this tranche is still going through approval. Finish or return it first.',
          409,
          'TRANCHE_HAS_OPEN_VERIFICATION',
          { valuationReportId: open.id }
        );
      }

      // Phase 12: the project's certifier policy decides whether a registration is needed and copied.
      const certifier = await assertCertifierCredentials(tx, {
        userId: webUser.userId,
        tenantId: webUser.tenantId,
        requirement: (await credentialPolicyForProject(projectId, tx)).certifier,
        verb: 'verifying',
      });

      const rows = await evidenceForTranche(tx, projectId, tranche.id);
      const byId = new Map(rows.map((r) => [r.item.id, r]));
      let totalClaimed = 0;
      let totalVerified = 0;
      const lines: MilestoneVerificationLine[] = input.lineVerifications.map((v) => {
        const row = byId.get(v.boqItemId);
        if (!row) {
          throw new AppError('A verified item is not a BOQ item of this tranche', 422, 'BOQ_ITEM_NOT_IN_TRANCHE', { boqItemId: v.boqItemId });
        }
        const prev = row.previousCertifiedPct;
        const max = row.maxVerifiablePct;
        if (v.verifiedCumulativePct < prev || v.verifiedCumulativePct > max + 1e-9) {
          throw new AppError(
            `Verified percentage for ${row.item.wbsCode} must be between the previous ${prev}% and the ${max}% the counted evidence supports`,
            422,
            'VERIFIED_PCT_OUT_OF_BOUNDS',
            { boqItemId: row.item.id, previousCertifiedPct: prev, maxVerifiablePct: max }
          );
        }
        const budget = Number(row.item.budgetedCostNgn);
        const claim = roundNgn(((max - prev) / 100) * budget);
        const verified = roundNgn(((v.verifiedCumulativePct - prev) / 100) * budget);
        totalClaimed += claim;
        totalVerified += verified;
        return {
          boqItemId: row.item.id,
          wbsCode: row.item.wbsCode,
          description: row.item.description,
          previousCertifiedPct: prev,
          systemClaimPct: max,
          systemClaimNgn: claim,
          verifiedCumulativePct: v.verifiedCumulativePct,
          verifiedAmountNgn: verified,
          remarks: v.remarks ?? null,
        };
      });
      totalClaimed = roundNgn(totalClaimed);
      totalVerified = roundNgn(totalVerified);

      // Phase 12: payment terms judged on the verified lines (unlisted items keep their certified %).
      const verifiedById = new Map(lines.map((l) => [l.boqItemId, l.verifiedCumulativePct]));
      const paymentTerms = paymentTermsFor(tranche, rows, (r) => verifiedById.get(r.item.id) ?? r.previousCertifiedPct, await termsExtrasFor(tx, projectId, tranche));
      const fixedBasis = paymentTerms.paymentBasis === 'FIXED_ON_COMPLETION';
      // Fixed basis: nothing is payable before the completion rule is met (checked first, so the
      // verifier is told why rather than that nothing moved).
      if (fixedBasis && input.trancheRecommendation !== 'HOLD' && !paymentTerms.completionMet) {
        throw new AppError(
          `This payment milestone is not complete, so nothing can be released yet: ${paymentTerms.unmetReasons.join(' ')}`,
          422,
          'MILESTONE_COMPLETION_NOT_MET',
          { unmetReasons: paymentTerms.unmetReasons }
        );
      }
      const progressed = lines.some((l) => l.verifiedCumulativePct > l.previousCertifiedPct);
      // A fixed milestone already complete (e.g. held earlier) can be put forward again without new progress.
      if (!progressed && !(fixedBasis && paymentTerms.completionMet)) {
        throw new AppError('Verify progress on at least one item beyond what is already certified', 422, 'NOTHING_VERIFIED');
      }

      let recommended = 0;
      if (fixedBasis) {
        // Fixed basis: the amount is the fixed amount still unpaid, payable only once complete.
        const due = roundNgn(Math.max(0, (paymentTerms.fixedReleaseAmountNgn ?? 0) - paymentTerms.alreadyReleasedNgn));
        totalClaimed = due;
        totalVerified = paymentTerms.completionMet ? due : 0;
        if (input.trancheRecommendation === 'SUPPORT_FULL_RELEASE') {
          if (due <= 0) throw new AppError('The fixed amount of this payment milestone has already been released', 409, 'NOTHING_TO_RELEASE');
          recommended = due;
        } else if (input.trancheRecommendation === 'SUPPORT_WITH_HOLDBACK') {
          recommended = roundNgn(input.holdbackReleaseAmountNgn ?? 0);
          if (recommended >= due - NGN_EPSILON) {
            throw new AppError(
              `A release with holdback must be below the fixed amount due (${fmtNgn(due)}); recommend a full release instead.`,
              422,
              'HOLDBACK_NOT_BELOW_FIXED_AMOUNT'
            );
          }
          if ((input.holdbackReason ?? '').trim().length < 5) {
            throw new AppError('Say why part of the fixed amount is held back (at least 5 characters).', 422, 'HOLDBACK_REASON_REQUIRED');
          }
        }
      } else if (input.trancheRecommendation === 'SUPPORT_FULL_RELEASE') recommended = totalVerified;
      else if (input.trancheRecommendation === 'SUPPORT_WITH_HOLDBACK') {
        recommended = roundNgn(input.holdbackReleaseAmountNgn ?? 0);
        if (recommended > totalVerified + NGN_EPSILON) {
          throw new AppError(
            `The recommended release cannot exceed the total verified (${fmtNgn(totalVerified)})`,
            422,
            'RECOMMENDED_RELEASE_EXCEEDS_CERTIFIED'
          );
        }
      }
      const holdback = roundNgn(Math.max(0, totalClaimed - recommended));
      const holdbackReason = input.trancheRecommendation === 'SUPPORT_WITH_HOLDBACK' ? input.holdbackReason?.trim() || null : null;
      const previousRevisions = await tx.valuationReport.count({ where: { trancheId: tranche.id, source: 'MILESTONE_DIRECT' } });
      const computation = {
        trancheId: tranche.id,
        lines,
        totalClaimedNgn: totalClaimed,
        totalCertifiedNgn: totalVerified,
        recommendedReleaseAmountNgn: recommended,
        recommendedHoldbackAmountNgn: holdback,
        certifierFullName: certifier.fullName,
        ...certifier.snapshot,
        revisionNumber: previousRevisions + 1,
        paymentTerms,
        holdbackReason,
      };
      if (input.dryRun) throw new DryRun(computation);

      const verification = await tx.milestoneVerification.create({
        data: {
          projectId,
          trancheId: tranche.id,
          verifiedByUserId: webUser.userId,
          verificationSummary: input.verificationSummary,
          lineVerificationsJson: lines as unknown as Prisma.InputJsonValue,
          paymentTermsJson: paymentTerms as unknown as Prisma.InputJsonValue,
        },
      });
      const now = new Date();
      const valuation = await tx.valuationReport.create({
        data: {
          projectId,
          trancheId: tranche.id,
          source: 'MILESTONE_DIRECT',
          ipcClaimId: null,
          milestoneVerificationId: verification.id,
          revisionNumber: computation.revisionNumber,
          certifiedByUserId: webUser.userId,
          trancheRecommendation: input.trancheRecommendation,
          totalClaimedNgn: totalClaimed,
          totalCertifiedNgn: totalVerified,
          recommendedReleaseAmountNgn: recommended,
          recommendedHoldbackAmountNgn: holdback,
          executiveCertificationSummary: holdbackReason
            ? `${input.verificationSummary}\n\nHoldback reason: ${holdbackReason}`
            : input.verificationSummary,
          certifierFullName: certifier.fullName,
          ...certifier.snapshot,
          certifiedAt: now,
        },
      });
      await tx.valuationReport.update({
        where: { id: valuation.id },
        data: { reportPdfUrl: `/api/v1/projects/${projectId}/valuations/${valuation.id}/valuation-report.pdf` },
      });

      // The only other place a BOQ item's certified percentage changes (besides IPC certification).
      for (const line of lines) {
        await tx.boqItem.update({ where: { id: line.boqItemId }, data: { cumulativeCertifiedPct: line.verifiedCumulativePct } });
      }
      const progress = await refreshCertifiedProgress(tx, projectId);

      const chain = await startValuationOnChain(tx, {
        projectId,
        valuationId: valuation.id,
        certifier: webUser,
        recommendedReleaseNgn: recommended,
        label: `Milestone verification on ${tranche.name} (rev ${computation.revisionNumber})`,
        actionUrl: `/app/projects/${projectId}/reconciliation?valuationId=${valuation.id}`,
      });

      await recordAuditEvent(tx, {
        projectId,
        actorType: 'WEB_USER',
        actorId: webUser.userId,
        actorDisplayName: certifier.actorDisplayName,
        action: 'DIRECT_MILESTONE_VERIFIED',
        summaryText: fixedBasis
          ? `Verified fixed payment milestone ${tranche.name} (revision ${computation.revisionNumber}, ${input.trancheRecommendation}): ` +
            `completion ${paymentTerms.completionMet ? 'met' : 'not met'}; fixed amount due ${fmtNgn(totalClaimed)}; recommended release ${fmtNgn(recommended)}` +
            (holdbackReason ? `; holdback reason: ${holdbackReason}.` : '.')
          : `Verified milestone progress on ${tranche.name} (revision ${computation.revisionNumber}, ${input.trancheRecommendation}): ` +
          `verified ${fmtNgn(totalVerified)} of ${fmtNgn(totalClaimed)} supported by evidence; recommended release ${fmtNgn(recommended)}.`,
        payload: {
          valuationReportId: valuation.id,
          milestoneVerificationId: verification.id,
          trancheId: tranche.id,
          lines,
          totalClaimedNgn: totalClaimed,
          totalCertifiedNgn: totalVerified,
          recommendedReleaseAmountNgn: recommended,
          recommendedHoldbackAmountNgn: holdback,
          paymentTerms,
          holdbackReason,
          projectCertifiedProgressPct: progress,
          approvalChainVersion: chain.version,
          nextApprovalStep: { stepOrder: chain.currentStep.stepOrder, label: chain.currentStep.label },
        },
      });
      return { dryRun: false, valuationReportId: valuation.id, computation };
    });
  } catch (error) {
    if (error instanceof DryRun) return { dryRun: true, valuationReportId: null, computation: error.result };
    throw error;
  }
}

const VALUATION_INCLUDE = {
  trancheDecisions: true,
  tranche: { select: { name: true, trancheNumber: true } },
  milestoneVerification: true,
} satisfies Prisma.ValuationReportInclude;

type DirectRow = Prisma.ValuationReportGetPayload<{ include: typeof VALUATION_INCLUDE }>;

function activeDecision(v: DirectRow) {
  return v.trancheDecisions.find((d) => !d.reversesDecisionId && !v.trancheDecisions.some((o) => o.reversesDecisionId === d.id)) ?? null;
}

async function serializeDirect(v: DirectRow, viewer: WebJwtPayload): Promise<DirectMilestoneValuationDto> {
  const active = activeDecision(v);
  const decided = Boolean(active);
  const [progress, review, release] = await Promise.all([
    valuationProgress(prisma, v, viewer, decided),
    reviewGate(prisma, v, viewer, decided),
    releaseGate(prisma, v, viewer),
  ]);
  const base = serializeValuationReport(v, progress);
  const sortedDecisions = [...v.trancheDecisions].sort((a, b) => a.decidedAt.getTime() - b.decidedAt.getTime());
  const gate = (checks: Array<[boolean, string]>) => {
    const failed = checks.find(([ok]) => !ok);
    return { allowed: !failed, reason: failed ? failed[1] : null };
  };
  const holdsApprove = viewer.permissions.includes('tranche:approve_disbursement');
  return {
    ...base,
    trancheName: v.tranche.name,
    trancheNumber: v.tranche.trancheNumber,
    verificationSummary: v.milestoneVerification?.verificationSummary ?? v.executiveCertificationSummary,
    lines: Array.isArray(v.milestoneVerification?.lineVerificationsJson)
      ? (v.milestoneVerification!.lineVerificationsJson as unknown as MilestoneVerificationLine[])
      : [],
    activeDecision: active ? serializeTrancheDecision(active, sortedDecisions) : null,
    paymentTerms: parsePaymentTerms(v.milestoneVerification?.paymentTermsJson),
    actions: {
      review: gate([
        [!v.supersededAt, 'This verification was returned.'],
        [review.allowed, review.reason ?? 'Nothing is waiting for review.'],
      ]),
      decide: gate([
        [holdsApprove, 'Your role does not hold the disbursement approval permission.'],
        [!v.supersededAt, 'This verification was returned.'],
        [!decided, 'A decision has already been recorded.'],
        [v.certifiedByUserId !== viewer.userId, 'You verified this milestone, so you cannot record the release decision on it.'],
        [release.allowed, release.reason ?? 'Not at the release step yet.'],
      ]),
      reverseDecision: gate([
        [holdsApprove, 'Your role does not hold the disbursement approval permission.'],
        [decided, 'No active decision to reverse.'],
      ]),
    },
  };
}

/** GET /projects/:projectId/milestones/valuations: direct milestone valuations, newest first. */
export async function listDirectMilestoneValuations(projectId: string, webUser: WebJwtPayload): Promise<DirectMilestoneValuationDto[]> {
  const rows = await prisma.valuationReport.findMany({
    where: { projectId, source: 'MILESTONE_DIRECT' },
    include: VALUATION_INCLUDE,
    orderBy: { certifiedAt: 'desc' },
  });
  return Promise.all(rows.map((r) => serializeDirect(r, webUser)));
}

export async function getDirectMilestoneValuation(projectId: string, valuationId: string, webUser: WebJwtPayload) {
  await loadValuationReportInProject(prisma, projectId, valuationId);
  const row = await prisma.valuationReport.findUniqueOrThrow({ where: { id: valuationId }, include: VALUATION_INCLUDE });
  if (row.source !== 'MILESTONE_DIRECT') throw new AppError('Valuation not found', 404, 'VALUATION_REPORT_NOT_FOUND');
  return serializeDirect(row, webUser);
}

/** PDF for any valuation (IPC or direct); the IPC route keeps working for IPC valuations. */
export async function generateValuationPdfById(projectId: string, valuationId: string): Promise<Buffer> {
  await loadValuationReportInProject(prisma, projectId, valuationId);
  const v = await prisma.valuationReport.findUniqueOrThrow({
    where: { id: valuationId },
    include: {
      tranche: true,
      milestoneVerification: true,
      trancheDecisions: true,
      retentionRelease: { include: { projectContractor: { include: { organization: { select: { name: true } } } } } },
      ipcClaim: { select: { ipcNumber: true, status: true } },
      project: {
        include: {
          tenant: true,
          monitorOrganization: true,
          lenderOrganization: true,
          contractors: {
            orderBy: [{ isMainContractor: 'desc' }, { createdAt: 'asc' }],
            include: { organization: { select: { name: true } } },
          },
        },
      },
    },
  });
  const branding = parseTenantBranding(v.project.tenant.brandingConfig);
  resolveRatingLabels(v.project.tenant.evidenceRatingLabels);
  const lines = Array.isArray(v.milestoneVerification?.lineVerificationsJson)
    ? (v.milestoneVerification!.lineVerificationsJson as unknown as MilestoneVerificationLine[])
    : [];
  const budgets = await prisma.boqItem.findMany({
    where: { id: { in: lines.map((l) => l.boqItemId) } },
    select: { id: true, budgetedCostNgn: true },
  });
  const budgetOf = new Map(budgets.map((b) => [b.id, Number(b.budgetedCostNgn)]));
  return generateValuationReportPdfBuffer({
    terminology: resolveTerminology(v.project.tenant.terminologyLabels),
    tenantName: v.project.tenant.name,
    pdfHeaderTitle: branding.pdfHeaderTitle,
    pdfFooterDisclaimer: branding.pdfFooterDisclaimer,
    primaryColorHex: branding.primaryColorHex,
    projectName: v.project.name,
    projectCodePrefix: v.project.codePrefix,
    stateLocation: v.project.stateLocation ?? '',
    lenderName: v.project.lenderOrganization?.name ?? '',
    contractorName: v.retentionRelease?.projectContractor.organization.name ?? contractorHeadline(v.project.contractors).name,
    retentionRelease: v.retentionRelease
      ? { stage: v.retentionRelease.stage, contractorName: v.retentionRelease.projectContractor.organization.name }
      : null,
    releaseDecision: pdfReleaseDecision(v.trancheDecisions, v.project.retentionPercentage),
    monitorOrganizationName: v.project.monitorOrganization?.name ?? '',
    currency: v.project.tenant.defaultCurrency,
    timeZone: v.project.timezone,
    ipcNumber: v.ipcClaim?.ipcNumber ?? null,
    ipcStatus: v.ipcClaim?.status ?? (v.supersededAt ? 'RETURNED' : 'VERIFIED'),
    trancheName: v.tranche.name,
    totalClaimedNgn: Number(v.totalClaimedNgn),
    ratingEngine: null,
    ratingEngineDetail: null,
    aiExecutiveSummary: null,
    certification: {
      revisionNumber: v.revisionNumber,
      totalCertifiedNgn: Number(v.totalCertifiedNgn),
      recommendedReleaseNgn: Number(v.recommendedReleaseAmountNgn),
      recommendedHoldbackNgn: Number(v.recommendedHoldbackAmountNgn),
      trancheRecommendation: v.trancheRecommendation,
      executiveSummary: v.executiveCertificationSummary,
      certifierFullName: v.certifierFullName,
      certifierLicenseType: v.certifierLicenseType,
      certifierLicenseNumber: v.certifierLicenseNumber,
      certifierRegistrationBodyName: v.certifierRegistrationBodyName,
      certifierRegistrationPrefix: v.certifierRegistrationPrefix,
      certifiedAtIso: v.certifiedAt.toISOString(),
    },
    paymentTerms: parsePaymentTerms(v.milestoneVerification?.paymentTermsJson),
    lineItems: lines.map((l) => ({
      wbsCode: l.wbsCode,
      description: l.description,
      budgetedCostNgn: budgetOf.get(l.boqItemId) ?? 0,
      contractorClaimedPct: l.systemClaimPct,
      ratingLabel: 'Field evidence (direct verification)',
      monitorCertifiedPct: l.verifiedCumulativePct,
      monitorCertifiedNgn: l.verifiedAmountNgn,
    })),
  });
}

function parsePaymentTerms(raw: unknown): MilestonePaymentTerms | null {
  if (!raw) return null;
  const parsed = MilestonePaymentTermsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function canViewDirectValuations(webUser: WebJwtPayload) {
  return hasWebPermission(webUser, 'ipc:view', VERIFY, 'tranche:approve_disbursement');
}
