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
    `<p style="margin:24px 0 0;font-size:12px;color:#6b7280">Sent by ${esc(ctx.tenantName)} through InSite Assurance.</p></div>`
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
  const subject = `${d.projectCode}: please sign off the kick-off minutes`;
  const text = [
    `Hello ${d.recipientName},`,
    '',
    `The minutes of the ${d.projectName} kick-off meeting ("${d.minutesTitle}") are ready. Please read and sign them off:`,
    d.documentsUrl,
    '',
    ctx.tenantName,
  ].join('\n');
  const html = layout(ctx, 'Please sign off the kick-off minutes', [
    `Hello ${esc(d.recipientName)},`,
    `The minutes of the <strong>${esc(d.projectName)}</strong> kick-off meeting ("${esc(d.minutesTitle)}") are ready. Please read and sign them off.`,
    `<a href="${esc(d.documentsUrl)}" style="display:inline-block;background:${esc(ctx.brandColor)};color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">Open the minutes</a>`,
  ]);
  return { subject, text, html, pushBody: `Please sign off the ${d.projectName} kick-off minutes.` };
}

export const TEMPLATES = {
  // Phase 13
  KICKOFF_NOTICE: kickoffNotice,
  MINUTES_SIGN_OFF: minutesSignOff,
} as const;

export type TemplateKey = keyof typeof TEMPLATES;
export type TemplateData<K extends TemplateKey> = Parameters<(typeof TEMPLATES)[K]>[1];

export function renderTemplate<K extends TemplateKey>(key: K, ctx: TemplateContext, data: TemplateData<K>): RenderedMessage {
  return (TEMPLATES[key] as (c: TemplateContext, d: TemplateData<K>) => RenderedMessage)(ctx, data);
}
