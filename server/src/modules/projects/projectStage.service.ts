import { deriveProjectStage, type ProjectStage, type ProjectStageFacts, type ProjectStageSummary } from '@insite/shared';
import { prisma } from '../../config/prisma';

/**
 * Redesign R6c (D-R6.18, D-R6.22): stage facts for many projects in a fixed number of queries
 * (no per-project query). Used by the Overview, the directory/portfolio rows and the mobile
 * baseline pack (R5, D-R5.3). Drafts are skipped (no stage).
 */
export async function loadProjectStageFacts(projectIds: string[]): Promise<Map<string, ProjectStageFacts>> {
  const result = new Map<string, ProjectStageFacts>();
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return result;

  const [projects, milestoneCounts, onSiteMilestones, certificates, terminated] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: ids }, status: { not: 'DRAFT' } },
      select: {
        id: true,
        status: true,
        constructionPhase: true,
        constructionPhaseChangedAt: true,
        activatedAt: true,
        archivedAt: true,
        kickoffHeldAt: true,
        projectTypeId: true,
      },
    }),
    prisma.projectContractMilestone.groupBy({ by: ['projectId'], where: { projectId: { in: ids } }, _count: { _all: true } }),
    prisma.projectContractMilestone.findMany({
      where: { projectId: { in: ids }, completionMode: 'AUTO_CONTRACTOR_ON_SITE', status: { not: 'WAIVED' } },
      select: { projectId: true, status: true, completedAt: true },
    }),
    prisma.completionCertificate.findMany({
      where: { projectId: { in: ids }, status: { not: 'REVOKED' } },
      select: { projectId: true, createdAt: true },
    }),
    prisma.projectContractor.findMany({
      where: { projectId: { in: ids }, contractStatus: 'TERMINATED' },
      select: { projectId: true },
    }),
  ]);

  const hasMilestones = new Set(milestoneCounts.filter((m) => m._count._all > 0).map((m) => m.projectId));
  const onSite = new Map<string, { done: boolean; completedAt: string | null }>();
  for (const m of onSiteMilestones) {
    const done = m.status === 'DONE';
    const prev = onSite.get(m.projectId);
    // Several contractors would give several rows; the project is on site once one is done.
    if (!prev || (done && !prev.done)) {
      onSite.set(m.projectId, { done, completedAt: done && m.completedAt ? m.completedAt.toISOString() : null });
    }
  }
  const cocDrafted = new Map<string, string>();
  for (const c of certificates) {
    const at = c.createdAt.toISOString();
    const prev = cocDrafted.get(c.projectId);
    if (!prev || at < prev) cocDrafted.set(c.projectId, at);
  }
  const terminatedIds = new Set(terminated.map((t) => t.projectId));

  for (const p of projects) {
    result.set(p.id, {
      status: p.status,
      constructionPhase: p.constructionPhase,
      kickoffTracked: p.projectTypeId !== null || hasMilestones.has(p.id),
      activatedAt: p.activatedAt?.toISOString() ?? null,
      kickoffHeldAt: p.kickoffHeldAt?.toISOString() ?? null,
      contractorOnSite: onSite.get(p.id) ?? null,
      constructionPhaseChangedAt: p.constructionPhaseChangedAt?.toISOString() ?? null,
      cocDraftedAt: cocDrafted.get(p.id) ?? null,
      archivedAt: p.archivedAt?.toISOString() ?? null,
      contractTerminated: terminatedIds.has(p.id),
    });
  }
  return result;
}

export async function loadProjectStages(projectIds: string[]): Promise<Map<string, ProjectStage>> {
  const facts = await loadProjectStageFacts(projectIds);
  const out = new Map<string, ProjectStage>();
  for (const [id, f] of facts) out.set(id, deriveProjectStage(f));
  return out;
}

export function stageSummary(stage: ProjectStage): ProjectStageSummary {
  return {
    current: stage.current,
    currentLabel: stage.currentLabel,
    subLabel: stage.subLabel,
    contractTerminated: stage.flags.contractTerminated,
  };
}

export async function loadProjectStageSummaries(projectIds: string[]): Promise<Map<string, ProjectStageSummary>> {
  const stages = await loadProjectStages(projectIds);
  const out = new Map<string, ProjectStageSummary>();
  for (const [id, s] of stages) out.set(id, stageSummary(s));
  return out;
}
