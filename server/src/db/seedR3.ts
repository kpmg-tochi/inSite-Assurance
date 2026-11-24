import { Prisma } from "@prisma/client";
import {
  DEFAULT_FORM_LIBRARY,
  FormFieldInput,
  ProjectTypeConfigSchema,
  SaveFacilitySubFormRequestSchema,
  VisitKind,
  VisitKindEnum,
} from "@insite/shared";
import { prisma } from "../config/prisma";
import { provisionDefaultFormLibrary, facilitySubjectKey } from "../modules/forms/formLibraryProvisioning";
import { PROGRAMME_TENANT_SLUG } from "./seedPhase11";

/**
 * Redesign R3 seed. Runs after seedR2.
 * - Every tenant gets the default form library (10 fixed sections, 4 archetype sub-forms, 7 visit
 *   form templates).
 * - Both programme types get `visitForms` (template code = visit kind), merged without a version bump
 *   (seed only, as Phases 13, 15 and 16 do).
 * - The programme tenant's TOILET facility is customised (spec 6.1's example): the building default plus
 *   a per-unit "Plumbing connected" yes/no that needs a photo when yes, so the demo shows an override.
 */
export async function seedR3(): Promise<void> {
  for (const t of await prisma.tenant.findMany({ select: { id: true } })) {
    await provisionDefaultFormLibrary(prisma, t.id);
  }

  const programme = await prisma.tenant.findUniqueOrThrow({ where: { slug: PROGRAMME_TENANT_SLUG } });
  const templateCodeByVisitKind = Object.fromEntries(VisitKindEnum.options.map((k) => [k, k])) as Record<VisitKind, string>;
  for (const type of await prisma.projectType.findMany({ where: { tenantId: programme.id } })) {
    const config = ProjectTypeConfigSchema.parse({
      ...ProjectTypeConfigSchema.parse(type.configJson),
      visitForms: { templateCodeByVisitKind },
    });
    await prisma.projectType.update({ where: { id: type.id }, data: { configJson: config as unknown as Prisma.InputJsonValue } });
  }

  const toilet = await prisma.facility.findUniqueOrThrow({ where: { tenantId_code: { tenantId: programme.id, code: "TOILET" } } });
  const plumbing: FormFieldInput = {
    key: "plumbing-connected",
    label: "Plumbing connected",
    type: "YES_NO",
    scope: "PER_UNIT",
    visitKinds: ["ROUTINE", "QUARTERLY_ME", "AD_HOC", "FINAL_EVALUATION"],
    rules: [{ when: { equals: "YES" }, then: "REQUIRE_PHOTO" }],
  };
  const { fields } = SaveFacilitySubFormRequestSchema.parse({ fields: [...DEFAULT_FORM_LIBRARY.archetypeSubForms.BUILDING_WORKS, plumbing] });
  await prisma.facilitySubForm.upsert({
    where: { tenantId_subjectKey_version: { tenantId: programme.id, subjectKey: facilitySubjectKey(toilet.id), version: 1 } },
    update: {},
    create: {
      tenantId: programme.id,
      subject: "FACILITY",
      facilityId: toilet.id,
      subjectKey: facilitySubjectKey(toilet.id),
      version: 1,
      fieldsJson: fields as unknown as Prisma.InputJsonValue,
    },
  });
}
