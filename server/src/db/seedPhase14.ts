import { Prisma } from "@prisma/client";
import { ProjectTypeConfig, ProjectTypeConfigSchema, ProjectTypeSnapshot } from "@insite/shared";
import { prisma } from "../config/prisma";
import { PROGRAMME_TENANT_SLUG } from "./seedPhase11";

/**
 * Phase 14 seed: supervision on the programme's project types and an M&E officer who supervises
 * more sites than the Co-Funded limit. Redesign R5f deleted checklist templates and the legacy
 * PRG-211 inspections: PRG-211's baseline, late routine visit and major finding are R4 visits
 * (seedR4).
 */

export async function seedPhase14(): Promise<void> {
  const programme = await prisma.tenant.findUniqueOrThrow({ where: { slug: PROGRAMME_TENANT_SLUG } });

  // The M&E officer: an Independent Monitor in the monitoring consultancy who supervises every live
  // programme site (three, above the Co-Funded limit of two, and ~830 km apart).
  const monitorRole = await prisma.role.findFirstOrThrow({ where: { tenantId: programme.id, code: "MONITOR" } });
  const monitorOrg = await prisma.organization.findFirstOrThrow({ where: { tenantId: programme.id, name: "Programme Monitoring Consultants" } });
  const passwordHash = (await prisma.user.findUniqueOrThrow({ where: { email: "programme.admin@insite.ng" } })).passwordHash;
  const officer = await prisma.user.create({
    data: {
      tenantId: programme.id,
      email: "me.officer@insite.ng",
      passwordHash,
      fullName: "Ngozi Eze (M&E Officer)",
      roleId: monitorRole.id,
      organizationId: monitorOrg.id,
    },
  });
  const liveProjects = await prisma.project.findMany({
    where: { tenantId: programme.id, status: "ACTIVE" },
    select: { id: true, codePrefix: true },
  });
  await prisma.userProjectAssignment.createMany({ data: liveProjects.map((p) => ({ userId: officer.id, projectId: p.id })), skipDuplicates: true });

  // Supervision on both project types. Seed only: written into the types' config (and the projects'
  // snapshots) without a version bump, as if the types had been created with it; editing a type
  // through the service bumps its version.
  const supervisorRoleCodes = ["MONITOR", "MONITOR_INSPECTOR", "INDEPENDENT_RESIDENT"];
  const types = await prisma.projectType.findMany({ where: { tenantId: programme.id } });
  const configs = new Map<string, ProjectTypeConfig>();
  for (const type of types) {
    const config = ProjectTypeConfigSchema.parse({
      ...ProjectTypeConfigSchema.parse(type.configJson),
      // Co-Funded: a low site limit so the seeded M&E officer (three live sites) is over it.
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
