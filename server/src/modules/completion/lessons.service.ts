import { Prisma } from '@prisma/client';
import { LessonCategory, LessonDto, LessonStage, LessonCategoryEnum, SaveLessonRequest } from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { hasWebPermission, WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { createWebNotification } from '../notifications/notifications.service';

/**
 * Phase 15 Step 6: lessons learned. Written per project (lessons:manage); drafts are seen by the
 * project team (the monitoring side), published lessons by anyone in the tenant with lessons:view
 * through the library. A lesson shared with the contractor is shown to the project's contractors
 * once published, and they are told (aimed notification).
 */

type Db = Prisma.TransactionClient | typeof prisma;

const LESSON_INCLUDE = {
  project: {
    select: {
      id: true,
      codePrefix: true,
      name: true,
      projectType: { select: { name: true } },
      region: { select: { name: true } },
    },
  },
} satisfies Prisma.LessonLearnedInclude;
type LessonRow = Prisma.LessonLearnedGetPayload<{ include: typeof LESSON_INCLUDE }>;

async function serialize(db: Db, rows: LessonRow[], webUser: WebJwtPayload, contractorSide: boolean): Promise<LessonDto[]> {
  const ids = [...new Set(rows.map((r) => r.createdByUserId))];
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : [];
  const name = new Map(users.map((u) => [u.id, u.fullName]));
  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    projectCode: r.project.codePrefix,
    projectName: r.project.name,
    projectTypeName: r.project.projectType?.name ?? null,
    regionName: r.project.region?.name ?? null,
    category: r.category as LessonCategory,
    title: r.title,
    description: r.description,
    recommendation: r.recommendation,
    stage: r.stage as LessonStage,
    tags: r.tags,
    status: r.status,
    sharedWithContractor: r.sharedWithContractor,
    createdByName: name.get(r.createdByUserId) ?? null,
    publishedAt: r.publishedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    canEdit: !contractorSide && hasWebPermission(webUser, 'lessons:manage'),
  }));
}

async function isContractorSide(db: Db, projectId: string, webUser: WebJwtPayload) {
  if (webUser.isPlatformSuperAdmin) return false;
  return (await db.projectContractor.count({ where: { projectId, organizationId: webUser.organizationId } })) > 0;
}

/** GET /projects/:projectId/lessons */
export async function listProjectLessons(projectId: string, webUser: WebJwtPayload): Promise<LessonDto[]> {
  const contractorSide = await isContractorSide(prisma, projectId, webUser);
  const rows = await prisma.lessonLearned.findMany({
    where: { projectId, ...(contractorSide ? { status: 'PUBLISHED', sharedWithContractor: true } : {}) },
    include: LESSON_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
  return serialize(prisma, rows, webUser, contractorSide);
}

function stageForPhase(phase: string): LessonStage {
  switch (phase) {
    case 'HANDOVER_IN_PROGRESS':
      return 'HANDOVER';
    case 'RETENTION_PERIOD':
      return 'LIABILITY_PERIOD';
    case 'COMPLETED_CLOSED':
      return 'POST_CLOSURE';
    default:
      return 'CONSTRUCTION';
  }
}
export { stageForPhase };

async function assertMonitoringSide(projectId: string, webUser: WebJwtPayload) {
  if (await isContractorSide(prisma, projectId, webUser)) {
    throw new AppError('Lessons are recorded by the project team', 403, 'FORBIDDEN_CONTRACTOR');
  }
}

/** POST /projects/:projectId/lessons */
export async function createLesson(projectId: string, webUser: WebJwtPayload, input: SaveLessonRequest) {
  await assertMonitoringSide(projectId, webUser);
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { tenantId: true } });
  const row = await prisma.lessonLearned.create({
    data: {
      tenantId: project.tenantId,
      projectId,
      category: input.category,
      title: input.title,
      description: input.description,
      recommendation: input.recommendation,
      stage: input.stage,
      tags: [...new Set(input.tags)],
      sharedWithContractor: input.sharedWithContractor,
      createdByUserId: webUser.userId,
    },
    include: LESSON_INCLUDE,
  });
  return (await serialize(prisma, [row], webUser, false))[0];
}

async function loadLesson(db: Db, projectId: string, lessonId: string) {
  const row = await db.lessonLearned.findFirst({ where: { id: lessonId, projectId }, include: LESSON_INCLUDE });
  if (!row) throw new AppError('Lesson not found', 404, 'LESSON_NOT_FOUND');
  return row;
}

/** PUT /projects/:projectId/lessons/:lessonId (drafts and published lessons alike). */
export async function updateLesson(projectId: string, lessonId: string, webUser: WebJwtPayload, input: SaveLessonRequest) {
  await assertMonitoringSide(projectId, webUser);
  const before = await loadLesson(prisma, projectId, lessonId);
  await prisma.$transaction(async (tx) => {
    await tx.lessonLearned.update({
      where: { id: lessonId },
      data: {
        category: input.category,
        title: input.title,
        description: input.description,
        recommendation: input.recommendation,
        stage: input.stage,
        tags: [...new Set(input.tags)],
        sharedWithContractor: input.sharedWithContractor,
      },
    });
    // Sharing a published lesson later tells the contractors then.
    if (before.status === 'PUBLISHED' && input.sharedWithContractor && !before.sharedWithContractor) {
      await notifyContractors(tx, projectId, lessonId, input.title);
    }
  });
  return (await serialize(prisma, [await loadLesson(prisma, projectId, lessonId)], webUser, false))[0];
}

async function notifyContractors(tx: Prisma.TransactionClient, projectId: string, lessonId: string, title: string) {
  const contractors = await tx.projectContractor.findMany({ where: { projectId }, select: { organizationId: true } });
  for (const c of new Set(contractors.map((x) => x.organizationId))) {
    await createWebNotification(tx, {
      projectId,
      targetPermissionKey: 'projects:view_assigned',
      targetOrganizationId: c,
      category: 'LESSON_SHARED',
      title: 'A lesson learned was shared with you',
      description: title,
      actionUrl: `/app/projects/${projectId}/closure`,
      metadata: { lessonId },
    });
  }
}

/** POST /projects/:projectId/lessons/:lessonId/publish */
export async function publishLesson(projectId: string, lessonId: string, webUser: WebJwtPayload) {
  await assertMonitoringSide(projectId, webUser);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "lessons_learned" WHERE id = ${lessonId}::uuid FOR UPDATE`;
    const row = await loadLesson(tx, projectId, lessonId);
    if (row.status === 'PUBLISHED') throw new AppError('This lesson is already published', 409, 'LESSON_ALREADY_PUBLISHED');
    await tx.lessonLearned.update({ where: { id: lessonId }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
      action: 'LESSON_PUBLISHED',
      summaryText: `Published lesson learned "${row.title}" (${row.category.toLowerCase().replace('_', ' ')})${row.sharedWithContractor ? ', shared with the contractor' : ''}.`,
      payload: { lessonId, category: row.category, stage: row.stage, tags: row.tags, sharedWithContractor: row.sharedWithContractor },
    });
    if (row.sharedWithContractor) await notifyContractors(tx, projectId, lessonId, row.title);
  });
  return (await serialize(prisma, [await loadLesson(prisma, projectId, lessonId)], webUser, false))[0];
}

/** GET /lessons: the tenant library of published lessons (lessons:view). */
export async function listLessonLibrary(
  webUser: WebJwtPayload,
  filters: { projectTypeId?: string; regionId?: string; category?: string; tag?: string; q?: string }
): Promise<LessonDto[]> {
  const category = filters.category && LessonCategoryEnum.safeParse(filters.category).success ? filters.category : undefined;
  const q = filters.q?.trim();
  const rows = await prisma.lessonLearned.findMany({
    where: {
      tenantId: webUser.tenantId,
      status: 'PUBLISHED',
      ...(category ? { category } : {}),
      ...(filters.tag ? { tags: { has: filters.tag.trim().toLowerCase() } } : {}),
      ...(filters.projectTypeId ? { project: { projectTypeId: filters.projectTypeId } } : {}),
      // A region includes its areas.
      ...(filters.regionId
        ? { project: { ...(filters.projectTypeId ? { projectTypeId: filters.projectTypeId } : {}), OR: [{ regionId: filters.regionId }, { region: { parentRegionId: filters.regionId } }] } }
        : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { description: { contains: q, mode: 'insensitive' } },
              { recommendation: { contains: q, mode: 'insensitive' } },
              { tags: { has: q.toLowerCase() } },
            ],
          }
        : {}),
    },
    include: LESSON_INCLUDE,
    orderBy: { publishedAt: 'desc' },
    take: 500,
  });
  return serialize(prisma, rows, webUser, true);
}
