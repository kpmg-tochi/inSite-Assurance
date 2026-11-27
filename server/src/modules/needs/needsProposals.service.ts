import { Prisma } from '@prisma/client';
import {
  NEEDS_DOCUMENT_UPLOAD_POLICY,
  NEEDS_OPEN_PROPOSAL_STATUSES,
  PROPOSAL_DOCUMENT_KIND_LABELS,
  proposalStatusLabel,
  returnTarget,
  stageConfigOf,
  type NeedsFileLinkDto,
  type NeedsPipelineConfig,
  type NeedsProposalAction,
  type NeedsProposalDetailDto,
  type NeedsProposalDocumentDto,
  type NeedsProposalHistoryEntry,
  type NeedsProposalListQuery,
  type NeedsProposalStatus,
  type NeedsProposalSummaryDto,
  type NeedsStage,
  type NeedsValidationRecordDto,
  type ProposalFlagKind,
  type RegisterProposalDocumentRequest,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import type { WebJwtPayload } from '../../middleware/auth.middleware';
import { inspectTenantAreaUpload } from '../../utils/tenantUploads';
import { recordAuditEvent } from '../audit/audit.service';
import { workspaceShortName } from '../scope/scopeImport.service';
import { assertCycleWritable, isUuid, loadVisibleCycle, loadVisibleProposal, webActor, type CycleRow } from './needsAccess';
import { cycleDocumentPrefix, fileLink } from './needsCycles.service';
import { costingStandardById, cycleConfig, dec, facilitiesSummary, facilityNames, parsedOf, tenantToday, workbookFacilities } from './needsSupport';
import { currentFirst, serializeFlag, serializeProposalDocument, serializeVersion } from './needsSerializers';
import { buildNeedsWorkbook } from './workbook/needsWorkbook';
import { assertDocumentRegistrable, lockCycle } from './needsVersions';
import { redactFlagsForViewer } from './needsFlags.service';
import { drawingCounts } from './decisions/needsGate';
import { loadRuleFacts, narrowActions, type RuleFacts } from './decisions/proposalRules';
import { proposalPageTasks, proposalQueueTasks } from './decisions/needsTasks.service';
import { serializeValidationRecord } from './decisions/needsValidation.service';

/**
 * Needs pipeline wave 2 (B8): proposal lists and detail, proposal documents, templates and stored
 * files. Every read goes through the cycle's visibility (needsAccess).
 */

/** Who acts for a permission, in the words of the process (plan 4.1, 4.2). */
function actorLabel(permissionKey: string | null, config: NeedsPipelineConfig): string | null {
  const state = config.cycleScope === 'STATE';
  switch (permissionKey) {
    case 'needs:submit':
      return state ? 'SUBEB Procurement' : 'Procurement';
    case 'needs:validate':
      return state ? 'SUBEB Physical Planning' : 'M&E Department';
    case 'needs:cost':
      return state ? 'SUBEB Physical Planning' : 'Physical Planning (QS)';
    case 'needs:chair_committee':
      return state ? 'SUBEB Steering Committee' : 'Steering Committee';
    case 'needs:record_funding':
      return 'Finance & Accounts';
    case 'needs:prepare_beap':
      return 'SUBEB Physical Planning';
    default:
      return null;
  }
}

/** "Identification: Procurement"; null when nothing waits (closed statuses). */
export function nextActorOf(p: { stage: NeedsStage; status: NeedsProposalStatus }, config: NeedsPipelineConfig): string | null {
  if (!NEEDS_OPEN_PROPOSAL_STATUSES.includes(p.status)) return null;
  const stage = stageConfigOf(config, p.stage);
  if (!stage) return null;
  if (p.status === 'RETURNED') {
    const target = returnTarget(config, p.stage);
    const who = actorLabel(target?.actorPermissionKey ?? 'needs:submit', config);
    return `Returned for correction${who ? `: ${who}` : ''}`;
  }
  let who = actorLabel(stage.actorPermissionKey ?? null, config);
  if (!who && p.stage === 'APPROVAL') who = config.approvalChains.NEEDS_PORTFOLIO[0]?.label ?? 'Approval chain';
  if (!who && p.stage === 'FUNDING') who = config.fundingGate === 'BEAP_APPROVAL' ? 'SUBEB Physical Planning' : 'Finance & Accounts';
  return who ? `${stage.label}: ${who}` : stage.label;
}

const LIST_INCLUDE = {
  currentVersion: { select: { number: true, siteCount: true, source: true } },
  breakdownRows: { select: { facilityCode: true, proposedQuantity: true }, orderBy: { sortOrder: 'asc' } },
  flags: { where: { resolvedAt: null }, select: { kind: true } },
  project: { select: { id: true } },
} satisfies Prisma.NeedsProposalInclude;

type ListRow = Prisma.NeedsProposalGetPayload<{ include: typeof LIST_INCLUDE }>;

/**
 * A row of the table. Wave 3 (A7): `allowed` is `allowedProposalActions` narrowed by the server's own
 * rules (owning organisation, open cycle, separation of duties, committee: `narrowActions`), and
 * "waiting for me" means the proposal has a task in the viewer's queue.
 */
function summaryOf(
  p: ListRow,
  cycle: CycleRow,
  config: NeedsPipelineConfig,
  user: WebJwtPayload,
  names: Map<string, string>,
  facts: RuleFacts,
  today: string
): NeedsProposalSummaryDto & { allowed: NeedsProposalAction[] } {
  const stage = p.stage as NeedsStage;
  const status = p.status as NeedsProposalStatus;
  const { allowed } = narrowActions(user, cycle, config, p, facts);
  const queue = proposalQueueTasks(user, cycle, config, { ...p, currentVersionSource: p.currentVersion?.source ?? null }, facts, today);
  // Independent scoring (D-N.10, Track B decision 8): until the ranking is finalised a committee
  // member who is not the chair sees no combined score here either.
  const committee = facts.committees.get(cycle.id);
  const scoresHidden = !cycle.rankingFinalisedAt && committee?.me?.role === 'MEMBER';
  return {
    id: p.id,
    cycleId: p.cycleId,
    reference: p.reference,
    title: p.title,
    route: p.route as NeedsProposalSummaryDto['route'],
    stage,
    status,
    statusLabel: proposalStatusLabel({ stage, status }, config),
    stateCode: p.stateCode,
    lgaCodes: p.lgaCodes,
    siteCount: p.currentVersion?.siteCount ?? 0,
    facilitiesSummary: facilitiesSummary(
      p.breakdownRows.map((r) => ({ facilityCode: r.facilityCode, proposedQuantity: Number(r.proposedQuantity) })),
      names
    ),
    preliminaryCostNgn: dec(p.preliminaryAmountNgn),
    costedAmountNgn: dec(p.costedAmountNgn),
    approvedAmountNgn: dec(p.approvedAmountNgn),
    fundedAmountNgn: dec(p.fundedAmountNgn),
    currentVersionNumber: p.currentVersion?.number ?? null,
    scoreTotal: scoresHidden ? null : dec(p.scoreTotal),
    rank: scoresHidden ? null : p.rank,
    // Before finalisation the column holds the chair's placement, not the line (DTO: null before).
    aboveLine: cycle.rankingFinalisedAt && !scoresHidden ? p.aboveLine : null,
    openFlagKinds: [...new Set(p.flags.map((f) => f.kind as ProposalFlagKind))],
    nextActor: nextActorOf({ stage, status }, config),
    waitingForMe: queue.length > 0,
    projectId: p.project?.id ?? null,
    updatedAt: p.updatedAt.toISOString(),
    allowed,
  };
}

const stripAllowed = <T extends { allowed: unknown }>(row: T): Omit<T, 'allowed'> => {
  const { allowed, ...rest } = row;
  void allowed;
  return rest;
};

export async function listProposals(user: WebJwtPayload, cycleId: string, query: NeedsProposalListQuery): Promise<NeedsProposalSummaryDto[]> {
  const cycle = await loadVisibleCycle(user, cycleId);
  const config = cycleConfig(cycle);
  const q = query.q?.trim();
  const rows = await prisma.needsProposal.findMany({
    where: {
      cycleId: cycle.id,
      ...(query.stage ? { stage: query.stage } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(q
        ? {
            OR: [
              { reference: { contains: q, mode: 'insensitive' } },
              { title: { contains: q, mode: 'insensitive' } },
              { sites: { some: { schoolName: { contains: q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    },
    include: LIST_INCLUDE,
    orderBy: { sequence: 'asc' },
  });
  const [names, facts, today] = await Promise.all([
    facilityNames(user.tenantId),
    loadRuleFacts(prisma, user, [cycle], rows.map((r) => r.id)),
    tenantToday(user.tenantId),
  ]);
  let out = rows.map((p) => summaryOf(p, cycle, config, user, names, facts, today));
  if (query.waitingForMe === 'true') out = out.filter((p) => p.waitingForMe);
  if (query.waitingForMe === 'false') out = out.filter((p) => !p.waitingForMe);
  return out.map(stripAllowed);
}

async function proposalHistory(tenantId: string, proposalId: string): Promise<NeedsProposalHistoryEntry[]> {
  const rows = await prisma.auditLog.findMany({
    where: {
      tenantId,
      projectId: null,
      OR: [{ payload: { path: ['proposalId'], equals: proposalId } }, { payload: { path: ['carriedFromId'], equals: proposalId } }],
    },
    orderBy: { seq: 'desc' },
    take: 200,
  });
  return rows.map((r) => ({ at: r.createdAt.toISOString(), action: r.action, actorName: r.actorDisplayName, summary: r.summaryText }));
}

export async function getProposalDetail(user: WebJwtPayload, proposalId: string): Promise<NeedsProposalDetailDto> {
  const base = await loadVisibleProposal(user, proposalId);
  const config = cycleConfig(base.cycle);
  const p = await prisma.needsProposal.findUniqueOrThrow({
    where: { id: base.id },
    include: {
      ...LIST_INCLUDE,
      currentVersion: { select: { number: true, siteCount: true, source: true, parsedJson: true } },
      versions: { include: { costingStandardVersion: { select: { version: true } } }, orderBy: { number: 'desc' } },
      flags: { orderBy: { raisedAt: 'asc' } },
      documents: true,
      validationRecords: { include: { version: { select: { number: true } } }, orderBy: { recordedAt: 'desc' }, take: 1 },
      carriedFrom: { select: { id: true, reference: true } },
      mergedInto: { select: { id: true, reference: true } },
    },
  });
  const [names, facts, today] = await Promise.all([facilityNames(user.tenantId), loadRuleFacts(prisma, user, [base.cycle], [p.id]), tenantToday(user.tenantId)]);
  const listRow = { ...p, flags: p.flags.filter((f) => !f.resolvedAt).map((f) => ({ kind: f.kind })) } as unknown as ListRow;
  const summary = summaryOf(listRow, base.cycle, config, user, names, facts, today);
  const parsed = parsedOf(p.currentVersion?.parsedJson);
  const record = p.validationRecords[0];
  const validation: NeedsValidationRecordDto | null = record ? serializeValidationRecord(record) : null;
  const documents = currentFirst(p.documents);
  return {
    ...stripAllowed(summary),
    outOfCycleReason: (p.outOfCycleReason as NeedsProposalDetailDto['outOfCycleReason']) ?? null,
    authorisingDocumentId: p.authorisingDocumentId,
    project: parsed?.project ?? null,
    sites: parsed?.sites ?? [],
    breakdownRows: parsed?.breakdownRows ?? [],
    boqLines: parsed?.boqLines ?? [],
    costingSummary: parsed?.costingSummary ?? null,
    versions: p.versions.map((v) => serializeVersion(v, p.currentVersionId)),
    flags: await redactFlagsForViewer(user, p.flags.map(serializeFlag)),
    validation,
    documents: documents.map(serializeProposalDocument),
    allowedActions: summary.allowed,
    tasks: proposalPageTasks(user, base.cycle, config, { ...p, currentVersionSource: p.currentVersion?.source ?? null }, facts, {
      flags: p.flags,
      drawingCount: drawingCounts(p.documents.map((d) => ({ ...d, proposalId: p.id }))).get(p.id) ?? 0,
      currentVersionSource: p.currentVersion?.source ?? null,
      hasRecordOnCurrent: Boolean(record && record.versionId === p.currentVersionId),
    }),
    carriedFromId: p.carriedFrom?.id ?? null,
    carriedFromReference: p.carriedFrom?.reference ?? null,
    mergedIntoId: p.mergedInto?.id ?? null,
    mergedIntoReference: p.mergedInto?.reference ?? null,
    history: await proposalHistory(user.tenantId, p.id),
    createdByName: p.createdByName,
    createdAt: p.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export async function listProposalDocuments(user: WebJwtPayload, proposalId: string): Promise<NeedsProposalDocumentDto[]> {
  const p = await loadVisibleProposal(user, proposalId);
  const rows = await prisma.needsProposalDocument.findMany({ where: { proposalId: p.id } });
  return currentFirst(rows).map(serializeProposalDocument);
}

export async function registerProposalDocument(user: WebJwtPayload, proposalId: string, input: RegisterProposalDocumentRequest): Promise<NeedsProposalDocumentDto> {
  const p = await loadVisibleProposal(user, proposalId);
  assertCycleWritable(user, p.cycle);
  if (input.supersedesId) {
    const previous = await prisma.needsProposalDocument.findFirst({ where: { id: input.supersedesId, proposalId: p.id } });
    if (!previous) throw new AppError('The document it replaces is not on this proposed project', 404, 'NEEDS_DOCUMENT_NOT_FOUND');
    if (previous.kind !== input.kind) throw new AppError('A new version must be the same kind of document', 422, 'NEEDS_DOCUMENT_KIND_MISMATCH');
  }
  const file = await inspectTenantAreaUpload(input.objectKey, cycleDocumentPrefix(user.tenantId, p.cycleId), NEEDS_DOCUMENT_UPLOAD_POLICY);
  const doc = await prisma.$transaction(async (tx) => {
    await lockCycle(tx, p.cycleId);
    await assertDocumentRegistrable(tx, { cycleId: p.cycleId, objectKey: file.objectKey, supersedes: input.supersedesId ? { table: "proposal", id: input.supersedesId } : null });
    const created = await tx.needsProposalDocument.create({
      data: {
        proposalId: p.id,
        kind: input.kind,
        title: input.title,
        objectKey: file.objectKey,
        fileName: file.fileName,
        mimeType: file.mimeType,
        byteSize: file.byteSize,
        sha256: file.sha256,
        supersedesId: input.supersedesId,
        uploadedByUserId: user.userId,
        uploadedByName: user.fullName,
      },
    });
    await recordAuditEvent(tx, {
      tenantId: user.tenantId,
      projectId: null,
      ...webActor(user),
      action: 'NEEDS_DOCUMENT_ADDED',
      summaryText: `${input.supersedesId ? 'Replaced' : 'Added'} "${input.title}" (${PROPOSAL_DOCUMENT_KIND_LABELS[input.kind]}) on ${p.reference}.`,
      payload: { cycleId: p.cycleId, proposalId: p.id, reference: p.reference, documentId: created.id, kind: input.kind, title: input.title, supersedesId: input.supersedesId, sha256: file.sha256, fileName: file.fileName },
    });
    return created;
  });
  return serializeProposalDocument(doc);
}

export async function proposalDocumentFile(user: WebJwtPayload, proposalId: string, documentId: string): Promise<NeedsFileLinkDto> {
  const p = await loadVisibleProposal(user, proposalId);
  const doc = isUuid(documentId) ? await prisma.needsProposalDocument.findFirst({ where: { id: documentId, proposalId: p.id } }) : null;
  if (!doc) throw new AppError('Document not found', 404, 'NEEDS_DOCUMENT_NOT_FOUND');
  return fileLink(doc.objectKey, doc.fileName);
}

export async function versionFile(user: WebJwtPayload, proposalId: string, number: string): Promise<NeedsFileLinkDto> {
  const p = await loadVisibleProposal(user, proposalId);
  const n = Number(number);
  const v = Number.isInteger(n) && n > 0 ? await prisma.needsAssessmentVersion.findFirst({ where: { proposalId: p.id, number: n } }) : null;
  if (!v) throw new AppError('Version not found', 404, 'NEEDS_VERSION_NOT_FOUND');
  return fileLink(v.objectKey, v.fileName);
}

// ---------------------------------------------------------------------------
// Templates (blank per cycle; pre-filled per proposal)
// ---------------------------------------------------------------------------

async function buildForCycle(user: WebJwtPayload, cycle: CycleRow, prefill: { parsed: NonNullable<ReturnType<typeof parsedOf>>; reference: string } | null) {
  const [tenant, type, standard, facilities] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { name: true } }),
    prisma.projectType.findUniqueOrThrow({ where: { id: cycle.projectTypeId }, select: { name: true } }),
    costingStandardById(cycle.costingStandardVersionId),
    workbookFacilities(user.tenantId),
  ]);
  return buildNeedsWorkbook({
    tenantShortName: workspaceShortName(tenant?.name) ?? tenant?.name ?? '',
    programmeName: type.name,
    interventionYear: cycle.interventionYear,
    stateCode: cycle.stateCode,
    costingStandard: standard ? { version: standard.version, standard: standard.standard } : null,
    facilities,
    prefill: prefill?.parsed ?? null,
    proposalReference: prefill?.reference ?? null,
  });
}

export async function cycleTemplate(user: WebJwtPayload, cycleId: string) {
  const cycle = await loadVisibleCycle(user, cycleId);
  return buildForCycle(user, cycle, null);
}

export async function proposalTemplate(user: WebJwtPayload, proposalId: string) {
  const p = await loadVisibleProposal(user, proposalId);
  const version = p.currentVersionId ? await prisma.needsAssessmentVersion.findUnique({ where: { id: p.currentVersionId }, select: { parsedJson: true } }) : null;
  const parsed = parsedOf(version?.parsedJson);
  return buildForCycle(user, p.cycle, parsed ? { parsed, reference: p.reference } : null);
}
