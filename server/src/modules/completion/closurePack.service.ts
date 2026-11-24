import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Prisma } from '@prisma/client';
import {
  SCHEDULE_STATUS_META,
  ScheduleStatusValue,
  ClosurePackExportDto,
  CONSTRUCTION_PHASE_LABELS,
  INSPECTION_VISIT_TYPE_LABELS,
  resolveTerm,
  resolveTerminology,
  zonedCalendarDate,
  PAYMENT_KIND_LABELS,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent, verifyAuditChain } from '../audit/audit.service';
import { storeGeneratedDocument } from '../documents/documents.service';
import { storageService } from '../../integrations/storage.service';
import { generateClosureIndexPdf, generateInspectionSummaryPdf } from '../../integrations/closure-pdf.service';
import { parseSections } from '../inspections/checklistTemplates.service';
import { ZipFileWriter } from '../../utils/zipWriter';
import { brandingFor } from './completion.service';

/**
 * Phase 15 Step 7: the closure pack. POST queues an export; the export builds a ZIP on disk one
 * entry at a time (index PDF, manifest, every current document version, certificates, payment
 * PDFs, inspection summaries, the audit ledger as CSV with a chain verification), stores it as a
 * CLOSURE_FILE register document and records CLOSURE_PACK_EXPORTED. Download goes through the
 * document register (contractors never see CLOSURE_FILE). Large files are skipped and listed in the
 * manifest rather than loaded; the archive is capped.
 */

const MAX_ENTRY_BYTES = 30 * 1024 * 1024;
const MAX_PACK_BYTES = 1024 * 1024 * 1024;

type Scheduler = (exportId: string) => void;
let scheduler: Scheduler = (id) => {
  setImmediate(() => {
    void runClosurePackExport(id);
  });
};

/** Tests replace the scheduler to run the export inline. */
export function setClosurePackScheduler(next: Scheduler | null) {
  scheduler =
    next ??
    ((id) => {
      setImmediate(() => {
        void runClosurePackExport(id);
      });
    });
}

const EXPORT_INCLUDE = { document: { select: { id: true } } } satisfies Prisma.ClosurePackExportInclude;
type ExportRow = Prisma.ClosurePackExportGetPayload<{ include: typeof EXPORT_INCLUDE }>;

async function serialize(rows: ExportRow[]): Promise<ClosurePackExportDto[]> {
  const ids = [...new Set(rows.map((r) => r.requestedByUserId))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : [];
  const name = new Map(users.map((u) => [u.id, u.fullName]));
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    documentId: r.documentId,
    byteSize: r.byteSize,
    entryCount: r.entryCount,
    chainVerified: r.chainVerified,
    requestedByName: name.get(r.requestedByUserId) ?? null,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    error: r.error,
  }));
}

export async function listClosurePacks(projectId: string): Promise<ClosurePackExportDto[]> {
  const rows = await prisma.closurePackExport.findMany({ where: { projectId }, include: EXPORT_INCLUDE, orderBy: { createdAt: 'desc' }, take: 20 });
  return serialize(rows);
}

/** POST /projects/:projectId/closure-pack */
export async function requestClosurePack(projectId: string, webUser: WebJwtPayload): Promise<ClosurePackExportDto> {
  const id = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId}::uuid FOR UPDATE`;
    const running = await tx.closurePackExport.count({ where: { projectId, status: { in: ['QUEUED', 'RUNNING'] } } });
    if (running) throw new AppError('A closure pack is already being built for this project.', 409, 'CLOSURE_PACK_IN_PROGRESS');
    const row = await tx.closurePackExport.create({ data: { projectId, requestedByUserId: webUser.userId } });
    return row.id;
  });
  scheduler(id);
  const row = await prisma.closurePackExport.findUniqueOrThrow({ where: { id }, include: EXPORT_INCLUDE });
  return (await serialize([row]))[0];
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

const safe = (s: string, max = 70) => s.replace(/[^A-Za-z0-9._ -]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, max) || 'file';
const money = (n: number | Prisma.Decimal | null | undefined, currency: string) =>
  n === null || n === undefined ? '—' : `${currency} ${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

interface ManifestEntry {
  path: string;
  sha256: string | null;
  bytes: number | null;
  source: string;
  note?: string;
}

/** Runs one export (claims it first; a second runner skips). */
export async function runClosurePackExport(exportId: string): Promise<void> {
  const claimed = await prisma.closurePackExport.updateMany({ where: { id: exportId, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date() } });
  if (claimed.count === 0) return;
  const row = await prisma.closurePackExport.findUniqueOrThrow({ where: { id: exportId } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insite-closure-'));
  const zipPath = path.join(dir, 'closure-pack.zip');
  const zip = new ZipFileWriter(zipPath, MAX_PACK_BYTES);
  try {
    const result = await buildPack(row.projectId, zip);
    const finished = zip.finish();
    const requester = await prisma.user.findUnique({ where: { id: row.requestedByUserId }, select: { fullName: true, role: { select: { name: true } } } });
    await prisma.$transaction(
      async (tx) => {
        const project = await tx.project.findUniqueOrThrow({ where: { id: row.projectId }, select: { tenantId: true, codePrefix: true, timezone: true } });
        const stored = await storeGeneratedDocument(tx, {
          projectId: row.projectId,
          tenantId: project.tenantId,
          typeCode: 'CLOSURE_FILE',
          title: `Closure pack ${project.codePrefix} ${zonedCalendarDate(new Date(), project.timezone)}`,
          file: { filePath: zipPath, byteSize: finished.byteSize, sha256: finished.sha256, mimeType: 'application/zip', extension: 'zip' },
          uploadedByUserId: row.requestedByUserId,
          note: `${finished.entryCount} files; audit chain ${result.chainVerified ? 'verified' : 'NOT verified'}`,
        });
        await tx.closurePackExport.update({
          where: { id: exportId },
          data: {
            status: 'DONE',
            documentId: stored.documentId,
            byteSize: finished.byteSize,
            entryCount: finished.entryCount,
            chainVerified: result.chainVerified,
            finishedAt: new Date(),
          },
        });
        await recordAuditEvent(tx, {
          projectId: row.projectId,
          actorType: 'WEB_USER',
          actorId: row.requestedByUserId,
          actorDisplayName: requester ? `${requester.fullName} (${requester.role.name})` : 'Unknown user',
          action: 'CLOSURE_PACK_EXPORTED',
          summaryText: `Exported the closure pack: ${finished.entryCount} files, ${(finished.byteSize / 1024 / 1024).toFixed(1)} MB; audit chain ${
            result.chainVerified ? `verified over ${result.auditEntries} entries` : 'verification FAILED'
          }${result.skipped ? `; ${result.skipped} file(s) skipped (listed in the manifest)` : ''}.`,
          payload: {
            exportId,
            documentId: stored.documentId,
            sha256: finished.sha256,
            byteSize: finished.byteSize,
            entryCount: finished.entryCount,
            chainVerified: result.chainVerified,
            latestAuditHash: result.latestHash,
            skipped: result.skipped,
          },
        });
      },
      { timeout: 120_000 }
    );
  } catch (error) {
    zip.abort();
    const message = error instanceof Error ? error.message : String(error);
    await prisma.closurePackExport.update({ where: { id: exportId }, data: { status: 'FAILED', error: message.slice(0, 1000), finishedAt: new Date() } });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function buildPack(projectId: string, zip: ZipFileWriter) {
  const manifest: ManifestEntry[] = [];
  const add = (p: string, data: Buffer, source: string) => {
    const name = zip.addFile(p, data);
    manifest.push({ path: name, sha256: crypto.createHash('sha256').update(data).digest('hex'), bytes: data.length, source });
    return name;
  };
  const skip = (p: string, source: string, note: string) => manifest.push({ path: p, sha256: null, bytes: null, source, note });

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: {
      tenant: { select: { defaultCurrency: true, terminologyLabels: true } },
      owningOrganization: { select: { name: true } },
      lenderOrganization: { select: { name: true } },
      monitorOrganization: { select: { name: true } },
      projectType: { select: { name: true } },
      region: { select: { name: true } },
      beneficiaries: { select: { name: true, isPrimary: true } },
      contractors: { include: { organization: { select: { name: true } } }, orderBy: [{ createdAt: 'asc' }] },
    },
  });
  const currency = project.tenant.defaultCurrency;
  const terms = resolveTerminology(project.tenant.terminologyLabels);
  const branding = await brandingFor(prisma, projectId);
  const tz = project.timezone;
  const day = (d: Date | null | undefined) => (d ? zonedCalendarDate(d, tz) : '—');

  // 1. Documents and certificates (current versions, not archived, not earlier closure packs).
  const docs = await prisma.projectDocument.findMany({
    where: { projectId, isArchived: false, documentType: { code: { not: 'CLOSURE_FILE' } } },
    include: { documentType: { select: { code: true, name: true } }, versions: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const d of docs) {
    const v = d.versions.find((x) => x.version === d.currentVersion);
    if (!v) continue;
    const ext = v.objectKey.includes('.') ? v.objectKey.slice(v.objectKey.lastIndexOf('.')) : '';
    const certificate = d.documentType.code === 'COMPLETION_CERTIFICATE' || d.documentType.code === 'HANDOVER_CERTIFICATE';
    const target = `${certificate ? 'certificates' : `documents/${d.documentType.code}`}/${safe(d.title)}-v${v.version}${ext}`;
    if (v.byteSize > MAX_ENTRY_BYTES) {
      skip(target, `document ${d.id} v${v.version}`, `Too large for the pack (${(v.byteSize / 1024 / 1024).toFixed(1)} MB); download it from the register. SHA-256 ${v.sha256}.`);
      continue;
    }
    let body: Buffer | null = null;
    try {
      body = await storageService.getObjectBuffer(v.objectKey, MAX_ENTRY_BYTES);
    } catch {
      body = null;
    }
    if (!body) {
      skip(target, `document ${d.id} v${v.version}`, `The stored file could not be read. Register SHA-256 ${v.sha256}.`);
      continue;
    }
    const sha = crypto.createHash('sha256').update(body).digest('hex');
    const name = add(target, body, `document ${d.id} v${v.version}`);
    if (sha !== v.sha256) manifest[manifest.length - 1].note = `Stored file differs from the register hash ${v.sha256}.`;
    void name;
  }

  // 2. Payment record (payments are made outside the platform and recorded; redesign R1b).
  const paymentRows = await prisma.projectPayment.findMany({ where: { projectId }, orderBy: [{ paidOn: 'asc' }, { createdAt: 'asc' }] });
  {
    const head = ['paidOn', 'kind', 'reference', 'grossAmountNgn', 'retentionHeldNgn', 'netAmountNgn', 'exceptions', 'recordedBy', 'voided', 'voidReason'];
    const rows = [head.join(',')];
    for (const r of paymentRows) {
      rows.push(
        [r.paidOn, r.kind, r.reference, Number(r.grossAmountNgn), Number(r.retentionHeldNgn), Number(r.netAmountNgn), JSON.stringify(r.exceptionsJson), r.recordedByName, r.voidedAt ? 'yes' : 'no', r.voidReason ?? '']
          .map(csvCell)
          .join(',')
      );
    }
    add('payments/payment-record.csv', Buffer.from(rows.join('\r\n') + '\r\n', 'utf8'), 'payment record');
  }

  // 3. Inspection summaries.
  const inspections = await prisma.siteInspectionReport.findMany({
    where: { projectId },
    include: { template: true, findings: { select: { description: true, severity: true, status: true } } },
    orderBy: { visitDate: 'asc' },
  });
  for (const i of inspections) {
    let items: Array<{ section: string; label: string; value: string; comment: string | null }> = [];
    try {
      const sections = parseSections(i.template.sectionsJson);
      const answers = new Map(((Array.isArray(i.answersJson) ? i.answersJson : []) as Array<{ itemKey: string; value: unknown; comment?: string | null }>).map((a) => [a.itemKey, a]));
      items = sections.flatMap((s) =>
        s.items.map((it) => {
          const a = answers.get(it.key);
          return { section: s.title, label: it.label, value: a ? String(a.value ?? '—') : 'not answered', comment: a?.comment ?? null };
        })
      );
    } catch {
      items = [];
    }
    add(
      `inspections/${i.visitDate}-${i.visitType.toLowerCase()}-${i.id.slice(0, 8)}.pdf`,
      await generateInspectionSummaryPdf({
        branding,
        projectLabel: `[${project.codePrefix}] ${project.name}`,
        title: `${INSPECTION_VISIT_TYPE_LABELS[i.visitType]} of ${i.visitDate}`,
        fields: [
          ['Inspector', `${i.reporterName} (${i.reporterRoleName})`],
          ['Checklist', `${i.template.name} v${i.templateVersion}`],
          ['Overall finding', i.overallFinding.replace('_', ' ').toLowerCase()],
          ['Status', i.status.replace('_', ' ').toLowerCase()],
          ['Geofence', i.geofenceStatus ?? '—'],
          ['Late', i.isLate ? 'yes' : 'no'],
        ],
        summary: i.summaryText,
        items,
        findings: i.findings.map((f) => ({ severity: f.severity, title: f.description.slice(0, 160), status: f.status })),
      }),
      `inspection ${i.id}`
    );
  }

  // 4. Audit ledger with a chain verification.
  const entries = await prisma.auditLog.findMany({ where: { projectId }, orderBy: { seq: 'asc' } });
  const chain = verifyAuditChain(entries);
  const header = ['seq', 'createdAt', 'actorType', 'actorId', 'actorDisplayName', 'action', 'summaryText', 'payload', 'previousHash', 'entryHash'];
  const lines = [header.join(',')];
  for (const e of entries) {
    lines.push(
      [Number(e.seq), e.createdAt.toISOString(), e.actorType, e.actorId, e.actorDisplayName, e.action, e.summaryText, e.payload, e.previousHash, e.entryHash]
        .map(csvCell)
        .join(',')
    );
  }
  add('audit/audit-ledger.csv', Buffer.from(lines.join('\r\n') + '\r\n', 'utf8'), 'audit ledger');
  const verification = {
    verifiedAt: new Date().toISOString(),
    chainIntegrityVerified: chain.chainIntegrityVerified,
    brokenAtEntryId: chain.brokenAtEntryId,
    totalEntries: chain.totalEntries,
    latestHash: chain.latestHash,
    method: 'Each entry hash is SHA-256 over the previous hash and the canonical entry; seq runs 1..n without gaps.',
  };
  add('audit/chain-verification.json', Buffer.from(JSON.stringify(verification, null, 2), 'utf8'), 'audit ledger');

  // 5. Index PDF (after the rest, so it can list the contents) and the manifest.
  const [milestones, defects, findingsOpen, ratings, coc] = await Promise.all([
    prisma.projectContractMilestone.findMany({ where: { projectId }, orderBy: [{ sortOrder: 'asc' }] }),
    prisma.retentionDefectTicket.groupBy({ by: ['status'], where: { projectId }, _count: true }),
    prisma.inspectionFinding.count({ where: { projectId, status: { not: 'RESOLVED' } } }).catch(() => 0),
    prisma.contractorPerformanceRating.findMany({ where: { projectId }, select: { overallScore: true } }),
    prisma.completionCertificate.findFirst({ where: { projectId, status: 'ISSUED' } }),
  ]);
  const phaseEvents = entries
    .filter((e) => ['PROJECT_ACTIVATED', 'PROJECT_PHASE_CHANGED', 'KICKOFF_HELD', 'COC_ISSUED', 'COC_REVOKED', 'HANDOVER_CERTIFICATE_ISSUED', 'PROJECT_ARCHIVED'].includes(e.action))
    .map((e) => ({ date: day(e.createdAt), event: e.summaryText }));
  const milestoneEvents = milestones.map((m) => ({
    date: m.completedAt ? day(m.completedAt) : m.dueDate ?? '—',
    event: `Milestone "${m.label}"${m.projectContractorId ? ' (contractor)' : ''}: ${m.status.toLowerCase()}${m.dueDate ? `, due ${m.dueDate}` : ''}`,
  }));
  const timeline = [...phaseEvents, ...milestoneEvents].sort((a, b) => a.date.localeCompare(b.date));
  const payments = paymentRows.map((r) => ({
    label: `${PAYMENT_KIND_LABELS[r.kind]} ${r.reference} of ${r.paidOn}${r.voidedAt ? ' (void)' : ''}`,
    detail: `Gross ${money(r.grossAmountNgn, currency)}; retention held ${money(r.retentionHeldNgn, currency)}; net ${money(r.netAmountNgn, currency)}.`,
  }));
  const defectCount = (s: string[]) => defects.filter((d) => s.includes(d.status)).reduce((n, d) => n + d._count, 0);
  const avgRating = ratings.length ? (ratings.reduce((n, r) => n + Number(r.overallScore), 0) / ratings.length).toFixed(2) : null;
  const contents = [
    { path: 'index.pdf', description: 'This index.' },
    { path: 'manifest.json', description: 'Every file with its SHA-256, and files left out with the reason.' },
    { path: 'certificates/', description: 'Certificate of Completion and handover certificate.' },
    { path: 'documents/<type>/', description: 'Current version of every document in the register.' },
    { path: 'payments/payment-record.csv', description: 'Every recorded payment, voided ones included.' },
    { path: 'inspections/', description: 'One summary per site inspection.' },
    { path: 'audit/audit-ledger.csv', description: 'The project audit ledger with entry hashes.' },
    { path: 'audit/chain-verification.json', description: 'Result of the hash chain verification.' },
  ];
  const index = await generateClosureIndexPdf({
    branding,
    project: [
      ['Project', `[${project.codePrefix}] ${project.name}`],
      ['Project type', project.projectType?.name ?? null],
      ['Region', project.region?.name ?? null],
      ['Location', [project.lgaLocation, project.stateLocation].filter(Boolean).join(', ') || null],
      ['Status', `${project.status.toLowerCase()} · ${CONSTRUCTION_PHASE_LABELS[project.constructionPhase]}`],
      ['Contract reference', project.contractReference],
      ['Contract sum', money(project.contractSumNgn, currency)],
      ['Budget', money(project.totalBudgetNgn, currency)],
      ['Certificate of Completion', coc ? `${coc.certificateNumber}, issued ${day(coc.issuedAt)}, completion ${coc.completionDate}` : 'None issued'],
      ['Practical completion', project.practicalCompletionDate],
    ],
    parties: [
      ['Owning organisation', project.owningOrganization?.name ?? null],
      [resolveTerm(terms, 'funderParty'), project.lenderOrganization?.name ?? null],
      [resolveTerm(terms, 'monitorParty'), project.monitorOrganization?.name ?? null],
      ['Beneficiary', project.beneficiaries.find((b) => b.isPrimary)?.name ?? project.beneficiaries[0]?.name ?? null],
      [
        resolveTerm(terms, 'contractor'),
        project.contractors.map((c) => `${c.organization.name} (${c.tradeCode}${c.contractStatus === 'TERMINATED' ? ', terminated' : ''})`).join('; ') || null,
      ],
    ],
    timeline,
    payments,
    retention: [
      ['Retention percentage', project.retentionPercentage !== null ? `${Number(project.retentionPercentage)}%` : '—'],
      ['Held', money(project.retentionHeldNgn, currency)],
      ['Released', money(project.retentionReleasedNgn, currency)],
      ['Liability period', project.retentionStartDate ? `${project.retentionStartDate} to ${project.retentionEndDate ?? '—'}` : '—'],
    ],
    kpis: [
      ['Progress', `${Number(project.certifiedProgressPct)}%`],
      ['Paid to date (net of retention)', money(project.disbursedToDateNgn, currency)],
      ['Schedule', project.scheduleStatus ? SCHEDULE_STATUS_META[project.scheduleStatus as ScheduleStatusValue]?.label ?? project.scheduleStatus : '—'],
      ['Contract milestones done', `${milestones.filter((m) => m.status === 'DONE' || m.status === 'WAIVED').length} of ${milestones.length}`],
      ['Site inspections', String(inspections.length)],
      ['Open inspection findings', String(findingsOpen)],
      ['Defects closed / open', `${defectCount(['VERIFIED_CLOSED', 'REJECTED_NOT_A_DEFECT'])} / ${defectCount(['OPEN', 'ASSIGNED', 'RECTIFIED_PENDING_VERIFICATION'])}`],
      ['Average contractor rating', avgRating ? `${avgRating} of 5 (${ratings.length} rating(s))` : '—'],
    ],
    contents,
    chain: { verified: chain.chainIntegrityVerified, totalEntries: chain.totalEntries, latestHash: chain.latestHash, brokenAtEntryId: chain.brokenAtEntryId },
  });
  add('index.pdf', index, 'generated index');
  const manifestBody = {
    project: { id: project.id, code: project.codePrefix, name: project.name },
    generatedAt: new Date().toISOString(),
    chain: verification,
    entries: manifest,
  };
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifestBody, null, 2), 'utf8'));
  return {
    chainVerified: chain.chainIntegrityVerified,
    auditEntries: chain.totalEntries,
    latestHash: chain.latestHash,
    skipped: manifest.filter((m) => m.sha256 === null).length,
  };
}

/** Recovery for the job: exports left queued (e.g. after a restart) run; stuck ones fail. */
export async function sweepClosurePacks(now: Date = new Date()): Promise<string> {
  const stale = await prisma.closurePackExport.updateMany({
    where: { status: 'RUNNING', startedAt: { lt: new Date(now.getTime() - 30 * 60_000) } },
    data: { status: 'FAILED', error: 'The export did not finish (the server may have restarted). Request it again.', finishedAt: now },
  });
  const queued = await prisma.closurePackExport.findMany({
    where: { status: 'QUEUED', createdAt: { lt: new Date(now.getTime() - 60_000) } },
    select: { id: true },
    take: 5,
  });
  for (const q of queued) await runClosurePackExport(q.id);
  return `${queued.length} run, ${stale.count} failed as stuck`;
}
