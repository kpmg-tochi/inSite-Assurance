import { Prisma } from '@prisma/client';
import {
  assertIpcTransition,
  canIpcTransition,
  CertificationComputation,
  CertifyIpcValuationRequest,
  CreateMonitorQueryRequest,
  derivePortfolioHealth,
  EvidenceStrengthRating,
  IpcAction,
  IpcClaimDto,
  IpcClaimStatus,
  LenderTrancheDecisionRequest,
  OPEN_IPC_STATUSES,
  ProfessionalLicenseType,
  ProvidedEvidenceItem,
  RatingEngine,
  resolveRatingLabels,
  ResolveMonitorQueryRequest,
  RespondMonitorQueryRequest,
  ReverseTrancheDecisionRequest,
  SubmitIpcClaimRequest,
  UpdateConditionPrecedentStatusRequest,
  WaiveConditionPrecedentRequest,
  WithdrawIpcClaimRequest,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { hasWebPermission, WebJwtPayload } from '../../middleware/auth.middleware';
import { azureOpenAiService } from '../../integrations/azure-openai.service';
import { generateValuationReportPdfBuffer } from '../../integrations/pdf-report.service';
import { assertProjectObjectKey } from '../../integrations/storage.service';
import { parseTenantBranding } from '../rbac/rbac.service';
import { recordAuditEvent } from '../audit/audit.service';
import { createMobileNotification } from '../notifications/notifications.service';
import { markNotificationsActioned } from '../notifications/notificationActions';
import { getEvidenceForBoqItems } from '../evidence/evidenceProvider';
import {
  loadBoqItemInProject,
  loadConditionInTranche,
  loadIpcInProject,
  loadLineItemInIpc,
  loadQueryInIpc,
  loadTrancheInProject,
  loadValuationReportInProject,
} from '../../utils/ownership';
import {
  serializeMonitorQuery,
  serializeSupportingDocument,
  serializeTranche,
  serializeTrancheDecision,
  serializeValuationReport,
} from '../../utils/serializers';
import { evaluateIpcLines, ModelRater, ReconciliationLineInput } from './reconciliationEngine';

type Tx = Prisma.TransactionClient;

const CERTIFY = 'ipc:certify_valuation';
const APPROVE = 'tranche:approve_disbursement';

/** Clock skew tolerated when checking that a claim period does not end in the future. */
const PERIOD_END_SKEW_MS = 5 * 60 * 1000;
/** Half a kobo: amounts are compared after rounding to two decimals. */
const NGN_EPSILON = 0.005;

const roundNgn = (n: number) => Math.round(n * 100) / 100;
const actorName = (u: WebJwtPayload) => `${u.fullName} (${u.roleName})`;
const fmtNgn = (n: number) =>
  `NGN ${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---------------------------------------------------------------------------
// Model rater. Injectable so tests can stub the provider.
// ---------------------------------------------------------------------------

const defaultModelRater: ModelRater = (input) => azureOpenAiService.rateIpcLines(input);
let modelRater: ModelRater = defaultModelRater;

/** Test hook: replace the AI rater. Pass null to restore the default. */
export function setReconciliationModelRater(rater: ModelRater | null): void {
  modelRater = rater ?? defaultModelRater;
}

// ---------------------------------------------------------------------------
// Locks, transitions, permissions
// ---------------------------------------------------------------------------

/** Loads the IPC within the project and takes a row lock until the transaction ends. */
async function lockIpc(tx: Tx, projectId: string, ipcId: string) {
  await loadIpcInProject(tx, projectId, ipcId);
  await tx.$queryRaw`SELECT id FROM "IpcClaim" WHERE id = ${ipcId}::uuid FOR UPDATE`;
  return tx.ipcClaim.findUniqueOrThrow({ where: { id: ipcId } });
}

async function lockTranche(tx: Tx, trancheId: string) {
  await tx.$queryRaw`SELECT id FROM "FacilityTranche" WHERE id = ${trancheId}::uuid FOR UPDATE`;
  return tx.facilityTranche.findUniqueOrThrow({
    where: { id: trancheId },
    include: { conditionsPrecedent: true },
  });
}

/** D-3.1: the segregated permissions are checked from role permissions only, never by bypass. */
function holdsExplicitly(webUser: WebJwtPayload, permission: string): boolean {
  return webUser.permissions.includes(permission);
}

function requireExplicit(webUser: WebJwtPayload, permission: string) {
  if (!holdsExplicitly(webUser, permission)) {
    throw new AppError(
      `This action requires the ${permission} permission on your role`,
      403,
      'FORBIDDEN_PERMISSION'
    );
  }
}

async function countOutstandingQueries(db: Tx | typeof prisma, ipcId: string) {
  return db.monitorQuery.count({
    where: { ipcLineItem: { ipcClaimId: ipcId }, status: { in: ['OPEN', 'RESPONDED'] } },
  });
}

async function ratingLabelsForProject(db: Tx | typeof prisma, projectId: string) {
  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { tenant: { select: { evidenceRatingLabels: true } } },
  });
  return resolveRatingLabels(project.tenant.evidenceRatingLabels);
}

/** Project health follows the latest IPC that has not been withdrawn. */
async function refreshProjectHealth(tx: Tx, projectId: string) {
  const latest = await tx.ipcClaim.findFirst({
    where: { projectId, status: { not: 'REJECTED_WITHDRAWN' } },
    orderBy: { ipcNumber: 'desc' },
    include: { lineItems: { select: { aiEvidenceRating: true, missingHoldPointFlag: true } } },
  });
  const health =
    latest && latest.status !== 'SUBMITTED'
      ? derivePortfolioHealth(latest.lineItems)
      : 'EVIDENCE_PARTIAL';
  await tx.project.update({ where: { id: projectId }, data: { portfolioHealth: health } });
  return health;
}

/** Budget-weighted mean of BOQ certified percentages. */
async function refreshCertifiedProgress(tx: Tx, projectId: string) {
  const items = await tx.boqItem.findMany({
    where: { projectId },
    select: { budgetedCostNgn: true, cumulativeCertifiedPct: true },
  });
  const totalBudget = items.reduce((s, i) => s + Number(i.budgetedCostNgn), 0);
  const pct =
    totalBudget > 0
      ? items.reduce((s, i) => s + Number(i.budgetedCostNgn) * Number(i.cumulativeCertifiedPct), 0) /
        totalBudget
      : 0;
  const rounded = Math.round(pct * 100) / 100;
  await tx.project.update({ where: { id: projectId }, data: { certifiedProgressPct: rounded } });
  return rounded;
}

function cpSnapshot(cps: Prisma.ConditionPrecedentGetPayload<object>[]) {
  return cps.map((cp) => ({
    id: cp.id,
    referenceCode: cp.referenceCode,
    isMandatoryForRelease: cp.isMandatoryForRelease,
    status: cp.status,
  }));
}

function blockingConditions(cps: Prisma.ConditionPrecedentGetPayload<object>[]) {
  return cps.filter(
    (cp) => cp.isMandatoryForRelease && (cp.status === 'PENDING' || cp.status === 'BREACHED')
  );
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

/**
 * Oversight roles see AI rationale, the visit-planner queue and the corroborating field evidence.
 * Everyone else (for example a contractor answering a query) sees their claim, the rating and
 * the queries, but not other parties' evidence detail.
 */
function canSeeOversightDetail(webUser: WebJwtPayload) {
  return hasWebPermission(webUser, 'ipc:trigger_ai_reconcile', CERTIFY, APPROVE, 'audit:view_ledger');
}

const IPC_INCLUDE = {
  tranche: { include: { conditionsPrecedent: true } },
  supportingDocuments: true,
  valuationReports: {
    orderBy: { revisionNumber: 'asc' },
    include: { trancheDecisions: true },
  },
  lineItems: {
    orderBy: { boqItem: { wbsCode: 'asc' } },
    include: { queries: { orderBy: { createdAt: 'desc' } }, boqItem: true },
  },
} satisfies Prisma.IpcClaimInclude;

type IpcRow = Prisma.IpcClaimGetPayload<{ include: typeof IPC_INCLUDE }>;

interface Viewer {
  webUser: WebJwtPayload;
  hasLicence: boolean;
}

async function loadViewer(webUser: WebJwtPayload): Promise<Viewer> {
  const user = await prisma.user.findUnique({
    where: { id: webUser.userId },
    select: { professionalLicenseType: true, professionalLicenseNumber: true },
  });
  return {
    webUser,
    hasLicence: Boolean(user?.professionalLicenseType && user?.professionalLicenseNumber?.trim()),
  };
}

function liveRevision(ipc: IpcRow) {
  return ipc.valuationReports.filter((r) => !r.supersededAt).at(-1) ?? null;
}

function activeDecisionOf(report: IpcRow['valuationReports'][number] | null) {
  if (!report) return null;
  const decisions = report.trancheDecisions;
  return (
    decisions.find(
      (d) => !d.reversesDecisionId && !decisions.some((o) => o.reversesDecisionId === d.id)
    ) ?? null
  );
}

function computeActions(ipc: IpcRow, viewer: Viewer): IpcClaimDto['actions'] {
  const u = viewer.webUser;
  const status = ipc.status as IpcClaimStatus;
  const queries = ipc.lineItems.flatMap((l) => l.queries);
  const outstanding = queries.filter((q) => q.status === 'OPEN' || q.status === 'RESPONDED').length;
  const openForResponse = queries.filter((q) => q.status === 'OPEN').length;
  const live = liveRevision(ipc);
  const active = activeDecisionOf(live);

  const gate = (checks: Array<[boolean, string]>) => {
    const failed = checks.find(([ok]) => !ok);
    return { allowed: !failed, reason: failed ? failed[1] : null };
  };
  const state = (action: IpcAction): [boolean, string] => [
    canIpcTransition(status, action),
    `Not available while the IPC is ${status.replace(/_/g, ' ').toLowerCase()}.`,
  ];

  return {
    reconcile: gate([
      [hasWebPermission(u, 'ipc:trigger_ai_reconcile'), 'Requires permission to run reconciliation.'],
      state('reconcile'),
      [status !== 'QUERIED_BY_MONITOR' || outstanding === 0, 'Resolve all open queries first.'],
    ]),
    raiseQuery: gate([
      [hasWebPermission(u, 'reports:raise_query'), 'Requires permission to raise queries.'],
      state('raise_query'),
      [
        status !== 'MONITOR_CERTIFIED' || holdsExplicitly(u, CERTIFY),
        'Only a certifier can reopen a certified IPC.',
      ],
    ]),
    respondQuery: gate([
      [hasWebPermission(u, 'reports:respond_query'), 'Requires permission to respond to queries.'],
      state('respond_query'),
      [openForResponse > 0, 'No open queries to respond to.'],
    ]),
    resolveQuery: gate([
      [hasWebPermission(u, 'reports:raise_query'), 'Requires permission to resolve queries.'],
      state('resolve_query'),
      [outstanding > 0, 'No outstanding queries.'],
    ]),
    certify: gate([
      [holdsExplicitly(u, CERTIFY), 'Your role does not hold the certify permission.'],
      state('certify'),
      [outstanding === 0, 'Resolve all open queries before certifying.'],
      [viewer.hasLicence, 'Add your professional licence to your profile to certify.'],
    ]),
    decide: gate([
      [holdsExplicitly(u, APPROVE), 'Your role does not hold the disbursement approval permission.'],
      state('decide'),
      [!live || live.certifiedByUserId !== u.userId, 'You certified this valuation, so you cannot record the lender decision on it.'],
    ]),
    reverseDecision: gate([
      [holdsExplicitly(u, APPROVE), 'Your role does not hold the disbursement approval permission.'],
      state('reverse_decision'),
      [Boolean(active), 'No active decision to reverse.'],
    ]),
    withdraw: gate([
      [hasWebPermission(u, 'ipc:submit_claim'), 'Requires permission to submit claims.'],
      state('withdraw'),
    ]),
  };
}

function serializeIpc(
  ipc: IpcRow,
  viewer: Viewer,
  evidence: ProvidedEvidenceItem[] | null
): IpcClaimDto {
  const oversight = canSeeOversightDetail(viewer.webUser);
  const live = liveRevision(ipc);
  const active = activeDecisionOf(live);

  const lineItems = ipc.lineItems.map((li) => ({
    id: li.id,
    ipcClaimId: li.ipcClaimId,
    boqItemId: li.boqItemId,
    previousCertifiedPct: Number(li.previousCertifiedPct),
    contractorClaimedPct: Number(li.contractorClaimedPct),
    contractorClaimedNgn: Number(li.contractorClaimedNgn),
    contractorRemarks: li.contractorRemarks,
    aiEvidenceRating: li.aiEvidenceRating as EvidenceStrengthRating,
    aiRationale: oversight ? li.aiRationale : null,
    visitPlannerFlag: oversight ? li.visitPlannerFlag : false,
    visitPlannerReason: oversight ? li.visitPlannerReason : null,
    missingHoldPointFlag: li.missingHoldPointFlag,
    highestCorroboratingRoleName: li.highestCorroboratingRoleName,
    highestCorroboratingWeight: li.highestCorroboratingWeight,
    corroboratingEvidenceLogIds: oversight ? ((li.corroboratingEvidenceLogIds as string[]) ?? []) : [],
    evidenceQuantityTotal: li.evidenceQuantityTotal === null ? null : Number(li.evidenceQuantityTotal),
    evidenceCoveragePct: li.evidenceCoveragePct === null ? null : Number(li.evidenceCoveragePct),
    ratingEngine: (li.ratingEngine as RatingEngine | null) ?? null,
    ruleCapsApplied: oversight ? ((li.ruleCapsApplied as string[]) ?? []) : [],
    monitorCertifiedPct: li.monitorCertifiedPct === null ? null : Number(li.monitorCertifiedPct),
    monitorCertifiedNgn: li.monitorCertifiedNgn === null ? null : Number(li.monitorCertifiedNgn),
    monitorRemarks: li.monitorRemarks,
    boqItem: {
      id: li.boqItem.id,
      trancheId: li.boqItem.trancheId,
      wbsCode: li.boqItem.wbsCode,
      section: li.boqItem.section,
      description: li.boqItem.description,
      unit: li.boqItem.unit,
      totalQuantity: Number(li.boqItem.totalQuantity),
      rateNgn: Number(li.boqItem.rateNgn),
      budgetedCostNgn: Number(li.boqItem.budgetedCostNgn),
      isHoldPoint: li.boqItem.isHoldPoint,
      holdPointInstruction: li.boqItem.holdPointInstruction,
      isOpaqueLumpSum: li.boqItem.isOpaqueLumpSum,
      opacityWarningReason: li.boqItem.opacityWarningReason,
      cumulativeCertifiedPct: Number(li.boqItem.cumulativeCertifiedPct),
    },
    evidence: oversight && evidence ? evidence.filter((e) => e.boqItemId === li.boqItemId) : [],
    queries: li.queries.map(serializeMonitorQuery),
  }));

  const smartVisitPlannerQueue = !oversight
    ? []
    : lineItems
        .filter((li) => li.visitPlannerFlag || li.missingHoldPointFlag)
        .map((li) => ({
          ipcLineItemId: li.id,
          wbsCode: li.boqItem.wbsCode,
          description: li.boqItem.description,
          claimedAmountNgn: li.contractorClaimedNgn,
          aiEvidenceRating: li.aiEvidenceRating,
          missingHoldPointFlag: li.missingHoldPointFlag,
          visitPlannerReason:
            li.visitPlannerReason || 'Requires physical verification by the independent monitor.',
        }));

  const revisions = ipc.valuationReports.map(serializeValuationReport);
  const liveDto = live ? revisions.find((r) => r.id === live.id) ?? null : null;

  return {
    id: ipc.id,
    projectId: ipc.projectId,
    trancheId: ipc.trancheId,
    ipcNumber: ipc.ipcNumber,
    periodStart: ipc.periodStart.toISOString(),
    periodEnd: ipc.periodEnd.toISOString(),
    contractorCoverNote: ipc.contractorCoverNote,
    totalClaimedAmountNgn: Number(ipc.totalClaimedAmountNgn),
    totalCertifiedNgn: ipc.totalCertifiedNgn === null ? null : Number(ipc.totalCertifiedNgn),
    status: ipc.status as IpcClaimStatus,
    aiExecutiveSummary: oversight ? ipc.aiExecutiveSummary : null,
    submittedByUserId: ipc.submittedByUserId,
    ratingEngine: (ipc.ratingEngine as RatingEngine | null) ?? null,
    ratingEngineDetail: oversight ? ipc.ratingEngineDetail : null,
    reconciledAt: ipc.reconciledAt ? ipc.reconciledAt.toISOString() : null,
    reconciliationPending: ipc.status === 'SUBMITTED',
    submittedAt: ipc.submittedAt.toISOString(),
    updatedAt: ipc.updatedAt.toISOString(),
    tranche: serializeTranche(ipc.tranche),
    supportingDocuments: ipc.supportingDocuments.map(serializeSupportingDocument),
    valuationReport: liveDto,
    valuationRevisions: revisions,
    activeDecision: active && liveDto ? liveDto.decisions.find((d) => d.id === active.id) ?? null : null,
    lineItems,
    smartVisitPlannerQueue,
    actions: computeActions(ipc, viewer),
  };
}

export async function listProjectIpcClaims(projectId: string, webUser: WebJwtPayload) {
  const [ipcs, viewer] = await Promise.all([
    prisma.ipcClaim.findMany({
      where: { projectId },
      orderBy: { ipcNumber: 'desc' },
      include: IPC_INCLUDE,
    }),
    loadViewer(webUser),
  ]);
  return ipcs.map((ipc) => serializeIpc(ipc, viewer, null));
}

export async function getIpcReconciliationDetails(
  projectId: string,
  ipcId: string,
  webUser: WebJwtPayload
): Promise<IpcClaimDto> {
  await loadIpcInProject(prisma, projectId, ipcId);
  const [ipc, viewer] = await Promise.all([
    prisma.ipcClaim.findUniqueOrThrow({ where: { id: ipcId }, include: IPC_INCLUDE }),
    loadViewer(webUser),
  ]);
  const evidence = canSeeOversightDetail(webUser)
    ? await getEvidenceForBoqItems(
        projectId,
        ipc.lineItems.map((l) => l.boqItemId),
        ipc.periodEnd
      )
    : null;
  return serializeIpc(ipc, viewer, evidence);
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

function assertReconcilable(status: IpcClaimStatus, outstandingQueries: number) {
  assertIpcTransition(status, 'reconcile');
  if (status === 'QUERIED_BY_MONITOR' && outstandingQueries > 0) {
    throw new AppError(
      'Resolve all open queries before re-running reconciliation',
      409,
      'QUERIES_OUTSTANDING'
    );
  }
}

/**
 * Rates every line of the IPC. The model call (or rules engine) runs outside the transaction; the
 * write re-checks the state under a row lock and refuses if the claim changed in the meantime.
 */
export async function runAiReconciliationForIpc(
  projectId: string,
  ipcId: string,
  triggeredBy?: WebJwtPayload
) {
  const ipc = await prisma.ipcClaim.findFirst({
    where: { id: ipcId, projectId },
    include: { project: { include: { tenant: true } }, lineItems: { include: { boqItem: true } } },
  });
  if (!ipc) throw new AppError('IPC claim not found', 404, 'IPC_NOT_FOUND');
  assertReconcilable(ipc.status as IpcClaimStatus, await countOutstandingQueries(prisma, ipc.id));

  const labels = resolveRatingLabels(ipc.project.tenant.evidenceRatingLabels);
  const evidence = await getEvidenceForBoqItems(
    projectId,
    ipc.lineItems.map((l) => l.boqItemId),
    ipc.periodEnd
  );
  const lines: ReconciliationLineInput[] = ipc.lineItems.map((li) => ({
    ipcLineItemId: li.id,
    boqItemId: li.boqItemId,
    wbsCode: li.boqItem.wbsCode,
    description: li.boqItem.description,
    unit: li.boqItem.unit,
    totalQuantity: Number(li.boqItem.totalQuantity),
    budgetedCostNgn: Number(li.boqItem.budgetedCostNgn),
    isHoldPoint: li.boqItem.isHoldPoint,
    isOpaqueLumpSum: li.boqItem.isOpaqueLumpSum,
    previousCertifiedPct: Number(li.previousCertifiedPct),
    contractorClaimedPct: Number(li.contractorClaimedPct),
    contractorClaimedNgn: Number(li.contractorClaimedNgn),
    contractorRemarks: li.contractorRemarks,
  }));

  const result = await evaluateIpcLines({
    projectName: ipc.project.name,
    ipcNumber: ipc.ipcNumber,
    periodStart: ipc.periodStart,
    periodEnd: ipc.periodEnd,
    lines,
    evidence,
    labels,
    model: modelRater,
  });

  await prisma.$transaction(async (tx) => {
    const locked = await lockIpc(tx, projectId, ipcId);
    assertReconcilable(locked.status as IpcClaimStatus, await countOutstandingQueries(tx, ipcId));
    if (locked.updatedAt.getTime() !== ipc.updatedAt.getTime()) {
      throw new AppError(
        'The claim changed while reconciliation was running. Run it again.',
        409,
        'IPC_CHANGED_DURING_RECONCILIATION'
      );
    }
    const next = assertIpcTransition(locked.status as IpcClaimStatus, 'reconcile');

    for (const line of result.lines) {
      await tx.ipcLineItem.update({
        where: { id: line.ipcLineItemId },
        data: {
          aiEvidenceRating: line.rating,
          aiRationale: line.rationale,
          visitPlannerFlag: line.visitPlannerFlag,
          visitPlannerReason: line.visitPlannerReason,
          missingHoldPointFlag: line.missingHoldPointFlag,
          highestCorroboratingRoleName: line.highestCorroboratingRoleName,
          highestCorroboratingWeight: line.highestCorroboratingWeight,
          corroboratingEvidenceLogIds: line.corroboratingEvidenceLogIds as unknown as Prisma.InputJsonValue,
          evidenceQuantityTotal: line.evidenceQuantityTotal,
          evidenceCoveragePct: line.evidenceCoveragePct,
          ratingEngine: line.ratingEngine,
          ruleCapsApplied: line.ruleCapsApplied as unknown as Prisma.InputJsonValue,
        },
      });
    }

    await tx.ipcClaim.update({
      where: { id: ipcId },
      data: {
        status: next,
        aiExecutiveSummary: result.executiveSummary,
        ratingEngine: result.engine,
        ratingEngineDetail: result.engineDetail,
        reconciledAt: new Date(),
      },
    });

    const health = await refreshProjectHealth(tx, projectId);
    const counts = Object.fromEntries(
      (['SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED', 'CONTRADICTED'] as const).map((r) => [
        r,
        result.lines.filter((l) => l.rating === r).length,
      ])
    );

    await recordAuditEvent(tx, {
      projectId,
      actorType: 'AI_SYSTEM',
      actorId:
        result.engine === 'AZURE_OPENAI' ? `AZURE_OPENAI:${result.engineDetail}` : 'RULES_ENGINE',
      actorDisplayName:
        result.engine === 'AZURE_OPENAI'
          ? `Azure OpenAI reconciliation (${result.engineDetail})`
          : 'Rules engine reconciliation',
      action: 'AI_RECONCILIATION_COMPLETED',
      summaryText: result.executiveSummary,
      payload: {
        ipcId,
        ipcNumber: ipc.ipcNumber,
        ratingEngine: result.engine,
        ratingEngineDetail: result.engineDetail,
        ratingCounts: counts,
        portfolioHealth: health,
        triggeredByUserId: triggeredBy?.userId ?? null,
      },
    });
  });

  return result;
}

/** Route entry point: re-runs reconciliation and returns the refreshed IPC. */
export async function rerunReconciliation(projectId: string, ipcId: string, webUser: WebJwtPayload) {
  await runAiReconciliationForIpc(projectId, ipcId, webUser);
  return getIpcReconciliationDetails(projectId, ipcId, webUser);
}

// ---------------------------------------------------------------------------
// Claim submission and withdrawal
// ---------------------------------------------------------------------------

export async function submitContractorIpcClaim(params: {
  projectId: string;
  webUser: WebJwtPayload;
  input: SubmitIpcClaimRequest;
}): Promise<IpcClaimDto> {
  const { projectId, webUser, input } = params;

  const periodEnd = new Date(input.periodEnd);
  if (periodEnd.getTime() > Date.now() + PERIOD_END_SKEW_MS) {
    throw new AppError('The claim period cannot end in the future', 422, 'PERIOD_IN_FUTURE');
  }
  for (const doc of input.supportingDocuments) {
    assertProjectObjectKey(doc.objectKey, webUser.tenantId, projectId);
    if (doc.boqItemId) await loadBoqItemInProject(prisma, projectId, doc.boqItemId);
  }

  const created = await prisma.$transaction(async (tx) => {
    // Serialises IPC numbering and the one-open-IPC-per-tranche check for this project.
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId}::uuid FOR UPDATE`;
    const tranche = await loadTrancheInProject(tx, projectId, input.trancheId);
    if (tranche.isReleased) {
      throw new AppError('This tranche has been fully released', 409, 'TRANCHE_FULLY_RELEASED');
    }
    const open = await tx.ipcClaim.findFirst({
      where: { trancheId: tranche.id, status: { in: OPEN_IPC_STATUSES } },
      select: { ipcNumber: true, status: true },
    });
    if (open) {
      throw new AppError(
        `IPC #${open.ipcNumber} on this tranche is still open (${open.status}). Only one open IPC per tranche is allowed.`,
        409,
        'TRANCHE_HAS_OPEN_IPC'
      );
    }

    const boqItems = await tx.boqItem.findMany({
      where: { projectId, id: { in: input.lineItems.map((l) => l.boqItemId) } },
    });
    const boqById = new Map(boqItems.map((b) => [b.id, b]));

    let total = 0;
    const lines = input.lineItems.map((line) => {
      const boq = boqById.get(line.boqItemId);
      if (!boq) throw new AppError('BOQ item not found', 404, 'BOQ_ITEM_NOT_FOUND');
      if (boq.trancheId !== tranche.id) {
        throw new AppError(
          `BOQ item ${boq.wbsCode} is not mapped to this tranche`,
          422,
          'BOQ_ITEM_NOT_IN_TRANCHE'
        );
      }
      const prev = Number(boq.cumulativeCertifiedPct);
      if (!(line.claimedCumulativePct > prev) || line.claimedCumulativePct > 100) {
        throw new AppError(
          `Claimed percentage for ${boq.wbsCode} must be above the certified ${prev}% and at most 100%`,
          422,
          'CLAIM_OUT_OF_BOUNDS'
        );
      }
      const amount = roundNgn(((line.claimedCumulativePct - prev) / 100) * Number(boq.budgetedCostNgn));
      total += amount;
      return {
        boqItemId: boq.id,
        previousCertifiedPct: prev,
        contractorClaimedPct: line.claimedCumulativePct,
        contractorClaimedNgn: amount,
        contractorRemarks: line.contractorRemarks ?? null,
      };
    });
    total = roundNgn(total);

    const last = await tx.ipcClaim.aggregate({ where: { projectId }, _max: { ipcNumber: true } });
    const ipcNumber = (last._max.ipcNumber ?? 0) + 1;

    const ipc = await tx.ipcClaim.create({
      data: {
        projectId,
        trancheId: tranche.id,
        ipcNumber,
        periodStart: new Date(input.periodStart),
        periodEnd,
        contractorCoverNote: input.contractorCoverNote ?? null,
        totalClaimedAmountNgn: total,
        status: 'SUBMITTED',
        submittedByUserId: webUser.userId,
        lineItems: { create: lines },
        supportingDocuments: {
          create: input.supportingDocuments.map((doc) => ({
            title: doc.title,
            mediaType: doc.mediaType,
            objectKey: doc.objectKey,
            boqItemId: doc.boqItemId ?? null,
          })),
        },
      },
    });

    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'IPC_SUBMITTED',
      summaryText: `Submitted IPC #${ipcNumber} on ${tranche.name} claiming ${fmtNgn(total)} across ${lines.length} BOQ line item(s).`,
      payload: { ipcId: ipc.id, ipcNumber, trancheId: tranche.id, totalClaimedAmountNgn: total },
    });
    return ipc;
  });

  // Reconciliation runs after the claim is saved. A failure leaves the claim SUBMITTED
  // (reconciliationPending) for a retry; it never turns a saved claim into a 500.
  try {
    await runAiReconciliationForIpc(projectId, created.id);
  } catch (error) {
    console.error(`[reconciliation] IPC ${created.id} saved but reconciliation failed:`, error);
  }
  return getIpcReconciliationDetails(projectId, created.id, webUser);
}

export async function withdrawIpcClaim(params: {
  projectId: string;
  ipcId: string;
  webUser: WebJwtPayload;
  input: WithdrawIpcClaimRequest;
}) {
  const { projectId, ipcId, webUser, input } = params;
  await prisma.$transaction(async (tx) => {
    const ipc = await lockIpc(tx, projectId, ipcId);
    const next = assertIpcTransition(ipc.status as IpcClaimStatus, 'withdraw');
    await tx.ipcClaim.update({ where: { id: ipcId }, data: { status: next } });
    await refreshProjectHealth(tx, projectId);
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'IPC_WITHDRAWN',
      summaryText: `Withdrew IPC #${ipc.ipcNumber}: ${input.reason}`,
      payload: { ipcId, ipcNumber: ipc.ipcNumber, previousStatus: ipc.status, reason: input.reason },
    });
  });
  return getIpcReconciliationDetails(projectId, ipcId, webUser);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function createMonitorLineQuery(params: {
  projectId: string;
  ipcId: string;
  webUser: WebJwtPayload;
  input: CreateMonitorQueryRequest;
}) {
  const { projectId, ipcId, webUser, input } = params;
  return prisma.$transaction(async (tx) => {
    const ipc = await lockIpc(tx, projectId, ipcId);
    const from = ipc.status as IpcClaimStatus;
    const next = assertIpcTransition(from, 'raise_query');
    const reopening = from === 'MONITOR_CERTIFIED';
    if (reopening && !holdsExplicitly(webUser, CERTIFY)) {
      throw new AppError('Only a certifier can reopen a certified IPC', 403, 'REOPEN_REQUIRES_CERTIFIER');
    }
    const line = await loadLineItemInIpc(tx, ipcId, input.ipcLineItemId);

    const query = await tx.monitorQuery.create({
      data: {
        ipcLineItemId: line.id,
        status: 'OPEN',
        queryReason: input.queryReason,
        requestedProofTypes: input.requestedProofTypes as unknown as Prisma.InputJsonValue,
        raisedByUserId: webUser.userId,
      },
    });
    await tx.ipcClaim.update({ where: { id: ipcId }, data: { status: next } });

    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'MONITOR_QUERY_RAISED',
      summaryText: `${reopening ? `Reopened certified IPC #${ipc.ipcNumber} with a query` : 'Raised query'} on [${line.boqItem.wbsCode}]: "${input.queryReason}"`,
      payload: { queryId: query.id, ipcId, ipcLineItemId: line.id, reopenedFromCertified: reopening },
    });

    await createMobileNotification(tx, {
      projectId,
      type: 'REPORT_QUERY',
      actionType: 'OPEN_WBS_CHAT',
      requiresAction: true,
      title: `Clarification Requested · WBS ${line.boqItem.wbsCode}`,
      message: `${webUser.fullName}: ${input.queryReason}`,
      metadata: {
        monitorQueryId: query.id,
        wbsItemId: line.boqItemId,
        wbsCode: line.boqItem.wbsCode,
        requestedProofTypes: input.requestedProofTypes,
      },
    });

    await tx.wbsChatMessage.create({
      data: {
        projectId,
        boqItemId: line.boqItemId,
        senderName: webUser.fullName,
        senderRole: 'MONITOR',
        messageType: 'MONITOR_QUERY',
        textContent: input.queryReason,
      },
    });

    return serializeMonitorQuery(query);
  });
}

export async function respondToMonitorLineQuery(params: {
  projectId: string;
  ipcId: string;
  queryId: string;
  webUser: WebJwtPayload;
  input: RespondMonitorQueryRequest;
}) {
  const { projectId, ipcId, queryId, webUser, input } = params;
  for (const doc of input.attachedDocuments) {
    assertProjectObjectKey(doc.objectKey, webUser.tenantId, projectId);
    if (doc.boqItemId) await loadBoqItemInProject(prisma, projectId, doc.boqItemId);
  }

  return prisma.$transaction(async (tx) => {
    const ipc = await lockIpc(tx, projectId, ipcId);
    assertIpcTransition(ipc.status as IpcClaimStatus, 'respond_query');
    const query = await loadQueryInIpc(tx, ipcId, queryId);
    if (query.status !== 'OPEN') {
      throw new AppError('Only an open query can be answered', 409, 'QUERY_NOT_OPEN');
    }

    const line = query.ipcLineItem;
    const revised = input.revisedClaimedCumulativePct;
    if (revised !== undefined) {
      const prev = Number(line.previousCertifiedPct);
      if (!(revised > prev) || revised > 100) {
        throw new AppError(
          `Revised percentage must be above the certified ${prev}% and at most 100%`,
          422,
          'CLAIM_OUT_OF_BOUNDS'
        );
      }
    }

    const updated = await tx.monitorQuery.update({
      where: { id: queryId },
      data: {
        status: 'RESPONDED',
        contractorResponseText: input.contractorResponseText,
        revisedClaimedCumulativePct: revised ?? null,
        attachedDocumentsJson: input.attachedDocuments as unknown as Prisma.InputJsonValue,
        respondedAt: new Date(),
        respondedByUserId: webUser.userId,
      },
    });

    if (revised !== undefined) {
      const prev = Number(line.previousCertifiedPct);
      const amount = roundNgn(((revised - prev) / 100) * Number(line.boqItem.budgetedCostNgn));
      await tx.ipcLineItem.update({
        where: { id: line.id },
        data: { contractorClaimedPct: revised, contractorClaimedNgn: amount },
      });
      const sum = await tx.ipcLineItem.aggregate({
        where: { ipcClaimId: ipcId },
        _sum: { contractorClaimedNgn: true },
      });
      await tx.ipcClaim.update({
        where: { id: ipcId },
        data: { totalClaimedAmountNgn: roundNgn(Number(sum._sum.contractorClaimedNgn ?? 0)) },
      });
    }

    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'CONTRACTOR_QUERY_RESPONDED',
      summaryText: `Responded to query on [${line.boqItem.wbsCode}]${revised !== undefined ? `, revising the claim to ${revised}%` : ''}.`,
      payload: { queryId, ipcId, revisedClaimedCumulativePct: revised ?? null },
    });
    await markNotificationsActioned(tx, projectId, { kind: 'MONITOR_QUERY_ANSWERED', monitorQueryId: queryId }, {
      userId: webUser.userId,
      name: webUser.fullName,
    });

    return serializeMonitorQuery(updated);
  });
}

export async function resolveMonitorLineQuery(params: {
  projectId: string;
  ipcId: string;
  queryId: string;
  webUser: WebJwtPayload;
  input: ResolveMonitorQueryRequest;
}) {
  const { projectId, ipcId, queryId, webUser, input } = params;
  const { query, remaining } = await prisma.$transaction(async (tx) => {
    const ipc = await lockIpc(tx, projectId, ipcId);
    assertIpcTransition(ipc.status as IpcClaimStatus, 'resolve_query');
    const existing = await loadQueryInIpc(tx, ipcId, queryId);
    if (existing.status === 'RESOLVED') {
      throw new AppError('This query is already resolved', 409, 'QUERY_ALREADY_RESOLVED');
    }
    const resolved = await tx.monitorQuery.update({
      where: { id: queryId },
      data: {
        status: 'RESOLVED',
        resolutionNote: input.resolutionNote,
        resolvedAt: new Date(),
        resolvedByUserId: webUser.userId,
      },
    });
    const left = await countOutstandingQueries(tx, ipcId);
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'MONITOR_QUERY_RESOLVED',
      summaryText: `Resolved query on [${existing.ipcLineItem.boqItem.wbsCode}]: "${input.resolutionNote}"${left === 0 ? '. All queries on the IPC are resolved.' : ''}`,
      payload: { queryId, ipcId, previousStatus: existing.status, outstandingQueries: left },
    });
    await markNotificationsActioned(tx, projectId, { kind: 'MONITOR_QUERY_ANSWERED', monitorQueryId: queryId }, {
      userId: webUser.userId,
      name: webUser.fullName,
    });
    return { query: resolved, remaining: left };
  });

  // When the last query is resolved, reconciliation re-runs and the IPC returns to AI_RECONCILED.
  // If it fails the IPC stays QUERIED_BY_MONITOR with no outstanding queries: certification and
  // a manual re-run remain available.
  let reconciliationPending = false;
  if (remaining === 0) {
    try {
      await runAiReconciliationForIpc(projectId, ipcId, webUser);
    } catch (error) {
      reconciliationPending = true;
      console.error(`[reconciliation] re-run after resolving queries on IPC ${ipcId} failed:`, error);
    }
  }
  return {
    query: serializeMonitorQuery(query),
    outstandingQueries: remaining,
    reconciliationPending,
    ipc: await getIpcReconciliationDetails(projectId, ipcId, webUser),
  };
}

// ---------------------------------------------------------------------------
// Certification
// ---------------------------------------------------------------------------

async function computeCertification(
  tx: Tx,
  ipcId: string,
  webUser: WebJwtPayload,
  input: CertifyIpcValuationRequest
): Promise<CertificationComputation> {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: webUser.userId },
    select: { fullName: true, professionalLicenseType: true, professionalLicenseNumber: true },
  });
  const licenceNumber = user.professionalLicenseNumber?.trim();
  if (!user.professionalLicenseType || !licenceNumber) {
    throw new AppError(
      'Your profile has no professional licence. Add your licence type and number before certifying.',
      422,
      'CERTIFIER_LICENCE_MISSING'
    );
  }

  const lines = await tx.ipcLineItem.findMany({
    where: { ipcClaimId: ipcId },
    include: { boqItem: { select: { wbsCode: true, budgetedCostNgn: true } } },
  });
  const byId = new Map(lines.map((l) => [l.id, l]));
  const seen = new Set<string>();
  for (const v of input.lineValuations) {
    if (!byId.has(v.ipcLineItemId)) {
      throw new AppError('IPC line item not found', 404, 'IPC_LINE_ITEM_NOT_FOUND');
    }
    if (seen.has(v.ipcLineItemId)) {
      throw new AppError('Each line may be valued only once', 422, 'DUPLICATE_LINE_VALUATION');
    }
    seen.add(v.ipcLineItemId);
  }
  if (seen.size !== lines.length) {
    throw new AppError(
      `Every line must be valued: ${lines.length - seen.size} line(s) missing`,
      422,
      'INCOMPLETE_VALUATION'
    );
  }

  let totalCertified = 0;
  let totalClaimed = 0;
  const computed = input.lineValuations.map((v) => {
    const line = byId.get(v.ipcLineItemId)!;
    const prev = Number(line.previousCertifiedPct);
    const claimed = Number(line.contractorClaimedPct);
    const cert = v.monitorCertifiedCumulativePct;
    if (cert < prev || cert > claimed) {
      throw new AppError(
        `Certified percentage for ${line.boqItem.wbsCode} must be between the previous ${prev}% and the claimed ${claimed}%`,
        422,
        'CERTIFIED_PCT_OUT_OF_BOUNDS'
      );
    }
    const amount = roundNgn(((cert - prev) / 100) * Number(line.boqItem.budgetedCostNgn));
    totalCertified += amount;
    totalClaimed += Number(line.contractorClaimedNgn);
    return {
      ipcLineItemId: line.id,
      previousCertifiedPct: prev,
      contractorClaimedPct: claimed,
      monitorCertifiedPct: cert,
      monitorCertifiedNgn: amount,
    };
  });
  totalCertified = roundNgn(totalCertified);
  totalClaimed = roundNgn(totalClaimed);

  let recommended = 0;
  if (input.trancheRecommendation === 'SUPPORT_FULL_RELEASE') {
    recommended = totalCertified;
  } else if (input.trancheRecommendation === 'SUPPORT_WITH_HOLDBACK') {
    recommended = roundNgn(input.recommendedReleaseAmountNgn ?? 0);
    if (recommended > totalCertified + NGN_EPSILON) {
      throw new AppError(
        `The recommended release cannot exceed the total certified (${fmtNgn(totalCertified)})`,
        422,
        'RECOMMENDED_RELEASE_EXCEEDS_CERTIFIED'
      );
    }
  }

  const last = await tx.valuationReport.aggregate({
    where: { ipcClaimId: ipcId },
    _max: { revisionNumber: true },
  });

  return {
    lines: computed,
    totalClaimedNgn: totalClaimed,
    totalCertifiedNgn: totalCertified,
    recommendedReleaseAmountNgn: recommended,
    recommendedHoldbackAmountNgn: roundNgn(Math.max(0, totalClaimed - recommended)),
    certifierFullName: user.fullName,
    certifierLicenseType: user.professionalLicenseType as ProfessionalLicenseType,
    certifierLicenseNumber: licenceNumber,
    revisionNumber: (last._max.revisionNumber ?? 0) + 1,
  };
}

class DryRunRollback extends Error {
  constructor(readonly computation: CertificationComputation) {
    super('dry run');
  }
}

export async function certifyIpcValuationByMonitor(params: {
  projectId: string;
  ipcId: string;
  webUser: WebJwtPayload;
  input: CertifyIpcValuationRequest;
  dryRun?: boolean;
}) {
  const { projectId, ipcId, webUser, input } = params;
  requireExplicit(webUser, CERTIFY);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const ipc = await lockIpc(tx, projectId, ipcId);
      const next = assertIpcTransition(ipc.status as IpcClaimStatus, 'certify');
      if ((await countOutstandingQueries(tx, ipcId)) > 0) {
        throw new AppError('Resolve all open queries before certifying', 409, 'QUERIES_OUTSTANDING');
      }
      const comp = await computeCertification(tx, ipcId, webUser, input);
      if (params.dryRun) throw new DryRunRollback(comp);

      const now = new Date();
      await tx.valuationReport.updateMany({
        where: { ipcClaimId: ipcId, supersededAt: null },
        data: { supersededAt: now },
      });
      const report = await tx.valuationReport.create({
        data: {
          ipcClaimId: ipcId,
          revisionNumber: comp.revisionNumber,
          certifiedByUserId: webUser.userId,
          trancheRecommendation: input.trancheRecommendation,
          totalClaimedNgn: comp.totalClaimedNgn,
          totalCertifiedNgn: comp.totalCertifiedNgn,
          recommendedReleaseAmountNgn: comp.recommendedReleaseAmountNgn,
          recommendedHoldbackAmountNgn: comp.recommendedHoldbackAmountNgn,
          executiveCertificationSummary: input.executiveCertificationSummary,
          certifierFullName: comp.certifierFullName,
          certifierLicenseType: comp.certifierLicenseType,
          certifierLicenseNumber: comp.certifierLicenseNumber,
          reportPdfUrl: `/api/v1/projects/${projectId}/ipcs/${ipcId}/valuation-report.pdf`,
          certifiedAt: now,
        },
        include: { trancheDecisions: true },
      });

      const remarks = new Map(input.lineValuations.map((v) => [v.ipcLineItemId, v.monitorRemarks]));
      for (const line of comp.lines) {
        const updated = await tx.ipcLineItem.update({
          where: { id: line.ipcLineItemId },
          data: {
            monitorCertifiedPct: line.monitorCertifiedPct,
            monitorCertifiedNgn: line.monitorCertifiedNgn,
            monitorRemarks: remarks.get(line.ipcLineItemId) ?? null,
          },
        });
        // The only place a BOQ item's certified percentage changes.
        await tx.boqItem.update({
          where: { id: updated.boqItemId },
          data: { cumulativeCertifiedPct: line.monitorCertifiedPct },
        });
      }
      const progress = await refreshCertifiedProgress(tx, projectId);

      await tx.ipcClaim.update({
        where: { id: ipcId },
        data: { totalCertifiedNgn: comp.totalCertifiedNgn, status: next },
      });

      await recordAuditEvent(tx, {
        projectId,
        actorType: 'WEB_USER',
        actorId: webUser.userId,
        actorDisplayName: `${comp.certifierFullName} (${comp.certifierLicenseType} #${comp.certifierLicenseNumber})`,
        action: 'VALUATION_REPORT_CERTIFIED',
        summaryText:
          `Certified IPC #${ipc.ipcNumber} valuation revision ${comp.revisionNumber} (${input.trancheRecommendation}): ` +
          `certified ${fmtNgn(comp.totalCertifiedNgn)} of ${fmtNgn(comp.totalClaimedNgn)} claimed; ` +
          `recommended release ${fmtNgn(comp.recommendedReleaseAmountNgn)}, holdback ${fmtNgn(comp.recommendedHoldbackAmountNgn)}.`,
        payload: {
          valuationReportId: report.id,
          ipcId,
          revisionNumber: comp.revisionNumber,
          trancheRecommendation: input.trancheRecommendation,
          totalClaimedNgn: comp.totalClaimedNgn,
          totalCertifiedNgn: comp.totalCertifiedNgn,
          recommendedReleaseAmountNgn: comp.recommendedReleaseAmountNgn,
          recommendedHoldbackAmountNgn: comp.recommendedHoldbackAmountNgn,
          certifierLicenseType: comp.certifierLicenseType,
          certifierLicenseNumber: comp.certifierLicenseNumber,
          projectCertifiedProgressPct: progress,
        },
      });

      return { valuationReport: serializeValuationReport(report), computation: comp };
    });
    return { dryRun: false, ...result };
  } catch (error) {
    if (error instanceof DryRunRollback) {
      return { dryRun: true, valuationReport: null, computation: error.computation };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Lender decision and reversal
// ---------------------------------------------------------------------------

export async function recordLenderTrancheDecision(params: {
  projectId: string;
  trancheId: string;
  webUser: WebJwtPayload;
  input: LenderTrancheDecisionRequest;
}) {
  const { projectId, trancheId, webUser, input } = params;
  requireExplicit(webUser, APPROVE);

  return prisma.$transaction(async (tx) => {
    await loadTrancheInProject(tx, projectId, trancheId);
    const reportRef = await loadValuationReportInProject(tx, projectId, input.valuationReportId);
    if (reportRef.ipcClaim.trancheId !== trancheId) {
      throw new AppError('The valuation report belongs to a different tranche', 409, 'TRANCHE_MISMATCH');
    }

    const ipc = await lockIpc(tx, projectId, reportRef.ipcClaimId);
    const tranche = await lockTranche(tx, trancheId);
    const next = assertIpcTransition(ipc.status as IpcClaimStatus, 'decide');

    const report = await tx.valuationReport.findUniqueOrThrow({
      where: { id: reportRef.id },
      include: { trancheDecisions: true },
    });
    if (report.supersededAt) {
      throw new AppError('This valuation revision has been superseded', 409, 'VALUATION_SUPERSEDED');
    }
    const active = report.trancheDecisions.find(
      (d) => !d.reversesDecisionId && !report.trancheDecisions.some((o) => o.reversesDecisionId === d.id)
    );
    if (active) {
      throw new AppError('A decision has already been recorded on this valuation', 409, 'DECISION_ALREADY_RECORDED');
    }

    // D-3.1 segregation of duties.
    if (report.certifiedByUserId === webUser.userId) {
      throw new AppError(
        'You certified this valuation, so you cannot record the lender decision on it',
        403,
        'SEGREGATION_OF_DUTIES'
      );
    }

    // D-3.2 unmet mandatory Conditions Precedent block any release.
    if (input.decision !== 'HOLD') {
      const blocking = blockingConditions(tranche.conditionsPrecedent);
      if (blocking.length > 0) {
        throw new AppError(
          `Release is blocked by unmet mandatory conditions precedent: ${blocking.map((c) => `${c.referenceCode} (${c.status})`).join(', ')}. Satisfy or waive them first.`,
          409,
          'CONDITIONS_PRECEDENT_UNMET'
        );
      }
    }

    const recommended = Number(report.recommendedReleaseAmountNgn);
    const remaining = roundNgn(Number(tranche.allocatedAmountNgn) - Number(tranche.releasedAmountNgn));
    let approved = 0;
    if (input.decision === 'APPROVE_FULL') {
      approved = recommended;
      if (approved <= 0) {
        throw new AppError('The monitor recommended no release; record HOLD instead', 422, 'NOTHING_TO_RELEASE');
      }
    } else if (input.decision === 'APPROVE_WITH_HOLDBACK') {
      approved = roundNgn(input.approvedDisbursementAmountNgn ?? 0);
      if (approved > recommended + NGN_EPSILON) {
        throw new AppError(
          `The approved amount cannot exceed the recommended release (${fmtNgn(recommended)})`,
          422,
          'APPROVED_EXCEEDS_RECOMMENDED'
        );
      }
    }
    if (approved > remaining + NGN_EPSILON) {
      throw new AppError(
        `The approved amount exceeds the tranche's unreleased allocation (${fmtNgn(remaining)})`,
        422,
        'APPROVED_EXCEEDS_TRANCHE_REMAINING'
      );
    }
    const heldBack = roundNgn(Math.max(0, Number(report.totalClaimedNgn) - approved));

    const decision = await tx.trancheDecision.create({
      data: {
        valuationReportId: report.id,
        decidedByUserId: webUser.userId,
        decision: input.decision,
        approvedDisbursementAmountNgn: approved,
        heldBackAmountNgn: heldBack,
        creditCommitteeReference: input.creditCommitteeReference ?? null,
        approverNotes: input.approverNotes ?? null,
        cpSnapshotJson: cpSnapshot(tranche.conditionsPrecedent) as unknown as Prisma.InputJsonValue,
      },
    });

    await tx.ipcClaim.update({ where: { id: ipc.id }, data: { status: next } });

    if (approved > 0) {
      const released = roundNgn(Number(tranche.releasedAmountNgn) + approved);
      await tx.facilityTranche.update({
        where: { id: trancheId },
        data: {
          releasedAmountNgn: released,
          isReleased: released >= Number(tranche.allocatedAmountNgn) - NGN_EPSILON,
        },
      });
      await tx.project.update({
        where: { id: projectId },
        data: { disbursedToDateNgn: { increment: approved } },
      });
    }

    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'LENDER_TRANCHE_DECIDED',
      summaryText: `Recorded decision ${input.decision} on IPC #${ipc.ipcNumber} (valuation revision ${report.revisionNumber}): released ${fmtNgn(approved)}, held back ${fmtNgn(heldBack)}.`,
      payload: {
        trancheDecisionId: decision.id,
        ipcId: ipc.id,
        valuationReportId: report.id,
        decision: input.decision,
        approvedDisbursementAmountNgn: approved,
        heldBackAmountNgn: heldBack,
        cpSnapshot: cpSnapshot(tranche.conditionsPrecedent),
      },
    });

    return serializeTrancheDecision(decision, [decision]);
  });
}

export async function reverseTrancheDecision(params: {
  projectId: string;
  decisionId: string;
  webUser: WebJwtPayload;
  input: ReverseTrancheDecisionRequest;
}) {
  const { projectId, decisionId, webUser, input } = params;
  requireExplicit(webUser, APPROVE);

  return prisma.$transaction(async (tx) => {
    const original = await tx.trancheDecision.findFirst({
      where: { id: decisionId, valuationReport: { ipcClaim: { projectId } } },
      include: { valuationReport: { include: { ipcClaim: true } }, reversedBy: true },
    });
    if (!original) throw new AppError('Tranche decision not found', 404, 'DECISION_NOT_FOUND');
    if (original.reversesDecisionId) {
      throw new AppError('A reversal cannot itself be reversed', 409, 'CANNOT_REVERSE_REVERSAL');
    }
    if (original.reversedBy) {
      throw new AppError('This decision has already been reversed', 409, 'DECISION_ALREADY_REVERSED');
    }

    const ipcId = original.valuationReport.ipcClaimId;
    const ipc = await lockIpc(tx, projectId, ipcId);
    const tranche = await lockTranche(tx, original.valuationReport.ipcClaim.trancheId);
    const next = assertIpcTransition(ipc.status as IpcClaimStatus, 'reverse_decision');

    const approved = Number(original.approvedDisbursementAmountNgn);
    const reversal = await tx.trancheDecision.create({
      data: {
        valuationReportId: original.valuationReportId,
        decidedByUserId: webUser.userId,
        decision: original.decision,
        approvedDisbursementAmountNgn: -approved,
        heldBackAmountNgn: -Number(original.heldBackAmountNgn),
        creditCommitteeReference: original.creditCommitteeReference,
        approverNotes: input.reason,
        reversesDecisionId: original.id,
        cpSnapshotJson: cpSnapshot(tranche.conditionsPrecedent) as unknown as Prisma.InputJsonValue,
      },
    });

    if (approved > 0) {
      const released = roundNgn(Number(tranche.releasedAmountNgn) - approved);
      await tx.facilityTranche.update({
        where: { id: tranche.id },
        data: {
          releasedAmountNgn: released,
          isReleased: released >= Number(tranche.allocatedAmountNgn) - NGN_EPSILON,
        },
      });
      await tx.project.update({
        where: { id: projectId },
        data: { disbursedToDateNgn: { decrement: approved } },
      });
    }
    await tx.ipcClaim.update({ where: { id: ipcId }, data: { status: next } });

    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'TRANCHE_DECISION_REVERSED',
      summaryText: `Reversed decision ${original.decision} on IPC #${ipc.ipcNumber} (reversing ${fmtNgn(approved)} released): ${input.reason}`,
      payload: {
        reversalDecisionId: reversal.id,
        reversesDecisionId: original.id,
        ipcId,
        reversedAmountNgn: approved,
        reason: input.reason,
      },
    });

    return serializeTrancheDecision(reversal, [original, reversal]);
  });
}

// ---------------------------------------------------------------------------
// Conditions Precedent (D-3.2)
// ---------------------------------------------------------------------------

export async function updateConditionPrecedentStatus(params: {
  projectId: string;
  trancheId: string;
  conditionId: string;
  webUser: WebJwtPayload;
  input: UpdateConditionPrecedentStatusRequest;
}) {
  const { projectId, trancheId, conditionId, webUser, input } = params;
  return prisma.$transaction(async (tx) => {
    await loadTrancheInProject(tx, projectId, trancheId);
    await lockTranche(tx, trancheId);
    const cp = await loadConditionInTranche(tx, trancheId, conditionId);
    if (cp.status === input.status) return serializeTranche(await lockTranche(tx, trancheId));

    const now = new Date();
    await tx.conditionPrecedent.update({
      where: { id: cp.id },
      data: {
        status: input.status,
        statusChangedAt: now,
        verifiedAt: input.status === 'SATISFIED' ? now : cp.verifiedAt,
        waivedByUserId: null,
        waiverReason: null,
      },
    });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'CP_STATUS_CHANGED',
      summaryText: `Condition precedent ${cp.referenceCode} changed from ${cp.status} to ${input.status}${input.note ? `: ${input.note}` : '.'}`,
      payload: {
        conditionId: cp.id,
        trancheId,
        referenceCode: cp.referenceCode,
        previousStatus: cp.status,
        status: input.status,
        note: input.note ?? null,
      },
    });
    return serializeTranche(
      await tx.facilityTranche.findUniqueOrThrow({
        where: { id: trancheId },
        include: { conditionsPrecedent: true },
      })
    );
  });
}

export async function waiveConditionPrecedent(params: {
  projectId: string;
  trancheId: string;
  conditionId: string;
  webUser: WebJwtPayload;
  input: WaiveConditionPrecedentRequest;
}) {
  const { projectId, trancheId, conditionId, webUser, input } = params;
  requireExplicit(webUser, APPROVE);
  return prisma.$transaction(async (tx) => {
    await loadTrancheInProject(tx, projectId, trancheId);
    await lockTranche(tx, trancheId);
    const cp = await loadConditionInTranche(tx, trancheId, conditionId);
    if (cp.status === 'WAIVED') {
      throw new AppError('This condition is already waived', 409, 'CP_ALREADY_WAIVED');
    }
    await tx.conditionPrecedent.update({
      where: { id: cp.id },
      data: {
        status: 'WAIVED',
        statusChangedAt: new Date(),
        waivedByUserId: webUser.userId,
        waiverReason: input.reason,
      },
    });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'CP_WAIVED',
      summaryText: `Waived condition precedent ${cp.referenceCode} (was ${cp.status}): ${input.reason}`,
      payload: {
        conditionId: cp.id,
        trancheId,
        referenceCode: cp.referenceCode,
        previousStatus: cp.status,
        reason: input.reason,
      },
    });
    return serializeTranche(
      await tx.facilityTranche.findUniqueOrThrow({
        where: { id: trancheId },
        include: { conditionsPrecedent: true },
      })
    );
  });
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

export async function generateIpcValuationPdf(projectId: string, ipcId: string): Promise<Buffer> {
  const ipc = await prisma.ipcClaim.findFirst({
    where: { id: ipcId, projectId },
    include: {
      project: {
        include: {
          tenant: true,
          monitorOrganization: true,
          lenderOrganization: true,
          contractorOrganization: true,
        },
      },
      tranche: true,
      valuationReports: { where: { supersededAt: null }, orderBy: { revisionNumber: 'desc' }, take: 1 },
      lineItems: { include: { boqItem: true }, orderBy: { boqItem: { wbsCode: 'asc' } } },
    },
  });
  if (!ipc) throw new AppError('IPC claim not found', 404, 'IPC_NOT_FOUND');

  const report = ipc.valuationReports[0] ?? null;
  const branding = parseTenantBranding(ipc.project.tenant.brandingConfig);
  const labels = resolveRatingLabels(ipc.project.tenant.evidenceRatingLabels);

  return generateValuationReportPdfBuffer({
    tenantName: ipc.project.tenant.name,
    pdfHeaderTitle: branding.pdfHeaderTitle,
    pdfFooterDisclaimer: branding.pdfFooterDisclaimer,
    primaryColorHex: branding.primaryColorHex,
    projectName: ipc.project.name,
    projectCodePrefix: ipc.project.codePrefix,
    stateLocation: ipc.project.stateLocation,
    lenderName: ipc.project.lenderOrganization.name,
    contractorName: ipc.project.contractorOrganization.name,
    monitorOrganizationName: ipc.project.monitorOrganization.name,
    ipcNumber: ipc.ipcNumber,
    ipcStatus: ipc.status,
    trancheName: ipc.tranche.name,
    totalClaimedNgn: Number(ipc.totalClaimedAmountNgn),
    ratingEngine: ipc.ratingEngine,
    ratingEngineDetail: ipc.ratingEngineDetail,
    certification: report
      ? {
          revisionNumber: report.revisionNumber,
          totalCertifiedNgn: Number(report.totalCertifiedNgn),
          recommendedReleaseNgn: Number(report.recommendedReleaseAmountNgn),
          recommendedHoldbackNgn: Number(report.recommendedHoldbackAmountNgn),
          trancheRecommendation: report.trancheRecommendation,
          executiveSummary: report.executiveCertificationSummary,
          certifierFullName: report.certifierFullName,
          certifierLicenseType: report.certifierLicenseType,
          certifierLicenseNumber: report.certifierLicenseNumber,
          certifiedAtIso: report.certifiedAt.toISOString(),
        }
      : null,
    aiExecutiveSummary: ipc.aiExecutiveSummary,
    lineItems: ipc.lineItems.map((li) => ({
      wbsCode: li.boqItem.wbsCode,
      description: li.boqItem.description,
      budgetedCostNgn: Number(li.boqItem.budgetedCostNgn),
      contractorClaimedPct: Number(li.contractorClaimedPct),
      ratingLabel: labels[li.aiEvidenceRating as EvidenceStrengthRating].label,
      monitorCertifiedPct: li.monitorCertifiedPct === null ? null : Number(li.monitorCertifiedPct),
      monitorCertifiedNgn: li.monitorCertifiedNgn === null ? null : Number(li.monitorCertifiedNgn),
    })),
  });
}

export { ratingLabelsForProject };
