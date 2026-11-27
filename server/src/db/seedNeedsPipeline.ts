import { Prisma } from "@prisma/client";
import {
  CostingStandardSchema,
  DEFAULT_COSTING_STANDARD,
  DEFAULT_DI_NEEDS_PIPELINE,
  DEFAULT_MG_NEEDS_PIPELINE,
  ProjectTypeConfigSchema,
} from "@insite/shared";
import { prisma } from "../config/prisma";
import { PROGRAMME_TENANT_SLUG } from "./seedPhase11";
import { NEEDS_PIPELINE_PEOPLE, NEEDS_PIPELINE_ROLES } from "./seedUbecRoster";

/**
 * Needs pipeline seed (wave 1, N1). Merges the default pipelines into the two UBEC programme types:
 * Direct Intervention (code CENTRAL) gets `DEFAULT_DI_NEEDS_PIPELINE`, Matching Grants (CO_FUNDED)
 * `DEFAULT_MG_NEEDS_PIPELINE`. Like Phases 13–16 the type config is written without a version bump
 * (seed only). Project snapshots are left alone: the pipeline's rules are read from the type when a
 * cycle opens (the cycle keeps its own copy), and a converted project gets its snapshot at
 * conversion.
 *
 * The people of the cycle are created by `seedUbecRoster` (D-N.25). Wave 2 (N2): the programme tenant
 * gets `DEFAULT_COSTING_STANDARD` (specimen rates) as costing standard version 1, unlocked. No cycle
 * or proposed project is seeded yet: wave 5 (N9) adds the demo cycles here.
 */
export async function seedNeedsPipeline(): Promise<void> {
  const programme = await prisma.tenant.findUnique({ where: { slug: PROGRAMME_TENANT_SLUG } });
  if (!programme) return;
  const types = await prisma.projectType.findMany({ where: { tenantId: programme.id, code: { in: ["CENTRAL", "CO_FUNDED"] } } });
  for (const type of types) {
    const config = ProjectTypeConfigSchema.parse({
      ...ProjectTypeConfigSchema.parse(type.configJson),
      needsPipeline: type.code === "CO_FUNDED" ? DEFAULT_MG_NEEDS_PIPELINE : DEFAULT_DI_NEEDS_PIPELINE,
    });
    await prisma.projectType.update({ where: { id: type.id }, data: { configJson: config as unknown as Prisma.InputJsonValue } });
  }
  const standard = CostingStandardSchema.parse(DEFAULT_COSTING_STANDARD);
  await prisma.costingStandardVersion.create({
    data: {
      tenantId: programme.id,
      version: 1,
      ratesJson: standard.rates as unknown as Prisma.InputJsonValue,
      zoneFactorsJson: standard.zoneFactors as unknown as Prisma.InputJsonValue,
      supervisionMonitoringPct: standard.supervisionMonitoringPct,
      contingencyPct: standard.contingencyPct,
      ceilingsJson: standard.ceilings as unknown as Prisma.InputJsonValue,
      note: "Specimen rates for the demo (replace with UBEC rates)",
      savedByName: "System (seed)",
    },
  });
  console.log(`   • Needs pipeline: cycle rules on ${types.length} programme type(s); costing standard v1 (${standard.rates.length} specimen rates). Cycle logins, password Password123!:`);
  for (const person of NEEDS_PIPELINE_PEOPLE) {
    const role = NEEDS_PIPELINE_ROLES.find((r) => r.code === person.roleCode)?.name ?? person.roleCode;
    console.log(`     - ${`${role}${person.organization === "KANO_SUBEB" ? ", Kano" : ""}`.padEnd(52)} ${person.email}`);
  }
}
