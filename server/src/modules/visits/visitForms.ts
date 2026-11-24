import {
  RecheckInput,
  VISIT_KIND_META,
  VisitFormAssemblyError,
  VisitFormAssemblyWarning,
  VisitFormSnapshot,
  VisitKind,
  withRechecks,
  zonedCalendarDate,
} from '@insite/shared';
import { AppError } from '../../middleware/error.middleware';
import {
  deleteSnapshotIfUnused,
  freezeVisitFormSnapshot,
  getVisitFormSnapshot,
  hashVisitFormSnapshot,
  storeVisitFormSnapshot,
} from '../forms/visitForm.service';
import { Tx } from './visitCore';

/**
 * Redesign R4 (D-R4.6, register section 1): a visit's form is a frozen R3 snapshot, built when the
 * visit is published (or created as PLANNED) and rebuilt while it has not started. Open findings to
 * re-check are inside the snapshot; when the open set changes every unstarted visit of the project is
 * re-frozen (its `formHash` changes, so the phone downloads it again).
 */

/** Open findings of a project as re-check items, oldest first. */
export async function recheckInputsForProject(tx: Tx, projectId: string, timezone: string): Promise<RecheckInput[]> {
  const rows = await tx.inspectionFinding.findMany({
    where: { projectId, status: 'OPEN' },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  return rows.map((f) => {
    const text = f.description.trim();
    return {
      id: f.id,
      kind: 'FINDING' as const,
      title: (f.title ?? text).slice(0, 300) || 'Open finding',
      description: f.title ? text.slice(0, 2000) : null,
      severity: f.severity,
      raisedDate: zonedCalendarDate(f.createdAt, timezone),
      facilityId: f.facilityId,
      unitId: f.facilityUnitId,
    };
  });
}

/**
 * Units reported complete by accepted visits (D-R4.26). Undefined until a visit has reported any
 * progress on the project: R3's stand-in (every line at 100%) applies then.
 */
export async function completedUnitIdsFor(tx: Tx, projectId: string): Promise<string[] | undefined> {
  const units = await tx.facilityUnit.findMany({ where: { projectId }, select: { id: true, progressPct: true } });
  if (!units.some((u) => u.progressPct !== null)) return undefined;
  return units.filter((u) => u.progressPct !== null && Number(u.progressPct) >= 100).map((u) => u.id);
}

export interface FreezeResult {
  formSnapshotId: string;
  formHash: string;
  warnings: VisitFormAssemblyWarning[];
  changed: boolean;
}

/**
 * Builds and stores the visit's form and points the visit at it. When the new form is identical to
 * the current one (same hash) the current snapshot is kept and nothing changes. A replaced snapshot
 * is deleted if nothing else uses it.
 */
export async function freezeVisitForm(
  tx: Tx,
  visit: { id: string; projectId: string; visitKind: string; plannedDate: string; pickedFacilityIds: string[]; formSnapshotId: string | null; formHash: string | null },
  opts: { timezone: string; builtByUserId: string | null; now?: Date }
): Promise<FreezeResult> {
  const kind = visit.visitKind as VisitKind;
  if (VISIT_KIND_META[kind].facilityRule === 'PICKED' && visit.pickedFacilityIds.length === 0) {
    throw new AppError('Pick the facilities this ad hoc visit checks', 422, 'VISIT_NEEDS_FACILITIES', { visitId: visit.id });
  }
  const rechecks = VISIT_KIND_META[kind].recheckByDefault ? await recheckInputsForProject(tx, visit.projectId, opts.timezone) : [];
  const frozen = await freezeVisitFormSnapshot(tx, {
    projectId: visit.projectId,
    visitKind: kind,
    visitDate: visit.plannedDate,
    pickedFacilityIds: visit.pickedFacilityIds,
    rechecks,
    completedUnitIds: await completedUnitIdsFor(tx, visit.projectId),
    builtAt: opts.now,
    builtByUserId: opts.builtByUserId,
  });
  if (visit.formSnapshotId && frozen.contentSha256 === visit.formHash) {
    await deleteSnapshotIfUnused(tx, frozen.id);
    return { formSnapshotId: visit.formSnapshotId, formHash: visit.formHash, warnings: frozen.warnings, changed: false };
  }
  await tx.visit.update({
    where: { id: visit.id },
    data: { formSnapshotId: frozen.id, formHash: frozen.contentSha256, formAssembledAt: opts.now ?? new Date() },
  });
  if (visit.formSnapshotId) await deleteSnapshotIfUnused(tx, visit.formSnapshotId);
  return { formSnapshotId: frozen.id, formHash: frozen.contentSha256, warnings: frozen.warnings, changed: true };
}

/**
 * After the open findings changed (D-R4.7 as amended by the register): every published visit of the
 * project that has not started gets its re-check block replaced. Only that block changes; the rest of
 * the form stays as frozen. The superseded snapshot is kept, so a submission from an officer who was
 * offline with the older form is still accepted (`sameFormApartFromRechecks`). Returns how many changed.
 */
export async function refreshUnstartedVisitForms(tx: Tx, projectId: string, opts: { timezone: string; now?: Date }): Promise<number> {
  const visits = await tx.visit.findMany({
    where: { projectId, status: 'PLANNED', formSnapshotId: { not: null }, checkInAt: null },
    select: { id: true, visitKind: true, formSnapshotId: true, formHash: true, project: { select: { tenantId: true } } },
  });
  if (visits.length === 0) return 0;
  const rechecks = await recheckInputsForProject(tx, projectId, opts.timezone);
  const now = opts.now ?? new Date();
  let changed = 0;
  for (const v of visits) {
    if (!VISIT_KIND_META[v.visitKind as VisitKind].recheckByDefault) continue;
    const current = await getVisitFormSnapshot(tx, v.formSnapshotId!);
    let next: VisitFormSnapshot;
    try {
      next = withRechecks(current.snapshot, rechecks, now.toISOString());
    } catch (error) {
      if (error instanceof VisitFormAssemblyError) continue;
      throw error;
    }
    if (hashVisitFormSnapshot(next) === v.formHash) continue;
    const stored = await storeVisitFormSnapshot(tx, { tenantId: v.project.tenantId, projectId, snapshot: next, builtAt: now, builtByUserId: null });
    await tx.visit.update({ where: { id: v.id }, data: { formSnapshotId: stored.id, formHash: stored.contentSha256, formAssembledAt: now } });
    changed += 1;
  }
  return changed;
}
