import crypto from "crypto";
import PDFDocument from "pdfkit";
import { Prisma } from "@prisma/client";
import {
  ConflictDeclarationRequestSchema,
  CostingStandardSchema,
  cycleDeadlines,
  DEFAULT_COSTING_STANDARD,
  DEFAULT_DI_NEEDS_PIPELINE,
  DEFAULT_FACILITIES,
  DEFAULT_MG_NEEDS_PIPELINE,
  findLgaByName,
  findStateByName,
  formatProposalReference,
  lgasOfState,
  NEEDS_TEMPLATE_VERSION,
  NeedsApprovalActionRequestSchema,
  NeedsPipelineConfigSchema,
  NeedsUploadConfirmRequestSchema,
  normalizeUnitOfMeasure,
  OutOfCycleRequestSchema,
  ParsedNeedsAssessmentSchema,
  ProjectTypeConfigSchema,
  ProposalBatchActionRequestSchema,
  RecordValidationRequestSchema,
  RegisterCycleDocumentRequestSchema,
  RegisterProposalDocumentRequestSchema,
  ResolveProposalFlagsRequestSchema,
  SaveBeapRequestSchema,
  ScoreSheetSchema,
  SetCommitteeRequestSchema,
  StageDecisionRequestSchema,
  SubmitPortfolioRequestSchema,
  XLSX_CONTENT_TYPE,
  zonedCalendarDate,
  type CycleDocumentKind,
  type NeedsPipelineConfig,
  type ParsedNeedsAssessment,
  type ProposalDocumentKind,
  type ProposalFlagKind,
} from "@insite/shared";
import { prisma } from "../config/prisma";
import type { WebJwtPayload } from "../middleware/auth.middleware";
import { storeTenantAreaBuffer } from "../utils/tenantUploads";
import { cycleDocumentPrefix, cycleVersionPrefix, openCycle, registerCycleDocument, updateCycle } from "../modules/needs/needsCycles.service";
import { deriveCycleOwnerId, workbookFacilities } from "../modules/needs/needsSupport";
import { replaceCurrentTables } from "../modules/needs/needsVersions";
import { confirmUpload } from "../modules/needs/needsUpload.service";
import { registerProposalDocument } from "../modules/needs/needsProposals.service";
import { applyProposalActions, decideStage } from "../modules/needs/decisions/needsDecisions.service";
import { recordValidation, resolveProposalFlags } from "../modules/needs/decisions/needsValidation.service";
import { decideSeparationOverride, requestSeparationOverride } from "../modules/needs/decisions/needsOverrides.service";
import { changeScoring, declareConflicts, registerMinutes, setCommittee } from "../modules/needs/committee/needsCommittee.service";
import { saveScoreSheet } from "../modules/needs/committee/needsScoreSheets.service";
import { finaliseRanking } from "../modules/needs/committee/needsRanking.service";
import { actOnPortfolio, registerPortfolioMemo, submitPortfolio } from "../modules/needs/submissions/portfolio.service";
import { registerBeapDocument, saveBeap, submitBeap } from "../modules/needs/submissions/beap.service";
import { createOutOfCycle, registerOutOfCycleDocument, submitOutOfCycle } from "../modules/needs/submissions/outOfCycle.service";
import { buildNeedsFile, type NeedsFileSpec } from "../modules/needs/workbook/fillNeedsWorkbook";
import { assignVerification } from "../modules/needs/verifications/needsVerifications.service";
import { AssignNeedsVerificationRequestSchema, addDays as addCalendarDays } from "@insite/shared";
import { buildNeedsWorkbook } from "../modules/needs/workbook/needsWorkbook";
import { PROGRAMME_TENANT_SLUG } from "./seedPhase11";
import { payloadFor } from "./seedPhase13";
import {
  DI_FUNDING_SEQUENCES,
  diCostedSpec,
  diReference,
  diSeedProposals,
  mgReference,
  mgSeedProposals,
  needsOpenYear,
  NEEDS_SEED_TZ,
  seedFileContext,
} from "./needsSeedSpecs";
import {
  DPP_EMAIL,
  ES_EMAIL,
  FINANCE_EMAIL,
  KANO_ADMIN_EMAIL,
  KANO_COMMITTEE_EMAILS,
  KANO_DPP_EMAIL,
  KANO_PROCUREMENT_EMAIL,
  LAGOS_ADMIN_EMAIL,
  NEEDS_PIPELINE_PEOPLE,
  NEEDS_PIPELINE_ROLES,
  PROCUREMENT_EMAIL,
  QS_EMAIL,
  UBEC_ADMIN_EMAIL,
  UBEC_ME_EMAIL,
} from "./seedUbecRoster";

/**
 * Needs pipeline seed. Wave 1 (N1): the default pipelines merged into the two UBEC programme types
 * (Direct Intervention, code CENTRAL: `DEFAULT_DI_NEEDS_PIPELINE`; Matching Grants, CO_FUNDED:
 * `DEFAULT_MG_NEEDS_PIPELINE`), without a version bump (seed only). Wave 2 (N2): costing standard v1
 * (`DEFAULT_COSTING_STANDARD`, specimen rates). The people are created by `seedUbecRoster` (D-N.25).
 *
 * Wave 5 (N9, M1 + M2), runs after `seedAlerts` (before the demo overlay):
 *
 * History (M2, written directly: closed cycles hold no workflow, only the record): every seeded
 * programme project (PRG-*) gets origin NEEDS_PIPELINE and a proposal at Funding, status CONVERTED, in
 * a CLOSED cycle of its intervention year (Direct Intervention: the national cycle; Matching Grants: the
 * State's cycle, owned by its SUBEB), with one needs assessment version (a template v2 file built from
 * the project's sites, units and BoQ, stored), the current sites and breakdown rows, a rank above the
 * line and approved = funded = the project budget. A closed Matching Grants cycle also holds its
 * approved BEAP (items with the projects' lots, counterpart evidence filed), so its drafts can be
 * activated (A5). No ledger entries, flags or decisions.
 *
 * Open cycles (M1, through the real services, so flags, decisions, generated documents, emails and the
 * tenant ledger are real; Y = the year after the run day, references deterministic):
 *
 * | Cycle | Reference | Stage | Status | What it shows |
 * | ----- | --------- | ----- | ------ | ------------- |
 * | DI Y (UBEC HQ) | Y-DI-001 | Funding | In progress | Dawakin Tofa WASH (the demo project, Kano, 3 schools): essential-facility gap justified at validation, cost ceilings acknowledged at costing; ranked 1st, approved |
 * | | Y-DI-002 | Funding | In progress | Jos North: desk rate 30 % above the standard acknowledged at costing; ranked 2nd, approved |
 * | | Y-DI-003 | Funding | In progress | Ilorin West: one sub-criterion divergent by 2 points (D-N.10); ranked 3rd, approved |
 * | | Y-DI-004 | Approval | Not selected | Bauchi: above the line, excluded by the Executive Secretary ("not funded, carried forward") |
 * | | Y-DI-005 | Approval | Not selected | Ekiti: below the funding line (the ceiling covers ranks 1–4) |
 * | | Y-DI-006 | Validation | In progress | Kebbi: essential-facility gap (no water row) open |
 * | | Y-DI-007 | Validation | In progress | Kebbi: possible duplicate of Y-DI-006 (same school) open |
 * | | Y-DI-008 | Validation | Returned | Imo: returned by the M&E officer (enrolment not evidenced) |
 * | | Y-DI-009 | Design | In progress | Cross River: validated, drawings not yet filed |
 * | | Y-DI-010 | Costing | In progress | Adamawa: costed version with an open rate variance (desks +30 %) |
 * | | Y-DI-011 | Identification | Draft | Zamfara: uploaded, not submitted |
 * | | Y-DI-012 | Validation | Not validated | Nasarawa: the State renovated the school (closed) |
 * | | Y-DI-013 | Approval (out of cycle) | In progress | Kogi emergency request (storm), authorising directive filed: waiting for the Executive Secretary |
 * | MG Y Kano (Kano SUBEB) | Y-MG-KN-001, -002 | Funding | In progress | On the Kano BEAP, submitted: in UBEC Physical Planning review (dpp@); costed by kano.dpp@ under authorised separation-of-duties overrides |
 * | | Y-MG-KN-003 | Validation | In progress | Late submission: waiting for the SUBEB's field verification (kano.dpp@) |
 *
 * People: procurement@ uploads and submits, me.officer@ validates, qs@ costs, the Steering Committee
 * (es@ chair, dpp@, finance@, procurement@ recused from its uploads) scores, dpp@ and es@ approve the
 * portfolio (memo filed). The ranking is finalised and the portfolio approved, so Y-DI-001 … 003 wait
 * for the appropriation (the demo pack's appropriated schedule funds them; nothing converts in the
 * seed: earlier route tests assert the project lists). Kano: kano.procurement@ uploads, kano.dpp@
 * verifies and costs (kano.admin@ authorises the overrides), the SUBEB committee (kano.admin@ chair and
 * the three umbrella members) scores, kano.dpp@ reviews and kano.admin@ endorses the portfolio, kano.dpp@
 * builds and submits the BEAP. The pipeline's task emails the services queue are deleted afterwards
 * (they would count against the recipients' daily cap in tests and on the demo day).
 *
 * Tests that open their own cycles start from the wave 4 state (`tests/helpers/needsSeedReset.ts`).
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

  const started = new Date();
  const today = zonedCalendarDate(started, NEEDS_SEED_TZ);
  const openYear = needsOpenYear(today);
  const prg = await prisma.project.findMany({ where: { tenantId: programme.id, codePrefix: { startsWith: "PRG-" } }, select: { id: true }, orderBy: { codePrefix: "asc" } });
  const history = await seedConvertedHistory(programme.id, prg.map((p) => p.id), { today, openYear });
  const t1 = Date.now();
  const live = await seedOpenCycles(programme.id, today, openYear);
  const emails = await prisma.outboundMessage.deleteMany({ where: { tenantId: programme.id, templateKey: "NEEDS_TASK_NOTICE", createdAt: { gte: started } } });

  console.log(
    `   • Needs pipeline (${((Date.now() - started.getTime()) / 1000).toFixed(1)} s; open cycles ${((Date.now() - t1) / 1000).toFixed(1)} s): rules on ${types.length} programme type(s); costing standard v1 (${standard.rates.length} specimen rates); ${history.proposals} converted proposal(s) in ${history.cycles} closed cycle(s); open ${openYear} cycles: Direct Intervention ${live.diCount} proposals (${live.funding.join(", ")} at Funding, waiting for the appropriation), Kano Matching Grants ${live.mgCount} (BEAP in UBEC review); out-of-cycle ${live.outOfCycle} waiting for the Executive Secretary; ${live.verifications} field verification(s) assigned (me.officer@, kano.dpp@: field app); ${emails.count} queued task email(s) dropped. Cycle logins, password Password123!:`
  );
  for (const person of NEEDS_PIPELINE_PEOPLE) {
    const role = NEEDS_PIPELINE_ROLES.find((r) => r.code === person.roleCode)?.name ?? person.roleCode;
    console.log(`     - ${`${role}${person.organization === "KANO_SUBEB" ? ", Kano" : ""}`.padEnd(52)} ${person.email}`);
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient;

/** A short specimen PDF (title, lines, "SPECIMEN – demo data" footer). */
export function needsSpecimenPdf(title: string, lines: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56, info: { Title: title, Author: "Universal Basic Education Commission (specimen)", Creator: "InSite Assurance demo data", CreationDate: new Date("2026-01-01T09:00:00Z") } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(9).fillColor("#555555").text("UNIVERSAL BASIC EDUCATION COMMISSION", { align: "left" });
    doc.moveDown(1.5).fontSize(16).fillColor("#111111").text(title);
    doc.moveDown(1).fontSize(11);
    for (const l of lines) doc.text(l).moveDown(0.6);
    doc.fontSize(8).fillColor("#888888").text("SPECIMEN – demo data", 56, 780, { align: "center" });
    doc.end();
  });
}

/** Stores a specimen PDF in the cycle's document area (where the presigned uploads land); returns the object key. */
async function storePdf(tenantId: string, cycleId: string, title: string, lines: string[]): Promise<string> {
  const stored = await storeTenantAreaBuffer(cycleDocumentPrefix(tenantId, cycleId), `${title}.pdf`, await needsSpecimenPdf(title, lines), "application/pdf");
  return stored.objectKey;
}

const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const round2 = (n: number) => Math.round(n * 100) / 100;

/** `YYYY-MM-DD` at 09:00 Lagos as a Date. */
const at = (iso: string) => new Date(`${iso}T08:00:00Z`);

// ---------------------------------------------------------------------------
// M2: converted proposals in closed cycles (history)
// ---------------------------------------------------------------------------

const ESSENTIAL_CODES = new Set(["TOILET", "BOREHOLE", "OVERHEAD_TANK", "SOLAR_POWER"]);
const ARCHETYPE_BY_CODE = new Map(DEFAULT_FACILITIES.map((f) => [f.code, f.archetype]));

const PROJECT_FOR_HISTORY = {
  id: true,
  name: true,
  codePrefix: true,
  status: true,
  interventionYear: true,
  stateCode: true,
  lgaCode: true,
  stateLocation: true,
  lgaLocation: true,
  totalBudgetNgn: true,
  strategicJustification: true,
  assumptions: true,
  geofenceGeoJson: true,
  importedAt: true,
  needsProposalId: true,
  batchNumber: true,
  region: { select: { name: true } },
  lot: { select: { number: true, title: true } },
  projectType: { select: { id: true, code: true, configJson: true } },
  beneficiaries: { select: { name: true, isPrimary: true } },
  sites: { orderBy: { siteNumber: "asc" } },
  facilityUnits: { orderBy: [{ sortOrder: "asc" }, { code: "asc" }], include: { facility: { select: { code: true, name: true } } } },
  boqItems: { orderBy: { wbsCode: "asc" } },
} satisfies Prisma.ProjectSelect;
type HistoryProject = Prisma.ProjectGetPayload<{ select: typeof PROJECT_FOR_HISTORY }>;

function projectStateCode(p: HistoryProject): string {
  return (p.stateCode && findStateByName(p.stateCode)?.code) ?? findStateByName(p.region?.name)?.code ?? findStateByName(p.stateLocation)?.code ?? "FC";
}

/** The project as its needs assessment would have read: sites, one breakdown row per unit, its BoQ, the costing summary. */
function parsedFromProject(p: HistoryProject, programme: "DI" | "MG", stateCode: string, year: number): ParsedNeedsAssessment {
  const budget = Number(p.totalBudgetNgn ?? 0) || 50_000_000;
  const lgaCode = (p.lgaCode && findLgaByName(stateCode, p.lgaCode)?.code) ?? findLgaByName(stateCode, p.lgaLocation)?.code ?? lgasOfState(stateCode)[0].code;
  const geofence = p.geofenceGeoJson as { mode?: string; center?: { latitude: number; longitude: number } } | null;
  const school = p.beneficiaries.find((b) => b.isPrimary)?.name ?? p.name;
  const sites = p.sites.length
    ? p.sites.map((s) => ({ siteNumber: s.siteNumber, schoolName: s.schoolName, schoolLevel: s.schoolLevel, lgaCode: s.lgaCode, address: s.address, latitude: s.latitude, longitude: s.longitude, enrolment: null }))
    : [
        {
          siteNumber: 1,
          schoolName: school.slice(0, 200),
          schoolLevel: "PRIMARY",
          lgaCode,
          address: null,
          latitude: geofence?.mode === "RADIAL" ? (geofence.center?.latitude ?? null) : null,
          longitude: geofence?.mode === "RADIAL" ? (geofence.center?.longitude ?? null) : null,
          enrolment: null,
        },
      ];
  const siteNumberOf = new Map(p.sites.map((s) => [s.id, s.siteNumber]));
  const units = p.facilityUnits.length
    ? p.facilityUnits.map((u, i) => ({
        unitId: /^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/.test(u.code) ? u.code.toUpperCase() : `U${String(i + 1).padStart(2, "0")}`,
        id: u.id,
        siteNumber: (u.siteId && siteNumberOf.get(u.siteId)) || 1,
        facilityCode: u.facility.code,
        label: u.label,
        quantity: u.plannedQuantity ? Number(u.plannedQuantity) : 1,
        unit: normalizeUnitOfMeasure(u.quantityUnit) ?? "nr",
      }))
    : [
        {
          unitId: "U01",
          id: null as string | null,
          siteNumber: 1,
          facilityCode: /toilet|wash|borehole/i.test(p.name) ? (/borehole/i.test(p.name) ? "BOREHOLE" : "TOILET") : "CLASSROOM",
          label: p.name.slice(0, 160),
          quantity: 1,
          unit: "nr" as const,
        },
      ];
  const unitOf = new Map(units.filter((u) => u.id).map((u) => [u.id as string, u.unitId]));
  let boqLines = p.boqItems
    .filter((b) => Number(b.totalQuantity) > 0)
    .map((b) => {
      const qty = Number(b.totalQuantity);
      const rate = Number(b.rateNgn ?? 0);
      return {
        wbsCode: b.wbsCode.slice(0, 32),
        unitId: (b.facilityUnitId && unitOf.get(b.facilityUnitId)) || units[0].unitId,
        itemCode: null,
        description: b.description.length >= 3 ? b.description.slice(0, 600) : `${b.description} works`,
        unit: normalizeUnitOfMeasure(b.unit) ?? "item",
        totalQuantity: qty,
        rateNgn: rate,
        amountNgn: round2(qty * rate),
      };
    });
  if (!boqLines.length) {
    const rate = round2(budget / 1.1);
    boqLines = [{ wbsCode: "1.01", unitId: units[0].unitId, itemCode: null, description: "Works to the approved scope", unit: "LS", totalQuantity: 1, rateNgn: rate, amountNgn: rate }];
  }
  const subtotal = round2(boqLines.reduce((s, l) => s + l.amountNgn, 0));
  const sm = round2(subtotal * 0.05);
  const contingency = round2(subtotal * 0.05);
  return ParsedNeedsAssessmentSchema.parse({
    templateVersion: NEEDS_TEMPLATE_VERSION,
    costingStandardVersion: 1,
    project: {
      title: p.name.slice(0, 300),
      programme: programme === "DI" ? "Direct Intervention" : "Matching Grants",
      interventionYear: year,
      stateCode,
      justification: p.strategicJustification ?? `Needs identified at ${school}.`,
      assumptions: p.assumptions,
      beneficiaries: null,
      estimatedDurationMonths: 9,
    },
    sites,
    breakdownRows: units.map((u) => ({
      unitId: u.unitId,
      siteNumber: u.siteNumber,
      facilityCode: u.facilityCode,
      interventionAction: ARCHETYPE_BY_CODE.get(u.facilityCode) === "SUPPLY_INSTALLATION" ? (/furniture/i.test(u.facilityCode) ? "FURNISHING" : "EQUIPPING") : "NEW_CONSTRUCTION",
      existingQuantity: 0,
      existingCondition: "ABSENT",
      requiredQuantity: u.quantity,
      proposedQuantity: u.quantity,
      unitOfMeasure: u.unit,
      preliminaryCostNgn: round2(boqLines.filter((l) => l.unitId === u.unitId).reduce((s, l) => s + l.amountNgn, 0)) || null,
      technicalJustification: u.label || "Identified at the needs assessment.",
      criticality: ESSENTIAL_CODES.has(u.facilityCode) ? "ESSENTIAL" : "HIGH",
    })),
    boqLines,
    costingSummary: { subtotalNgn: subtotal, supervisionMonitoringPct: 5, supervisionMonitoringNgn: sm, contingencyPct: 5, contingencyNgn: contingency, totalNgn: round2(subtotal + sm + contingency) },
  });
}

interface HistoryContext {
  tenantId: string;
  today: string;
  openYear: number;
  standardId: string;
  facilities: Awaited<ReturnType<typeof workbookFacilities>>;
  users: Record<"procurement" | "dpp" | "es" | "kanoProcurement" | "kanoDpp" | "kanoAdmin" | "lagosAdmin" | "admin", { userId: string; fullName: string; organizationId: string | null }>;
}

async function historyUsers() {
  const pick = async (email: string) => {
    const u = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true, fullName: true, organizationId: true } });
    return { userId: u.id, fullName: u.fullName, organizationId: u.organizationId };
  };
  return {
    procurement: await pick(PROCUREMENT_EMAIL),
    dpp: await pick(DPP_EMAIL),
    es: await pick(ES_EMAIL),
    kanoProcurement: await pick(KANO_PROCUREMENT_EMAIL),
    kanoDpp: await pick(KANO_DPP_EMAIL),
    kanoAdmin: await pick(KANO_ADMIN_EMAIL),
    lagosAdmin: await pick(LAGOS_ADMIN_EMAIL),
    admin: await pick(UBEC_ADMIN_EMAIL),
  };
}

/** The State's people for a closed Matching Grants cycle (Kano and Lagos have seeded logins; others the UBEC admin). */
function stateUploader(ctx: HistoryContext, programme: "DI" | "MG", stateCode: string) {
  if (programme === "DI") return ctx.users.procurement;
  if (stateCode === "KN") return ctx.users.kanoProcurement;
  if (stateCode === "LA") return ctx.users.lagosAdmin;
  return ctx.users.admin;
}

/**
 * M2/M3: gives each project (ids) origin NEEDS_PIPELINE and a CONVERTED proposal in a CLOSED cycle of its
 * intervention year (created when missing). A Direct Intervention project of the open year or later (the
 * overlay's 2027 draft) becomes an approved out-of-cycle request in the open cycle instead (a draft of that
 * year can only come from that route before the appropriation). Projects imported from the register keep
 * origin REGISTER_IMPORT; a Matching Grants project of the open year (none today) stays as it is.
 */
export async function seedConvertedHistory(tenantId: string, projectIds: string[], opts: { today: string; openYear: number }): Promise<{ cycles: number; proposals: number; outOfCycle: number }> {
  const standard = await prisma.costingStandardVersion.findFirstOrThrow({ where: { tenantId, version: 1 } });
  const ctx: HistoryContext = { tenantId, today: opts.today, openYear: opts.openYear, standardId: standard.id, facilities: await workbookFacilities(tenantId), users: await historyUsers() };
  const projects = await prisma.project.findMany({ where: { id: { in: projectIds }, tenantId }, select: PROJECT_FOR_HISTORY, orderBy: [{ interventionYear: "asc" }, { codePrefix: "asc" }] });
  const cycles = new Map<string, { id: string; sequence: number; config: NeedsPipelineConfig; programme: "DI" | "MG"; year: number; stateCode: string | null; items: Array<{ proposalId: string; amount: number; project: HistoryProject }> }>();
  let proposals = 0;
  let outOfCycle = 0;

  for (const p of projects) {
    if (p.needsProposalId) continue;
    if (p.importedAt) {
      await prisma.project.update({ where: { id: p.id }, data: { origin: "REGISTER_IMPORT" } });
      continue;
    }
    if (!p.projectType) continue;
    const programme = p.projectType.code === "CO_FUNDED" ? "MG" : "DI";
    const config = NeedsPipelineConfigSchema.parse(ProjectTypeConfigSchema.parse(p.projectType.configJson).needsPipeline);
    if (!config.enabled) continue;
    const stateCode = projectStateCode(p);
    const year = p.interventionYear ?? opts.openYear - 2;
    if (year >= opts.openYear) {
      if (programme === "DI" && (await convertedOutOfCycle(ctx, p, stateCode, year))) outOfCycle += 1;
      continue;
    }
    const scopeKey = programme === "MG" ? stateCode : "NATIONAL";
    const key = `${p.projectType.id}|${year}|${scopeKey}`;
    let cycle = cycles.get(key);
    if (!cycle) {
      const existing = await prisma.needsCycle.findUnique({ where: { tenantId_projectTypeId_interventionYear_scopeKey: { tenantId, projectTypeId: p.projectType.id, interventionYear: year, scopeKey } } });
      if (existing) {
        cycle = { id: existing.id, sequence: existing.proposalSequence, config, programme, year, stateCode: programme === "MG" ? stateCode : null, items: [] };
      } else {
        const owner =
          (await deriveCycleOwnerId(prisma, tenantId, p.projectType, programme === "MG" ? "STATE" : "NATIONAL", programme === "MG" ? stateCode : null)) ??
          ctx.users.dpp.organizationId!;
        const opener = programme === "DI" ? ctx.users.dpp : stateCode === "KN" ? ctx.users.kanoDpp : ctx.users.admin;
        const closedOn = [`${year}-03-31`, ctx.today].sort()[0];
        const created = await prisma.needsCycle.create({
          data: {
            tenantId,
            projectTypeId: p.projectType.id,
            interventionYear: year,
            stateCode: programme === "MG" ? stateCode : null,
            scopeKey,
            owningOrganizationId: owner,
            status: "CLOSED",
            configSnapshotJson: config as unknown as Prisma.InputJsonValue,
            deadlinesJson: cycleDeadlines(config, year) as unknown as Prisma.InputJsonValue,
            templateVersion: NEEDS_TEMPLATE_VERSION,
            costingStandardVersionId: standard.id,
            rankingFinalisedAt: at(`${year - 1}-10-21`),
            rankingFinalisedByUserId: ctx.users.es.userId,
            rankingFinalisedByName: programme === "DI" ? ctx.users.es.fullName : "Steering Committee chair",
            scoringOpenedAt: at(`${year - 1}-10-15`),
            scoringClosedAt: at(`${year - 1}-10-20`),
            createdByUserId: opener.userId,
            openedAt: at(`${year - 1}-${programme === "DI" ? "03-01" : "07-31"}`),
            openedByUserId: opener.userId,
            openedByName: opener.fullName,
            closedAt: at(closedOn),
            closedByUserId: opener.userId,
            closedByName: opener.fullName,
          },
        });
        cycle = { id: created.id, sequence: 0, config, programme, year, stateCode: programme === "MG" ? stateCode : null, items: [] };
      }
      cycles.set(key, cycle);
    }
    cycle.sequence += 1;
    const proposalId = await writeConvertedProposal(ctx, cycle, p, stateCode, "ANNUAL");
    cycle.items.push({ proposalId, amount: Number(p.totalBudgetNgn ?? 0), project: p });
    proposals += 1;
  }

  for (const cycle of cycles.values()) {
    await prisma.needsCycle.update({ where: { id: cycle.id }, data: { proposalSequence: cycle.sequence, fundingLinePosition: cycle.sequence } });
    if (cycle.programme === "MG" && cycle.items.length) await writeApprovedBeap(ctx, cycle);
  }
  return { cycles: cycles.size, proposals, outOfCycle };
}

/** One CONVERTED proposal (annual: Funding; out of cycle: Approval) with its version file, sites and rows, linked to the project. */
async function writeConvertedProposal(
  ctx: HistoryContext,
  cycle: { id: string; sequence: number; config: NeedsPipelineConfig; programme: "DI" | "MG"; year: number; stateCode: string | null },
  p: HistoryProject,
  stateCode: string,
  route: "ANNUAL" | "OUT_OF_CYCLE",
  outOfCycle?: { reason: string; details: string; authorise: (proposalId: string) => Promise<string> }
): Promise<string> {
  const reference = formatProposalReference({ interventionYear: cycle.year, prefix: cycle.config.referencePrefix, stateCode: cycle.config.cycleScope === "STATE" ? cycle.stateCode : null, sequence: cycle.sequence });
  const parsed = parsedFromProject(p, cycle.programme, stateCode, cycle.year);
  const { buffer, fileName } = await buildNeedsWorkbook({
    tenantShortName: "UBEC",
    programmeName: cycle.programme === "DI" ? "Direct Intervention" : "Matching Grants",
    interventionYear: cycle.year,
    stateCode: cycle.stateCode,
    costingStandard: { version: 1, standard: CostingStandardSchema.parse(DEFAULT_COSTING_STANDARD) },
    facilities: ctx.facilities,
    prefill: parsed,
    proposalReference: reference,
  });
  const file = await storeTenantAreaBuffer(cycleVersionPrefix(ctx.tenantId, cycle.id), fileName, buffer, XLSX_CONTENT_TYPE);
  const uploader = stateUploader(ctx, cycle.programme, stateCode);
  const budget = Number(p.totalBudgetNgn ?? 0) || parsed.costingSummary!.totalNgn;
  const uploadedOn = at(`${cycle.year - 1}-${cycle.programme === "DI" ? "05-12" : "08-20"}`);
  const rank = cycle.sequence;
  const score = Math.max(55, 88 - rank * 3);
  const proposalId = await prisma.$transaction(async (tx: Tx) => {
    const proposal = await tx.needsProposal.create({
      data: {
        tenantId: ctx.tenantId,
        cycleId: cycle.id,
        reference,
        sequence: cycle.sequence,
        title: p.name.slice(0, 300),
        route,
        outOfCycleReason: outOfCycle?.reason ?? null,
        outOfCycleDetails: outOfCycle?.details ?? null,
        stage: route === "ANNUAL" ? "FUNDING" : "APPROVAL",
        status: "CONVERTED",
        stateCode,
        lgaCodes: [...new Set(parsed.sites.map((s) => s.lgaCode))],
        preliminaryAmountNgn: parsed.costingSummary!.totalNgn,
        costedAmountNgn: parsed.costingSummary!.totalNgn,
        approvedAmountNgn: budget,
        fundedAmountNgn: budget,
        ...(route === "ANNUAL" ? { scoreImpact: score + 2, scoreEase: score - 3, scoreTotal: score, rank, aboveLine: true } : {}),
        createdByUserId: uploader.userId,
        createdByName: uploader.fullName,
        createdAt: uploadedOn,
      },
    });
    const version = await tx.needsAssessmentVersion.create({
      data: {
        proposalId: proposal.id,
        number: 1,
        source: "UPLOAD",
        objectKey: file.objectKey,
        fileName: file.fileName,
        mimeType: XLSX_CONTENT_TYPE,
        byteSize: file.byteSize,
        sha256: file.sha256,
        templateVersion: NEEDS_TEMPLATE_VERSION,
        costingStandardVersionId: ctx.standardId,
        parsedJson: parsed as unknown as Prisma.InputJsonValue,
        siteCount: parsed.sites.length,
        breakdownRowCount: parsed.breakdownRows.length,
        boqLineCount: parsed.boqLines.length,
        preliminaryCostNgn: parsed.costingSummary!.totalNgn,
        costedTotalNgn: parsed.costingSummary!.totalNgn,
        uploadedByUserId: uploader.userId,
        uploadedByName: uploader.fullName,
        uploadedAt: uploadedOn,
      },
    });
    await replaceCurrentTables(tx, proposal.id, parsed);
    await tx.needsProposal.update({ where: { id: proposal.id }, data: { currentVersionId: version.id } });
    await tx.project.update({ where: { id: p.id }, data: { origin: route === "ANNUAL" ? "NEEDS_PIPELINE" : "OUT_OF_CYCLE", needsProposalId: proposal.id } });
    return proposal.id;
  });
  if (outOfCycle) await prisma.needsProposal.update({ where: { id: proposalId }, data: { authorisingDocumentId: await outOfCycle.authorise(proposalId) } });
  return proposalId;
}

/** A closed Matching Grants cycle's approved BEAP (narrative and counterpart evidence filed), so its drafts pass the A5 gate. */
async function writeApprovedBeap(ctx: HistoryContext, cycle: { id: string; year: number; stateCode: string | null; items: Array<{ proposalId: string; amount: number; project: HistoryProject }> }) {
  const preparer = cycle.stateCode === "KN" ? ctx.users.kanoDpp : cycle.stateCode === "LA" ? ctx.users.lagosAdmin : ctx.users.admin;
  const total = cycle.items.reduce((s, i) => s + i.amount, 0);
  const doc = async (kind: CycleDocumentKind, title: string, lines: string[]) => {
    const pdf = await needsSpecimenPdf(title, lines);
    const stored = await storeTenantAreaBuffer(cycleDocumentPrefix(ctx.tenantId, cycle.id), `${title}.pdf`, pdf, "application/pdf");
    const row = await prisma.needsCycleDocument.create({
      data: {
        cycleId: cycle.id,
        kind,
        title,
        objectKey: stored.objectKey,
        fileName: stored.fileName,
        mimeType: "application/pdf",
        byteSize: stored.byteSize,
        sha256: stored.sha256,
        coveredProposalIds: cycle.items.map((i) => i.proposalId),
        uploadedByUserId: preparer.userId,
        uploadedByName: preparer.fullName,
        createdAt: at(`${cycle.year - 1}-11-15`),
      },
    });
    return row.id;
  };
  const state = findStateByName(cycle.stateCode)?.name ?? cycle.stateCode;
  const narrative = await doc("BEAP", `${state} BEAP ${cycle.year}`, [`Basic Education Action Plan for ${cycle.year}: ${cycle.items.length} project(s).`, `Total NGN ${total.toLocaleString("en-NG")}.`]);
  const evidence = await doc("COUNTERPART_EVIDENCE", `${state} counterpart funds ${cycle.year}`, [`Evidence of the State's counterpart contribution for ${cycle.year}.`]);
  await prisma.needsSubmission.create({
    data: {
      cycleId: cycle.id,
      kind: "BEAP",
      status: "APPROVED",
      currentStepOrder: null,
      submittedByUserId: preparer.userId,
      submittedByName: preparer.fullName,
      submittedAt: at(`${cycle.year - 1}-11-15`),
      decidedAt: at(`${cycle.year - 1}-11-30`),
      narrativeDocumentId: narrative,
      counterpartDeclaredNgn: round2(total / 2),
      counterpartEvidenceDocumentId: evidence,
      counterpartRecordedAt: at(`${cycle.year - 1}-11-15`),
      counterpartRecordedByUserId: preparer.userId,
      counterpartRecordedByName: preparer.fullName,
      createdByUserId: preparer.userId,
      createdByName: preparer.fullName,
      createdAt: at(`${cycle.year - 1}-11-10`),
      items: {
        create: cycle.items.map((i, k) => ({
          proposalId: i.proposalId,
          included: true,
          amountNgn: i.amount,
          lotTitle: i.project.lot?.title ?? `${state} ${cycle.year} classrooms and WASH`,
          lotNumber: i.project.lot?.number ?? 1,
          batchNumber: i.project.batchNumber ?? k + 1,
          procurementMethod: "OPEN_COMPETITIVE_BIDDING",
          plannedStartDate: `${cycle.year}-02-01`,
          plannedEndDate: `${cycle.year}-10-31`,
          reviewOutcome: "ACCEPTED",
          sortOrder: k,
        })),
      },
    },
  });
}

/**
 * A Direct Intervention draft of the open year (the overlay's #11): an approved out-of-cycle request
 * (carry-over of an appropriated project) in the open cycle, converted to that draft. Its submission is
 * APPROVED by the Executive Secretary at the cycle's out-of-cycle step.
 */
async function convertedOutOfCycle(ctx: HistoryContext, p: HistoryProject, stateCode: string, year: number): Promise<boolean> {
  const cycleRow = await prisma.needsCycle.findFirst({ where: { tenantId: ctx.tenantId, projectTypeId: p.projectType!.id, interventionYear: year, scopeKey: "NATIONAL" } });
  if (!cycleRow) return false;
  const config = NeedsPipelineConfigSchema.parse(cycleRow.configSnapshotJson);
  const sequence = cycleRow.proposalSequence + 1;
  await prisma.needsCycle.update({ where: { id: cycleRow.id }, data: { proposalSequence: sequence } });
  const requester = ctx.users.procurement;
  const proposalId = await writeConvertedProposal(ctx, { id: cycleRow.id, sequence, config, programme: "DI", year, stateCode: null }, p, stateCode, "OUT_OF_CYCLE", {
    reason: "CARRY_OVER_APPROPRIATED",
    details: `Appropriated in ${year - 1} but not awarded before the year closed; carried into ${year} to keep the funds.`,
    authorise: async (id) => {
      const title = `Executive Secretary approval to carry over ${p.name.slice(0, 80)}`;
      const pdf = await needsSpecimenPdf(title, [`Carry-over of an appropriated project into ${year}.`]);
      const stored = await storeTenantAreaBuffer(cycleDocumentPrefix(ctx.tenantId, cycleRow.id), `${title}.pdf`, pdf, "application/pdf");
      const doc = await prisma.needsProposalDocument.create({
        data: { proposalId: id, kind: "AUTHORISING_DOCUMENT", title, objectKey: stored.objectKey, fileName: stored.fileName, mimeType: "application/pdf", byteSize: stored.byteSize, sha256: stored.sha256, uploadedByUserId: requester.userId, uploadedByName: requester.fullName },
      });
      return doc.id;
    },
  });
  const step = await prisma.needsApprovalStep.findFirst({ where: { cycleId: cycleRow.id, chainType: "OUT_OF_CYCLE", isActive: true }, orderBy: [{ version: "desc" }, { stepOrder: "asc" }] });
  const decidedAt = at([`${year - 1}-10-02`, ctx.today].sort()[0]);
  const submission = await prisma.needsSubmission.create({
    data: {
      cycleId: cycleRow.id,
      kind: "OUT_OF_CYCLE",
      status: "APPROVED",
      chainVersion: step?.version ?? 1,
      currentStepOrder: null,
      submittedByUserId: requester.userId,
      submittedByName: requester.fullName,
      submittedAt: decidedAt,
      decidedAt,
      createdByUserId: requester.userId,
      createdByName: requester.fullName,
      items: { create: [{ proposalId, included: true, amountNgn: Number(p.totalBudgetNgn ?? 0), sortOrder: 0 }] },
    },
  });
  if (step) {
    await prisma.needsApprovalAction.create({
      data: { cycleId: cycleRow.id, chainType: "OUT_OF_CYCLE", subjectId: submission.id, stepId: step.id, stepOrder: step.stepOrder, decision: "APPROVE", actorUserId: ctx.users.es.userId, notes: "Carry-over approved.", createdAt: decidedAt },
    });
  }
  return true;
}

/**
 * M3 (overlay): the overlay re-codes, relocates and re-years the projects, so the normal seed's history
 * no longer matches them. Removes the closed cycles (their proposals, versions, BEAPs and documents go
 * with them; projects keep their origin, the proposal link is cleared) so `seedConvertedHistory` can
 * write them again from the overlay's projects. Open cycles stay.
 */
export async function clearConvertedHistory(tenantId: string): Promise<void> {
  const closed = await prisma.needsCycle.findMany({ where: { tenantId, status: "CLOSED" }, select: { id: true } });
  const ids = closed.map((c) => c.id);
  if (!ids.length) return;
  await prisma.needsApprovalAction.deleteMany({ where: { cycleId: { in: ids } } });
  await prisma.project.updateMany({ where: { tenantId, needsProposal: { cycleId: { in: ids } } }, data: { needsProposalId: null } });
  await prisma.needsProposal.updateMany({ where: { cycleId: { in: ids } }, data: { currentVersionId: null, carriedFromId: null, mergedIntoId: null } });
  await prisma.needsCycle.deleteMany({ where: { id: { in: ids } } });
}

// ---------------------------------------------------------------------------
// M1: the open cycles, through the services
// ---------------------------------------------------------------------------

interface LiveContext {
  tenantId: string;
  today: string;
  year: number;
  facilities: Awaited<ReturnType<typeof workbookFacilities>>;
  u: Record<string, WebJwtPayload>;
}

async function upload(c: LiveContext, user: WebJwtPayload, cycleId: string, programme: "DI" | "MG", files: Array<{ spec: NeedsFileSpec; proposalId: string | null; fileName: string }>) {
  const ctx = seedFileContext(programme, c.year, c.facilities);
  const built = [];
  for (const f of files) {
    const buffer = await buildNeedsFile(f.spec, ctx);
    built.push({ fileName: f.fileName, fileBase64: buffer.toString("base64"), proposalId: f.proposalId, sha256: sha256(buffer) });
  }
  const result = await confirmUpload(user, cycleId, NeedsUploadConfirmRequestSchema.parse({ files: built }));
  const refused = result.files.filter((f) => f.outcome === "REFUSED");
  if (refused.length) throw new Error(`Needs seed: upload refused: ${JSON.stringify(refused.map((f) => [f.fileName, f.issues.slice(0, 3)]))}`);
  return result;
}

async function proposalDoc(c: LiveContext, user: WebJwtPayload, cycleId: string, proposalId: string, kind: ProposalDocumentKind, title: string, lines: string[]) {
  const objectKey = await storePdf(c.tenantId, cycleId, title, lines);
  return (await registerProposalDocument(user, proposalId, RegisterProposalDocumentRequestSchema.parse({ objectKey, kind, title }))).id;
}

async function openFlag(proposalId: string, kind: ProposalFlagKind) {
  return prisma.needsProposalFlag.findFirst({ where: { proposalId, kind, resolvedAt: null } });
}

async function seedOpenCycles(tenantId: string, today: string, year: number) {
  const emails = {
    dpp: DPP_EMAIL,
    es: ES_EMAIL,
    finance: FINANCE_EMAIL,
    procurement: PROCUREMENT_EMAIL,
    qs: QS_EMAIL,
    me: UBEC_ME_EMAIL,
    kanoDpp: KANO_DPP_EMAIL,
    kanoProcurement: KANO_PROCUREMENT_EMAIL,
    kanoAdmin: KANO_ADMIN_EMAIL,
    c1: KANO_COMMITTEE_EMAILS[0],
    c2: KANO_COMMITTEE_EMAILS[1],
    c3: KANO_COMMITTEE_EMAILS[2],
  };
  const u: Record<string, WebJwtPayload> = {};
  for (const [k, email] of Object.entries(emails)) u[k] = await payloadFor(email);
  const c: LiveContext = { tenantId, today, year, facilities: await workbookFacilities(tenantId), u };
  const di = await seedDiCycle(c);
  const outOfCycle = await seedOutOfCycleRequest(c, di.typeId);
  const mg = await seedKanoCycle(c);
  const verifications = await seedFieldVerifications(c);
  return { diCount: di.count, funding: di.funding, mgCount: mg.count, outOfCycle, verifications };
}

/**
 * Wave 5 (N8, main thread): two field verifications ASSIGNED through the real service, so both phones
 * have work on the demo day: me.officer@ on the DI proposal whose essential-facility gap is still open
 * (Y-DI-006, due in 3 days), kano.dpp@ on the late Kano proposal (Y-MG-KN-003, due in 5 days).
 */
async function seedFieldVerifications(c: LiveContext): Promise<number> {
  const plan = [
    { reference: diReference(c.year, 6), by: c.u.me, officerEmail: UBEC_ME_EMAIL, days: 3, instructions: "Confirm the water source and the toilet block at each school; record the location at the school gate." },
    { reference: mgReference(c.year, 3), by: c.u.kanoDpp, officerEmail: KANO_DPP_EMAIL, days: 5, instructions: "Field verification before costing: count the classrooms and check their condition." },
  ];
  let count = 0;
  for (const v of plan) {
    const proposal = await prisma.needsProposal.findFirst({ where: { tenantId: c.tenantId, reference: v.reference }, select: { id: true, stage: true, status: true } });
    if (!proposal || proposal.stage !== "VALIDATION" || proposal.status !== "IN_PROGRESS") throw new Error(`Needs seed: ${v.reference} is not waiting for validation`);
    const officer = await prisma.user.findFirstOrThrow({ where: { tenantId: c.tenantId, email: v.officerEmail }, select: { id: true } });
    await assignVerification(
      v.by,
      proposal.id,
      AssignNeedsVerificationRequestSchema.parse({ purpose: "VALIDATION", officerUserId: officer.id, dueDate: addCalendarDays(c.today, v.days), siteNumbers: [], instructions: v.instructions })
    );
    count += 1;
  }
  return count;
}

async function seedDiCycle(c: LiveContext) {
  const { u, year } = c;
  const type = await prisma.projectType.findFirstOrThrow({ where: { tenantId: c.tenantId, code: "CENTRAL" } });
  const cycle = await openCycle(u.dpp, { projectTypeId: type.id, interventionYear: year, stateCode: null, indicativeCeilingNgn: null, deadlines: [], carryForwardProposalIds: [] });
  const cycleId = cycle.id;
  const summaryKey = await storePdf(c.tenantId, cycleId, `Stakeholder engagement summary ${year}`, [
    `Direct Intervention ${year}: stakeholder engagement with the SUBEBs, LGEAs and school-based management committees.`,
    "Needs identified from monitoring findings, State requests and field visits.",
  ]);
  await registerCycleDocument(u.dpp, cycleId, RegisterCycleDocumentRequestSchema.parse({ objectKey: summaryKey, kind: "STAKEHOLDER_ENGAGEMENT_SUMMARY", title: `Stakeholder engagement summary ${year}` }));

  // Identification: procurement@ uploads the twelve needs assessments (references 001 … 012, in order).
  const specs = diSeedProposals(year);
  await upload(c, u.procurement, cycleId, "DI", specs.map((p) => ({ spec: p.spec, proposalId: null, fileName: `${p.spec.project.title}.xlsx` })));
  const rows = await prisma.needsProposal.findMany({ where: { cycleId }, orderBy: { sequence: "asc" }, select: { id: true, reference: true, sequence: true } });
  const id = (n: number) => {
    const r = rows.find((x) => x.reference === diReference(year, n));
    if (!r) throw new Error(`Needs seed: ${diReference(year, n)} was not created`);
    return r.id;
  };
  const toDesign = [1, 2, 3, 4, 5, 9, 10];
  const toCosting = [1, 2, 3, 4, 5, 10];
  const ranked = [1, 2, 3, 4, 5];

  // Drawings (Design's minimum field the file cannot carry), then submitted to Validation (011 stays a draft).
  for (const n of toCosting) await proposalDoc(c, u.procurement, cycleId, id(n), "DRAWING", `Standard drawings, ${diReference(year, n)}`, ["UBEC standard classroom, toilet and borehole drawings, adapted to the site."]);
  const submitted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12];
  await applyProposalActions(u.procurement, cycleId, ProposalBatchActionRequestSchema.parse({ action: "SUBMIT", proposalIds: submitted.map(id) }));

  // Validation (me.officer@): desk review and site verification evidence.
  const verifiedOn = [`${year - 1}-07-18`, c.today].sort()[0];
  for (const n of [...toDesign, 12]) {
    const evidence = await proposalDoc(c, u.me, cycleId, id(n), "SITE_VERIFICATION_EVIDENCE", `Site verification report, ${diReference(year, n)}`, [
      "Sites visited with the LGEA desk officer; needs confirmed against the school census.",
    ]);
    const flagResolutions = [];
    if (n === 1) {
      const gap = await openFlag(id(1), "ESSENTIAL_FACILITY_GAP");
      if (gap) flagResolutions.push({ flagId: gap.id, resolution: "JUSTIFIED", reason: "Site 1 draws water from the community hand pump 600 m away until the State borehole programme reaches it; the toilet block is the school's first priority." });
    }
    await recordValidation(
      u.me,
      id(n),
      RecordValidationRequestSchema.parse({
        outcome: n === 12 ? "NOT_VALIDATED" : "ADVANCE",
        deskNotes: n === 12 ? "The State renovated these classrooms in 2026 (SUBEB works completion report seen on site)." : "Needs confirmed against the school census and the LGEA's records.",
        siteVerification: { method: "WEB_EVIDENCE", verifiedOn, officerName: "Ngozi Eze", notes: "Site visited with the head teacher.", evidenceDocumentIds: [evidence] },
        flagResolutions,
      })
    );
  }
  await decideStage(
    u.me,
    cycleId,
    StageDecisionRequestSchema.parse({
      stage: "VALIDATION",
      reason: "M&E validation meeting",
      items: [
        ...toDesign.map((n) => ({ proposalId: id(n), outcome: "ADVANCE" })),
        { proposalId: id(8), outcome: "RETURN", reason: "The enrolment figures are not evidenced: attach the school census return and resubmit." },
        { proposalId: id(12), outcome: "NOT_VALIDATED", reason: "The State renovated the school in 2026; no need remains." },
      ],
    })
  );

  // Needs assessment completion (Design): the files already carry the BoQ; with the drawings filed they go to Costing (009 waits for its drawings).
  await applyProposalActions(u.procurement, cycleId, ProposalBatchActionRequestSchema.parse({ action: "SUBMIT", proposalIds: toCosting.map(id) }));

  // Costing (qs@): costed versions; ceilings and the Jos desk rate acknowledged; 010's variance left open.
  await upload(
    c,
    u.qs,
    cycleId,
    "DI",
    toCosting.map((n) => {
      const p = specs.find((s) => s.n === n)!;
      return { spec: diCostedSpec(p), proposalId: id(n), fileName: `${diReference(year, n)} costed.xlsx` };
    })
  );
  for (const n of ranked) {
    const flags = await prisma.needsProposalFlag.findMany({ where: { proposalId: id(n), resolvedAt: null, kind: { in: ["RATE_VARIANCE", "CEILING_EXCEEDED"] } } });
    if (!flags.length) continue;
    await resolveProposalFlags(
      u.qs,
      id(n),
      ResolveProposalFlagsRequestSchema.parse({
        resolutions: flags.map((f) => ({
          flagId: f.id,
          resolution: "ACKNOWLEDGED",
          reason: f.kind === "RATE_VARIANCE" ? "Desks priced at the State market rate (three quotes on file)." : "Facilities sized for the enrolment (8-cubicle toilet block, 80 m borehole with reticulation); above the per-unit ceiling, accepted.",
        })),
      })
    );
  }
  await decideStage(u.qs, cycleId, StageDecisionRequestSchema.parse({ stage: "COSTING", reason: "Costing signed off", items: ranked.map((n) => ({ proposalId: id(n), outcome: "ADVANCE" })) }));

  // Prioritisation: the Steering Committee (es@ chair; procurement@ is recused from what it uploaded).
  const userIdOf = (k: string) => u[k].userId;
  await setCommittee(u.es, cycleId, SetCommitteeRequestSchema.parse({ members: [{ userId: userIdOf("es"), role: "CHAIR" }, ...["dpp", "finance", "procurement"].map((k) => ({ userId: userIdOf(k), role: "MEMBER" }))] }));
  for (const k of ["es", "dpp", "finance", "procurement"]) await declareConflicts(u[k], cycleId, ConflictDeclarationRequestSchema.parse({ hasConflict: false }));
  await changeScoring(u.es, cycleId, { action: "OPEN" });
  const config = NeedsPipelineConfigSchema.parse((await prisma.needsCycle.findUniqueOrThrow({ where: { id: cycleId } })).configSnapshotJson);
  const keys = config.rubric.criteria.map((cr) => cr.key);
  const sheet = (v: number, except: Record<string, number> = {}) => Object.fromEntries(keys.map((k) => [k, except[k] ?? v]));
  const scores: Array<[string, number, Record<string, number>]> = [
    ["es", 1, sheet(5)],
    ["dpp", 1, sheet(5)],
    ["finance", 1, sheet(4, { [keys[0]]: 5 })],
    ["es", 2, sheet(4, { [keys[1]]: 5 })],
    ["dpp", 2, sheet(4)],
    ["finance", 2, sheet(4)],
    // The divergence (D-N.10): es@ and dpp@ differ by 2 points on the first sub-criterion.
    ["es", 3, sheet(4)],
    ["dpp", 3, sheet(4, { [keys[0]]: 2 })],
    ["finance", 3, sheet(4)],
    ["es", 4, sheet(3)],
    ["dpp", 4, sheet(3, { [keys[2]]: 4 })],
    ["finance", 4, sheet(3)],
    ["es", 5, sheet(3, { [keys[0]]: 2 })],
    ["dpp", 5, sheet(2, { [keys[3]]: 3 })],
    ["finance", 5, sheet(3)],
  ];
  for (const [k, n, values] of scores) await saveScoreSheet(u[k], cycleId, ScoreSheetSchema.parse({ proposalId: id(n), scores: values, comment: null }));
  // The indicative ceiling covers ranks 1–4: Y-DI-005 falls below the line.
  const costs = await prisma.needsProposal.findMany({ where: { id: { in: [1, 2, 3, 4].map(id) } }, select: { costedAmountNgn: true } });
  await updateCycle(u.dpp, cycleId, { indicativeCeilingNgn: round2(costs.reduce((s, p) => s + Number(p.costedAmountNgn), 0)) });
  const minutesKey = await storePdf(c.tenantId, cycleId, `Steering Committee minutes ${year}`, [
    `Steering Committee meeting on the Direct Intervention ${year} portfolio.`,
    "Members declared no conflicts; Procurement did not score the proposals it uploaded.",
    "The committee noted one divergent score and kept the ranking.",
  ]);
  const minutes = await registerMinutes(u.es, cycleId, RegisterCycleDocumentRequestSchema.parse({ objectKey: minutesKey, kind: "COMMITTEE_MINUTES", title: `Steering Committee minutes ${year}` }));
  await finaliseRanking(u.es, cycleId, { minutesDocumentId: minutes.id, note: "Steering Committee meeting" });

  // Approval: procurement@ submits the portfolio (Y-DI-005 below the line), dpp@ reviews, es@ approves with one exclusion and the memo.
  await submitPortfolio(
    u.procurement,
    cycleId,
    SubmitPortfolioRequestSchema.parse({
      items: ranked.map((n) => (n === 5 ? { proposalId: id(n), included: false, exclusionReason: "Below the funding line" } : { proposalId: id(n), included: true })),
      note: `Prioritised Project Portfolio ${year}`,
    })
  );
  await actOnPortfolio(u.dpp, cycleId, NeedsApprovalActionRequestSchema.parse({ decision: "APPROVE", notes: "Management review: in order." }));
  const memoKey = await storePdf(c.tenantId, cycleId, `Executive Secretary approval memo ${year}`, [`Approval of the Direct Intervention ${year} portfolio, with one exclusion.`]);
  const memo = await registerPortfolioMemo(u.es, cycleId, RegisterCycleDocumentRequestSchema.parse({ objectKey: memoKey, kind: "APPROVAL_MEMO", title: `Executive Secretary approval memo ${year}` }));
  await actOnPortfolio(
    u.es,
    cycleId,
    NeedsApprovalActionRequestSchema.parse({
      decision: "APPROVE",
      notes: "Approved by the Executive Secretary.",
      exclusions: [{ proposalId: id(4), reason: "Deferred: the State is building a school on the adjacent plot this year." }],
      memoDocumentId: memo.id,
    })
  );

  const funding = await prisma.needsProposal.findMany({ where: { cycleId, stage: "FUNDING", status: "IN_PROGRESS" }, orderBy: { sequence: "asc" }, select: { reference: true } });
  const expected = DI_FUNDING_SEQUENCES.map((n) => diReference(year, n));
  if (funding.map((p) => p.reference).join() !== expected.join()) throw new Error(`Needs seed: expected ${expected.join(", ")} at Funding, found ${funding.map((p) => p.reference).join(", ")}`);
  return { typeId: type.id, count: rows.length, funding: funding.map((p) => p.reference) };
}

async function seedOutOfCycleRequest(c: LiveContext, typeId: string): Promise<string> {
  const request = await createOutOfCycle(
    c.u.procurement,
    OutOfCycleRequestSchema.parse({
      projectTypeId: typeId,
      interventionYear: c.year,
      stateCode: "KO",
      title: "Emergency reconstruction of storm-damaged classrooms, LGEA Primary School Ajaokuta",
      reason: "EMERGENCY",
      reasonDetails: "A rainstorm removed the roofs of two classroom blocks; 410 pupils are taught outdoors and the next annual cycle would fund the works a year from now.",
      requestedAmountNgn: 38_500_000,
    })
  );
  const objectKey = await storePdf(c.tenantId, request.cycleId, "Executive Secretary emergency directive", [
    "Directive to treat the reconstruction of the storm-damaged classrooms at LGEA Primary School Ajaokuta as an emergency.",
  ]);
  await registerOutOfCycleDocument(c.u.procurement, request.proposalId, RegisterProposalDocumentRequestSchema.parse({ objectKey, kind: "AUTHORISING_DOCUMENT", title: "Executive Secretary emergency directive" }));
  await submitOutOfCycle(c.u.procurement, request.proposalId);
  return request.reference;
}

async function seedKanoCycle(c: LiveContext) {
  const { u, year } = c;
  const type = await prisma.projectType.findFirstOrThrow({ where: { tenantId: c.tenantId, code: "CO_FUNDED" } });
  const cycle = await openCycle(u.kanoDpp, { projectTypeId: type.id, interventionYear: year, stateCode: "KN", indicativeCeilingNgn: null, deadlines: [], carryForwardProposalIds: [] });
  const cycleId = cycle.id;
  const circular = await storePdf(c.tenantId, cycleId, `Matching Grants circular ${year}`, [`Kano SUBEB circular opening the ${year} Matching Grants needs assessment.`]);
  await registerCycleDocument(u.kanoDpp, cycleId, RegisterCycleDocumentRequestSchema.parse({ objectKey: circular, kind: "CIRCULAR", title: `Matching Grants circular ${year}` }));

  const specs = mgSeedProposals(year);
  await upload(c, u.kanoProcurement, cycleId, "MG", specs.map((p) => ({ spec: p.spec, proposalId: null, fileName: `${p.spec.project.title}.xlsx` })));
  const rows = await prisma.needsProposal.findMany({ where: { cycleId }, select: { id: true, reference: true } });
  const id = (n: number) => rows.find((r) => r.reference === mgReference(year, n))!.id;
  for (const n of [1, 2, 3]) await proposalDoc(c, u.kanoProcurement, cycleId, id(n), "DRAWING", `Classroom block drawings, ${mgReference(year, n)}`, ["SUBEB standard classroom block, toilet and borehole drawings."]);
  await applyProposalActions(u.kanoProcurement, cycleId, ProposalBatchActionRequestSchema.parse({ action: "SUBMIT", proposalIds: [1, 2, 3].map(id) }));

  // Field verification (kano.dpp@) of 001 and 002; 003 came late and waits for the site visit.
  const verifiedOn = [`${year - 1}-09-15`, c.today].sort()[0];
  for (const n of [1, 2]) {
    const photo = await proposalDoc(c, u.kanoDpp, cycleId, id(n), "PHOTO", `Site photos, ${mgReference(year, n)}`, ["Condemned classrooms and the absence of toilets, as reported."]);
    await recordValidation(
      u.kanoDpp,
      id(n),
      RecordValidationRequestSchema.parse({
        outcome: "ADVANCE",
        deskNotes: "School visited; classrooms condemned as reported.",
        siteVerification: { method: "WEB_EVIDENCE", verifiedOn, officerName: "Kano SUBEB Physical Planning", notes: null, evidenceDocumentIds: [photo] },
      })
    );
  }
  await decideStage(u.kanoDpp, cycleId, StageDecisionRequestSchema.parse({ stage: "VALIDATION", items: [1, 2].map((n) => ({ proposalId: id(n), outcome: "ADVANCE" })) }));

  // Costing by the same officer: a separation-of-duties override per proposal, authorised by the Executive Chairman.
  for (const n of [1, 2]) {
    const flag = await requestSeparationOverride(u.kanoDpp, cycleId, { proposalId: id(n), action: "COST", reason: "Kano SUBEB has one quantity surveyor post, vacant since June." });
    await decideSeparationOverride(u.kanoAdmin, cycleId, flag.id, { decision: "AUTHORISED", note: "Authorised for this cycle; the Director of Finance reviews the BoQ." });
  }
  await upload(c, u.kanoDpp, cycleId, "MG", [1, 2].map((n) => ({ spec: { ...specs[n - 1].spec, project: { ...specs[n - 1].spec.project, assumptions: `${specs[n - 1].spec.project.assumptions} Costed by Kano SUBEB Physical Planning.` } }, proposalId: id(n), fileName: `${mgReference(year, n)} costed.xlsx` })));
  await decideStage(u.kanoDpp, cycleId, StageDecisionRequestSchema.parse({ stage: "COSTING", items: [1, 2].map((n) => ({ proposalId: id(n), outcome: "ADVANCE" })) }));

  // The SUBEB Steering Committee (the Executive Chairman chairs; three members from the directorates).
  const members = ["c1", "c2", "c3"];
  await setCommittee(u.kanoAdmin, cycleId, SetCommitteeRequestSchema.parse({ members: [{ userId: u.kanoAdmin.userId, role: "CHAIR" }, ...members.map((k) => ({ userId: u[k].userId, role: "MEMBER" }))] }));
  for (const k of ["kanoAdmin", ...members]) await declareConflicts(u[k], cycleId, ConflictDeclarationRequestSchema.parse({ hasConflict: false }));
  await changeScoring(u.kanoAdmin, cycleId, { action: "OPEN" });
  const keys = NeedsPipelineConfigSchema.parse((await prisma.needsCycle.findUniqueOrThrow({ where: { id: cycleId } })).configSnapshotJson).rubric.criteria.map((cr) => cr.key);
  for (const [i, k] of ["kanoAdmin", ...members].entries()) {
    for (const n of [1, 2]) await saveScoreSheet(u[k], cycleId, ScoreSheetSchema.parse({ proposalId: id(n), scores: Object.fromEntries(keys.map((key) => [key, n === 1 ? 4 + (i % 2) : 3 + (i % 2)])), comment: null }));
  }
  await finaliseRanking(u.kanoAdmin, cycleId, { minutesDocumentId: null, note: "SUBEB Steering Committee meeting" });

  // State approval: SUBEB management review (kano.dpp@), then the Executive Chairman's endorsement with the memo.
  await submitPortfolio(u.kanoProcurement, cycleId, SubmitPortfolioRequestSchema.parse({ items: [1, 2].map((n) => ({ proposalId: id(n), included: true })) }));
  await actOnPortfolio(u.kanoDpp, cycleId, NeedsApprovalActionRequestSchema.parse({ decision: "APPROVE", notes: "SUBEB management review done." }));
  const memoKey = await storePdf(c.tenantId, cycleId, `Executive Chairman endorsement ${year}`, [`Endorsement of the Kano ${year} Matching Grants portfolio.`]);
  const memo = await registerPortfolioMemo(u.kanoAdmin, cycleId, RegisterCycleDocumentRequestSchema.parse({ objectKey: memoKey, kind: "APPROVAL_MEMO", title: `Executive Chairman endorsement ${year}` }));
  await actOnPortfolio(u.kanoAdmin, cycleId, NeedsApprovalActionRequestSchema.parse({ decision: "APPROVE", memoDocumentId: memo.id }));

  // The BEAP: built by kano.dpp@ and submitted to UBEC (in UBEC Physical Planning review).
  const narrativeKey = await storePdf(c.tenantId, cycleId, `Kano ${year} BEAP narrative`, [`Kano State Basic Education Action Plan for ${year}: classrooms and WASH at two schools.`]);
  const narrative = await registerBeapDocument(u.kanoDpp, cycleId, RegisterCycleDocumentRequestSchema.parse({ objectKey: narrativeKey, kind: "BEAP", title: `Kano ${year} BEAP narrative`, proposalIds: [1, 2].map(id) }));
  await saveBeap(
    u.kanoDpp,
    cycleId,
    SaveBeapRequestSchema.parse({
      items: [1, 2].map((n) => ({
        proposalId: id(n),
        included: true,
        lotTitle: `Kano ${year} classrooms and WASH`,
        procurementMethod: "OPEN_COMPETITIVE_BIDDING",
        plannedStartDate: `${year}-02-01`,
        plannedEndDate: `${year}-09-30`,
      })),
      narrativeDocumentId: narrative.id,
      counterpartDeclaredNgn: 40_000_000,
    })
  );
  await submitBeap(u.kanoDpp, cycleId);
  return { count: rows.length };
}
