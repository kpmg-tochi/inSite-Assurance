import { Prisma } from '@prisma/client';
import {
  parseTerminologyLabels,
  resolveTerminology,
  ResolvedTerminology,
  TerminologySettingsDto,
  UpdateTerminologyRequest,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { getRequestMemo, setRequestMemo } from '../../utils/requestContext';

/**
 * Tenant terminology (Phase 11). Display words only: canonical values, enum names, API fields and
 * AI prompts never change (decision B pattern).
 */

type Db = Prisma.TransactionClient | typeof prisma;

export async function getTerminologySettings(tenantId: string): Promise<TerminologySettingsDto> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { terminologyLabels: true } });
  if (!tenant) throw new AppError('Tenant not found', 404, 'TENANT_NOT_FOUND');
  return { labels: parseTerminologyLabels(tenant.terminologyLabels), resolved: resolveTerminology(tenant.terminologyLabels) };
}

/** Replaces the tenant's overrides; omitted keys fall back to the defaults. */
export async function updateTerminologySettings(
  webUser: WebJwtPayload,
  input: UpdateTerminologyRequest
): Promise<TerminologySettingsDto> {
  const tenantId = webUser.tenantId;
  const next = parseTerminologyLabels(input.labels);
  await prisma.$transaction(async (tx) => {
    const before = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { terminologyLabels: true } });
    const previous = parseTerminologyLabels(before.terminologyLabels);
    await tx.tenant.update({ where: { id: tenantId }, data: { terminologyLabels: next as unknown as Prisma.InputJsonValue } });
    const keys = [...new Set([...Object.keys(previous), ...Object.keys(next)])] as Array<keyof typeof next>;
    const changed = keys.filter((k) => JSON.stringify(previous[k] ?? null) !== JSON.stringify(next[k] ?? null));
    await recordAuditEvent(tx, {
      tenantId,
      projectId: null,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
      action: 'TERMINOLOGY_UPDATED',
      summaryText: changed.length ? `Updated terminology (${changed.join(', ')}).` : 'Saved terminology (no changes).',
      payload: { changedKeys: changed, previous, next },
    });
  });
  return getTerminologySettings(tenantId);
}

/** Resolved terms for a project's tenant (PDFs, outbound messages). Memoised per request. */
export async function terminologyForProject(projectId: string, db: Db = prisma): Promise<ResolvedTerminology> {
  const key = `terminology:project:${projectId}`;
  if (db === prisma) {
    const cached = getRequestMemo<ResolvedTerminology>(key);
    if (cached) return cached;
  }
  const project = await db.project.findUnique({ where: { id: projectId }, select: { tenant: { select: { terminologyLabels: true } } } });
  const terms = resolveTerminology(project?.tenant.terminologyLabels ?? {});
  if (db === prisma) setRequestMemo(key, terms);
  return terms;
}
