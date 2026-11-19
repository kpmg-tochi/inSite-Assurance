import { ContractorExecutionMode, ProjectContractorInput } from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import {
  auditContractorChanges,
  contractorModelIssues,
  getProjectContractors,
  serializeContractor,
  syncProjectContractors,
} from './contractors.service';
import { reconcileContractorJoinCodes } from './joinCodes.service';

/**
 * Single-contractor CRUD under /projects/:projectId/contractors (`contractors:manage_packages`).
 * The parties step saves the whole list; these endpoints change one row at a time with the same
 * rules.
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
      select: { id: true, tenantId: true, codePrefix: true, status: true, contractorExecutionMode: true },
    });
    if (project.status === 'ARCHIVED') {
      throw new AppError('This project is archived and read-only', 409, 'PROJECT_ARCHIVED');
    }
    const mode = project.contractorExecutionMode as ContractorExecutionMode | null;
    let result;
    if (change.removeId) {
      const current = await getProjectContractors(tx, projectId);
      if (!current.some((c) => c.id === change.removeId)) {
        throw new AppError('Contractor not found on this project', 404, 'CONTRACTOR_NOT_FOUND');
      }
      result = await syncProjectContractors(tx, {
        projectId,
        tenantId: project.tenantId,
        mode,
        webUser,
        inputs: current
          .filter((c) => c.id !== change.removeId)
          .map((c) => ({
            id: c.id,
            organization: { id: c.organizationId },
            tradeCategory: c.tradeCategory,
            tradeCode: c.tradeCode,
            isMainContractor: c.isMainContractor,
            allocatedBudgetNgn: c.allocatedBudgetNgn === null ? null : Number(c.allocatedBudgetNgn),
            allowFieldReporting: c.allowFieldReporting,
            plannedMobilizationDate: c.plannedMobilizationDate?.toISOString().slice(0, 10) ?? null,
            plannedCompletionDate: c.plannedCompletionDate?.toISOString().slice(0, 10) ?? null,
          })),
      });
    } else {
      result = await syncProjectContractors(tx, {
        projectId,
        tenantId: project.tenantId,
        mode,
        webUser,
        inputs: [change.upsert!],
        partial: true,
      });
      changedId = change.upsert!.id ?? result.added[0]?.id ?? null;
    }
    if (project.status === 'ACTIVE') {
      const problems = contractorModelIssues(mode, await getProjectContractors(tx, projectId));
      if (problems.length > 0) throw new AppError(problems[0].message, 422, problems[0].code);
      await reconcileContractorJoinCodes(tx, project);
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
