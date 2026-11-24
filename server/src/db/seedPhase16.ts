import { Prisma } from "@prisma/client";
import { addDays, ProjectTypeConfigSchema, ProjectTypeKpiTargetsSchema, RadialGeofence, zonedCalendarDate } from "@insite/shared";
import { prisma } from "../config/prisma";
import { WebJwtPayload } from "../middleware/auth.middleware";
import { createProjectDraft, saveProjectSetupStep, archiveProject } from "../modules/projects/projectSetup.service";
import { recomputeMilestoneDates, completeMilestone } from "../modules/contracts/milestones.service";
import { saveKickoffMeeting } from "../modules/contracts/kickoff.service";
import { recordPayment } from "../modules/payments/payments.service";
import { changeProjectPhase } from "../modules/closeout/projectPhase.service";
import { createTicketsFromSnags } from "../modules/closeout/defects.service";
import { draftCompletionCertificate, recordBeneficiarySignature, signCompletionCertificate } from "../modules/completion/completion.service";
import { completeClosureItem } from "../modules/completion/closure.service";
import { rateContractor, tenantRatingCriteria } from "../modules/completion/ratings.service";
import { createLesson, publishLesson } from "../modules/completion/lessons.service";
import { requestClosurePack, runClosurePackExport, setClosurePackScheduler } from "../modules/completion/closurePack.service";
import { snapshotTenantKpis } from "../modules/kpis/kpis.service";
import { PROGRAMME_TENANT_SLUG } from "./seedPhase11";
import { fileDocument, heldKickoff, payloadFor } from "./seedPhase13";
import { acceptedHandover, approvedFinalEvaluation, paperCopy } from "./seedPhase15";

/**
 * Phase 16 seed: the end-to-end demo programme. Runs after every other seed and adds what the
 * demo script needs so the programme tenant has a project at every stage of both delivery models:
 *
 * | Stage                                           | Project                     |
 * | ----------------------------------------------- | --------------------------- |
 * | Draft with kick-off planned                     | PRG-101 (Central, North)    |
 * | Mobilising on time                              | PRG-102 (Central, North)    |
 * | Mobilisation overdue with a default case        | PRG-221 (Co-Funded, South)  |
 * | Active: weekly supervision, late visit, finding | PRG-211 (Co-Funded, North)  |
 * | Interim payment recorded, works ~80% done      | PRG-105 (Central, North)    | new
 * | CoC pending a signature, handover to record     | PRG-104 (Central, South)    | new
 * | In retention with a defect                      | PRG-103 (Central, North)    | defect added
 * | Closed, post-closure evaluation pending         | PRG-241 (Co-Funded, South)  |
 * | Closed and archived with a closure pack         | PRG-242 (Co-Funded, South)  | new
 *
 * Also: KPI targets on both project types (written without a version bump, as Phases 13–15 do),
 * demo logins for every persona (a provisioned Resident Supervisor is added; R1d: contractors have no
 * login), PRG-104's beneficiary handover response left for the demo to record (no public link), and
 * KPI snapshots for the current and five earlier months.
 * Everything goes through the real services; the only shortcuts are dates of seeded history
 * (milestones done earlier). Redesign R1b: payments are made outside the platform and recorded.
 */

const CENTRAL_TARGETS = ProjectTypeKpiTargetsSchema.parse({
  contractors_mobilised_on_time: { target: 90 },
  reports_on_time: { target: 85 },
  visits_conducted: { target: 90 },
  financial_utilisation: { target: null },
});
const CO_FUNDED_TARGETS = ProjectTypeKpiTargetsSchema.parse({
  contractors_mobilised_on_time: { target: 85 },
  reports_on_time: { target: 80 },
  visits_conducted: { target: 85 },
  approval_turnaround_days: { target: 7 },
  financial_utilisation: { target: null },
});

const geofence = (label: string, latitude: number, longitude: number): RadialGeofence => ({
  mode: "RADIAL",
  siteLabel: label,
  center: { latitude, longitude },
  radiusMeters: 200,
});

export async function seedPhase16() {
  const programme = await prisma.tenant.findUniqueOrThrow({ where: { slug: PROGRAMME_TENANT_SLUG } });
  const today = zonedCalendarDate(new Date(), "Africa/Lagos");
  const daysAgo = (n: number) => new Date(`${addDays(today, -n)}T10:00:00.000Z`);

  // ---- KPI targets on the project types (no version bump, seed only) --------------------------
  for (const type of await prisma.projectType.findMany({ where: { tenantId: programme.id } })) {
    const config = ProjectTypeConfigSchema.parse({
      ...ProjectTypeConfigSchema.parse(type.configJson),
      kpiTargets: type.code === "CO_FUNDED" ? CO_FUNDED_TARGETS : CENTRAL_TARGETS,
    });
    await prisma.projectType.update({ where: { id: type.id }, data: { configJson: config as unknown as Prisma.InputJsonValue } });
  }

  const admin = await payloadFor("programme.admin@insite.ng");
  const flagshipAdmin = await payloadFor("flagship.admin@insite.ng");
  const monitor = await payloadFor("programme.monitor@insite.ng");
  const funder = await payloadFor("programme.funder@insite.ng");
  const southAdmin = await payloadFor("south.admin@insite.ng");
  const southMe = await payloadFor("south.me@insite.ng");

  const types = new Map((await prisma.projectType.findMany({ where: { tenantId: programme.id } })).map((t) => [t.code, t]));
  const org = (name: string) => prisma.organization.findFirstOrThrow({ where: { tenantId: programme.id, name } });
  const flagship = await org("Programme Authority");
  const south = await prisma.organization.findFirstOrThrow({ where: { tenantId: programme.id, name: { endsWith: "South" } } });
  const monitorOrg = await org("Programme Monitoring Consultants");
  const contractorOrg = await org("Sahel Build & Civil Works Ltd");
  const region = (code: string) => prisma.region.findFirstOrThrow({ where: { tenantId: programme.id, code } });
  const kano = await region("N-KAN");
  const lagos = await region("S-LAG");
  const byCode = async (code: string) => prisma.project.findFirstOrThrow({ where: { tenantId: programme.id, codePrefix: code } });

  // ---- Demo persona: a provisioned Resident Supervisor (mobile) --------------------------------
  const roleOf = (code: string) => prisma.role.findFirstOrThrow({ where: { tenantId: programme.id, code } });
  const residentRole = await roleOf("INDEPENDENT_RESIDENT");
  const resident = await prisma.user.create({
    data: {
      tenantId: programme.id,
      email: "resident.supervisor@insite.ng",
      passwordHash: (await prisma.user.findUniqueOrThrow({ where: { email: admin.email } })).passwordHash,
      fullName: "Musa Danladi (Resident Supervisor)",
      roleId: (await roleOf("MONITOR")).id,
      mobileRoleId: residentRole.id,
      organizationId: monitorOrg.id,
      phoneNumber: "+234 803 555 0161",
    },
  });
  // ---- New projects through the real setup services --------------------------------------------
  async function liveProject(spec: {
    code: string;
    name: string;
    type: "CENTRAL" | "CO_FUNDED";
    regionId: string;
    ownerId: string | null;
    beneficiary: string;
    budget: number;
    site: { lat: number; lng: number; label: string };
    state: string;
  }) {
    const draft = await createProjectDraft(admin, {
      name: spec.name,
      codePrefix: spec.code,
      stateLocation: spec.state,
      lgaLocation: null,
      description: null,
      totalBudgetNgn: spec.budget,
      projectTypeId: types.get(spec.type)!.id,
      regionId: spec.regionId,
    });
    await saveProjectSetupStep(draft.projectId, "parties", admin, {
      ...(spec.ownerId ? { owningOrganizationId: spec.ownerId } : {}),
      monitorOrganization: { id: monitorOrg.id },
      contractors: [{ organization: { id: contractorOrg.id }, tradeCategory: "Civil works", tradeCode: "CIV" }],
      beneficiaries: [
        {
          name: spec.beneficiary,
          beneficiaryType: "SCHOOL",
          contactName: "Head teacher",
          contactEmail: `headteacher.${spec.code.toLowerCase()}@example.org`,
          isPrimary: true,
        },
      ],
    });
    const live = await prisma.project.update({
      where: { id: draft.projectId },
      data: {
        status: "ACTIVE",
        activatedAt: daysAgo(200),
        activatedByUserId: admin.userId,
        geofenceMode: "RADIAL",
        geofenceGeoJson: geofence(spec.site.label, spec.site.lat, spec.site.lng) as unknown as Prisma.InputJsonValue,
      },
    });
    for (const userId of [monitor.userId, resident.id, funder.userId]) {
      await prisma.userProjectAssignment.create({ data: { userId, projectId: live.id } });
    }
    return live;
  }

  /** Contract dates in the past and every earlier milestone done on (or just before) its due date. */
  async function pastContract(projectId: string, ref: string, kickoffDaysAgo: number, invitees: WebJwtPayload[]) {
    const kickoff = addDays(today, -kickoffDaysAgo);
    await prisma.project.update({
      where: { id: projectId },
      data: {
        contractReference: ref,
        contractAwardDate: addDays(kickoff, -20),
        contractSignedDate: addDays(kickoff, -12),
        kickoffDate: kickoff,
      },
    });
    const contractor = await prisma.projectContractor.findFirstOrThrow({ where: { projectId }, include: { organization: true } });
    const minutes = await fileDocument({
      tenantId: programme.id,
      projectId,
      typeCode: "KICKOFF_MINUTES",
      title: "Kick-off meeting minutes",
      uploadedByUserId: invitees[0].userId,
      createdAt: new Date(`${addDays(kickoff, 2)}T10:00:00.000Z`),
    });
    await heldKickoff({
      projectId,
      date: kickoff,
      minutesDocumentId: minutes.id,
      invitees: [
        ...invitees.map((u, i) => ({ group: i === 0 ? "OWNER" : "MONITOR", name: u.fullName, email: u.email, userId: u.userId, organizationId: u.organizationId })),
        { group: "CONTRACTOR", name: contractor.organization.name, email: null, organizationId: contractor.organizationId },
        { group: "BENEFICIARY", name: "Head teacher", email: null },
      ],
    });
    const open = await prisma.projectContractMilestone.findMany({
      where: { projectId, status: { in: ["PENDING", "DUE", "OVERDUE"] }, anchor: { notIn: ["COC_ISSUED", "PROJECT_CLOSED"] } },
    });
    // The documents those milestones needed are on file, dated just before each was done.
    const filed = new Set(["KICKOFF_MINUTES"]);
    for (const m of open) {
      const done = m.dueDate ? addDays(m.dueDate, -1) : kickoff;
      for (const code of m.requiredDocumentTypeCodes.filter((c) => !filed.has(c))) {
        filed.add(code);
        await fileDocument({
          tenantId: programme.id,
          projectId,
          typeCode: code,
          title: (await prisma.documentType.findUniqueOrThrow({ where: { tenantId_code: { tenantId: programme.id, code } } })).name,
          uploadedByUserId: invitees[0].userId,
          projectContractorId: m.projectContractorId,
          createdAt: new Date(`${addDays(done, -1)}T10:00:00.000Z`),
        });
      }
      await prisma.projectContractMilestone.update({
        where: { id: m.id },
        data: { status: "DONE", completedAt: new Date(`${done}T10:00:00.000Z`), completedNotes: "Done (seeded history)." },
      });
    }
    // An approved baseline survey shortly after mobilisation.
    await approvedFinalEvaluation({
      tenantId: programme.id,
      projectId,
      reporter: invitees[invitees.length - 1],
      visitDate: addDays(kickoff, 24),
      visitKind: "BASELINE",
      summary: "Baseline visit: site cleared and set out; existing structures and access recorded with photographs.",
    });
    return contractor;
  }

  // Planned end dates for the two Phase 15 projects (both finished on time).
  await prisma.project.update({ where: { id: (await byCode("PRG-103")).id }, data: { plannedEndDate: addDays(today, 8) } });
  await prisma.project.update({ where: { id: (await byCode("PRG-241")).id }, data: { plannedEndDate: addDays(today, -3) } });

  // ---- PRG-101 (draft, Central): kick-off planned in nine days ----------------------------------
  const prg101 = await byCode("PRG-101");
  await prisma.project.update({
    where: { id: prg101.id },
    data: {
      contractReference: "PA/CEN/2026/101",
      contractAwardDate: addDays(today, -12),
      contractSignedDate: addDays(today, -6),
      kickoffDate: addDays(today, 9),
    },
  });
  await prisma.$transaction((tx) => recomputeMilestoneDates(tx, prg101.id));
  const agenda = await fileDocument({
    tenantId: programme.id,
    projectId: prg101.id,
    typeCode: "KICKOFF_BRIEFING_PACK",
    title: "Kick-off agenda and briefing pack",
    uploadedByUserId: admin.userId,
    createdAt: daysAgo(2),
  });
  const contractor101 = await prisma.projectContractor.findFirstOrThrow({ where: { projectId: prg101.id } });
  await saveKickoffMeeting(prg101.id, admin, {
    scheduledAt: `${addDays(today, 9)}T09:00:00.000Z`,
    location: "Kano Model Primary School, assembly hall",
    agendaDocumentId: agenda.id,
    invitees: [
      { stakeholderGroup: "OWNER", name: flagshipAdmin.fullName, email: flagshipAdmin.email, userId: flagshipAdmin.userId, organizationId: flagship.id },
      { stakeholderGroup: "MONITOR", name: monitor.fullName, email: monitor.email, userId: monitor.userId, organizationId: monitorOrg.id },
      { stakeholderGroup: "CONTRACTOR", name: "Sahel Build & Civil Works Ltd", email: "projects@sahelbuild.example", organizationId: contractor101.organizationId },
      { stakeholderGroup: "BENEFICIARY", name: "Head teacher, Kano Model Primary School", email: "headteacher.prg-101@example.org" },
    ],
  });

  // ---- PRG-103 (Central): the handover snags become defect tickets -------------------------------
  const prg103 = await byCode("PRG-103");
  const snagged = await prisma.handoverSubmission.findFirstOrThrow({ where: { projectId: prg103.id }, orderBy: { submittedAt: "desc" } });
  await createTicketsFromSnags(prg103.id, snagged.id, monitor, { severity: "MEDIUM", dueDate: addDays(today, 14) });

  // ---- PRG-105 (Central, North): bills 1 and 2 done, one interim payment recorded ------------------
  const prg105 = await liveProject({
    code: "PRG-105",
    name: "Central — Kano Day Secondary School",
    type: "CENTRAL",
    regionId: kano.id,
    ownerId: null,
    beneficiary: "Kano Day Secondary School",
    budget: 210_000_000,
    site: { lat: 12.0471, lng: 8.5233, label: "Day Secondary School, Kano" },
    state: "Kano State",
  });
  await pastContract(prg105.id, "PA/CEN/2026/105", 120, [flagshipAdmin, monitor]);
  for (const [n, name, share, items] of [
    [1, "Substructure", 0.3, [["01.01", "Excavation and foundations", "m3", 380], ["01.02", "Ground floor slab", "m2", 1100]]],
    [2, "Superstructure", 0.4, [["02.01", "Columns, beams and block walls", "m2", 2400], ["02.02", "Roof structure and roofing", "m2", 1250]]],
    [3, "Finishes and WASH", 0.3, [["03.01", "Plastering, painting and fittings", "m2", 4800], ["03.02", "Toilet block and borehole", "item", 1]]],
  ] as const) {
    const allocated = Math.round(210_000_000 * share * 100) / 100;
    for (const [wbsCode, description, unit, qty] of items) {
      const budget = Math.round((allocated / items.length) * 100) / 100;
      await prisma.boqItem.create({
        data: {
          projectId: prg105.id,
          wbsCode,
          section: name.toUpperCase(),
          description,
          unit,
          totalQuantity: qty,
          rateNgn: Math.round((budget / qty) * 100) / 100,
          budgetedCostNgn: budget,
          // Bills 1 and 2 were measured complete on earlier monitoring visits.
          cumulativeCertifiedPct: n < 3 ? 100 : 35,
        },
      });
    }
  }
  await prisma.project.update({ where: { id: prg105.id }, data: { certifiedProgressPct: 80.5 } });
  // Redesign R2d: PRG-105's sprints and facility units (and its schedule badge) come from seedR2.
  // One interim payment recorded by the funding authority (made outside the platform); retention
  // is held at the project's percentage.
  await recordPayment(prg105.id, funder, {
    kind: "INTERIM",
    paidOn: zonedCalendarDate(daysAgo(12), "Africa/Lagos"),
    grossAmountNgn: 63_000_000,
    reference: "PA/PV/2026/0105-01",
    description: "Substructure",
  });

  // ---- PRG-104 (Central, South): Certificate of Completion waiting for a signature --------------
  const prg104 = await liveProject({
    code: "PRG-104",
    name: "Central — Lagos Island Model College",
    type: "CENTRAL",
    regionId: lagos.id,
    ownerId: null,
    beneficiary: "Lagos Island Model College",
    budget: 165_000_000,
    site: { lat: 6.4549, lng: 3.3941, label: "Model College, Lagos Island" },
    state: "Lagos State",
  });
  await pastContract(prg104.id, "PA/CEN/2025/104", 240, [flagshipAdmin, monitor]);
  await prisma.project.update({ where: { id: prg104.id }, data: { plannedEndDate: addDays(today, 5), retentionPercentage: 5, retentionDurationMonths: 12 } });
  await approvedFinalEvaluation({ tenantId: programme.id, projectId: prg104.id, reporter: monitor, visitDate: addDays(today, -2) });
  await changeProjectPhase({ projectId: prg104.id, webUser: admin, input: { to: "HANDOVER_IN_PROGRESS" } });
  await draftCompletionCertificate(prg104.id, admin, { completionDate: addDays(today, -1) });
  await signCompletionCertificate(prg104.id, admin, { slotKey: "head-physical-planning" });
  // The beneficiary's handover response is left for the demo to record (R1d: no public link).

  // ---- PRG-242 (Co-Funded, South): closed, evaluated, audited, archived, closure pack built ------
  const prg242 = await liveProject({
    code: "PRG-242",
    name: "Co-Funded — Yaba Junior Secondary School",
    type: "CO_FUNDED",
    regionId: lagos.id,
    ownerId: south.id,
    beneficiary: "Yaba Junior Secondary School",
    budget: 72_000_000,
    site: { lat: 6.5095, lng: 3.3711, label: "Junior Secondary School, Yaba" },
    state: "Lagos State",
  });
  const contractor242 = await pastContract(prg242.id, "RDE-S/CF/2025/242", 320, [southAdmin, monitor]);
  // Completed six weeks late against the planned end (the KPI shows it as not on time).
  await prisma.project.update({ where: { id: prg242.id }, data: { plannedEndDate: addDays(today, -60), retentionPercentage: 5, retentionDurationMonths: 6 } });
  await approvedFinalEvaluation({ tenantId: programme.id, projectId: prg242.id, reporter: monitor, visitDate: addDays(today, -19) });
  await changeProjectPhase({ projectId: prg242.id, webUser: admin, input: { to: "HANDOVER_IN_PROGRESS" } });
  await draftCompletionCertificate(prg242.id, southAdmin, { completionDate: addDays(today, -18) });
  await signCompletionCertificate(prg242.id, southAdmin, { slotKey: "head-physical-planning" });
  await signCompletionCertificate(prg242.id, southMe, { slotKey: "head-me" });
  await recordBeneficiarySignature(prg242.id, southAdmin, {
    slotKey: "beneficiary",
    beneficiaryName: "Mr Tunde Bakare (Principal)",
    beneficiaryRole: "Head of institution",
    objectKey: await paperCopy(programme.id, prg242.id, "Mr Tunde Bakare"),
    attest: true,
  });
  await acceptedHandover({ projectId: prg242.id, createdByUserId: southAdmin.userId, reviewer: monitor, headName: "Mr Tunde Bakare", snags: 0 });
  await changeProjectPhase({ projectId: prg242.id, webUser: admin, input: { to: "RETENTION_PERIOD" } });
  const criteria = await tenantRatingCriteria(prisma, programme.id);
  for (const [rater, scores, comments] of [
    [monitor, [3, 4, 4, 3, 4], "Good quality; six weeks late after the rainy-season stoppage."],
    [southAdmin, [3, 3, 4, 4, 3], "Late, but cooperative and quick on snags."],
  ] as const) {
    await rateContractor(prg242.id, rater, {
      projectContractorId: contractor242.id,
      stage: "COMPLETION",
      criteria: criteria.map((c, i) => ({ key: c.key, score: scores[i] ?? 4 })),
      comments,
    });
  }
  const lesson = await createLesson(prg242.id, southAdmin, {
    category: "SITE_DELIVERY",
    title: "Plan the rainy-season stoppage into the programme of works",
    description: "Roofing stopped for five weeks in the rains; the programme of works assumed continuous work and the project finished six weeks late.",
    recommendation: "Ask contractors to show weather float on roofing and external works when the programme of works is reviewed.",
    stage: "CONSTRUCTION",
    tags: ["schedule", "weather", "programme-of-works"],
    sharedWithContractor: true,
  });
  await publishLesson(prg242.id, lesson.id, southAdmin);
  await completeClosureItem(prg242.id, "BEFORE_CLOSE", "as-built", southAdmin, "As-built drawings and O&M manuals received by the school.");
  await changeProjectPhase({ projectId: prg242.id, webUser: admin, input: { to: "COMPLETED_CLOSED" } });
  await fileDocument({
    tenantId: programme.id,
    projectId: prg242.id,
    typeCode: "FINAL_EVALUATION_REPORT",
    title: "Post-closure evaluation report",
    uploadedByUserId: monitor.userId,
    createdAt: new Date(),
  });
  const evaluation = await prisma.projectContractMilestone.findFirstOrThrow({ where: { projectId: prg242.id, key: "post-closure-evaluation" } });
  await completeMilestone(prg242.id, evaluation.id, monitor, "Facilities in use; no defects outstanding.");
  await completeClosureItem(prg242.id, "BEFORE_ARCHIVE", "archive-audit", admin, "Closure file audited; payments and certificates reconcile.");
  await archiveProject(prg242.id, admin, "Closure complete and audited.");
  setClosurePackScheduler(() => {});
  try {
    const pack = await requestClosurePack(prg242.id, admin);
    await runClosurePackExport(pack.id);
  } finally {
    setClosurePackScheduler(null);
  }

  // ---- KPI snapshots: the current month and five earlier months (trend lines) -------------------
  const snapshot = await snapshotTenantKpis(programme.id, new Date(), { backfillMonths: 5 });

  console.log(`   • Phase 16 demo programme (${snapshot}). Logins, password Password123!:`);
  for (const [persona, login] of [
    ["Programme administrator", "programme.admin@insite.ng"],
    ["Flagship admin (Programme Authority)", "flagship.admin@insite.ng"],
    ["Subsidiary admins (North, South)", "north.admin@insite.ng, south.admin@insite.ng (second South signatory: south.me@)"],
    ["Funding authority (records payments)", "programme.funder@insite.ng"],
    ["M&E officer (web, over the site limit)", "me.officer@insite.ng"],
    ["Monitor", "programme.monitor@insite.ng"],
    ["Resident Supervisor (mobile, provisioned)", "resident.supervisor@insite.ng"],
    ["Legal officer (default cases)", "legal.officer@insite.ng"],
  ] as const) {
    console.log(`     - ${persona.padEnd(42)} ${login}`);
  }
}
