import { addDays, zonedCalendarDate } from "@insite/shared";
import { prisma } from "../config/prisma";
import { WebJwtPayload } from "../middleware/auth.middleware";
import { demoDocumentTitle, DemoDocumentCode } from "./demoDocuments";
import { fileDocument, payloadFor, projectDocumentContext, signDocument } from "./seedPhase13";
import { KANO_SUBEB_NAME, PROGRAMME_TENANT_SLUG } from "./seedPhase11";
import { KANO_ADMIN_EMAIL, LAGOS_ADMIN_EMAIL, LAGOS_ME_EMAIL, UBEC_ADMIN_EMAIL, UBEC_ME_EMAIL } from "./seedUbecRoster";

/**
 * Runs last. Makes every seeded UBEC project's document register coherent with its stage: the
 * documents that stage would have (specimen PDFs, `demoDocuments.ts`) with specific titles, dated
 * from the contract and kick-off dates, and sign-offs done for everything a later stage implies was
 * accepted. Documents already filed by earlier seeds are kept (one per type); only missing types
 * are added.
 *
 * | Stage reached            | Register                                                                        |
 * | ------------------------ | ------------------------------------------------------------------------------- |
 * | Contract awarded         | award letter, acceptance letter, contract                                        |
 * | Kick-off notice due      | + kick-off briefing pack                                                         |
 * | Kick-off held            | + minutes (owner and M&E signed), letter of introduction to the Head Teacher,    |
 * |                          |   supervisor assignment, mobilisation agreement (owner signed); MG: mobilisation |
 * |                          |   plan                                                                           |
 * | Contractor mobilised     | + site possession form (signed), mobilisation plan, programme of works (signed)  |
 *
 * Left pending for the demo: PRG-102's site possession form (filed two days ago, awaiting the
 * owner's sign-off, so "Mobilisation documents complete" is still open).
 */

const PENDING_FOR_DEMO: Record<string, string[]> = { "PRG-102": ["SITE_POSSESSION_FORM"] };
/** Documents the contractor brings (tied to the project's contractor). */
const CONTRACTOR_DOCS = new Set(["ACCEPTANCE_LETTER", "MOBILISATION_AGREEMENT", "MOBILISATION_PLAN", "PROGRAMME_OF_WORKS", "SITE_POSSESSION_FORM"]);

interface Planned {
  code: DemoDocumentCode;
  date: string;
  signers: WebJwtPayload[];
}

export async function seedDocumentRegisters() {
  const programme = await prisma.tenant.findUniqueOrThrow({ where: { slug: PROGRAMME_TENANT_SLUG } });
  const today = zonedCalendarDate(new Date(), "Africa/Lagos");
  const admin = await payloadFor(UBEC_ADMIN_EMAIL);
  const meOfficer = await payloadFor(UBEC_ME_EMAIL);
  const kanoAdmin = await payloadFor(KANO_ADMIN_EMAIL);
  const lagosAdmin = await payloadFor(LAGOS_ADMIN_EMAIL);
  const lagosMe = await payloadFor(LAGOS_ME_EMAIL);
  const kanoSubeb = await prisma.organization.findFirst({ where: { tenantId: programme.id, name: KANO_SUBEB_NAME }, select: { id: true } });

  const projects = await prisma.project.findMany({
    where: { tenantId: programme.id, codePrefix: { startsWith: "PRG-" } },
    select: {
      id: true,
      codePrefix: true,
      owningOrganizationId: true,
      contractAwardDate: true,
      contractSignedDate: true,
      kickoffDate: true,
      kickoffHeldAt: true,
      timezone: true,
      status: true,
      constructionPhase: true,
      projectType: { select: { code: true } },
    },
    orderBy: { codePrefix: "asc" },
  });

  for (const p of projects) {
    // A live project seeded without contract dates (PRG-211): its history is dated from its first visit.
    let history: { award: string; signed: string; kickoff: string } | null = null;
    if (!p.contractAwardDate && p.status === "ACTIVE") {
      const first = await prisma.visit.findFirst({ where: { projectId: p.id }, orderBy: { plannedDate: "asc" }, select: { plannedDate: true } });
      const kickoffDay = addDays(first?.plannedDate ?? today, -14);
      history = { award: addDays(kickoffDay, -30), signed: addDays(kickoffDay, -20), kickoff: kickoffDay };
    }
    if (!p.contractAwardDate && !history) continue;
    const coFunded = p.projectType?.code === "CO_FUNDED";
    // Matching Grants: the owning SUBEB signs, with its M&E officer (Kano SUBEB has none: the UBEC one).
    const owner = !coFunded ? admin : p.owningOrganizationId === kanoSubeb?.id ? kanoAdmin : lagosAdmin;
    const monitor = coFunded && owner === lagosAdmin ? lagosMe : meOfficer;
    const award = p.contractAwardDate ?? history!.award;
    const kickoff = p.kickoffDate ?? history?.kickoff ?? null;
    const held = (Boolean(p.kickoffHeldAt) || history !== null) && kickoff !== null;
    const mobilised = history
      ? true
      : held
      ? (await prisma.projectContractMilestone.count({ where: { projectId: p.id, completionMode: "AUTO_CONTRACTOR_ON_SITE", status: "DONE" } })) > 0
      : false;
    const pendingHere = PENDING_FOR_DEMO[p.codePrefix] ?? [];

    const plan: Planned[] = [
      { code: "AWARD_LETTER", date: award, signers: [] },
      { code: "ACCEPTANCE_LETTER", date: addDays(award, 2), signers: [] },
      { code: "CONTRACT", date: p.contractSignedDate ?? history?.signed ?? addDays(award, 8), signers: [] },
    ];
    if (kickoff) plan.push({ code: "KICKOFF_BRIEFING_PACK", date: addDays(kickoff, -8), signers: [] });
    if (held && kickoff) {
      plan.push(
        { code: "KICKOFF_MINUTES", date: addDays(kickoff, 1), signers: [owner, monitor] },
        { code: "LETTER_OF_INTRODUCTION", date: addDays(kickoff, 2), signers: [] },
        { code: "SUPERVISOR_ASSIGNMENT", date: addDays(kickoff, 2), signers: [] },
        { code: "MOBILISATION_AGREEMENT", date: addDays(kickoff, 5), signers: [owner] }
      );
      if (coFunded || mobilised) plan.push({ code: "MOBILISATION_PLAN", date: addDays(kickoff, 3), signers: [] });
    }
    if (held && kickoff && (mobilised || pendingHere.includes("SITE_POSSESSION_FORM"))) {
      plan.push({ code: "SITE_POSSESSION_FORM", date: mobilised ? addDays(kickoff, 7) : addDays(today, -2), signers: [owner] });
    }
    if (held && kickoff && mobilised) plan.push({ code: "PROGRAMME_OF_WORKS", date: addDays(kickoff, 10), signers: [monitor] });

    const contractor = await prisma.projectContractor.findFirst({ where: { projectId: p.id }, select: { id: true } });
    const existing = await prisma.projectDocument.findMany({
      where: { projectId: p.id, isArchived: false },
      include: { documentType: true, versions: { orderBy: { version: "asc" } }, signOffs: { select: { userId: true } } },
    });
    const haveCodes = new Set(existing.map((d) => d.documentType.code));

    for (const item of plan.filter((i) => i.date <= today)) {
      if (haveCodes.has(item.code)) continue;
      const context = await projectDocumentContext(p.id, item.date);
      await fileDocument({
        tenantId: programme.id,
        projectId: p.id,
        typeCode: item.code,
        title: demoDocumentTitle(item.code, context),
        uploadedByUserId: owner.userId,
        projectContractorId: CONTRACTOR_DOCS.has(item.code) ? contractor?.id ?? null : null,
        createdAt: new Date(`${item.date}T10:00:00.000Z`),
      });
      haveCodes.add(item.code);
    }

    // Sign-offs the stage implies (kept pending only where the demo needs it).
    const docs = await prisma.projectDocument.findMany({
      where: { projectId: p.id, isArchived: false },
      include: { documentType: true, versions: { orderBy: { version: "asc" } }, signOffs: { select: { userId: true } } },
    });
    for (const d of docs) {
      if (!d.documentType.requiresSignOff || pendingHere.includes(d.documentType.code)) continue;
      // Generated certificates carry their own signatures; the beneficiary's paper copy of the CoC is
      // filed under the certificate type and is acknowledged by the officer who recorded it.
      const planned = plan.find((i) => i.code === d.documentType.code) ?? (d.signOffs.length === 0 ? { signers: [owner] } : null);
      if (!planned) continue;
      const signedBy = new Set(d.signOffs.map((s) => s.userId));
      let day = 1;
      for (const signer of planned.signers) {
        if (signedBy.has(signer.userId)) continue;
        const at = addDays(zonedCalendarDate(d.createdAt, p.timezone), day++);
        await signDocument(d, signer, new Date(`${at > today ? today : at}T11:00:00.000Z`));
      }
    }

    // PRG-102: the letter of introduction and the supervisor assignment were issued two days after the kick-off.
    if (p.codePrefix === "PRG-102" && kickoff) {
      await prisma.projectContractMilestone.updateMany({
        where: { projectId: p.id, key: { in: ["letter-of-introduction", "supervisor-assignment"] }, status: { not: "DONE" } },
        data: { status: "DONE", completedAt: new Date(`${addDays(kickoff, 2)}T10:00:00.000Z`), completedNotes: "Issued after the kick-off (seeded history)." },
      });
    }
  }
}
