import {
  addDays,
  deriveMilestoneStatus,
  deriveSprintStatus,
  MOBILE_BASELINE_PACK_VERSION,
  OPEN_DEFECT_STATUSES,
  zonedCalendarDate,
  type BaselineFacilityUnit,
  type BaselineMobilisation,
  type BaselineOpenFinding,
  type BaselineSprint,
  type MobileBaselinePack,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { monitoringConfigOf } from '../visits/visitCore';
import { loadProjectStageSummaries } from '../projects/projectStage.service';

/**
 * Redesign R5 (D-R5.3): the mobile baseline pack v2, one project at a time. What the visit app needs
 * offline for a project card, the project screen and geofence previews: status and stage, school,
 * address, contractor, sprints with their derived status, facility units, open findings, the open
 * defect count and the mobilisation milestone. Visit forms are not here (R4 field pack). Redesign
 * R5e removed the pre-R5 app's fields (reporting cadence, BOQ items, hold points, inspections).
 */

const dateOf = (d: Date | null | undefined, zone: string): string | null => (d ? zonedCalendarDate(d, zone) : null);

export async function getProjectBaselinePack(projectId: string, now: Date = new Date()): Promise<MobileBaselinePack> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      tenant: { select: { defaultGeofenceToleranceMeters: true } },
    },
  });
  if (!project) throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');

  const zone = project.timezone;
  const today = zonedCalendarDate(now, zone);
  const monitoring = monitoringConfigOf(project.projectTypeSnapshotJson);

  const [sprints, units, findings, defectCount, milestones, contractors, school, stages] = await Promise.all([
    prisma.projectSprint.findMany({ where: { projectId }, orderBy: { number: 'asc' } }),
    prisma.facilityUnit.findMany({
      where: { projectId },
      include: {
        facility: { select: { id: true, code: true, name: true, archetype: true, sortOrder: true } },
        startSprint: { select: { number: true } },
        endSprint: { select: { number: true } },
      },
      orderBy: [{ facility: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { code: 'asc' }],
    }),
    prisma.inspectionFinding.findMany({ where: { projectId, status: 'OPEN' }, orderBy: { createdAt: 'asc' } }),
    prisma.retentionDefectTicket.count({ where: { projectId, status: { in: OPEN_DEFECT_STATUSES } } }),
    prisma.projectContractMilestone.findMany({
      where: { projectId, completionMode: 'AUTO_CONTRACTOR_ON_SITE', status: { notIn: ['DONE', 'WAIVED'] } },
      orderBy: [{ dueDate: 'asc' }, { sortOrder: 'asc' }],
    }),
    prisma.projectContractor.findMany({
      where: { projectId },
      include: { organization: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.projectBeneficiary.findFirst({ where: { projectId, isPrimary: true }, select: { name: true } }),
    loadProjectStageSummaries([projectId]),
  ]);

  const facilityIds = [...new Set(findings.map((f) => f.facilityId).filter((id): id is string => Boolean(id)))];
  const facilities = facilityIds.length
    ? await prisma.facility.findMany({ where: { id: { in: facilityIds } }, select: { id: true, name: true } })
    : [];
  const facilityName = new Map(facilities.map((f) => [f.id, f.name]));
  const unitLabel = new Map(units.map((u) => [u.id, u.label]));

  const sprintRows: BaselineSprint[] = sprints.map((s) => ({
    id: s.id,
    number: s.number,
    name: s.name,
    startDate: s.startDate,
    endDate: s.endDate,
    deliverables: s.deliverables,
    status: deriveSprintStatus(s, today, monitoring.sprintVerificationDays),
    verificationOutcome: s.verificationOutcome,
  }));

  const unitRows: BaselineFacilityUnit[] = units.map((u) => ({
    id: u.id,
    code: u.code,
    label: u.label,
    facilityId: u.facility.id,
    facilityCode: u.facility.code,
    facilityName: u.facility.name,
    archetype: u.facility.archetype,
    plannedQuantity: u.plannedQuantity === null ? null : Number(u.plannedQuantity),
    quantityUnit: u.quantityUnit,
    startSprintNumber: u.startSprint?.number ?? null,
    endSprintNumber: u.endSprint?.number ?? null,
    progressPct: u.progressPct === null ? null : Number(u.progressPct),
    sortOrder: u.sortOrder,
  }));

  const findingRows: BaselineOpenFinding[] = findings.map((f) => {
    const raisedDate = zonedCalendarDate(f.createdAt, zone);
    const text = f.description.trim();
    return {
      id: f.id,
      title: (f.title ?? text).slice(0, 300) || 'Open finding',
      description: text,
      severity: f.severity,
      facilityId: f.facilityId,
      facilityName: f.facilityId ? facilityName.get(f.facilityId) ?? null : null,
      unitId: f.facilityUnitId,
      unitLabel: f.facilityUnitId ? unitLabel.get(f.facilityUnitId) ?? null : null,
      raisedDate,
      escalatesOn: addDays(raisedDate, monitoring.findingEscalationDays),
      recheckCount: f.recheckCount,
    };
  });

  const openOnSite = milestones[0] ?? null;
  let mobilisation: BaselineMobilisation | null = null;
  if (openOnSite) {
    const status = deriveMilestoneStatus(openOnSite.status, openOnSite.dueDate, today);
    mobilisation = {
      milestoneId: openOnSite.id,
      label: openOnSite.label,
      startedOn: dateOf(project.kickoffHeldAt, zone) ?? dateOf(project.activatedAt, zone),
      deadline: openOnSite.dueDate,
      // DONE and WAIVED were filtered out above.
      status: status === 'DUE' || status === 'OVERDUE' ? status : 'PENDING',
    };
  }

  // One contractor per project (decision T); prefer the active contract when history has more.
  const contractor = contractors.find((c) => c.contractStatus === 'ACTIVE') ?? contractors[0] ?? null;

  return {
    projectId: project.id,
    name: project.name,
    codePrefix: project.codePrefix,
    stateLocation: project.stateLocation ?? '',
    packVersion: MOBILE_BASELINE_PACK_VERSION,
    generatedAt: now.toISOString(),
    projectStatus: project.status,
    stage: stages.get(project.id) ?? null,
    school: school?.name ?? null,
    address: project.siteAddress?.trim() || null,
    lgaLocation: project.lgaLocation ?? null,
    contractorName: contractor?.organization.name ?? null,
    workWeekDays: project.workWeekDays,
    sprints: sprintRows,
    facilityUnits: unitRows,
    openFindings: findingRows,
    openDefectCount: defectCount,
    mobilisation,
    timezone: zone,
    geofenceMode: project.geofenceMode as MobileBaselinePack['geofenceMode'],
    geofence: project.geofenceGeoJson as MobileBaselinePack['geofence'],
    geofenceToleranceMeters: project.geofenceToleranceMeters ?? project.tenant.defaultGeofenceToleranceMeters,
    constructionPhase: project.constructionPhase,
  };
}
