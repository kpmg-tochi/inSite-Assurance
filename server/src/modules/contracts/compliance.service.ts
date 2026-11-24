import {
  deriveMilestoneStatus,
  milestoneDaysLeft,
  MobilisationComplianceRow,
  OPEN_DEFAULT_CASE_STATUSES,
  resolveProjectTypeConfig,
  zonedCalendarDate,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { evidenceFor, registerEvidence } from '../documents/documents.service';

/**
 * Phase 13: contractor mobilisation compliance per contractor: the mobilisation milestone (the
 * AUTO_CONTRACTOR_ON_SITE milestone of the contractor, else a project-level one; R1e: on site means
 * that milestone is done, confirmed by an officer), documents still missing from the type's `beforeMobilisation` list, and any
 * running default case.
 */
export async function getMobilisationCompliance(projectId: string, now: Date = new Date()): Promise<MobilisationComplianceRow[]> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { tenantId: true, timezone: true, projectTypeSnapshotJson: true },
  });
  const today = zonedCalendarDate(now, project.timezone);
  const requiredCodes = resolveProjectTypeConfig(project.projectTypeSnapshotJson)?.documentRequirements.beforeMobilisation ?? [];
  const [contractors, milestones, evidence, types, cases] = await Promise.all([
    prisma.projectContractor.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'asc' }],
      include: { organization: { select: { name: true } } },
    }),
    prisma.projectContractMilestone.findMany({ where: { projectId, completionMode: 'AUTO_CONTRACTOR_ON_SITE' }, orderBy: { sortOrder: 'asc' } }),
    registerEvidence(prisma, projectId, requiredCodes),
    requiredCodes.length
      ? prisma.documentType.findMany({ where: { tenantId: project.tenantId, code: { in: requiredCodes } }, select: { code: true, name: true } })
      : [],
    prisma.contractorDefaultCase.findMany({
      where: { projectId, status: { in: OPEN_DEFAULT_CASE_STATUSES } },
      select: { id: true, projectContractorId: true },
    }),
  ]);
  const typeName = new Map(types.map((t) => [t.code, t.name]));
  const rows: MobilisationComplianceRow[] = [];
  for (const c of contractors) {
    const m = milestones.find((x) => x.projectContractorId === c.id) ?? milestones.find((x) => x.projectContractorId === null) ?? null;
    const status = m ? deriveMilestoneStatus(m.status, m.dueDate, today) : null;
    rows.push({
      projectContractorId: c.id,
      organizationName: c.organization.name,
      tradeCode: c.tradeCode,
      contractStatus: c.contractStatus,
      milestone:
        m && status
          ? {
              id: m.id,
              label: m.label,
              dueDate: m.dueDate,
              status,
              daysLeft: milestoneDaysLeft(status, m.dueDate, today),
              completedAt: m.completedAt?.toISOString() ?? null,
            }
          : null,
      onSite: status === 'DONE',
      missingDocuments: requiredCodes
        .filter((code) => evidenceFor(evidence, code, c.id).length === 0)
        .map((code) => ({ code, name: typeName.get(code) ?? code })),
      openDefaultCaseId: cases.find((x) => x.projectContractorId === c.id)?.id ?? null,
    });
  }
  return rows;
}
