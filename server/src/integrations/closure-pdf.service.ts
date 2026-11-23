import PDFDocument from 'pdfkit';
import { formatDateTimeInZone } from '@insite/shared';

/**
 * Phase 15 PDFs: the Certificate of Completion, the handover certificate, and the closure pack's
 * index and inspection summaries. Tenant-branded like the valuation report. Amounts print with the
 * currency code because the PDF font has no ₦ glyph.
 */

export interface PdfBranding {
  tenantName: string;
  headerTitle?: string;
  footerDisclaimer?: string;
  primaryColorHex?: string;
  timeZone: string;
}

type Doc = InstanceType<typeof PDFDocument>;

function render(title: string, author: string, draw: (doc: Doc) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: title, Author: author } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      draw(doc);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function header(doc: Doc, b: PdfBranding, heading: string) {
  doc.fontSize(9).fillColor('#475569').text(b.headerTitle || b.tenantName, { align: 'left' });
  doc.moveDown(0.6);
  doc.fontSize(18).fillColor(b.primaryColorHex || '#0f172a').text(heading, { align: 'left' });
  doc.moveDown(0.3);
  doc.fontSize(8.5).fillColor('#64748b').text(`Generated ${formatDateTimeInZone(new Date(), b.timeZone)}`);
  doc.moveDown(0.6);
  rule(doc);
}

function rule(doc: Doc) {
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cbd5e1').stroke();
  doc.moveDown(0.6);
}

function section(doc: Doc, title: string) {
  doc.moveDown(0.4);
  doc.fontSize(11.5).fillColor('#0f172a').text(title, { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(9.5).fillColor('#334155');
}

function line(doc: Doc, label: string, value: string | null | undefined) {
  doc.fontSize(9.5).fillColor('#64748b').text(`${label}: `, { continued: true }).fillColor('#0f172a').text(value && value.length ? value : '—');
}

function footer(doc: Doc, b: PdfBranding) {
  if (!b.footerDisclaimer) return;
  doc.moveDown(1);
  doc.fontSize(7.5).fillColor('#94a3b8').text(b.footerDisclaimer, { align: 'left' });
}

// ---------------------------------------------------------------------------
// Certificate of Completion
// ---------------------------------------------------------------------------

export interface CompletionCertificatePdfInput {
  branding: PdfBranding;
  /** False renders a DRAFT watermark line and "awaiting" slots. */
  issued: boolean;
  certificateNumber: string;
  status: string;
  project: { code: string; name: string; location: string | null; contractReference: string | null };
  parties: Array<{ label: string; name: string | null }>;
  beneficiaryName: string | null;
  contractors: string[];
  completionDate: string;
  scopeSummary: string;
  finalEvaluation: string | null;
  issuedAtIso: string | null;
  slots: Array<{
    label: string;
    signed: {
      name: string;
      roleName: string | null;
      organizationName: string | null;
      registration: string | null;
      signedAtIso: string;
      statement: string;
      statementHash: string;
      recordedBy: string | null;
    } | null;
  }>;
}

export function generateCompletionCertificatePdf(input: CompletionCertificatePdfInput): Promise<Buffer> {
  const b = input.branding;
  return render(`Certificate of Completion ${input.certificateNumber}`, b.tenantName, (doc) => {
    header(doc, b, 'Certificate of Completion');
    if (!input.issued) {
      doc.fontSize(10).fillColor('#b91c1c').text(`DRAFT (${input.status}): not issued. This copy is for signature only and certifies nothing until every signatory has signed.`);
      doc.moveDown(0.4);
    }
    line(doc, 'Certificate number', input.certificateNumber);
    line(doc, 'Project', `[${input.project.code}] ${input.project.name}`);
    line(doc, 'Location', input.project.location);
    line(doc, 'Contract reference', input.project.contractReference);
    for (const p of input.parties) line(doc, p.label, p.name);
    line(doc, 'Beneficiary institution', input.beneficiaryName);
    line(doc, input.contractors.length > 1 ? 'Contractors' : 'Contractor', input.contractors.join('; '));
    line(doc, 'Date of completion', input.completionDate);
    if (input.issuedAtIso) line(doc, 'Issued', formatDateTimeInZone(input.issuedAtIso, b.timeZone));

    section(doc, 'Scope of works completed');
    doc.text(input.scopeSummary, { align: 'justify' });
    if (input.finalEvaluation) {
      section(doc, 'Final evaluation');
      doc.text(input.finalEvaluation);
    }

    section(doc, 'Signatories');
    for (const slot of input.slots) {
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor('#0f172a').text(slot.label);
      if (!slot.signed) {
        doc.fontSize(9).fillColor('#94a3b8').text('Awaiting signature');
        doc.moveDown(0.6);
        doc.moveTo(50, doc.y).lineTo(300, doc.y).strokeColor('#cbd5e1').stroke();
        doc.moveDown(0.3);
        continue;
      }
      const s = slot.signed;
      doc.fontSize(9).fillColor('#334155');
      doc.text(`${s.name}${s.roleName ? `, ${s.roleName}` : ''}${s.organizationName ? ` (${s.organizationName})` : ''}`);
      if (s.registration) doc.text(`Professional registration: ${s.registration}`);
      doc.text(`Signed ${formatDateTimeInZone(s.signedAtIso, b.timeZone)}${s.recordedBy ? `; paper signature recorded by ${s.recordedBy}` : ''}`);
      doc.fontSize(8).fillColor('#64748b').text(`“${s.statement}”`);
      doc.fontSize(7).fillColor('#94a3b8').text(`Statement hash ${s.statementHash}`);
    }
    doc.moveDown(0.6);
    doc
      .fontSize(7.5)
      .fillColor('#94a3b8')
      .text('Signatures are authenticated acknowledgements recorded on the platform and in its hash-chained audit ledger; they are not qualified electronic signatures.');
    footer(doc, b);
  });
}

// ---------------------------------------------------------------------------
// Handover certificate
// ---------------------------------------------------------------------------

export interface HandoverCertificatePdfInput {
  branding: PdfBranding;
  project: { code: string; name: string; location: string | null };
  beneficiaryName: string | null;
  submitterName: string;
  submitterRole: string;
  decision: string;
  submittedAtIso: string;
  reviewedAtIso: string;
  reviewedByName: string;
  reviewNotes: string | null;
  snagCount: number;
  cocNumber: string | null;
  cocIssuedAtIso: string | null;
}

export function generateHandoverCertificatePdf(input: HandoverCertificatePdfInput): Promise<Buffer> {
  const b = input.branding;
  return render(`Handover certificate ${input.project.code}`, b.tenantName, (doc) => {
    header(doc, b, 'Handover Certificate');
    line(doc, 'Project', `[${input.project.code}] ${input.project.name}`);
    line(doc, 'Location', input.project.location);
    line(doc, 'Beneficiary institution', input.beneficiaryName);
    line(doc, 'Certificate of Completion', input.cocNumber ? `${input.cocNumber}${input.cocIssuedAtIso ? `, issued ${formatDateTimeInZone(input.cocIssuedAtIso, b.timeZone)}` : ''}` : 'None issued');
    section(doc, 'Acceptance');
    line(doc, 'Decision', input.decision);
    line(doc, 'Accepted by', `${input.submitterName} (${input.submitterRole})`);
    line(doc, 'Response received', formatDateTimeInZone(input.submittedAtIso, b.timeZone));
    line(doc, 'Snags recorded', String(input.snagCount));
    section(doc, 'Review');
    line(doc, 'Reviewed by', input.reviewedByName);
    line(doc, 'Reviewed', formatDateTimeInZone(input.reviewedAtIso, b.timeZone));
    if (input.reviewNotes) line(doc, 'Notes', input.reviewNotes);
    doc.moveDown(0.8);
    doc
      .fontSize(9)
      .fillColor('#334155')
      .text(
        input.snagCount > 0
          ? 'The works were handed over to the beneficiary with the snags listed in the response; these are tracked as defects during the liability period.'
          : 'The works were handed over to the beneficiary without recorded snags.'
      );
    footer(doc, b);
  });
}

// ---------------------------------------------------------------------------
// Closure pack: index and inspection summaries
// ---------------------------------------------------------------------------

export interface ClosureIndexPdfInput {
  branding: PdfBranding;
  project: Array<[string, string | null]>;
  parties: Array<[string, string | null]>;
  timeline: Array<{ date: string; event: string }>;
  payments: Array<{ label: string; detail: string }>;
  retention: Array<[string, string]>;
  kpis: Array<[string, string]>;
  contents: Array<{ path: string; description: string }>;
  chain: { verified: boolean; totalEntries: number; latestHash: string | null; brokenAtEntryId: string | null };
}

export function generateClosureIndexPdf(input: ClosureIndexPdfInput): Promise<Buffer> {
  const b = input.branding;
  return render('Closure pack index', b.tenantName, (doc) => {
    header(doc, b, 'Project Closure Pack');
    section(doc, '1. Project');
    for (const [k, v] of input.project) line(doc, k, v);
    section(doc, '2. Parties');
    for (const [k, v] of input.parties) line(doc, k, v);
    section(doc, '3. Timeline');
    if (input.timeline.length === 0) doc.text('No events recorded.');
    for (const t of input.timeline) doc.fontSize(9).fillColor('#334155').text(`${t.date}  ${t.event}`);
    section(doc, '4. Payments');
    if (input.payments.length === 0) doc.text('No payments recorded.');
    for (const p of input.payments) {
      doc.fontSize(9.5).fillColor('#0f172a').text(p.label);
      doc.fontSize(8.5).fillColor('#475569').text(p.detail);
    }
    section(doc, '5. Retention');
    for (const [k, v] of input.retention) line(doc, k, v);
    section(doc, '6. Key figures');
    for (const [k, v] of input.kpis) line(doc, k, v);
    section(doc, '7. Audit ledger');
    line(doc, 'Entries', String(input.chain.totalEntries));
    line(doc, 'Chain verification', input.chain.verified ? 'Verified: every entry links to the previous one and its hash recomputes.' : `FAILED at entry ${input.chain.brokenAtEntryId}`);
    line(doc, 'Latest hash', input.chain.latestHash);
    section(doc, '8. Contents');
    for (const c of input.contents) doc.fontSize(8.5).fillColor('#334155').text(`${c.path} — ${c.description}`);
    footer(doc, b);
  });
}

export interface InspectionSummaryPdfInput {
  branding: PdfBranding;
  projectLabel: string;
  title: string;
  fields: Array<[string, string | null]>;
  summary: string;
  items: Array<{ section: string; label: string; value: string; comment: string | null }>;
  findings: Array<{ severity: string; title: string; status: string }>;
}

export function generateInspectionSummaryPdf(input: InspectionSummaryPdfInput): Promise<Buffer> {
  const b = input.branding;
  return render(input.title, b.tenantName, (doc) => {
    header(doc, b, input.title);
    line(doc, 'Project', input.projectLabel);
    for (const [k, v] of input.fields) line(doc, k, v);
    section(doc, 'Summary');
    doc.text(input.summary || '—');
    section(doc, 'Checklist');
    let current = '';
    for (const item of input.items) {
      if (item.section !== current) {
        current = item.section;
        doc.moveDown(0.2).fontSize(9.5).fillColor('#0f172a').text(current);
      }
      doc.fontSize(8.5).fillColor('#334155').text(`• ${item.label}: ${item.value}${item.comment ? ` (${item.comment})` : ''}`);
    }
    section(doc, 'Findings');
    if (input.findings.length === 0) doc.text('None.');
    for (const f of input.findings) doc.fontSize(8.5).fillColor('#334155').text(`• [${f.severity}] ${f.title} — ${f.status}`);
    footer(doc, b);
  });
}
