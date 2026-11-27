import { Prisma } from '@prisma/client';
import {
  CYCLE_DOCUMENT_KIND_META,
  NEEDS_DOCUMENT_UPLOAD_POLICY,
  NEEDS_TEMPLATE_VERSION,
  NeedsChainTypeEnum,
  cycleDeadlines,
  monthDayInYear,
  proposalStatusLabel,
  stateByCode,
  type CloseNeedsCycleRequest,
  type NeedsCarryForwardCandidateDto,
  type NeedsCarryForwardQuery,
  type NeedsCycleDocumentDto,
  type NeedsCycleDto,
  type NeedsCycleListQuery,
  type NeedsCycleSummaryDto,
  type NeedsDeadline,
  type NeedsDeadlineOverride,
  type NeedsDocumentPresignRequest,
  type NeedsFileLinkDto,
  type NeedsOptionsDto,
  type NeedsPipelineConfig,
  type NeedsPresignedUploadDto,
  type NeedsProposalStatus,
  type NeedsStage,
  type OpenNeedsCycleRequest,
  type RegisterCycleDocumentRequest,
  type UpdateNeedsCycleRequest,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { hasWebPermission, type WebJwtPayload } from '../../middleware/auth.middleware';
import { storageService } from '../../integrations/storage.service';
import { inspectTenantAreaUpload, presignTenantAreaUpload, tenantAreaPrefix } from '../../utils/tenantUploads';
import { recordAuditEvent } from '../audit/audit.service';
import { actorName, isUuid, loadVisibleCycle, loadWritableCycle, visibleCycleWhere, webActor, type CycleRow } from './needsAccess';
import { cycleConfig, dec, deriveCycleOwnerId, latestCostingStandardRow, lockCostingStandardVersion, parsedOf, subebStateCode, tenantToday, typeConfig } from './needsSupport';
import { currentFirst, deadlinesOf, serializeCycleDocument, serializeCycleSummary } from './needsSerializers';
import { assertDocumentRegistrable, lockCycle, nextProposalReference, writeVersionInTx } from './needsVersions';

/**
 * Needs pipeline wave 2 (B4, B9): cycles (options, list, open, update, close), cycle documents and
 * carry-forward (D-N.19). Events go on the tenant ledger with `cycleId` in the payload.
 */

const SUMMARY_INCLUDE = {
  projectType: { select: { name: true } },
  owningOrganization: { select: { name: true } },
  _count: { select: { proposals: true } },
} satisfies Prisma.NeedsCycleInclude;

const scopeKeyOf = (scope: 'NATIONAL' | 'STATE', stateCode: string | null) => (scope === 'STATE' ? (stateCode ?? '').toUpperCase() : 'NATIONAL');

/** The intervention year a cycle opened on `today` would be for: Y + 1 once this year's opening date has passed. */
function suggestedYear(config: Pick<NeedsPipelineConfig, 'cycleOpens'>, today: string): number {
  const year = Number(today.slice(0, 4));
  return today >= monthDayInYear(year, config.cycleOpens) ? year + 1 : year;
}

async function userOrganization(user: WebJwtPayload) {
  return prisma.organization.findUnique({ where: { id: user.organizationId }, select: { id: true, name: true, stateCode: true } });
}

/** Live types with an enabled pipeline. */
async function pipelineTypes(tenantId: string) {
  const types = await prisma.projectType.findMany({ where: { tenantId, isActive: true }, orderBy: { name: 'asc' } });
  return types
    .map((t) => ({ type: t, config: typeConfig(t).needsPipeline }))
    .filter((x) => x.config.enabled);
}

export async function getNeedsOptions(user: WebJwtPayload): Promise<NeedsOptionsDto> {
  const today = await tenantToday(user.tenantId);
  const types = await pipelineTypes(user.tenantId);
  const org = await userOrganization(user);
  const ownState = org ? subebStateCode(org) : null;
  const canManage = hasWebPermission(user, 'needs:manage_cycle');
  const suggested = types.length ? Math.max(...types.map((t) => suggestedYear(t.config, today))) : Number(today.slice(0, 4)) + 1;

  const programmes = await Promise.all(
    types.map(async ({ type, config }) => {
      let canOpen = false;
      let openable: string[] = [];
      if (config.cycleScope === 'STATE') {
        openable = ownState ? [ownState] : [];
        canOpen = canManage && openable.length > 0;
      } else {
        const owner = await deriveCycleOwnerId(prisma, user.tenantId, type, 'NATIONAL', null);
        canOpen = canManage && (user.isPlatformSuperAdmin || owner === user.organizationId);
      }
      return {
        projectTypeId: type.id,
        projectTypeName: type.name,
        fundingGate: config.fundingGate,
        referencePrefix: config.referencePrefix,
        cycleScope: config.cycleScope,
        defaultDeadlines: cycleDeadlines(config, suggested),
        openableStateCodes: openable,
        canOpen,
      };
    })
  );
  const years = await prisma.needsCycle.findMany({ where: visibleCycleWhere(user), select: { interventionYear: true }, distinct: ['interventionYear'], orderBy: { interventionYear: 'desc' } });
  return { programmes, years: years.map((y) => y.interventionYear), suggestedInterventionYear: suggested };
}

export async function listCycles(user: WebJwtPayload, query: NeedsCycleListQuery): Promise<NeedsCycleSummaryDto[]> {
  const rows = await prisma.needsCycle.findMany({
    where: {
      AND: [
        visibleCycleWhere(user),
        {
          ...(query.interventionYear ? { interventionYear: query.interventionYear } : {}),
          ...(query.projectTypeId ? { projectTypeId: query.projectTypeId } : {}),
          ...(query.stateCode ? { stateCode: query.stateCode } : {}),
          ...(query.status ? { status: query.status } : {}),
        },
      ],
    },
    include: SUMMARY_INCLUDE,
    orderBy: [{ interventionYear: 'desc' }, { stateCode: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map((c) => serializeCycleSummary(c, cycleConfig(c)));
}

async function cycleDto(cycleId: string): Promise<NeedsCycleDto> {
  const c = await prisma.needsCycle.findUniqueOrThrow({
    where: { id: cycleId },
    include: { ...SUMMARY_INCLUDE, costingStandardVersion: { select: { version: true } }, documents: true },
  });
  const config = cycleConfig(c);
  const counts = await prisma.needsProposal.groupBy({ by: ['stage', 'status'], where: { cycleId }, _count: { _all: true } });
  return {
    ...serializeCycleSummary(c, config),
    config,
    deadlines: deadlinesOf(c.deadlinesJson),
    templateVersion: c.templateVersion,
    costingStandardVersionId: c.costingStandardVersionId,
    costingStandardVersion: c.costingStandardVersion?.version ?? null,
    indicativeCeilingNgn: dec(c.indicativeCeilingNgn),
    documents: currentFirst(c.documents).map(serializeCycleDocument),
    counts: counts.map((g) => ({ stage: g.stage as NeedsStage, status: g.status as NeedsProposalStatus, count: g._count._all })),
    openedByName: c.openedByName,
    closedByName: c.closedByName,
  };
}

export async function getCycle(user: WebJwtPayload, cycleId: string): Promise<NeedsCycleDto> {
  const cycle = await loadVisibleCycle(user, cycleId);
  return cycleDto(cycle.id);
}

/** The cycle's calendar with the request's dates applied (unknown key: 422). */
function applyDeadlineOverrides(base: NeedsDeadline[], overrides: NeedsDeadlineOverride[]): NeedsDeadline[] {
  const byKey = new Map(base.map((d) => [d.key, { ...d }]));
  for (const o of overrides) {
    const d = byKey.get(o.key);
    if (!d) throw new AppError(`The cycle has no deadline "${o.key}"`, 422, 'NEEDS_DEADLINE_UNKNOWN', { key: o.key });
    d.date = o.date;
  }
  return [...byKey.values()].map((d, i) => ({ d, i })).sort((a, b) => a.d.date.localeCompare(b.d.date) || a.i - b.i).map((x) => x.d);
}

/** The previous year's cycle of the same type and scope (D-N.19). */
async function previousCycle(tenantId: string, projectTypeId: string, interventionYear: number, scopeKey: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
  return db.needsCycle.findFirst({ where: { tenantId, projectTypeId, interventionYear: interventionYear - 1, scopeKey } });
}

async function loadPipelineType(tenantId: string, projectTypeId: string) {
  const type = isUuid(projectTypeId) ? await prisma.projectType.findFirst({ where: { id: projectTypeId, tenantId } }) : null;
  if (!type) throw new AppError('Programme not found', 404, 'PROJECT_TYPE_NOT_FOUND');
  const config = typeConfig(type).needsPipeline;
  if (!type.isActive || !config.enabled) {
    throw new AppError(`${type.name} has no needs assessment pipeline. Turn it on in the programme settings first.`, 422, 'NEEDS_PIPELINE_DISABLED');
  }
  return { type, config };
}

function checkScope(config: NeedsPipelineConfig, stateCode: string | null): string | null {
  if (config.cycleScope === 'STATE') {
    if (!stateCode || !stateByCode(stateCode)) throw new AppError('Choose the State this cycle is for', 422, 'NEEDS_CYCLE_STATE_REQUIRED');
    return stateCode.toUpperCase();
  }
  if (stateCode) throw new AppError('A national cycle is not for one State: leave the State empty', 422, 'NEEDS_CYCLE_STATE_NOT_ALLOWED');
  return null;
}

export async function listCarryForwardCandidates(user: WebJwtPayload, query: NeedsCarryForwardQuery): Promise<NeedsCarryForwardCandidateDto[]> {
  const { type, config } = await loadPipelineType(user.tenantId, query.projectTypeId);
  const stateCode = checkScope(config, query.stateCode ?? null);
  const prev = await previousCycle(user.tenantId, type.id, query.interventionYear, scopeKeyOf(config.cycleScope, stateCode));
  if (!prev) return [];
  const visible = await prisma.needsCycle.count({ where: { AND: [{ id: prev.id }, visibleCycleWhere(user)] } });
  if (!visible) return [];
  const prevConfig = cycleConfig(prev);
  const rows = await prisma.needsProposal.findMany({
    where: { cycleId: prev.id, status: 'NOT_SELECTED', carriedTo: { none: {} } },
    include: { currentVersion: { select: { siteCount: true } } },
    orderBy: { sequence: 'asc' },
  });
  return rows.map((p) => ({
    proposalId: p.id,
    reference: p.reference,
    title: p.title,
    cycleId: prev.id,
    interventionYear: prev.interventionYear,
    statusLabel: proposalStatusLabel({ stage: p.stage as NeedsStage, status: p.status as NeedsProposalStatus }, prevConfig),
    statusReason: p.statusReason,
    siteCount: p.currentVersion?.siteCount ?? 0,
    lgaCodes: p.lgaCodes,
    preliminaryCostNgn: dec(p.preliminaryAmountNgn),
    costedAmountNgn: dec(p.costedAmountNgn),
  }));
}

export async function openCycle(user: WebJwtPayload, input: OpenNeedsCycleRequest): Promise<NeedsCycleDto> {
  const { type, config } = await loadPipelineType(user.tenantId, input.projectTypeId);
  const stateCode = checkScope(config, input.stateCode);
  const scopeKey = scopeKeyOf(config.cycleScope, stateCode);
  const ownerId = await deriveCycleOwnerId(prisma, user.tenantId, type, config.cycleScope, stateCode);
  if (!ownerId) {
    throw new AppError(
      config.cycleScope === 'STATE' ? `No SUBEB is set up for ${stateByCode(stateCode)?.name ?? stateCode}` : 'The programme has no owning organisation',
      422,
      'NEEDS_CYCLE_OWNER_NOT_FOUND'
    );
  }
  if (!user.isPlatformSuperAdmin && ownerId !== user.organizationId) {
    throw new AppError('Only the organisation that owns this cycle can open it', 403, 'NEEDS_CYCLE_FORBIDDEN');
  }
  const deadlines = applyDeadlineOverrides(cycleDeadlines(config, input.interventionYear), input.deadlines);
  const actor = webActor(user);
  const name = actorName(user);

  const cycleId = await prisma.$transaction(async (tx) => {
    const existing = await tx.needsCycle.findUnique({
      where: { tenantId_projectTypeId_interventionYear_scopeKey: { tenantId: user.tenantId, projectTypeId: type.id, interventionYear: input.interventionYear, scopeKey } },
      select: { id: true },
    });
    if (existing) {
      throw new AppError(
        `A ${type.name} cycle for ${input.interventionYear}${stateCode ? ` (${stateByCode(stateCode)?.name})` : ''} already exists`,
        409,
        'NEEDS_CYCLE_EXISTS',
        { cycleId: existing.id }
      );
    }
    const standard = await latestCostingStandardRow(user.tenantId, tx);
    if (standard) await lockCostingStandardVersion(tx, standard.id);
    const now = new Date();
    const cycle = await tx.needsCycle.create({
      data: {
        tenantId: user.tenantId,
        projectTypeId: type.id,
        interventionYear: input.interventionYear,
        stateCode,
        scopeKey,
        owningOrganizationId: ownerId,
        status: 'OPEN',
        configSnapshotJson: config as unknown as Prisma.InputJsonValue,
        deadlinesJson: deadlines as unknown as Prisma.InputJsonValue,
        templateVersion: NEEDS_TEMPLATE_VERSION,
        costingStandardVersionId: standard?.id ?? null,
        indicativeCeilingNgn: input.indicativeCeilingNgn,
        createdByUserId: user.userId,
        openedAt: now,
        openedByUserId: user.userId,
        openedByName: user.fullName,
      },
    });
    // D-N.23: the chain steps, version 1.
    const steps = NeedsChainTypeEnum.options.flatMap((chainType) =>
      config.approvalChains[chainType].map((s, i) => ({
        cycleId: cycle.id,
        chainType,
        version: 1,
        stepOrder: i + 1,
        label: s.label,
        requiredPermissionKey: s.requiredPermissionKey,
        organizationScope: s.organizationScope,
        isActive: true,
      }))
    );
    if (steps.length) await tx.needsApprovalStep.createMany({ data: steps });

    const carried = await carryForwardInTx(tx, user, cycle, config, input.carryForwardProposalIds);

    await recordAuditEvent(tx, {
      tenantId: user.tenantId,
      projectId: null,
      ...actor,
      action: 'NEEDS_CYCLE_OPENED',
      summaryText:
        `Opened the ${type.name} needs assessment cycle for ${input.interventionYear}${stateCode ? ` (${stateByCode(stateCode)?.name})` : ''}` +
        `${standard ? ` on costing standard v${standard.version}` : ''}${carried.length ? `; carried forward ${carried.map((c) => c.from).join(', ')}` : ''}.`,
      payload: {
        cycleId: cycle.id,
        projectTypeId: type.id,
        interventionYear: input.interventionYear,
        stateCode,
        owningOrganizationId: ownerId,
        costingStandardVersionId: standard?.id ?? null,
        templateVersion: NEEDS_TEMPLATE_VERSION,
        deadlineOverrides: input.deadlines,
        carriedForward: carried,
        openedBy: name,
      },
    });
    return cycle.id;
  });
  return cycleDto(cycleId);
}

/** B9 (D-N.19): each selected proposal becomes a new proposal of the new cycle, at Validation. */
async function carryForwardInTx(
  tx: Prisma.TransactionClient,
  user: WebJwtPayload,
  cycle: CycleRow,
  config: NeedsPipelineConfig,
  ids: string[]
): Promise<Array<{ from: string; to: string; fromProposalId: string; proposalId: string }>> {
  if (!ids.length) return [];
  const unique = [...new Set(ids)];
  const found = await previousCycle(user.tenantId, cycle.projectTypeId, cycle.interventionYear, cycle.scopeKey, tx);
  // Review fix (wave 2): only from a previous cycle the opener can see (the type's owner may have changed).
  const prev = found && (await tx.needsCycle.count({ where: { AND: [{ id: found.id }, visibleCycleWhere(user)] } })) > 0 ? found : null;
  const rows = prev
    ? await tx.needsProposal.findMany({
        where: { id: { in: unique.filter(isUuid) }, cycleId: prev.id, status: 'NOT_SELECTED' },
        include: { currentVersion: true, carriedTo: { select: { id: true, reference: true } } },
        orderBy: { sequence: 'asc' },
      })
    : [];
  const refused = unique.filter((id) => !rows.some((r) => r.id === id && r.carriedTo.length === 0 && r.currentVersion));
  if (refused.length) {
    throw new AppError(
      'Only proposed projects of the previous cycle that were not selected, and not carried forward already, can be carried forward',
      422,
      'NEEDS_CARRY_FORWARD_INVALID',
      { proposalIds: refused }
    );
  }
  const stage: NeedsStage = config.stages.some((s) => s.stage === 'VALIDATION') ? 'VALIDATION' : config.stages[0].stage;
  await lockCycle(tx, cycle.id);
  const out: Array<{ from: string; to: string; fromProposalId: string; proposalId: string }> = [];
  for (const old of rows) {
    const v = old.currentVersion!;
    const parsed = parsedOf(v.parsedJson);
    if (!parsed) throw new AppError(`${old.reference} has no readable needs assessment to carry forward`, 422, 'NEEDS_CARRY_FORWARD_INVALID', { proposalIds: [old.id] });
    const { sequence, reference } = await nextProposalReference(tx, cycle, config);
    const proposal = await tx.needsProposal.create({
      data: {
        tenantId: user.tenantId,
        cycleId: cycle.id,
        reference,
        sequence,
        title: old.title,
        route: 'ANNUAL',
        stage,
        status: 'IN_PROGRESS',
        stateCode: old.stateCode,
        lgaCodes: old.lgaCodes,
        carriedFromId: old.id,
        createdByUserId: user.userId,
        createdByName: user.fullName,
      },
    });
    const written = await writeVersionInTx(tx, {
      tenantId: user.tenantId,
      cycle,
      config,
      proposal: { id: proposal.id, reference, stateCode: old.stateCode },
      source: 'CARRY_FORWARD',
      file: { objectKey: v.objectKey, fileName: v.fileName, mimeType: v.mimeType, byteSize: v.byteSize, sha256: v.sha256 },
      parsed,
      costingStandardVersionId: v.costingStandardVersionId,
      isLegacyTemplate: v.templateVersion !== NEEDS_TEMPLATE_VERSION,
      uploadedBy: { userId: user.userId, name: user.fullName },
    });
    await tx.needsProposal.update({ where: { id: old.id }, data: { statusReason: `Carried forward to ${reference}` } });
    await recordAuditEvent(tx, {
      tenantId: user.tenantId,
      projectId: null,
      ...webActor(user),
      action: 'NEEDS_PROPOSAL_CREATED',
      summaryText: `Carried ${old.reference} forward into the ${cycle.interventionYear} cycle as ${reference}, at ${config.stages.find((s) => s.stage === stage)?.label ?? stage}.`,
      payload: {
        cycleId: cycle.id,
        proposalId: proposal.id,
        reference,
        versionNumber: written.versionNumber,
        sha256: v.sha256,
        carriedFromId: old.id,
        carriedFromReference: old.reference,
        source: 'CARRY_FORWARD',
      },
    });
    // The old proposal's history finds this entry by `carriedFromId`.
    out.push({ from: old.reference, to: reference, fromProposalId: old.id, proposalId: proposal.id });
  }
  return out;
}

export async function updateCycle(user: WebJwtPayload, cycleId: string, input: UpdateNeedsCycleRequest): Promise<NeedsCycleDto> {
  const cycle = await loadWritableCycle(user, cycleId);
  const data: Prisma.NeedsCycleUpdateInput = {};
  const changes: string[] = [];
  if (input.indicativeCeilingNgn !== undefined) {
    data.indicativeCeilingNgn = input.indicativeCeilingNgn;
    changes.push(input.indicativeCeilingNgn === null ? 'cleared the indicative ceiling' : `set the indicative ceiling to ₦${input.indicativeCeilingNgn.toLocaleString('en-GB')}`);
  }
  if (input.deadlines !== undefined) {
    const next = applyDeadlineOverrides(deadlinesOf(cycle.deadlinesJson), input.deadlines);
    data.deadlinesJson = next as unknown as Prisma.InputJsonValue;
    if (input.deadlines.length) changes.push(`moved ${input.deadlines.map((d) => `${next.find((x) => x.key === d.key)?.label ?? d.key} to ${d.date}`).join(', ')}`);
  }
  if (!changes.length) return cycleDto(cycle.id);
  await prisma.$transaction(async (tx) => {
    // Review fix (wave 2): under the cycle lock, like uploads, so a write cannot interleave with a close.
    await lockCycle(tx, cycle.id);
    const fresh = await tx.needsCycle.findUniqueOrThrow({ where: { id: cycle.id }, select: { status: true } });
    if (fresh.status !== "OPEN") throw new AppError("This cycle is not open", 409, "NEEDS_CYCLE_NOT_OPEN");
    await tx.needsCycle.update({ where: { id: cycle.id }, data });
    await recordAuditEvent(tx, {
      tenantId: user.tenantId,
      projectId: null,
      ...webActor(user),
      action: 'NEEDS_CYCLE_UPDATED',
      summaryText: `Cycle ${cycle.interventionYear}${cycle.stateCode ? ` (${cycle.stateCode})` : ''}: ${changes.join('; ')}.`,
      payload: { cycleId: cycle.id, indicativeCeilingNgn: input.indicativeCeilingNgn, deadlines: input.deadlines },
    });
  });
  return cycleDto(cycle.id);
}

export async function closeCycle(user: WebJwtPayload, cycleId: string, input: CloseNeedsCycleRequest): Promise<NeedsCycleDto> {
  const cycle = await loadWritableCycle(user, cycleId);
  await prisma.$transaction(async (tx) => {
    // Review fix (wave 2): under the cycle lock, like uploads, so a write cannot interleave with a close.
    await lockCycle(tx, cycle.id);
    const fresh = await tx.needsCycle.findUniqueOrThrow({ where: { id: cycle.id }, select: { status: true } });
    if (fresh.status !== "OPEN") throw new AppError("This cycle is not open", 409, "NEEDS_CYCLE_NOT_OPEN");
    await tx.needsCycle.update({ where: { id: cycle.id }, data: { status: 'CLOSED', closedAt: new Date(), closedByUserId: user.userId, closedByName: user.fullName } });
    await recordAuditEvent(tx, {
      tenantId: user.tenantId,
      projectId: null,
      ...webActor(user),
      action: 'NEEDS_CYCLE_CLOSED',
      summaryText: `Closed the ${cycle.interventionYear}${cycle.stateCode ? ` (${cycle.stateCode})` : ''} needs assessment cycle${input.reason ? `: ${input.reason}` : '.'}`,
      payload: { cycleId: cycle.id, reason: input.reason },
    });
  });
  return cycleDto(cycle.id);
}

// ---------------------------------------------------------------------------
// Documents (decision 5: presign kind NEEDS_DOCUMENT, keys under the cycle)
// ---------------------------------------------------------------------------

export const cycleDocumentPrefix = (tenantId: string, cycleId: string) => tenantAreaPrefix(tenantId, `needs/cycles/${cycleId}/needs_document`);
export const cycleVersionPrefix = (tenantId: string, cycleId: string) => tenantAreaPrefix(tenantId, `needs/cycles/${cycleId}/versions`);

export async function presignNeedsDocument(user: WebJwtPayload, cycleId: string, input: NeedsDocumentPresignRequest): Promise<NeedsPresignedUploadDto> {
  const cycle = await loadWritableCycle(user, cycleId);
  return presignTenantAreaUpload({
    prefix: cycleDocumentPrefix(user.tenantId, cycle.id),
    fileName: input.fileName,
    mimeType: input.mimeType,
    byteSize: input.byteSize,
    policy: NEEDS_DOCUMENT_UPLOAD_POLICY,
  });
}

export async function listCycleDocuments(user: WebJwtPayload, cycleId: string): Promise<NeedsCycleDocumentDto[]> {
  const cycle = await loadVisibleCycle(user, cycleId);
  const rows = await prisma.needsCycleDocument.findMany({ where: { cycleId: cycle.id } });
  return currentFirst(rows).map(serializeCycleDocument);
}

export async function registerCycleDocument(user: WebJwtPayload, cycleId: string, input: RegisterCycleDocumentRequest): Promise<NeedsCycleDocumentDto> {
  const cycle = await loadWritableCycle(user, cycleId);
  const proposalIds = [...new Set(input.proposalIds)];
  if (proposalIds.length) {
    const found = await prisma.needsProposal.count({ where: { id: { in: proposalIds.filter(isUuid) }, cycleId: cycle.id } });
    if (found !== proposalIds.length) throw new AppError('Proposed project not found in this cycle', 404, 'NEEDS_PROPOSAL_NOT_FOUND');
  }
  if (input.supersedesId) {
    const previous = await prisma.needsCycleDocument.findFirst({ where: { id: input.supersedesId, cycleId: cycle.id } });
    if (!previous) throw new AppError('The document it replaces is not in this cycle', 404, 'NEEDS_DOCUMENT_NOT_FOUND');
    if (previous.kind !== input.kind) throw new AppError('A new version must be the same kind of document', 422, 'NEEDS_DOCUMENT_KIND_MISMATCH');
  }
  const file = await inspectTenantAreaUpload(input.objectKey, cycleDocumentPrefix(user.tenantId, cycle.id), NEEDS_DOCUMENT_UPLOAD_POLICY);
  const doc = await prisma.$transaction(async (tx) => {
    await lockCycle(tx, cycle.id);
    await assertDocumentRegistrable(tx, { cycleId: cycle.id, objectKey: file.objectKey, supersedes: input.supersedesId ? { table: "cycle", id: input.supersedesId } : null });
    const created = await tx.needsCycleDocument.create({
      data: {
        cycleId: cycle.id,
        kind: input.kind,
        title: input.title,
        generated: false,
        objectKey: file.objectKey,
        fileName: file.fileName,
        mimeType: file.mimeType,
        byteSize: file.byteSize,
        sha256: file.sha256,
        supersedesId: input.supersedesId,
        coveredProposalIds: proposalIds,
        uploadedByUserId: user.userId,
        uploadedByName: user.fullName,
      },
    });
    await recordAuditEvent(tx, {
      tenantId: user.tenantId,
      projectId: null,
      ...webActor(user),
      action: 'NEEDS_DOCUMENT_ADDED',
      summaryText: `${input.supersedesId ? 'Replaced' : 'Added'} the cycle document "${input.title}" (${CYCLE_DOCUMENT_KIND_META[input.kind].label}).`,
      payload: { cycleId: cycle.id, documentId: created.id, kind: input.kind, title: input.title, supersedesId: input.supersedesId, proposalIds, sha256: file.sha256, fileName: file.fileName },
    });
    return created;
  });
  return serializeCycleDocument(doc);
}

const LINK_SECONDS = 300;

/** A signed link to a stored needs file (the caller checked access). */
export async function fileLink(objectKey: string, fileName: string): Promise<NeedsFileLinkDto> {
  const url = await storageService.getPresignedReadUrl(objectKey, LINK_SECONDS, { attachmentName: fileName });
  return { url, expiresInSeconds: LINK_SECONDS, fileName };
}

export async function cycleDocumentFile(user: WebJwtPayload, cycleId: string, documentId: string): Promise<NeedsFileLinkDto> {
  const cycle = await loadVisibleCycle(user, cycleId);
  const doc = isUuid(documentId) ? await prisma.needsCycleDocument.findFirst({ where: { id: documentId, cycleId: cycle.id } }) : null;
  if (!doc) throw new AppError('Document not found', 404, 'NEEDS_DOCUMENT_NOT_FOUND');
  return fileLink(doc.objectKey, doc.fileName);
}
