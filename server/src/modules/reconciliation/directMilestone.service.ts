import { Prisma } from '@prisma/client';
import {
  DirectMilestoneSuggestionDto,
  DirectMilestoneValuationDto,
  MilestoneVerificationLine,
  ProfessionalLicenseType,
  resolveRatingLabels,
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
  const items = await db.boqItem.findMany({ where: { projectId, trancheId }, orderBy: { wbsCode: 'asc' } });
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

export async function getDirectMilestoneSuggestion(projectId: string, trancheId: string): Promise<DirectMilestoneSuggestionDto> {
  const config = await assertDirectMode(projectId);
  const tranche = await loadTrancheInProject(prisma, projectId, trancheId);
  const [rows, open] = await Promise.all([evidenceForTranche(prisma, projectId, trancheId), openDirectValuation(prisma, trancheId)]);
  return {
    trancheId,
    trancheName: tranche.name,
    openValuationId: open?.id ?? null,
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

      const user = await tx.user.findUniqueOrThrow({
        where: { id: webUser.userId },
        select: { fullName: true, professionalLicenseType: true, professionalLicenseNumber: true },
      });
      const licence = user.professionalLicenseNumber?.trim();
      if (!user.professionalLicenseType || !licence) {
        throw new AppError(
          'Your profile has no professional licence. Add your licence type and number before verifying.',
          422,
          'CERTIFIER_LICENCE_MISSING'
        );
      }

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
      if (!lines.some((l) => l.verifiedCumulativePct > l.previousCertifiedPct)) {
        throw new AppError('Verify progress on at least one item beyond what is already certified', 422, 'NOTHING_VERIFIED');
      }

      let recommended = 0;
      if (input.trancheRecommendation === 'SUPPORT_FULL_RELEASE') recommended = totalVerified;
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
      const previousRevisions = await tx.valuationReport.count({ where: { trancheId: tranche.id, source: 'MILESTONE_DIRECT' } });
      const computation = {
        trancheId: tranche.id,
        lines,
        totalClaimedNgn: totalClaimed,
        totalCertifiedNgn: totalVerified,
        recommendedReleaseAmountNgn: recommended,
        recommendedHoldbackAmountNgn: holdback,
        certifierFullName: user.fullName,
        certifierLicenseType: user.professionalLicenseType as ProfessionalLicenseType,
        certifierLicenseNumber: licence,
        revisionNumber: previousRevisions + 1,
      };
      if (input.dryRun) throw new DryRun(computation);

      const verification = await tx.milestoneVerification.create({
        data: {
          projectId,
          trancheId: tranche.id,
          verifiedByUserId: webUser.userId,
          verificationSummary: input.verificationSummary,
          lineVerificationsJson: lines as unknown as Prisma.InputJsonValue,
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
          executiveCertificationSummary: input.verificationSummary,
          certifierFullName: user.fullName,
          certifierLicenseType: user.professionalLicenseType!,
          certifierLicenseNumber: licence,
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
        actorDisplayName: `${user.fullName} (${user.professionalLicenseType} #${licence})`,
        action: 'DIRECT_MILESTONE_VERIFIED',
        summaryText:
          `Verified milestone progress on ${tranche.name} (revision ${computation.revisionNumber}, ${input.trancheRecommendation}): ` +
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
    tenantName: v.project.tenant.name,
    pdfHeaderTitle: branding.pdfHeaderTitle,
    pdfFooterDisclaimer: branding.pdfFooterDisclaimer,
    primaryColorHex: branding.primaryColorHex,
    projectName: v.project.name,
    projectCodePrefix: v.project.codePrefix,
    stateLocation: v.project.stateLocation ?? '',
    lenderName: v.project.lenderOrganization?.name ?? '',
    contractorName: contractorHeadline(v.project.contractors).name,
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
      certifiedAtIso: v.certifiedAt.toISOString(),
    },
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

export function canViewDirectValuations(webUser: WebJwtPayload) {
  return hasWebPermission(webUser, 'ipc:view', VERIFY, 'tranche:approve_disbursement');
}
