import { Prisma } from '@prisma/client';
import {
  DEFAULT_FORM_LIBRARY,
  FacilityArchetype,
  FacilitySubFormDefinitionSchema,
  FormSectionDefinitionSchema,
  SaveVisitFormTemplateRequestSchema,
} from '@insite/shared';
import { prisma } from '../../config/prisma';

/**
 * Redesign R3 (D-R3.21): every tenant gets the default form library (10 fixed sections, 4 archetype
 * sub-forms, 7 visit form templates) at version 1. Idempotent (skipDuplicates on the version keys),
 * so it is safe on tenant creation, lazily on first read and in the seed.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export const archetypeSubjectKey = (archetype: FacilityArchetype) => `ARCHETYPE:${archetype}`;
export const facilitySubjectKey = (facilityId: string) => `FACILITY:${facilityId}`;

export async function provisionDefaultFormLibrary(db: Db, tenantId: string): Promise<void> {
  await db.formSection.createMany({
    data: DEFAULT_FORM_LIBRARY.sections.map((s) => {
      const def = FormSectionDefinitionSchema.parse({ title: s.title, description: s.description ?? null, fields: s.fields });
      return {
        tenantId,
        code: s.code,
        version: 1,
        title: def.title,
        description: def.description,
        fieldsJson: def.fields as unknown as Prisma.InputJsonValue,
      };
    }),
    skipDuplicates: true,
  });
  await db.facilitySubForm.createMany({
    data: (Object.entries(DEFAULT_FORM_LIBRARY.archetypeSubForms) as Array<[FacilityArchetype, unknown]>).map(([archetype, fields]) => ({
      tenantId,
      subject: 'ARCHETYPE' as const,
      archetype,
      subjectKey: archetypeSubjectKey(archetype),
      version: 1,
      fieldsJson: FacilitySubFormDefinitionSchema.parse({ fields }).fields as unknown as Prisma.InputJsonValue,
    })),
    skipDuplicates: true,
  });
  await db.visitFormTemplate.createMany({
    data: DEFAULT_FORM_LIBRARY.templates.map((t) => {
      const parsed = SaveVisitFormTemplateRequestSchema.parse(t);
      return {
        tenantId,
        code: parsed.code,
        version: 1,
        name: parsed.name,
        visitKind: parsed.visitKind,
        layoutJson: parsed.blocks as unknown as Prisma.InputJsonValue,
      };
    }),
    skipDuplicates: true,
  });
}

/** Tenants created before R3 (or by an older seed) get the defaults on first use. */
export async function ensureFormLibrary(db: Db, tenantId: string): Promise<void> {
  const [sections, subForms, templates] = await Promise.all([
    db.formSection.count({ where: { tenantId } }),
    db.facilitySubForm.count({ where: { tenantId, subject: 'ARCHETYPE' } }),
    db.visitFormTemplate.count({ where: { tenantId } }),
  ]);
  if (sections === 0 || subForms === 0 || templates === 0) await provisionDefaultFormLibrary(db, tenantId);
}
