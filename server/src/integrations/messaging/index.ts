import { Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../config/prisma';
import { adapterFor, OutboundChannel, PermanentDeliveryError } from './adapters';
import { renderTemplate, TemplateData, TemplateKey } from './templates';

/**
 * Outbound messages (Phase 8 Step 4, D-8.1 default). `sendMessage` records an OutboundMessage and
 * hands it to the channel's adapter. Failed deliveries are retried with backoff by the
 * `message-dispatch` job. Nothing is sent for a project that is not live or a suspended tenant,
 * and per-tenant daily caps and per-recipient rate limits apply.
 */

export const MAX_DELIVERY_ATTEMPTS = 5;
/** Payload keys removed once a message is delivered (e.g. a join code). */
const SENSITIVE_PAYLOAD_KEYS = ['joinCode'];

export type SendOutcome =
  | { status: 'SENT' | 'QUEUED' | 'FAILED'; messageId: string }
  | { status: 'SKIPPED'; reason: 'PROJECT_NOT_LIVE' | 'TENANT_SUSPENDED' | 'NO_ADAPTER' };

function backoffMs(attempts: number): number {
  return Math.min(60 * 60 * 1000, 60_000 * 2 ** Math.max(0, attempts - 1));
}

export async function sendMessage<K extends TemplateKey>(params: {
  tenantId: string;
  projectId?: string | null;
  channel: OutboundChannel;
  to: string;
  templateKey: K;
  data: TemplateData<K>;
}): Promise<SendOutcome> {
  const tenant = await prisma.tenant.findUnique({ where: { id: params.tenantId }, select: { status: true } });
  if (!tenant || tenant.status === 'SUSPENDED') return { status: 'SKIPPED', reason: 'TENANT_SUSPENDED' };
  if (params.projectId) {
    const project = await prisma.project.findUnique({ where: { id: params.projectId }, select: { status: true } });
    if (!project || project.status !== 'ACTIVE') return { status: 'SKIPPED', reason: 'PROJECT_NOT_LIVE' };
  }
  if (!adapterFor(params.channel)) return { status: 'SKIPPED', reason: 'NO_ADAPTER' };

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [tenantCount, recipientCount] = await Promise.all([
    prisma.outboundMessage.count({ where: { tenantId: params.tenantId, createdAt: { gte: dayAgo }, status: { not: 'FAILED' } } }),
    prisma.outboundMessage.count({ where: { toAddress: params.to, createdAt: { gte: dayAgo }, status: { not: 'FAILED' } } }),
  ]);
  const limited =
    tenantCount >= env.MESSAGING_TENANT_DAILY_CAP
      ? 'TENANT_DAILY_CAP_REACHED'
      : recipientCount >= env.MESSAGING_RECIPIENT_DAILY_CAP
        ? 'RECIPIENT_RATE_LIMITED'
        : null;

  const row = await prisma.outboundMessage.create({
    data: {
      tenantId: params.tenantId,
      projectId: params.projectId ?? null,
      channel: params.channel,
      toAddress: params.to,
      templateKey: params.templateKey,
      payloadJson: params.data as unknown as Prisma.InputJsonValue,
      status: limited ? 'FAILED' : 'QUEUED',
      error: limited,
    },
  });
  if (limited) return { status: 'FAILED', messageId: row.id };
  const status = await deliverMessage(row.id);
  return { status, messageId: row.id };
}

/** Attempts delivery of one queued message. Returns its resulting status. */
export async function deliverMessage(messageId: string): Promise<'SENT' | 'QUEUED' | 'FAILED'> {
  const row = await prisma.outboundMessage.findUnique({
    where: { id: messageId },
    include: { tenant: { select: { name: true, brandingConfig: true, status: true } } },
  });
  if (!row || row.status !== 'QUEUED') return (row?.status as 'SENT' | 'FAILED') ?? 'FAILED';
  const adapter = adapterFor(row.channel);
  if (!adapter || row.tenant.status === 'SUSPENDED') {
    await prisma.outboundMessage.update({
      where: { id: row.id },
      data: { status: 'FAILED', error: adapter ? 'TENANT_SUSPENDED' : 'NO_ADAPTER' },
    });
    return 'FAILED';
  }
  const branding = (row.tenant.brandingConfig ?? {}) as { primaryColorHex?: string };
  const attempts = row.attempts + 1;
  try {
    const rendered = renderTemplate(
      row.templateKey as TemplateKey,
      { tenantName: row.tenant.name, brandColor: branding.primaryColorHex || '#1d4ed8' },
      row.payloadJson as never
    );
    const result = await adapter.send({ messageId: row.id, channel: row.channel, to: row.toAddress, rendered });
    const payload = { ...(row.payloadJson as Record<string, unknown>) };
    for (const key of SENSITIVE_PAYLOAD_KEYS) if (key in payload) payload[key] = '[redacted after delivery]';
    await prisma.outboundMessage.update({
      where: { id: row.id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        attempts,
        providerMessageId: result.providerMessageId,
        error: null,
        payloadJson: payload as Prisma.InputJsonValue,
      },
    });
    return 'SENT';
  } catch (error) {
    const permanent = error instanceof PermanentDeliveryError || attempts >= MAX_DELIVERY_ATTEMPTS;
    await prisma.outboundMessage.update({
      where: { id: row.id },
      data: {
        status: permanent ? 'FAILED' : 'QUEUED',
        attempts,
        nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
        error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
      },
    });
    return permanent ? 'FAILED' : 'QUEUED';
  }
}

/** message-dispatch job body: retries queued messages whose backoff has passed. */
export async function dispatchQueuedMessages(now: Date): Promise<number> {
  const due = await prisma.outboundMessage.findMany({
    where: { status: 'QUEUED', nextAttemptAt: { lte: now } },
    select: { id: true },
    orderBy: { nextAttemptAt: 'asc' },
    take: 100,
  });
  for (const m of due) await deliverMessage(m.id);
  return due.length;
}

export { consoleOutbox, setMessageAdapterOverrides } from './adapters';
