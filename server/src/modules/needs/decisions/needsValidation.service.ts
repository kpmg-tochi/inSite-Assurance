import { Prisma } from '@prisma/client';
import {
  FLAG_RESOLUTIONS_BY_KIND,
  FLAG_RESOLVER_PERMISSION,
  NEEDS_OPEN_PROPOSAL_STATUSES,
  NEEDS_SEPARATION_ERROR_MESSAGES,
  NEEDS_STAGE_ORDER,
  PROPOSAL_FLAG_KIND_META,
  PROPOSAL_FLAG_RESOLUTION_LABELS,
  type FlagResolutionInput,
  type NeedsProposalStatus,
  type NeedsSeparationAction,
  type NeedsStage,
  type NeedsValidationRecordDto,
  type ProposalFlagDto,
  type ProposalFlagKind,
  type RecordValidationRequest,
  type ResolveProposalFlagsRequest,
  type SiteVerification,
  type StageOutcome,
} from '@insite/shared';
import { prisma } from '../../../config/prisma';
import { AppError } from '../../../middleware/error.middleware';
import type { WebJwtPayload } from '../../../middleware/auth.middleware';
import { recordAuditEvent } from '../../audit/audit.service';
import { assertCycleWritable, loadVisibleProposal, webActor, type CycleRow, type ProposalRow } from '../needsAccess';
import { redactFlagsForViewer } from '../needsFlags.service';
import { serializeFlag } from '../needsSerializers';
import { cycleConfig } from '../needsSupport';
import { lockCycle } from '../needsVersions';
import { recordOverrideUseInTx } from './needsOverrides.service';
import { holds, loadRuleFacts, separationFor, type OverrideFlagFact, type RuleFacts } from './proposalRules';

/**
 * Needs pipeline wave 3 (A2, A4): validation records and flag resolutions.
 *
 * Validation record (`POST /proposals/:proposalId/validation`, needs:validate): the proposal is
 * IN_PROGRESS at Validation; separation VALIDATE (uploaders may not validate; an authorisation lets
 * them); written on the current version. An ADVANCE record needs a site verification when the cycle's
 * `requireSiteVerification` is on (422 NEEDS_SITE_VERIFICATION_REQUIRED); evidence must be current
 * SITE_VERIFICATION_EVIDENCE, PHOTO or SITE_REPORT documents of this proposal (422
 * NEEDS_EVIDENCE_INVALID). Its flag resolutions resolve this proposal's open DUPLICATE and
 * ESSENTIAL_FACILITY_GAP flags (`FLAG_RESOLUTIONS_BY_KIND`; else 422 NEEDS_FLAG_RESOLUTION_INVALID):
 * NOT_VALIDATED needs the record outcome NOT_VALIDATED; MERGED (not on an ADVANCE record) needs another
 * open proposal of the cycle and closes this one MERGED (audit NEEDS_PROPOSAL_MERGED). Audit
 * NEEDS_VALIDATION_RECORDED and NEEDS_FLAG_RESOLVED per flag.
 *
 * Flag resolutions on their own (`POST /proposals/:proposalId/flags/resolve`): the resolver holds
 * `FLAG_RESOLVER_PERMISSION[kind]` (403), the proposal is open and at the stage the flag blocks or
 * earlier (409 NEEDS_STAGE_ACTION_NOT_ALLOWED), the separation rule of that stage applies;
 * MISSING_SUPERVISION_LINE (only a corrected version clears it) and SEPARATION_OVERRIDE (the override
 * routes) are never resolved here, nor is NOT_VALIDATED (the validation record's), 422.
 */

type Tx = Prisma.TransactionClient;
type FlagRow = Prisma.NeedsProposalFlagGetPayload<object>;

const EVIDENCE_KINDS = ['SITE_VERIFICATION_EVIDENCE', 'PHOTO', 'SITE_REPORT'];
const idx = (s: string) => NEEDS_STAGE_ORDER.indexOf(s as NeedsStage);
const SEPARATION_OF_RESOLVER: Record<string, NeedsSeparationAction> = { 'needs:validate': 'VALIDATE', 'needs:cost': 'COST' };

async function writableProposal(tx: Tx, user: WebJwtPayload, proposalId: string): Promise<{ proposal: ProposalRow; cycle: CycleRow }> {
  const base = await loadVisibleProposal(user, proposalId, tx);
  assertCycleWritable(user, base.cycle);
  await lockCycle(tx, base.cycleId);
  const proposal = await tx.needsProposal.findUniqueOrThrow({ where: { id: base.id } });
  const cycle = await tx.needsCycle.findUniqueOrThrow({ where: { id: base.cycleId } });
  if (cycle.status !== 'OPEN') throw new AppError('This cycle is not open', 409, 'NEEDS_CYCLE_NOT_OPEN');
  return { proposal, cycle };
}

function separationOrThrow(facts: RuleFacts, proposal: ProposalRow, action: NeedsSeparationAction, userId: string): OverrideFlagFact | null {
  const { check, flag } = separationFor(facts, proposal, action, userId);
  if (!check.allowed) throw new AppError(NEEDS_SEPARATION_ERROR_MESSAGES[check.violation!], 409, check.violation!);
  return flag;
}

/** One person's resolution of one flag (shared by the record and the resolve route). */
async function resolveFlagInTx(
  tx: Tx,
  user: WebJwtPayload,
  cycle: CycleRow,
  proposal: ProposalRow,
  flag: FlagRow,
  input: FlagResolutionInput
): Promise<{ merged: boolean }> {
  const kind = flag.kind as ProposalFlagKind;
  let merged = false;
  let mergeInto: { id: string; reference: string } | null = null;
  if (input.resolution === 'MERGED') {
    const target = input.mergeIntoProposalId
      ? await tx.needsProposal.findFirst({ where: { id: input.mergeIntoProposalId, cycleId: cycle.id }, select: { id: true, reference: true, status: true } })
      : null;
    if (!target || target.id === proposal.id || !NEEDS_OPEN_PROPOSAL_STATUSES.includes(target.status as NeedsProposalStatus)) {
      throw new AppError('Merge into another open proposed project of this cycle', 422, 'NEEDS_MERGE_TARGET_INVALID');
    }
    mergeInto = target;
  }
  await tx.needsProposalFlag.update({
    where: { id: flag.id },
    data: { resolvedAt: new Date(), resolvedByUserId: user.userId, resolvedByName: user.fullName, resolution: input.resolution, resolutionReason: input.reason },
  });
  await recordAuditEvent(tx, {
    tenantId: user.tenantId,
    projectId: null,
    ...webActor(user),
    action: 'NEEDS_FLAG_RESOLVED',
    summaryText: `${PROPOSAL_FLAG_KIND_META[kind].label} on ${proposal.reference}: ${PROPOSAL_FLAG_RESOLUTION_LABELS[input.resolution]}${mergeInto ? ` (${mergeInto.reference})` : ''}. ${input.reason}`,
    payload: {
      cycleId: cycle.id,
      proposalId: proposal.id,
      reference: proposal.reference,
      flagId: flag.id,
      kind,
      resolution: input.resolution,
      reason: input.reason,
      ...(mergeInto ? { mergeIntoProposalId: mergeInto.id, mergeIntoReference: mergeInto.reference } : {}),
    },
  });
  if (mergeInto) {
    await tx.needsProposal.update({ where: { id: proposal.id }, data: { status: 'MERGED', mergedIntoId: mergeInto.id, statusReason: `Merged into ${mergeInto.reference}: ${input.reason}` } });
    await recordAuditEvent(tx, {
      tenantId: user.tenantId,
      projectId: null,
      ...webActor(user),
      action: 'NEEDS_PROPOSAL_MERGED',
      summaryText: `Merged ${proposal.reference} into ${mergeInto.reference}: ${input.reason}`,
      payload: { cycleId: cycle.id, proposalId: proposal.id, reference: proposal.reference, mergeIntoProposalId: mergeInto.id, mergeIntoReference: mergeInto.reference },
    });
    merged = true;
  }
  return { merged };
}

function checkResolutionAllowed(flag: FlagRow | undefined, input: FlagResolutionInput, kinds: readonly string[]): FlagRow {
  if (!flag) throw new AppError('Flag not found on this proposed project', 404, 'NEEDS_FLAG_NOT_FOUND');
  if (flag.resolvedAt) throw new AppError('This flag is already resolved', 409, 'NEEDS_FLAG_ALREADY_RESOLVED');
  const kind = flag.kind as ProposalFlagKind;
  if (!kinds.includes(kind)) throw new AppError(`A ${PROPOSAL_FLAG_KIND_META[kind]?.label.toLowerCase() ?? kind} flag is not resolved here`, 422, 'NEEDS_FLAG_RESOLUTION_INVALID');
  if (!FLAG_RESOLUTIONS_BY_KIND[kind].includes(input.resolution)) {
    throw new AppError(
      `A ${PROPOSAL_FLAG_KIND_META[kind].label.toLowerCase()} flag is resolved as ${FLAG_RESOLUTIONS_BY_KIND[kind].map((r) => PROPOSAL_FLAG_RESOLUTION_LABELS[r].toLowerCase()).join(' or ') || 'a corrected version'}`,
      422,
      'NEEDS_FLAG_RESOLUTION_INVALID'
    );
  }
  return flag;
}

type RecordRow = Prisma.NeedsValidationRecordGetPayload<{ include: { version: { select: { number: true } } } }>;

export function serializeValidationRecord(r: RecordRow): NeedsValidationRecordDto {
  return {
    id: r.id,
    proposalId: r.proposalId,
    versionNumber: r.version.number,
    outcome: r.outcome as StageOutcome,
    deskNotes: r.deskNotes,
    siteVerification: (r.siteVerificationJson as SiteVerification | null) ?? null,
    duplicateResolutions: Array.isArray(r.duplicateResolutionsJson) ? (r.duplicateResolutionsJson as NeedsValidationRecordDto['duplicateResolutions']) : [],
    recordedByUserId: r.recordedByUserId,
    recordedByName: r.recordedByName,
    recordedAt: r.recordedAt.toISOString(),
  };
}

export async function recordValidation(user: WebJwtPayload, proposalId: string, input: RecordValidationRequest): Promise<NeedsValidationRecordDto> {
  return prisma.$transaction(
    async (tx) => {
      const { proposal, cycle } = await writableProposal(tx, user, proposalId);
      const config = cycleConfig(cycle);
      if (proposal.stage !== 'VALIDATION' || proposal.status !== 'IN_PROGRESS' || !proposal.currentVersionId) {
        throw new AppError(`${proposal.reference} is not waiting for validation`, 409, 'NEEDS_STAGE_ACTION_NOT_ALLOWED');
      }
      const facts = await loadRuleFacts(tx, user, [], [proposal.id]);
      const overrideFlag = separationOrThrow(facts, proposal, 'VALIDATE', user.userId);

      if (input.outcome === 'ADVANCE' && config.requireSiteVerification && !input.siteVerification) {
        throw new AppError('Record the site verification before validating', 422, 'NEEDS_SITE_VERIFICATION_REQUIRED');
      }
      const evidenceIds = input.siteVerification?.evidenceDocumentIds ?? [];
      if (evidenceIds.length) {
        const docs = await tx.needsProposalDocument.findMany({ where: { proposalId: proposal.id }, select: { id: true, kind: true, supersedesId: true } });
        const superseded = new Set(docs.map((d) => d.supersedesId).filter(Boolean));
        const ok = new Set(docs.filter((d) => EVIDENCE_KINDS.includes(d.kind) && !superseded.has(d.id)).map((d) => d.id));
        if (evidenceIds.some((id) => !ok.has(id))) {
          throw new AppError('Site verification evidence must be current site verification, photo or site report documents of this proposed project', 422, 'NEEDS_EVIDENCE_INVALID');
        }
      }

      const flags = await tx.needsProposalFlag.findMany({ where: { proposalId: proposal.id } });
      const resolutions = input.flagResolutions.map((r) => {
        const flag = checkResolutionAllowed(
          flags.find((f) => f.id === r.flagId),
          r,
          ['DUPLICATE', 'ESSENTIAL_FACILITY_GAP']
        );
        if (r.resolution === 'NOT_VALIDATED' && input.outcome !== 'NOT_VALIDATED') {
          throw new AppError('A duplicate resolved as not validated needs the record outcome "not validated"', 422, 'NEEDS_FLAG_RESOLUTION_INVALID');
        }
        if (r.resolution === 'MERGED' && input.outcome === 'ADVANCE') {
          throw new AppError('A proposed project merged into another one is not validated on its own', 422, 'NEEDS_FLAG_RESOLUTION_INVALID');
        }
        return { flag, input: r };
      });
      if (resolutions.filter((r) => r.input.resolution === 'MERGED').length > 1) {
        throw new AppError('A proposed project is merged into one other project only', 422, 'NEEDS_FLAG_RESOLUTION_INVALID');
      }

      const record = await tx.needsValidationRecord.create({
        data: {
          proposalId: proposal.id,
          versionId: proposal.currentVersionId,
          outcome: input.outcome,
          deskNotes: input.deskNotes,
          siteVerificationJson: input.siteVerification ? (input.siteVerification as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
          duplicateResolutionsJson: resolutions.map((r) => ({ flagId: r.flag.id, resolution: r.input.resolution, reason: r.input.reason })) as Prisma.InputJsonValue,
          recordedByUserId: user.userId,
          recordedByName: user.fullName,
        },
        include: { version: { select: { number: true } } },
      });
      if (overrideFlag) await recordOverrideUseInTx(tx, user, cycle, proposal, overrideFlag, 'Recorded a validation');
      await recordAuditEvent(tx, {
        tenantId: user.tenantId,
        projectId: null,
        ...webActor(user),
        action: 'NEEDS_VALIDATION_RECORDED',
        summaryText: `Recorded the validation of ${proposal.reference} v${record.version.number}: ${input.outcome === 'ADVANCE' ? 'validated' : input.outcome === 'RETURN' ? 'to be returned' : 'not validated'}${input.siteVerification ? `, site verified on ${input.siteVerification.verifiedOn}` : ''}.`,
        payload: {
          cycleId: cycle.id,
          proposalId: proposal.id,
          reference: proposal.reference,
          recordId: record.id,
          versionNumber: record.version.number,
          outcome: input.outcome,
          siteVerification: input.siteVerification ? { method: input.siteVerification.method, verifiedOn: input.siteVerification.verifiedOn } : null,
          flagIds: resolutions.map((r) => r.flag.id),
        },
      });
      for (const r of resolutions) await resolveFlagInTx(tx, user, cycle, proposal, r.flag, r.input);
      return serializeValidationRecord(record);
    },
    { timeout: 30_000 }
  );
}

export async function resolveProposalFlags(user: WebJwtPayload, proposalId: string, input: ResolveProposalFlagsRequest): Promise<ProposalFlagDto[]> {
  const ids = await prisma.$transaction(
    async (tx) => {
      const { proposal, cycle } = await writableProposal(tx, user, proposalId);
      if (!NEEDS_OPEN_PROPOSAL_STATUSES.includes(proposal.status as NeedsProposalStatus)) {
        throw new AppError(`${proposal.reference} is closed`, 409, 'NEEDS_STAGE_ACTION_NOT_ALLOWED');
      }
      const flags = await tx.needsProposalFlag.findMany({ where: { proposalId: proposal.id } });
      const facts = await loadRuleFacts(tx, user, [], [proposal.id]);
      const checked = input.resolutions.map((r) => {
        const flag = checkResolutionAllowed(
          flags.find((f) => f.id === r.flagId),
          r,
          ['DUPLICATE', 'ESSENTIAL_FACILITY_GAP', 'RATE_VARIANCE', 'CEILING_EXCEEDED']
        );
        if (r.resolution === 'NOT_VALIDATED') {
          throw new AppError('Record "not validated" in the validation record', 422, 'NEEDS_FLAG_RESOLUTION_INVALID');
        }
        const kind = flag.kind as ProposalFlagKind;
        const permission = FLAG_RESOLVER_PERMISSION[kind]!;
        if (!holds(user, permission)) throw new AppError(`Access requires permission(s): ${permission}`, 403, 'FORBIDDEN_PERMISSION');
        const blocks = PROPOSAL_FLAG_KIND_META[kind].blocksStage;
        if (!blocks || idx(proposal.stage) > idx(blocks)) {
          throw new AppError(`${proposal.reference} has passed ${blocks?.toLowerCase() ?? 'that stage'}: this flag is closed by a new version`, 409, 'NEEDS_STAGE_ACTION_NOT_ALLOWED');
        }
        const overrideFlag = separationOrThrow(facts, proposal, SEPARATION_OF_RESOLVER[permission], user.userId);
        return { flag, input: r, overrideFlag };
      });
      if (checked.filter((c) => c.input.resolution === 'MERGED').length > 1) {
        throw new AppError('A proposed project is merged into one other project only', 422, 'NEEDS_FLAG_RESOLUTION_INVALID');
      }
      const usedFlags = new Set<string>();
      for (const c of checked) {
        if (c.overrideFlag && !usedFlags.has(c.overrideFlag.id)) {
          usedFlags.add(c.overrideFlag.id);
          await recordOverrideUseInTx(tx, user, cycle, proposal, c.overrideFlag, 'Resolved a flag');
        }
        await resolveFlagInTx(tx, user, cycle, proposal, c.flag, c.input);
      }
      return checked.map((c) => c.flag.id);
    },
    { timeout: 30_000 }
  );
  const rows = await prisma.needsProposalFlag.findMany({ where: { id: { in: ids } }, orderBy: { raisedAt: 'asc' } });
  return redactFlagsForViewer(user, rows.map(serializeFlag));
}
