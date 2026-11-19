import { env } from '../../config/env';
import { sendPushToFieldSession, sendPushToMobileUser } from '../push.service';
import type { RenderedMessage } from './templates';

export type OutboundChannel = 'EMAIL' | 'SMS' | 'PUSH';

export interface DeliveryRequest {
  messageId: string;
  channel: OutboundChannel;
  to: string;
  rendered: RenderedMessage;
}

export interface DeliveryResult {
  providerMessageId: string | null;
}

/** A channel adapter. Throwing means "failed, may retry"; a PermanentDeliveryError is not retried. */
export interface MessageAdapter {
  readonly name: string;
  send(req: DeliveryRequest): Promise<DeliveryResult>;
}

export class PermanentDeliveryError extends Error {}

/** Development and tests: prints (outside tests) and keeps the last messages in memory. */
export const consoleOutbox: DeliveryRequest[] = [];

export const consoleAdapter: MessageAdapter = {
  name: 'console',
  async send(req) {
    consoleOutbox.push(req);
    if (consoleOutbox.length > 200) consoleOutbox.shift();
    if (env.NODE_ENV !== 'test') {
      console.log(`[messaging:console] ${req.channel} to ${req.to}: ${req.rendered.subject}\n${req.rendered.text}`);
    }
    return { providerMessageId: `console-${req.messageId}` };
  },
};

/**
 * Email through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
 * Chosen as the default email provider for D-8.1 because it needs no SDK; swap by adding another
 * adapter and pointing MESSAGING_EMAIL_PROVIDER at it.
 */
export const resendEmailAdapter: MessageAdapter = {
  name: 'resend',
  async send(req) {
    if (!env.RESEND_API_KEY || !env.MESSAGING_EMAIL_FROM) {
      throw new PermanentDeliveryError('Email provider is not configured (RESEND_API_KEY, MESSAGING_EMAIL_FROM)');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: env.MESSAGING_EMAIL_FROM,
          to: [req.to],
          subject: req.rendered.subject,
          text: req.rendered.text,
          html: req.rendered.html,
        }),
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new PermanentDeliveryError(`Email provider rejected the message (${res.status}): ${body.message ?? ''}`);
      }
      if (!res.ok) throw new Error(`Email provider error ${res.status}`);
      return { providerMessageId: body.id ?? null };
    } finally {
      clearTimeout(timer);
    }
  },
};

/** Push to registered devices. `to` is "user:<userId>" (provisioned account) or "session:<sessionId>". */
export const pushAdapter: MessageAdapter = {
  name: 'push',
  async send(req) {
    const [kind, id] = req.to.split(':');
    const message = { title: req.rendered.subject, body: req.rendered.pushBody ?? req.rendered.text, data: { actionType: 'NONE' } };
    if (kind === 'user') await sendPushToMobileUser(id, message);
    else if (kind === 'session') await sendPushToFieldSession(id, message);
    else throw new PermanentDeliveryError(`Unknown push address ${req.to}`);
    return { providerMessageId: null };
  },
};

let overrides: Partial<Record<OutboundChannel, MessageAdapter>> = {};

/** Test hook: replace the adapter for a channel (pass {} to reset). */
export function setMessageAdapterOverrides(next: Partial<Record<OutboundChannel, MessageAdapter>>): void {
  overrides = next;
}

/** The adapter for a channel, or null when the channel has none (SMS until D-8.1 is decided). */
export function adapterFor(channel: OutboundChannel): MessageAdapter | null {
  if (overrides[channel]) return overrides[channel]!;
  switch (channel) {
    case 'EMAIL':
      if (env.MESSAGING_EMAIL_PROVIDER === 'resend') return resendEmailAdapter;
      if (env.MESSAGING_EMAIL_PROVIDER === 'console') return consoleAdapter;
      return null;
    case 'PUSH':
      return pushAdapter;
    case 'SMS':
    default:
      // SMS slot left empty (D-8.1). Add an adapter here when a provider is chosen.
      return null;
  }
}
