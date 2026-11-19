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

export interface MobilizationReminderData {
  fullName: string;
  projectName: string;
  projectCode: string;
  roleName: string;
  plannedMobilizationDate: string;
  daysBefore: number;
  /** Join-code roles only: the current code for this role (and contractor). Sensitive. */
  joinCode?: string | null;
  /** Provisioned roles: they sign in with their account. */
  signInWithAccount: boolean;
  pendingAssurance: boolean;
}

function whenText(daysBefore: number, date: string): string {
  if (daysBefore === 0) return `today (${date})`;
  if (daysBefore === 1) return `tomorrow (${date})`;
  return `in ${daysBefore} days (${date})`;
}

export function mobilizationReminder(ctx: TemplateContext, d: MobilizationReminderData): RenderedMessage {
  const when = whenText(d.daysBefore, d.plannedMobilizationDate);
  const subject = `${d.projectCode}: you are expected on site ${when}`;
  const steps: string[] = [];
  if (d.signInWithAccount) {
    steps.push('Install the InSite Assurance app and sign in with your account. The project will already be listed.');
  } else if (d.joinCode) {
    steps.push(`Install the InSite Assurance app and join the project with this code: ${d.joinCode}`);
    steps.push('Keep this code to yourself. It is tied to your role on this project.');
  } else {
    steps.push('Install the InSite Assurance app. Ask the project team for your join code.');
  }
  if (d.pendingAssurance) steps.push('Your identity check is still being reviewed. Make sure your ID and selfies are submitted.');
  steps.push('On the day, open the app on site and tap "Check in on site".');

  const text = [
    `Hello ${d.fullName},`,
    '',
    `You are expected on ${d.projectName} (${d.projectCode}) as ${d.roleName} ${when}.`,
    '',
    ...steps.map((s) => `- ${s}`),
    '',
    `${ctx.tenantName}`,
  ].join('\n');
  const html = layout(ctx, `You are expected on site ${when}`, [
    `Hello ${esc(d.fullName)},`,
    `You are expected on <strong>${esc(d.projectName)}</strong> (${esc(d.projectCode)}) as ${esc(d.roleName)} ${esc(when)}.`,
    `<ul style="padding-left:18px;margin:0">${steps.map((s) => `<li style="margin-bottom:6px">${esc(s)}</li>`).join('')}</ul>`,
  ]);
  return {
    subject,
    text,
    html,
    // Never put a join code on a lock screen.
    pushBody: `You are expected on ${d.projectName} ${when}. Open the app to get set up.`,
  };
}

// ---------------------------------------------------------------------------
// Phase 10: stakeholder handover. Plain language, no jargon about tranches or IPCs.
// ---------------------------------------------------------------------------

export interface HandoverLinkData {
  recipientName: string;
  projectName: string;
  /** Sensitive: the link is the credential (with the code when one is required). */
  handoverUrl: string;
  expiresOn: string;
  requiresCode: boolean;
}

export function handoverLink(ctx: TemplateContext, d: HandoverLinkData): RenderedMessage {
  const subject = `${d.projectName}: please review the completed works`;
  const steps = [
    'Open the link below on your phone or computer.',
    ...(d.requiresCode ? ['We will email you a 6-digit code to confirm it is you.'] : []),
    'Tell us whether you accept the works, accept them with problems that need fixing, or do not accept them. You can add photos.',
  ];
  const text = [
    `Hello ${d.recipientName},`,
    '',
    `The works on ${d.projectName} are ready to be handed over, and we would like your view.`,
    '',
    ...steps.map((s) => `- ${s}`),
    '',
    d.handoverUrl,
    '',
    `The link works until ${d.expiresOn}. Do not forward it: it is for you only.`,
    '',
    ctx.tenantName,
  ].join('\n');
  const html = layout(ctx, 'Please review the completed works', [
    `Hello ${esc(d.recipientName)},`,
    `The works on <strong>${esc(d.projectName)}</strong> are ready to be handed over, and we would like your view.`,
    `<ul style="padding-left:18px;margin:0">${steps.map((s) => `<li style="margin-bottom:6px">${esc(s)}</li>`).join('')}</ul>`,
    `<a href="${esc(d.handoverUrl)}" style="display:inline-block;background:${esc(ctx.brandColor)};color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">Review the works</a>`,
    `The link works until ${esc(d.expiresOn)}. Do not forward it: it is for you only.`,
  ]);
  return { subject, text, html, pushBody: `Please review the completed works on ${d.projectName}.` };
}

export interface HandoverCodeData {
  recipientName: string;
  projectName: string;
  /** Sensitive. */
  oneTimeCode: string;
  validMinutes: number;
}

export function handoverCode(ctx: TemplateContext, d: HandoverCodeData): RenderedMessage {
  const subject = `Your code for ${d.projectName}: ${d.oneTimeCode}`;
  const text = [
    `Hello ${d.recipientName},`,
    '',
    `Your code is ${d.oneTimeCode}. It works for ${d.validMinutes} minutes.`,
    '',
    'If you did not ask for this code, you can ignore this email.',
    '',
    ctx.tenantName,
  ].join('\n');
  const html = layout(ctx, 'Your one-time code', [
    `Hello ${esc(d.recipientName)},`,
    `Your code for <strong>${esc(d.projectName)}</strong> is <strong style="font-size:20px;letter-spacing:3px">${esc(d.oneTimeCode)}</strong>. It works for ${esc(d.validMinutes)} minutes.`,
    'If you did not ask for this code, you can ignore this email.',
  ]);
  return { subject, text, html, pushBody: 'Your one-time code has arrived.' };
}

export const TEMPLATES = {
  MOBILIZATION_REMINDER: mobilizationReminder,
  HANDOVER_LINK: handoverLink,
  HANDOVER_CODE: handoverCode,
} as const;

export type TemplateKey = keyof typeof TEMPLATES;
export type TemplateData<K extends TemplateKey> = Parameters<(typeof TEMPLATES)[K]>[1];

export function renderTemplate<K extends TemplateKey>(key: K, ctx: TemplateContext, data: TemplateData<K>): RenderedMessage {
  return (TEMPLATES[key] as (c: TemplateContext, d: TemplateData<K>) => RenderedMessage)(ctx, data);
}
