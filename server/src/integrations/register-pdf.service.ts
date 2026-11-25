import PDFDocument from 'pdfkit';
import { formatDateTimeInZone } from '@insite/shared';
import type { PdfBranding } from './closure-pdf.service';

/**
 * UBEC IRL: the project register as a landscape A4 table with the tenant's PDF header (as the
 * closure PDFs render it). Amounts print with the currency code because the PDF font has no ₦ glyph.
 */

type Doc = InstanceType<typeof PDFDocument>;

export interface RegisterPdfColumn {
  header: string;
  /** Relative width (columns share the page width in proportion). */
  weight: number;
  align?: 'left' | 'right' | 'center';
}

export interface RegisterPdfInput {
  branding: PdfBranding;
  heading: string;
  /** Under the heading: filters applied, counts. */
  subtitle: string;
  columns: RegisterPdfColumn[];
  rows: string[][];
  footnote?: string;
}

const MARGIN = 36;
const FONT_SIZE = 7;
const HEADER_FONT_SIZE = 7;
const CELL_PAD = 3;

export function generateRegisterPdf(input: RegisterPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: MARGIN,
      info: { Title: input.heading, Author: input.branding.tenantName },
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      draw(doc, input);
      // Page numbers.
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const bottom = doc.page.height - MARGIN + 10;
        doc.fontSize(7).fillColor('#94a3b8').text(`Page ${i + 1} of ${range.count}`, MARGIN, bottom, {
          width: doc.page.width - 2 * MARGIN,
          align: 'right',
          lineBreak: false,
        });
      }
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function draw(doc: Doc, input: RegisterPdfInput) {
  const b = input.branding;
  const pageWidth = doc.page.width - 2 * MARGIN;
  const brand = b.primaryColorHex || '#0f172a';

  doc.fontSize(9).fillColor('#475569').text(b.headerTitle || b.tenantName, MARGIN, MARGIN, { align: 'left' });
  doc.moveDown(0.4);
  doc.fontSize(16).fillColor(brand).text(input.heading);
  doc.moveDown(0.2);
  doc.fontSize(8).fillColor('#64748b').text(`Generated ${formatDateTimeInZone(new Date(), b.timeZone)}`);
  if (input.subtitle) doc.fontSize(8).fillColor('#334155').text(input.subtitle);
  doc.moveDown(0.5);

  const totalWeight = input.columns.reduce((s, c) => s + c.weight, 0);
  const widths = input.columns.map((c) => (c.weight / totalWeight) * pageWidth);
  const bottomLimit = () => doc.page.height - MARGIN - 14;

  const rowHeight = (cells: string[], size: number, bold: boolean) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
    return Math.max(...cells.map((t, i) => doc.heightOfString(t || ' ', { width: widths[i] - 2 * CELL_PAD }))) + 2 * CELL_PAD;
  };

  const drawRow = (cells: string[], y: number, opts: { header?: boolean; band?: boolean }) => {
    const size = opts.header ? HEADER_FONT_SIZE : FONT_SIZE;
    const h = rowHeight(cells, size, Boolean(opts.header));
    if (opts.header) doc.rect(MARGIN, y, pageWidth, h).fill(brand);
    else if (opts.band) doc.rect(MARGIN, y, pageWidth, h).fill('#eef6f3');
    let x = MARGIN;
    cells.forEach((t, i) => {
      doc
        .font(opts.header ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(size)
        .fillColor(opts.header ? '#ffffff' : '#0f172a')
        .text(t || (opts.header ? '' : '–'), x + CELL_PAD, y + CELL_PAD, { width: widths[i] - 2 * CELL_PAD, align: input.columns[i].align ?? 'left' });
      x += widths[i];
    });
    doc.moveTo(MARGIN, y + h).lineTo(MARGIN + pageWidth, y + h).lineWidth(0.4).strokeColor('#c5d9d2').stroke();
    return h;
  };

  const headers = input.columns.map((c) => c.header);
  let y = doc.y;
  y += drawRow(headers, y, { header: true });
  if (input.rows.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#64748b').text('No projects match these filters.', MARGIN + CELL_PAD, y + 6);
    y = doc.y;
  }
  input.rows.forEach((cells, i) => {
    const h = rowHeight(cells, FONT_SIZE, false);
    if (y + h > bottomLimit()) {
      doc.addPage();
      y = MARGIN;
      y += drawRow(headers, y, { header: true });
    }
    y += drawRow(cells, y, { band: i % 2 === 1 });
  });

  doc.y = y + 8;
  doc.x = MARGIN;
  if (input.footnote) doc.font('Helvetica').fontSize(7).fillColor('#64748b').text(input.footnote, MARGIN, doc.y, { width: pageWidth });
  if (b.footerDisclaimer) {
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(7).fillColor('#94a3b8').text(b.footerDisclaimer, MARGIN, doc.y, { width: pageWidth });
  }
}
