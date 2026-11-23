import { Prisma } from '@prisma/client';
import {
  CONTRACTOR_RATING_STAGE_META,
  ContractorRatingDto,
  ContractorRatingStage,
  OrganizationRatingsDto,
  overallRatingScore,
  ProjectRatingsDto,
  RateContractorRequest,
  RatingCriterion,
  resolveRatingCriteria,
  SaveRatingCriteriaRequest,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { hasWebPermission, WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { projectAccessBranch } from '../../utils/accessControl';
import { closureConfigOf } from './completion.service';

/**
 * Phase 15 Step 6: contractor performance ratings. Each rater rates each contractor once per stage
 * (at completion from handover on; after closure once the project is closed) on the tenant's
 * criteria. Ratings are hidden from the contractor's own users unless the project type shares them.
 */

type Db = Prisma.TransactionClient | typeof prisma;

const RATING_INCLUDE = {
  project: { select: { id: true, codePrefix: true, name: true, projectTypeSnapshotJson: true } },
  projectContractor: { select: { id: true, organizationId: true, organization: { select: { name: true } } } },
} satisfies Prisma.ContractorPerformanceRatingInclude;
type RatingRow = Prisma.ContractorPerformanceRatingGetPayload<{ include: typeof RATING_INCLUDE }>;

export async function tenantRatingCriteria(db: Db, tenantId: string): Promise<RatingCriterion[]> {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { ratingCriteriaJson: true } });
  return resolveRatingCriteria(t?.ratingCriteriaJson);
}

async function serializeRatings(db: Db, rows: RatingRow[]): Promise<ContractorRatingDto[]> {
  const ids = [...new Set(rows.map((r) => r.ratedByUserId))];
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : [];
  const name = new Map(users.map((u) => [u.id, u.fullName]));
  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    projectCode: r.project.codePrefix,
    projectName: r.project.name,
    projectContractorId: r.projectContractorId,
    organizationId: r.projectContractor.organizationId,
    organizationName: r.projectContractor.organization.name,
    stage: r.stage,
    criteria: (Array.isArray(r.criteriaJson) ? r.criteriaJson : []) as ContractorRatingDto['criteria'],
    overallScore: Number(r.overallScore),
    comments: r.comments,
    ratedByUserId: r.ratedByUserId,
    ratedByName: name.get(r.ratedByUserId) ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** The caller's contractor on the project (contractor side), or null (monitoring side). */
async function contractorSideOf(db: Db, projectId: string, webUser: WebJwtPayload) {
  if (webUser.isPlatformSuperAdmin) return null;
  return db.projectContractor.findFirst({ where: { projectId, organizationId: webUser.organizationId }, select: { id: true } });
}

function openStages(phase: string): ContractorRatingStage[] {
  if (phase === 'COMPLETED_CLOSED') return ['COMPLETION', 'POST_CLOSURE'];
  if (phase === 'HANDOVER_IN_PROGRESS' || phase === 'RETENTION_PERIOD') return ['COMPLETION'];
  return [];
}

/** GET /projects/:projectId/contractor-ratings */
export async function getProjectRatings(projectId: string, webUser: WebJwtPayload): Promise<ProjectRatingsDto> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { tenantId: true, constructionPhase: true, projectTypeSnapshotJson: true },
  });
  const shared = closureConfigOf(project.projectTypeSnapshotJson).shareRatingsWithContractor;
  const side = await contractorSideOf(prisma, projectId, webUser);
  if (side && !shared) {
    throw new AppError('Ratings on this project are not shared with contractors', 404, 'RATINGS_NOT_FOUND');
  }
  const [criteria, contractors, rows] = await Promise.all([
    tenantRatingCriteria(prisma, project.tenantId),
    prisma.projectContractor.findMany({
      where: { projectId, ...(side ? { id: side.id } : {}) },
      orderBy: [{ isMainContractor: 'desc' }, { createdAt: 'asc' }],
      select: { id: true, organizationId: true, tradeCode: true, contractStatus: true, organization: { select: { name: true } } },
    }),
    prisma.contractorPerformanceRating.findMany({
      where: { projectId, ...(side ? { projectContractorId: side.id } : {}) },
      include: RATING_INCLUDE,
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const ratings = await serializeRatings(prisma, rows);
  const stages = openStages(project.constructionPhase);
  return {
    criteria,
    sharedWithContractor: shared,
    openStages: stages,
    canRate: !side && stages.length > 0 && hasWebPermission(webUser, 'contractors:rate_performance'),
    contractors: contractors.map((c) => ({
      projectContractorId: c.id,
      organizationId: c.organizationId,
      organizationName: c.organization.name,
      tradeCode: c.tradeCode,
      contractStatus: c.contractStatus,
      ratings: ratings.filter((r) => r.projectContractorId === c.id),
      myRatedStages: [...new Set(ratings.filter((r) => r.projectContractorId === c.id && r.ratedByUserId === webUser.userId).map((r) => r.stage))],
    })),
  };
}

/** POST /projects/:projectId/contractor-ratings */
export async function rateContractor(projectId: string, webUser: WebJwtPayload, input: RateContractorRequest) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { tenantId: true, constructionPhase: true } });
  if (await contractorSideOf(prisma, projectId, webUser)) {
    throw new AppError('Contractors do not rate contractors on their own project', 403, 'FORBIDDEN_CONTRACTOR');
  }
  if (!openStages(project.constructionPhase).includes(input.stage)) {
    throw new AppError(
      input.stage === 'COMPLETION' ? 'Contractors are rated at completion once the project is in handover.' : 'The post-closure rating opens once the project is closed.',
      409,
      'RATING_STAGE_NOT_OPEN'
    );
  }
  const pc = await prisma.projectContractor.findFirst({
    where: { id: input.projectContractorId, projectId },
    select: { id: true, organization: { select: { name: true } } },
  });
  if (!pc) throw new AppError('Contractor not found on this project', 404, 'CONTRACTOR_NOT_FOUND');
  const criteria = await tenantRatingCriteria(prisma, project.tenantId);
  const given = new Map(input.criteria.map((c) => [c.key, c]));
  const unknown = input.criteria.filter((c) => !criteria.some((k) => k.key === c.key)).map((c) => c.key);
  const missing = criteria.filter((c) => !given.has(c.key)).map((c) => c.label);
  if (unknown.length || missing.length || given.size !== input.criteria.length) {
    throw new AppError(
      missing.length ? `Score every criterion: ${missing.join(', ')}.` : `Unknown or repeated criteria: ${unknown.join(', ') || 'repeated keys'}.`,
      422,
      'RATING_CRITERIA_MISMATCH'
    );
  }
  const scored = criteria.map((c) => ({ key: c.key, label: c.label, score: given.get(c.key)!.score, comment: given.get(c.key)!.comment ?? null }));
  const overall = overallRatingScore(scored.map((s) => s.score));
  try {
    await prisma.$transaction(async (tx) => {
      const row = await tx.contractorPerformanceRating.create({
        data: {
          projectId,
          projectContractorId: pc.id,
          stage: input.stage,
          criteriaJson: scored as unknown as Prisma.InputJsonValue,
          overallScore: overall,
          comments: input.comments ?? null,
          ratedByUserId: webUser.userId,
        },
      });
      await recordAuditEvent(tx, {
        projectId,
        actorType: 'WEB_USER',
        actorId: webUser.userId,
        actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
        action: 'CONTRACTOR_RATED',
        summaryText: `Rated ${pc.organization.name} ${CONTRACTOR_RATING_STAGE_META[input.stage].label.toLowerCase()}: ${overall.toFixed(2)} of 5.`,
        payload: { ratingId: row.id, projectContractorId: pc.id, stage: input.stage, overallScore: overall, scores: scored.map((s) => ({ key: s.key, score: s.score })) },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError('You have already rated this contractor at this stage', 409, 'RATING_ALREADY_RECORDED');
    }
    throw error;
  }
  return getProjectRatings(projectId, webUser);
}

/**
 * GET /organizations/:organizationId/ratings: a contractor's ratings across the projects the caller
 * can see. The contractor's own users see only ratings on projects that share them.
 */
export async function getOrganizationRatings(organizationId: string, webUser: WebJwtPayload): Promise<OrganizationRatingsDto> {
  const org = await prisma.organization.findFirst({ where: { id: organizationId, tenantId: webUser.tenantId }, select: { id: true, name: true } });
  if (!org) throw new AppError('Organisation not found', 404, 'ORGANIZATION_NOT_FOUND');
  const own = webUser.organizationId === organizationId && !webUser.isPlatformSuperAdmin;
  if (
    !own &&
    !['contractors:rate_performance', 'projects:view_portfolio', 'organizations:manage'].some((k) => hasWebPermission(webUser, k))
  ) {
    throw new AppError('Access requires permission(s): contractors:rate_performance', 403, 'FORBIDDEN_PERMISSION');
  }
  const branch = projectAccessBranch(webUser);
  const rows = await prisma.contractorPerformanceRating.findMany({
    where: { projectContractor: { organizationId }, project: { tenantId: webUser.tenantId, ...(branch ? { AND: [branch] } : {}) } },
    include: RATING_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
  const visible = own ? rows.filter((r) => closureConfigOf(r.project.projectTypeSnapshotJson).shareRatingsWithContractor) : rows;
  const ratings = await serializeRatings(prisma, visible);
  const criteria = await tenantRatingCriteria(prisma, webUser.tenantId);
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
  return {
    organizationId: org.id,
    organizationName: org.name,
    ratingCount: ratings.length,
    projectCount: new Set(ratings.map((r) => r.projectId)).size,
    averageOverall: avg(ratings.map((r) => r.overallScore)),
    perCriterion: criteria.map((c) => {
      const scores = ratings.flatMap((r) => r.criteria.filter((x) => x.key === c.key).map((x) => x.score));
      return { key: c.key, label: c.label, average: avg(scores), count: scores.length };
    }),
    ratings,
  };
}

/** GET/PUT /closure/rating-criteria (tenant settings). */
export async function getRatingCriteria(tenantId: string) {
  return tenantRatingCriteria(prisma, tenantId);
}

export async function saveRatingCriteria(webUser: WebJwtPayload, input: SaveRatingCriteriaRequest) {
  await prisma.$transaction(async (tx) => {
    await tx.tenant.update({ where: { id: webUser.tenantId }, data: { ratingCriteriaJson: input.criteria as unknown as Prisma.InputJsonValue } });
    await recordAuditEvent(tx, {
      tenantId: webUser.tenantId,
      projectId: null,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
      action: 'TENANT_SETTINGS_UPDATED',
      summaryText: `Set the contractor rating criteria: ${input.criteria.map((c) => c.label).join(', ')}.`,
      payload: { ratingCriteria: input.criteria },
    });
  });
  return tenantRatingCriteria(prisma, webUser.tenantId);
}
