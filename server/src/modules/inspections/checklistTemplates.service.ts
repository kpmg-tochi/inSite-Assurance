import { Prisma } from '@prisma/client';
import {
  ChecklistSections,
  ChecklistSectionsSchema,
  InspectionChecklistTemplateDto,
  InspectionVisitType,
  ProjectTypeConfig,
  SaveChecklistTemplateRequest,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import type { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';

/**
 * Inspection checklist templates (Phase 14). Tenant-level and versioned by code: a version that an
 * inspection used is never edited; saving it creates version + 1. An unused latest version is
 * edited in place. Inspections store the template id (one version) they used.
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
 * Creates a template (code must be new) or, with `existingCode`, saves the next state of that code:
 * in place when its latest version is unused, else as a new version.
 */
export async function saveChecklistTemplate(
  webUser: WebJwtPayload,
  input: SaveChecklistTemplateRequest,
  existingCode: string | null,
  db: typeof prisma = prisma
): Promise<InspectionChecklistTemplateDto> {
  const tenantId = webUser.tenantId;
  const id = await db.$transaction(async (tx) => {
    // Serialise saves per tenant so two editors cannot both create version n + 1.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`checklist-templates:${tenantId}`}))`;
    const code = existingCode ?? input.code;
    if (existingCode && input.code !== existingCode) {
      throw new AppError('A template code cannot change; create a new template instead', 422, 'TEMPLATE_CODE_LOCKED');
    }
    const latest = await tx.inspectionChecklistTemplate.findFirst({
      where: { tenantId, code },
      orderBy: { version: 'desc' },
      include: TEMPLATE_INCLUDE,
    });
    if (!existingCode && latest) throw new AppError(`A checklist template with code "${code}" already exists`, 409, 'TEMPLATE_CODE_EXISTS');
    if (existingCode && !latest) throw new AppError('Checklist template not found', 404, 'CHECKLIST_TEMPLATE_NOT_FOUND');
    const data = {
      name: input.name,
      visitTypes: input.visitTypes,
      sectionsJson: input.sections as unknown as Prisma.InputJsonValue,
      isArchived: false,
    };
    let saved: { id: string; version: number };
    let mode: 'created' | 'edited' | 'versioned';
    if (!latest) {
      saved = await tx.inspectionChecklistTemplate.create({ data: { tenantId, code, version: 1, ...data } });
      mode = 'created';
    } else if (latest._count.inspections === 0) {
      saved = await tx.inspectionChecklistTemplate.update({ where: { id: latest.id }, data });
      mode = 'edited';
    } else {
      saved = await tx.inspectionChecklistTemplate.create({ data: { tenantId, code, version: latest.version + 1, ...data } });
      mode = 'versioned';
    }
    await recordAuditEvent(tx, {
      tenantId,
      projectId: null,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
      action: 'CHECKLIST_TEMPLATE_SAVED',
      summaryText:
        mode === 'created'
          ? `Created checklist template "${input.name}" (${code}).`
          : mode === 'versioned'
            ? `Saved checklist template "${input.name}" (${code}) as version ${saved.version}; earlier inspections keep version ${latest!.version}.`
            : `Edited checklist template "${input.name}" (${code}, version ${saved.version}, not used yet).`,
      payload: { templateId: saved.id, code, version: saved.version, mode, visitTypes: input.visitTypes },
    });
    return saved.id;
  });
  return getChecklistTemplate(prisma, tenantId, id);
}

/** Archives every version of a code (inspections keep their version; no new inspection may pick it). */
export async function setChecklistTemplateArchived(webUser: WebJwtPayload, code: string, archived: boolean): Promise<InspectionChecklistTemplateDto[]> {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.inspectionChecklistTemplate.updateMany({ where: { tenantId: webUser.tenantId, code }, data: { isArchived: archived } });
    if (updated.count === 0) throw new AppError('Checklist template not found', 404, 'CHECKLIST_TEMPLATE_NOT_FOUND');
    await recordAuditEvent(tx, {
      tenantId: webUser.tenantId,
      projectId: null,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
      action: 'CHECKLIST_TEMPLATE_SAVED',
      summaryText: `${archived ? 'Archived' : 'Restored'} checklist template ${code}.`,
      payload: { code, archived },
    });
  });
  return listTemplateVersions(webUser.tenantId, code);
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
