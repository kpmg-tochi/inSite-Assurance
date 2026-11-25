import { Prisma } from "@prisma/client";
import crypto from "crypto";
import {
  addWorkdays,
  DEFAULT_POST_CLOSURE_RULE,
  DEFAULT_VISIT_PLAN,
  DEVICE_SIGNATURE_ALGORITHM,
  ProjectTypeConfigSchema,
  VisitFormSnapshot,
  VisitFormSnapshotSchema,
  VisitPlanRuleInput,
  zonedCalendarDate,
} from "@insite/shared";
import { prisma } from "../config/prisma";
import type { FieldAgentJwtPayload, WebJwtPayload } from "../middleware/auth.middleware";
import { PROGRAMME_TENANT_SLUG } from "./seedPhase11";
import { payloadFor } from "./seedPhase13";
import { INDEPENDENT_ME_EMAIL, LAGOS_ME_EMAIL, RESIDENT_SUPERVISOR_EMAIL, UBEC_ME_EMAIL } from "./seedUbecRoster";
import { proposeVisitsFromType } from "../modules/visits/visitPlan.service";
import { createVisit, publishVisits } from "../modules/visits/visits.service";
import { webVisitActor } from "../modules/visits/visitCore";
import { submitVisit } from "../modules/visits/visitSubmissions.service";
import { reviewVisitSubmission } from "../modules/visits/visitAcceptance";
import { respondToVisit } from "../modules/visits/visitResponses.service";
import { verifySprint } from "../modules/scope/sprintVerification.service";
import { runFindingEscalations, runVisitDeadlines } from "../jobs/visitJobs";

/**
 * Redesign R4 seed. Runs after seedR3.
 * - Both programme types get the default visit plan (D-R4.13) with weekly routine supervision visits
 *   (UBEC manual: Resident Supervisors visit weekly; the default plan has every two weeks). Matching
 *   Grants also gets a post-closure evaluation (on its PROJECT_CLOSED milestone, else 180 days after
 *   closing). Merged without a version bump into the types and their projects' snapshots (seed only,
 *   as Phases 13–16 and R3 do).
 * - `resident.supervisor@ubec.test` (mobile only, Resident Supervisor) is the visit officer; the visits
 *   below go through the real services (forms frozen, submissions validated, the approval chain run).
 *
 * | Project | Visits                                                                                       |
 * | ------- | -------------------------------------------------------------------------------------------- |
 * | PRG-102 | mobilisation checks every 2 weeks until mobilised (proposed); the first one published        |
 * | PRG-105 | plan proposed; the next three published; one routine visit tomorrow; a pending date proposal  |
 * |         | and a decline for `me.officer@ubec.test`; sprint 1 verified PARTLY_MET (BEHIND), sprint 2 late  |
 * | PRG-211 | accepted baseline; a routine visit 40 days ago uploaded today (late); a routine visit with a  |
 * |         | major finding open for 20 days (escalated)                                                    |
 * | PRG-221 | a quarterly M&E visit that was never submitted (missed)                                      |
 * | M&E    | UBEC roster: me.officer@ leads a routine visit on PRG-105 (in 2 working days); independent.me@ |
 * |         | an ad hoc visit on PRG-105 (in 4); lagos.me@ a mobilisation check on PRG-221 (in 2)            |
 */

const SEED_DEVICE_ID = "SEED-RESIDENT-SUPERVISOR-PHONE";

/** A field session for the officer on a project (as the app's sign-in would create). */
async function fieldAgentFor(userId: string, projectId: string): Promise<FieldAgentJwtPayload> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      role: { include: { rolePermissions: { include: { permission: { select: { key: true } } } } } },
      mobileRole: { include: { rolePermissions: { include: { permission: { select: { key: true } } } } } },
    },
  });
  // The separate mobile role if any, else the main role (a mobile-only account, UBEC roster).
  const role = user.mobileRole ?? user.role;
  let device = await prisma.mobileDevice.findFirst({ where: { userId, deviceId: SEED_DEVICE_ID } });
  if (!device) {
    const { publicKey } = crypto.generateKeyPairSync("ed25519");
    const raw = Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url");
    device = await prisma.mobileDevice.create({
      data: {
        userId,
        deviceId: SEED_DEVICE_ID,
        deviceModel: "Seed phone",
        publicKey: raw.toString("base64"),
        publicKeyAlg: DEVICE_SIGNATURE_ALGORITHM,
        publicKeyId: crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16),
      },
    });
  }
  await prisma.userProjectAssignment.createMany({ data: [{ userId, projectId }], skipDuplicates: true });
  const session =
    (await prisma.fieldAgentSession.findFirst({ where: { userId, projectId, deviceId: SEED_DEVICE_ID } })) ??
    (await prisma.fieldAgentSession.create({
      data: {
        projectId,
        userId,
        mobileDeviceId: device.id,
        roleId: role.id,
        roleNameSnapshot: role.name,
        fieldPersonaType: role.fieldPersonaType,
        assuranceWeight: role.assuranceWeight,
        agentFullName: user.fullName,
        agentPhoneNumber: user.phoneNumber ?? "",
        deviceId: SEED_DEVICE_ID,
        devicePublicKey: device.publicKey,
        devicePublicKeyAlg: device.publicKeyAlg,
        devicePublicKeyId: device.publicKeyId,
      },
    }));
  return {
    tokenType: "FIELD_AGENT",
    sessionId: session.id,
    tenantId: user.tenantId,
    projectId,
    roleId: role.id,
    roleCode: role.code,
    roleName: role.name,
    fieldPersonaType: role.fieldPersonaType,
    assuranceWeight: role.assuranceWeight,
    permissions: role.rolePermissions.map((rp) => rp.permission.key),
    agentFullName: user.fullName,
    deviceId: SEED_DEVICE_ID,
    userId,
  };
}

/** Valid answers for every non-capture question; `overrides` by answer path. */
export function answersFor(snapshot: VisitFormSnapshot, overrides: Record<string, { value: string | number; comment: string }> = {}) {
  const out: Array<{ path: string; value: string | number | string[] | null; comment: string | null; captures: [] }> = [];
  for (const b of snapshot.blocks) {
    for (const f of b.fields) {
      if (f.type === "PHOTO" || f.type === "VOICE_NOTE") continue;
      let value: string | number | string[] | null = null;
      if (f.type === "SHORT_TEXT" || f.type === "LONG_TEXT") value = "Checked on site";
      if (f.type === "NUMBER") value = f.boundedByPlannedQuantity && f.plannedQuantity !== null ? f.plannedQuantity : (f.min ?? 1);
      if (f.type === "PERCENTAGE") value = 60;
      if (f.type === "RATING_1_5") value = 4;
      if (f.type === "YES_NO") value = f.recheck ? "NO" : "YES";
      if (f.type === "SINGLE_CHOICE") value = f.options[0]?.key ?? null;
      if (f.type === "MULTI_CHOICE") value = f.options.slice(0, Math.max(1, f.minSelected ?? 1)).map((o) => o.key);
      if (f.type === "DATE") value = snapshot.context.visitDate;
      const o = overrides[f.path];
      out.push({ path: f.path, value: o ? o.value : value, comment: o ? o.comment : "Seen on the visit", captures: [] });
    }
  }
  return out;
}

async function snapshotOf(visitId: string): Promise<{ id: string; hash: string; snapshot: VisitFormSnapshot }> {
  const v = await prisma.visit.findUniqueOrThrow({ where: { id: visitId }, include: { formSnapshot: true } });
  return { id: v.formSnapshotId!, hash: v.formHash!, snapshot: VisitFormSnapshotSchema.parse(v.formSnapshot!.snapshotJson) };
}

/** Submits a visit as the officer and approves it through the chain when one applies. */
async function submitAndAccept(
  projectId: string,
  visitId: string,
  officer: FieldAgentJwtPayload,
  reviewer: WebJwtPayload,
  opts: { overrides?: Record<string, { value: string | number; comment: string }>; overallFinding?: "SATISFACTORY" | "MINOR_ISSUES" | "MAJOR_ISSUES"; summary: string; accept?: boolean }
) {
  const form = await snapshotOf(visitId);
  const { submission } = await submitVisit({
    projectId,
    visitId,
    fieldAgent: officer,
    input: {
      clientSubmissionId: crypto.randomUUID(),
      formSnapshotId: form.id,
      formHash: form.hash,
      answers: answersFor(form.snapshot, opts.overrides) as never,
      overallFinding: opts.overallFinding ?? "SATISFACTORY",
      summaryText: opts.summary,
      siteLogEntryIds: [],
      checkIn: null,
      submissionGeotag: null,
      confirmedAt: new Date().toISOString(),
    },
  });
  let status = submission.status;
  for (let i = 0; i < 4 && opts.accept !== false && status === "PENDING_APPROVAL"; i++) {
    const next = await reviewVisitSubmission({
      projectId,
      visitId,
      submissionId: submission.id,
      webUser: reviewer,
      input: { decision: "APPROVE", notes: null },
      load: async () => submission,
    }).catch(() => null);
    if (!next) break;
    status = (await prisma.visitSubmission.findUniqueOrThrow({ where: { id: submission.id } })).status;
  }
  return submission.id;
}

export async function seedR4(): Promise<void> {
  const programme = await prisma.tenant.findUniqueOrThrow({ where: { slug: PROGRAMME_TENANT_SLUG } });
  for (const type of await prisma.projectType.findMany({ where: { tenantId: programme.id } })) {
    const plan = DEFAULT_VISIT_PLAN.map((r) => (r.key === "routine" ? { ...r, intervalWeeks: 1 } : r));
    const visitPlan: VisitPlanRuleInput[] = type.code === "CO_FUNDED" ? [...plan, DEFAULT_POST_CLOSURE_RULE] : plan;
    const merge = (raw: unknown) => {
      const base = ProjectTypeConfigSchema.parse(raw ?? {});
      return ProjectTypeConfigSchema.parse({ ...base, monitoring: { ...base.monitoring, visitPlan } });
    };
    await prisma.projectType.update({ where: { id: type.id }, data: { configJson: merge(type.configJson) as unknown as Prisma.InputJsonValue } });
    // A project's snapshot is { ...type metadata, config } (projectTypes.service).
    for (const p of await prisma.project.findMany({ where: { projectTypeId: type.id, projectTypeSnapshotJson: { not: Prisma.DbNull } } })) {
      const snapshot = p.projectTypeSnapshotJson as Record<string, unknown>;
      await prisma.project.update({
        where: { id: p.id },
        data: { projectTypeSnapshotJson: { ...snapshot, config: merge(snapshot.config) } as unknown as Prisma.InputJsonValue },
      });
    }
  }

  const resident = await prisma.user.findUniqueOrThrow({ where: { email: RESIDENT_SUPERVISOR_EMAIL } });
  const monitor = await payloadFor(UBEC_ME_EMAIL);
  const byCode = (code: string) => prisma.project.findFirstOrThrow({ where: { tenantId: programme.id, codePrefix: code } });
  const lead = [{ userId: resident.id, isLead: true }];
  const now = new Date();
  const today = zonedCalendarDate(now, "Africa/Lagos");
  const workdays = [1, 2, 3, 4, 5, 6];

  // ---- PRG-102 and PRG-105: the plan proposed with the officer --------------------------------------
  for (const code of ["PRG-102", "PRG-105"]) {
    const project = await byCode(code);
    await prisma.userProjectAssignment.createMany({ data: [{ userId: resident.id, projectId: project.id }], skipDuplicates: true });
    await prisma.project.update({ where: { id: project.id }, data: { defaultVisitOfficerIds: [resident.id] } });
    await prisma.$transaction((tx) => proposeVisitsFromType(tx, project.id, { trigger: "MANUAL", actor: webVisitActor(monitor) }), { timeout: 60_000 });
  }

  const prg102 = await byCode("PRG-102");
  const firstCheck = await prisma.visit.findFirst({ where: { projectId: prg102.id, status: "PROPOSED", visitKind: "MOBILISATION_CHECK" }, orderBy: { plannedDate: "asc" } });
  if (firstCheck) await publishVisits(prg102.id, monitor, { visitIds: [firstCheck.id] });

  const prg105 = await byCode("PRG-105");
  const next = await prisma.visit.findMany({ where: { projectId: prg105.id, status: "PROPOSED" }, orderBy: { plannedDate: "asc" }, take: 3, select: { id: true } });
  if (next.length) await publishVisits(prg105.id, monitor, { visitIds: next.map((v) => v.id) });
  await createVisit(prg105.id, monitor, { visitKind: "ROUTINE", plannedDate: addWorkdays(today, 1, workdays), assignees: lead, pickedFacilityIds: [], proposed: false });
  const officer105 = await fieldAgentFor(resident.id, prg105.id);
  const published = await prisma.visit.findMany({ where: { projectId: prg105.id, status: "PLANNED", id: { in: next.map((v) => v.id) } }, orderBy: { plannedDate: "asc" } });
  if (published[1]) {
    await respondToVisit({
      projectId: prg105.id,
      visitId: published[1].id,
      fieldAgent: officer105,
      input: { clientActionId: crypto.randomUUID(), action: "PROPOSE", date: addWorkdays(published[1].originalPlannedDate, 6, workdays), comment: "Roofing sheets arrive that week; better to check them in place." },
    });
  }
  if (published[2]) {
    await respondToVisit({
      projectId: prg105.id,
      visitId: published[2].id,
      fieldAgent: officer105,
      input: { clientActionId: crypto.randomUUID(), action: "DECLINE", comment: "On the PRG-102 mobilisation check that day." },
    });
  }
  const sprints = await prisma.projectSprint.findMany({ where: { projectId: prg105.id }, orderBy: { number: "asc" } });
  if (sprints[0] && sprints[0].endDate < today) {
    await verifySprint(prg105.id, sprints[0].id, monitor, { outcome: "PARTLY_MET", notes: "Substructure done; the toilet block slab was poured late." });
  }

  // ---- PRG-211: accepted baseline, a late routine visit, a major finding open past escalation -------
  const prg211 = await prisma.project.findFirst({ where: { tenantId: programme.id, codePrefix: "PRG-211", status: "ACTIVE" } });
  if (prg211) {
    const officer211 = await fieldAgentFor(resident.id, prg211.id);
    const baseline = await createVisit(prg211.id, monitor, { visitKind: "BASELINE", plannedDate: addWorkdays(today, -50, workdays), assignees: lead, pickedFacilityIds: [], proposed: false });
    await submitAndAccept(prg211.id, baseline.id, officer211, monitor, { summary: "Baseline: site cleared, existing block in poor condition, borehole not working." });

    const late = await createVisit(prg211.id, monitor, { visitKind: "ROUTINE", plannedDate: addWorkdays(today, -40, workdays), assignees: lead, pickedFacilityIds: [], proposed: false });
    await submitAndAccept(prg211.id, late.id, officer211, monitor, {
      overallFinding: "MINOR_ISSUES",
      summary: "Routine visit uploaded late: blockwork complete to lintel level; roofing materials not yet on site.",
    });

    const major = await createVisit(prg211.id, monitor, { visitKind: "ROUTINE", plannedDate: addWorkdays(today, -20, workdays), assignees: lead, pickedFacilityIds: [], proposed: false });
    const majorForm = await snapshotOf(major.id);
    const ppe = majorForm.snapshot.blocks.flatMap((b) => b.fields).find((f) => f.key === "ppe-worn");
    await submitAndAccept(prg211.id, major.id, officer211, monitor, {
      overallFinding: "MAJOR_ISSUES",
      overrides: ppe ? { [ppe.path]: { value: "NO", comment: "Six workers on the roof without harnesses or helmets." } } : {},
      summary: "Routine visit: roof framing in progress. Unsafe work at height.",
    });
    await prisma.finding.updateMany({ where: { projectId: prg211.id, visitId: major.id, status: "OPEN" }, data: { createdAt: new Date(now.getTime() - 20 * 24 * 3600 * 1000) } });
    await runFindingEscalations({ now });
  }

  // ---- PRG-221: a quarterly M&E visit nobody submitted ---------------------------------------------
  const prg221 = await prisma.project.findFirst({ where: { tenantId: programme.id, codePrefix: "PRG-221", status: "ACTIVE" } });
  if (prg221) {
    await createVisit(prg221.id, monitor, { visitKind: "QUARTERLY_ME", plannedDate: addWorkdays(today, -20, workdays), assignees: lead, pickedFacilityIds: [], proposed: false });
  }

  // ---- UBEC roster: the three M&E officers carry out visits on the field app too -------------------
  // Published (form frozen) and upcoming, so each shows on that officer's phone (GET /visits/mine).
  const officerOf = async (email: string) => [{ userId: (await prisma.user.findUniqueOrThrow({ where: { email } })).id, isLead: true }];
  // PRG-105 (Direct Intervention): a routine visit led by the UBEC M&E officer.
  await createVisit(prg105.id, monitor, { visitKind: "ROUTINE", plannedDate: addWorkdays(today, 2, workdays), assignees: await officerOf(UBEC_ME_EMAIL), pickedFacilityIds: [], proposed: false });
  // PRG-105: an ad hoc independent visit by the COREN-certified firm, on one facility.
  const unit105 = await prisma.facilityUnit.findFirst({ where: { projectId: prg105.id }, orderBy: { createdAt: "asc" }, select: { facilityId: true } });
  if (unit105) {
    await createVisit(prg105.id, monitor, { visitKind: "AD_HOC", plannedDate: addWorkdays(today, 4, workdays), assignees: await officerOf(INDEPENDENT_ME_EMAIL), pickedFacilityIds: [unit105.facilityId], proposed: false });
  }
  // PRG-221 (Matching Grants, Lagos SUBEB): a mobilisation check led by the Lagos SUBEB M&E officer.
  if (prg221) {
    await createVisit(prg221.id, monitor, { visitKind: "MOBILISATION_CHECK", plannedDate: addWorkdays(today, 2, workdays), assignees: await officerOf(LAGOS_ME_EMAIL), pickedFacilityIds: [], proposed: false });
  }
  // Missed visits and ended sprints are flagged by the deadlines job (as overnight).
  await runVisitDeadlines({ now });

}
