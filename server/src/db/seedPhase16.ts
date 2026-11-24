import crypto from "crypto";
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
import { registerProjectDocument } from "../modules/documents/documents.service";
import { projectObjectPrefix, storageService } from "../integrations/storage.service";
import { LAGOS_SUBEB_NAME, ME_CONSULTANTS_NAME, PROGRAMME_TENANT_SLUG, UBEC_ORG_NAME } from "./seedPhase11";
import {
  INDEPENDENT_ME_EMAIL,
  KANO_ADMIN_EMAIL,
  LAGOS_ADMIN_EMAIL,
  LAGOS_ME_EMAIL,
  RESIDENT_SUPERVISOR_EMAIL,
  UBEC_ADMIN_EMAIL,
  UBEC_ME_EMAIL,
  UBEC_ROLE,
} from "./seedUbecRoster";
import { fileDocument, heldKickoff, labelDefaultCaseChain, payloadFor } from "./seedPhase13";
import { acceptedHandover, approvedFinalEvaluation, paperCopy } from "./seedPhase15";

/**
 * Phase 16 seed: the end-to-end demo programme. Runs after every other seed and adds what the
 * demo script needs so the UBEC tenant has a project at every stage of both delivery models
 * (DI = Direct Intervention, type code CENTRAL; MG = Matching Grants, type code CO_FUNDED):
 *
 * | Stage                                           | Project                          |
 * | ----------------------------------------------- | -------------------------------- |
 * | Draft with kick-off planned                     | PRG-101 (DI, Kano)               |
 * | Mobilising on time                              | PRG-102 (DI, Kano)               |
 * | Mobilisation overdue with a default case        | PRG-221 (MG, Lagos SUBEB)        |
 * | Active: weekly supervision, late visit, finding | PRG-211 (MG, Kano SUBEB)         |
 * | Interim payment recorded, works ~80% done      | PRG-105 (DI, Kano)               | new
 * | CoC pending a signature, handover to record     | PRG-104 (DI, Lagos)              | new
 * | In retention with a defect                      | PRG-103 (DI, Kano)               | defect added
 * | Closed, post-closure evaluation pending         | PRG-241 (MG, Lagos SUBEB)        |
 * | Closed and archived with a closure pack         | PRG-242 (MG, Lagos SUBEB)        | new
 *
 * Also: KPI targets on both project types (written without a version bump, as Phases 13–15 do),
 * the mobile-only Resident Supervisor (UBEC roster; R1d: contractors have no login), PRG-104's beneficiary handover response left for the demo to record (no public link), and
 * KPI snapshots for the current and five earlier months.
 * Everything goes through the real services; the only shortcuts are dates of seeded history
 * (milestones done earlier). Redesign R1b: payments are made outside the platform and recorded.
 */

const DIRECT_INTERVENTION_TARGETS = ProjectTypeKpiTargetsSchema.parse({
  contractors_mobilised_on_time: { target: 90 },
  reports_on_time: { target: 85 },
  visits_conducted: { target: 90 },
  financial_utilisation: { target: null },
});
const MATCHING_GRANTS_TARGETS = ProjectTypeKpiTargetsSchema.parse({
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

/**
 * UBEC rebrand: a closeout report uploaded through the real document service (local-disk storage in
 * development), as the closure checklist's before-archive item expects.
 */
async function uploadCloseoutReport(tenantId: string, projectId: string, uploader: WebJwtPayload, school: string) {
  const body = Buffer.from(`%PDF-1.4
% Closeout report: ${school} (seed)
%%EOF
`, "utf8");
  const objectKey = `${projectObjectPrefix(tenantId, projectId)}project_document/seed-closeout-${crypto.randomUUID()}.pdf`;
  await storageService.putServerObject(objectKey, body, "application/pdf");
  const type = await prisma.documentType.findUniqueOrThrow({ where: { tenantId_code: { tenantId, code: "CLOSEOUT_REPORT" } } });
  await registerProjectDocument(projectId, uploader, {
    documentTypeId: type.id,
    title: `Closeout report: ${school}`,
    objectKey,
    note: "Final evaluation summary, lessons learned and beneficiary feedback.",
  });
}

export async function seedPhase16() {
  const programme = await prisma.tenant.findUniqueOrThrow({ where: { slug: PROGRAMME_TENANT_SLUG } });
  const today = zonedCalendarDate(new Date(), "Africa/Lagos");
  const daysAgo = (n: number) => new Date(`${addDays(today, -n)}T10:00:00.000Z`);

  // ---- KPI targets on the project types (no version bump, seed only) --------------------------
  for (const type of await prisma.projectType.findMany({ where: { tenantId: programme.id } })) {
    const config = ProjectTypeConfigSchema.parse({
      ...ProjectTypeConfigSchema.parse(type.configJson),
      kpiTargets: type.code === "CO_FUNDED" ? MATCHING_GRANTS_TARGETS : DIRECT_INTERVENTION_TARGETS,
    });
    await prisma.projectType.update({ where: { id: type.id }, data: { configJson: config as unknown as Prisma.InputJsonValue } });
  }

  // UBEC roster: the UBEC administrator also stands in for UBEC HQ departments (Physical Planning,
  // Finance & Accounts, Legal, Audit); the M&E officers review visits and handovers and sign the CoC.
  const admin = await payloadFor(UBEC_ADMIN_EMAIL);
  const monitor = await payloadFor(UBEC_ME_EMAIL);
  const southAdmin = await payloadFor(LAGOS_ADMIN_EMAIL);
  const southMe = await payloadFor(LAGOS_ME_EMAIL);

  const types = new Map((await prisma.projectType.findMany({ where: { tenantId: programme.id } })).map((t) => [t.code, t]));
  const org = (name: string) => prisma.organization.findFirstOrThrow({ where: { tenantId: programme.id, name } });
  const flagship = await org(UBEC_ORG_NAME);
  const south = await org(LAGOS_SUBEB_NAME);
  const monitorOrg = await org(ME_CONSULTANTS_NAME);
  const contractorOrg = await org("Sahel Build & Civil Works Ltd");
  const region = (code: string) => prisma.region.findFirstOrThrow({ where: { tenantId: programme.id, code } });
  const kano = await region("N-KAN");
  const lagos = await region("S-LAG");
  const byCode = async (code: string) => prisma.project.findFirstOrThrow({ where: { tenantId: programme.id, codePrefix: code } });

  // ---- Demo persona: the Resident Supervisor (mobile only, UBEC State/Zonal Office) ------------
  // Main role = the mobile Resident Supervisor role, as the first tenant's field accounts: no web
  // permissions; on the phone it sees the projects it is assigned to.
  const residentRole = await prisma.role.findFirstOrThrow({ where: { tenantId: programme.id, code: UBEC_ROLE.RESIDENT_SUPERVISOR } });
  const resident = await prisma.user.create({
    data: {
      tenantId: programme.id,
      email: RESIDENT_SUPERVISOR_EMAIL,
      passwordHash: (await prisma.user.findUniqueOrThrow({ where: { email: admin.email } })).passwordHash,
      fullName: "Musa Danladi",
      roleId: residentRole.id,
      organizationId: flagship.id,
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
    // Assignment-based M&E visibility (UBEC roster): the Lagos SUBEB M&E officer on Lagos SUBEB
    // projects, the UBEC M&E officer on the others; the Resident Supervisor on every new project.
    const meOfficer = spec.ownerId === south.id ? southMe : monitor;
    for (const userId of [meOfficer.userId, resident.id]) {
      await prisma.userProjectAssignment.create({ data: { userId, projectId: live.id } });
    }
    await labelDefaultCaseChain(live.id, spec.type);
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

  // ---- PRG-101 (draft, Direct Intervention): kick-off planned in nine days ----------------------------------
  const prg101 = await byCode("PRG-101");
  await prisma.project.update({
    where: { id: prg101.id },
    data: {
      contractReference: "UBEC/DI/2026/101",
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
      { stakeholderGroup: "OWNER", name: admin.fullName, email: admin.email, userId: admin.userId, organizationId: flagship.id },
      { stakeholderGroup: "MONITOR", name: monitor.fullName, email: monitor.email, userId: monitor.userId, organizationId: monitor.organizationId },
      { stakeholderGroup: "CONTRACTOR", name: "Sahel Build & Civil Works Ltd", email: "projects@sahelbuild.example", organizationId: contractor101.organizationId },
      { stakeholderGroup: "BENEFICIARY", name: "Head teacher, Kano Model Primary School", email: "headteacher.prg-101@example.org" },
    ],
  });

  // ---- PRG-103 (Direct Intervention): the handover snags become defect tickets -------------------------------
  const prg103 = await byCode("PRG-103");
  const snagged = await prisma.handoverSubmission.findFirstOrThrow({ where: { projectId: prg103.id }, orderBy: { submittedAt: "desc" } });
  await createTicketsFromSnags(prg103.id, snagged.id, monitor, { severity: "MEDIUM", dueDate: addDays(today, 14) });

  // ---- PRG-105 (Direct Intervention, Kano): bills 1 and 2 done, one interim payment recorded ------------------
  const prg105 = await liveProject({
    code: "PRG-105",
    name: "Kano Day Secondary School",
    type: "CENTRAL",
    regionId: kano.id,
    ownerId: null,
    beneficiary: "Kano Day Secondary School",
    budget: 210_000_000,
    site: { lat: 12.0471, lng: 8.5233, label: "Day Secondary School, Kano" },
    state: "Kano State",
  });
  await pastContract(prg105.id, "UBEC/DI/2026/105", 120, [admin, monitor]);
  // The Independent M&E (COREN-certified firm) is engaged on PRG-105 as well as PRG-102 and PRG-211.
  const independent = await prisma.user.findUniqueOrThrow({ where: { email: INDEPENDENT_ME_EMAIL } });
  await prisma.userProjectAssignment.create({ data: { userId: independent.id, projectId: prg105.id } });
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
  // Finance & Accounts has no login: the UBEC administrator records the payment.
  await recordPayment(prg105.id, admin, {
    kind: "INTERIM",
    paidOn: zonedCalendarDate(daysAgo(12), "Africa/Lagos"),
    grossAmountNgn: 63_000_000,
    reference: "UBEC/PV/2026/0105-01",
    description: "Substructure",
  });

  // ---- PRG-104 (Direct Intervention, Lagos): Certificate of Completion waiting for a signature --------------
  const prg104 = await liveProject({
    code: "PRG-104",
    name: "Lagos Island Model College",
    type: "CENTRAL",
    regionId: lagos.id,
    ownerId: null,
    beneficiary: "Lagos Island Model College",
    budget: 165_000_000,
    site: { lat: 6.4549, lng: 3.3941, label: "Model College, Lagos Island" },
    state: "Lagos State",
  });
  await pastContract(prg104.id, "UBEC/DI/2025/104", 240, [admin, monitor]);
  await prisma.project.update({ where: { id: prg104.id }, data: { plannedEndDate: addDays(today, 5), retentionPercentage: 5, retentionDurationMonths: 12 } });
  await approvedFinalEvaluation({ tenantId: programme.id, projectId: prg104.id, reporter: monitor, visitDate: addDays(today, -2) });
  await changeProjectPhase({ projectId: prg104.id, webUser: admin, input: { to: "HANDOVER_IN_PROGRESS" } });
  await draftCompletionCertificate(prg104.id, admin, { completionDate: addDays(today, -1) });
  await signCompletionCertificate(prg104.id, admin, { slotKey: "head-physical-planning" });
  // The beneficiary's handover response is left for the demo to record (R1d: no public link).

  // ---- PRG-242 (Matching Grants, Lagos SUBEB): closed, evaluated, audited, archived, closure pack built ------
  const prg242 = await liveProject({
    code: "PRG-242",
    name: "Yaba Junior Secondary School",
    type: "CO_FUNDED",
    regionId: lagos.id,
    ownerId: south.id,
    beneficiary: "Yaba Junior Secondary School",
    budget: 72_000_000,
    site: { lat: 6.5095, lng: 3.3711, label: "Junior Secondary School, Yaba" },
    state: "Lagos State",
  });
  const contractor242 = await pastContract(prg242.id, "LASUBEB/MG/2025/242", 320, [southAdmin, southMe]);
  // Completed six weeks late against the planned end (the KPI shows it as not on time).
  await prisma.project.update({ where: { id: prg242.id }, data: { plannedEndDate: addDays(today, -60), retentionPercentage: 5, retentionDurationMonths: 6 } });
  await approvedFinalEvaluation({ tenantId: programme.id, projectId: prg242.id, reporter: southMe, visitDate: addDays(today, -19) });
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
  await acceptedHandover({ projectId: prg242.id, createdByUserId: southAdmin.userId, reviewer: southMe, headName: "Mr Tunde Bakare", snags: 0 });
  await changeProjectPhase({ projectId: prg242.id, webUser: admin, input: { to: "RETENTION_PERIOD" } });
  const criteria = await tenantRatingCriteria(prisma, programme.id);
  for (const [rater, scores, comments] of [
    [southMe, [3, 4, 4, 3, 4], "Good quality; six weeks late after the rainy-season stoppage."],
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
    uploadedByUserId: southMe.userId,
    createdAt: new Date(),
  });
  const evaluation = await prisma.projectContractMilestone.findFirstOrThrow({ where: { projectId: prg242.id, key: "post-closure-evaluation" } });
  await completeMilestone(prg242.id, evaluation.id, southMe, "Facilities in use; no defects outstanding.");
  // UBEC rebrand: the closeout report (lessons learned live in it) is a before-archive item.
  await uploadCloseoutReport(programme.id, prg242.id, southAdmin, "Yaba Junior Secondary School");
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
    ["UBEC Administrator (also Legal, ES, Finance, Audit)", UBEC_ADMIN_EMAIL],
    ["SUBEB Administrator, Kano", KANO_ADMIN_EMAIL],
    ["SUBEB Administrator, Lagos (Executive Chairman)", LAGOS_ADMIN_EMAIL],
    ["UBEC M&E Officer (over the site limit)", UBEC_ME_EMAIL],
    ["SUBEB M&E Officer, Lagos (CoC signatory)", LAGOS_ME_EMAIL],
    ["Independent M&E (COREN-certified firm)", INDEPENDENT_ME_EMAIL],
    ["Resident Supervisor (mobile only)", RESIDENT_SUPERVISOR_EMAIL],
  ] as const) {
    console.log(`     - ${persona.padEnd(52)} ${login}`);
  }
}
