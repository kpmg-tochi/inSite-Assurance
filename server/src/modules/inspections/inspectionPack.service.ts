import { InspectionVisitTypeEnum, MobileInspectionPack, resolveProjectTypeConfig } from '@insite/shared';
import { prisma } from '../../config/prisma';
import { resolveTemplateForVisit } from './checklistTemplates.service';

/**
 * Phase 14: the part of the mobile baseline pack about inspections: the checklist templates of the
 * visit types it can inspect, so an inspection can be completed offline. Redesign R4f removed
 * reporting streams (visits replace them), so `streams` is always empty; R5 removes the pack.
 */
export async function buildMobileInspectionPack(params: {
  projectId: string;
  sessionId: string;
  permissions: string[];
}): Promise<MobileInspectionPack> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: params.projectId },
    select: { tenantId: true, projectTypeSnapshotJson: true },
  });
  const canSubmitInspections = params.permissions.includes('inspections:submit');
  const typeConfig = resolveProjectTypeConfig(project.projectTypeSnapshotJson);
  const templates: MobileInspectionPack['templates'] = [];
  const templateIdByVisitType: MobileInspectionPack['templateIdByVisitType'] = {};
  if (canSubmitInspections) {
    for (const visitType of InspectionVisitTypeEnum.options) {
      const t = await resolveTemplateForVisit(prisma, project.tenantId, typeConfig, visitType);
      if (!t) continue;
      templateIdByVisitType[visitType] = t.id;
      const existing = templates.find((x) => x.id === t.id);
      if (!existing) templates.push({ id: t.id, code: t.code, name: t.name, version: t.version, visitTypes: t.visitTypes, sections: t.sections });
    }
  }
  return {
    streams: [],
    templates,
    templateIdByVisitType,
    canSubmitInspections,
  };
}
