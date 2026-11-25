import { Prisma } from '@prisma/client';
import { ProjectProcessConfig, zonedCalendarDate } from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { getProcessConfig } from '../process/processConfig.service';

/**
 * Phase 10 module switches. Everything handover- or retention-related is hidden and refused when
 * the project's switch is off: the routes answer 404 as if they did not exist.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type CloseoutModule = 'handover' | 'retention';

export function moduleOff(): AppError {
  return new AppError('Route not found', 404, 'NOT_FOUND');
}

export function isModuleOn(config: ProjectProcessConfig, module: CloseoutModule): boolean {
  return module === 'handover' ? config.enableHandoverModule : config.enableRetentionModule;
}

/** Throws 404 unless the module is on for the project. Returns the process config. */
export async function assertModuleOn(projectId: string, module: CloseoutModule, db?: Db): Promise<ProjectProcessConfig> {
  const config = await getProcessConfig(projectId, db);
  if (!isModuleOn(config, module)) throw moduleOff();
  return config;
}

/** Phase endpoints exist when either closeout module is on. */
export async function assertAnyCloseoutModuleOn(projectId: string, db?: Db): Promise<ProjectProcessConfig> {
  const config = await getProcessConfig(projectId, db);
  if (!config.enableHandoverModule && !config.enableRetentionModule) throw moduleOff();
  return config;
}

/**
 * Phase 10: in the defects liability period and after closing, no new construction reports are
 * submitted.
 */
export async function assertConstructionOngoing(projectId: string, what: string, db: Db = prisma) {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { constructionPhase: true } });
  if (project && (project.constructionPhase === 'RETENTION_PERIOD' || project.constructionPhase === 'COMPLETED_CLOSED')) {
    throw new AppError(`Execution on this project has ended: ${what} can no longer be submitted.`, 409, 'PROJECT_CONSTRUCTION_ENDED');
  }
}

/** Today in the project's zone (YYYY-MM-DD). */
export function projectToday(timezone: string, now: Date = new Date()): string {
  return zonedCalendarDate(now, timezone);
}

export const fmtNgn = (n: number) =>
  `NGN ${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
