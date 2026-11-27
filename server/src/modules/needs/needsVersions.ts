import { Prisma } from '@prisma/client';
import {
  formatProposalReference,
  normaliseSchoolName,
  stagesFor,
  type NeedsPipelineConfig,
  type NeedsStage,
  type NeedsProposalStatus,
  type NeedsVersionSource,
  type ParsedNeedsAssessment,
  type ProposalFlagDto,
} from '@insite/shared';
import { AppError } from '../../middleware/error.middleware';
import { applyFlagFindings, computeFlagFindings } from './needsFlags.service';
import { costingStandardById, distinctLgas, lockCostingStandardVersion, parsedOf, versionAmounts, type LoadedCostingStandard } from './needsSupport';
import type { CycleRow } from './needsAccess';
import { compareVersions, reopenAfterChange, reopenSentence, type Reopen } from './decisions/versionChange';

/**
 * Needs pipeline wave 2 (B5, B6, B9): writing proposals and versions, always inside the caller's
 * transaction. Used by the upload confirm and by carry-forward at cycle opening.
 */

type Tx = Prisma.TransactionClient;

/** Serialises reference numbering and sha256 checks per cycle. */
export async function lockCycle(tx: Tx, cycleId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`needs-cycle:${cycleId}`}))`;
}

/**
 * Review fix (wave 2), call under `lockCycle`: an uploaded file is registered once in the cycle (cycle
 * and proposal documents share its key area), and a document version supersedes only the current one,
 * so a document never has two current versions.
 */
export async function assertDocumentRegistrable(
  tx: Tx,
  params: { cycleId: string; objectKey: string; supersedes: { table: 'cycle' | 'proposal'; id: string } | null }
): Promise<void> {
  const [asCycleDoc, asProposalDoc] = await Promise.all([
    tx.needsCycleDocument.count({ where: { cycleId: params.cycleId, objectKey: params.objectKey } }),
    tx.needsProposalDocument.count({ where: { objectKey: params.objectKey, proposal: { cycleId: params.cycleId } } }),
  ]);
  if (asCycleDoc + asProposalDoc > 0) {
    throw new AppError('This file is already registered as a document. Upload it again to add it as another document.', 409, 'NEEDS_DOCUMENT_EXISTS');
  }
  if (params.supersedes) {
    const later =
      params.supersedes.table === 'cycle'
        ? await tx.needsCycleDocument.count({ where: { supersedesId: params.supersedes.id } })
        : await tx.needsProposalDocument.count({ where: { supersedesId: params.supersedes.id } });
    if (later > 0) throw new AppError('A newer version of this document already exists. Replace the current version.', 409, 'NEEDS_DOCUMENT_SUPERSEDED');
  }
}

/** The next reference of the cycle (B6: call under `lockCycle`). */
export async function nextProposalReference(tx: Tx, cycle: Pick<CycleRow, 'id' | 'interventionYear' | 'stateCode'>, config: NeedsPipelineConfig): Promise<{ sequence: number; reference: string }> {
  const updated = await tx.needsCycle.update({ where: { id: cycle.id }, data: { proposalSequence: { increment: 1 } }, select: { proposalSequence: true } });
  const sequence = updated.proposalSequence;
  const reference = formatProposalReference({
    interventionYear: cycle.interventionYear,
    prefix: config.referencePrefix,
    stateCode: config.cycleScope === 'STATE' ? cycle.stateCode : null,
    sequence,
  });
  return { sequence, reference };
}

export function firstStage(config: NeedsPipelineConfig): NeedsStage {
  const first = stagesFor(config)[0];
  if (!first) throw new AppError('The cycle has no stages', 422, 'NEEDS_PIPELINE_DISABLED');
  return first;
}

/** B6: the current-version tables follow the version. */
export async function replaceCurrentTables(tx: Tx, proposalId: string, parsed: ParsedNeedsAssessment): Promise<void> {
  await tx.needsProposalSite.deleteMany({ where: { proposalId } });
  await tx.needsFacilityBreakdownRow.deleteMany({ where: { proposalId } });
  if (parsed.sites.length) {
    await tx.needsProposalSite.createMany({
      data: parsed.sites.map((s) => ({
        proposalId,
        siteNumber: s.siteNumber,
        schoolName: s.schoolName,
        schoolNameKey: normaliseSchoolName(s.schoolName),
        schoolLevel: s.schoolLevel,
        lgaCode: s.lgaCode,
        address: s.address,
        latitude: s.latitude,
        longitude: s.longitude,
        enrolment: s.enrolment,
      })),
    });
  }
  if (parsed.breakdownRows.length) {
    await tx.needsFacilityBreakdownRow.createMany({
      data: parsed.breakdownRows.map((r, i) => ({
        proposalId,
        siteNumber: r.siteNumber,
        unitId: r.unitId,
        facilityCode: r.facilityCode,
        interventionAction: r.interventionAction,
        existingQuantity: r.existingQuantity,
        existingCondition: r.existingCondition,
        requiredQuantity: r.requiredQuantity,
        proposedQuantity: r.proposedQuantity,
        unitOfMeasure: r.unitOfMeasure,
        preliminaryCostNgn: r.preliminaryCostNgn,
        technicalJustification: r.technicalJustification,
        criticality: r.criticality,
        supportingEvidence: r.supportingEvidence,
        evidenceDocumentIds: r.evidenceDocumentIds,
        sortOrder: i,
      })),
    });
  }
}

export interface VersionFile {
  objectKey: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
}

export interface WrittenVersion {
  versionId: string;
  versionNumber: number;
  flags: ProposalFlagDto[];
  /** Wave 3 (A5): the stage the change rule sent the proposal back to, with the sentence for the ledger. */
  reopened: (Reopen & { sentence: string }) | null;
}

/**
 * Adds a version to a proposal (number = last + 1), makes it current, replaces the current tables,
 * locks the costing standard version it names, updates the proposal's amounts and places, and runs
 * the flags. The caller writes the audit entry.
 *
 * Wave 3 (A5, the change rule): without a `statusUpdate`, the new version is compared with the
 * previous current one (`compareVersions`); a changed scope in Design or later sends the proposal
 * back to Validation, a changed cost after Costing back to Costing, IN_PROGRESS (a RETURNED proposal
 * reopened this way needs no resubmission), and the costed amount is cleared (it is signed off again).
 */
export async function writeVersionInTx(
  tx: Tx,
  params: {
    tenantId: string;
    cycle: Pick<CycleRow, 'id' | 'costingStandardVersionId'>;
    config: NeedsPipelineConfig;
    proposal: { id: string; reference: string; stateCode: string | null };
    source: NeedsVersionSource;
    file: VersionFile;
    parsed: ParsedNeedsAssessment;
    /** The costing standard version the file names (already resolved to a row id), or null. */
    costingStandardVersionId: string | null;
    isLegacyTemplate: boolean;
    uploadedBy: { userId: string; name: string };
    /** Status change that goes with the version (e.g. carry-forward), else unchanged. */
    statusUpdate?: { stage: NeedsStage; status: NeedsProposalStatus } | null;
  }
): Promise<WrittenVersion> {
  const last = await tx.needsAssessmentVersion.aggregate({ where: { proposalId: params.proposal.id }, _max: { number: true } });
  const number = (last._max.number ?? 0) + 1;
  const amounts = versionAmounts(params.parsed);
  let reopened: WrittenVersion['reopened'] = null;
  if (!params.statusUpdate) {
    const before = await tx.needsProposal.findUniqueOrThrow({
      where: { id: params.proposal.id },
      select: { stage: true, currentVersion: { select: { parsedJson: true } } },
    });
    const previous = parsedOf(before.currentVersion?.parsedJson);
    const r = previous ? reopenAfterChange(before.stage as NeedsStage, compareVersions(previous, params.parsed)) : null;
    if (r) reopened = { ...r, sentence: reopenSentence(r, params.config.stages.find((s) => s.stage === r.stage)?.label ?? r.stage) };
  }
  if (params.costingStandardVersionId) await lockCostingStandardVersion(tx, params.costingStandardVersionId);
  const version = await tx.needsAssessmentVersion.create({
    data: {
      proposalId: params.proposal.id,
      number,
      source: params.source,
      objectKey: params.file.objectKey,
      fileName: params.file.fileName,
      mimeType: params.file.mimeType,
      byteSize: params.file.byteSize,
      sha256: params.file.sha256,
      templateVersion: params.parsed.templateVersion,
      costingStandardVersionId: params.costingStandardVersionId,
      parsedJson: params.parsed as unknown as Prisma.InputJsonValue,
      siteCount: params.parsed.sites.length,
      breakdownRowCount: params.parsed.breakdownRows.length,
      boqLineCount: params.parsed.boqLines.length,
      preliminaryCostNgn: amounts.preliminaryCostNgn,
      costedTotalNgn: amounts.costedTotalNgn,
      uploadedByUserId: params.uploadedBy.userId,
      uploadedByName: params.uploadedBy.name,
    },
  });
  await replaceCurrentTables(tx, params.proposal.id, params.parsed);
  // Review fix (wave 3): a reopened proposal leaves any ranking it was in; its sheets scored the old content.
  if (reopened) await tx.needsScoreSheet.deleteMany({ where: { proposalId: params.proposal.id } });
  await tx.needsProposal.update({
    where: { id: params.proposal.id },
    data: {
      currentVersionId: version.id,
      preliminaryAmountNgn: amounts.preliminaryCostNgn,
      lgaCodes: distinctLgas(params.parsed),
      // Review fix (wave 2): the State follows the version (a national proposal may move State), so
      // the stored State, the LGAs and the zone of the rate-variance flags below agree.
      stateCode: params.proposal.stateCode,
      ...(params.parsed.project.title ? { title: params.parsed.project.title } : {}),
      ...(params.statusUpdate ? { stage: params.statusUpdate.stage, status: params.statusUpdate.status } : {}),
      ...(reopened
        ? {
            stage: reopened.stage,
            status: 'IN_PROGRESS',
            statusReason: `Version ${number}: ${reopened.sentence}`,
            costedAmountNgn: null,
            scoreImpact: null,
            scoreEase: null,
            scoreTotal: null,
            rank: null,
            aboveLine: null,
            lineOverrideReason: null,
          }
        : {}),
    },
  });

  const standard: LoadedCostingStandard | null = await costingStandardById(params.cycle.costingStandardVersionId, tx);
  const findings = await computeFlagFindings(
    tx,
    {
      tenantId: params.tenantId,
      config: params.config,
      standard,
      stateCode: params.proposal.stateCode,
      proposalId: params.proposal.id,
      isLegacyTemplate: params.isLegacyTemplate,
    },
    params.parsed
  );
  const flags = await applyFlagFindings(tx, {
    tenantId: params.tenantId,
    cycleId: params.cycle.id,
    proposalId: params.proposal.id,
    reference: params.proposal.reference,
    versionId: version.id,
    versionNumber: number,
    findings,
  });
  return { versionId: version.id, versionNumber: number, flags, reopened };
}
