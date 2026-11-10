import crypto from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { AuditActionType, AuditActorType } from '@insite/shared';
import { prisma } from '../../config/prisma';

export const GENESIS_AUDIT_HASH =
  'GENESIS_0000000000000000000000000000000000000000000000000000000000000000';

type PrismaTransactionOrClient = Prisma.TransactionClient | PrismaClient;

export interface RecordAuditEventInput {
  projectId: string;
  actorType: AuditActorType;
  actorId: string;
  actorDisplayName: string;
  action: AuditActionType;
  summaryText: string;
  payload?: Record<string, unknown>;
  createdAt?: Date;
}

/**
 * Deterministic canonical JSON serializer so key order never alters SHA-256 verification.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const pairs = sortedKeys.map(
    (k) => `${JSON.stringify(k)}:${canonicalizeJson(record[k])}`
  );
  return `{${pairs.join(',')}}`;
}

export function computeAuditEntryHash(params: {
  previousHash: string;
  projectId: string;
  actorType: string;
  actorId: string;
  action: string;
  summaryText: string;
  payload: unknown;
  createdAtIso: string;
}): string {
  const preimage = [
    params.previousHash,
    params.projectId,
    params.actorType,
    params.actorId,
    params.action,
    params.summaryText,
    canonicalizeJson(params.payload ?? {}),
    params.createdAtIso,
  ].join('|');

  return crypto.createHash('sha256').update(preimage, 'utf8').digest('hex');
}

export async function recordAuditEvent(
  db: PrismaTransactionOrClient,
  input: RecordAuditEventInput
) {
  const latestEntry = await db.auditLog.findFirst({
    where: { projectId: input.projectId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { entryHash: true },
  });

  const previousHash = latestEntry?.entryHash ?? GENESIS_AUDIT_HASH;
  const createdAt = input.createdAt ?? new Date();
  const payloadObj = input.payload ?? {};

  const entryHash = computeAuditEntryHash({
    previousHash,
    projectId: input.projectId,
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    summaryText: input.summaryText,
    payload: payloadObj,
    createdAtIso: createdAt.toISOString(),
  });

  return db.auditLog.create({
    data: {
      projectId: input.projectId,
      actorType: input.actorType,
      actorId: input.actorId,
      actorDisplayName: input.actorDisplayName,
      action: input.action,
      summaryText: input.summaryText,
      payload: payloadObj as Prisma.InputJsonValue,
      previousHash,
      entryHash,
      createdAt,
    },
  });
}

export async function getAndVerifyProjectAuditTrail(projectId: string) {
  const entries = await prisma.auditLog.findMany({
    where: { projectId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  let expectedPrevHash = GENESIS_AUDIT_HASH;
  let isChainValid = true;
  let brokenAtEntryId: string | null = null;

  for (const entry of entries) {
    const recomputed = computeAuditEntryHash({
      previousHash: expectedPrevHash,
      projectId: entry.projectId,
      actorType: entry.actorType,
      actorId: entry.actorId,
      action: entry.action,
      summaryText: entry.summaryText,
      payload: entry.payload,
      createdAtIso: entry.createdAt.toISOString(),
    });

    if (
      entry.previousHash !== expectedPrevHash ||
      entry.entryHash !== recomputed
    ) {
      isChainValid = false;
      brokenAtEntryId = entry.id;
      break;
    }
    expectedPrevHash = entry.entryHash;
  }

  return {
    projectId,
    chainIntegrityVerified: isChainValid,
    totalEntries: entries.length,
    brokenAtEntryId,
    latestHash: entries.length > 0 ? entries[entries.length - 1].entryHash : null,
    entries,
  };
}

