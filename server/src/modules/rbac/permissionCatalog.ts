import { Prisma } from '@prisma/client';
import { SYSTEM_PERMISSIONS_CATALOG } from '@insite/shared';
import { prisma } from '../../config/prisma';

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Redesign R7a (D-R7.3): code owns the permission rows. Upserts every catalogue entry by key
 * (name, description, category, surface). Never deletes: renames and removals are migration SQL,
 * so a renamed key keeps its row id and every role grant (default or custom) survives.
 *
 * Runs at server start (before jobs register), in the seed and in tenant provisioning. Cheap and
 * idempotent: rows already in step are not written.
 */
export async function syncPermissionCatalog(db: Db = prisma): Promise<{ created: number; updated: number }> {
  const existing = new Map(
    (await db.permission.findMany({ select: { key: true, name: true, description: true, category: true, surface: true } })).map(
      (p) => [p.key, p],
    ),
  );
  let created = 0;
  let updated = 0;
  for (const item of SYSTEM_PERMISSIONS_CATALOG) {
    const data = { name: item.name, description: item.description, category: item.category, surface: item.surface };
    const row = existing.get(item.key);
    if (!row) {
      await db.permission.upsert({ where: { key: item.key }, create: { key: item.key, ...data }, update: data });
      created += 1;
    } else if (
      row.name !== data.name ||
      row.description !== data.description ||
      row.category !== data.category ||
      row.surface !== data.surface
    ) {
      await db.permission.update({ where: { key: item.key }, data });
      updated += 1;
    }
  }
  return { created, updated };
}
