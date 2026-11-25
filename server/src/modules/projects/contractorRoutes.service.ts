import { ProjectContractorInput } from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import {
  auditContractorChanges,
  contractorIssues,
  getProjectContractors,
  serializeContractor,
  syncProjectContractors,
} from './contractors.service';

/**
 * Contractor CRUD under /projects/:projectId/contractors (`contractors:manage`). The parties
 * step saves the contractor too; these endpoints apply the same rules (one contractor per project).
 */

export async function listProjectContractors(projectId: string) {
  return (await getProjectContractors(prisma, projectId)).map(serializeContractor);
}

async function applyChange(
  projectId: string,
  webUser: WebJwtPayload,
  change: { upsert?: ProjectContractorInput; removeId?: string }
) {
  let changedId: string | null = null;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId}::uuid FOR UPDATE`;
    const project = await tx.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { id: true, tenantId: true, codePrefix: true, status: true },
    });
    if (project.status === 'ARCHIVED') {
      throw new AppError('This project is archived and read-only', 409, 'PROJECT_ARCHIVED');
    }
    let result;
    if (change.removeId) {
      const current = await getProjectContractors(tx, projectId);
      if (!current.some((c) => c.id === change.removeId)) {
        throw new AppError('Contractor not found on this project', 404, 'CONTRACTOR_NOT_FOUND');
      }
      result = await syncProjectContractors(tx, {
        projectId,
        tenantId: project.tenantId,
        webUser,
        inputs: current
          .filter((c) => c.id !== change.removeId)
          .map((c) => ({
            id: c.id,
            organization: { id: c.organizationId },
            tradeCategory: c.tradeCategory,
            tradeCode: c.tradeCode,
            allocatedBudgetNgn: c.allocatedBudgetNgn === null ? null : Number(c.allocatedBudgetNgn),
            plannedMobilizationDate: c.plannedMobilizationDate?.toISOString().slice(0, 10) ?? null,
            plannedCompletionDate: c.plannedCompletionDate?.toISOString().slice(0, 10) ?? null,
          })),
      });
    } else {
      result = await syncProjectContractors(tx, {
        projectId,
        tenantId: project.tenantId,
        webUser,
        inputs: [change.upsert!],
        partial: true,
      });
      changedId = change.upsert!.id ?? result.added[0]?.id ?? null;
    }
    if (project.status === 'ACTIVE') {
      const problems = contractorIssues(await getProjectContractors(tx, projectId));
      if (problems.length > 0) throw new AppError(problems[0].message, 422, problems[0].code);
    }
    await auditContractorChanges(tx, { projectId, webUser, result });
  });
  return changedId;
}

export async function addProjectContractor(projectId: string, webUser: WebJwtPayload, input: ProjectContractorInput) {
  const id = await applyChange(projectId, webUser, { upsert: { ...input, id: undefined } });
  return (await listProjectContractors(projectId)).find((c) => c.id === id)!;
}

export async function updateProjectContractor(
  projectId: string,
  contractorId: string,
  webUser: WebJwtPayload,
  input: ProjectContractorInput
) {
  await applyChange(projectId, webUser, { upsert: { ...input, id: contractorId } });
  return (await listProjectContractors(projectId)).find((c) => c.id === contractorId)!;
}

export async function removeProjectContractor(projectId: string, contractorId: string, webUser: WebJwtPayload) {
  await applyChange(projectId, webUser, { removeId: contractorId });
}
