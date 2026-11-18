import crypto from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { AuditActionType, AuditActorType } from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';

export const GENESIS_AUDIT_HASH =
  'GENESIS_0000000000000000000000000000000000000000000000000000000000000000';

type PrismaTransactionOrClient = Prisma.TransactionClient | PrismaClient;

/**
 * An audit event belongs to one chain scope:
 * - a project chain when `projectId` is set, or
 * - the tenant chain when `projectId` is null (role, user, branding events).
 *
 * `tenantId` may be omitted for project events; it is resolved from the project.
 */
export interface RecordAuditEventInput {
  tenantId?: string;
  projectId?: string | null;
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
  tenantId: string;
  projectId: string | null;
  seq: bigint | number;
  actorType: string;
  actorId: string;
  action: string;
  summaryText: string;
  payload: unknown;
  createdAtIso: string;
}): string {
  const preimage = [
    params.previousHash,
    params.tenantId,
    params.projectId ?? '',
    String(params.seq),
    params.actorType,
    params.actorId,
    params.action,
    params.summaryText,
    canonicalizeJson(params.payload ?? {}),
    params.createdAtIso,
  ].join('|');

  return crypto.createHash('sha256').update(preimage, 'utf8').digest('hex');
}

/** Advisory-lock key for one chain scope. Two 32-bit ints derived from a hash of the scope. */
function chainLockKeys(tenantId: string, projectId: string | null): [number, number] {
  const digest = crypto
    .createHash('sha256')
    .update(`audit:${tenantId}:${projectId ?? 'tenant'}`)
    .digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

function isRootClient(db: PrismaTransactionOrClient): db is PrismaClient {
  return typeof (db as PrismaClient).$transaction === 'function';
}

async function appendAuditEntry(tx: Prisma.TransactionClient, input: RecordAuditEventInput) {
  const projectId = input.projectId ?? null;
  let tenantId = input.tenantId;

  if (projectId) {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { tenantId: true },
    });
    if (!project) {
      throw new AppError('Project not found for audit event', 404, 'PROJECT_NOT_FOUND');
    }
    if (tenantId && tenantId !== project.tenantId) {
      throw new AppError('Audit event tenant does not match project tenant', 500, 'AUDIT_SCOPE_MISMATCH');
    }
    tenantId = project.tenantId;
  }

  if (!tenantId) {
    throw new AppError('Audit event requires a tenantId or projectId', 500, 'AUDIT_SCOPE_MISSING');
  }

  // Serialise writers on this chain scope until the transaction commits.
  const [k1, k2] = chainLockKeys(tenantId, projectId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${k1}::int, ${k2}::int)`;

  const latestEntry = await tx.auditLog.findFirst({
    where: { tenantId, projectId },
    orderBy: { seq: 'desc' },
    select: { entryHash: true, seq: true },
  });

  const previousHash = latestEntry?.entryHash ?? GENESIS_AUDIT_HASH;
  const seq = (latestEntry?.seq ?? BigInt(0)) + BigInt(1);
  const createdAt = input.createdAt ?? new Date();
  const payloadObj = input.payload ?? {};

  const entryHash = computeAuditEntryHash({
    previousHash,
    tenantId,
    projectId,
    seq,
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    summaryText: input.summaryText,
    payload: payloadObj,
    createdAtIso: createdAt.toISOString(),
  });

  return tx.auditLog.create({
    data: {
      tenantId,
      projectId,
      seq,
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

/**
 * Appends an entry to the hash chain of its scope. When passed the root client, the write runs
 * in its own transaction so the advisory lock is held until commit. When passed a transaction
 * client, it joins that transaction (the lock is released when the caller commits).
 */
export async function recordAuditEvent(
  db: PrismaTransactionOrClient,
  input: RecordAuditEventInput
) {
  if (isRootClient(db)) {
    return db.$transaction((tx) => appendAuditEntry(tx, input));
  }
  return appendAuditEntry(db, input);
}

type AuditLogRow = Prisma.AuditLogGetPayload<object>;

export function serializeAuditEntry(entry: AuditLogRow) {
  return {
    id: entry.id,
    tenantId: entry.tenantId,
    projectId: entry.projectId,
    seq: Number(entry.seq),
    actorType: entry.actorType,
    actorId: entry.actorId,
    actorDisplayName: entry.actorDisplayName,
    action: entry.action,
    summaryText: entry.summaryText,
    payload: entry.payload as Record<string, unknown>,
    previousHash: entry.previousHash,
    entryHash: entry.entryHash,
    createdAt: entry.createdAt.toISOString(),
  };
}

export function verifyAuditChain(entries: AuditLogRow[]) {
  let expectedPrevHash = GENESIS_AUDIT_HASH;
  let expectedSeq = BigInt(1);
  let brokenAtEntryId: string | null = null;

  for (const entry of entries) {
    const recomputed = computeAuditEntryHash({
      previousHash: expectedPrevHash,
      tenantId: entry.tenantId,
      projectId: entry.projectId,
      seq: entry.seq,
      actorType: entry.actorType,
      actorId: entry.actorId,
      action: entry.action,
      summaryText: entry.summaryText,
      payload: entry.payload,
      createdAtIso: entry.createdAt.toISOString(),
    });

    if (
      entry.seq !== expectedSeq ||
      entry.previousHash !== expectedPrevHash ||
      entry.entryHash !== recomputed
    ) {
      brokenAtEntryId = entry.id;
      break;
    }
    expectedPrevHash = entry.entryHash;
    expectedSeq += BigInt(1);
  }

  return {
    chainIntegrityVerified: brokenAtEntryId === null,
    brokenAtEntryId,
    totalEntries: entries.length,
    latestHash: entries.length > 0 ? entries[entries.length - 1].entryHash : null,
    entries: entries.map(serializeAuditEntry),
  };
}

export async function getAndVerifyProjectAuditTrail(projectId: string) {
  const entries = await prisma.auditLog.findMany({
    where: { projectId },
    orderBy: { seq: 'asc' },
  });
  return { projectId, ...verifyAuditChain(entries) };
}

export async function getAndVerifyTenantAuditTrail(tenantId: string) {
  const entries = await prisma.auditLog.findMany({
    where: { tenantId, projectId: null },
    orderBy: { seq: 'asc' },
  });
  return { tenantId, projectId: null, ...verifyAuditChain(entries) };
}
