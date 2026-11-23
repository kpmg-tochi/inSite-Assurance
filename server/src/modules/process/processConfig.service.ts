import { Prisma } from '@prisma/client';
import {
  ApprovalChainDto,
  ApprovalChainType,
  ApprovalStepConfig,
  DEFAULT_PROJECT_PROCESS_CONFIG,
  defaultReportChain,
  defaultContractDefaultChain,
  resolveProjectTypeConfig,
  ProjectProcessConfig,
  ProjectProcessConfigSchema,
  ProjectProcessSettingsDto,
  validateApprovalChain,
  WorkflowTemplateConfig,
  WorkflowTemplateConfigSchema,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { clearRequestMemo, getRequestMemo, setRequestMemo } from '../../utils/requestContext';
import { recordAuditEvent } from '../audit/audit.service';
import { issueMissingJoinCodes } from '../projects/joinCodes.service';

/**
 * Process configuration (Phase 7). Every service that branches on a setting reads it through
 * `getProcessConfig`, which memoises per request. A project with no row behaves as the defaults
 * (the Phase 3 / Phase 4 behaviour).
 */

type Db = Prisma.TransactionClient | typeof prisma;
type Tx = Prisma.TransactionClient;

const memoKey = (projectId: string) => `processConfig:${projectId}`;

const CONFIG_SELECT = {
  workflowTemplateId: true,
  needsAssessmentMode: true,
  standardsSpecificationMode: true,
  enableHoldPoints: true,
  allowContractorFieldReporting: true,
  enableContractorIdentityAssurance: true,
  enableAiOmissionCheck: true,
  enableAiStandardsCheck: true,
  requireReportApproval: true,
  enableHandoverModule: true,
  enableRetentionModule: true,
} satisfies Prisma.ProjectProcessConfigSelect;

type ConfigRow = Prisma.ProjectProcessConfigGetPayload<{ select: typeof CONFIG_SELECT }>;

function configFromRow(row: ConfigRow | null): ProjectProcessConfig {
  if (!row) return { ...DEFAULT_PROJECT_PROCESS_CONFIG };
  const { workflowTemplateId: _ignored, ...rest } = row;
  return ProjectProcessConfigSchema.parse(rest);
}

/** The project's process configuration. Pass `tx` inside a transaction (never memoised then). */
export async function getProcessConfig(projectId: string, db: Db = prisma): Promise<ProjectProcessConfig> {
  if (db === prisma) {
    const cached = getRequestMemo<ProjectProcessConfig>(memoKey(projectId));
    if (cached) return cached;
  }
  const row = await db.projectProcessConfig.findUnique({ where: { projectId }, select: CONFIG_SELECT });
  const config = configFromRow(row);
  if (db === prisma) setRequestMemo(memoKey(projectId), config);
  return config;
}

/**
 * Contractor field reporting off (Phase 7): contractor-executor sessions that already exist (join
 * codes are deactivated, but sessions live on) may not register captures or submit reports.
 */
export async function assertFieldReportingAllowed(projectId: string, fieldPersonaType: string): Promise<void> {
  if (fieldPersonaType !== 'CONTRACTOR_EXECUTOR') return;
  if ((await getProcessConfig(projectId)).allowContractorFieldReporting) return;
  throw new AppError(
    'Contractor reporting is off for this project.',
    403,
    'CONTRACTOR_FIELD_REPORTING_DISABLED'
  );
}

// ---------------------------------------------------------------------------
// Chains
// ---------------------------------------------------------------------------

export type ApprovalStepRow = Prisma.ApprovalStepGetPayload<object>;

/** Steps of one chain version, in order. */
export async function getChainVersionSteps(
  db: Db,
  projectId: string,
  chainType: ApprovalChainType,
  version: number
): Promise<ApprovalStepRow[]> {
  return db.approvalStep.findMany({
    where: { projectId, chainType, version },
    orderBy: { stepOrder: 'asc' },
  });
}

/** The current chain (highest active version), or null when the project has none yet. */
export async function getActiveChain(
  db: Db,
  projectId: string,
  chainType: ApprovalChainType
): Promise<{ version: number; steps: ApprovalStepRow[] } | null> {
  const latest = await db.approvalStep.findFirst({
    where: { projectId, chainType, isActive: true },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  if (!latest) return null;
  return { version: latest.version, steps: await getChainVersionSteps(db, projectId, chainType, latest.version) };
}

function defaultChainFor(chainType: ApprovalChainType, config: ProjectProcessConfig): ApprovalStepConfig[] {
  if (chainType === 'CONTRACT_DEFAULT') return defaultContractDefaultChain({ hasOwner: false });
  void config;
  return defaultReportChain();
}

/**
 * Phase 13: the default contract default chain for a project. The decision step is limited to the
 * owning organisation when there is one; the review step names the project type's Legal role.
 */
async function projectDefaultChainFor(db: Db, projectId: string, chainType: ApprovalChainType, config: ProjectProcessConfig) {
  if (chainType !== 'CONTRACT_DEFAULT') return defaultChainFor(chainType, config);
  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { tenantId: true, owningOrganizationId: true, projectTypeSnapshotJson: true },
  });
  const legalCode = resolveProjectTypeConfig(project.projectTypeSnapshotJson)?.defaultCases.legalRoleCode ?? null;
  const legal = legalCode
    ? await db.role.findFirst({ where: { tenantId: project.tenantId, code: legalCode }, select: { id: true } })
    : null;
  return defaultContractDefaultChain({ hasOwner: Boolean(project.owningOrganizationId), legalRoleId: legal?.id ?? null });
}

/** The current chain, creating the default as version 1 when the project has none. */
export async function ensureChain(
  tx: Tx,
  projectId: string,
  chainType: ApprovalChainType
): Promise<{ version: number; steps: ApprovalStepRow[] }> {
  const existing = await getActiveChain(tx, projectId, chainType);
  if (existing) return existing;
  const config = await getProcessConfig(projectId, tx);
  return writeChainVersion(tx, projectId, chainType, await projectDefaultChainFor(tx, projectId, chainType, config), config);
}

/**
 * Writes a new chain version and retires the previous one. Never edits steps in place: items in
 * flight keep pointing at the version they started on.
 */
export async function writeChainVersion(
  tx: Tx,
  projectId: string,
  chainType: ApprovalChainType,
  steps: ApprovalStepConfig[],
  _config: ProjectProcessConfig
): Promise<{ version: number; steps: ApprovalStepRow[] }> {
  const issues = validateApprovalChain(chainType, steps);
  if (issues.length > 0) {
    throw new AppError(issues[0].message, 422, 'INVALID_APPROVAL_CHAIN', { chainType, issues });
  }
  const roleIds = [...new Set(steps.map((s) => s.requiredRoleId).filter((id): id is string => Boolean(id)))];
  if (roleIds.length > 0) {
    const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { tenantId: true } });
    const found = await tx.role.count({ where: { id: { in: roleIds }, tenantId: project.tenantId } });
    if (found !== roleIds.length) {
      throw new AppError('A step names a role that is not in this workspace', 422, 'INVALID_APPROVAL_CHAIN_ROLE');
    }
  }
  const last = await tx.approvalStep.aggregate({ where: { projectId, chainType }, _max: { version: true } });
  const version = (last._max.version ?? 0) + 1;
  await tx.approvalStep.updateMany({ where: { projectId, chainType, isActive: true }, data: { isActive: false } });
  await tx.approvalStep.createMany({
    data: steps.map((s, i) => ({
      projectId,
      chainType,
      version,
      stepOrder: i + 1,
      label: s.label,
      requiredPermissionKey: s.requiredPermissionKey,
      requiredRoleId: s.requiredRoleId ?? null,
      minAmountThresholdNgn: s.minAmountThresholdNgn ?? null,
      isSystemStep: s.isSystemStep ?? false,
      organizationScope: s.organizationScope ?? 'ANY',
      isActive: true,
    })),
  });
  return { version, steps: await getChainVersionSteps(tx, projectId, chainType, version) };
}

function stepsEqual(rows: ApprovalStepRow[], input: ApprovalStepConfig[]): boolean {
  if (rows.length !== input.length) return false;
  return rows.every((r, i) => {
    const s = input[i];
    return (
      r.label === s.label &&
      r.requiredPermissionKey === s.requiredPermissionKey &&
      (r.requiredRoleId ?? null) === (s.requiredRoleId ?? null) &&
      (r.minAmountThresholdNgn === null ? null : Number(r.minAmountThresholdNgn)) === (s.minAmountThresholdNgn ?? null) &&
      r.isSystemStep === (s.isSystemStep ?? false) &&
      r.organizationScope === (s.organizationScope ?? 'ANY')
    );
  });
}

// ---------------------------------------------------------------------------
// Settings DTO
// ---------------------------------------------------------------------------

async function serializeChain(
  db: Db,
  projectId: string,
  chainType: ApprovalChainType,
  config: ProjectProcessConfig
): Promise<ApprovalChainDto> {
  const chain = await getActiveChain(db, projectId, chainType);
  const roleIds = (chain?.steps ?? []).map((s) => s.requiredRoleId).filter((id): id is string => Boolean(id));
  const roles = roleIds.length
    ? await db.role.findMany({ where: { id: { in: roleIds } }, select: { id: true, name: true } })
    : [];
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  if (!chain) {
    // Not written yet: show the default the project will get on first use.
    return {
      chainType,
      version: 0,
      steps: (await projectDefaultChainFor(db, projectId, chainType, config)).map((s, i) => ({
        id: '00000000-0000-0000-0000-000000000000',
        chainType,
        stepOrder: i + 1,
        label: s.label,
        requiredPermissionKey: s.requiredPermissionKey,
        requiredRoleId: s.requiredRoleId ?? null,
        requiredRoleName: null,
        minAmountThresholdNgn: s.minAmountThresholdNgn ?? null,
        isSystemStep: s.isSystemStep,
        organizationScope: s.organizationScope ?? 'ANY',
        version: 0,
      })),
    };
  }
  return {
    chainType,
    version: chain.version,
    steps: chain.steps.map((s) => ({
      id: s.id,
      chainType,
      stepOrder: s.stepOrder,
      label: s.label,
      requiredPermissionKey: s.requiredPermissionKey,
      requiredRoleId: s.requiredRoleId,
      requiredRoleName: s.requiredRoleId ? roleName.get(s.requiredRoleId) ?? null : null,
      minAmountThresholdNgn: s.minAmountThresholdNgn === null ? null : Number(s.minAmountThresholdNgn),
      isSystemStep: s.isSystemStep,
      organizationScope: s.organizationScope,
      version: s.version,
    })),
  };
}

async function activeContractorCodeCount(db: Db, projectId: string): Promise<number> {
  return db.projectJoinCode.count({
    where: { projectId, isActive: true, role: { fieldPersonaType: 'CONTRACTOR_EXECUTOR' } },
  });
}

export async function getProjectProcessSettings(projectId: string, db: Db = prisma): Promise<ProjectProcessSettingsDto> {
  const row = await db.projectProcessConfig.findUnique({ where: { projectId }, select: CONFIG_SELECT });
  const config = configFromRow(row);
  const template = row?.workflowTemplateId
    ? await db.workflowTemplate.findUnique({ where: { id: row.workflowTemplateId }, select: { id: true, name: true } })
    : null;
  const [reportChain, contractDefaultChain, codeCount] = await Promise.all([
    serializeChain(db, projectId, 'REPORT', config),
    serializeChain(db, projectId, 'CONTRACT_DEFAULT', config),
    activeContractorCodeCount(db, projectId),
  ]);
  return {
    projectId,
    config,
    workflowTemplateId: template?.id ?? null,
    workflowTemplateName: template?.name ?? null,
    reportChain,
    contractDefaultChain,
    activeContractorJoinCodeCount: codeCount,
  };
}

// ---------------------------------------------------------------------------
// Writing settings
// ---------------------------------------------------------------------------

export interface ProcessSettingsInput {
  config: ProjectProcessConfig;
  reportChain?: ApprovalStepConfig[];
  /** Phase 13: written only when given (the default is created on first use). */
  contractDefaultChain?: ApprovalStepConfig[];
  /** Set when copying a template; undefined keeps the current provenance, null clears it. */
  workflowTemplateId?: string | null;
  confirmDeactivateContractorCodes?: boolean;
}

/**
 * Applies process settings to a project inside the caller's transaction (wizard step, settings
 * page, template application). Returns the changed fields; the caller audits.
 *
 * Effects on live projects:
 * - contractor field reporting off: contractor-executor join codes are deactivated, which needs
 *   `confirmDeactivateContractorCodes`; back on: missing contractor codes are issued again.
 * - chain edits write a new version; items in flight finish on theirs.
 */
export async function applyProcessSettings(
  tx: Tx,
  project: { id: string; tenantId: string; codePrefix: string; status: string; setupState: unknown },
  input: ProcessSettingsInput
): Promise<{ changedFields: string[]; deactivatedJoinCodes: number; issuedJoinCodes: string[] }> {
  const projectId = project.id;
  const beforeRow = await tx.projectProcessConfig.findUnique({ where: { projectId }, select: CONFIG_SELECT });
  const before = configFromRow(beforeRow);
  const next = ProjectProcessConfigSchema.parse(input.config);

  const changedFields: string[] = (Object.keys(next) as Array<keyof ProjectProcessConfig>).filter((k) => before[k] !== next[k]);

  let deactivatedJoinCodes = 0;
  let issuedJoinCodes: string[] = [];
  if (project.status === 'ACTIVE' && before.allowContractorFieldReporting && !next.allowContractorFieldReporting) {
    const count = await activeContractorCodeCount(tx, projectId);
    if (count > 0 && !input.confirmDeactivateContractorCodes) {
      throw new AppError(
        `Turning contractor field reporting off deactivates ${count} contractor join code(s). Confirm to continue.`,
        409,
        'CONFIRMATION_REQUIRED',
        { activeContractorJoinCodeCount: count }
      );
    }
    const res = await tx.projectJoinCode.updateMany({
      where: { projectId, isActive: true, role: { fieldPersonaType: 'CONTRACTOR_EXECUTOR' } },
      data: { isActive: false },
    });
    deactivatedJoinCodes = res.count;
  }

  await tx.projectProcessConfig.upsert({
    where: { projectId },
    create: {
      projectId,
      ...next,
      workflowTemplateId: input.workflowTemplateId ?? null,
    },
    update: {
      ...next,
      ...(input.workflowTemplateId !== undefined ? { workflowTemplateId: input.workflowTemplateId } : {}),
    },
  });
  clearRequestMemo(memoKey(projectId));

  if (project.status === 'ACTIVE' && !before.allowContractorFieldReporting && next.allowContractorFieldReporting) {
    const state = (project.setupState ?? {}) as { team?: { joinCodeRoleIds?: string[] | null } };
    const chosen = Array.isArray(state.team?.joinCodeRoleIds) ? state.team!.joinCodeRoleIds! : null;
    const roles = await tx.role.findMany({
      where: {
        tenantId: project.tenantId,
        surface: { in: ['MOBILE', 'BOTH'] },
        onboardingMode: 'JOIN_CODE',
        fieldPersonaType: 'CONTRACTOR_EXECUTOR',
        ...(chosen ? { id: { in: chosen } } : {}),
      },
    });
    issuedJoinCodes = (await issueMissingJoinCodes(tx, project, roles)).map((jc) => jc.code);
  }

  // The report chain: write a new version only when the steps actually change.
  {
    const chainType = 'REPORT' as const;
    const wanted = input.reportChain;
    const current = await getActiveChain(tx, projectId, chainType);
    const base =
      wanted ??
      (current
        ? current.steps.map((s) => ({
            label: s.label,
            requiredPermissionKey: s.requiredPermissionKey,
            requiredRoleId: s.requiredRoleId,
            minAmountThresholdNgn: s.minAmountThresholdNgn === null ? null : Number(s.minAmountThresholdNgn),
            isSystemStep: s.isSystemStep,
            organizationScope: s.organizationScope,
          }))
        : null);
    if (!base) {
      await writeChainVersion(tx, projectId, chainType, defaultChainFor(chainType, next), next);
    } else if (!current || !stepsEqual(current.steps, base)) {
      await writeChainVersion(tx, projectId, chainType, base, next);
      changedFields.push('reportChain');
    }
  }

  if (input.contractDefaultChain) {
    const current = await getActiveChain(tx, projectId, 'CONTRACT_DEFAULT');
    if (!current || !stepsEqual(current.steps, input.contractDefaultChain)) {
      await writeChainVersion(tx, projectId, 'CONTRACT_DEFAULT', input.contractDefaultChain, next);
      changedFields.push('contractDefaultChain');
    }
  }

  return { changedFields, deactivatedJoinCodes, issuedJoinCodes };
}

/** Creates the config row and the report chain for a new draft, from the tenant's default template if any. */
export async function initialiseProjectProcess(
  tx: Tx,
  project: { id: string; tenantId: string; codePrefix: string; status: string; setupState: unknown }
): Promise<void> {
  const template = await tx.workflowTemplate.findFirst({
    where: { tenantId: project.tenantId, isDefault: true },
    orderBy: { updatedAt: 'desc' },
  });
  const parsed = template ? WorkflowTemplateConfigSchema.safeParse(template.configJson) : null;
  if (template && parsed?.success) {
    await applyProcessSettings(tx, project, {
      config: parsed.data.process,
      reportChain: parsed.data.reportChain,
      workflowTemplateId: template.id,
    });
    return;
  }
  await applyProcessSettings(tx, project, { config: { ...DEFAULT_PROJECT_PROCESS_CONFIG } });
}

/** Copies a template into a project's own rows. Later template edits do not change the project. */
export async function applyTemplateConfig(
  tx: Tx,
  project: { id: string; tenantId: string; codePrefix: string; status: string; setupState: unknown },
  template: { id: string; configJson: unknown },
  confirmDeactivateContractorCodes?: boolean
) {
  const parsed = WorkflowTemplateConfigSchema.safeParse(template.configJson);
  if (!parsed.success) {
    throw new AppError('This template is not valid any more. Edit and save it first.', 422, 'INVALID_WORKFLOW_TEMPLATE');
  }
  const cfg: WorkflowTemplateConfig = parsed.data;
  return applyProcessSettings(tx, project, {
    config: cfg.process,
    reportChain: cfg.reportChain,
    workflowTemplateId: template.id,
    confirmDeactivateContractorCodes,
  });
}

const actorName = (u: WebJwtPayload) => `${u.fullName} (${u.roleName})`;

async function lockProjectForSettings(tx: Tx, projectId: string) {
  await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId}::uuid FOR UPDATE`;
  const project = await tx.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { id: true, tenantId: true, codePrefix: true, status: true, setupState: true },
  });
  if (project.status === 'ARCHIVED') {
    throw new AppError('This project is archived and read-only', 409, 'PROJECT_ARCHIVED');
  }
  return project;
}

async function auditSettingsChange(
  tx: Tx,
  projectId: string,
  webUser: WebJwtPayload,
  result: { changedFields: string[]; deactivatedJoinCodes: number; issuedJoinCodes: string[] },
  extra: Record<string, unknown> = {}
) {
  await recordAuditEvent(tx, {
    projectId,
    actorType: 'WEB_USER',
    actorId: webUser.userId,
    actorDisplayName: actorName(webUser),
    action: 'PROJECT_PROCESS_CONFIG_UPDATED',
    summaryText: result.changedFields.length
      ? `Changed process settings (${result.changedFields.join(', ')}).${
          result.deactivatedJoinCodes ? ` Deactivated ${result.deactivatedJoinCodes} contractor join code(s).` : ''
        }`
      : 'Saved process settings (no changes).',
    payload: { ...result, ...extra },
  });
}

/** PUT /projects/:projectId/process: the switches. Chains keep their steps. */
export async function updateProjectProcessConfig(
  projectId: string,
  webUser: WebJwtPayload,
  input: { config: ProjectProcessConfig; confirmDeactivateContractorCodes?: boolean }
): Promise<ProjectProcessSettingsDto> {
  await prisma.$transaction(async (tx) => {
    const project = await lockProjectForSettings(tx, projectId);
    const result = await applyProcessSettings(tx, project, input);
    await auditSettingsChange(tx, projectId, webUser, result);
  });
  return getProjectProcessSettings(projectId);
}

/** PUT /projects/:projectId/process/chains/:chainType: writes a new chain version. */
export async function replaceProjectChain(
  projectId: string,
  chainType: ApprovalChainType,
  webUser: WebJwtPayload,
  steps: ApprovalStepConfig[]
): Promise<ProjectProcessSettingsDto> {
  await prisma.$transaction(async (tx) => {
    const project = await lockProjectForSettings(tx, projectId);
    const config = await getProcessConfig(projectId, tx);
    const result = await applyProcessSettings(tx, project, {
      config,
      ...(chainType === 'REPORT' ? { reportChain: steps } : { contractDefaultChain: steps }),
    });
    await auditSettingsChange(tx, projectId, webUser, result, { chainType });
  });
  return getProjectProcessSettings(projectId);
}

/** POST /projects/:projectId/process/apply-template. */
export async function applyTemplateToProject(
  projectId: string,
  templateId: string,
  webUser: WebJwtPayload,
  confirmDeactivateContractorCodes?: boolean
): Promise<ProjectProcessSettingsDto> {
  await prisma.$transaction(async (tx) => {
    const project = await lockProjectForSettings(tx, projectId);
    const template = await tx.workflowTemplate.findFirst({ where: { id: templateId, tenantId: project.tenantId } });
    if (!template) throw new AppError('Workflow template not found', 404, 'WORKFLOW_TEMPLATE_NOT_FOUND');
    const result = await applyTemplateConfig(tx, project, template, confirmDeactivateContractorCodes);
    await auditSettingsChange(tx, projectId, webUser, result, { appliedTemplateId: template.id, appliedTemplateName: template.name });
  });
  return getProjectProcessSettings(projectId);
}
