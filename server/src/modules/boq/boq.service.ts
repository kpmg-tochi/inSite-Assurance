import { BoqRevisionDto } from '@insite/shared';
import { prisma } from '../../config/prisma';
import { serializeBoqItem } from '../../utils/serializers';

/**
 * BOQ reads. Redesign R2d removed the upload, mapping and preview path (scope is edited through
 * modules/scope); BOQ revisions from before R2 stay readable.
 */

export async function listProjectBoqItems(projectId: string) {
  const items = await prisma.boqItem.findMany({
    where: { projectId },
    orderBy: { wbsCode: 'asc' },
  });
  return items.map((item) => serializeBoqItem(item));
}

export async function listBoqRevisions(projectId: string): Promise<BoqRevisionDto[]> {
  const rows = await prisma.boqRevision.findMany({ where: { projectId }, orderBy: { revisionNumber: 'desc' } });
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.uploadedByUserId))] } },
    select: { id: true, fullName: true },
  });
  const names = new Map(users.map((u) => [u.id, u.fullName]));
  return rows.map((r) => ({
    id: r.id,
    revisionNumber: r.revisionNumber,
    reason: r.reason,
    itemCount: r.itemCount,
    uploadedByUserId: r.uploadedByUserId,
    uploadedByName: names.get(r.uploadedByUserId) ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}
