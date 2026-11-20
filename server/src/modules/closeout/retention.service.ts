import { Prisma } from '@prisma/client';
import {
  allocateRetention,
  calendarDaysUntil,
  certificationPermissionFor,
  CertifyRetentionReleaseRequest,
  OPEN_DEFECT_STATUSES,
  RequestRetentionReleaseRequest,
  RETENTION_NGN_EPSILON,
  retentionReleaseCap,
  RetentionReleaseRequestDto,
  RetentionReleaseStage,
  RetentionShare,
  RetentionStageOptionDto,
  RetentionSummaryDto,
  retentionWithheldFor,
  roundNgn2,
  resolveTerm,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { createWebNotification } from '../notifications/notifications.service';
import { getProcessConfig } from '../process/processConfig.service';
import { terminologyForProject } from '../organizations/terminology.service';
import {
  assertCertifierCredentials,
  certifierCannotActReason,
  credentialPolicyForProject,
} from '../credentials/credentialPolicy.service';
import { serializeValuationReport } from '../../utils/serializers';
import { releaseGate, reviewGate, startValuationOnChain, valuationProgress } from '../reconciliation/disbursementChain';
import { assertModuleOn, fmtNgn, projectToday } from './closeoutGate';

/**
 * Retention (Phase 10 Steps 5 and 7).
 *
 * Accrual: when the retention module is on and the project has a retention percentage, every
 * lender release withholds `approved x percentage`. The tranche still records the full approved
 * amount (the facility is drawn), the contractor receives approved minus retention
 * (`Project.disbursedToDateNgn`), and the withheld part is held per ProjectContractor (the project
 * keeps the sums). A reversal reverses the withheld part with the same split.
 *
 * Release: a user with retention:release_escrow requests a release for one contractor; a licensed
 * certifier's certification creates a RETENTION_RELEASE valuation, which then runs through the
 * project's disbursement chain (review steps, release by the lender, same-user block). The lender
 * decision moves money from held to released.
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

const RELEASE_ESCROW = 'retention:release_escrow';
const APPROVE = 'tranche:approve_disbursement';
const actorName = (u: WebJwtPayload) => `${u.fullName} (${u.roleName})`;

// ---------------------------------------------------------------------------
// Accrual (called from the lender decision and its reversal)
// ---------------------------------------------------------------------------

/** The retention to withhold from a lender release and its split per contractor. */
export async function computeRetentionForRelease(
  tx: Tx,
  params: {
    projectId: string;
    approvedNgn: number;
    valuation: { source: string; milestoneVerificationId: string | null };
    ipcProjectContractorId: string | null;
  }
): Promise<{ withheldNgn: number; allocation: RetentionShare[]; percentage: number | null }> {
  const none = { withheldNgn: 0, allocation: [], percentage: null };
  if (params.valuation.source === 'RETENTION_RELEASE' || params.approvedNgn <= 0) return none;
  const config = await getProcessConfig(params.projectId, tx);
  if (!config.enableRetentionModule) return none;
  const project = await tx.project.findUniqueOrThrow({
    where: { id: params.projectId },
    select: {
      retentionPercentage: true,
      contractorExecutionMode: true,
      contractors: { select: { id: true, isMainContractor: true }, orderBy: [{ isMainContractor: 'desc' }, { createdAt: 'asc' }] },
    },
  });
  const pct = project.retentionPercentage === null ? 0 : Number(project.retentionPercentage);
  const withheld = retentionWithheldFor(params.approvedNgn, pct);
  const main = project.contractors[0];
  if (withheld <= 0 || !main) return none;

  let weights: Array<{ projectContractorId: string; weight: number }> = [];
  if (params.ipcProjectContractorId) {
    weights = [{ projectContractorId: params.ipcProjectContractorId, weight: 1 }];
  } else if (params.valuation.milestoneVerificationId && project.contractorExecutionMode === 'MULTI_PRIME_SEPARATE_IPC') {
    // Direct milestone in multi-prime: split by the verified amount of each contractor's items.
    const verification = await tx.milestoneVerification.findUniqueOrThrow({ where: { id: params.valuation.milestoneVerificationId } });
    const lines = Array.isArray(verification.lineVerificationsJson)
      ? (verification.lineVerificationsJson as Array<{ boqItemId: string; verifiedAmountNgn: number }>)
      : [];
    const items = await tx.boqItem.findMany({
      where: { id: { in: lines.map((l) => l.boqItemId) } },
      select: { id: true, projectContractorId: true },
    });
    const owner = new Map(items.map((i) => [i.id, i.projectContractorId ?? main.id]));
    weights = lines.map((l) => ({ projectContractorId: owner.get(l.boqItemId) ?? main.id, weight: l.verifiedAmountNgn }));
  }
  // Unified model: the main contractor is paid, so it carries the retention.
  return { withheldNgn: withheld, allocation: allocateRetention(withheld, weights, main.id), percentage: pct };
}

async function lockProject(tx: Tx, projectId: string) {
  await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId}::uuid FOR UPDATE`;
}

/**
 * Adds (`sign` 1) or removes (`sign` -1) withheld retention. Removing more than a contractor still
 * holds is refused: that retention was already released and must be dealt with first.
 */
export async function applyRetentionHeld(tx: Tx, projectId: string, allocation: RetentionShare[], sign: 1 | -1) {
  if (allocation.length === 0) return;
  await lockProject(tx, projectId);
  for (const share of allocation) {
    const contractor = await tx.projectContractor.findFirst({ where: { id: share.projectContractorId, projectId } });
    if (!contractor) throw new AppError('Contractor not found on this project', 404, 'CONTRACTOR_NOT_FOUND');
    if (sign < 0 && Number(contractor.retentionHeldNgn) + RETENTION_NGN_EPSILON < share.amountNgn) {
      throw new AppError(
        'Part of the retention withheld on this release has already been released. Reverse that retention release first.',
        409,
        'RETENTION_ALREADY_RELEASED'
      );
    }
    await tx.projectContractor.update({
      where: { id: contractor.id },
      data: { retentionHeldNgn: { increment: sign * share.amountNgn } },
    });
  }
  const total = roundNgn2(allocation.reduce((s, a) => s + a.amountNgn, 0));
  await tx.project.update({ where: { id: projectId }, data: { retentionHeldNgn: { increment: sign * total } } });
}

/** Moves a decided retention release from held to released (`sign` -1 undoes it on reversal). */
export async function applyRetentionRelease(tx: Tx, projectId: string, projectContractorId: string, amountNgn: number, sign: 1 | -1) {
  if (amountNgn <= 0) return;
  await lockProject(tx, projectId);
  const contractor = await tx.projectContractor.findFirstOrThrow({ where: { id: projectContractorId, projectId } });
  if (sign > 0 && Number(contractor.retentionHeldNgn) + RETENTION_NGN_EPSILON < amountNgn) {
    throw new AppError(
      `The release exceeds the retention this contractor still holds (${fmtNgn(Number(contractor.retentionHeldNgn))})`,
      422,
      'RETENTION_RELEASE_EXCEEDS_HELD'
    );
  }
  const delta = sign * amountNgn;
  await tx.projectContractor.update({
    where: { id: contractor.id },
    data: { retentionHeldNgn: { decrement: delta }, retentionReleasedNgn: { increment: delta } },
  });
  await tx.project.update({
    where: { id: projectId },
    data: {
      retentionHeldNgn: { decrement: delta },
      retentionReleasedNgn: { increment: delta },
      disbursedToDateNgn: { increment: delta },
    },
  });
}

/** The release request behind a RETENTION_RELEASE valuation. */
export async function releaseRequestForValuation(db: Db, valuationId: string) {
  const request = await db.retentionReleaseRequest.findUnique({ where: { valuationReportId: valuationId } });
  if (!request) throw new AppError('Retention release request not found', 404, 'RETENTION_RELEASE_NOT_FOUND');
  return request;
}

/**
 * Re-checked at the lender decision: a final release still needs the period to have ended and no
 * open defect for the contractor (a ticket may have been raised since certification).
 */
export async function assertRetentionReleaseStillAllowed(tx: Tx, projectId: string, valuationId: string) {
  const request = await releaseRequestForValuation(tx, valuationId);
  const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
  const openTickets = await tx.retentionDefectTicket.count({
    where: { projectId, projectContractorId: request.projectContractorId, status: { in: OPEN_DEFECT_STATUSES } },
  });
  const unmet = stagePreconditions({
    stage: request.stage,
    phase: project.constructionPhase,
    practicalCompletionDate: project.practicalCompletionDate,
    retentionEndDate: project.retentionEndDate,
    releaseAtCompletionPct: Number(project.retentionReleaseAtCompletionPct),
    today: projectToday(project.timezone),
    openTickets,
  });
  if (unmet.length > 0) {
    throw new AppError(`Retention cannot be released yet: ${unmet.join(' ')}`, 409, 'RETENTION_RELEASE_PRECONDITIONS_UNMET', { unmet });
  }
  return request;
}

// ---------------------------------------------------------------------------
// Preconditions and balances
// ---------------------------------------------------------------------------

function stagePreconditions(p: {
  stage: RetentionReleaseStage;
  phase: string;
  practicalCompletionDate: string | null;
  retentionEndDate: string | null;
  releaseAtCompletionPct: number;
  today: string;
  openTickets: number;
}): string[] {
  const unmet: string[] = [];
  if (p.phase !== 'RETENTION_PERIOD') unmet.push('The project must be in its defects liability period.');
  if (p.stage === 'COMPLETION') {
    if (!p.practicalCompletionDate) unmet.push('Practical completion has not been recorded.');
    if (p.releaseAtCompletionPct <= 0) unmet.push('No release at practical completion is configured for this project.');
  } else {
    if (!p.retentionEndDate) unmet.push('The liability period has no end date.');
    else if (p.today < p.retentionEndDate) unmet.push(`The liability period ends on ${p.retentionEndDate}.`);
    if (p.openTickets > 0) unmet.push(`${p.openTickets} defect ticket(s) for this contractor are still open.`);
  }
  return unmet;
}

const REQUEST_INCLUDE = {
  projectContractor: { select: { organization: { select: { name: true } } } },
  valuationReport: { include: { trancheDecisions: true } },
} satisfies Prisma.RetentionReleaseRequestInclude;
type RequestRow = Prisma.RetentionReleaseRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;

function activeDecisionOf(v: RequestRow['valuationReport']) {
  if (!v) return null;
  return v.trancheDecisions.find((d) => !d.reversesDecisionId && !v.trancheDecisions.some((o) => o.reversesDecisionId === d.id)) ?? null;
}

/** A request still holding part of the balance: awaiting certification, or certified and undecided. */
function isOpenRequest(r: RequestRow): boolean {
  if (r.status === 'PENDING_CERTIFICATION') return true;
  if (r.status !== 'CERTIFIED' || !r.valuationReport) return false;
  return !r.valuationReport.supersededAt && !activeDecisionOf(r.valuationReport);
}

async function loadRequests(db: Db, projectId: string) {
  return db.retentionReleaseRequest.findMany({ where: { projectId }, include: REQUEST_INCLUDE, orderBy: { requestedAt: 'desc' } });
}

interface BalanceContext {
  project: Prisma.ProjectGetPayload<{ include: { contractors: { include: { organization: { select: { name: true } } } } } }>;
  requests: RequestRow[];
  openTicketsByContractor: Map<string, number>;
  today: string;
}

async function loadBalanceContext(db: Db, projectId: string): Promise<BalanceContext> {
  const [project, requests, tickets] = await Promise.all([
    db.project.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        contractors: {
          include: { organization: { select: { name: true } } },
          orderBy: [{ isMainContractor: 'desc' }, { createdAt: 'asc' }],
        },
      },
    }),
    loadRequests(db, projectId),
    db.retentionDefectTicket.groupBy({
      by: ['projectContractorId'],
      where: { projectId, status: { in: OPEN_DEFECT_STATUSES } },
      _count: { _all: true },
    }),
  ]);
  return {
    project,
    requests,
    openTicketsByContractor: new Map(tickets.map((t) => [t.projectContractorId, t._count._all])),
    today: projectToday(project.timezone),
  };
}

function stageOption(ctx: BalanceContext, contractorId: string, stage: RetentionReleaseStage, excludeRequestId?: string): RetentionStageOptionDto {
  const c = ctx.project.contractors.find((x) => x.id === contractorId)!;
  const open = ctx.requests.filter((r) => r.projectContractorId === contractorId && r.id !== excludeRequestId && isOpenRequest(r));
  const pending = roundNgn2(open.reduce((s, r) => s + Number(r.amountNgn), 0));
  const cap = retentionReleaseCap({
    stage,
    heldNgn: Number(c.retentionHeldNgn),
    releasedNgn: Number(c.retentionReleasedNgn),
    pendingNgn: pending,
    releaseAtCompletionPct: Number(ctx.project.retentionReleaseAtCompletionPct),
  });
  const unmet = stagePreconditions({
    stage,
    phase: ctx.project.constructionPhase,
    practicalCompletionDate: ctx.project.practicalCompletionDate,
    retentionEndDate: ctx.project.retentionEndDate,
    releaseAtCompletionPct: Number(ctx.project.retentionReleaseAtCompletionPct),
    today: ctx.today,
    openTickets: ctx.openTicketsByContractor.get(contractorId) ?? 0,
  });
  if (open.length > 0) unmet.push('A release for this contractor is already going through approval.');
  if (cap <= 0 && unmet.length === 0) unmet.push(Number(c.retentionHeldNgn) <= 0 ? 'Nothing is held for this contractor.' : 'Nothing more can be released at this stage.');
  return { stage, allowed: unmet.length === 0 && cap > 0, maxAmountNgn: cap, unmet };
}

async function userNames(db: Db, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map<string, string>();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, fullName: true } });
  return new Map(users.map((u) => [u.id, u.fullName]));
}

async function serializeRequest(
  r: RequestRow,
  viewer: WebJwtPayload,
  names: Map<string, string>,
  certifyPermission: string,
  registrationBlocker: string | null = null
): Promise<RetentionReleaseRequestDto> {
  const v = r.valuationReport;
  const active = activeDecisionOf(v);
  const decided = Boolean(active);
  const [progress, review, release] = v
    ? await Promise.all([valuationProgress(prisma, v, viewer, decided), reviewGate(prisma, v, viewer, decided), releaseGate(prisma, v, viewer)])
    : [null, { allowed: false, reason: 'Not certified yet.' }, { allowed: false, reason: 'Not certified yet.' }];
  const gate = (checks: Array<[boolean, string]>) => {
    const failed = checks.find(([ok]) => !ok);
    return { allowed: !failed, reason: failed ? failed[1] : null };
  };
  const outcome: RetentionReleaseRequestDto['outcome'] =
    r.status === 'CANCELLED'
      ? 'CANCELLED'
      : !v
        ? 'AWAITING_CERTIFICATION'
        : v.supersededAt
          ? 'RETURNED'
          : active
            ? active.decision === 'HOLD'
              ? 'HELD'
              : 'RELEASED'
            : 'IN_APPROVAL';
  return {
    id: r.id,
    projectContractorId: r.projectContractorId,
    contractorName: r.projectContractor.organization.name,
    stage: r.stage,
    amountNgn: Number(r.amountNgn),
    status: r.status,
    notes: r.notes,
    requestedByName: names.get(r.requestedByUserId) ?? null,
    requestedAt: r.requestedAt.toISOString(),
    certifiedAt: r.certifiedAt?.toISOString() ?? null,
    valuation: v ? serializeValuationReport(v, progress) : null,
    outcome,
    actions: {
      certify: gate([
        [r.status === 'PENDING_CERTIFICATION', 'Only a request awaiting certification can be certified.'],
        [viewer.permissions.includes(certifyPermission), 'Your role does not hold the certification permission.'],
        // Phase 12: only when the project's certifier policy is REQUIRED.
        [!registrationBlocker, registrationBlocker ?? ''],
      ]),
      cancel: gate([
        [r.status === 'PENDING_CERTIFICATION', 'Only a request awaiting certification can be cancelled.'],
        [viewer.permissions.includes(RELEASE_ESCROW) || viewer.isPlatformSuperAdmin, 'Requires permission to request retention releases.'],
      ]),
      review: gate([
        [Boolean(v) && !v?.supersededAt, 'Nothing is waiting for review.'],
        [review.allowed, review.reason ?? 'Nothing is waiting for review.'],
      ]),
      decide: gate([
        [viewer.permissions.includes(APPROVE), 'Your role does not hold the disbursement approval permission.'],
        [Boolean(v) && !v?.supersededAt, 'Not certified, or returned.'],
        [!decided, 'A decision has already been recorded.'],
        [!v || v.certifiedByUserId !== viewer.userId, 'You certified this release, so you cannot record the lender decision on it.'],
        [release.allowed, release.reason ?? 'Not at the release step yet.'],
      ]),
      reverseDecision: gate([
        [viewer.permissions.includes(APPROVE), 'Your role does not hold the disbursement approval permission.'],
        [decided, 'No active decision to reverse.'],
      ]),
    },
  };
}

/** GET /projects/:projectId/retention */
export async function getRetentionSummary(projectId: string, viewer: WebJwtPayload): Promise<RetentionSummaryDto> {
  const config = await assertModuleOn(projectId, 'retention');
  const ctx = await loadBalanceContext(prisma, projectId);
  const p = ctx.project;
  const names = await userNames(prisma, ctx.requests.map((r) => r.requestedByUserId));
  const certifyPermission = certificationPermissionFor(config.disbursementMechanism);
  const [policy, viewerProfile] = await Promise.all([
    credentialPolicyForProject(projectId),
    prisma.user.findUnique({
      where: { id: viewer.userId },
      select: { professionalRegistrationBodyCode: true, professionalRegistrationNumber: true },
    }),
  ]);
  const registrationBlocker = certifierCannotActReason(policy.certifier, viewerProfile);
  return {
    projectId,
    enabled: true,
    phase: p.constructionPhase,
    retentionPercentage: p.retentionPercentage === null ? null : Number(p.retentionPercentage),
    retentionDurationMonths: p.retentionDurationMonths,
    retentionReleaseAtCompletionPct: Number(p.retentionReleaseAtCompletionPct),
    practicalCompletionDate: p.practicalCompletionDate,
    retentionStartDate: p.retentionStartDate,
    retentionEndDate: p.retentionEndDate,
    daysRemaining: p.retentionEndDate ? calendarDaysUntil(ctx.today, p.retentionEndDate) : null,
    heldNgn: Number(p.retentionHeldNgn),
    releasedNgn: Number(p.retentionReleasedNgn),
    contractors: p.contractors.map((c) => {
      const open = ctx.requests.filter((r) => r.projectContractorId === c.id && isOpenRequest(r));
      return {
        projectContractorId: c.id,
        contractorName: c.organization.name,
        tradeCode: c.tradeCode,
        isMainContractor: c.isMainContractor,
        withheldTotalNgn: roundNgn2(Number(c.retentionHeldNgn) + Number(c.retentionReleasedNgn)),
        heldNgn: Number(c.retentionHeldNgn),
        releasedNgn: Number(c.retentionReleasedNgn),
        pendingReleaseNgn: roundNgn2(open.reduce((s, r) => s + Number(r.amountNgn), 0)),
        openTicketCount: ctx.openTicketsByContractor.get(c.id) ?? 0,
        stages: (['COMPLETION', 'FINAL'] as const).map((stage) => stageOption(ctx, c.id, stage)),
      };
    }),
    requests: await Promise.all(ctx.requests.map((r) => serializeRequest(r, viewer, names, certifyPermission, registrationBlocker))),
    canRequestRelease: viewer.permissions.includes(RELEASE_ESCROW) || viewer.isPlatformSuperAdmin,
  };
}

// ---------------------------------------------------------------------------
// Release requests
// ---------------------------------------------------------------------------

/** POST /projects/:projectId/retention/release-request */
export async function requestRetentionRelease(params: { projectId: string; webUser: WebJwtPayload; input: RequestRetentionReleaseRequest }) {
  const { projectId, webUser, input } = params;
  await assertModuleOn(projectId, 'retention');
  const id = await prisma.$transaction(async (tx) => {
    await lockProject(tx, projectId);
    const ctx = await loadBalanceContext(tx, projectId);
    const contractor = ctx.project.contractors.find((c) => c.id === input.projectContractorId);
    if (!contractor) throw new AppError('Contractor not found on this project', 404, 'CONTRACTOR_NOT_FOUND');
    const option = stageOption(ctx, contractor.id, input.stage);
    if (!option.allowed) {
      throw new AppError(`Retention cannot be released yet: ${option.unmet.join(' ')}`, 409, 'RETENTION_RELEASE_PRECONDITIONS_UNMET', {
        unmet: option.unmet,
      });
    }
    const amount = roundNgn2(input.amountNgn ?? option.maxAmountNgn);
    if (amount <= 0 || amount > option.maxAmountNgn + RETENTION_NGN_EPSILON) {
      throw new AppError(`The amount must be between 0 and ${fmtNgn(option.maxAmountNgn)}`, 422, 'RETENTION_RELEASE_EXCEEDS_ALLOWED', {
        maxAmountNgn: option.maxAmountNgn,
      });
    }
    const request = await tx.retentionReleaseRequest.create({
      data: {
        projectId,
        projectContractorId: contractor.id,
        stage: input.stage,
        amountNgn: amount,
        notes: input.notes ?? null,
        requestedByUserId: webUser.userId,
      },
    });
    const config = await getProcessConfig(projectId, tx);
    await createWebNotification(tx, {
      projectId,
      targetPermissionKey: certificationPermissionFor(config.disbursementMechanism),
      category: 'RETENTION_RELEASE',
      title: `${resolveTerm(await terminologyForProject(projectId, tx), 'retention')} release for ${contractor.organization.name} awaiting certification`,
      description: `${fmtNgn(amount)} (${input.stage === 'FINAL' ? 'final release' : 'release at practical completion'}) needs certification.`,
      actionUrl: `/app/projects/${projectId}/retention`,
      metadata: { retentionReleaseRequestId: request.id },
    });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'RETENTION_RELEASE_REQUESTED',
      summaryText: `Requested ${input.stage === 'FINAL' ? 'final' : 'practical completion'} retention release of ${fmtNgn(amount)} for ${contractor.organization.name}.`,
      payload: { retentionReleaseRequestId: request.id, projectContractorId: contractor.id, stage: input.stage, amountNgn: amount },
    });
    return request.id;
  });
  return getReleaseRequest(projectId, id, webUser);
}

async function getReleaseRequest(projectId: string, requestId: string, viewer: WebJwtPayload) {
  const config = await getProcessConfig(projectId);
  const row = await prisma.retentionReleaseRequest.findFirst({ where: { id: requestId, projectId }, include: REQUEST_INCLUDE });
  if (!row) throw new AppError('Retention release request not found', 404, 'RETENTION_RELEASE_NOT_FOUND');
  const names = await userNames(prisma, [row.requestedByUserId]);
  return serializeRequest(row, viewer, names, certificationPermissionFor(config.disbursementMechanism));
}

/** POST /projects/:projectId/retention/release-requests/:requestId/cancel */
export async function cancelRetentionRelease(params: { projectId: string; requestId: string; webUser: WebJwtPayload }) {
  const { projectId, requestId, webUser } = params;
  await assertModuleOn(projectId, 'retention');
  await prisma.$transaction(async (tx) => {
    const request = await tx.retentionReleaseRequest.findFirst({ where: { id: requestId, projectId } });
    if (!request) throw new AppError('Retention release request not found', 404, 'RETENTION_RELEASE_NOT_FOUND');
    if (request.status !== 'PENDING_CERTIFICATION') {
      throw new AppError('Only a request awaiting certification can be cancelled', 409, 'RETENTION_RELEASE_NOT_CANCELLABLE');
    }
    await tx.retentionReleaseRequest.update({ where: { id: request.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'RETENTION_RELEASE_CANCELLED',
      summaryText: `Cancelled the retention release request of ${fmtNgn(Number(request.amountNgn))}.`,
      payload: { retentionReleaseRequestId: request.id },
    });
  });
  return getReleaseRequest(projectId, requestId, webUser);
}

/**
 * POST /projects/:projectId/retention/release-requests/:requestId/certify: the certification step.
 * Creates the RETENTION_RELEASE valuation and puts it on the disbursement chain.
 */
export async function certifyRetentionRelease(params: {
  projectId: string;
  requestId: string;
  webUser: WebJwtPayload;
  input: CertifyRetentionReleaseRequest;
}) {
  const { projectId, requestId, webUser, input } = params;
  const config = await assertModuleOn(projectId, 'retention');
  const certifyPermission = certificationPermissionFor(config.disbursementMechanism);
  // D-3.1: held through a role, never by bypass.
  if (!webUser.permissions.includes(certifyPermission)) {
    throw new AppError(`This action requires the ${certifyPermission} permission on your role`, 403, 'FORBIDDEN_PERMISSION');
  }
  await prisma.$transaction(async (tx) => {
    await lockProject(tx, projectId);
    const request = await tx.retentionReleaseRequest.findFirst({ where: { id: requestId, projectId } });
    if (!request) throw new AppError('Retention release request not found', 404, 'RETENTION_RELEASE_NOT_FOUND');
    if (request.status !== 'PENDING_CERTIFICATION') {
      throw new AppError('This request is not awaiting certification', 409, 'RETENTION_RELEASE_NOT_PENDING');
    }
    const ctx = await loadBalanceContext(tx, projectId);
    const option = stageOption(ctx, request.projectContractorId, request.stage, request.id);
    const amount = Number(request.amountNgn);
    if (!option.allowed || amount > option.maxAmountNgn + RETENTION_NGN_EPSILON) {
      const unmet = option.allowed ? [`At most ${fmtNgn(option.maxAmountNgn)} can be released now.`] : option.unmet;
      throw new AppError(`Retention cannot be released yet: ${unmet.join(' ')}`, 409, 'RETENTION_RELEASE_PRECONDITIONS_UNMET', { unmet });
    }

    // Phase 12: the project's certifier policy decides whether a registration is needed and copied.
    const certifier = await assertCertifierCredentials(tx, {
      userId: webUser.userId,
      tenantId: webUser.tenantId,
      requirement: (await credentialPolicyForProject(projectId, tx)).certifier,
    });
    // ValuationReport needs a tranche; retention is not drawn from a tranche, so the last tranche is
    // the accounting anchor and its allocation is never touched by a retention release.
    const anchor = await tx.facilityTranche.findFirst({ where: { projectId }, orderBy: { trancheNumber: 'desc' } });
    if (!anchor) throw new AppError('The project has no tranche to record the release against', 409, 'NO_TRANCHE');
    const contractor = ctx.project.contractors.find((c) => c.id === request.projectContractorId)!;
    const stageLabel = request.stage === 'FINAL' ? 'final retention release' : 'retention release at practical completion';

    const valuation = await tx.valuationReport.create({
      data: {
        projectId,
        trancheId: anchor.id,
        source: 'RETENTION_RELEASE',
        revisionNumber: 1,
        certifiedByUserId: webUser.userId,
        trancheRecommendation: 'SUPPORT_FULL_RELEASE',
        totalClaimedNgn: amount,
        totalCertifiedNgn: amount,
        recommendedReleaseAmountNgn: amount,
        recommendedHoldbackAmountNgn: 0,
        executiveCertificationSummary: input.executiveCertificationSummary,
        certifierFullName: certifier.fullName,
        ...certifier.snapshot,
      },
    });
    await tx.valuationReport.update({
      where: { id: valuation.id },
      data: { reportPdfUrl: `/api/v1/projects/${projectId}/valuations/${valuation.id}/valuation-report.pdf` },
    });
    await tx.retentionReleaseRequest.update({
      where: { id: request.id },
      data: { status: 'CERTIFIED', certifiedAt: new Date(), valuationReportId: valuation.id },
    });
    const chain = await startValuationOnChain(tx, {
      projectId,
      valuationId: valuation.id,
      certifier: webUser,
      recommendedReleaseNgn: amount,
      label: `${contractor.organization.name} ${stageLabel}`,
      actionUrl: `/app/projects/${projectId}/retention`,
    });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: certifier.actorDisplayName,
      action: 'VALUATION_REPORT_CERTIFIED',
      summaryText: `Certified the ${stageLabel} of ${fmtNgn(amount)} for ${contractor.organization.name}.`,
      payload: {
        valuationReportId: valuation.id,
        valuationSource: 'RETENTION_RELEASE',
        retentionReleaseRequestId: request.id,
        projectContractorId: request.projectContractorId,
        stage: request.stage,
        amountNgn: amount,
        approvalChainVersion: chain.version,
        nextApprovalStep: { stepOrder: chain.currentStep.stepOrder, label: chain.currentStep.label },
      },
    });
  });
  return getReleaseRequest(projectId, requestId, webUser);
}

/** The valuation PDF's decision block: the active decision and its retention split. */
export function pdfReleaseDecision(
  decisions: Array<{ id: string; decision: string; reversesDecisionId: string | null; approvedDisbursementAmountNgn: Prisma.Decimal; retentionWithheldNgn: Prisma.Decimal }>,
  retentionPercentage: Prisma.Decimal | null
) {
  const active = decisions.find((d) => !d.reversesDecisionId && !decisions.some((o) => o.reversesDecisionId === d.id));
  if (!active) return null;
  const approved = Number(active.approvedDisbursementAmountNgn);
  const withheld = Number(active.retentionWithheldNgn);
  return {
    decision: active.decision,
    approvedNgn: approved,
    retentionWithheldNgn: withheld,
    netReleasedNgn: roundNgn2(approved - withheld),
    retentionPercentage: withheld > 0 && retentionPercentage !== null ? Number(retentionPercentage) : null,
  };
}

/** For the decision route: the tranche the retention valuation is anchored on. */
export async function retentionValuationTranche(projectId: string, valuationId: string) {
  await assertModuleOn(projectId, 'retention');
  const v = await prisma.valuationReport.findFirst({ where: { id: valuationId, projectId, source: 'RETENTION_RELEASE' } });
  if (!v) throw new AppError('Valuation not found', 404, 'VALUATION_REPORT_NOT_FOUND');
  return v.trancheId;
}
