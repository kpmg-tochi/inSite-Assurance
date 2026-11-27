import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import {
  APPROVED_LIST_MAX_BYTES,
  NEEDS_SEPARATION_ERROR_MESSAGES,
  XLSX_CONTENT_TYPE,
  formatProjectCode,
  lgaByCode,
  proposalStatusLabel,
  separationViolation,
  stateByCode,
  type AppropriationImportConfirmRequest,
  type AppropriationImportPreviewRequest,
  type AppropriationIssue,
  type AppropriationPreviewDto,
  type AppropriationPreviewRow,
  type AppropriationResultDto,
  type CycleDocumentKind,
  type NeedsCycleDocumentDto,
  type NeedsDocumentPresignRequest,
  type NeedsFundingDto,
  type NeedsFundingRecordDto,
  type NeedsPresignedUploadDto,
  type NeedsProposalStatus,
  type NeedsStage,
  type RecordBudgetSubmissionRequest,
  type RegisterCycleDocumentRequest,
} from '@insite/shared';
import { prisma } from '../../../config/prisma';
import { AppError } from '../../../middleware/error.middleware';
import type { WebJwtPayload } from '../../../middleware/auth.middleware';
import { storeTenantAreaBuffer } from '../../../utils/tenantUploads';
import { recordAuditEvent } from '../../audit/audit.service';
import { tenantTolerancePct } from '../../approvedLists/approvedLists.service';
import { workspaceShortName } from '../../scope/scopeImport.service';
import { convertProposalToProject } from '../conversion/convertProposal';
import { loadVisibleCycle, loadWritableCycle, visibleCycleWhere, webActor, type CycleRow, type Db } from '../needsAccess';
import { cycleDocumentPrefix, presignNeedsDocument, registerCycleDocument } from '../needsCycles.service';
import { cycleConfig, dec } from '../needsSupport';
import { lockCycle } from '../needsVersions';
import { appropriationTemplateFileName, appropriationTitle, buildAppropriationWorkbook, parseAppropriationWorkbook, type ParsedAppropriationRow } from './appropriationWorkbook';
import {
  AT_FUNDING_WHERE,
  AWAITING_SELECT,
  approvedAmountOf,
  assertFundingGate,
  auditRowLinkInTx,
  awaitingItem,
  convertedProposals,
  fundingGateOf,
  holds,
  lockApprovedLists,
  portfolioApproverIds,
  proposalListFacts,
  recordFundingDecisionInTx,
  serializeFundingRecord,
  writeApprovedListInTx,
  type FundingDecisionItem,
} from './fundingSupport';

/**
 * Needs pipeline wave 4, Track B (B1, B2): Direct Intervention funding.
 *
 * B1: the budget submission to the Ministry is a record (date, amount, the acknowledgement as a cycle
 * document); several may be recorded (a revised submission). It does not gate the import.
 *
 * B2 (D-N.12): the appropriated schedule import. Preview writes nothing; confirm re-reads the same
 * bytes (another sha256: 409 NEEDS_FILE_CHANGED) in ONE transaction under the approved-list per-tenant
 * lock and the cycle lock. Rows are matched on "Proposal reference":
 * - MATCHED: an annual proposal of this cycle at FUNDING (IN_PROGRESS) with the row amount equal to its
 *   approved amount; PARTLY_FUNDED: below it (funded = the row amount);
 * - OUT_OF_CYCLE: an out-of-cycle request of the same programme that was approved (CONVERTED): the row
 *   is linked to its project, nothing converts;
 * - REFUSED: no reference, unknown, not at Funding, above the approved amount, listed twice, or any row
 *   error of the approved-list rules.
 * Approved proposals at Funding missing from the file become NOT_SELECTED "Not funded at appropriation"
 * (label "Not funded, carried forward"). Any refused row or file issue refuses the whole confirm (422
 * NEEDS_APPROPRIATION_INVALID). Once per cycle (409 NEEDS_FUNDING_ALREADY_IMPORTED); a DI_SCHEDULE list
 * of the cycle's year already in Approved lists blocks it (409 NEEDS_APPROVED_LIST_EXISTS); the person
 * who approved a step of the cycle's approved portfolio cannot confirm (409 SAME_PERSON_FUNDING).
 */

type Tx = Prisma.TransactionClient;

const NOT_FUNDED_REASON = 'Not funded at appropriation';
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// B1: the Funding tab and the budget submission
// ---------------------------------------------------------------------------

/** Why `user` cannot confirm an appropriation of this cycle now, or null. */
async function confirmBlocker(db: Db, user: WebJwtPayload, cycle: CycleRow): Promise<{ code: string; message: string } | null> {
  if (fundingGateOf(cycle) !== 'APPROPRIATION') return { code: 'NEEDS_FUNDING_GATE_MISMATCH', message: "This programme is funded through the State's BEAP." };
  if (!holds(user, 'needs:record_funding')) return { code: 'FORBIDDEN_PERMISSION', message: 'Recording the funding needs the permission needs:record_funding.' };
  if (!user.isPlatformSuperAdmin && user.organizationId !== cycle.owningOrganizationId) {
    return { code: 'NEEDS_CYCLE_FORBIDDEN', message: 'Only the organisation that owns this cycle records its funding.' };
  }
  if (cycle.status !== 'OPEN') return { code: 'NEEDS_CYCLE_NOT_OPEN', message: 'This cycle is not open.' };
  if (await db.needsFundingRecord.count({ where: { cycleId: cycle.id, kind: 'APPROPRIATION' } })) {
    return { code: 'NEEDS_FUNDING_ALREADY_IMPORTED', message: "This cycle's appropriated schedule is already imported." };
  }
  const list = await db.approvedList.findFirst({ where: { tenantId: cycle.tenantId, kind: 'DI_SCHEDULE', interventionYear: cycle.interventionYear }, select: { title: true } });
  if (list) {
    return {
      code: 'NEEDS_APPROVED_LIST_EXISTS',
      message: `"${list.title}" already exists for ${cycle.interventionYear}. The funding gate writes this approved list; a list for the same year entered by hand blocks it.`,
    };
  }
  const violation = separationViolation('CONFIRM_FUNDING', user.userId, { portfolioApproverUserIds: await portfolioApproverIds(db, cycle.id) });
  if (violation) return { code: violation, message: NEEDS_SEPARATION_ERROR_MESSAGES[violation] };
  return null;
}

/** `GET /cycles/:cycleId/funding` */
export async function getFunding(user: WebJwtPayload, cycleId: string): Promise<NeedsFundingDto> {
  const cycle = await loadVisibleCycle(user, cycleId);
  const gate = fundingGateOf(cycle);
  const [records, awaiting, converted] = await Promise.all([
    prisma.needsFundingRecord.findMany({ where: { cycleId: cycle.id }, orderBy: { createdAt: 'asc' } }),
    prisma.needsProposal.findMany({ where: { cycleId: cycle.id, ...AT_FUNDING_WHERE }, orderBy: [{ rank: 'asc' }, { sequence: 'asc' }], select: AWAITING_SELECT }),
    convertedProposals(prisma, cycle.id),
  ]);
  const canRecord =
    gate === 'APPROPRIATION' &&
    holds(user, 'needs:record_funding') &&
    (user.isPlatformSuperAdmin || user.organizationId === cycle.owningOrganizationId) &&
    cycle.status === 'OPEN';
  const blocker = gate === 'APPROPRIATION' ? await confirmBlocker(prisma, user, cycle) : null;
  return {
    cycleId: cycle.id,
    fundingGate: gate,
    records: records.map(serializeFundingRecord),
    awaiting: awaiting.map(awaitingItem),
    converted,
    canRecord,
    cannotConfirmReason: blocker?.message ?? null,
  };
}

/** `POST /cycles/:cycleId/funding/budget-submission` */
export async function recordBudgetSubmission(user: WebJwtPayload, cycleId: string, input: RecordBudgetSubmissionRequest): Promise<NeedsFundingRecordDto> {
  const cycle = await loadWritableCycle(user, cycleId);
  assertFundingGate(cycle, 'APPROPRIATION');
  const row = await prisma.$transaction(async (tx) => {
    await lockCycle(tx, cycle.id);
    if (input.acknowledgementDocumentId) {
      const doc = await tx.needsCycleDocument.findFirst({ where: { id: input.acknowledgementDocumentId, cycleId: cycle.id } });
      if (!doc) throw new AppError('The acknowledgement is not a document of this cycle', 404, 'NEEDS_DOCUMENT_NOT_FOUND');
      if (doc.kind !== 'BUDGET_SUBMISSION_ACKNOWLEDGEMENT') {
        throw new AppError('The acknowledgement must be a cycle document of kind BUDGET_SUBMISSION_ACKNOWLEDGEMENT', 422, 'NEEDS_DOCUMENT_KIND_MISMATCH');
      }
    }
    const created = await tx.needsFundingRecord.create({
      data: {
        cycleId: cycle.id,
        kind: 'BUDGET_SUBMISSION',
        recordedOn: input.submittedOn,
        amountNgn: input.amountNgn,
        documentId: input.acknowledgementDocumentId,
        note: input.note,
        recordedByUserId: user.userId,
        recordedByName: user.fullName,
      },
    });
    await recordAuditEvent(tx, {
      tenantId: user.tenantId,
      projectId: null,
      ...webActor(user),
      action: 'NEEDS_FUNDING_RECORDED',
      summaryText: `Recorded the ${cycle.interventionYear} budget submission to the Ministry on ${input.submittedOn}: NGN ${input.amountNgn.toLocaleString('en-NG')}${input.acknowledgementDocumentId ? ' (acknowledgement filed)' : ''}.`,
      payload: { cycleId: cycle.id, fundingRecordId: created.id, kind: 'BUDGET_SUBMISSION', recordedOn: input.submittedOn, amountNgn: input.amountNgn, documentId: input.acknowledgementDocumentId },
    });
    return created;
  });
  return serializeFundingRecord(row);
}

const FUNDING_DOCUMENT_KINDS: readonly CycleDocumentKind[] = ['BUDGET_SUBMISSION_ACKNOWLEDGEMENT', 'APPROPRIATED_SCHEDULE'];

export async function presignFundingDocument(user: WebJwtPayload, cycleId: string, input: NeedsDocumentPresignRequest): Promise<NeedsPresignedUploadDto> {
  assertFundingGate(await loadWritableCycle(user, cycleId), 'APPROPRIATION');
  return presignNeedsDocument(user, cycleId, input);
}

export async function registerFundingDocument(user: WebJwtPayload, cycleId: string, input: RegisterCycleDocumentRequest): Promise<NeedsCycleDocumentDto> {
  if (!FUNDING_DOCUMENT_KINDS.includes(input.kind)) {
    throw new AppError(`Only ${FUNDING_DOCUMENT_KINDS.join(' and ')} documents are filed here`, 422, 'NEEDS_DOCUMENT_KIND_MISMATCH');
  }
  assertFundingGate(await loadWritableCycle(user, cycleId), 'APPROPRIATION');
  return registerCycleDocument(user, cycleId, input);
}

// ---------------------------------------------------------------------------
// B2: the appropriated schedule
// ---------------------------------------------------------------------------

/** `GET /cycles/:cycleId/funding/appropriation/template` */
export async function buildAppropriationTemplate(user: WebJwtPayload, cycleId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const cycle = await loadVisibleCycle(user, cycleId);
  assertFundingGate(cycle, 'APPROPRIATION');
  const [tenant, proposals] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId }, select: { name: true } }),
    prisma.needsProposal.findMany({ where: { cycleId: cycle.id, ...AT_FUNDING_WHERE }, orderBy: [{ rank: 'asc' }, { sequence: 'asc' }], select: AWAITING_SELECT }),
  ]);
  const facts = await proposalListFacts(prisma, user.tenantId, proposals.map((p) => p.id));
  const shortName = workspaceShortName(tenant.name);
  const buffer = await buildAppropriationWorkbook({
    generatedAt: new Date(),
    brandName: shortName,
    interventionYear: cycle.interventionYear,
    rows: proposals.map((p) => ({
      reference: p.reference,
      title: p.title,
      schoolNames: facts.get(p.id)?.schoolNames ?? [],
      stateName: stateByCode(p.stateCode)?.name ?? null,
      lgaNames: p.lgaCodes.map((c) => lgaByCode(c)?.name ?? c),
      facilityScope: facts.get(p.id)?.facilityScope ?? null,
      approvedAmountNgn: approvedAmountOf(p),
    })),
  });
  return { buffer, fileName: appropriationTemplateFileName(shortName, cycle.interventionYear) };
}

function decode(fileBase64: string): Buffer {
  const buffer = Buffer.from(fileBase64.replace(/^data:[^,]*,/, ''), 'base64');
  if (buffer.length === 0) throw new AppError('The file is empty', 400, 'EMPTY_FILE');
  if (buffer.length > APPROVED_LIST_MAX_BYTES) throw new AppError('The appropriated schedule is larger than 10 MB', 413, 'FILE_TOO_LARGE');
  return buffer;
}

const sha256Of = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

interface PlannedRow {
  parsed: ParsedAppropriationRow;
  preview: AppropriationPreviewRow;
  /** MATCHED / PARTLY_FUNDED: the proposal to convert. */
  proposalId: string | null;
  /** OUT_OF_CYCLE: the project to link. */
  outOfCycleProject: { id: string; codePrefix: string; approvedListRowId: string | null; approvedListRow: { id: string; rowRef: string } | null } | null;
}

interface Analysis {
  preview: AppropriationPreviewDto;
  plan: PlannedRow[];
  notFunded: Array<{ id: string; reference: string; title: string; currentVersionId: string | null }>;
  header: { title: string | null; titleGiven: boolean; approvedBy: string | null };
}

const PROPOSAL_COLUMN = 'Proposal reference';
const AMOUNT_COLUMN = 'Cost estimate';

async function analyse(db: Db, user: WebJwtPayload, cycle: CycleRow, buffer: Buffer, fileName: string): Promise<Analysis> {
  const parsed = await parseAppropriationWorkbook(buffer);
  const config = cycleConfig(cycle);
  const issues: AppropriationIssue[] = [...parsed.issues];
  const h = parsed.header;
  if (h.kind && h.kind !== 'DI_SCHEDULE') {
    issues.push({ row: null, column: 'List', code: 'NEEDS_APPROPRIATION_KIND', message: 'An appropriated schedule is the Direct Intervention schedule, not a BEAP.' });
  }
  if (h.interventionYear !== null && h.interventionYear !== cycle.interventionYear) {
    issues.push({
      row: null,
      column: 'Intervention year',
      code: 'NEEDS_APPROPRIATION_YEAR',
      message: `The file is for ${h.interventionYear}; this cycle is for ${cycle.interventionYear}.`,
    });
  }
  const blocker = await confirmBlocker(db, user, cycle);
  if (blocker && blocker.code !== 'NEEDS_CYCLE_NOT_OPEN') issues.push({ row: null, column: null, code: blocker.code, message: blocker.message });

  const refs = [...new Set(parsed.rows.map((r) => r.proposalRef).filter((r): r is string => Boolean(r)))];
  const found = refs.length
    ? await db.needsProposal.findMany({
        where: { tenantId: user.tenantId, reference: { in: refs }, cycle: visibleCycleWhere(user) },
        select: {
          id: true,
          reference: true,
          title: true,
          route: true,
          stage: true,
          status: true,
          cycleId: true,
          approvedAmountNgn: true,
          costedAmountNgn: true,
          fundedAmountNgn: true,
          cycle: { select: { projectTypeId: true, configSnapshotJson: true, interventionYear: true } },
          project: { select: { id: true, codePrefix: true, status: true, approvedListRowId: true, approvedListRow: { select: { id: true, rowRef: true } } } },
        },
      })
    : [];
  const byRef = new Map(found.map((p) => [p.reference.toUpperCase(), p]));

  const seen = new Map<string, number>();
  const plan: PlannedRow[] = parsed.rows.map((r) => {
    const rowIssues: AppropriationIssue[] = r.issues.map((i) => ({ row: i.row, column: i.column, code: i.code, message: i.message }));
    const bad = (column: string | null, code: string, message: string) => rowIssues.push({ row: r.row, column, code, message: `Row ${r.row}: ${message}` });
    const amount = r.costEstimateNgn;
    let outcome: AppropriationPreviewRow['outcome'] = 'REFUSED';
    let proposalId: string | null = null;
    let approvedAmountNgn: number | null = null;
    let fundedAmountNgn: number | null = null;
    let outOfCycleProject: PlannedRow['outOfCycleProject'] = null;
    const p = r.proposalRef ? byRef.get(r.proposalRef) : undefined;
    if (!r.proposalRef) bad(PROPOSAL_COLUMN, 'PROPOSAL_REFERENCE_REQUIRED', 'Enter the proposal reference of the proposed project the row funds.');
    else if (seen.has(r.proposalRef)) bad(PROPOSAL_COLUMN, 'PROPOSAL_LISTED_TWICE', `${r.proposalRef} is also on row ${seen.get(r.proposalRef)}.`);
    else if (!p) bad(PROPOSAL_COLUMN, 'PROPOSAL_NOT_FOUND', `No proposed project or out-of-cycle request "${r.proposalRef}" was found.`);
    else if (p.route === 'OUT_OF_CYCLE') {
      approvedAmountNgn = dec(p.approvedAmountNgn) ?? dec(p.fundedAmountNgn);
      if (p.cycle.projectTypeId !== cycle.projectTypeId) bad(PROPOSAL_COLUMN, 'PROPOSAL_OTHER_PROGRAMME', `${p.reference} is an out-of-cycle request of another programme.`);
      // Review fix: only a request of this intervention year (an older one stays on its own year's list).
      else if (p.cycle.interventionYear !== cycle.interventionYear) {
        bad(PROPOSAL_COLUMN, 'OUT_OF_CYCLE_OTHER_YEAR', `${p.reference} is an out-of-cycle request for ${p.cycle.interventionYear}; this schedule is for ${cycle.interventionYear}.`);
      }
      else if (p.status !== 'CONVERTED' || !p.project) {
        bad(PROPOSAL_COLUMN, 'OUT_OF_CYCLE_NOT_APPROVED', `${p.reference} is an out-of-cycle request that has not been approved yet.`);
      } else if (p.project.status === 'ARCHIVED') bad(PROPOSAL_COLUMN, 'PROJECT_ARCHIVED', `${p.reference}'s project ${formatProjectCode(p.project.codePrefix)} is archived.`);
      else {
        outcome = 'OUT_OF_CYCLE';
        fundedAmountNgn = amount;
        outOfCycleProject = p.project;
      }
    } else if (p.cycleId !== cycle.id) bad(PROPOSAL_COLUMN, 'PROPOSAL_OTHER_CYCLE', `${p.reference} is a proposed project of another cycle.`);
    else if (p.stage !== 'FUNDING' || p.status !== 'IN_PROGRESS') {
      bad(
        PROPOSAL_COLUMN,
        'PROPOSAL_NOT_AT_FUNDING',
        `${p.reference} is "${proposalStatusLabel({ stage: p.stage as NeedsStage, status: p.status as NeedsProposalStatus }, config)}", not approved and waiting for funding.`
      );
    } else {
      approvedAmountNgn = approvedAmountOf(p);
      if (amount !== null) {
        if (approvedAmountNgn === null) bad(AMOUNT_COLUMN, 'NO_APPROVED_AMOUNT', `${p.reference} has no approved amount to compare with.`);
        else if (amount > approvedAmountNgn + 0.005) {
          bad(AMOUNT_COLUMN, 'ABOVE_APPROVED_AMOUNT', `NGN ${amount.toLocaleString('en-NG')} is above the approved amount of ${p.reference} (NGN ${approvedAmountNgn.toLocaleString('en-NG')}).`);
        } else {
          outcome = Math.abs(amount - approvedAmountNgn) <= 0.005 ? 'MATCHED' : 'PARTLY_FUNDED';
          fundedAmountNgn = amount;
          proposalId = p.id;
        }
      }
    }
    if (r.proposalRef && !seen.has(r.proposalRef)) seen.set(r.proposalRef, r.row);
    if (rowIssues.length) {
      outcome = 'REFUSED';
      fundedAmountNgn = null;
      proposalId = null;
      outOfCycleProject = null;
    }
    return {
      parsed: r,
      proposalId,
      outOfCycleProject,
      preview: {
        rowNumber: r.row,
        rowRef: r.rowRef ?? '',
        proposalReference: p?.reference ?? r.proposalRef,
        proposalId: p?.id ?? null,
        title: r.projectTitle ?? p?.title ?? '',
        approvedAmountNgn,
        fundedAmountNgn,
        outcome,
        issues: rowIssues,
      },
    };
  });

  const named = new Set(plan.map((p) => p.preview.proposalId).filter((id): id is string => Boolean(id)));
  const atFunding = await db.needsProposal.findMany({
    where: { cycleId: cycle.id, ...AT_FUNDING_WHERE },
    orderBy: { sequence: 'asc' },
    select: { id: true, reference: true, title: true, currentVersionId: true, approvedAmountNgn: true, costedAmountNgn: true },
  });
  const notFunded = atFunding.filter((p) => !named.has(p.id));
  const count = (o: AppropriationPreviewRow['outcome']) => plan.filter((p) => p.preview.outcome === o).length;
  const refused = count('REFUSED');
  const preview: AppropriationPreviewDto = {
    cycleId: cycle.id,
    fileName,
    sha256: sha256Of(buffer),
    rows: plan.map((p) => p.preview),
    notFunded: notFunded.map((p) => ({ proposalId: p.id, reference: p.reference, title: p.title, approvedAmountNgn: approvedAmountOf(p) })),
    issues,
    totals: {
      matched: count('MATCHED'),
      partlyFunded: count('PARTLY_FUNDED'),
      outOfCycle: count('OUT_OF_CYCLE'),
      refused,
      notFunded: notFunded.length,
      fundedNgn: round2(plan.reduce((s, p) => s + (p.preview.outcome === 'MATCHED' || p.preview.outcome === 'PARTLY_FUNDED' ? (p.preview.fundedAmountNgn ?? 0) : 0), 0)),
    },
    canConfirm: issues.length === 0 && refused === 0 && plan.length > 0,
  };
  return { preview, plan, notFunded, header: { title: h.title, titleGiven: h.titleGiven, approvedBy: h.approvedBy } };
}

/** `POST /cycles/:cycleId/funding/appropriation/preview`: nothing is written. */
export async function previewAppropriation(user: WebJwtPayload, cycleId: string, input: AppropriationImportPreviewRequest): Promise<AppropriationPreviewDto> {
  const cycle = await loadWritableCycle(user, cycleId);
  assertFundingGate(cycle, 'APPROPRIATION');
  return (await analyse(prisma, user, cycle, decode(input.fileBase64), input.fileName)).preview;
}

/** `POST /cycles/:cycleId/funding/appropriation/confirm` */
export async function confirmAppropriation(user: WebJwtPayload, cycleId: string, input: AppropriationImportConfirmRequest): Promise<AppropriationResultDto> {
  const cycle = await loadWritableCycle(user, cycleId);
  assertFundingGate(cycle, 'APPROPRIATION');
  const buffer = decode(input.fileBase64);
  const sha256 = sha256Of(buffer);
  if (sha256 !== input.sha256) throw new AppError('This is not the file that was checked. Preview it again before confirming.', 409, 'NEEDS_FILE_CHANGED');

  // The file is stored first (wave 3 item 9: storage writes stay outside the transaction); a refused
  // confirm leaves an unreferenced object (the storage service has no delete).
  const stored = await storeTenantAreaBuffer(cycleDocumentPrefix(user.tenantId, cycle.id), input.fileName.replace(/[\\/]/g, '_'), buffer, XLSX_CONTENT_TYPE);
  const tolerance = await tenantTolerancePct(user.tenantId);

  const result = await prisma.$transaction(
    async (tx: Tx) => {
      await lockApprovedLists(tx, user.tenantId);
      await lockCycle(tx, cycle.id);
      const fresh = await tx.needsCycle.findUniqueOrThrow({ where: { id: cycle.id } });
      if (fresh.status !== 'OPEN') throw new AppError('This cycle is not open', 409, 'NEEDS_CYCLE_NOT_OPEN');
      const blocker = await confirmBlocker(tx, user, fresh);
      if (blocker) throw new AppError(blocker.message, blocker.code === 'FORBIDDEN_PERMISSION' || blocker.code === 'NEEDS_CYCLE_FORBIDDEN' ? 403 : 409, blocker.code);
      const a = await analyse(tx, user, fresh, buffer, input.fileName);
      if (!a.preview.canConfirm) {
        const problems = [...a.preview.issues, ...a.preview.rows.flatMap((r) => r.issues)];
        throw new AppError(
          problems.length ? `The appropriated schedule has ${problems.length} problem(s). Fix them and upload it again.` : 'The appropriated schedule has no rows.',
          422,
          'NEEDS_APPROPRIATION_INVALID',
          { issues: problems, rows: a.preview.rows.filter((r) => r.outcome === 'REFUSED') }
        );
      }
      const funded = a.plan.filter((p) => p.proposalId);
      const title = a.header.titleGiven && a.header.title ? a.header.title : appropriationTitle(fresh.interventionYear);

      // The file, as a cycle document covering the converted proposals.
      const doc = await tx.needsCycleDocument.create({
        data: {
          cycleId: fresh.id,
          kind: 'APPROPRIATED_SCHEDULE',
          title,
          generated: false,
          objectKey: stored.objectKey,
          fileName: stored.fileName,
          mimeType: XLSX_CONTENT_TYPE,
          byteSize: stored.byteSize,
          sha256: stored.sha256,
          coveredProposalIds: funded.map((p) => p.proposalId!),
          uploadedByUserId: user.userId,
          uploadedByName: user.fullName,
        },
      });
      await recordAuditEvent(tx, {
        tenantId: user.tenantId,
        projectId: null,
        ...webActor(user),
        action: 'NEEDS_DOCUMENT_ADDED',
        summaryText: `Added the cycle document "${title}" (Appropriated schedule).`,
        payload: { cycleId: fresh.id, documentId: doc.id, kind: 'APPROPRIATED_SCHEDULE', title, proposalIds: doc.coveredProposalIds, sha256, fileName: stored.fileName },
      });

      // D-N.12: the approved list, one row per funded or linked row.
      const listRows = a.plan.filter((p) => p.preview.outcome !== 'REFUSED');
      const list = await writeApprovedListInTx(tx, {
        user,
        kind: 'DI_SCHEDULE',
        interventionYear: fresh.interventionYear,
        stateCode: null,
        title,
        approvedBy: a.header.approvedBy ?? user.fullName,
        approvedOn: input.appropriatedOn,
        documentId: doc.id,
        sourceFileName: input.fileName,
        sourceSha256: sha256,
        rows: listRows.map((p) => ({
          rowRef: p.parsed.rowRef!,
          projectTitle: p.parsed.projectTitle!,
          schoolNames: p.parsed.schoolNames,
          stateCode: p.parsed.stateCode!,
          lgaCodes: p.parsed.lgaCodes,
          facilityScope: p.parsed.facilityScope,
          costEstimateNgn: p.parsed.costEstimateNgn!,
          lotTitle: p.parsed.lotTitle,
        })),
      });

      // Conversions and links.
      const converted: AppropriationResultDto['converted'] = [];
      const decisionItems: FundingDecisionItem[] = [];
      for (const [i, p] of listRows.entries()) {
        const rowId = list.rowIds[i];
        const estimate = p.parsed.costEstimateNgn!;
        if (p.proposalId) {
          const proposal = await tx.needsProposal.findUniqueOrThrow({ where: { id: p.proposalId }, select: { id: true, reference: true, currentVersionId: true } });
          const made = await convertProposalToProject(tx, proposal, { fundedAmountNgn: p.preview.fundedAmountNgn!, by: user, approvedListRowId: rowId });
          await auditRowLinkInTx(tx, { user, projectId: made.projectId, listId: list.listId, listTitle: list.title, kind: 'DI_SCHEDULE', rowId, rowRef: p.parsed.rowRef!, estimateNgn: estimate, previousRow: null, tolerancePct: tolerance });
          converted.push({ proposalId: proposal.id, reference: proposal.reference, projectId: made.projectId, projectCode: formatProjectCode(made.codePrefix), fundedAmountNgn: p.preview.fundedAmountNgn! });
          decisionItems.push({
            proposal,
            outcome: 'ADVANCE',
            reason: p.preview.outcome === 'PARTLY_FUNDED' ? `Partly funded: NGN ${estimate.toLocaleString('en-NG')} of NGN ${p.preview.approvedAmountNgn!.toLocaleString('en-NG')} approved` : null,
            toStatus: 'CONVERTED',
          });
        } else if (p.outOfCycleProject) {
          const project = p.outOfCycleProject;
          await tx.project.update({ where: { id: project.id }, data: { approvedListRowId: rowId } });
          await auditRowLinkInTx(tx, {
            user,
            projectId: project.id,
            listId: list.listId,
            listTitle: list.title,
            kind: 'DI_SCHEDULE',
            rowId,
            rowRef: p.parsed.rowRef!,
            estimateNgn: estimate,
            previousRow: project.approvedListRow,
            tolerancePct: tolerance,
          });
        }
      }
      for (const p of a.notFunded) decisionItems.push({ proposal: p, outcome: 'NOT_SELECTED', reason: NOT_FUNDED_REASON, toStatus: 'NOT_SELECTED' });
      await recordFundingDecisionInTx(tx, {
        user,
        cycle: fresh,
        reason: `Appropriated schedule "${input.fileName}" (appropriated on ${input.appropriatedOn}).`,
        evidenceDocumentIds: [doc.id],
        items: decisionItems,
      });

      const t = a.preview.totals;
      const summary = { ...t, convertedCount: converted.length, approvedListRowCount: listRows.length, appropriatedOn: input.appropriatedOn };
      const record = await tx.needsFundingRecord.create({
        data: {
          cycleId: fresh.id,
          kind: 'APPROPRIATION',
          recordedOn: input.appropriatedOn,
          amountNgn: t.fundedNgn,
          documentId: doc.id,
          approvedListId: list.listId,
          fileName: input.fileName,
          sha256,
          summaryJson: summary as unknown as Prisma.InputJsonValue,
          recordedByUserId: user.userId,
          recordedByName: user.fullName,
        },
      });
      await recordAuditEvent(tx, {
        tenantId: user.tenantId,
        projectId: null,
        ...webActor(user),
        action: 'NEEDS_FUNDING_RECORDED',
        summaryText:
          `Imported the ${fresh.interventionYear} appropriated schedule "${input.fileName}" (appropriated on ${input.appropriatedOn}): ` +
          `${t.matched} funded, ${t.partlyFunded} partly funded, ${t.outOfCycle} out-of-cycle linked, ${t.notFunded} not funded (carried forward).`,
        payload: {
          cycleId: fresh.id,
          fundingRecordId: record.id,
          kind: 'APPROPRIATION',
          recordedOn: input.appropriatedOn,
          sha256,
          documentId: doc.id,
          approvedListId: list.listId,
          totals: summary,
          proposalIds: [...converted.map((c) => c.proposalId), ...a.notFunded.map((p) => p.id)],
        },
      });
      await recordAuditEvent(tx, {
        tenantId: user.tenantId,
        projectId: null,
        ...webActor(user),
        action: 'APPROVED_LIST_IMPORTED',
        summaryText: `Wrote ${list.title} from the appropriated schedule "${input.fileName}": ${listRows.length} row(s), each linked to its project.`,
        payload: {
          listId: list.listId,
          created: true,
          interventionYear: fresh.interventionYear,
          kind: 'DI_SCHEDULE',
          stateCode: null,
          title: list.title,
          fileName: input.fileName,
          sha256,
          source: 'NEEDS_FUNDING',
          cycleId: fresh.id,
          fundingRecordId: record.id,
        },
      });
      return {
        fundingRecord: serializeFundingRecord(record),
        converted,
        notSelected: a.notFunded.map((p) => ({ proposalId: p.id, reference: p.reference })),
        approvedListId: list.listId,
      };
    },
    { timeout: 120_000, maxWait: 15_000 }
  );
  return result;
}
