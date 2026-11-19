/**
 * Phase 10: stakeholder feedback text. Stored as plain text, never HTML. A small allow-list of
 * formatting is expressed in the text itself and rendered by our own code (no innerHTML):
 *
 * - a blank line separates paragraphs
 * - lines starting with "- " or "* " form a bulleted list; "1. " a numbered list
 * - **bold** and _italic_ (or *italic*) inside a line
 *
 * `sanitizeHandoverText` runs on the server before anything is stored: it removes anything that
 * looks like an HTML tag and control characters, so even a renderer that forgot to escape could
 * not be handed markup.
 */

export interface RichSpan {
  text: string;
  bold: boolean;
  italic: boolean;
}

export type RichBlock =
  | { type: 'paragraph'; lines: RichSpan[][] }
  | { type: 'bullets'; items: RichSpan[][] }
  | { type: 'numbers'; items: RichSpan[][] };

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const TAG_LIKE = /<\/?[A-Za-z!?][^<>]*>/g;

export function sanitizeHandoverText(input: string, maxLength = 8000): string {
  let text = String(input ?? '').replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '');
  // Repeat until stable so nested fragments such as "<scr<b>ipt>" cannot reassemble.
  for (let i = 0; i < 5; i += 1) {
    const next = text.replace(TAG_LIKE, '');
    if (next === text) break;
    text = next;
  }
  // Any angle bracket left over is plain punctuation; keep it but make it inert for HTML contexts.
  text = text.replace(/</g, '‹').replace(/>/g, '›');
  return text.replace(/\n{3,}/g, '\n\n').trim().slice(0, maxLength);
}

/** Single-line fields (names, titles, locations). */
export function sanitizeHandoverLine(input: string, maxLength = 200): string {
  return sanitizeHandoverText(input, maxLength * 2).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function parseInline(line: string): RichSpan[] {
  const spans: RichSpan[] = [];
  const re = /(\*\*[^*]+\*\*|_[^_]+_|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) spans.push({ text: line.slice(last, m.index), bold: false, italic: false });
    const token = m[0];
    if (token.startsWith('**')) spans.push({ text: token.slice(2, -2), bold: true, italic: false });
    else spans.push({ text: token.slice(1, -1), bold: false, italic: true });
    last = m.index + token.length;
  }
  if (last < line.length) spans.push({ text: line.slice(last), bold: false, italic: false });
  return spans.length ? spans : [{ text: '', bold: false, italic: false }];
}

export function parseHandoverRichText(text: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  for (const chunk of String(text ?? '').replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const lines = chunk.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;
    let current: RichBlock | null = null;
    for (const raw of lines) {
      const line = raw.trim();
      const bullet = /^[-*]\s+(.*)$/.exec(line);
      const number = /^\d+[.)]\s+(.*)$/.exec(line);
      const type: RichBlock['type'] = bullet ? 'bullets' : number ? 'numbers' : 'paragraph';
      const content = parseInline(bullet ? bullet[1] : number ? number[1] : line);
      if (!current || current.type !== type) {
        const created: RichBlock = type === 'paragraph' ? { type, lines: [] } : { type, items: [] };
        blocks.push(created);
        current = created;
      }
      const block: RichBlock = current;
      if (block.type === 'paragraph') block.lines.push(content);
      else block.items.push(content);
    }
  }
  return blocks;
}
