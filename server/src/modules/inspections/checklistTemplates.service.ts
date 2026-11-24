import { Prisma } from '@prisma/client';
import {
  ChecklistSections,
  ChecklistSectionsSchema,
  InspectionChecklistTemplateDto,
  InspectionVisitType,
  ProjectTypeConfig,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';

/**
 * Inspection checklist templates (Phase 14). Tenant-level and versioned by code; inspections store the
 * template id (one version) they used. Read only since redesign R3e: authoring moved to the form
 * library, the seeded templates keep Phase 14 inspections running until R4 replaces them with visits.
 */

type Db = Prisma.TransactionClient | typeof prisma;

const TEMPLATE_INCLUDE = { _count: { select: { inspections: true } } } satisfies Prisma.InspectionChecklistTemplateInclude;
type TemplateRow = Prisma.InspectionChecklistTemplateGetPayload<{ include: typeof TEMPLATE_INCLUDE }>;

export function parseSections(raw: unknown): ChecklistSections {
  const parsed = ChecklistSectionsSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('This checklist template is not valid any more', 500, 'INVALID_CHECKLIST_TEMPLATE');
  return parsed.data;
}

function serialize(t: TemplateRow, latestVersion: number): InspectionChecklistTemplateDto {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    visitTypes: t.visitTypes,
    version: t.version,
    sections: parseSections(t.sectionsJson),
    isArchived: t.isArchived,
    usageCount: t._count.inspections,
    isLatest: t.version === latestVersion,
    createdAt: t.createdAt.toISOString(),
  };
}

/** Latest version of every template code (archived ones only when asked). */
export async function listChecklistTemplates(tenantId: string, includeArchived = false): Promise<InspectionChecklistTemplateDto[]> {
  const rows = await prisma.inspectionChecklistTemplate.findMany({
    where: { tenantId, ...(includeArchived ? {} : { isArchived: false }) },
    include: TEMPLATE_INCLUDE,
    orderBy: [{ code: 'asc' }, { version: 'desc' }],
  });
  const latest = new Map<string, TemplateRow>();
  for (const r of rows) if (!latest.has(r.code)) latest.set(r.code, r);
  return [...latest.values()].map((r) => serialize(r, r.version));
}

/** Every version of one code, newest first. */
export async function listTemplateVersions(tenantId: string, code: string): Promise<InspectionChecklistTemplateDto[]> {
  const rows = await prisma.inspectionChecklistTemplate.findMany({
    where: { tenantId, code },
    include: TEMPLATE_INCLUDE,
    orderBy: { version: 'desc' },
  });
  if (rows.length === 0) throw new AppError('Checklist template not found', 404, 'CHECKLIST_TEMPLATE_NOT_FOUND');
  return rows.map((r) => serialize(r, rows[0].version));
}

export async function getChecklistTemplate(db: Db, tenantId: string, templateId: string): Promise<InspectionChecklistTemplateDto> {
  const row = await db.inspectionChecklistTemplate.findFirst({ where: { id: templateId, tenantId }, include: TEMPLATE_INCLUDE });
  if (!row) throw new AppError('Checklist template not found', 404, 'CHECKLIST_TEMPLATE_NOT_FOUND');
  const latest = await db.inspectionChecklistTemplate.aggregate({ where: { tenantId, code: row.code }, _max: { version: true } });
  return serialize(row, latest._max.version ?? row.version);
}


/**
 * The template a project uses for a visit type: the project type's code for it (latest unarchived
 * version), else the latest unarchived template that lists the visit type.
 */
export async function resolveTemplateForVisit(
  db: Db,
  tenantId: string,
  typeConfig: ProjectTypeConfig | null,
  visitType: InspectionVisitType
): Promise<{ id: string; code: string; name: string; version: number; visitTypes: InspectionVisitType[]; sections: ChecklistSections } | null> {
  const code = typeConfig?.inspections.templateCodeByVisitType[visitType];
  const pick = (extra: Prisma.InspectionChecklistTemplateWhereInput) =>
    db.inspectionChecklistTemplate.findFirst({
      where: { tenantId, isArchived: false, visitTypes: { has: visitType }, ...extra },
      orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
    });
  const row = (code ? await pick({ code }) : null) ?? (await pick({}));
  if (!row) return null;
  return { id: row.id, code: row.code, name: row.name, version: row.version, visitTypes: row.visitTypes, sections: parseSections(row.sectionsJson) };
}
