/**
 * Text extraction for uploaded project documents (Phase 7 gap closure): plain text, PDF (unpdf)
 * and Word .docx (mammoth). Scanned PDFs and images have no text layer; they return
 * `NO_TEXT` and nothing is invented. Legacy .doc is not supported.
 */

export type ExtractionResult =
  | { status: 'OK'; text: string; engine: string }
  | { status: 'NO_TEXT'; reason: string }
  | { status: 'UNSUPPORTED'; reason: string };

/** Characters kept for the summary prompt. */
export const MAX_EXTRACTED_CHARS = 120_000;
/** Below this many non-space characters a document is treated as having no readable text. */
const MIN_TEXT_CHARS = 40;

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** unpdf is ESM-only; the server is CommonJS, so load it with a real dynamic import. */
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const importEsm = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<unknown>;

type UnpdfModule = {
  getDocumentProxy: (data: Uint8Array) => Promise<unknown>;
  extractText: (pdf: unknown, opts: { mergePages: true }) => Promise<{ totalPages: number; text: string }>;
};

function finish(text: string, engine: string): ExtractionResult {
  // NUL bytes (common in PDF text layers) removed without a control character in a regex.
  const clean = text.split(String.fromCharCode(0)).join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (clean.replace(/\s/g, '').length < MIN_TEXT_CHARS) {
    return { status: 'NO_TEXT', reason: 'The document has no readable text (it may be scanned or an image).' };
  }
  return { status: 'OK', text: clean.slice(0, MAX_EXTRACTED_CHARS), engine };
}

export async function extractDocumentText(bytes: Buffer, mimeType: string): Promise<ExtractionResult> {
  const mime = mimeType.toLowerCase();
  if (mime === 'text/plain') return finish(bytes.toString('utf8'), 'PLAIN_TEXT');
  if (mime === 'application/pdf') {
    const unpdf = (await importEsm('unpdf')) as UnpdfModule;
    const pdf = await unpdf.getDocumentProxy(new Uint8Array(bytes));
    const { text } = await unpdf.extractText(pdf, { mergePages: true });
    return finish(text, 'UNPDF');
  }
  if (mime === DOCX) {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ buffer: bytes });
    return finish(value, 'MAMMOTH_DOCX');
  }
  if (mime.startsWith('image/')) {
    return { status: 'NO_TEXT', reason: 'Images have no text layer; text recognition (OCR) is not available.' };
  }
  return { status: 'UNSUPPORTED', reason: `Text cannot be read from ${mimeType} files (save legacy .doc files as .docx).` };
}
