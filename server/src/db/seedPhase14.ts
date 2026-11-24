import { Prisma } from "@prisma/client";
import { ProjectTypeConfig, ProjectTypeConfigSchema, ProjectTypeSnapshot } from "@insite/shared";
import { prisma } from "../config/prisma";
import { PROGRAMME_TENANT_SLUG } from "./seedPhase11";
import { INDEPENDENT_ME_EMAIL, UBEC_ME_EMAIL, UBEC_ROLE } from "./seedUbecRoster";

/**
 * Phase 14 seed: supervision on the programme's project types; the UBEC M&E officer supervises more
 * sites than the Matching Grants limit. Redesign R5f deleted checklist templates and the legacy
 * PRG-211 inspections: PRG-211's baseline, late routine visit and major finding are R4 visits
 * (seedR4).
 */

export async function seedPhase14(): Promise<void> {
  const programme = await prisma.tenant.findUniqueOrThrow({ where: { slug: PROGRAMME_TENANT_SLUG } });

  // UBEC roster: M&E officers see only the projects they are assigned to. The UBEC M&E officer
  // (seedPhase12, on PRG-102) is assigned to the projects her stories touch: PRG-103 (final
  // evaluation, CoC, handover review, defects) and PRG-211 / PRG-221 (visits planned and reviewed with
  // the SUBEBs, seedR4); seedPhase16 adds PRG-104 and PRG-105. Above the Matching Grants limit of two
  // and ~830 km apart. The Independent M&E is also on PRG-211.
  const officer = await prisma.user.findUniqueOrThrow({ where: { email: UBEC_ME_EMAIL } });
  const independent = await prisma.user.findUniqueOrThrow({ where: { email: INDEPENDENT_ME_EMAIL } });
  const liveProjects = await prisma.project.findMany({
    where: { tenantId: programme.id, status: "ACTIVE" },
    select: { id: true, codePrefix: true },
  });
  const officerProjects = liveProjects.filter((p) => ["PRG-102", "PRG-103", "PRG-211", "PRG-221"].includes(p.codePrefix));
  await prisma.userProjectAssignment.createMany({ data: officerProjects.map((p) => ({ userId: officer.id, projectId: p.id })), skipDuplicates: true });
  const prg211 = liveProjects.find((p) => p.codePrefix === "PRG-211");
  if (prg211) await prisma.userProjectAssignment.createMany({ data: [{ userId: independent.id, projectId: prg211.id }], skipDuplicates: true });

  // Supervision on both project types. Seed only: written into the types' config (and the projects'
  // snapshots) without a version bump, as if the types had been created with it; editing a type
  // through the service bumps its version.
  // UBEC roster: the M&E roles and the Resident Supervisor (MONITOR is the Independent M&E).
  const supervisorRoleCodes: string[] = [UBEC_ROLE.UBEC_ME, UBEC_ROLE.SUBEB_ME, UBEC_ROLE.INDEPENDENT_ME, UBEC_ROLE.RESIDENT_SUPERVISOR];
  const types = await prisma.projectType.findMany({ where: { tenantId: programme.id } });
  const configs = new Map<string, ProjectTypeConfig>();
  for (const type of types) {
    const config = ProjectTypeConfigSchema.parse({
      ...ProjectTypeConfigSchema.parse(type.configJson),
      // Matching Grants: a low site limit (demo only; the manual gives Resident Supervisors 7 to 10
      // sites) so the seeded M&E officer (three live sites) is over it. Direct Intervention: 10.
      supervision:
        type.code === "CO_FUNDED"
          ? { supervisorRoleCodes, maxSitesPerSupervisor: 2, maxSpreadKm: 50 }
          : { supervisorRoleCodes, maxSitesPerSupervisor: 10, maxSpreadKm: 50 },
    });
    await prisma.projectType.update({ where: { id: type.id }, data: { configJson: config as unknown as Prisma.InputJsonValue } });
    configs.set(type.id, config);
  }

  // The seeded projects were created before: give their snapshots the same config (same version).
  const projects = await prisma.project.findMany({
    where: { tenantId: programme.id },
    select: { id: true, projectTypeId: true, projectTypeSnapshotJson: true },
  });
  for (const p of projects) {
    const config = p.projectTypeId ? configs.get(p.projectTypeId) : null;
    if (!config || !p.projectTypeSnapshotJson) continue;
    const snapshot = { ...(p.projectTypeSnapshotJson as unknown as ProjectTypeSnapshot), config };
    await prisma.project.update({ where: { id: p.id }, data: { projectTypeSnapshotJson: snapshot as unknown as Prisma.InputJsonValue } });
  }
}
