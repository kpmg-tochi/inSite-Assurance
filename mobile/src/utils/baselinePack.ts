import { MOBILE_BASELINE_PACK_VERSION, type MobileBaselinePack } from '@insite/shared';

/**
 * Redesign R5a (D-R5.3): a stored pack as the v2 shape. Packs saved before R5 lack the visit-app
 * fields; they get empty values (no sprints, units or findings) until the next download, and
 * `isCurrentPack` tells the screens the pack is from before R5.
 */
export function normaliseBaselinePack(raw: Partial<MobileBaselinePack> & Pick<MobileBaselinePack, 'projectId' | 'name' | 'codePrefix'>): MobileBaselinePack {
  return {
    ...raw,
    stateLocation: raw.stateLocation ?? '',
    projectStatus: raw.projectStatus ?? 'ACTIVE',
    stage: raw.stage ?? null,
    school: raw.school ?? null,
    address: raw.address ?? null,
    lgaLocation: raw.lgaLocation ?? null,
    contractorName: raw.contractorName ?? null,
    workWeekDays: raw.workWeekDays ?? [1, 2, 3, 4, 5, 6],
    sprints: raw.sprints ?? [],
    facilityUnits: raw.facilityUnits ?? [],
    openFindings: raw.openFindings ?? [],
    openDefectCount: raw.openDefectCount ?? 0,
    mobilisation: raw.mobilisation ?? null,
    geofenceMode: raw.geofenceMode!,
    geofence: raw.geofence!,
  } as MobileBaselinePack;
}

/** Whether the pack carries the v2 fields (downloaded from an R5 server). */
export function isCurrentPack(pack: Pick<MobileBaselinePack, 'packVersion'> | null | undefined): boolean {
  return (pack?.packVersion ?? 0) >= MOBILE_BASELINE_PACK_VERSION;
}
