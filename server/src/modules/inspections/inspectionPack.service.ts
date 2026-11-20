import { InspectionVisitTypeEnum, MobileInspectionPack, resolveProjectTypeConfig } from '@insite/shared';
import { prisma } from '../../config/prisma';
import { CADENCE_PROJECT_SELECT } from '../cadence/cadence.service';
import { streamSettingsForPack, streamsOwedBy } from '../cadence/streams.service';
import { resolveTemplateForVisit } from './checklistTemplates.service';

/**
 * Phase 14: the part of the mobile baseline pack about streams and inspections: the streams this
 * session owes (with the settings in force, for period cards) and the checklist templates of the
 * visit types it can inspect, so an inspection can be completed offline.
 */
export async function buildMobileInspectionPack(params: {
  projectId: string;
  sessionId: string;
  permissions: string[];
}): Promise<MobileInspectionPack> {
  const [project, session] = await Promise.all([
    prisma.project.findUniqueOrThrow({
      where: { id: params.projectId },
      select: { ...CADENCE_PROJECT_SELECT, tenantId: true, projectTypeSnapshotJson: true },
    }),
    prisma.fieldAgentSession.findUniqueOrThrow({ where: { id: params.sessionId }, select: { roleId: true, projectContractorId: true } }),
  ]);
  const streams = await streamsOwedBy(prisma, params.projectId, session);
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
    streams: streams.map((s) => ({
      id: s.id,
      key: s.key,
      label: s.label,
      kind: s.kind,
      visitType: s.visitType,
      submissionDeadlineDays: s.submissionDeadlineDays,
      cadence: streamSettingsForPack(project, s),
    })),
    templates,
    templateIdByVisitType,
    canSubmitInspections,
  };
}
