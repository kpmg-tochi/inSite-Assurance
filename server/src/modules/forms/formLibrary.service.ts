import { Prisma } from '@prisma/client';
import {
  CustomiseFacilitySubFormRequest,
  DEFAULT_FORM_LIBRARY,
  FacilityArchetype,
  FacilityEffectiveSubForm,
  FacilitySubFormDto,
  FormField,
  FormFieldsSchema,
  FormFieldType,
  FormLibraryDto,
  FormSectionDto,
  NEEDS_VERIFICATION_CONDITION_BY_OPTION,
  NEEDS_VERIFICATION_FIELD_KEYS,
  NEEDS_VERIFICATION_RESERVED_SECTION_CODES,
  NEEDS_VERIFICATION_SECTION_CODES,
  SaveFacilitySubFormRequest,
  SaveFormSectionRequest,
  SaveVisitFormTemplateRequest,
  validateFormFields,
  VISIT_KIND_META,
  VisitFormBlock,
  VisitFormTemplateDto,
  VisitFormTemplateLayoutSchema,
  VisitKind,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import type { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { ensureFacilities } from '../facilities/facilities.service';
import { archetypeSubjectKey, ensureFormLibrary, facilitySubjectKey } from './formLibraryProvisioning';

/**
 * Redesign R3b: the tenant form library (D-R3.1, D-R3.7, D-R3.13). Fixed sections and templates are
 * versioned by code, facility sub-forms by subject key. A version referenced by a stored
 * VisitFormSnapshot is never edited: saving creates version + 1; an unused latest version is edited
 * in place. Saves are serialised per tenant with an advisory lock that freezing a snapshot also takes.
 */

type Db = Prisma.TransactionClient | typeof prisma;
type SaveMode = 'created' | 'edited' | 'versioned' | 'archived' | 'restored' | 'customised' | 'reset';

export async function lockFormLibrary(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`form-library:${tenantId}`}))`;
}

export function parseFields(raw: unknown): FormField[] {
  const parsed = FormFieldsSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('A stored form component is not valid any more', 500, 'INVALID_FORM_COMPONENT');
  return parsed.data;
}

export function parseLayout(raw: unknown): VisitFormBlock[] {
  const parsed = VisitFormTemplateLayoutSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('A stored monitoring form template is not valid any more', 500, 'INVALID_FORM_COMPONENT');
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Usage (stored snapshots that reference a version)
// ---------------------------------------------------------------------------

async function arrayUsage(db: Db, column: 'sectionIds' | 'subFormIds', ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const col = Prisma.raw(`"${column}"`);
  const rows = await db.$queryRaw<Array<{ id: string; n: number }>>(
    Prisma.sql`SELECT u.id::text AS id, count(*)::int AS n
               FROM visit_form_snapshots s, unnest(s.${col}) AS u(id)
               WHERE s.${col} && ${ids}::uuid[] AND u.id = ANY(${ids}::uuid[])
               GROUP BY u.id`
  );
  return new Map(rows.map((r) => [r.id, Number(r.n)]));
}

/**
 * Needs pipeline wave 5 (N8): a field verification's frozen form names the section versions it was
 * built from (`formJson.sources.sections`), which count as uses: such a version is never edited in place.
 */
async function needsVerificationSectionUsage(db: Db, tenantId: string, ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  // The tenant filter comes before the JSON is expanded (only this tenant's verifications are read).
  const rows = await db.$queryRaw<Array<{ id: string; n: number }>>(
    Prisma.sql`SELECT sec->>'id' AS id, count(*)::int AS n
               FROM (SELECT "formJson" FROM needs_verifications WHERE "tenantId" = ${tenantId}::uuid) v,
                    jsonb_array_elements(v."formJson"->'sources'->'sections') AS sec
               WHERE sec->>'id' = ANY(${ids}::text[])
               GROUP BY 1`
  );
  return new Map(rows.map((r) => [r.id, Number(r.n)]));
}

export async function sectionUsage(db: Db, tenantId: string, ids: string[]): Promise<Map<string, number>> {
  const snapshots = await arrayUsage(db, 'sectionIds', ids);
  const verifications = await needsVerificationSectionUsage(db, tenantId, ids);
  for (const [id, n] of verifications) snapshots.set(id, (snapshots.get(id) ?? 0) + n);
  return snapshots;
}
export const subFormUsage = (db: Db, ids: string[]) => arrayUsage(db, 'subFormIds', ids);

async function templateUsage(db: Db, ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await db.visitFormSnapshot.groupBy({ by: ['templateId'], where: { templateId: { in: ids } }, _count: { _all: true } });
  return new Map(rows.map((r) => [r.templateId, r._count._all]));
}

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

type SectionRow = Prisma.FormSectionGetPayload<object>;
type SubFormRow = Prisma.FacilitySubFormGetPayload<{ include: { facility: { select: { code: true; name: true } } } }>;
type TemplateRow = Prisma.VisitFormTemplateGetPayload<object>;
const SUBFORM_INCLUDE = { facility: { select: { code: true, name: true } } } satisfies Prisma.FacilitySubFormInclude;

function serializeSection(r: SectionRow, latestVersion: number, usage: number, usedByTemplateCodes: string[]): FormSectionDto {
  return {
    id: r.id,
    code: r.code,
    version: r.version,
    title: r.title,
    description: r.description,
    fields: parseFields(r.fieldsJson),
    isArchived: r.isArchived,
    usageCount: usage,
    isLatest: r.version === latestVersion,
    createdAt: r.createdAt.toISOString(),
    usedByTemplateCodes,
  };
}

function serializeSubForm(r: SubFormRow, latestVersion: number, usage: number): FacilitySubFormDto {
  return {
    id: r.id,
    subject: r.subject,
    subjectKey: r.subjectKey,
    archetype: (r.archetype as FacilityArchetype | null) ?? null,
    facilityId: r.facilityId,
    facilityCode: r.facility?.code ?? null,
    facilityName: r.facility?.name ?? null,
    version: r.version,
    fields: parseFields(r.fieldsJson),
    isArchived: r.isArchived,
    usageCount: usage,
    isLatest: r.version === latestVersion,
    createdAt: r.createdAt.toISOString(),
  };
}

function serializeTemplate(r: TemplateRow, latestVersion: number, usage: number): VisitFormTemplateDto {
  return {
    id: r.id,
    code: r.code,
    version: r.version,
    name: r.name,
    visitKind: r.visitKind as VisitKind,
    blocks: parseLayout(r.layoutJson),
    isArchived: r.isArchived,
    usageCount: usage,
    isLatest: r.version === latestVersion,
    createdAt: r.createdAt.toISOString(),
  };
}

function latestBy<T extends { version: number }>(rows: T[], key: (r: T) => string): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of rows) {
    const k = key(r);
    const cur = out.get(k);
    if (!cur || r.version > cur.version) out.set(k, r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Effective sub-forms (D-R3.7)
// ---------------------------------------------------------------------------

export interface EffectiveSubForm {
  source: 'ARCHETYPE' | 'FACILITY';
  id: string;
  subjectKey: string;
  version: number;
  fields: unknown;
}

/**
 * The sub-form each facility uses: its own latest version when that is not archived, else its
 * archetype's latest unarchived default. Facilities without either are absent from the map.
 */
export async function effectiveSubForms(
  db: Db,
  tenantId: string,
  facilities: Array<{ id: string; archetype: string }>
): Promise<Map<string, EffectiveSubForm>> {
  const rows = await db.facilitySubForm.findMany({
    where: {
      tenantId,
      OR: [{ subject: 'ARCHETYPE' }, { subject: 'FACILITY', facilityId: { in: facilities.map((f) => f.id) } }],
    },
    select: { id: true, subject: true, subjectKey: true, version: true, isArchived: true, fieldsJson: true },
  });
  const latest = latestBy(rows, (r) => r.subjectKey);
  const out = new Map<string, EffectiveSubForm>();
  for (const f of facilities) {
    const own = latest.get(facilitySubjectKey(f.id));
    const def = latest.get(archetypeSubjectKey(f.archetype as FacilityArchetype));
    const pick = own && !own.isArchived ? own : def && !def.isArchived ? def : null;
    if (pick) out.set(f.id, { source: pick.subject, id: pick.id, subjectKey: pick.subjectKey, version: pick.version, fields: pick.fieldsJson });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Unarchived latest templates that list each section code. */
function templatesBySection(templates: TemplateRow[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const t of templates) {
    if (t.isArchived) continue;
    for (const b of parseLayout(t.layoutJson)) {
      if (b.type === 'SECTION') out.set(b.sectionCode, [...(out.get(b.sectionCode) ?? []), t.code]);
    }
  }
  return out;
}

export async function getFormLibrary(tenantId: string): Promise<FormLibraryDto> {
  await ensureFacilities(prisma, tenantId);
  await ensureFormLibrary(prisma, tenantId);
  const [sectionRows, subFormRows, templateRows, facilities] = await Promise.all([
    prisma.formSection.findMany({ where: { tenantId } }),
    prisma.facilitySubForm.findMany({ where: { tenantId }, include: SUBFORM_INCLUDE }),
    prisma.visitFormTemplate.findMany({ where: { tenantId } }),
    prisma.facility.findMany({ where: { tenantId }, orderBy: [{ isRetired: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }] }),
  ]);
  const sections = [...latestBy(sectionRows, (r) => r.code).values()].sort((a, b) => a.code.localeCompare(b.code));
  const subForms = [...latestBy(subFormRows, (r) => r.subjectKey).values()];
  const templates = [...latestBy(templateRows, (r) => r.code).values()].sort(
    (a, b) => visitKindOrder(a.visitKind) - visitKindOrder(b.visitKind) || a.code.localeCompare(b.code)
  );
  const [sUsage, fUsage, tUsage] = await Promise.all([
    sectionUsage(prisma, tenantId, sections.map((s) => s.id)),
    subFormUsage(prisma, subForms.map((s) => s.id)),
    templateUsage(prisma, templates.map((t) => t.id)),
  ]);
  const bySection = templatesBySection(templates);
  const effective = await effectiveSubForms(prisma, tenantId, facilities);
  const archetypeOrder = ['BUILDING_WORKS', 'SUPPLY_INSTALLATION', 'UTILITIES', 'EXTERNAL_WORKS'];
  return {
    sections: sections.map((s) => serializeSection(s, s.version, sUsage.get(s.id) ?? 0, bySection.get(s.code) ?? [])),
    archetypeSubForms: subForms
      .filter((s) => s.subject === 'ARCHETYPE')
      .sort((a, b) => archetypeOrder.indexOf(a.archetype ?? '') - archetypeOrder.indexOf(b.archetype ?? ''))
      .map((s) => serializeSubForm(s, s.version, fUsage.get(s.id) ?? 0)),
    facilitySubForms: subForms
      .filter((s) => s.subject === 'FACILITY')
      .sort((a, b) => (a.facility?.name ?? '').localeCompare(b.facility?.name ?? ''))
      .map((s) => serializeSubForm(s, s.version, fUsage.get(s.id) ?? 0)),
    templates: templates.map((t) => serializeTemplate(t, t.version, tUsage.get(t.id) ?? 0)),
    facilities: facilities.map((f): FacilityEffectiveSubForm => {
      const e = effective.get(f.id);
      return {
        facilityId: f.id,
        code: f.code,
        name: f.name,
        pluralName: f.pluralName,
        archetype: f.archetype as FacilityArchetype,
        isRetired: f.isRetired,
        source: e?.source ?? 'ARCHETYPE',
        subFormId: e?.id ?? null,
        version: e?.version ?? null,
      };
    }),
  };
}

function visitKindOrder(kind: string): number {
  return Object.keys(VISIT_KIND_META).indexOf(kind);
}

export async function listSectionVersions(tenantId: string, code: string): Promise<FormSectionDto[]> {
  const rows = await prisma.formSection.findMany({ where: { tenantId, code }, orderBy: { version: 'desc' } });
  if (rows.length === 0) throw new AppError('Form section not found', 404, 'FORM_SECTION_NOT_FOUND');
  const usage = await sectionUsage(prisma, tenantId, rows.map((r) => r.id));
  const templates = [...latestBy(await prisma.visitFormTemplate.findMany({ where: { tenantId } }), (t) => t.code).values()];
  const usedBy = templatesBySection(templates).get(code) ?? [];
  return rows.map((r) => serializeSection(r, rows[0].version, usage.get(r.id) ?? 0, usedBy));
}

export async function listSubFormVersions(tenantId: string, subjectKey: string): Promise<FacilitySubFormDto[]> {
  const rows = await prisma.facilitySubForm.findMany({ where: { tenantId, subjectKey }, include: SUBFORM_INCLUDE, orderBy: { version: 'desc' } });
  if (rows.length === 0) throw new AppError('Sub-form not found', 404, 'SUBFORM_NOT_FOUND');
  const usage = await subFormUsage(prisma, rows.map((r) => r.id));
  return rows.map((r) => serializeSubForm(r, rows[0].version, usage.get(r.id) ?? 0));
}

export async function listTemplateVersions(tenantId: string, code: string): Promise<VisitFormTemplateDto[]> {
  const rows = await prisma.visitFormTemplate.findMany({ where: { tenantId, code }, orderBy: { version: 'desc' } });
  if (rows.length === 0) throw new AppError('Monitoring form template not found', 404, 'VISIT_FORM_TEMPLATE_NOT_FOUND');
  const usage = await templateUsage(prisma, rows.map((r) => r.id));
  return rows.map((r) => serializeTemplate(r, rows[0].version, usage.get(r.id) ?? 0));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function audit(
  tx: Prisma.TransactionClient,
  webUser: WebJwtPayload,
  summaryText: string,
  payload: { componentKind: 'SECTION' | 'SUBFORM' | 'TEMPLATE'; code?: string; subjectKey?: string; version?: number; mode: SaveMode; [k: string]: unknown }
) {
  await recordAuditEvent(tx, {
    tenantId: webUser.tenantId,
    projectId: null,
    actorType: 'WEB_USER',
    actorId: webUser.userId,
    actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
    action: 'FORM_COMPONENT_SAVED',
    summaryText,
    payload,
  });
}

/** Key → type across earlier versions (D-R3.12: a key never changes type). */
function keyTypesOf(rows: Array<{ fieldsJson: unknown }>): Record<string, FormFieldType> {
  const out: Record<string, FormFieldType> = {};
  for (const r of rows) {
    const parsed = FormFieldsSchema.safeParse(r.fieldsJson);
    if (!parsed.success) continue;
    for (const f of parsed.data) out[f.key] ??= f.type;
  }
  return out;
}

function assertFields(fields: FormField[], context: 'SECTION' | 'SUBFORM', previousKeyTypes: Record<string, FormFieldType>) {
  const issues = validateFormFields(fields, { context, previousKeyTypes });
  if (issues.length > 0) throw new AppError(issues[0].message, 422, issues[0].code, { issues });
}

const modeText = (mode: SaveMode, version: number, previous?: number) =>
  mode === 'versioned'
    ? `saved as version ${version}; forms already built keep version ${previous}`
    : mode === 'edited'
      ? `edited version ${version} (not used yet)`
      : `version ${version}`;

// ---------------------------------------------------------------------------
// Reserved sections (needs pipeline wave 5, N8; review fix: enforced here, not only on the web)
// ---------------------------------------------------------------------------

/** The fixed keys of each reserved section: acceptance and the review read them. */
const RESERVED_SECTION_FIXED_KEYS: Record<string, string[]> = {
  [NEEDS_VERIFICATION_SECTION_CODES.SITE]: [NEEDS_VERIFICATION_FIELD_KEYS.schoolFound],
  [NEEDS_VERIFICATION_SECTION_CODES.FACILITY]: [
    NEEDS_VERIFICATION_FIELD_KEYS.existingQuantity,
    NEEDS_VERIFICATION_FIELD_KEYS.existingCondition,
    NEEDS_VERIFICATION_FIELD_KEYS.matchesAssessment,
  ],
};

export const isReservedSectionCode = (code: string) => NEEDS_VERIFICATION_RESERVED_SECTION_CODES.includes(code);

/**
 * A reserved section keeps its fixed keys with their default types (labels, guidance, rules and extra
 * fields may change); the condition question keeps exactly the option keys acceptance maps
 * (`NEEDS_VERIFICATION_CONDITION_BY_OPTION`; labels may change). Else 422 FORM_SECTION_RESERVED_KEYS.
 */
function assertReservedSectionFields(code: string, fields: FormField[]): void {
  const fixed = RESERVED_SECTION_FIXED_KEYS[code];
  if (!fixed) return;
  const defaults = DEFAULT_FORM_LIBRARY.sections.find((s) => s.code === code)?.fields ?? [];
  const refuse = (message: string, key: string) => new AppError(message, 422, 'FORM_SECTION_RESERVED_KEYS', { sectionCode: code, key });
  for (const key of fixed) {
    const field = fields.find((f) => f.key === key);
    const expected = defaults.find((f) => f.key === key)?.type;
    if (!field) throw refuse(`The field verification form needs its field "${key}": it cannot be removed.`, key);
    if (expected && field.type !== expected) throw refuse(`The field "${key}" of the field verification form must stay a ${expected} field.`, key);
    if (key === NEEDS_VERIFICATION_FIELD_KEYS.existingCondition) {
      const want = Object.keys(NEEDS_VERIFICATION_CONDITION_BY_OPTION).sort();
      const have = field.options.map((o) => o.key).sort();
      if (have.length !== want.length || have.some((k, i) => k !== want[i])) {
        throw refuse(`The condition question keeps its options ${want.join(', ')} (labels may change).`, key);
      }
    }
  }
}

export async function saveFormSection(webUser: WebJwtPayload, input: SaveFormSectionRequest, existingCode: string | null): Promise<FormSectionDto> {
  const tenantId = webUser.tenantId;
  await ensureFormLibrary(prisma, tenantId);
  const code = existingCode ?? input.code;
  await prisma.$transaction(async (tx) => {
    await lockFormLibrary(tx, tenantId);
    if (existingCode && input.code !== existingCode) throw new AppError('A section code cannot change; create a new section instead', 422, 'FORM_CODE_LOCKED');
    const versions = await tx.formSection.findMany({ where: { tenantId, code }, orderBy: { version: 'desc' } });
    const latest = versions[0];
    if (!existingCode && latest) throw new AppError(`A section with code "${code}" already exists`, 409, 'FORM_SECTION_EXISTS');
    if (existingCode && !latest) throw new AppError('Form section not found', 404, 'FORM_SECTION_NOT_FOUND');
    assertFields(input.fields, 'SECTION', keyTypesOf(versions));
    assertReservedSectionFields(code, input.fields);
    const data = {
      title: input.title,
      description: input.description,
      fieldsJson: input.fields as unknown as Prisma.InputJsonValue,
      createdByUserId: webUser.userId,
    };
    let saved: { id: string; version: number };
    let mode: SaveMode;
    if (!latest) {
      saved = await tx.formSection.create({ data: { tenantId, code, version: 1, ...data } });
      mode = 'created';
    } else if (((await sectionUsage(tx, tenantId, [latest.id])).get(latest.id) ?? 0) === 0) {
      saved = await tx.formSection.update({ where: { id: latest.id }, data });
      mode = 'edited';
    } else {
      saved = await tx.formSection.create({ data: { tenantId, code, version: latest.version + 1, isArchived: latest.isArchived, ...data } });
      mode = 'versioned';
    }
    await audit(tx, webUser, `Form section "${input.title}" (${code}): ${modeText(mode, saved.version, latest?.version)}.`, {
      componentKind: 'SECTION',
      code,
      version: saved.version,
      mode,
      id: saved.id,
    });
  });
  return (await listSectionVersions(tenantId, code))[0];
}

export async function setFormSectionArchived(webUser: WebJwtPayload, code: string, archived: boolean): Promise<FormSectionDto> {
  const tenantId = webUser.tenantId;
  await prisma.$transaction(async (tx) => {
    await lockFormLibrary(tx, tenantId);
    if (archived && isReservedSectionCode(code)) {
      throw new AppError(`Section ${code} is the field verification form of the needs pipeline: it cannot be archived.`, 409, 'FORM_SECTION_RESERVED', { sectionCode: code });
    }
    if (archived) {
      const templates = [...latestBy(await tx.visitFormTemplate.findMany({ where: { tenantId } }), (t) => t.code).values()];
      const usedBy = templatesBySection(templates).get(code) ?? [];
      if (usedBy.length > 0) {
        throw new AppError(`Section ${code} is used by template(s) ${usedBy.join(', ')}; remove it from them first.`, 409, 'SECTION_IN_USE', { templateCodes: usedBy });
      }
    }
    const updated = await tx.formSection.updateMany({ where: { tenantId, code }, data: { isArchived: archived } });
    if (updated.count === 0) throw new AppError('Form section not found', 404, 'FORM_SECTION_NOT_FOUND');
    await audit(tx, webUser, `${archived ? 'Archived' : 'Restored'} form section ${code}.`, { componentKind: 'SECTION', code, mode: archived ? 'archived' : 'restored' });
  });
  return (await listSectionVersions(tenantId, code))[0];
}

/** Saves the next state of a sub-form subject: in place while its latest version is unused, else v + 1. */
async function writeSubForm(
  tx: Prisma.TransactionClient,
  webUser: WebJwtPayload,
  subject: { subjectKey: string; archetype: FacilityArchetype | null; facilityId: string | null },
  fields: FormField[],
  extraKeyTypes: Record<string, FormFieldType> = {}
): Promise<{ id: string; version: number; mode: 'created' | 'edited' | 'versioned'; previous: number | null }> {
  const tenantId = webUser.tenantId;
  const versions = await tx.facilitySubForm.findMany({ where: { tenantId, subjectKey: subject.subjectKey }, orderBy: { version: 'desc' } });
  const latest = versions[0];
  assertFields(fields, 'SUBFORM', { ...extraKeyTypes, ...keyTypesOf(versions) });
  const data = { fieldsJson: fields as unknown as Prisma.InputJsonValue, isArchived: false, createdByUserId: webUser.userId };
  if (!latest) {
    const saved = await tx.facilitySubForm.create({
      data: {
        tenantId,
        subject: subject.facilityId ? 'FACILITY' : 'ARCHETYPE',
        archetype: subject.archetype,
        facilityId: subject.facilityId,
        subjectKey: subject.subjectKey,
        version: 1,
        ...data,
      },
    });
    return { id: saved.id, version: 1, mode: 'created', previous: null };
  }
  if (((await subFormUsage(tx, [latest.id])).get(latest.id) ?? 0) === 0) {
    const saved = await tx.facilitySubForm.update({ where: { id: latest.id }, data });
    return { id: saved.id, version: saved.version, mode: 'edited', previous: latest.version };
  }
  const saved = await tx.facilitySubForm.create({
    data: {
      tenantId,
      subject: latest.subject,
      archetype: latest.archetype,
      facilityId: latest.facilityId,
      subjectKey: latest.subjectKey,
      version: latest.version + 1,
      ...data,
    },
  });
  return { id: saved.id, version: saved.version, mode: 'versioned', previous: latest.version };
}

export async function saveArchetypeSubForm(webUser: WebJwtPayload, archetype: FacilityArchetype, input: SaveFacilitySubFormRequest): Promise<FacilitySubFormDto> {
  const tenantId = webUser.tenantId;
  await ensureFormLibrary(prisma, tenantId);
  const subjectKey = archetypeSubjectKey(archetype);
  await prisma.$transaction(async (tx) => {
    await lockFormLibrary(tx, tenantId);
    const r = await writeSubForm(tx, webUser, { subjectKey, archetype, facilityId: null }, input.fields);
    await audit(tx, webUser, `Default sub-form for ${archetype}: ${modeText(r.mode, r.version, r.previous ?? undefined)}.`, {
      componentKind: 'SUBFORM',
      subjectKey,
      version: r.version,
      mode: r.mode,
      id: r.id,
    });
  });
  return (await listSubFormVersions(tenantId, subjectKey))[0];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadFacility(db: Db, tenantId: string, facilityId: string) {
  const facility = UUID_RE.test(facilityId) ? await db.facility.findFirst({ where: { id: facilityId, tenantId } }) : null;
  if (!facility) throw new AppError('Facility not found', 404, 'FACILITY_NOT_FOUND');
  return facility;
}

async function ownUnarchived(db: Db, tenantId: string, facilityId: string) {
  const latest = await db.facilitySubForm.findFirst({ where: { tenantId, subjectKey: facilitySubjectKey(facilityId) }, orderBy: { version: 'desc' } });
  return latest && !latest.isArchived ? latest : null;
}

/** "Customise": the facility gets its own sub-form, a copy of its archetype default unless fields are given. */
export async function customiseFacilitySubForm(webUser: WebJwtPayload, facilityId: string, input: CustomiseFacilitySubFormRequest): Promise<FacilitySubFormDto> {
  const tenantId = webUser.tenantId;
  await ensureFormLibrary(prisma, tenantId);
  const subjectKey = facilitySubjectKey(facilityId);
  await prisma.$transaction(async (tx) => {
    await lockFormLibrary(tx, tenantId);
    const facility = await loadFacility(tx, tenantId, facilityId);
    if (await ownUnarchived(tx, tenantId, facilityId)) {
      throw new AppError(`${facility.name} already has its own sub-form; edit it instead.`, 409, 'SUBFORM_ALREADY_CUSTOMISED');
    }
    const defaults = await tx.facilitySubForm.findMany({ where: { tenantId, subjectKey: archetypeSubjectKey(facility.archetype as FacilityArchetype) } });
    const latestDefault = [...defaults].sort((a, b) => b.version - a.version)[0];
    const fields = input.fields ?? (latestDefault ? parseFields(latestDefault.fieldsJson) : null);
    if (!fields) throw new AppError(`There is no default sub-form for ${facility.archetype} to copy`, 422, 'SUBFORM_DEFAULT_MISSING');
    const r = await writeSubForm(tx, webUser, { subjectKey, archetype: null, facilityId }, fields, keyTypesOf(defaults));
    await audit(tx, webUser, `Customised the sub-form of ${facility.name} (${facility.code}), version ${r.version}.`, {
      componentKind: 'SUBFORM',
      subjectKey,
      version: r.version,
      mode: 'customised',
      facilityId,
      copiedFromDefault: !input.fields,
      id: r.id,
    });
  });
  return (await listSubFormVersions(tenantId, subjectKey))[0];
}

export async function saveFacilitySubForm(webUser: WebJwtPayload, facilityId: string, input: SaveFacilitySubFormRequest): Promise<FacilitySubFormDto> {
  const tenantId = webUser.tenantId;
  const subjectKey = facilitySubjectKey(facilityId);
  await prisma.$transaction(async (tx) => {
    await lockFormLibrary(tx, tenantId);
    const facility = await loadFacility(tx, tenantId, facilityId);
    if (!(await ownUnarchived(tx, tenantId, facilityId))) {
      throw new AppError(`${facility.name} uses its archetype's default sub-form; customise it first.`, 404, 'SUBFORM_NOT_CUSTOMISED');
    }
    const defaults = await tx.facilitySubForm.findMany({ where: { tenantId, subjectKey: archetypeSubjectKey(facility.archetype as FacilityArchetype) } });
    const r = await writeSubForm(tx, webUser, { subjectKey, archetype: null, facilityId }, input.fields, keyTypesOf(defaults));
    await audit(tx, webUser, `Sub-form of ${facility.name} (${facility.code}): ${modeText(r.mode, r.version, r.previous ?? undefined)}.`, {
      componentKind: 'SUBFORM',
      subjectKey,
      version: r.version,
      mode: r.mode,
      facilityId,
      id: r.id,
    });
  });
  return (await listSubFormVersions(tenantId, subjectKey))[0];
}

/** "Reset to default": archives the facility's own sub-form, so its archetype default applies again. */
export async function resetFacilitySubForm(webUser: WebJwtPayload, facilityId: string): Promise<FacilityEffectiveSubForm> {
  const tenantId = webUser.tenantId;
  const subjectKey = facilitySubjectKey(facilityId);
  await prisma.$transaction(async (tx) => {
    await lockFormLibrary(tx, tenantId);
    const facility = await loadFacility(tx, tenantId, facilityId);
    if (!(await ownUnarchived(tx, tenantId, facilityId))) {
      throw new AppError(`${facility.name} already uses its archetype's default sub-form.`, 404, 'SUBFORM_NOT_CUSTOMISED');
    }
    await tx.facilitySubForm.updateMany({ where: { tenantId, subjectKey }, data: { isArchived: true } });
    await audit(tx, webUser, `Reset the sub-form of ${facility.name} (${facility.code}) to the ${facility.archetype} default.`, {
      componentKind: 'SUBFORM',
      subjectKey,
      mode: 'reset',
      facilityId,
    });
  });
  const library = await getFormLibrary(tenantId);
  return library.facilities.find((f) => f.facilityId === facilityId)!;
}

export async function saveVisitFormTemplate(webUser: WebJwtPayload, input: SaveVisitFormTemplateRequest, existingCode: string | null): Promise<VisitFormTemplateDto> {
  const tenantId = webUser.tenantId;
  await ensureFormLibrary(prisma, tenantId);
  const code = existingCode ?? input.code;
  await prisma.$transaction(async (tx) => {
    await lockFormLibrary(tx, tenantId);
    if (existingCode && input.code !== existingCode) throw new AppError('A template code cannot change; create a new template instead', 422, 'FORM_CODE_LOCKED');
    const latest = await tx.visitFormTemplate.findFirst({ where: { tenantId, code }, orderBy: { version: 'desc' }, include: { _count: { select: { snapshots: true } } } });
    if (!existingCode && latest) throw new AppError(`A template with code "${code}" already exists`, 409, 'VISIT_FORM_TEMPLATE_EXISTS');
    if (existingCode && !latest) throw new AppError('Monitoring form template not found', 404, 'VISIT_FORM_TEMPLATE_NOT_FOUND');
    if (latest && latest.visitKind !== input.visitKind) {
      throw new AppError('A template keeps its monitoring visit kind; create a new template for another kind', 422, 'TEMPLATE_KIND_LOCKED');
    }
    const codes = input.blocks.flatMap((b) => (b.type === 'SECTION' ? [b.sectionCode] : []));
    const reserved = codes.filter(isReservedSectionCode);
    if (reserved.length > 0) {
      throw new AppError(`Section(s) ${reserved.join(', ')} belong to the field verification form and cannot be used in a monitoring form template.`, 422, 'FORM_SECTION_RESERVED', { sectionCodes: reserved });
    }
    const sections = await tx.formSection.findMany({ where: { tenantId, code: { in: codes } }, select: { code: true, version: true, isArchived: true } });
    const live = latestBy(sections, (s) => s.code);
    const missing = codes.filter((c) => !live.get(c) || live.get(c)!.isArchived);
    if (missing.length > 0) throw new AppError(`Unknown or archived section(s): ${missing.join(', ')}`, 422, 'SECTION_NOT_FOUND', { sectionCodes: missing });
    const data = { name: input.name, visitKind: input.visitKind, layoutJson: input.blocks as unknown as Prisma.InputJsonValue, createdByUserId: webUser.userId };
    let saved: { id: string; version: number };
    let mode: SaveMode;
    if (!latest) {
      saved = await tx.visitFormTemplate.create({ data: { tenantId, code, version: 1, ...data } });
      mode = 'created';
    } else if (latest._count.snapshots === 0) {
      saved = await tx.visitFormTemplate.update({ where: { id: latest.id }, data });
      mode = 'edited';
    } else {
      saved = await tx.visitFormTemplate.create({ data: { tenantId, code, version: latest.version + 1, isArchived: latest.isArchived, ...data } });
      mode = 'versioned';
    }
    await audit(tx, webUser, `Visit form template "${input.name}" (${code}): ${modeText(mode, saved.version, latest?.version)}.`, {
      componentKind: 'TEMPLATE',
      code,
      version: saved.version,
      mode,
      visitKind: input.visitKind,
      id: saved.id,
    });
  });
  return (await listTemplateVersions(tenantId, code))[0];
}

export async function setVisitFormTemplateArchived(webUser: WebJwtPayload, code: string, archived: boolean): Promise<VisitFormTemplateDto> {
  const tenantId = webUser.tenantId;
  await prisma.$transaction(async (tx) => {
    await lockFormLibrary(tx, tenantId);
    if (!archived) {
      // Restoring needs its sections to exist.
      const latest = await tx.visitFormTemplate.findFirst({ where: { tenantId, code }, orderBy: { version: 'desc' } });
      if (latest) {
        const codes = parseLayout(latest.layoutJson).flatMap((b) => (b.type === 'SECTION' ? [b.sectionCode] : []));
        const live = latestBy(await tx.formSection.findMany({ where: { tenantId, code: { in: codes } } }), (s) => s.code);
        const missing = codes.filter((c) => !live.get(c) || live.get(c)!.isArchived);
        if (missing.length > 0) throw new AppError(`Restore section(s) ${missing.join(', ')} first`, 409, 'SECTION_NOT_FOUND', { sectionCodes: missing });
      }
    }
    const updated = await tx.visitFormTemplate.updateMany({ where: { tenantId, code }, data: { isArchived: archived } });
    if (updated.count === 0) throw new AppError('Monitoring form template not found', 404, 'VISIT_FORM_TEMPLATE_NOT_FOUND');
    await audit(tx, webUser, `${archived ? 'Archived' : 'Restored'} visit form template ${code}.`, { componentKind: 'TEMPLATE', code, mode: archived ? 'archived' : 'restored' });
  });
  return (await listTemplateVersions(tenantId, code))[0];
}

/** Template codes that exist (unarchived) in the tenant, by visit kind; for the project type editor. */
export async function liveTemplateKinds(db: Db, tenantId: string): Promise<Map<string, VisitKind>> {
  const rows = await db.visitFormTemplate.findMany({ where: { tenantId }, select: { code: true, version: true, visitKind: true, isArchived: true } });
  const out = new Map<string, VisitKind>();
  for (const r of latestBy(rows, (t) => t.code).values()) if (!r.isArchived) out.set(r.code, r.visitKind as VisitKind);
  return out;
}
