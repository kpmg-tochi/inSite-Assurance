import type { CadenceSettings } from '@insite/shared';
import { getLoadedBaselinePack } from '../storage/baselineStore';
import { projectTimeZone } from '../storage/reportStore';
import { cadenceSettingsFromPack } from './projectCadence';

/** Cadence settings of a project from its saved baseline pack (Phase 8). */
export function projectCadenceSettings(projectId: string | null | undefined): CadenceSettings {
  return cadenceSettingsFromPack(getLoadedBaselinePack(projectId ?? null), projectTimeZone(projectId));
}
