import { CYCLE_DOCUMENT_KIND_META, PROJECT_ORIGIN_LABELS, PROPOSAL_DOCUMENT_KIND_LABELS, type CycleDocumentKind, type ProposalDocumentKind } from '@insite/shared';
import { prisma } from '../../config/prisma';
import { storageService } from '../../integrations/storage.service';

/**
 * Needs pipeline wave 4 (M4): the closure pack's `needs-assessment/` folder for a project converted
 * from a proposed project or an approved out-of-cycle request. Files the platform holds are copied
 * as they are (needs assessment versions, the proposal's documents, the cycle documents that cover
 * it or decided it: approval memo, appropriated schedule, BEAP, counterpart evidence …); the records
 * are written as CSV / JSON (validation records, score sheets, approvals and funding, the proposal's
 * tenant-ledger history). A file that cannot be read is listed in the manifest with the reason.
 */

type Add = (path: string, data: Buffer, source: string) => string;
type Skip = (path: string, source: string, note: string) => void;

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (head: string[], rows: unknown[][]) => Buffer.from([head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n', 'utf8');
const safe = (s: string, max = 70) => s.replace(/[^A-Za-z0-9._ -]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, max) || 'file';

export const NEEDS_FOLDER_CONTENTS = { path: 'needs-assessment/', description: 'Where the project came from: needs assessment versions, validation, scores, approvals, funding and the proposal history.' };

/** Adds the folder; returns false when the project has no proposal (nothing written). */
export async function addNeedsAssessmentFolder(projectId: string, add: Add, skip: Skip, maxBytes: number): Promise<boolean> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { origin: true, needsProposalId: true } });
  if (!project.needsProposalId) return false;
  const p = await prisma.needsProposal.findUniqueOrThrow({
    where: { id: project.needsProposalId },
    include: {
      cycle: { include: { projectType: { select: { name: true } } } },
      versions: { orderBy: { number: 'asc' } },
      documents: { orderBy: { createdAt: 'asc' } },
      validationRecords: { orderBy: { recordedAt: 'asc' }, include: { version: { select: { number: true } } } },
      scoreSheets: { include: { member: { include: { user: { select: { fullName: true } } } } } },
      submissionItems: { include: { submission: { include: { actions: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { fullName: true } }, step: { select: { label: true } } } } } } } },
    },
  });
  const root = 'needs-assessment';

  const copy = async (target: string, objectKey: string, byteSize: number, source: string) => {
    if (byteSize > maxBytes) return skip(target, source, `Too large for the pack (${(byteSize / 1024 / 1024).toFixed(1)} MB).`);
    let body: Buffer | null = null;
    try {
      body = await storageService.getObjectBuffer(objectKey, maxBytes);
    } catch {
      body = null;
    }
    if (!body) return skip(target, source, 'The stored file could not be read.');
    add(target, body, source);
  };

  // Versions of the needs assessment, oldest first.
  for (const v of p.versions) {
    await copy(`${root}/versions/v${v.number}-${v.source.toLowerCase()}-${safe(v.fileName)}`, v.objectKey, v.byteSize, `needs assessment ${p.reference} v${v.number}`);
  }
  // The proposal's documents (drawings, site verification evidence, authorising document …).
  for (const d of p.documents) {
    const label = PROPOSAL_DOCUMENT_KIND_LABELS[d.kind as ProposalDocumentKind] ?? d.kind;
    await copy(`${root}/documents/${safe(label)}-${safe(d.title)}-${safe(d.fileName, 40)}`, d.objectKey, d.byteSize, `proposal document ${d.id}`);
  }
  // Cycle documents covering it or named by its submissions (memo, narrative, counterpart evidence) and funding records.
  const submissions = p.submissionItems.map((i) => i.submission);
  const namedIds = submissions.flatMap((s) => [s.memoDocumentId, s.narrativeDocumentId, s.counterpartEvidenceDocumentId]).filter((x): x is string => Boolean(x));
  const funding = await prisma.needsFundingRecord.findMany({ where: { cycleId: p.cycleId }, orderBy: { createdAt: 'asc' } });
  const fundingDocIds = funding.map((f) => f.documentId).filter((x): x is string => Boolean(x));
  const cycleDocs = await prisma.needsCycleDocument.findMany({
    where: { cycleId: p.cycleId, OR: [{ coveredProposalIds: { has: p.id } }, { id: { in: [...namedIds, ...fundingDocIds] } }] },
    orderBy: { createdAt: 'asc' },
  });
  for (const d of cycleDocs) {
    const label = CYCLE_DOCUMENT_KIND_META[d.kind as CycleDocumentKind]?.label ?? d.kind;
    await copy(`${root}/cycle-documents/${safe(label)}-${safe(d.fileName, 50)}`, d.objectKey, d.byteSize, `cycle document ${d.id}`);
  }

  add(
    `${root}/validation-records.csv`,
    csv(
      ['recordedAt', 'versionNumber', 'outcome', 'deskNotes', 'siteVerification', 'flagResolutions', 'recordedBy'],
      p.validationRecords.map((r) => [r.recordedAt.toISOString(), r.version.number, r.outcome, r.deskNotes, r.siteVerificationJson, r.duplicateResolutionsJson, r.recordedByName])
    ),
    'validation records'
  );
  add(
    `${root}/score-sheets.csv`,
    csv(
      ['member', 'scores', 'comment', 'submittedAt'],
      p.scoreSheets.map((s) => [s.member.user.fullName, s.scoresJson, s.comment, s.submittedAt.toISOString()])
    ),
    'score sheets'
  );
  const record = {
    proposal: {
      reference: p.reference,
      title: p.title,
      route: p.route,
      outOfCycleReason: p.outOfCycleReason,
      outOfCycleDetails: p.outOfCycleDetails,
      programme: p.cycle.projectType.name,
      interventionYear: p.cycle.interventionYear,
      stateCode: p.stateCode,
      status: p.status,
      scores: { impact: p.scoreImpact && Number(p.scoreImpact), ease: p.scoreEase && Number(p.scoreEase), total: p.scoreTotal && Number(p.scoreTotal) },
      rank: p.rank,
      aboveLine: p.aboveLine,
      lineOverrideReason: p.lineOverrideReason,
      amountsNgn: {
        preliminary: p.preliminaryAmountNgn && Number(p.preliminaryAmountNgn),
        costed: p.costedAmountNgn && Number(p.costedAmountNgn),
        approved: p.approvedAmountNgn && Number(p.approvedAmountNgn),
        funded: p.fundedAmountNgn && Number(p.fundedAmountNgn),
      },
    },
    projectOrigin: project.origin ? PROJECT_ORIGIN_LABELS[project.origin] : null,
    approvals: submissions.map((s) => {
      const item = p.submissionItems.find((i) => i.submissionId === s.id)!;
      return {
        kind: s.kind,
        status: s.status,
        submittedBy: s.submittedByName,
        submittedAt: s.submittedAt?.toISOString() ?? null,
        decidedAt: s.decidedAt?.toISOString() ?? null,
        item: { included: item.included, exclusionReason: item.exclusionReason, amountNgn: item.amountNgn && Number(item.amountNgn), lotTitle: item.lotTitle, lotNumber: item.lotNumber, batchNumber: item.batchNumber, procurementMethod: item.procurementMethod, reviewOutcome: item.reviewOutcome, reviewComment: item.reviewComment },
        counterpart: s.kind === 'BEAP' ? { declaredNgn: s.counterpartDeclaredNgn && Number(s.counterpartDeclaredNgn), evidenceDocumentId: s.counterpartEvidenceDocumentId, recordedAt: s.counterpartRecordedAt?.toISOString() ?? null } : undefined,
        actions: s.actions.map((a) => ({ step: a.step.label, decision: a.decision, by: a.actor.fullName, notes: a.notes, at: a.createdAt.toISOString() })),
      };
    }),
    funding: funding.map((f) => ({ kind: f.kind, recordedOn: f.recordedOn, amountNgn: f.amountNgn && Number(f.amountNgn), fileName: f.fileName, sha256: f.sha256, note: f.note, summary: f.summaryJson, recordedBy: f.recordedByName })),
  };
  add(`${root}/approvals-and-funding.json`, Buffer.from(JSON.stringify(record, null, 2), 'utf8'), 'approvals and funding');

  const history = await prisma.auditLog.findMany({
    where: {
      tenantId: p.tenantId,
      projectId: null,
      OR: [{ payload: { path: ['proposalId'], equals: p.id } }, { payload: { path: ['proposalIds'], array_contains: [p.id] } }],
    },
    orderBy: { seq: 'asc' },
  });
  add(
    `${root}/proposal-history.csv`,
    csv(
      ['seq', 'createdAt', 'actor', 'action', 'summaryText', 'entryHash'],
      history.map((e) => [Number(e.seq), e.createdAt.toISOString(), e.actorDisplayName, e.action, e.summaryText, e.entryHash])
    ),
    'proposal history (tenant ledger)'
  );
  return true;
}
