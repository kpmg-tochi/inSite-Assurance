import { Prisma } from '@prisma/client';
import {
  DEFAULT_PROJECT_PROCESS_CONFIG,
  defaultReportChain,
  SaveWorkflowTemplateRequest,
  WorkflowTemplateConfig,
  WorkflowTemplateConfigSchema,
  WorkflowTemplateDto,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';

/** Workflow templates (Phase 7): reusable process settings per tenant. */

type Tx = Prisma.TransactionClient;
type TemplateRow = Prisma.WorkflowTemplateGetPayload<object>;

function serializeTemplate(t: TemplateRow): WorkflowTemplateDto {
  const parsed = WorkflowTemplateConfigSchema.safeParse(t.configJson);
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    isDefault: t.isDefault,
    // A template saved by an older release that no longer validates shows the defaults; saving fixes it.
    config: parsed.success ? parsed.data : starterTemplates()[0].config,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

/** The three starter templates every tenant gets (Phase 7 Step 2). */
export function starterTemplates(): Array<{ name: string; description: string; isDefault: boolean; config: WorkflowTemplateConfig }> {
  return [
    {
      name: 'Standard monitoring',
      description: 'Contractor and monitor field reporting, hold points on, standards optional.',
      isDefault: true,
      config: {
        process: { ...DEFAULT_PROJECT_PROCESS_CONFIG },
        reportChain: defaultReportChain(),
      },
    },
    {
      name: 'M&E-only oversight',
      description:
        'Independent verifiers report; contractors do not. Reports need approval. Needs assessment and standards are required before activation.',
      isDefault: false,
      config: {
        process: {
          ...DEFAULT_PROJECT_PROCESS_CONFIG,
          needsAssessmentMode: 'REQUIRED_AT_CREATION',
          standardsSpecificationMode: 'REQUIRED_AT_CREATION',
          requireReportApproval: true,
        },
        reportChain: defaultReportChain(),
      },
    },
    {
      name: 'Lightweight monitoring',
      description: 'Verifier reporting only, no report approval, standards optional.',
      isDefault: false,
      config: {
        process: {
          ...DEFAULT_PROJECT_PROCESS_CONFIG,
        },
        reportChain: defaultReportChain(),
      },
    },
  ];
}

/** Creates the starter templates for a tenant that has none (seed and tenant provisioning). */
export async function seedStarterTemplates(tx: Tx | typeof prisma, tenantId: string): Promise<void> {
  const count = await tx.workflowTemplate.count({ where: { tenantId } });
  if (count > 0) return;
  for (const t of starterTemplates()) {
    await tx.workflowTemplate.create({
      data: {
        tenantId,
        name: t.name,
        description: t.description,
        isDefault: t.isDefault,
        configJson: t.config as unknown as Prisma.InputJsonValue,
      },
    });
  }
}

export async function listWorkflowTemplates(tenantId: string): Promise<WorkflowTemplateDto[]> {
  const rows = await prisma.workflowTemplate.findMany({
    where: { tenantId },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  });
  return rows.map(serializeTemplate);
}

const actorName = (u: WebJwtPayload) => `${u.fullName} (${u.roleName})`;

async function saveTemplate(
  webUser: WebJwtPayload,
  input: SaveWorkflowTemplateRequest,
  templateId: string | null
): Promise<WorkflowTemplateDto> {
  const tenantId = webUser.tenantId;
  const row = await prisma.$transaction(async (tx) => {
    if (templateId) {
      const existing = await tx.workflowTemplate.findFirst({ where: { id: templateId, tenantId } });
      if (!existing) throw new AppError('Workflow template not found', 404, 'WORKFLOW_TEMPLATE_NOT_FOUND');
    }
    const clash = await tx.workflowTemplate.findFirst({
      where: { tenantId, name: { equals: input.name, mode: 'insensitive' }, ...(templateId ? { id: { not: templateId } } : {}) },
      select: { id: true },
    });
    if (clash) throw new AppError(`A template named "${input.name}" already exists`, 409, 'DUPLICATE_TEMPLATE_NAME');
    if (input.isDefault) {
      await tx.workflowTemplate.updateMany({ where: { tenantId, isDefault: true }, data: { isDefault: false } });
    }
    const data = {
      name: input.name,
      description: input.description ?? null,
      isDefault: input.isDefault,
      configJson: input.config as unknown as Prisma.InputJsonValue,
    };
    const saved = templateId
      ? await tx.workflowTemplate.update({ where: { id: templateId }, data })
      : await tx.workflowTemplate.create({ data: { tenantId, ...data } });
    await recordAuditEvent(tx, {
      tenantId,
      projectId: null,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'WORKFLOW_TEMPLATE_SAVED',
      summaryText: `${templateId ? 'Updated' : 'Created'} workflow template "${saved.name}"${saved.isDefault ? ' (default for new projects)' : ''}.`,
      payload: { templateId: saved.id, name: saved.name, isDefault: saved.isDefault, config: input.config },
    });
    return saved;
  });
  return serializeTemplate(row);
}

export const createWorkflowTemplate = (webUser: WebJwtPayload, input: SaveWorkflowTemplateRequest) =>
  saveTemplate(webUser, input, null);

export const updateWorkflowTemplate = (webUser: WebJwtPayload, templateId: string, input: SaveWorkflowTemplateRequest) =>
  saveTemplate(webUser, input, templateId);

/** Deleting a template never changes the projects it was applied to (they hold their own copy). */
export async function deleteWorkflowTemplate(webUser: WebJwtPayload, templateId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.workflowTemplate.findFirst({ where: { id: templateId, tenantId: webUser.tenantId } });
    if (!existing) throw new AppError('Workflow template not found', 404, 'WORKFLOW_TEMPLATE_NOT_FOUND');
    // Phase 11: a project type references its template; pick another template on the type first.
    const types = await tx.projectType.findMany({ where: { workflowTemplateId: templateId }, select: { name: true } });
    if (types.length > 0) {
      throw new AppError(
        `This template is used by project type(s): ${types.map((t) => t.name).join(', ')}. Choose another template on them first.`,
        409,
        'WORKFLOW_TEMPLATE_IN_USE'
      );
    }
    await tx.projectProcessConfig.updateMany({ where: { workflowTemplateId: templateId }, data: { workflowTemplateId: null } });
    await tx.workflowTemplate.delete({ where: { id: templateId } });
    await recordAuditEvent(tx, {
      tenantId: webUser.tenantId,
      projectId: null,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'WORKFLOW_TEMPLATE_SAVED',
      summaryText: `Deleted workflow template "${existing.name}".`,
      payload: { templateId, name: existing.name, deleted: true },
    });
  });
}
