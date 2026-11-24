import { addDays, zonedCalendarDate } from "@insite/shared";
import { prisma } from "../config/prisma";
import { provisionDefaultFacilities } from "../modules/facilities/facilities.service";
import { deriveLineDatesFromSprints } from "../modules/scope/scope.service";
import { refreshScheduleBadge } from "../modules/schedule/schedule.service";

/**
 * Redesign R2 seed. Runs after every other seed.
 * - R2a: every tenant gets the 50 default facilities (DEFAULT_FACILITIES).
 * - R2b: the demo programme projects get sprints and facility units, and their existing BoQ lines
 *   are tagged with units (line dates then follow the sprints, D-R2.5):
 *
 * | Project | Sprints (relative to the seed day)                    | Units                                         |
 * | ------- | ----------------------------------------------------- | --------------------------------------------- |
 * | PRG-102 | 1 Substructure +7..+48, 2 Superstructure +49..+111,   | U01 Classroom block A (8 lines), U02 Toilet    |
 * |         | 3 Finishes and WASH +112..+160 (mobilising)            | block (1 line), U03 Pupils' furniture (120 nr) |
 * | PRG-105 | 1 −98..−60, 2 −59..−15, 3 −14..+80 (its old schedule) | U01 Classroom block (5 lines), U02 Toilet      |
 * |         |                                                       | block and borehole (1 line)                    |
 *
 * - R2d (Phase 9 baselines and revisions are gone): LKK-402 and ABJ-108 get sprints too, so their
 *   schedule badges come from sprints. LKK-402 is behind: sprint 1 ended four weeks ago with its
 *   earthworks and culvert units incomplete (the pending "catch-up" revision story ended). ABJ-108 is
 *   on track: its sprint 1 unit is complete. Actual start dates are the planned starts of lines with progress.
 *
 * | LKK-402 | 1 Earthworks and culverts −90..−28, 2 Pavement and utilities −27..+60 | U01–U04 (Drainage and exterior works) |
 * | ABJ-108 | 1 Substation civil works −75..−5, 2 PV array and equipment −4..+70    | U01–U03 (Solar power)                 |
 *
 * Other older seeded projects (EDO-410, KAN-…, …) stay unit-less (legacy): their badge is UNSCHEDULED.
 */

type SprintSeed = { name: string; start: number; end: number; deliverables: string };
type UnitSeed = {
  code: string;
  facility: string;
  label: string;
  startSprint: number;
  endSprint: number;
  lines: string[];
  plannedQuantity?: number;
  quantityUnit?: string;
};

async function seedScope(codePrefix: string, sprints: SprintSeed[], units: UnitSeed[]): Promise<string | null> {
  const project = await prisma.project.findFirst({ where: { codePrefix }, select: { id: true, tenantId: true, timezone: true } });
  if (!project) return null;
  const today = zonedCalendarDate(new Date(), project.timezone);
  const sprintIds: string[] = [];
  for (const [i, s] of sprints.entries()) {
    const row = await prisma.projectSprint.create({
      data: {
        projectId: project.id,
        number: i + 1,
        name: s.name,
        startDate: addDays(today, s.start),
        endDate: addDays(today, s.end),
        deliverables: s.deliverables,
      },
    });
    sprintIds.push(row.id);
  }
  for (const [i, u] of units.entries()) {
    const facility = await prisma.facility.findUniqueOrThrow({ where: { tenantId_code: { tenantId: project.tenantId, code: u.facility } } });
    const unit = await prisma.facilityUnit.create({
      data: {
        projectId: project.id,
        facilityId: facility.id,
        code: u.code,
        label: u.label,
        plannedQuantity: u.plannedQuantity ?? null,
        quantityUnit: u.plannedQuantity ? u.quantityUnit ?? "nr" : null,
        startSprintId: sprintIds[u.startSprint - 1],
        endSprintId: sprintIds[u.endSprint - 1],
        sortOrder: (i + 1) * 10,
      },
    });
    if (u.lines.length) {
      await prisma.boqItem.updateMany({
        where: { projectId: project.id, wbsCode: { in: u.lines } },
        data: { facilityUnitId: unit.id, section: facility.name },
      });
    }
  }
  await prisma.$transaction((tx) => deriveLineDatesFromSprints(tx, project.id));
  return project.id;
}

/** Actual dates: the planned start once work has progress (R5f: reports are gone), completion at 100%. */
async function seedActualDates(projectId: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { timezone: true } });
  const today = zonedCalendarDate(new Date(), project.timezone);
  const items = await prisma.boqItem.findMany({ where: { projectId } });
  for (const i of items) {
    const pct = Number(i.cumulativeCertifiedPct);
    const end = i.plannedEndDate && i.plannedEndDate < today ? i.plannedEndDate : addDays(today, -1);
    await prisma.boqItem.update({
      where: { id: i.id },
      data: { actualStartDate: pct > 0 ? i.plannedStartDate : null, actualCompletionDate: pct >= 100 ? end : null },
    });
  }
  const starts = (await prisma.boqItem.findMany({ where: { projectId, actualStartDate: { not: null } }, select: { actualStartDate: true } }))
    .map((i) => i.actualStartDate!)
    .sort();
  await prisma.project.update({ where: { id: projectId }, data: { actualStartDate: starts[0] ?? null } });
}

export async function seedR2(): Promise<void> {
  for (const t of await prisma.tenant.findMany({ select: { id: true } })) {
    await provisionDefaultFacilities(prisma, t.id);
  }

  await seedScope(
    "PRG-102",
    [
      { name: "Substructure", start: 7, end: 48, deliverables: "Setting out, excavation, foundations and ground floor slab." },
      { name: "Superstructure", start: 49, end: 111, deliverables: "Frame, block walls and roof on the classroom block." },
      { name: "Finishes and WASH", start: 112, end: 160, deliverables: "Plaster, paint, doors and windows; toilet block and furniture delivered." },
    ],
    [
      {
        code: "U01",
        facility: "CLASSROOM",
        label: "Classroom block A (3 classrooms)",
        startSprint: 1,
        endSprint: 3,
        lines: ["01.01", "01.02", "01.03", "02.01", "02.02", "02.03", "03.01", "03.02"],
      },
      { code: "U02", facility: "TOILET", label: "Toilet block with hand-washing stations", startSprint: 3, endSprint: 3, lines: ["03.03"] },
      { code: "U03", facility: "PUPILS_FURNITURE", label: "Pupils' desks and chairs", startSprint: 3, endSprint: 3, lines: [], plannedQuantity: 120, quantityUnit: "nr" },
    ]
  );

  await seedScope(
    "PRG-105",
    [
      { name: "Substructure", start: -98, end: -60, deliverables: "Excavation, foundations and ground floor slab." },
      { name: "Superstructure", start: -59, end: -15, deliverables: "Frame, block walls and roof." },
      { name: "Finishes and WASH", start: -14, end: 80, deliverables: "Finishes and fittings; toilet block and borehole commissioned." },
    ],
    [
      { code: "U01", facility: "CLASSROOM", label: "Classroom block", startSprint: 1, endSprint: 3, lines: ["01.01", "01.02", "02.01", "02.02", "03.01"] },
      { code: "U02", facility: "TOILET", label: "Toilet block and borehole", startSprint: 3, endSprint: 3, lines: ["03.02"] },
    ]
  );
  const lkk = await seedScope(
    "LKK-402",
    [
      { name: "Earthworks and culverts", start: -90, end: -28, deliverables: "Site clearance, earthworks and the box culverts." },
      { name: "Pavement and utilities", start: -27, end: 60, deliverables: "Stone base and pavement; utility relocation." },
    ],
    [
      { code: "U01", facility: "DRAINAGE", label: "Site clearance and earthworks", startSprint: 1, endSprint: 1, lines: ["01.02.1"] },
      { code: "U02", facility: "DRAINAGE", label: "Box culverts and side drains", startSprint: 1, endSprint: 1, lines: ["02.01.1", "02.01.2"] },
      { code: "U03", facility: "DRAINAGE", label: "Pavement and stone base", startSprint: 2, endSprint: 2, lines: ["03.01.1"] },
      { code: "U04", facility: "DRAINAGE", label: "Utility relocation", startSprint: 2, endSprint: 2, lines: ["04.09.1"] },
    ]
  );
  const abj = await seedScope(
    "ABJ-108",
    [
      { name: "Substation civil works", start: -75, end: -5, deliverables: "Transformer plinths and the control room." },
      { name: "PV array and substation equipment", start: -4, end: 70, deliverables: "PV modules installed; step-up transformer tested." },
    ],
    [
      { code: "U01", facility: "SOLAR_POWER", label: "Transformer plinths and control room", startSprint: 1, endSprint: 1, lines: ["01.01.1"] },
      { code: "U02", facility: "SOLAR_POWER", label: "15 MW PV array", startSprint: 2, endSprint: 2, lines: ["02.01.1"] },
      { code: "U03", facility: "SOLAR_POWER", label: "33/11 kV step-up transformer", startSprint: 2, endSprint: 2, lines: ["02.02.1"] },
    ]
  );
  for (const id of [lkk, abj]) if (id) await seedActualDates(id);
  // Badges from sprints (the schedule-variance job keeps them current).
  for (const code of ["LKK-402", "ABJ-108", "PRG-102", "PRG-105"]) {
    const p = await prisma.project.findFirst({ where: { codePrefix: code }, select: { id: true } });
    if (p) await refreshScheduleBadge(p.id);
  }
  console.log("   R2: facility catalogue for every tenant; sprints and facility units on PRG-102, PRG-105, LKK-402 and ABJ-108");
}
