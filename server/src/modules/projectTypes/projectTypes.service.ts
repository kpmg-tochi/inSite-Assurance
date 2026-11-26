import { Prisma } from '@prisma/client';
import {
  ProjectTypeConfig,
  ProjectTypeConfigSchema,
  ProjectTypeDto,
  ProjectTypeSnapshot,
  ProjectTypeSummary,
  resolveProjectTypeConfig,
  VISIT_KIND_META,
  VisitKind,
  SaveProjectTypeRequest,
  WorkflowTemplateConfig,
  WorkflowTemplateConfigSchema,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { liveTemplateKinds } from '../forms/formLibrary.service';
import { ensureFormLibrary } from '../forms/formLibraryProvisioning';
import { applyTemplateConfig } from '../process/processConfig.service';
import { syncContractMilestones } from '../contracts/milestones.service';

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

/**
 * Redesign R3 (D-R3.18): each visit form template code the type names must be a live template of that
 * visit kind. Only codes that changed are checked, so archiving a type never fails on a template
 * archived since.
 */
async function assertVisitFormTemplates(tx: Tx, tenantId: string, config: ProjectTypeConfig, before: unknown) {
  const previous = resolveProjectTypeConfig({ config: before ?? {} })?.visitForms.templateCodeByVisitKind ?? {};
  const changed = (Object.entries(config.visitForms.templateCodeByVisitKind) as Array<[VisitKind, string | undefined]>).filter(
    ([kind, code]) => code && previous[kind] !== code
  );
  if (changed.length === 0) return;
  await ensureFormLibrary(tx, tenantId);
  const live = await liveTemplateKinds(tx, tenantId);
  for (const [kind, code] of changed) {
    const kindOfCode = live.get(code!);
    if (!kindOfCode) throw new AppError(`Monitoring form template ${code} does not exist or is archived`, 422, 'VISIT_FORM_TEMPLATE_NOT_FOUND');
    if (kindOfCode !== kind) {
      throw new AppError(`Template ${code} is for ${VISIT_KIND_META[kindOfCode].label} monitoring visits, not ${VISIT_KIND_META[kind].label}`, 422, 'TEMPLATE_KIND_MISMATCH');
    }
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
      await assertOrganizationsInTenant(tx, tenantId, input.config);
      await assertVisitFormTemplates(tx, tenantId, input.config, before?.configJson);
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

/** What `deriveOwnerAndFunder` last wrote, kept in `setupState.derivedParties`. */
interface DerivedParties {
  owningOrganizationId?: string | null;
  lenderOrganizationId?: string | null;
}

/** Matching Grants-like types: the state's SUBEB owns the project. */
function isMatchingGrantsType(snapshot: { code?: unknown; name?: unknown }): boolean {
  return snapshot.code === 'CO_FUNDED' || (typeof snapshot.name === 'string' && /matching/i.test(snapshot.name));
}

const SUBEB_RE = /SUBEB/i;

/**
 * Client demo updates D2 (wave 2): a typed draft's owner and funder, derived instead of asked.
 *
 * Owner:
 * - Matching Grants-like type (code CO_FUNDED, or "Matching" in its name): the workspace
 *   organisation with `stateCode` = the project's state whose name contains "SUBEB"; none: unchanged.
 * - Any other type (Direct Intervention): the UBEC state office of the project's state (an
 *   owner-category organisation with that `stateCode` whose name does not contain "SUBEB"); else the
 *   type's default owner; else, when the type requires an owner, the workspace's root owner
 *   organisation (UBEC HQ: no parent, category CLIENT_OWNER, oldest).
 * - A candidate the type's allowed-owner list excludes is skipped.
 * Funder: the type's funder default (FIXED: its organisation; OWNER: the owner); with no default,
 * the root owner organisation when the type requires a funder.
 *
 * A value is replaced only when it is empty, or when it is still the value this function derived
 * last and no user has saved the parties section. Drafts only. Returns the fields it changed.
 */
export async function deriveOwnerAndFunder(tx: Tx, projectId: string): Promise<string[]> {
  const p = await tx.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      tenantId: true,
      status: true,
      stateCode: true,
      projectTypeSnapshotJson: true,
      owningOrganizationId: true,
      lenderOrganizationId: true,
      setupState: true,
    },
  });
  if (p.status !== 'DRAFT' || !p.projectTypeSnapshotJson || typeof p.projectTypeSnapshotJson !== 'object') return [];
  const snapshot = p.projectTypeSnapshotJson as Record<string, unknown>;
  const config = resolveProjectTypeConfig(snapshot)!;
  const state = p.setupState && typeof p.setupState === 'object' ? (p.setupState as Record<string, unknown>) : {};
  const partiesSaved = stepSaved(state, 'parties');
  const previous = (state.derivedParties && typeof state.derivedParties === 'object' ? state.derivedParties : {}) as DerivedParties;
  const mayReplace = (current: string | null, derivedBefore: string | null | undefined) =>
    !current || (!partiesSaved && Boolean(derivedBefore) && current === derivedBefore);

  const allowed = config.ownership.allowedOwningOrganizationIds;
  const isAllowed = (id: string) => !allowed || allowed.includes(id);
  let rootId: string | null | undefined;
  const root = async () => {
    if (rootId === undefined) {
      const r = await tx.organization.findFirst({
        where: { tenantId: p.tenantId, parentOrganizationId: null, isArchived: false, categories: { has: 'CLIENT_OWNER' } },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      rootId = r?.id ?? null;
    }
    return rootId;
  };

  const inState = p.stateCode
    ? await tx.organization.findMany({
        where: { tenantId: p.tenantId, stateCode: p.stateCode, isArchived: false },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, categories: true },
      })
    : [];
  let ownerCandidate: string | null = null;
  if (isMatchingGrantsType(snapshot)) {
    ownerCandidate = inState.find((o) => SUBEB_RE.test(o.name) && isAllowed(o.id))?.id ?? null;
  } else {
    ownerCandidate =
      inState.find((o) => !SUBEB_RE.test(o.name) && o.categories.includes('CLIENT_OWNER') && isAllowed(o.id))?.id ??
      config.ownership.defaultOwningOrganizationId ??
      null;
    if (!ownerCandidate && config.ownership.owningOrganizationRequired) {
      const r = await root();
      ownerCandidate = r && isAllowed(r) ? r : null;
    }
  }

  const data: Prisma.ProjectUncheckedUpdateInput = {};
  const changed: string[] = [];
  let owner = p.owningOrganizationId;
  if (ownerCandidate && ownerCandidate !== owner && mayReplace(owner, previous.owningOrganizationId)) {
    owner = ownerCandidate;
    data.owningOrganizationId = owner;
    changed.push('owningOrganizationId');
  }

  const funderCandidate =
    config.parties.funderDefault === 'FIXED'
      ? config.parties.defaultFunderOrganizationId
      : config.parties.funderDefault === 'OWNER'
        ? owner
        : config.parties.funderRequired
          ? await root()
          : null;
  let funder = p.lenderOrganizationId;
  if (funderCandidate && funderCandidate !== funder && mayReplace(funder, previous.lenderOrganizationId)) {
    funder = funderCandidate;
    data.lenderOrganizationId = funder;
    changed.push('lenderOrganizationId');
  }

  const derived: DerivedParties = {
    owningOrganizationId: ownerCandidate && owner === ownerCandidate ? ownerCandidate : (previous.owningOrganizationId ?? null),
    lenderOrganizationId: funderCandidate && funder === funderCandidate ? funderCandidate : (previous.lenderOrganizationId ?? null),
  };
  if (
    changed.length > 0 ||
    derived.owningOrganizationId !== (previous.owningOrganizationId ?? null) ||
    derived.lenderOrganizationId !== (previous.lenderOrganizationId ?? null)
  ) {
    data.setupState = { ...state, derivedParties: derived } as unknown as Prisma.InputJsonValue;
    await tx.project.update({ where: { id: projectId }, data });
  }
  return changed;
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
    // Phase 13: open contract milestones from the old type go.
    await syncContractMilestones(tx, project.id);
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
  // Redesign R1b: retention defaults, unless the retention step was saved already.
  if (!stepSaved(project.setupState, 'facility')) {
    if (config.payments.retentionPercentage !== null) {
      data.retentionPercentage = config.payments.retentionPercentage;
      prefilled.push('retentionPercentage');
    }
    if (config.payments.retentionDurationMonths !== null) {
      data.retentionDurationMonths = config.payments.retentionDurationMonths;
      prefilled.push('retentionDurationMonths');
    }
  }
  await tx.project.update({ where: { id: project.id }, data });
  // Owner and funder: derived from the type and the project's state (client demo updates D2), never
  // overwriting what a user saved.
  prefilled.push(...(await deriveOwnerAndFunder(tx, project.id)));
  // Phase 13: contract milestones from the type (one per contractor where the template says so).
  const milestones = await syncContractMilestones(tx, project.id);
  if (milestones.created) prefilled.push('contractMilestones');

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
