import type { FindingsSummaryEmailData } from '@insite/shared';

/**
 * Message templates as plain functions (Phase 8 Step 4). No template editor. Each gets the tenant
 * name and branding colour; values from people (names, project names) are escaped for HTML.
 */

export interface RenderedMessage {
  subject: string;
  text: string;
  html: string;
  /** Short body for push; defaults to `text`. */
  pushBody?: string;
}

export interface TemplateContext {
  tenantName: string;
  brandColor: string;
}

/** A label inside a sentence: only the first letter is lowered ("Quarterly M&E …" keeps "M&E"). */
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(ctx: TemplateContext, title: string, paragraphs: string[]): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 12px">${p}</p>`).join('');
  return (
    `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1f2937">` +
    `<div style="border-top:4px solid ${esc(ctx.brandColor)};padding:16px 0 8px;font-weight:bold">${esc(ctx.tenantName)}</div>` +
    `<h2 style="font-size:18px;margin:8px 0 16px">${esc(title)}</h2>${body}` +
    `<p style="margin:24px 0 0;font-size:12px;color:#6b7280">Sent by ${esc(ctx.tenantName)}.</p></div>`
  );
}

// ---------------------------------------------------------------------------
// Phase 10: stakeholder handover. Plain language, no jargon about tranches or IPCs.
// ---------------------------------------------------------------------------

export interface KickoffNoticeData {
  recipientName: string;
  projectName: string;
  projectCode: string;
  /** "Tuesday 3 March 2026, 10:00 (Africa/Lagos)" */
  whenText: string;
  location: string | null;
  virtualLink: string | null;
  agendaTitle: string | null;
  /** Account holders: link to the project's documents. Others: null (pack available on request). */
  documentsUrl: string | null;
}

export function kickoffNotice(ctx: TemplateContext, d: KickoffNoticeData): RenderedMessage {
  const subject = `${d.projectCode}: kick-off meeting on ${d.whenText}`;
  const where = [d.location, d.virtualLink ? `Online: ${d.virtualLink}` : null].filter(Boolean).join(' · ') || 'To be confirmed';
  const pack = d.agendaTitle
    ? d.documentsUrl
      ? `The briefing pack ("${d.agendaTitle}") is in the project documents: ${d.documentsUrl}`
      : `The briefing pack ("${d.agendaTitle}") is available from the project team on request.`
    : null;
  const text = [
    `Hello ${d.recipientName},`,
    '',
    `You are invited to the kick-off meeting for ${d.projectName} (${d.projectCode}).`,
    '',
    `When: ${d.whenText}`,
    `Where: ${where}`,
    ...(pack ? ['', pack] : []),
    '',
    ctx.tenantName,
  ].join('\n');
  const html = layout(ctx, 'Kick-off meeting', [
    `Hello ${esc(d.recipientName)},`,
    `You are invited to the kick-off meeting for <strong>${esc(d.projectName)}</strong> (${esc(d.projectCode)}).`,
    `<strong>When:</strong> ${esc(d.whenText)}<br/><strong>Where:</strong> ${esc(where)}`,
    ...(pack ? [esc(pack)] : []),
  ]);
  return { subject, text, html, pushBody: `Kick-off meeting for ${d.projectName} on ${d.whenText}.` };
}

/** Phase 13: asks an attendee with an account to sign off the kick-off minutes. */
export interface MinutesSignOffData {
  recipientName: string;
  projectName: string;
  projectCode: string;
  minutesTitle: string;
  documentsUrl: string;
}

export function minutesSignOff(ctx: TemplateContext, d: MinutesSignOffData): RenderedMessage {
  const subject = `${d.projectCode}: please sign off the kick-off meeting minutes`;
  const text = [
    `Hello ${d.recipientName},`,
    '',
    `The minutes of the ${d.projectName} kick-off meeting ("${d.minutesTitle}") are ready. Please read and sign them off:`,
    d.documentsUrl,
    '',
    ctx.tenantName,
  ].join('\n');
  const html = layout(ctx, 'Please sign off the kick-off meeting minutes', [
    `Hello ${esc(d.recipientName)},`,
    `The minutes of the <strong>${esc(d.projectName)}</strong> kick-off meeting ("${esc(d.minutesTitle)}") are ready. Please read and sign them off.`,
    `<a href="${esc(d.documentsUrl)}" style="display:inline-block;background:${esc(ctx.brandColor)};color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">Open the minutes</a>`,
  ]);
  return { subject, text, html, pushBody: `Please sign off the ${d.projectName} kick-off meeting minutes.` };
}

// ---------------------------------------------------------------------------
// Redesign R4d (D-R4.29): open findings summary to the contractor after each accepted monitoring visit. No
// internal comments and no photos (there is no public link to them).
// ---------------------------------------------------------------------------

export function findingsSummary(ctx: TemplateContext, d: FindingsSummaryEmailData): RenderedMessage {
  const subject = `${d.projectCode}: findings after the ${lowerFirst(d.visitLabel)} of ${d.visitDate}`;
  const where = (f: { facility: string | null; unit: string | null }) => [f.facility, f.unit].filter(Boolean).join(', ') || 'Project';
  const openLines = d.open.map(
    (f) => `${where(f)}: ${f.title} (${f.severity.toLowerCase()}, raised ${f.raisedDate}${f.timesRechecked ? `, ${f.timesRechecked} follow-up check(s)` : ''}). ${f.description}`
  );
  const resolvedLines = d.resolved.map((f) => `${where(f)}: ${f.title}`);
  const intro = `The monitoring team visited ${d.projectName} (${d.projectCode}) on ${d.visitDate} (${lowerFirst(d.visitLabel)}).`;
  const text = [
    intro,
    '',
    d.open.length ? `Open findings to correct (${d.open.length}):` : 'There are no open findings.',
    ...openLines.map((l) => `- ${l}`),
    ...(d.resolved.length ? ['', `Rectified on this monitoring visit (${d.resolved.length}):`, ...resolvedLines.map((l) => `- ${l}`)] : []),
    '',
    'The next monitoring visits will check the open findings again.',
  ].join('\n');
  const list = (lines: string[]) => `<ul style="margin:0;padding-left:20px">${lines.map((l) => `<li style="margin:0 0 6px">${esc(l)}</li>`).join('')}</ul>`;
  const html = layout(ctx, subject, [
    esc(intro),
    d.open.length ? `<strong>Open findings to correct (${d.open.length})</strong>${list(openLines)}` : 'There are no open findings.',
    ...(d.resolved.length ? [`<strong>Rectified on this monitoring visit (${d.resolved.length})</strong>${list(resolvedLines)}`] : []),
    'The next monitoring visits will check the open findings again.',
  ]);
  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// Needs pipeline wave 3 (A7, D-N.24): work reaches people through the task queue and email. One email
// per person per event, listing the proposed projects it concerns.
// ---------------------------------------------------------------------------

export interface NeedsTaskNoticeData {
  kind: 'RETURNED' | 'WAITING' | 'DUE_SOON' | 'OVERDUE';
  recipientName: string;
  /** "Direct Intervention 2027" or "Matching Grants 2027, Kano". */
  cycleLabel: string;
  /** The stage the notice is about ("Validation", "Costing"). */
  stageLabel: string;
  proposals: Array<{ reference: string; title: string }>;
  /** RETURNED: why. */
  reason: string | null;
  /** DUE_SOON / OVERDUE: the stage deadline ("31 Jul 2026"). */
  dueDate: string | null;
  url: string;
}

export function needsTaskNotice(ctx: TemplateContext, d: NeedsTaskNoticeData): RenderedMessage {
  const n = d.proposals.length;
  const projects = `${n} proposed project${n === 1 ? '' : 's'}`;
  const stage = lowerFirst(d.stageLabel);
  const subject =
    d.kind === 'RETURNED'
      ? `${d.cycleLabel}: ${projects} returned to you for correction`
      : d.kind === 'WAITING'
        ? `${d.cycleLabel}: ${projects} waiting for ${stage}`
        : d.kind === 'DUE_SOON'
          ? `${d.cycleLabel}: ${d.stageLabel} closes on ${d.dueDate}`
          : `${d.cycleLabel}: the ${stage} deadline (${d.dueDate}) has passed`;
  const intro =
    d.kind === 'RETURNED'
      ? `These proposed projects were returned at ${stage}. Correct them and resubmit.`
      : d.kind === 'WAITING'
        ? `These proposed projects are waiting for ${stage}.`
        : d.kind === 'DUE_SOON'
          ? `The ${stage} deadline is ${d.dueDate}.${n ? ' These proposed projects are still open at this stage or earlier:' : ''}`
          : `The ${stage} deadline was ${d.dueDate}. These proposed projects are still open at this stage or earlier:`;
  const lines = d.proposals.map((p) => `${p.reference}: ${p.title}`);
  const text = [
    `Hello ${d.recipientName},`,
    '',
    intro,
    ...lines.map((l) => `- ${l}`),
    ...(d.reason ? ['', `Reason: ${d.reason}`] : []),
    '',
    d.url,
    '',
    ctx.tenantName,
  ].join('\n');
  const html = layout(ctx, subject, [
    `Hello ${esc(d.recipientName)},`,
    esc(intro),
    ...(lines.length ? [`<ul style="margin:0;padding-left:20px">${lines.map((l) => `<li style="margin:0 0 6px">${esc(l)}</li>`).join('')}</ul>`] : []),
    ...(d.reason ? [`<strong>Reason:</strong> ${esc(d.reason)}`] : []),
    `<a href="${esc(d.url)}" style="display:inline-block;background:${esc(ctx.brandColor)};color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">Open the needs assessment</a>`,
  ]);
  return { subject, text, html };
}

export const TEMPLATES = {
  // Phase 13
  KICKOFF_NOTICE: kickoffNotice,
  MINUTES_SIGN_OFF: minutesSignOff,
  // Redesign R4d
  FINDINGS_SUMMARY: findingsSummary,
  // Needs pipeline wave 3
  NEEDS_TASK_NOTICE: needsTaskNotice,
} as const;

export type TemplateKey = keyof typeof TEMPLATES;
export type TemplateData<K extends TemplateKey> = Parameters<(typeof TEMPLATES)[K]>[1];

export function renderTemplate<K extends TemplateKey>(key: K, ctx: TemplateContext, data: TemplateData<K>): RenderedMessage {
  return (TEMPLATES[key] as (c: TemplateContext, d: TemplateData<K>) => RenderedMessage)(ctx, data);
}
