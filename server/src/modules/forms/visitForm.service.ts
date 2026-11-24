import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  assembleVisitForm,
  assemblyInputFromBundle,
  BundleSection,
  BundleTemplate,
  canonicalVisitFormSnapshot,
  FacilityArchetype,
  RecheckInput,
  resolveProjectTypeConfig,
  snapshotFieldCount,
  VISIT_FORM_SNAPSHOT_SCHEMA_VERSION,
  VISIT_KIND_META,
  VisitFormAssemblyError,
  VisitFormAssemblyWarning,
  VisitFormLibraryBundle,
  VisitFormSnapshot,
  VisitFormSnapshotSchema,
  VisitKind,
  VisitKindEnum,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { lockFormLibrary, effectiveSubForms, parseFields, parseLayout } from './formLibrary.service';
import { ensureFormLibrary } from './formLibraryProvisioning';

/**
 * Redesign R3c: building a project's visit form from the tenant library and its scope (D-R3.14,
 * D-R3.18, D-R3.23, D-R3.24), and storing frozen snapshots (D-R3.15). Everything goes through the
 * offline bundle, so the server and the phone assemble from exactly the same inputs.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/** SHA-256 (hex) of the canonical snapshot (builtAt excluded). The phone computes the same. */
export function hashVisitFormSnapshot(snapshot: VisitFormSnapshot): string {
  return createHash('sha256').update(canonicalVisitFormSnapshot(snapshot), 'utf8').digest('hex');
}

function toAppError(error: unknown): never {
  if (error instanceof VisitFormAssemblyError) throw new AppError(error.message, 422, error.code);
  throw error;
}

// ---------------------------------------------------------------------------
// Template resolution (D-R3.18)
// ---------------------------------------------------------------------------

type TemplateRow = { id: string; code: string; version: number; name: string; visitKind: string; layoutJson: unknown; isArchived: boolean };

function latestLiveByCode(rows: TemplateRow[]): Map<string, TemplateRow> {
  const latest = new Map<string, TemplateRow>();
  for (const r of rows) {
    const cur = latest.get(r.code);
    if (!cur || r.version > cur.version) latest.set(r.code, r);
  }
  for (const [code, r] of latest) if (r.isArchived) latest.delete(code);
  return latest;
}

/**
 * The template a project uses for a visit kind: the code in the project's type snapshot (never the
 * live type), else the tenant template whose code equals the kind, else the first live template of
 * that kind by code. Only the latest unarchived version of a code of the right kind counts.
 */
function pickTemplate(live: Map<string, TemplateRow>, configCode: string | undefined, kind: VisitKind): TemplateRow | null {
  const ofKind = (code: string | undefined) => {
    const t = code ? live.get(code) : undefined;
    return t && t.visitKind === kind ? t : null;
  };
  return (
    ofKind(configCode) ??
    ofKind(kind) ??
    [...live.values()].filter((t) => t.visitKind === kind).sort((a, b) => a.code.localeCompare(b.code))[0] ??
    null
  );
}

export async function resolveVisitFormTemplate(
  db: Db,
  project: { tenantId: string; projectTypeSnapshotJson: unknown },
  kind: VisitKind
): Promise<TemplateRow | null> {
  const live = latestLiveByCode(await db.visitFormTemplate.findMany({ where: { tenantId: project.tenantId } }));
  const code = resolveProjectTypeConfig(project.projectTypeSnapshotJson)?.visitForms.templateCodeByVisitKind[kind];
  return pickTemplate(live, code, kind);
}

// ---------------------------------------------------------------------------
// Offline bundle (D-R3.24)
// ---------------------------------------------------------------------------

/**
 * The inputs to assemble any visit kind for a project: the resolved template per kind, the sections
 * they list, the effective sub-form of each facility with units, the units and sprints, and the units
 * complete so far (R3: every line at 100%; R4 replaces it with reported completion).
 */
export async function buildVisitFormLibraryBundle(db: Db, projectId: string): Promise<VisitFormLibraryBundle> {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, tenantId: true, projectTypeSnapshotJson: true } });
  if (!project) throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  await ensureFormLibrary(db, project.tenantId);

  const [templateRows, sectionRows, units, sprints, lines] = await Promise.all([
    db.visitFormTemplate.findMany({ where: { tenantId: project.tenantId } }),
    db.formSection.findMany({ where: { tenantId: project.tenantId } }),
    db.facilityUnit.findMany({
      where: { projectId },
      include: { facility: true, startSprint: { select: { number: true } }, endSprint: { select: { number: true } } },
    }),
    db.projectSprint.findMany({ where: { projectId }, orderBy: { number: 'asc' } }),
    db.boqItem.findMany({ where: { projectId, facilityUnitId: { not: null } }, select: { facilityUnitId: true, cumulativeCertifiedPct: true } }),
  ]);

  const live = latestLiveByCode(templateRows);
  const configCodes = resolveProjectTypeConfig(project.projectTypeSnapshotJson)?.visitForms.templateCodeByVisitKind ?? {};
  const templates: BundleTemplate[] = [];
  for (const kind of VisitKindEnum.options) {
    const t = pickTemplate(live, configCodes[kind], kind);
    if (t) templates.push({ id: t.id, code: t.code, version: t.version, name: t.name, visitKind: kind, blocks: parseLayout(t.layoutJson) });
  }

  const wanted = new Set(templates.flatMap((t) => t.blocks.flatMap((b) => (b.type === 'SECTION' ? [b.sectionCode] : []))));
  const latestSection = new Map<string, (typeof sectionRows)[number]>();
  for (const s of sectionRows) {
    if (!wanted.has(s.code)) continue;
    const cur = latestSection.get(s.code);
    if (!cur || s.version > cur.version) latestSection.set(s.code, s);
  }
  const sections: BundleSection[] = [...latestSection.values()]
    .filter((s) => !s.isArchived)
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((s) => ({ id: s.id, code: s.code, version: s.version, title: s.title, description: s.description, fields: parseFields(s.fieldsJson) }));

  const facilityRows = [...new Map(units.map((u) => [u.facility.id, u.facility])).values()];
  const effective = await effectiveSubForms(db, project.tenantId, facilityRows);
  const subForms = [...new Map([...effective.values()].map((e) => [e.id, e])).values()]
    .sort((a, b) => a.subjectKey.localeCompare(b.subjectKey))
    .map((e) => ({ id: e.id, subjectKey: e.subjectKey, version: e.version, fields: parseFields(e.fields) }));

  const incomplete = new Set<string>();
  const withLines = new Set<string>();
  for (const l of lines) {
    withLines.add(l.facilityUnitId!);
    if (Number(l.cumulativeCertifiedPct) < 100) incomplete.add(l.facilityUnitId!);
  }

  return {
    projectId,
    templates,
    sections,
    subForms,
    facilities: facilityRows
      .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
      .map((f) => ({
        id: f.id,
        code: f.code,
        name: f.name,
        pluralName: f.pluralName,
        archetype: f.archetype as FacilityArchetype,
        sortOrder: f.sortOrder,
        subFormId: effective.get(f.id)?.id ?? null,
      })),
    units: units
      .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
      .map((u) => ({
        id: u.id,
        code: u.code,
        label: u.label,
        facilityId: u.facilityId,
        plannedQuantity: u.plannedQuantity === null ? null : Number(u.plannedQuantity),
        quantityUnit: u.quantityUnit,
        startSprintNumber: u.startSprint?.number ?? null,
        endSprintNumber: u.endSprint?.number ?? null,
        sortOrder: u.sortOrder,
      })),
    sprints: sprints.map((s) => ({ id: s.id, number: s.number, name: s.name, startDate: s.startDate, endDate: s.endDate, deliverables: s.deliverables })),
    completedUnitIds: [...withLines].filter((id) => !incomplete.has(id)).sort(),
  };
}

// ---------------------------------------------------------------------------
// Building and freezing
// ---------------------------------------------------------------------------

export interface BuildVisitFormOptions {
  visitKind: VisitKind;
  visitDate: string;
  pickedFacilityIds?: string[];
  rechecks?: RecheckInput[];
  /** R4: reported completion; defaults to the bundle's "every line at 100%". */
  completedUnitIds?: string[];
  builtAt?: Date;
}

export interface BuiltVisitForm {
  snapshot: VisitFormSnapshot;
  warnings: VisitFormAssemblyWarning[];
  contentSha256: string;
  fieldCount: number;
}

/** Builds (does not store) a project's form for a visit kind and date. */
export async function buildVisitForm(db: Db, projectId: string, opts: BuildVisitFormOptions): Promise<BuiltVisitForm> {
  const bundle = await buildVisitFormLibraryBundle(db, projectId);
  const picked = opts.pickedFacilityIds ?? [];
  if (VISIT_KIND_META[opts.visitKind].facilityRule === 'PICKED') {
    const inScope = new Set(bundle.units.map((u) => u.facilityId));
    const outside = picked.filter((id) => !inScope.has(id));
    if (outside.length > 0) {
      throw new AppError('Pick facilities that have units on this project', 422, 'FACILITY_NOT_IN_SCOPE', { facilityIds: outside });
    }
  }
  try {
    const input = assemblyInputFromBundle(bundle, {
      visitKind: opts.visitKind,
      visitDate: opts.visitDate,
      builtAt: (opts.builtAt ?? new Date()).toISOString(),
      pickedFacilityIds: picked,
      rechecks: opts.rechecks,
      completedUnitIds: opts.completedUnitIds,
    });
    const { snapshot, warnings } = assembleVisitForm(input);
    return { snapshot, warnings, contentSha256: hashVisitFormSnapshot(snapshot), fieldCount: snapshotFieldCount(snapshot) };
  } catch (error) {
    toAppError(error);
  }
}

/**
 * For R4: builds and stores a frozen snapshot in the caller's transaction (the one that assigns the
 * visit). It takes the form-library lock, so no component version it reads can be edited in place
 * before the snapshot marks it used.
 */
export async function freezeVisitFormSnapshot(
  tx: Prisma.TransactionClient,
  input: BuildVisitFormOptions & { projectId: string; builtByUserId?: string | null }
): Promise<{ id: string; snapshot: VisitFormSnapshot; contentSha256: string; warnings: VisitFormAssemblyWarning[] }> {
  const project = await tx.project.findUnique({ where: { id: input.projectId }, select: { tenantId: true } });
  if (!project) throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  await lockFormLibrary(tx, project.tenantId);
  const builtAt = input.builtAt ?? new Date();
  const built = await buildVisitForm(tx, input.projectId, { ...input, builtAt });
  const { snapshot } = built;
  const row = await tx.visitFormSnapshot.create({
    data: {
      tenantId: project.tenantId,
      projectId: input.projectId,
      visitKind: input.visitKind,
      visitDate: input.visitDate,
      sprintId: snapshot.context.sprint?.id ?? null,
      templateId: snapshot.sources.template.id,
      sectionIds: snapshot.sources.sections.map((s) => s.id),
      subFormIds: [...new Set(snapshot.sources.subForms.map((s) => s.id))],
      snapshotJson: snapshot as unknown as Prisma.InputJsonValue,
      contentSha256: built.contentSha256,
      schemaVersion: VISIT_FORM_SNAPSHOT_SCHEMA_VERSION,
      builtAt,
      builtByUserId: input.builtByUserId ?? null,
    },
  });
  return { id: row.id, snapshot, contentSha256: built.contentSha256, warnings: built.warnings };
}

/** A stored snapshot, parsed. */
export async function getVisitFormSnapshot(db: Db, snapshotId: string): Promise<{ id: string; snapshot: VisitFormSnapshot; contentSha256: string }> {
  const row = await db.visitFormSnapshot.findUnique({ where: { id: snapshotId } });
  if (!row) throw new AppError('Visit form not found', 404, 'VISIT_FORM_SNAPSHOT_NOT_FOUND');
  const parsed = VisitFormSnapshotSchema.safeParse(row.snapshotJson);
  if (!parsed.success) throw new AppError('This visit form is not valid any more', 500, 'INVALID_VISIT_FORM_SNAPSHOT');
  return { id: row.id, snapshot: parsed.data, contentSha256: row.contentSha256 };
}

/**
 * For R4's "rebuild form": deletes a replaced snapshot. Nothing references snapshots in R3; R4 must
 * add its `Visit.formSnapshotId` check here before deleting.
 */
export async function deleteSnapshotIfUnused(tx: Prisma.TransactionClient, snapshotId: string): Promise<boolean> {
  const deleted = await tx.visitFormSnapshot.deleteMany({ where: { id: snapshotId } });
  return deleted.count > 0;
}
