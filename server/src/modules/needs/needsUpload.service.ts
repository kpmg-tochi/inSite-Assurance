import crypto from 'crypto';
import {
  NEEDS_FILE_MAX_BYTES,
  NEEDS_SEPARATION_ERROR_MESSAGES,
  NEEDS_STAGE_LABELS,
  NEEDS_TEMPLATE_SHEETS,
  NEEDS_TEMPLATE_VERSION,
  XLSX_CONTENT_TYPE,
  minimumFieldsFor,
  proposalStatusLabel,
  stageConfigOf,
  type NeedsFileIssue,
  type NeedsPipelineConfig,
  type NeedsProposalStatus,
  type NeedsStage,
  type NeedsUploadConfirmRequest,
  type NeedsUploadFilePreview,
  type NeedsUploadFileResult,
  type NeedsUploadPreviewDto,
  type NeedsUploadPreviewRequest,
  type NeedsUploadResultDto,
  type NeedsUploadSummary,
  type NeedsVersionSource,
  type ParsedNeedsAssessment,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import type { WebJwtPayload } from '../../middleware/auth.middleware';
import { storeTenantAreaBuffer } from '../../utils/tenantUploads';
import { recordAuditEvent } from '../audit/audit.service';
import { loadCycleProposal, loadWritableCycle, webActor, type CycleRow, type ProposalRow } from './needsAccess';
import { cycleVersionPrefix } from './needsCycles.service';
import { computeFlagFindings, expectedFlagsForViewer, redactFlagsForViewer } from './needsFlags.service';
import {
  costingStandardById,
  cycleConfig,
  distinctLgas,
  facilitiesSummary,
  stateOfParsed,
  versionAmounts,
  workbookFacilities,
  type LoadedCostingStandard,
} from './needsSupport';
import { firstStage, lockCycle, nextProposalReference, writeVersionInTx } from './needsVersions';
import { parseNeedsWorkbook, type NeedsWorkbookFacility } from './workbook/needsWorkbook';
import { recordOverrideUseInTx } from './decisions/needsOverrides.service';
import { holds, loadRuleFacts, narrowActions, separationFor, type OverrideFlagFact, type RuleFacts } from './decisions/proposalRules';
import { applyBeapRevisionInTx, beapRevisionPermit } from './submissions/beap.service';

/**
 * Wave 3 (A3, A4): who may add a version to a proposal now, and as what.
 * - A costed version (source COSTING): a proposal at Costing IN_PROGRESS, or RETURNED at
 *   Prioritisation; the action UPLOAD_COSTED_VERSION (needs:cost) and separation COST (a validator may
 *   not cost it unless another person authorised an override; the use is written to the ledger).
 * - Otherwise UPLOAD_VERSION: source CORRECTION when RETURNED, else UPLOAD.
 * Both narrowed by the owning organisation and an open cycle (`narrowActions`).
 *
 * Wave 4 (B4): a proposal at Funding in a BEAP cycle takes a BEAP revision (source BEAP_REVISION) from a
 * `needs:prepare_beap` holder while the BEAP is a draft or returned (`beapRevisionPermit`, computed by the
 * caller and passed as `beap`). A revision moves no stage (the wave 3 change rule does not apply); the
 * costed total of the new version becomes the proposal's costed amount and the BEAP item's amount.
 */
interface UploadPermit {
  ok: boolean;
  source: NeedsVersionSource;
  reason: string | null;
  /** The authorisation the costed upload goes ahead on. */
  overrideFlag: OverrideFlagFact | null;
}

type BeapRevision = Awaited<ReturnType<typeof beapRevisionPermit>>;

function uploadPermit(user: WebJwtPayload, cycle: CycleRow, config: NeedsPipelineConfig, proposal: ProposalRow, facts: RuleFacts, beap: BeapRevision = null): UploadPermit {
  if (beap) return beap.ok ? { ok: true, source: 'BEAP_REVISION', reason: null, overrideFlag: null } : { ok: false, source: 'BEAP_REVISION', reason: beap.reason, overrideFlag: null };
  const stage = proposal.stage as NeedsStage;
  const status = proposal.status as NeedsProposalStatus;
  const costed = (stage === 'COSTING' && status === 'IN_PROGRESS') || (stage === 'PRIORITISATION' && status === 'RETURNED');
  const needed = costed ? 'UPLOAD_COSTED_VERSION' : 'UPLOAD_VERSION';
  const source: NeedsVersionSource = costed ? 'COSTING' : status === 'RETURNED' ? 'CORRECTION' : 'UPLOAD';
  const { allowed, blocked } = narrowActions(user, cycle, config, proposal, facts);
  if (allowed.includes(needed)) {
    return { ok: true, source, reason: null, overrideFlag: costed ? separationFor(facts, proposal, 'COST', user.userId).flag : null };
  }
  const sep = blocked.find((b) => b.action === needed);
  if (sep) {
    return { ok: false, source, reason: `${proposal.reference}: ${NEEDS_SEPARATION_ERROR_MESSAGES[sep.violation]} Ask for a separation-of-duties override.`, overrideFlag: null };
  }
  return {
    ok: false,
    source,
    reason: `You cannot upload a new version of ${proposal.reference} while it is "${proposalStatusLabel({ stage, status }, config)}".`,
    overrideFlag: null,
  };
}

/**
 * Needs pipeline wave 2 (B5): uploading needs assessments, many files at once.
 *
 * Preview reads every file and writes nothing. Confirm takes the same files with the preview's
 * sha256: any mismatch is 409 NEEDS_FILE_CHANGED and nothing is written; then each valid file is
 * written in its own transaction (a new proposed project, or a new version of the proposal it
 * names) and invalid ones are listed as REFUSED. 201 when at least one file was written, else 422
 * NEEDS_FILE_INVALID with the per-file results in `details.files`.
 *
 * Per file (wave 2 decision 7): size, sha256 (recomputed by the server), the same file twice in one
 * request (the second refused), a file already a version in this cycle (refused), the target
 * proposal (it must be this cycle's and offer UPLOAD_VERSION to the uploader), then the template
 * parser with the stage's minimum fields (decision 3: without DRAWINGS). A pre-v2 file is read at
 * Identification only (decision 4).
 */

interface FileInput {
  fileName: string;
  fileBase64: string;
  proposalId: string | null;
}

interface Analysed {
  preview: NeedsUploadFilePreview;
  buffer: Buffer | null;
  parsed: ParsedNeedsAssessment | null;
  isLegacyTemplate: boolean;
  proposal: ProposalRow | null;
  /** The stage the file was checked against (minimum fields, old template). */
  stage: NeedsStage;
  stateCode: string | null;
  costingStandardVersionId: string | null;
}

const fileIssue = (reason: string, sheet: string = NEEDS_TEMPLATE_SHEETS.FILE): NeedsFileIssue => ({ sheet, row: null, column: null, reason });

const sha256Of = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

function decode(base64: string): Buffer | null {
  const clean = base64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
  return Buffer.from(clean, 'base64');
}

interface CycleContext {
  cycle: CycleRow;
  config: NeedsPipelineConfig;
  facilities: NeedsWorkbookFacility[];
  facilityNameByCode: Map<string, string>;
  standard: LoadedCostingStandard | null;
  costingVersionIdByNumber: Map<number, string>;
}

async function cycleContext(cycle: CycleRow): Promise<CycleContext> {
  const facilities = await workbookFacilities(cycle.tenantId);
  const versions = await prisma.costingStandardVersion.findMany({ where: { tenantId: cycle.tenantId }, select: { id: true, version: true } });
  return {
    cycle,
    config: cycleConfig(cycle),
    facilities,
    facilityNameByCode: new Map(facilities.map((f) => [f.code.toUpperCase(), f.name])),
    standard: await costingStandardById(cycle.costingStandardVersionId),
    costingVersionIdByNumber: new Map(versions.map((v) => [v.version, v.id])),
  };
}

function summaryOf(parsed: ParsedNeedsAssessment, stateCode: string | null, names: Map<string, string>): NeedsUploadSummary {
  const amounts = versionAmounts(parsed);
  return {
    title: parsed.project.title,
    stateCode,
    lgaCodes: distinctLgas(parsed),
    siteCount: parsed.sites.length,
    breakdownRowCount: parsed.breakdownRows.length,
    boqLineCount: parsed.boqLines.length,
    facilitiesSummary: facilitiesSummary(parsed.breakdownRows, names),
    preliminaryCostNgn: amounts.preliminaryCostNgn,
    costedTotalNgn: amounts.costedTotalNgn,
  };
}

async function analyseFiles(user: WebJwtPayload, ctx: CycleContext, files: FileInput[]): Promise<Analysed[]> {
  const { cycle, config } = ctx;
  const buffers = files.map((f) => decode(f.fileBase64));
  const hashes = buffers.map((b) => (b ? sha256Of(b) : ''));
  const known = await prisma.needsAssessmentVersion.findMany({
    where: { sha256: { in: hashes.filter(Boolean) }, proposal: { cycleId: cycle.id } },
    select: { sha256: true, number: true, proposal: { select: { reference: true } } },
    orderBy: { number: 'asc' },
  });

  const targetIds = [...new Set(files.map((f) => f.proposalId).filter((id): id is string => Boolean(id)))];
  const facts = await loadRuleFacts(prisma, user, [cycle], targetIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)));
  const out: Analysed[] = [];
  for (let index = 0; index < files.length; index++) {
    const input = files[index];
    const buffer = buffers[index];
    const sha256 = hashes[index];
    const issues: NeedsFileIssue[] = [];
    const warnings: NeedsFileIssue[] = [];
    let proposal: ProposalRow | null = null;
    let missingTarget = false;
    if (input.proposalId) {
      // Review fix (wave 2): a file aimed at a proposal outside this cycle is refused on its own, not the batch.
      try {
        proposal = await loadCycleProposal(cycle.id, input.proposalId);
      } catch (error) {
        if (!(error instanceof AppError) || error.statusCode !== 404) throw error;
        missingTarget = true;
      }
    }
    if (missingTarget) issues.push(fileIssue('The proposed project this file is a new version of is not in this cycle.'));

    if (!buffer || buffer.length === 0) issues.push(fileIssue('The file is empty or not readable.'));
    else if (buffer.length > NEEDS_FILE_MAX_BYTES) issues.push(fileIssue(`The file is larger than ${Math.round(NEEDS_FILE_MAX_BYTES / (1024 * 1024))} MB.`));

    const earlier = sha256 ? hashes.slice(0, index).indexOf(sha256) : -1;
    if (earlier >= 0) issues.push(fileIssue(`The same file is listed twice in this upload (also file ${earlier + 1}, "${files[earlier].fileName}").`));
    const already = sha256 ? known.find((k) => k.sha256 === sha256) : undefined;
    if (already) issues.push(fileIssue(`This file is already uploaded as ${already.proposal.reference} v${already.number}.`));

    const stage: NeedsStage = proposal ? (proposal.stage as NeedsStage) : firstStage(config);
    let beapRevision = false;
    if (proposal) {
      const permit = uploadPermit(user, cycle, config, proposal, facts, await beapRevisionPermit(prisma, user, cycle, proposal));
      if (!permit.ok) issues.push(fileIssue(permit.reason!));
      beapRevision = permit.ok && permit.source === 'BEAP_REVISION';
    } else if (!input.proposalId && !holds(user, stageConfigOf(config, stage)?.actorPermissionKey ?? 'needs:submit')) {
      // Wave 3: the route also admits needs:cost (costed versions); new proposed projects stay Procurement's.
      issues.push(fileIssue('Only the submitter of needs assessments can add a new proposed project. Choose the proposed project this file is a new version of.'));
    }

    let parsed: ParsedNeedsAssessment | null = null;
    let templateVersion: string | null = null;
    let isLegacyTemplate = false;
    if (buffer && buffer.length > 0 && buffer.length <= NEEDS_FILE_MAX_BYTES) {
      try {
        const result = await parseNeedsWorkbook(buffer, {
          facilities: ctx.facilities,
          interventionYear: cycle.interventionYear,
          cycleStateCode: config.cycleScope === 'STATE' ? cycle.stateCode : null,
          requiredFields: minimumFieldsFor(config, stage).filter((f) => f !== 'DRAWINGS'),
          costingStandard: ctx.standard ? { version: ctx.standard.version, standard: ctx.standard.standard } : null,
        });
        templateVersion = result.templateVersion;
        isLegacyTemplate = result.isLegacyTemplate;
        issues.push(...result.issues);
        warnings.push(...result.warnings);
        parsed = result.parsed;
        // Decision 4: an old file is read at Identification only.
        if (isLegacyTemplate && stage !== 'IDENTIFICATION') {
          issues.push(
            fileIssue(
              `This file uses the old needs assessment template. At ${stageConfigOf(config, stage)?.label ?? NEEDS_STAGE_LABELS[stage]} use template ${NEEDS_TEMPLATE_VERSION}: download it from the cycle.`,
              NEEDS_TEMPLATE_SHEETS.INSTRUCTIONS
            )
          );
        }
      } catch (error) {
        console.error('[needs upload] parser failed', error);
        issues.push(fileIssue('The file could not be read as a needs assessment template.'));
      }
    }
    // Owner decision after wave 4 (2026-11-27): a BEAP revision may not cost more than the State approved
    // for the proposal (the approved amount is what the portfolio decision covered; more needs a new approval).
    if (beapRevision && parsed && proposal?.approvedAmountNgn !== null && proposal?.approvedAmountNgn !== undefined) {
      const revised = versionAmounts(parsed).costedTotalNgn;
      const approved = Number(proposal.approvedAmountNgn);
      if (revised !== null && revised - approved > 0.005) {
        issues.push({
          ...fileIssue(
            `The revised cost (NGN ${revised.toLocaleString('en-NG')}) is above the amount approved for ${proposal.reference} (NGN ${approved.toLocaleString('en-NG')}). Bring the BoQ within the approved amount, or exclude the proposed project from the BEAP.`,
            NEEDS_TEMPLATE_SHEETS.COSTING
          ),
        });
      }
    }
    if (issues.length) parsed = null;

    const stateCode = parsed ? (config.cycleScope === 'STATE' ? cycle.stateCode : (stateOfParsed(parsed) ?? proposal?.stateCode ?? null)) : null;
    let costingStandardVersionId: string | null = null;
    if (parsed?.costingStandardVersion) {
      costingStandardVersionId = ctx.costingVersionIdByNumber.get(parsed.costingStandardVersion) ?? null;
      if (!costingStandardVersionId) {
        warnings.push(fileIssue(`The file names costing standard version ${parsed.costingStandardVersion}, which this workspace does not have.`, NEEDS_TEMPLATE_SHEETS.INSTRUCTIONS));
      }
    }

    // Review fix (wave 2): references the uploader cannot open are not named.
    const expectedFlags = parsed
      ? await expectedFlagsForViewer(
          user,
          await computeFlagFindings(
            prisma,
            {
              tenantId: cycle.tenantId,
              config,
              standard: ctx.standard,
              stateCode,
              proposalId: proposal?.id ?? null,
              isLegacyTemplate,
            },
            parsed
          )
        )
      : [];

    out.push({
      preview: {
        index,
        fileName: input.fileName,
        sha256,
        status: issues.length ? 'INVALID' : 'VALID',
        action: input.proposalId ? 'NEW_VERSION' : 'NEW_PROPOSAL',
        proposalId: proposal?.id ?? input.proposalId ?? null,
        proposalReference: proposal?.reference ?? null,
        templateVersion,
        summary: parsed ? summaryOf(parsed, stateCode, ctx.facilityNameByCode) : null,
        issues,
        warnings,
        expectedFlags,
      },
      buffer,
      parsed,
      isLegacyTemplate,
      proposal,
      stage,
      stateCode,
      costingStandardVersionId,
    });
  }
  return out;
}

export async function previewUpload(user: WebJwtPayload, cycleId: string, input: NeedsUploadPreviewRequest): Promise<NeedsUploadPreviewDto> {
  const cycle = await loadWritableCycle(user, cycleId);
  const analysed = await analyseFiles(user, await cycleContext(cycle), input.files);
  const files = analysed.map((a) => a.preview);
  return { cycleId: cycle.id, files, validCount: files.filter((f) => f.status === 'VALID').length, invalidCount: files.filter((f) => f.status === 'INVALID').length };
}

const refused = (preview: NeedsUploadFilePreview, extra: NeedsFileIssue[] = []): NeedsUploadFileResult => ({
  ...preview,
  status: 'INVALID',
  issues: [...preview.issues, ...extra],
  outcome: 'REFUSED',
  reference: null,
  versionNumber: null,
  flags: [],
});

export async function confirmUpload(user: WebJwtPayload, cycleId: string, input: NeedsUploadConfirmRequest): Promise<NeedsUploadResultDto> {
  const cycle = await loadWritableCycle(user, cycleId);
  // The bytes must be the ones previewed: any mismatch refuses the whole request.
  const changed = input.files
    .map((f, index) => {
      const buffer = decode(f.fileBase64);
      return { index, fileName: f.fileName, ok: Boolean(buffer) && sha256Of(buffer as Buffer) === f.sha256 };
    })
    .filter((f) => !f.ok);
  if (changed.length) {
    throw new AppError('A file changed since the preview. Preview the files again.', 409, 'NEEDS_FILE_CHANGED', {
      files: changed.map((f) => ({ index: f.index, fileName: f.fileName })),
    });
  }

  const ctx = await cycleContext(cycle);
  const analysed = await analyseFiles(user, ctx, input.files);
  const results: NeedsUploadFileResult[] = [];
  const actor = webActor(user);

  // Review fix (wave 2): each file is its own transaction, so an error on one file (the cycle closed
  // meanwhile, a race) is reported on that file instead of failing the request after earlier files
  // were committed. A closed cycle refuses that file and every file after it.
  let stopReason: string | null = null;
  for (const a of analysed) {
    if (stopReason) {
      results.push(refused(a.preview, [fileIssue(stopReason)]));
      continue;
    }
    if (a.preview.status === 'INVALID' || !a.parsed || !a.buffer) {
      results.push(refused(a.preview));
      continue;
    }
    const parsed = a.parsed;
    try {
      // Known gap (wave file section 5): the object is stored before its transaction, so a file refused
      // inside it leaves an unreferenced object (the storage service has no delete yet).
      const stored = await storeTenantAreaBuffer(cycleVersionPrefix(user.tenantId, cycle.id), a.preview.fileName, a.buffer, XLSX_CONTENT_TYPE);
      const result = await prisma.$transaction(
        async (tx) => {
          await lockCycle(tx, cycle.id);
          const fresh = await tx.needsCycle.findUniqueOrThrow({ where: { id: cycle.id }, select: { status: true } });
          if (fresh.status !== 'OPEN') throw new AppError('This cycle is not open', 409, 'NEEDS_CYCLE_NOT_OPEN');
          // Decision 7, re-checked under the cycle lock (another request may have written it).
          const dup = await tx.needsAssessmentVersion.findFirst({
            where: { sha256: stored.sha256, proposal: { cycleId: cycle.id } },
            select: { number: true, proposal: { select: { reference: true } } },
          });
          if (dup) return { refusedReason: `This file is already uploaded as ${dup.proposal.reference} v${dup.number}.` };

          const file = { objectKey: stored.objectKey, fileName: a.preview.fileName, mimeType: XLSX_CONTENT_TYPE, byteSize: stored.byteSize, sha256: stored.sha256 };
          if (a.proposal) {
            const proposal = await tx.needsProposal.findUniqueOrThrow({ where: { id: a.proposal.id } });
            const stage = proposal.stage as NeedsStage;
            // Wave 3: re-checked under the cycle lock (another request may have moved it or used the override).
            const freshCycle = await tx.needsCycle.findUniqueOrThrow({ where: { id: cycle.id } });
            const permit = uploadPermit(user, freshCycle, ctx.config, proposal, await loadRuleFacts(tx, user, [freshCycle], [proposal.id]), await beapRevisionPermit(tx, user, freshCycle, proposal));
            if (!permit.ok) return { refusedReason: permit.reason! };
            // Review fix (wave 2): the file was checked against the stage it had then (minimum fields,
            // old template); if the proposal has moved since, check the file again.
            if (stage !== a.stage) {
              return { refusedReason: `${proposal.reference} moved to ${stageConfigOf(ctx.config, stage)?.label ?? NEEDS_STAGE_LABELS[stage]} since the files were checked. Check the file again.` };
            }
            const source = permit.source;
            // Review fix (wave 2): a national proposal takes the State of its new version.
            const stateCode = ctx.config.cycleScope === 'STATE' ? proposal.stateCode : (a.stateCode ?? proposal.stateCode);
            const written = await writeVersionInTx(tx, {
              tenantId: user.tenantId,
              cycle,
              config: ctx.config,
              proposal: { id: proposal.id, reference: proposal.reference, stateCode },
              source,
              file,
              parsed,
              costingStandardVersionId: a.costingStandardVersionId,
              isLegacyTemplate: a.isLegacyTemplate,
              uploadedBy: { userId: user.userId, name: user.fullName },
              // Wave 4 (B4): a BEAP revision keeps the proposal where it is (no change rule).
              statusUpdate: source === 'BEAP_REVISION' ? { stage, status: proposal.status as NeedsProposalStatus } : null,
            });
            if (source === 'BEAP_REVISION') await applyBeapRevisionInTx(tx, cycle.id, proposal.id, versionAmounts(parsed).costedTotalNgn);
            if (permit.overrideFlag) await recordOverrideUseInTx(tx, user, cycle, proposal, permit.overrideFlag, 'Uploaded the costed version');
            const sourceWords = source === 'CORRECTION' ? ' (correction)' : source === 'COSTING' ? ' (costed version)' : source === 'BEAP_REVISION' ? ' (BEAP revision)' : '';
            await recordAuditEvent(tx, {
              tenantId: user.tenantId,
              projectId: null,
              ...actor,
              action: 'NEEDS_VERSION_ADDED',
              summaryText: `Uploaded version ${written.versionNumber} of ${proposal.reference} from "${file.fileName}"${sourceWords}.${written.reopened ? ` ${written.reopened.sentence}` : ''}`,
              payload: {
                cycleId: cycle.id,
                proposalId: proposal.id,
                reference: proposal.reference,
                versionNumber: written.versionNumber,
                sha256: file.sha256,
                source,
                fileName: file.fileName,
                ...(written.reopened ? { reopenedStage: written.reopened.stage, change: written.reopened.change } : {}),
              },
            });
            return { outcome: 'VERSION_ADDED' as const, reference: proposal.reference, versionNumber: written.versionNumber, flags: written.flags };
          }

          const { sequence, reference } = await nextProposalReference(tx, cycle, ctx.config);
          const stage = firstStage(ctx.config);
          const created = await tx.needsProposal.create({
            data: {
              tenantId: user.tenantId,
              cycleId: cycle.id,
              reference,
              sequence,
              title: parsed.project.title ?? a.preview.fileName.replace(/\.xlsx$/i, ''),
              route: 'ANNUAL',
              stage,
              status: 'DRAFT',
              stateCode: a.stateCode,
              lgaCodes: distinctLgas(parsed),
              createdByUserId: user.userId,
              createdByName: user.fullName,
            },
          });
          const written = await writeVersionInTx(tx, {
            tenantId: user.tenantId,
            cycle,
            config: ctx.config,
            proposal: { id: created.id, reference, stateCode: a.stateCode },
            source: 'UPLOAD',
            file,
            parsed,
            costingStandardVersionId: a.costingStandardVersionId,
            isLegacyTemplate: a.isLegacyTemplate,
            uploadedBy: { userId: user.userId, name: user.fullName },
          });
          await recordAuditEvent(tx, {
            tenantId: user.tenantId,
            projectId: null,
            ...actor,
            action: 'NEEDS_PROPOSAL_CREATED',
            summaryText: `Uploaded "${file.fileName}" as proposed project ${reference}: ${created.title}.`,
            payload: { cycleId: cycle.id, proposalId: created.id, reference, versionNumber: written.versionNumber, sha256: file.sha256, source: 'UPLOAD', fileName: file.fileName },
          });
          return { outcome: 'CREATED' as const, reference, proposalId: created.id, versionNumber: written.versionNumber, flags: written.flags };
        },
        { timeout: 30_000 }
      );
      if ('refusedReason' in result) {
        results.push(refused(a.preview, [fileIssue(result.refusedReason as string)]));
        continue;
      }
      results.push({
        ...a.preview,
        proposalId: 'proposalId' in result && result.proposalId ? result.proposalId : a.preview.proposalId,
        proposalReference: result.reference,
        outcome: result.outcome,
        reference: result.reference,
        versionNumber: result.versionNumber,
        flags: await redactFlagsForViewer(user, result.flags),
        expectedFlags: a.preview.expectedFlags,
      });
    } catch (error) {
      if (error instanceof AppError) {
        results.push(refused(a.preview, [fileIssue(error.message)]));
        if (error.code === 'NEEDS_CYCLE_NOT_OPEN') stopReason = 'The cycle was closed while the files were being saved.';
      } else {
        console.error('[needs upload] saving a file failed', error);
        results.push(refused(a.preview, [fileIssue('The file could not be saved. Try again.')]));
      }
    }
  }

  const createdCount = results.filter((r) => r.outcome === 'CREATED').length;
  const versionCount = results.filter((r) => r.outcome === 'VERSION_ADDED').length;
  const refusedCount = results.filter((r) => r.outcome === 'REFUSED').length;
  if (createdCount + versionCount === 0) {
    throw new AppError('No file could be saved. Correct the files and upload them again.', 422, 'NEEDS_FILE_INVALID', { files: results });
  }
  return { cycleId: cycle.id, files: results, createdCount, versionCount, refusedCount };
}
