import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import {
  NEEDS_DOCUMENT_UPLOAD_POLICY,
  NEEDS_FILE_MAX_BYTES,
  NEEDS_TEMPLATE_SHEETS,
  NEEDS_TEMPLATE_VERSION,
  OUT_OF_CYCLE_REASON_LABELS,
  OutOfCycleReasonEnum,
  PROPOSAL_DOCUMENT_KIND_LABELS,
  XLSX_CONTENT_TYPE,
  formatProjectCode,
  stageConfigOf,
  stateByCode,
  type NeedsApprovalActionRequest,
  type NeedsDocumentPresignRequest,
  type NeedsFileIssue,
  type NeedsOutOfCycleDto,
  type NeedsPresignedUploadDto,
  type NeedsProposalDocumentDto,
  type NeedsProposalStatus,
  type NeedsUploadFilePreview,
  type OutOfCycleListQuery,
  type OutOfCycleRequest,
  type ParsedNeedsAssessment,
  type RegisterProposalDocumentRequest,
  type UpdateOutOfCycleRequest,
} from '@insite/shared';
import { prisma } from '../../../config/prisma';
import { AppError } from '../../../middleware/error.middleware';
import type { WebJwtPayload } from '../../../middleware/auth.middleware';
import { inspectTenantAreaUpload, presignTenantAreaUpload, storeTenantAreaBuffer } from '../../../utils/tenantUploads';
import { recordAuditEvent } from '../../audit/audit.service';
import { convertProposalToProject } from '../conversion/convertProposal';
import { needsToScopeImport } from '../conversion/needsToScopeImport';
import { loadVisibleProposal, visibleCycleWhere, webActor, PROPOSAL_NOT_FOUND, type CycleRow, type ProposalRow } from '../needsAccess';
import { cycleDocumentPrefix, cycleVersionPrefix, ensureCycleForOutOfCycle } from '../needsCycles.service';
import { costingStandardById, cycleConfig, dec, stateOfParsed, typeConfig, workbookFacilities } from '../needsSupport';
import { currentFirst, serializeProposalDocument, serializeVersion } from '../needsSerializers';
import { assertDocumentRegistrable, lockCycle, nextProposalReference, writeVersionInTx } from '../needsVersions';
import { parseNeedsWorkbook } from '../workbook/needsWorkbook';
import { holds } from '../decisions/proposalRules';
import {
  SUBMISSION_INCLUDE,
  actOnSubmissionInTx,
  createSubmissionInTx,
  replaceItemsInTx,
  serializeSubmission,
  submitInTx,
  type SubmissionRow,
} from './submissions.service';

/**
 * Needs pipeline wave 4, Track A (A3, D-N.14): out-of-cycle requests. A request is a proposal with
 * route OUT_OF_CYCLE at stage APPROVAL (DRAFT until submitted, then IN_PROGRESS; RETURNED after a
 * return), filed in the programme's cycle for that year and scope, or in a CLOSED container cycle
 * created for it (`ensureCycleForOutOfCycle`), with one OUT_OF_CYCLE submission (one item, the
 * requested amount, which is also the proposal's `preliminaryAmountNgn`).
 *
 * - Writes (create, edit, documents, needs assessment, submit, withdraw): a `needs:submit` holder of
 *   the cycle's owning organisation (403 NEEDS_CYCLE_FORBIDDEN), whatever the cycle's status; edits
 *   only while DRAFT or RETURNED (409 NEEDS_OUT_OF_CYCLE_NOT_EDITABLE).
 * - Submitting needs the authorising document (422 NEEDS_AUTHORISING_DOCUMENT_REQUIRED).
 * - The needs assessment is optional: template v2 only, previewed then confirmed with the same
 *   sha256 (409 NEEDS_FILE_CHANGED; issues 422 NEEDS_FILE_INVALID); it must map to a project
 *   (`needsToScopeImport`), so the approval cannot fail at conversion. A version never moves the
 *   request (stage and status kept) and keeps the request's title and amount.
 * - The chain is the cycle's OUT_OF_CYCLE chain (DI: the Executive Secretary; MG: the Executive
 *   Chairman, then UBEC outside the SUBEB, enforced by the submission base). On approval:
 *   `approvedAmountNgn` = requested, then `convertProposalToProject` (origin OUT_OF_CYCLE, budget =
 *   requested; a bare draft without a needs assessment). A return sets the request RETURNED.
 */

type Tx = Prisma.TransactionClient;

const ngn = (n: number) => `₦${n.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
const EDITABLE: readonly string[] = ['DRAFT', 'RETURNED'];
const NOT_EDITABLE = (reference: string, status: string) =>
  new AppError(`${reference} is ${statusLabel(status as NeedsProposalStatus).toLowerCase()} and can no longer be changed`, 409, 'NEEDS_OUT_OF_CYCLE_NOT_EDITABLE');

function statusLabel(status: NeedsProposalStatus): string {
  switch (status) {
    case 'DRAFT':
      return 'Draft';
    case 'IN_PROGRESS':
      return 'Pending approval';
    case 'RETURNED':
      return 'Returned for correction';
    case 'CONVERTED':
      return 'Approved, converted to project';
    case 'WITHDRAWN':
      return 'Withdrawn';
    default:
      return status;
  }
}

/** An out-of-cycle request the user can see, else 404. */
async function loadOutOfCycle(user: WebJwtPayload, proposalId: string, db: Tx | typeof prisma = prisma): Promise<ProposalRow & { cycle: CycleRow }> {
  const p = await loadVisibleProposal(user, proposalId, db);
  if (p.route !== 'OUT_OF_CYCLE') throw PROPOSAL_NOT_FOUND();
  return p;
}

const isRequesterOrg = (user: WebJwtPayload, cycle: Pick<CycleRow, 'owningOrganizationId'>) => user.isPlatformSuperAdmin || user.organizationId === cycle.owningOrganizationId;

function assertRequester(user: WebJwtPayload, cycle: Pick<CycleRow, 'owningOrganizationId'>): void {
  if (!isRequesterOrg(user, cycle)) throw new AppError('Only the organisation that owns this programme cycle can change the request', 403, 'NEEDS_CYCLE_FORBIDDEN');
}

/** Under the cycle lock: the request as it is now, editable by `user`. */
async function lockedEditable(tx: Tx, user: WebJwtPayload, proposalId: string): Promise<ProposalRow & { cycle: CycleRow }> {
  const p = await loadOutOfCycle(user, proposalId, tx);
  assertRequester(user, p.cycle);
  await lockCycle(tx, p.cycleId);
  const fresh = await tx.needsProposal.findUniqueOrThrow({ where: { id: p.id }, include: { cycle: true } });
  if (!EDITABLE.includes(fresh.status)) throw NOT_EDITABLE(fresh.reference, fresh.status);
  return fresh;
}

/** The request's submission (one per request). */
async function submissionOf(db: Tx | typeof prisma, proposalId: string): Promise<SubmissionRow & { cycle: CycleRow }> {
  const row = await db.needsSubmission.findFirst({
    where: { kind: 'OUT_OF_CYCLE', items: { some: { proposalId } } },
    include: { ...SUBMISSION_INCLUDE, cycle: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) throw new AppError('Submission not found', 404, 'NEEDS_SUBMISSION_NOT_FOUND');
  return row;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const DTO_INCLUDE = {
  cycle: { include: { projectType: { select: { name: true } } } },
  documents: true,
  currentVersion: { include: { costingStandardVersion: { select: { version: true } } } },
  project: { select: { id: true, codePrefix: true } },
} satisfies Prisma.NeedsProposalInclude;

async function outOfCycleDto(user: WebJwtPayload, proposalId: string): Promise<NeedsOutOfCycleDto> {
  const p = await prisma.needsProposal.findUniqueOrThrow({ where: { id: proposalId }, include: DTO_INCLUDE });
  const submission = await submissionOf(prisma, p.id);
  const status = p.status as NeedsProposalStatus;
  const docs = currentFirst(p.documents).map(serializeProposalDocument);
  const authorising = p.authorisingDocumentId ? (p.documents.find((d) => d.id === p.authorisingDocumentId) ?? null) : null;
  const reason = OutOfCycleReasonEnum.parse(p.outOfCycleReason);
  return {
    proposalId: p.id,
    reference: p.reference,
    title: p.title,
    cycleId: p.cycleId,
    cycleStatus: p.cycle.status as NeedsOutOfCycleDto['cycleStatus'],
    interventionYear: p.cycle.interventionYear,
    projectTypeId: p.cycle.projectTypeId,
    projectTypeName: p.cycle.projectType.name,
    stateCode: p.stateCode,
    reason,
    reasonLabel: OUT_OF_CYCLE_REASON_LABELS[reason],
    reasonDetails: p.outOfCycleDetails ?? '',
    requestedAmountNgn: dec(p.preliminaryAmountNgn) ?? 0,
    authorisingDocument: authorising ? serializeProposalDocument(authorising) : null,
    documents: docs,
    currentVersion: p.currentVersion ? serializeVersion(p.currentVersion, p.currentVersionId) : null,
    status,
    statusLabel: statusLabel(status),
    submission: await serializeSubmission(prisma, user, submission),
    projectId: p.project?.id ?? null,
    projectCode: p.project ? formatProjectCode(p.project.codePrefix) : null,
    canEdit: EDITABLE.includes(status) && holds(user, 'needs:submit') && isRequesterOrg(user, p.cycle),
    createdByName: p.createdByName,
    createdAt: p.createdAt.toISOString(),
  };
}

export async function getOutOfCycle(user: WebJwtPayload, proposalId: string): Promise<NeedsOutOfCycleDto> {
  const p = await loadOutOfCycle(user, proposalId);
  return outOfCycleDto(user, p.id);
}

export async function listOutOfCycle(user: WebJwtPayload, query: OutOfCycleListQuery): Promise<NeedsOutOfCycleDto[]> {
  const rows = await prisma.needsProposal.findMany({
    where: { tenantId: user.tenantId, route: 'OUT_OF_CYCLE', cycle: visibleCycleWhere(user), ...(query.cycleId ? { cycleId: query.cycleId } : {}) },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  });
  const out: NeedsOutOfCycleDto[] = [];
  for (const r of rows) out.push(await outOfCycleDto(user, r.id));
  return out;
}

// ---------------------------------------------------------------------------
// Create, edit, withdraw
// ---------------------------------------------------------------------------

export async function createOutOfCycle(user: WebJwtPayload, input: OutOfCycleRequest): Promise<NeedsOutOfCycleDto> {
  const proposalId = await prisma.$transaction(
    async (tx) => {
      // A national programme's cycle is not for one State; the request still records its State.
      const type = await tx.projectType.findFirst({ where: { id: input.projectTypeId, tenantId: user.tenantId } });
      const scope = type ? typeConfig(type).needsPipeline.cycleScope : null;
      const cycle = await ensureCycleForOutOfCycle(tx, user, {
        projectTypeId: input.projectTypeId,
        interventionYear: input.interventionYear,
        stateCode: scope === 'NATIONAL' ? null : input.stateCode,
      });
      const config = cycleConfig(cycle);
      if (!stageConfigOf(config, 'APPROVAL')) throw new AppError('The programme has no approval stage', 422, 'NEEDS_PIPELINE_DISABLED');
      await lockCycle(tx, cycle.id);
      const { sequence, reference } = await nextProposalReference(tx, cycle, config);
      const stateCode = config.cycleScope === 'STATE' ? cycle.stateCode : input.stateCode;
      const proposal = await tx.needsProposal.create({
        data: {
          tenantId: user.tenantId,
          cycleId: cycle.id,
          reference,
          sequence,
          title: input.title,
          route: 'OUT_OF_CYCLE',
          outOfCycleReason: input.reason,
          outOfCycleDetails: input.reasonDetails,
          stage: 'APPROVAL',
          status: 'DRAFT',
          stateCode,
          preliminaryAmountNgn: input.requestedAmountNgn,
          createdByUserId: user.userId,
          createdByName: user.fullName,
        },
      });
      const where = `${cycle.interventionYear}${stateCode ? `, ${stateByCode(stateCode)?.name ?? stateCode}` : ''}`;
      await recordAuditEvent(tx, {
        tenantId: user.tenantId,
        projectId: null,
        ...webActor(user),
        action: 'NEEDS_PROPOSAL_CREATED',
        summaryText: `Opened out-of-cycle request ${reference} (${OUT_OF_CYCLE_REASON_LABELS[input.reason]}, ${where}): ${input.title}, ${ngn(input.requestedAmountNgn)} requested.`,
        payload: {
          cycleId: cycle.id,
          proposalId: proposal.id,
          reference,
          route: 'OUT_OF_CYCLE',
          reason: input.reason,
          requestedAmountNgn: input.requestedAmountNgn,
          cycleStatus: cycle.status,
        },
      });
      await createSubmissionInTx(tx, {
        user,
        cycle,
        kind: 'OUT_OF_CYCLE',
        items: [{ proposalId: proposal.id, included: true, amountNgn: input.requestedAmountNgn }],
        submit: false,
        summary: `Prepared the out-of-cycle approval request for ${reference}.`,
      });
      return proposal.id;
    },
    { timeout: 30_000 }
  );
  return outOfCycleDto(user, proposalId);
}

export async function updateOutOfCycle(user: WebJwtPayload, proposalId: string, input: UpdateOutOfCycleRequest): Promise<NeedsOutOfCycleDto> {
  await prisma.$transaction(async (tx) => {
    const p = await lockedEditable(tx, user, proposalId);
    const data: Prisma.NeedsProposalUpdateInput = {};
    const changes: string[] = [];
    if (input.title !== undefined && input.title !== p.title) {
      data.title = input.title;
      changes.push(`title "${input.title}"`);
    }
    if (input.reason !== undefined && input.reason !== p.outOfCycleReason) {
      data.outOfCycleReason = input.reason;
      changes.push(`reason ${OUT_OF_CYCLE_REASON_LABELS[input.reason]}`);
    }
    if (input.reasonDetails !== undefined && input.reasonDetails !== p.outOfCycleDetails) {
      data.outOfCycleDetails = input.reasonDetails;
      changes.push('the explanation');
    }
    if (input.requestedAmountNgn !== undefined && input.requestedAmountNgn !== dec(p.preliminaryAmountNgn)) {
      data.preliminaryAmountNgn = input.requestedAmountNgn;
      changes.push(`amount ${ngn(input.requestedAmountNgn)}`);
    }
    if (!changes.length) return;
    await tx.needsProposal.update({ where: { id: p.id }, data });
    if (input.requestedAmountNgn !== undefined) {
      const submission = await submissionOf(tx, p.id);
      await tx.needsSubmissionItem.update({ where: { submissionId_proposalId: { submissionId: submission.id, proposalId: p.id } }, data: { amountNgn: input.requestedAmountNgn } });
    }
    await recordAuditEvent(tx, {
      tenantId: user.tenantId,
      projectId: null,
      ...webActor(user),
      action: 'NEEDS_SUBMISSION_UPDATED',
      summaryText: `Changed out-of-cycle request ${p.reference}: ${changes.join(', ')}.`,
      payload: { cycleId: p.cycleId, proposalId: p.id, proposalIds: [p.id], reference: p.reference, changes: input },
    });
  });
  return outOfCycleDto(user, proposalId);
}

export async function withdrawOutOfCycle(user: WebJwtPayload, proposalId: string, reason: string): Promise<NeedsOutOfCycleDto> {
  await prisma.$transaction(async (tx) => {
    const p = await lockedEditable(tx, user, proposalId);
    await tx.needsProposal.update({ where: { id: p.id }, data: { status: 'WITHDRAWN', statusReason: reason } });
    await recordAuditEvent(tx, {
      tenantId: user.tenantId,
      projectId: null,
      ...webActor(user),
      action: 'NEEDS_PROPOSAL_WITHDRAWN',
      summaryText: `Withdrew out-of-cycle request ${p.reference}: ${reason}`,
      payload: { cycleId: p.cycleId, proposalId: p.id, reference: p.reference, stage: p.stage, reason, route: 'OUT_OF_CYCLE' },
    });
  });
  return outOfCycleDto(user, proposalId);
}

// ---------------------------------------------------------------------------
// Documents (keys under the cycle, like any proposal document; the cycle may be CLOSED)
// ---------------------------------------------------------------------------

export async function presignOutOfCycleDocument(user: WebJwtPayload, proposalId: string, input: NeedsDocumentPresignRequest): Promise<NeedsPresignedUploadDto> {
  const p = await loadOutOfCycle(user, proposalId);
  assertRequester(user, p.cycle);
  if (!EDITABLE.includes(p.status)) throw NOT_EDITABLE(p.reference, p.status);
  return presignTenantAreaUpload({
    prefix: cycleDocumentPrefix(user.tenantId, p.cycleId),
    fileName: input.fileName,
    mimeType: input.mimeType,
    byteSize: input.byteSize,
    policy: NEEDS_DOCUMENT_UPLOAD_POLICY,
  });
}

export async function registerOutOfCycleDocument(user: WebJwtPayload, proposalId: string, input: RegisterProposalDocumentRequest): Promise<NeedsProposalDocumentDto> {
  const p = await loadOutOfCycle(user, proposalId);
  assertRequester(user, p.cycle);
  if (input.supersedesId) {
    const previous = await prisma.needsProposalDocument.findFirst({ where: { id: input.supersedesId, proposalId: p.id } });
    if (!previous) throw new AppError('The document it replaces is not on this request', 404, 'NEEDS_DOCUMENT_NOT_FOUND');
    if (previous.kind !== input.kind) throw new AppError('A new version must be the same kind of document', 422, 'NEEDS_DOCUMENT_KIND_MISMATCH');
  }
  const file = await inspectTenantAreaUpload(input.objectKey, cycleDocumentPrefix(user.tenantId, p.cycleId), NEEDS_DOCUMENT_UPLOAD_POLICY);
  const doc = await prisma.$transaction(async (tx) => {
    const fresh = await lockedEditable(tx, user, p.id);
    await assertDocumentRegistrable(tx, { cycleId: fresh.cycleId, objectKey: file.objectKey, supersedes: input.supersedesId ? { table: 'proposal', id: input.supersedesId } : null });
    const created = await tx.needsProposalDocument.create({
      data: {
        proposalId: fresh.id,
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
    if (input.kind === 'AUTHORISING_DOCUMENT') await tx.needsProposal.update({ where: { id: fresh.id }, data: { authorisingDocumentId: created.id } });
    await recordAuditEvent(tx, {
      tenantId: user.tenantId,
      projectId: null,
      ...webActor(user),
      action: 'NEEDS_DOCUMENT_ADDED',
      summaryText: `${input.supersedesId ? 'Replaced' : 'Added'} "${input.title}" (${PROPOSAL_DOCUMENT_KIND_LABELS[input.kind]}) on out-of-cycle request ${fresh.reference}.`,
      payload: { cycleId: fresh.cycleId, proposalId: fresh.id, reference: fresh.reference, documentId: created.id, kind: input.kind, title: input.title, supersedesId: input.supersedesId, sha256: file.sha256, fileName: file.fileName },
    });
    return created;
  });
  return serializeProposalDocument(doc);
}

// ---------------------------------------------------------------------------
// Needs assessment (optional, template v2)
// ---------------------------------------------------------------------------

const fileIssue = (reason: string, sheet: string = NEEDS_TEMPLATE_SHEETS.FILE): NeedsFileIssue => ({ sheet, row: null, column: null, reason });
const sha256Of = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

function decode(base64: string): Buffer | null {
  const clean = base64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
  return Buffer.from(clean, 'base64');
}

interface AnalysedFile {
  preview: NeedsUploadFilePreview;
  buffer: Buffer | null;
  parsed: ParsedNeedsAssessment | null;
  stateCode: string | null;
  costingStandardVersionId: string | null;
}

async function analyseFile(p: ProposalRow & { cycle: CycleRow }, input: { fileName: string; fileBase64: string }): Promise<AnalysedFile> {
  const config = cycleConfig(p.cycle);
  const buffer = decode(input.fileBase64);
  const sha256 = buffer ? sha256Of(buffer) : '';
  const issues: NeedsFileIssue[] = [];
  const warnings: NeedsFileIssue[] = [];
  if (!buffer || buffer.length === 0) issues.push(fileIssue('The file is empty or not readable.'));
  else if (buffer.length > NEEDS_FILE_MAX_BYTES) issues.push(fileIssue(`The file is larger than ${Math.round(NEEDS_FILE_MAX_BYTES / (1024 * 1024))} MB.`));
  if (sha256) {
    const known = await prisma.needsAssessmentVersion.findFirst({ where: { sha256, proposal: { cycleId: p.cycleId } }, select: { number: true, proposal: { select: { reference: true } } } });
    if (known) issues.push(fileIssue(`This file is already uploaded as ${known.proposal.reference} v${known.number}.`));
  }
  const [facilities, standard, versions] = await Promise.all([
    workbookFacilities(p.tenantId),
    costingStandardById(p.cycle.costingStandardVersionId),
    prisma.costingStandardVersion.findMany({ where: { tenantId: p.tenantId }, select: { id: true, version: true } }),
  ]);
  let parsed: ParsedNeedsAssessment | null = null;
  let templateVersion: string | null = null;
  if (buffer && buffer.length > 0 && buffer.length <= NEEDS_FILE_MAX_BYTES) {
    try {
      const result = await parseNeedsWorkbook(buffer, {
        facilities,
        interventionYear: p.cycle.interventionYear,
        cycleStateCode: config.cycleScope === 'STATE' ? p.cycle.stateCode : null,
        requiredFields: [],
        costingStandard: standard ? { version: standard.version, standard: standard.standard } : null,
      });
      templateVersion = result.templateVersion;
      issues.push(...result.issues);
      warnings.push(...result.warnings);
      parsed = result.parsed;
      if (result.isLegacyTemplate) issues.push(fileIssue(`An out-of-cycle request takes the needs assessment template ${NEEDS_TEMPLATE_VERSION}.`, NEEDS_TEMPLATE_SHEETS.INSTRUCTIONS));
    } catch (error) {
      console.error('[needs out-of-cycle] parser failed', error);
      issues.push(fileIssue('The file could not be read as a needs assessment template.'));
    }
  }
  // The approval converts the request at once: the file must map to a project.
  if (parsed && !issues.length) {
    const names = new Map(facilities.map((f) => [f.code.toUpperCase(), f.name]));
    for (const i of needsToScopeImport(parsed, names).issues) issues.push(fileIssue(i.message));
  }
  if (issues.length) parsed = null;
  const stateCode = parsed ? (config.cycleScope === 'STATE' ? p.cycle.stateCode : (stateOfParsed(parsed) ?? p.stateCode)) : null;
  let costingStandardVersionId: string | null = null;
  if (parsed?.costingStandardVersion) costingStandardVersionId = versions.find((v) => v.version === parsed!.costingStandardVersion)?.id ?? null;
  return {
    preview: {
      index: 0,
      fileName: input.fileName,
      sha256,
      status: issues.length ? 'INVALID' : 'VALID',
      action: 'NEW_VERSION',
      proposalId: p.id,
      proposalReference: p.reference,
      templateVersion,
      summary: parsed
        ? {
            title: parsed.project.title,
            stateCode,
            lgaCodes: [...new Set(parsed.sites.map((s) => s.lgaCode))],
            siteCount: parsed.sites.length,
            breakdownRowCount: parsed.breakdownRows.length,
            boqLineCount: parsed.boqLines.length,
            facilitiesSummary: '',
            preliminaryCostNgn: null,
            costedTotalNgn: null,
          }
        : null,
      issues,
      warnings,
      expectedFlags: [],
    },
    buffer,
    parsed,
    stateCode,
    costingStandardVersionId,
  };
}

export async function previewOutOfCycleNeedsAssessment(user: WebJwtPayload, proposalId: string, input: { fileName: string; fileBase64: string }): Promise<NeedsUploadFilePreview> {
  const p = await loadOutOfCycle(user, proposalId);
  assertRequester(user, p.cycle);
  if (!EDITABLE.includes(p.status)) throw NOT_EDITABLE(p.reference, p.status);
  return (await analyseFile(p, input)).preview;
}

export async function confirmOutOfCycleNeedsAssessment(user: WebJwtPayload, proposalId: string, input: { fileName: string; fileBase64: string; sha256: string }): Promise<NeedsOutOfCycleDto> {
  const p = await loadOutOfCycle(user, proposalId);
  assertRequester(user, p.cycle);
  if (!EDITABLE.includes(p.status)) throw NOT_EDITABLE(p.reference, p.status);
  const buffer = decode(input.fileBase64);
  if (!buffer || sha256Of(buffer) !== input.sha256) throw new AppError('The file changed since the preview. Preview it again.', 409, 'NEEDS_FILE_CHANGED');
  const analysed = await analyseFile(p, input);
  if (!analysed.parsed || !analysed.buffer) {
    throw new AppError('The needs assessment cannot be used. Correct the file and upload it again.', 422, 'NEEDS_FILE_INVALID', { files: [analysed.preview] });
  }
  const parsed = analysed.parsed;
  const stored = await storeTenantAreaBuffer(cycleVersionPrefix(user.tenantId, p.cycleId), input.fileName, analysed.buffer, XLSX_CONTENT_TYPE);
  await prisma.$transaction(
    async (tx) => {
      const fresh = await lockedEditable(tx, user, p.id);
      const dup = await tx.needsAssessmentVersion.findFirst({ where: { sha256: stored.sha256, proposal: { cycleId: fresh.cycleId } }, select: { number: true, proposal: { select: { reference: true } } } });
      if (dup) throw new AppError(`This file is already uploaded as ${dup.proposal.reference} v${dup.number}.`, 422, 'NEEDS_FILE_INVALID');
      const source = fresh.status === 'RETURNED' ? 'CORRECTION' : 'UPLOAD';
      const written = await writeVersionInTx(tx, {
        tenantId: user.tenantId,
        cycle: fresh.cycle,
        config: cycleConfig(fresh.cycle),
        proposal: { id: fresh.id, reference: fresh.reference, stateCode: analysed.stateCode },
        source,
        file: { objectKey: stored.objectKey, fileName: input.fileName, mimeType: XLSX_CONTENT_TYPE, byteSize: stored.byteSize, sha256: stored.sha256 },
        parsed,
        costingStandardVersionId: analysed.costingStandardVersionId,
        isLegacyTemplate: false,
        uploadedBy: { userId: user.userId, name: user.fullName },
        // An out-of-cycle request does not move with its file.
        statusUpdate: { stage: fresh.stage as 'APPROVAL', status: fresh.status as NeedsProposalStatus },
      });
      // The request's own title and amount stand (the file's preliminary cost is on the version).
      await tx.needsProposal.update({ where: { id: fresh.id }, data: { title: fresh.title, preliminaryAmountNgn: fresh.preliminaryAmountNgn } });
      await recordAuditEvent(tx, {
        tenantId: user.tenantId,
        projectId: null,
        ...webActor(user),
        action: 'NEEDS_VERSION_ADDED',
        summaryText: `Uploaded version ${written.versionNumber} of out-of-cycle request ${fresh.reference} from "${input.fileName}".`,
        payload: { cycleId: fresh.cycleId, proposalId: fresh.id, reference: fresh.reference, versionNumber: written.versionNumber, sha256: stored.sha256, source, fileName: input.fileName },
      });
    },
    { timeout: 30_000 }
  );
  return outOfCycleDto(user, p.id);
}

// ---------------------------------------------------------------------------
// Submit and decide
// ---------------------------------------------------------------------------

/** The approval's effect: the approved amount is the requested one; the request becomes a draft project. */
async function applyOutOfCycleApproval(tx: Tx, user: WebJwtPayload, proposalId: string): Promise<void> {
  const p = await tx.needsProposal.findUniqueOrThrow({ where: { id: proposalId } });
  const requested = dec(p.preliminaryAmountNgn) ?? 0;
  await tx.needsProposal.update({ where: { id: p.id }, data: { approvedAmountNgn: requested } });
  await convertProposalToProject(tx, { id: p.id }, { fundedAmountNgn: requested, by: user, origin: 'OUT_OF_CYCLE' });
}

export async function submitOutOfCycle(user: WebJwtPayload, proposalId: string): Promise<NeedsOutOfCycleDto> {
  await prisma.$transaction(
    async (tx) => {
      const p = await lockedEditable(tx, user, proposalId);
      if (!p.authorisingDocumentId) throw new AppError('Attach the authorising document first', 422, 'NEEDS_AUTHORISING_DOCUMENT_REQUIRED');
      const submission = await submissionOf(tx, p.id);
      const requested = dec(p.preliminaryAmountNgn);
      await replaceItemsInTx(tx, submission.id, [{ proposalId: p.id, included: true, amountNgn: requested }]);
      const resubmitted = p.status === 'RETURNED';
      const { completedWithoutSteps } = await submitInTx(tx, user, submission.id, null);
      await tx.needsProposal.update({ where: { id: p.id }, data: { status: 'IN_PROGRESS', statusReason: null } });
      await recordAuditEvent(tx, {
        tenantId: user.tenantId,
        projectId: null,
        ...webActor(user),
        action: 'NEEDS_PROPOSAL_SUBMITTED',
        summaryText: `${resubmitted ? 'Resubmitted' : 'Submitted'} out-of-cycle request ${p.reference} for approval (${ngn(requested ?? 0)}).`,
        payload: { cycleId: p.cycleId, proposalId: p.id, proposalIds: [p.id], reference: p.reference, submissionId: submission.id, resubmitted, route: 'OUT_OF_CYCLE', versionId: p.currentVersionId },
      });
      if (completedWithoutSteps) await applyOutOfCycleApproval(tx, user, p.id);
    },
    { timeout: 30_000 }
  );
  return outOfCycleDto(user, proposalId);
}

export async function actOnOutOfCycle(user: WebJwtPayload, proposalId: string, request: NeedsApprovalActionRequest): Promise<NeedsOutOfCycleDto> {
  const p = await loadOutOfCycle(user, proposalId);
  if (request.exclusions.length) throw new AppError('An out-of-cycle request has nothing to exclude', 422, 'NEEDS_EXCLUSION_INVALID');
  await prisma.$transaction(
    async (tx) => {
      await lockCycle(tx, p.cycleId);
      const submission = await submissionOf(tx, p.id);
      await actOnSubmissionInTx(tx, user, submission.id, request, {
        summary: (ctx, outcome) =>
          `${ctx.step.label}: ${outcome === 'RETURNED' ? 'returned' : outcome === 'APPROVED' ? 'approved (chain complete)' : 'approved'} out-of-cycle request ${p.reference}${request.notes ? `: ${request.notes}` : '.'}`,
        onReturned: async (t) => {
          await t.needsProposal.update({ where: { id: p.id }, data: { status: 'RETURNED', statusReason: request.notes } });
          await recordAuditEvent(t, {
            tenantId: user.tenantId,
            projectId: null,
            ...webActor(user),
            action: 'NEEDS_PROPOSAL_RETURNED',
            summaryText: `Returned out-of-cycle request ${p.reference}: ${request.notes ?? ''}`,
            payload: { cycleId: p.cycleId, proposalId: p.id, reference: p.reference, stage: 'APPROVAL', reason: request.notes, submissionId: submission.id },
          });
        },
        onApproved: (t) => applyOutOfCycleApproval(t, user, p.id),
      });
    },
    { timeout: 30_000 }
  );
  return outOfCycleDto(user, p.id);
}
