import { Prisma } from "@prisma/client";
import {
  addDays,
  allChecklistItems,
  ChecklistItem,
  ChecklistSectionsInput,
  InspectionAnswerInput,
  ProjectTypeConfig,
  ProjectTypeConfigSchema,
  ProjectTypeSnapshot,
  SaveChecklistTemplateRequestSchema,
  zonedCalendarDate,
} from "@insite/shared";
import { prisma } from "../config/prisma";
import { WebJwtPayload } from "../middleware/auth.middleware";
import { parseSections } from "../modules/inspections/checklistTemplates.service";
import { reviewSiteInspection, submitSiteInspection } from "../modules/inspections/inspections.service";
import { setInspectionCheckScheduler } from "../modules/workday-reports/aiOmissionCheck";
import { createInspectionObligation, createStreamsFromProjectType, STREAM_SELECT, streamCadenceRow } from "../modules/cadence/streams.service";
import { CADENCE_PROJECT_SELECT, cadenceSettingsForDate, periodKeyForDate } from "../modules/cadence/cadence.service";
import { PROGRAMME_TENANT_SLUG } from "./seedPhase11";

/**
 * Phase 14 seed: checklist templates (both tenants), reporting streams on the programme's project
 * types and projects, an M&E officer who supervises more sites than the Co-Funded limit, and
 * inspections on PRG-211: an approved baseline survey, a late routine visit and a routine visit
 * with a major finding aimed at the contractor. PRG-221 has a missed quarterly M&E visit.
 *
 * Dates are relative to the seed day. Inspections go through the real service (web submissions,
 * so they carry no photos; the omission check flags the photo items when the server sweeps).
 */

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const yesNo = (key: string, label: string, extra: Partial<ChecklistItem> = {}) => ({ key, label, responseType: "YES_NO" as const, ...extra });
const rating = (key: string, label: string, extra: Partial<ChecklistItem> = {}) => ({
  key,
  label,
  responseType: "RATING_1_5" as const,
  photoRequiredOnFail: true,
  ...extra,
});
const pfn = (key: string, label: string, extra: Partial<ChecklistItem> = {}) => ({ key, label, responseType: "PASS_FAIL_NA" as const, ...extra });

const BASELINE: ChecklistSectionsInput = [
  {
    key: "site-conditions",
    title: "Site conditions",
    items: [
      { key: "site-photo", label: "General site photographs (all four sides)", responseType: "PHOTO_ONLY" },
      { key: "topography", label: "Topography and drainage", responseType: "TEXT" },
      yesNo("site-clear", "Site clear of encumbrances"),
    ],
  },
  {
    key: "existing-facilities",
    title: "Existing facilities",
    items: [
      { key: "existing-classrooms", label: "Existing classrooms in use", responseType: "NUMBER", unit: "rooms" },
      rating("existing-condition", "Condition of existing buildings", { photoRequired: true }),
    ],
  },
  {
    key: "access",
    title: "Access",
    items: [yesNo("road-access", "All-weather road access for delivery trucks"), { key: "access-notes", label: "Access notes", responseType: "TEXT", required: false }],
  },
  {
    key: "utilities",
    title: "Utilities",
    items: [yesNo("water-source", "Water source on or near site"), yesNo("grid-power", "Grid power available")],
  },
  {
    key: "contractor-readiness",
    title: "Contractor readiness",
    items: [rating("readiness", "Contractor readiness to mobilise"), yesNo("site-handed-over", "Site formally handed over to the contractor")],
  },
];

const ROUTINE: ChecklistSectionsInput = [
  {
    key: "progress",
    title: "Progress against the work programme",
    items: [
      rating("on-programme", "Works on programme"),
      { key: "percent-complete", label: "Estimated overall completion", responseType: "NUMBER", unit: "%" },
      { key: "progress-photo", label: "Progress photographs", responseType: "PHOTO_ONLY" },
    ],
  },
  {
    key: "workmanship",
    title: "Quality of workmanship",
    items: [rating("blockwork", "Blockwork and plaster"), rating("concrete", "Concrete and reinforcement")],
  },
  {
    key: "materials",
    title: "Material standards",
    items: [pfn("materials-spec", "Materials on site match the specification", { photoRequiredOnFail: true }), yesNo("test-certs", "Test certificates available")],
  },
  {
    key: "hse",
    title: "Health and safety",
    items: [yesNo("ppe", "Workers wear PPE", { photoRequiredOnFail: true }), yesNo("first-aid", "First aid kit on site"), yesNo("signage", "Safety signage displayed")],
  },
  {
    key: "valuation",
    title: "Valuation of works done",
    items: [pfn("valuation-agrees", "Work done agrees with the latest valuation"), { key: "valuation-notes", label: "Valuation notes", responseType: "TEXT", required: false }],
  },
  {
    key: "environment",
    title: "Environmental safeguards",
    items: [yesNo("waste", "Construction waste managed"), yesNo("erosion", "Erosion and run-off controlled")],
  },
];

const MOBILISATION: ChecklistSectionsInput = [
  { key: "personnel", title: "Personnel", items: [yesNo("key-staff", "Key staff named in the bid are on site"), { key: "workers", label: "Workers on site", responseType: "NUMBER" }] },
  { key: "equipment", title: "Equipment", items: [yesNo("equipment", "Listed equipment on site", { photoRequired: true })] },
  { key: "materials", title: "Materials", items: [yesNo("first-materials", "First materials delivered")] },
  { key: "site-setup", title: "Site set-up", items: [yesNo("hoarding", "Hoarding and site office set up", { photoRequired: true }), yesNo("signage", "Project signboard erected")] },
  { key: "introduction", title: "Letter of introduction", items: [yesNo("letter-presented", "Letter of introduction presented to the school")] },
];

const FINAL: ChecklistSectionsInput = [
  {
    key: "deliverables",
    title: "Deliverables against the specification",
    items: [pfn("classrooms-delivered", "Classrooms delivered as specified", { photoRequired: true }), pfn("furniture", "Furniture supplied")],
  },
  { key: "quality", title: "Quality", items: [rating("finishes", "Finishes"), rating("roofing", "Roofing and rainwater goods")] },
  {
    key: "wash-solar",
    title: "WASH and solar components",
    items: [pfn("wash-functional", "Toilets and hand-washing functional", { photoRequired: true }), pfn("solar-functional", "Solar system functional", { photoRequired: true })],
  },
  { key: "snags", title: "Snags", items: [{ key: "snag-list", label: "Outstanding snags", responseType: "TEXT", required: false }] },
];

const TEMPLATES = [
  { code: "BASELINE_SURVEY", name: "Baseline survey", visitTypes: ["BASELINE" as const], sections: BASELINE },
  { code: "ROUTINE_VISIT", name: "Routine monitoring visit", visitTypes: ["ROUTINE" as const], sections: ROUTINE },
  { code: "MOBILISATION_CHECK", name: "Mobilisation check", visitTypes: ["MOBILISATION_CHECK" as const], sections: MOBILISATION },
  { code: "FINAL_EVALUATION", name: "Final evaluation", visitTypes: ["FINAL_EVALUATION" as const], sections: FINAL },
];

async function payloadFor(email: string): Promise<WebJwtPayload> {
  const u = await prisma.user.findUniqueOrThrow({
    where: { email },
    include: { role: { include: { rolePermissions: { include: { permission: { select: { key: true } } } } } } },
  });
  return {
    tokenType: "WEB_USER",
    userId: u.id,
    email: u.email,
    fullName: u.fullName,
    tenantId: u.tenantId,
    isPlatformSuperAdmin: false,
    roleId: u.roleId,
    roleCode: u.role.code,
    roleName: u.role.name,
    permissions: u.role.rolePermissions.map((rp) => rp.permission.key),
    organizationId: u.organizationId,
    mustChangePassword: false,
  };
}

/** Passing answers for every item, with overrides (value and comment) for some. */
function answersFor(sections: ReturnType<typeof parseSections>, overrides: Record<string, { value: string | number; comment: string }> = {}): InspectionAnswerInput[] {
  const pass = (item: ChecklistItem): string | number | null => {
    switch (item.responseType) {
      case "RATING_1_5":
        return 4;
      case "PASS_FAIL_NA":
        return "PASS";
      case "YES_NO":
        return "YES";
      case "NUMBER":
        return item.unit === "%" ? 40 : 6;
      case "TEXT":
        return "Recorded on site.";
      default:
        return null;
    }
  };
  return allChecklistItems(sections).map((item) => {
    const o = overrides[item.key];
    return { itemKey: item.key, value: o ? o.value : pass(item), comment: o?.comment ?? null, clientCaptureIds: [] };
  });
}

export async function seedPhase14(): Promise<void> {
  const programme = await prisma.tenant.findUniqueOrThrow({ where: { slug: PROGRAMME_TENANT_SLUG } });
  const admin = await payloadFor("programme.admin@insite.ng");
  const defaultAdmin = await payloadFor("admin@insite.ng");

  // Templates in both tenants (written directly: authoring moved to the form library in R3e).
  for (const actor of [admin, defaultAdmin]) {
    for (const t of TEMPLATES) {
      const parsed = SaveChecklistTemplateRequestSchema.parse(t);
      await prisma.inspectionChecklistTemplate.create({
        data: {
          tenantId: actor.tenantId,
          code: parsed.code,
          name: parsed.name,
          visitTypes: parsed.visitTypes,
          version: 1,
          sectionsJson: parsed.sections as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }

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

  // Streams, inspections and supervision on both project types. Seed only: written into the
  // types' config (and the projects' snapshots) without a version bump, as if the types had been
  // created with them; editing a type through the service bumps its version.
  const streams: ProjectTypeConfig["reportingStreams"] = ProjectTypeConfigSchema.parse({
    reportingStreams: [
      { key: "resident-supervision", label: "Resident supervision", kind: "ITEM_REPORTS", roleCodes: ["INDEPENDENT_RESIDENT"], reportingCadence: "WEEKLY" },
      {
        key: "me-visit",
        label: "M&E visit",
        kind: "INSPECTION",
        roleCodes: ["MONITOR", "MONITOR_INSPECTOR"],
        reportingCadence: "QUARTERLY",
        visitType: "ROUTINE",
        submissionDeadlineDays: 7,
      },
      { key: "resident-progress", label: "Resident supervisor progress", kind: "ITEM_REPORTS", roleCodes: ["INDEPENDENT_RESIDENT"], reportingCadence: "WEEKLY" },
    ],
  }).reportingStreams;
  const inspections = {
    templateCodeByVisitType: { BASELINE: "BASELINE_SURVEY", ROUTINE: "ROUTINE_VISIT", MOBILISATION_CHECK: "MOBILISATION_CHECK", FINAL_EVALUATION: "FINAL_EVALUATION" },
  };
  const supervisorRoleCodes = ["MONITOR", "MONITOR_INSPECTOR", "INDEPENDENT_RESIDENT"];
  const types = await prisma.projectType.findMany({ where: { tenantId: programme.id } });
  const configs = new Map<string, ProjectTypeConfig>();
  for (const type of types) {
    const config = ProjectTypeConfigSchema.parse({
      ...ProjectTypeConfigSchema.parse(type.configJson),
      reportingStreams: streams,
      inspections,
      // Co-Funded: a low site limit so the seeded M&E officer (three live sites) is over it.
      supervision:
        type.code === "CO_FUNDED"
          ? { supervisorRoleCodes, maxSitesPerSupervisor: 2, maxSpreadKm: 50 }
          : { supervisorRoleCodes, maxSitesPerSupervisor: 10, maxSpreadKm: 50 },
    });
    await prisma.projectType.update({ where: { id: type.id }, data: { configJson: config as unknown as Prisma.InputJsonValue } });
    configs.set(type.id, config);
  }

  // The seeded projects were created before the types had streams: give their snapshots the same
  // config (same version) and create their streams, as applying the type now would.
  const projects = await prisma.project.findMany({
    where: { tenantId: programme.id },
    select: { id: true, projectTypeId: true, projectTypeSnapshotJson: true },
  });
  for (const p of projects) {
    const config = p.projectTypeId ? configs.get(p.projectTypeId) : null;
    if (!config || !p.projectTypeSnapshotJson) continue;
    const snapshot = { ...(p.projectTypeSnapshotJson as unknown as ProjectTypeSnapshot), config };
    await prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id: p.id }, data: { projectTypeSnapshotJson: snapshot as unknown as Prisma.InputJsonValue } });
      await createStreamsFromProjectType(tx, { projectId: p.id, tenantId: programme.id, streams: config.reportingStreams });
    });
  }

  const byCode = new Map(liveProjects.map((p) => [p.codePrefix, p.id]));
  const officerPayload = await payloadFor("me.officer@insite.ng");
  const now = new Date();
  const today = zonedCalendarDate(now, "Africa/Lagos");

  /** Creates the M&E visit obligation of the quarter that contains `date`. */
  async function meObligation(projectId: string, date: string) {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: CADENCE_PROJECT_SELECT });
    const stream = await prisma.projectReportingStream.findFirstOrThrow({ where: { projectId, key: "me-visit" }, select: STREAM_SELECT });
    const key = periodKeyForDate(cadenceSettingsForDate(streamCadenceRow(project, stream), date), date);
    await createInspectionObligation(stream, key);
    return key;
  }

  // Inspections are web submissions here; their omission check runs later in the server sweep.
  setInspectionCheckScheduler(() => undefined);
  try {
    const prg211 = byCode.get("PRG-211")!;
    const template = async (code: string) => {
      const t = await prisma.inspectionChecklistTemplate.findFirstOrThrow({ where: { tenantId: programme.id, code }, orderBy: { version: "desc" } });
      return { id: t.id, version: t.version, sections: parseSections(t.sectionsJson) };
    };
    const baselineT = await template("BASELINE_SURVEY");
    const routineT = await template("ROUTINE_VISIT");
    const submit = async (p: {
      clientReportId: string;
      visitType: "BASELINE" | "ROUTINE";
      t: { id: string; version: number; sections: ReturnType<typeof parseSections> };
      visitDate: string;
      overrides?: Record<string, { value: string | number; comment: string }>;
      overallFinding: "SATISFACTORY" | "MINOR_ISSUES" | "MAJOR_ISSUES";
      summaryText: string;
    }) =>
      submitSiteInspection({
        projectId: prg211,
        principal: { webUser: officerPayload },
        input: {
          clientReportId: p.clientReportId,
          visitType: p.visitType,
          templateId: p.t.id,
          templateVersion: p.t.version,
          visitDate: p.visitDate,
          answers: answersFor(p.t.sections, p.overrides).map((a) => ({ ...a, clientCaptureIds: a.clientCaptureIds ?? [] })),
          overallFinding: p.overallFinding,
          summaryText: p.summaryText,
          submissionGeotag: null,
          confirmedAt: now.toISOString(),
        },
      });

    // Baseline survey 120 days ago, approved by the programme administrator.
    const baseline = await submit({
      clientReportId: "14000000-0000-4000-8000-000000000001",
      visitType: "BASELINE",
      t: baselineT,
      visitDate: addDays(today, -120),
      overallFinding: "SATISFACTORY",
      summaryText: "Baseline survey: site clear, two existing classrooms in fair condition, water from a borehole 300 m away.",
    });
    for (let i = 0; i < 4 && baseline.inspection.status === "PENDING_APPROVAL"; i++) {
      const r = await reviewSiteInspection({ projectId: prg211, inspectionId: baseline.inspection.id, webUser: admin, input: { decision: "APPROVE", notes: null } }).catch(() => null);
      if (!r || r.status !== "PENDING_APPROVAL") break;
    }

    // A routine visit 40 days ago, uploaded today: late (7-day deadline).
    await meObligation(prg211, addDays(today, -40));
    await submit({
      clientReportId: "14000000-0000-4000-8000-000000000002",
      visitType: "ROUTINE",
      t: routineT,
      visitDate: addDays(today, -40),
      overrides: { "on-programme": { value: 3, comment: "Slightly behind on the roof" } },
      overallFinding: "MINOR_ISSUES",
      summaryText: "Routine M&E visit: blockwork complete to lintel level; roofing materials not yet on site.",
    });

    // A routine visit two days ago with a major finding (PPE), raised to the contractor.
    await meObligation(prg211, addDays(today, -2));
    await submit({
      clientReportId: "14000000-0000-4000-8000-000000000003",
      visitType: "ROUTINE",
      t: routineT,
      visitDate: addDays(today, -2),
      overrides: {
        ppe: { value: "NO", comment: "Six workers on the roof without harnesses or helmets" },
        "materials-spec": { value: "FAIL", comment: "Roofing sheets are 0.35 mm, the specification says 0.45 mm" },
      },
      overallFinding: "MAJOR_ISSUES",
      summaryText: "Routine M&E visit: roof framing in progress. Unsafe work at height and under-gauge roofing sheets.",
    });

    // PRG-221: last quarter's M&E visit never happened (missed and flagged).
    const prg221 = byCode.get("PRG-221");
    if (prg221) {
      const lastQuarter = addDays((await meObligation(prg221, today)).periodStart, -1);
      const missed = await meObligation(prg221, lastQuarter);
      await prisma.reportingObligation.updateMany({
        where: { projectId: prg221, boqItemId: null, periodStart: missed.periodStart },
        data: { status: "MISSED", alertedAt: now },
      });
    }
  } finally {
    setInspectionCheckScheduler(null);
  }
}
