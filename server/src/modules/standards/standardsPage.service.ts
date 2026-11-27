import { ProjectTypeConfigSchema, type FormLibraryDto, type ProgrammeEssentialGroups, type StandardsOverviewDto } from '@insite/shared';
import { prisma } from '../../config/prisma';
import { ensureFacilities } from '../facilities/facilities.service';
import { getFormLibrary } from '../forms/formLibrary.service';
import { getCurrentCostingStandard, listCostingStandardVersions } from './costingStandards.service';
import { listDesignStandardDocuments } from './designStandards.service';

/**
 * Needs pipeline wave 2 (N2): GET /api/v1/standards, the Standards page in one read (any web user).
 * - costing: the latest version and every version's summary;
 * - design: the design standard documents and, per active project type with the needs pipeline
 *   enabled, its essential facility groups (D-N.17) read from the **live** type config, with the
 *   facility names of the tenant catalogue;
 * - monitoring: the form library (same shape as GET /form-library) without archived components or
 *   retired facilities, read-only.
 */

async function essentialGroups(tenantId: string): Promise<ProgrammeEssentialGroups[]> {
  await ensureFacilities(prisma, tenantId);
  const [types, facilities] = await Promise.all([
    prisma.projectType.findMany({ where: { tenantId, isActive: true }, orderBy: [{ name: 'asc' }], select: { id: true, name: true, configJson: true } }),
    prisma.facility.findMany({ where: { tenantId }, select: { code: true, name: true } }),
  ]);
  const nameOf = new Map(facilities.map((f) => [f.code, f.name]));
  const out: ProgrammeEssentialGroups[] = [];
  for (const type of types) {
    const config = ProjectTypeConfigSchema.safeParse(type.configJson ?? {});
    if (!config.success || !config.data.needsPipeline.enabled) continue;
    out.push({
      projectTypeId: type.id,
      projectTypeName: type.name,
      groups: config.data.needsPipeline.essentialFacilityGroups.map((g) => ({
        label: g.label,
        facilityCodes: g.facilityCodes,
        facilityNames: g.facilityCodes.map((c) => nameOf.get(c) ?? c),
      })),
    });
  }
  return out;
}

function unarchived(library: FormLibraryDto): FormLibraryDto {
  return {
    sections: library.sections.filter((s) => !s.isArchived),
    archetypeSubForms: library.archetypeSubForms.filter((s) => !s.isArchived),
    facilitySubForms: library.facilitySubForms.filter((s) => !s.isArchived),
    templates: library.templates.filter((t) => !t.isArchived),
    facilities: library.facilities.filter((f) => !f.isRetired),
  };
}

export async function getStandardsOverview(tenantId: string): Promise<StandardsOverviewDto> {
  const [current, versions, documents, groups, library] = await Promise.all([
    getCurrentCostingStandard(tenantId),
    listCostingStandardVersions(tenantId),
    listDesignStandardDocuments(tenantId),
    essentialGroups(tenantId),
    getFormLibrary(tenantId),
  ]);
  return {
    costing: { current, versions },
    design: { documents, essentialGroups: groups },
    monitoring: unarchived(library),
  };
}
