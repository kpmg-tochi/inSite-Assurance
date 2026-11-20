import { Prisma } from '@prisma/client';
import {
  paymentBasisMechanismConflict,
  ProjectReportingStepSchema,
  ProjectTypeConfig,
  ProjectTypeConfigSchema,
  ProjectTypeDto,
  ProjectTypeSnapshot,
  ProjectTypeSummary,
  SaveProjectTypeRequest,
  WorkflowTemplateConfig,
  WorkflowTemplateConfigSchema,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { applyTemplateConfig } from '../process/processConfig.service';
import { createStreamsFromProjectType } from '../cadence/streams.service';

/**
 * Project types (Phase 11). A type references a workflow template and holds the rest of a delivery
 * model in its config. Every update bumps `version`. Applying a type to a draft copies the template
 * into the project (Phase 7 service) and writes a snapshot of the type, so later edits to the type
 * change new projects only, like approval chain versions.
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

const TYPE_INCLUDE = {
  workflowTemplate: { select: { name: true } },
  _count: { select: { projects: true } },
} satisfies Prisma.ProjectTypeInclude;
type TypeRow = Prisma.ProjectTypeGetPayload<{ include: typeof TYPE_INCLUDE }>;

const actorName = (u: WebJwtPayload) => `${u.fullName} (${u.roleName})`;

function parseConfig(raw: unknown): ProjectTypeConfig {
  const parsed = ProjectTypeConfigSchema.safeParse(raw ?? {});
  // A type saved by an older release that no longer validates shows the defaults; saving fixes it.
  return parsed.success ? parsed.data : ProjectTypeConfigSchema.parse({});
}

function serializeType(t: TypeRow): ProjectTypeDto {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    description: t.description,
    colour: t.colour,
    workflowTemplateId: t.workflowTemplateId,
    workflowTemplateName: t.workflowTemplate?.name ?? null,
    config: parseConfig(t.configJson),
    version: t.version,
    isActive: t.isActive,
    isDefault: t.isDefault,
    projectCount: t._count.projects,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

/** The type chip on project DTOs: the live type's name and colour, the project's snapshot version. */
export function projectTypeSummary(project: {
  projectTypeVersion: number | null;
  projectType: { id: string; code: string; name: string; colour: string | null } | null;
}): ProjectTypeSummary | null {
  if (!project.projectType) return null;
  return {
    id: project.projectType.id,
    code: project.projectType.code,
    name: project.projectType.name,
    colour: project.projectType.colour,
    version: project.projectTypeVersion ?? 1,
  };
}

export const PROJECT_TYPE_SUMMARY_SELECT = { id: true, code: true, name: true, colour: true } satisfies Prisma.ProjectTypeSelect;

export async function listProjectTypes(tenantId: string, includeInactive: boolean): Promise<ProjectTypeDto[]> {
  const rows = await prisma.projectType.findMany({
    where: { tenantId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    include: TYPE_INCLUDE,
  });
  return rows.map(serializeType);
}

export async function getProjectType(tenantId: string, typeId: string): Promise<ProjectTypeDto> {
  const row = await prisma.projectType.findFirst({ where: { id: typeId, tenantId }, include: TYPE_INCLUDE });
  if (!row) throw new AppError('Project type not found', 404, 'PROJECT_TYPE_NOT_FOUND');
  return serializeType(row);
}

/** Whether the tenant has a type a new project must choose from. */
export async function tenantHasActiveProjectTypes(db: Db, tenantId: string): Promise<boolean> {
  return (await db.projectType.count({ where: { tenantId, isActive: true } })) > 0;
}

/**
 * Phase 12: refuses a workflow template whose disbursement mechanism contradicts the type's payment
 * configuration (fixed-amount payment milestones need direct verification, D-12.2; a stated
 * mechanism must match the template's).
 */
export function templateConflictsWithType(template: WorkflowTemplateConfig, config: ProjectTypeConfig): string | null {
  const mechanism = template.process.disbursementMechanism;
  const basisConflict = paymentBasisMechanismConflict(mechanism, config.payments.defaultBasis);
  if (basisConflict) return `${basisConflict} The chosen workflow template uses contractor IPC claims.`;
  if (config.payments.mechanism && config.payments.mechanism !== mechanism) {
    return 'The payment settings expect a different disbursement mechanism from the chosen workflow template.';
  }
  return null;
}

async function assertOrganizationsInTenant(tx: Tx, tenantId: string, config: ProjectTypeConfig) {
  const ids = [
    ...(config.ownership.allowedOwningOrganizationIds ?? []),
    config.ownership.defaultOwningOrganizationId,
    config.parties.defaultFunderOrganizationId,
  ].filter((v): v is string => Boolean(v));
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const found = await tx.organization.count({ where: { id: { in: unique }, tenantId } });
  if (found !== unique.length) {
    throw new AppError('The project type names an organisation that is not in this workspace', 422, 'ORGANIZATION_NOT_FOUND');
  }
}

async function saveType(webUser: WebJwtPayload, input: SaveProjectTypeRequest, typeId: string | null): Promise<ProjectTypeDto> {
  const tenantId = webUser.tenantId;
  try {
    const id = await prisma.$transaction(async (tx) => {
      const before = typeId ? await tx.projectType.findFirst({ where: { id: typeId, tenantId } }) : null;
      if (typeId && !before) throw new AppError('Project type not found', 404, 'PROJECT_TYPE_NOT_FOUND');
      const template = await tx.workflowTemplate.findFirst({ where: { id: input.workflowTemplateId, tenantId } });
      if (!template) throw new AppError('Workflow template not found', 404, 'WORKFLOW_TEMPLATE_NOT_FOUND');
      const templateConfig = WorkflowTemplateConfigSchema.safeParse(template.configJson);
      if (!templateConfig.success) {
        throw new AppError('This workflow template is not valid any more. Edit and save it first.', 422, 'INVALID_WORKFLOW_TEMPLATE');
      }
      const conflict = templateConflictsWithType(templateConfig.data, input.config);
      if (conflict) throw new AppError(conflict, 422, 'TEMPLATE_CONFLICTS_WITH_PROJECT_TYPE');
      await assertOrganizationsInTenant(tx, tenantId, input.config);
      if (input.isDefault) {
        await tx.projectType.updateMany({ where: { tenantId, isDefault: true }, data: { isDefault: false } });
      }
      const data = {
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        colour: input.colour ?? null,
        workflowTemplateId: template.id,
        configJson: input.config as unknown as Prisma.InputJsonValue,
        isActive: input.isActive,
        // An archived type cannot be the default.
        isDefault: input.isDefault && input.isActive,
      };
      const saved = before
        ? await tx.projectType.update({ where: { id: before.id }, data: { ...data, version: { increment: 1 } } })
        : await tx.projectType.create({ data: { tenantId, ...data } });
      await recordAuditEvent(tx, {
        tenantId,
        projectId: null,
        actorType: 'WEB_USER',
        actorId: webUser.userId,
        actorDisplayName: actorName(webUser),
        action: 'PROJECT_TYPE_SAVED',
        summaryText: `${before ? 'Updated' : 'Created'} project type "${saved.name}" (${saved.code}, version ${saved.version})${
          saved.isActive ? '' : ', archived'
        }.`,
        payload: {
          projectTypeId: saved.id,
          code: saved.code,
          version: saved.version,
          workflowTemplateId: saved.workflowTemplateId,
          isActive: saved.isActive,
          isDefault: saved.isDefault,
          config: input.config,
        },
      });
      return saved.id;
    });
    return getProjectType(tenantId, id);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(`A project type with code "${input.code}" already exists`, 409, 'PROJECT_TYPE_CODE_EXISTS');
    }
    throw error;
  }
}

export const createProjectType = (webUser: WebJwtPayload, input: SaveProjectTypeRequest) => saveType(webUser, input, null);
export const updateProjectType = (webUser: WebJwtPayload, typeId: string, input: SaveProjectTypeRequest) =>
  saveType(webUser, input, typeId);

/** Archives a type: no new projects can choose it; projects that have it keep their snapshot. */
export async function archiveProjectType(webUser: WebJwtPayload, typeId: string): Promise<ProjectTypeDto> {
  const current = await getProjectType(webUser.tenantId, typeId);
  return saveType(
    webUser,
    {
      code: current.code,
      name: current.name,
      description: current.description,
      colour: current.colour,
      workflowTemplateId: current.workflowTemplateId,
      isDefault: false,
      isActive: false,
      config: current.config,
    },
    typeId
  );
}

// ---------------------------------------------------------------------------
// Applying a type to a project
// ---------------------------------------------------------------------------

type ApplyProject = {
  id: string;
  tenantId: string;
  codePrefix: string;
  status: string;
  setupState: unknown;
  projectTypeId: string | null;
  owningOrganizationId: string | null;
  lenderOrganizationId: string | null;
};

function stepSaved(setupState: unknown, stepId: string): boolean {
  const steps = (setupState as { steps?: Record<string, unknown> } | null)?.steps;
  return Boolean(steps && steps[stepId]);
}

/**
 * Sets (or clears, with null) a project's type. Drafts only: a live project's type is locked.
 * Applying copies the type's workflow template into the project, writes the snapshot, and pre-fills
 * Reporting and Parties defaults without overwriting what the user already saved.
 */
export async function applyProjectTypeToProject(
  tx: Tx,
  project: ApplyProject,
  projectTypeId: string | null,
  webUser: WebJwtPayload
): Promise<{ changed: boolean; prefilled: string[] }> {
  if ((project.projectTypeId ?? null) === projectTypeId) return { changed: false, prefilled: [] };
  if (project.status !== 'DRAFT') {
    throw new AppError(
      'The project type cannot change once the project is active: its process and rules were fixed at activation.',
      409,
      'PROJECT_TYPE_LOCKED'
    );
  }
  const actor = { actorType: 'WEB_USER' as const, actorId: webUser.userId, actorDisplayName: actorName(webUser) };

  if (projectTypeId === null) {
    await tx.project.update({
      where: { id: project.id },
      data: { projectTypeId: null, projectTypeVersion: null, projectTypeSnapshotJson: Prisma.DbNull },
    });
    await recordAuditEvent(tx, {
      projectId: project.id,
      ...actor,
      action: 'PROJECT_TYPE_APPLIED',
      summaryText: 'Removed the project type from this draft (process settings kept).',
      payload: { previousProjectTypeId: project.projectTypeId, projectTypeId: null },
    });
    return { changed: true, prefilled: [] };
  }

  const type = await tx.projectType.findFirst({
    where: { id: projectTypeId, tenantId: project.tenantId },
    include: { workflowTemplate: true },
  });
  if (!type) throw new AppError('Project type not found', 404, 'PROJECT_TYPE_NOT_FOUND');
  if (!type.isActive) throw new AppError(`"${type.name}" is archived and cannot be chosen`, 409, 'PROJECT_TYPE_ARCHIVED');
  const config = parseConfig(type.configJson);

  // Process switches and both chains, through the Phase 7 service.
  await applyTemplateConfig(tx, project, type.workflowTemplate);

  const snapshot: ProjectTypeSnapshot = {
    projectTypeId: type.id,
    code: type.code,
    name: type.name,
    colour: type.colour,
    version: type.version,
    workflowTemplateId: type.workflowTemplateId,
    config,
    appliedAt: new Date().toISOString(),
  };
  const data: Prisma.ProjectUncheckedUpdateInput = {
    projectTypeId: type.id,
    projectTypeVersion: type.version,
    projectTypeSnapshotJson: snapshot as unknown as Prisma.InputJsonValue,
  };
  const prefilled: string[] = [];
  if (!project.owningOrganizationId && config.ownership.defaultOwningOrganizationId) {
    data.owningOrganizationId = config.ownership.defaultOwningOrganizationId;
    prefilled.push('owningOrganizationId');
  }
  const owner = (data.owningOrganizationId as string | undefined) ?? project.owningOrganizationId;
  if (!project.lenderOrganizationId) {
    const funder =
      config.parties.funderDefault === 'FIXED'
        ? config.parties.defaultFunderOrganizationId
        : config.parties.funderDefault === 'OWNER'
          ? owner
          : null;
    if (funder) {
      data.lenderOrganizationId = funder;
      prefilled.push('lenderOrganizationId');
    }
  }
  if (config.reportingDefaults && !stepSaved(project.setupState, 'reporting')) {
    const r = ProjectReportingStepSchema.parse(config.reportingDefaults);
    Object.assign(data, r);
    prefilled.push('reporting');
  }
  await tx.project.update({ where: { id: project.id }, data });
  // Phase 14: the type's reporting streams replace the draft's.
  if (config.reportingStreams.length > 0) {
    const created = await createStreamsFromProjectType(tx, { projectId: project.id, tenantId: project.tenantId, streams: config.reportingStreams });
    if (created.length) prefilled.push('reportingStreams');
  }

  await recordAuditEvent(tx, {
    projectId: project.id,
    ...actor,
    action: 'PROJECT_TYPE_APPLIED',
    summaryText: `Applied project type "${type.name}" (version ${type.version}) with workflow template "${type.workflowTemplate.name}".`,
    payload: {
      previousProjectTypeId: project.projectTypeId,
      projectTypeId: type.id,
      projectTypeVersion: type.version,
      workflowTemplateId: type.workflowTemplateId,
      prefilled,
    },
  });
  return { changed: true, prefilled };
}
