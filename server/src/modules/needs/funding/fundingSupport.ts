import { Prisma } from '@prisma/client';
import {
  APPROVED_LIST_KIND_LABELS,
  budgetMismatch,
  formatProjectCode,
  type ApprovedListKind,
  type CycleDocumentKind,
  type NeedsConvertedProposal,
  type NeedsFundingGate,
  type NeedsFundingRecordDto,
  type NeedsFundingRecordKind,
  type NeedsSubmissionItemDto,
} from '@insite/shared';
import { AppError } from '../../../middleware/error.middleware';
import type { WebJwtPayload } from '../../../middleware/auth.middleware';
import { recordAuditEvent } from '../../audit/audit.service';
import { lockApprovedLists } from '../../approvedLists/approvedListImport.service';
import { tenantTolerancePct } from '../../approvedLists/approvedLists.service';
import { webActor, type CycleRow, type Db } from '../needsAccess';
import { cycleConfig, dec, facilitiesSummary, facilityNames } from '../needsSupport';

/**
 * Needs pipeline wave 4, Track B: what the funding gates share (DI appropriation, MG BEAP approval):
 * the gate check, the proposals waiting at Funding, the FUNDING stage decision, the approved list the
 * gate writes (D-N.12) and the serializers.
 */

type Tx = Prisma.TransactionClient;

/** Proposals waiting at Funding: annual proposals at FUNDING, IN_PROGRESS (approved, not yet funded). */
export const AT_FUNDING_WHERE = { stage: 'FUNDING', status: 'IN_PROGRESS', route: 'ANNUAL' } satisfies Prisma.NeedsProposalWhereInput;

export const holds = (user: WebJwtPayload, key: string) => user.isPlatformSuperAdmin || user.permissions.includes(key);

export const fundingGateOf = (cycle: Pick<CycleRow, 'configSnapshotJson'>): NeedsFundingGate => cycleConfig(cycle).fundingGate;

const GATE_WORDS: Record<NeedsFundingGate, string> = {
  APPROPRIATION: 'the appropriation (Direct Intervention)',
  BEAP_APPROVAL: "the State's BEAP (Matching Grants)",
};

/** 409 NEEDS_FUNDING_GATE_MISMATCH unless the cycle's programme funds through `gate`. */
export function assertFundingGate(cycle: Pick<CycleRow, 'configSnapshotJson'>, gate: NeedsFundingGate): void {
  const actual = fundingGateOf(cycle);
  if (actual !== gate) {
    throw new AppError(`This cycle is funded through ${GATE_WORDS[actual]}, not ${GATE_WORDS[gate]}.`, 409, 'NEEDS_FUNDING_GATE_MISMATCH');
  }
}

/** The user writes for the cycle's owning organisation (403 NEEDS_CYCLE_FORBIDDEN); the cycle may be open or closed. */
export function assertOwningOrganisation(user: WebJwtPayload, cycle: Pick<CycleRow, 'owningOrganizationId'>): void {
  if (!user.isPlatformSuperAdmin && cycle.owningOrganizationId !== user.organizationId) {
    throw new AppError('Only the organisation that owns this cycle can change it', 403, 'NEEDS_CYCLE_FORBIDDEN');
  }
}

/** A cycle document of one of `kinds` (current or not), else 404 / 422. */
export async function cycleDocumentOfKind(db: Db, cycleId: string, documentId: string, kinds: readonly CycleDocumentKind[], what: string) {
  const doc = await db.needsCycleDocument.findFirst({ where: { id: documentId, cycleId } });
  if (!doc) throw new AppError(`The ${what} is not a document of this cycle`, 404, 'NEEDS_DOCUMENT_NOT_FOUND');
  if (!kinds.includes(doc.kind as CycleDocumentKind)) {
    throw new AppError(`The ${what} must be a cycle document of kind ${kinds.join(' or ')}`, 422, 'NEEDS_DOCUMENT_KIND_MISMATCH');
  }
  return doc;
}

/** Who approved a step of the cycle's approved portfolio (the last pass of each APPROVED portfolio). */
export async function portfolioApproverIds(db: Db, cycleId: string): Promise<string[]> {
  const subs = await db.needsSubmission.findMany({
    where: { cycleId, kind: 'PORTFOLIO', status: 'APPROVED' },
    select: { actions: { orderBy: { createdAt: 'asc' }, select: { decision: true, actorUserId: true } } },
  });
  const ids = new Set<string>();
  for (const s of subs) {
    let start = 0;
    s.actions.forEach((a, i) => {
      if (a.decision === 'RETURN') start = i + 1;
    });
    for (const a of s.actions.slice(start)) if (a.decision === 'APPROVE') ids.add(a.actorUserId);
  }
  return [...ids];
}

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

type FundingRecordRow = Prisma.NeedsFundingRecordGetPayload<object>;

export function serializeFundingRecord(r: FundingRecordRow): NeedsFundingRecordDto {
  const summary = r.summaryJson && typeof r.summaryJson === 'object' && !Array.isArray(r.summaryJson) ? (r.summaryJson as Record<string, unknown>) : {};
  return {
    id: r.id,
    cycleId: r.cycleId,
    kind: r.kind as NeedsFundingRecordKind,
    recordedOn: r.recordedOn,
    amountNgn: dec(r.amountNgn),
    documentId: r.documentId,
    approvedListId: r.approvedListId,
    fileName: r.fileName,
    sha256: r.sha256,
    note: r.note,
    summary,
    recordedByName: r.recordedByName,
    createdAt: r.createdAt.toISOString(),
  };
}

export const AWAITING_SELECT = {
  id: true,
  reference: true,
  title: true,
  stateCode: true,
  lgaCodes: true,
  rank: true,
  aboveLine: true,
  approvedAmountNgn: true,
  costedAmountNgn: true,
  currentVersion: { select: { number: true, siteCount: true } },
} satisfies Prisma.NeedsProposalSelect;
export type AwaitingProposal = Prisma.NeedsProposalGetPayload<{ select: typeof AWAITING_SELECT }>;

/** The amount a proposal is approved for (the portfolio's), else its costed amount. */
export const approvedAmountOf = (p: { approvedAmountNgn: Prisma.Decimal | null; costedAmountNgn: Prisma.Decimal | null }): number | null =>
  dec(p.approvedAmountNgn) ?? dec(p.costedAmountNgn);

/** A proposal at Funding as a submission item (the Funding tab's list). */
export function awaitingItem(p: AwaitingProposal): NeedsSubmissionItemDto {
  return {
    proposalId: p.id,
    reference: p.reference,
    title: p.title,
    stateCode: p.stateCode,
    lgaCodes: p.lgaCodes,
    siteCount: p.currentVersion?.siteCount ?? 0,
    amountNgn: approvedAmountOf(p),
    rank: p.rank,
    aboveLine: p.aboveLine,
    included: true,
    exclusionReason: null,
    lotTitle: null,
    lotNumber: null,
    batchNumber: null,
    procurementMethod: null,
    plannedStartDate: null,
    plannedEndDate: null,
    reviewOutcome: null,
    reviewComment: null,
    currentVersionNumber: p.currentVersion?.number ?? null,
    projectId: null,
    projectCode: null,
  };
}

/** The cycle's proposals that became projects. */
export async function convertedProposals(db: Db, cycleId: string): Promise<NeedsConvertedProposal[]> {
  const rows = await db.needsProposal.findMany({
    where: { cycleId, project: { isNot: null } },
    orderBy: { sequence: 'asc' },
    select: { id: true, reference: true, fundedAmountNgn: true, project: { select: { id: true, codePrefix: true, totalBudgetNgn: true } } },
  });
  return rows.map((r) => ({
    proposalId: r.id,
    reference: r.reference,
    projectId: r.project!.id,
    projectCode: formatProjectCode(r.project!.codePrefix),
    fundedAmountNgn: dec(r.fundedAmountNgn) ?? dec(r.project!.totalBudgetNgn) ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Approved list rows from proposals (D-N.12)
// ---------------------------------------------------------------------------

export interface ProposalListFacts {
  schoolNames: string[];
  facilityScope: string | null;
}

/** School names (site order) and the facilities summary of each proposal's current version. */
export async function proposalListFacts(db: Db, tenantId: string, proposalIds: readonly string[]): Promise<Map<string, ProposalListFacts>> {
  const [sites, rows, names] = await Promise.all([
    db.needsProposalSite.findMany({ where: { proposalId: { in: [...proposalIds] } }, orderBy: { siteNumber: 'asc' }, select: { proposalId: true, schoolName: true } }),
    db.needsFacilityBreakdownRow.findMany({
      where: { proposalId: { in: [...proposalIds] } },
      orderBy: { sortOrder: 'asc' },
      select: { proposalId: true, facilityCode: true, proposedQuantity: true },
    }),
    facilityNames(tenantId, db),
  ]);
  const out = new Map<string, ProposalListFacts>();
  for (const id of proposalIds) {
    const summary = facilitiesSummary(
      rows.filter((r) => r.proposalId === id).map((r) => ({ facilityCode: r.facilityCode, proposedQuantity: Number(r.proposedQuantity) })),
      names
    );
    out.set(id, { schoolNames: sites.filter((s) => s.proposalId === id).map((s) => s.schoolName), facilityScope: summary || null });
  }
  return out;
}

export interface ApprovedListRowInputData {
  rowRef: string;
  projectTitle: string;
  schoolNames: string[];
  stateCode: string;
  lgaCodes: string[];
  facilityScope: string | null;
  costEstimateNgn: number;
  lotTitle: string | null;
}

/**
 * Writes the approved list a funding gate produces (D-N.12), under the approved-list per-tenant lock
 * (call `lockApprovedLists` first). 409 NEEDS_APPROVED_LIST_EXISTS when the tenant already has a list
 * of this kind, year and State (wave 4 decision: the funding gate writes the list; a list uploaded by
 * hand for that year blocks it). Returns the list and its row ids in input order.
 */
export async function writeApprovedListInTx(
  tx: Tx,
  params: {
    user: WebJwtPayload;
    kind: ApprovedListKind;
    interventionYear: number;
    stateCode: string | null;
    title: string;
    approvedBy: string;
    approvedOn: string;
    documentId: string | null;
    sourceFileName: string | null;
    sourceSha256: string | null;
    rows: ApprovedListRowInputData[];
  }
): Promise<{ listId: string; title: string; rowIds: string[] }> {
  await assertNoApprovedList(tx, params.user.tenantId, params.kind, params.interventionYear, params.stateCode);
  const list = await tx.approvedList.create({
    data: {
      tenantId: params.user.tenantId,
      interventionYear: params.interventionYear,
      kind: params.kind,
      stateCode: params.kind === 'MG_BEAP' ? params.stateCode : null,
      title: params.title,
      approvedBy: params.approvedBy,
      approvedOn: params.approvedOn,
      documentId: params.documentId,
      sourceFileName: params.sourceFileName,
      sourceSha256: params.sourceSha256,
      importedAt: new Date(),
      importedById: params.user.userId,
    },
  });
  const rowIds: string[] = [];
  for (const [i, r] of params.rows.entries()) {
    const row = await tx.approvedListRow.create({
      data: {
        listId: list.id,
        rowRef: r.rowRef,
        projectTitle: r.projectTitle,
        schoolNamesJson: r.schoolNames,
        stateCode: r.stateCode,
        lgaCodes: r.lgaCodes,
        facilityScope: r.facilityScope,
        costEstimateNgn: r.costEstimateNgn,
        lotTitle: r.lotTitle,
        sortOrder: (i + 1) * 10,
      },
      select: { id: true },
    });
    rowIds.push(row.id);
  }
  return { listId: list.id, title: list.title, rowIds };
}

/** 409 NEEDS_APPROVED_LIST_EXISTS when the tenant has a list of this kind, year and State (DI: none). */
export async function assertNoApprovedList(db: Db, tenantId: string, kind: ApprovedListKind, interventionYear: number, stateCode: string | null): Promise<void> {
  const existing = await db.approvedList.findFirst({
    where: { tenantId, kind, interventionYear, stateCode: kind === 'MG_BEAP' ? stateCode : null },
    select: { title: true },
  });
  if (existing) {
    throw new AppError(
      `"${existing.title}" already exists for ${interventionYear}. The funding gate writes this approved list; a list for the same year${kind === 'MG_BEAP' ? ' and State' : ''} entered by hand blocks it.`,
      409,
      'NEEDS_APPROVED_LIST_EXISTS'
    );
  }
}

export { lockApprovedLists };

/**
 * The project ledger entry for a link the funding gate made (as the approved list upload writes
 * them), with the budget mismatch computed against the row's estimate.
 */
export async function auditRowLinkInTx(
  tx: Tx,
  params: {
    user: WebJwtPayload;
    projectId: string;
    listId: string;
    listTitle: string;
    kind: ApprovedListKind;
    rowId: string;
    rowRef: string;
    estimateNgn: number;
    previousRow: { id: string; rowRef: string } | null;
    tolerancePct?: number;
  }
): Promise<{ flagged: boolean }> {
  const project = await tx.project.findUniqueOrThrow({ where: { id: params.projectId }, select: { status: true, totalBudgetNgn: true } });
  const tolerance = params.tolerancePct ?? (await tenantTolerancePct(params.user.tenantId));
  const mismatch = budgetMismatch(dec(project.totalBudgetNgn), params.estimateNgn, tolerance, params.kind);
  await recordAuditEvent(tx, {
    projectId: params.projectId,
    ...webActor(params.user),
    action: 'APPROVED_LIST_ROW_LINKED',
    summaryText:
      `Linked to row ${params.rowRef} of ${params.listTitle} by the funding gate${params.previousRow ? ` (was row ${params.previousRow.rowRef})` : ''}` +
      `${mismatch.flagged ? `: ${mismatch.summary}` : ''}.`,
    payload: {
      projectStatus: project.status,
      rowId: params.rowId,
      rowRef: params.rowRef,
      listId: params.listId,
      listKind: params.kind,
      listKindLabel: APPROVED_LIST_KIND_LABELS[params.kind],
      previousRowId: params.previousRow?.id ?? null,
      previousRowRef: params.previousRow?.rowRef ?? null,
      budgetFlagged: mismatch.flagged,
      differencePct: mismatch.differencePct,
      source: 'NEEDS_FUNDING',
    },
  });
  return { flagged: mismatch.flagged };
}

// ---------------------------------------------------------------------------
// The FUNDING stage decision
// ---------------------------------------------------------------------------

export interface FundingDecisionItem {
  proposal: { id: string; reference: string; currentVersionId: string | null };
  outcome: 'ADVANCE' | 'NOT_SELECTED';
  reason: string | null;
  toStatus: 'CONVERTED' | 'NOT_SELECTED';
}

/**
 * One `NeedsStageDecision` at FUNDING with an item per proposal and `NEEDS_STAGE_DECIDED` per item
 * (the proposal history reads them). Proposals marked NOT_SELECTED here are closed by this function;
 * converted ones were closed by the conversion.
 */
export async function recordFundingDecisionInTx(
  tx: Tx,
  params: { user: WebJwtPayload; cycle: CycleRow; reason: string; evidenceDocumentIds: string[]; items: FundingDecisionItem[] }
): Promise<string> {
  const { user, cycle } = params;
  const label = cycleConfig(cycle).stages.find((s) => s.stage === 'FUNDING')?.label ?? 'Funding';
  const decision = await tx.needsStageDecision.create({
    data: {
      cycleId: cycle.id,
      stage: 'FUNDING',
      reason: params.reason,
      evidenceDocumentIds: params.evidenceDocumentIds,
      decidedByUserId: user.userId,
      decidedByName: user.fullName,
      items: {
        create: params.items.map((i) => ({ proposalId: i.proposal.id, outcome: i.outcome, reason: i.reason, toStage: 'FUNDING', toStatus: i.toStatus })),
      },
    },
  });
  for (const item of params.items) {
    if (item.toStatus === 'NOT_SELECTED') {
      await tx.needsProposal.update({ where: { id: item.proposal.id }, data: { status: 'NOT_SELECTED', statusReason: item.reason } });
    }
    await recordAuditEvent(tx, {
      tenantId: user.tenantId,
      projectId: null,
      ...webActor(user),
      action: 'NEEDS_STAGE_DECIDED',
      summaryText: `${label}: ${item.proposal.reference} ${item.toStatus === 'CONVERTED' ? 'funded: it is now a draft project' : 'not funded, carried forward'}${item.reason ? `: ${item.reason}` : '.'}`,
      payload: {
        cycleId: cycle.id,
        decisionId: decision.id,
        proposalId: item.proposal.id,
        reference: item.proposal.reference,
        stage: 'FUNDING',
        outcome: item.outcome,
        toStage: 'FUNDING',
        toStatus: item.toStatus,
        reason: item.reason,
        versionId: item.proposal.currentVersionId,
      },
    });
  }
  return decision.id;
}
