import { DEFAULT_FACILITIES, lgaByCode, stateByCode, type ParsedNeedsAssessment } from "@insite/shared";
import { buildNeedsWorkbook, parseNeedsWorkbook, type NeedsWorkbookFacility } from "../modules/needs/workbook/needsWorkbook";
import { fillNeedsWorkbook, type NeedsFileSpec } from "../modules/needs/workbook/fillNeedsWorkbook";
import { buildAppropriationWorkbook, parseAppropriationWorkbook, type AppropriationTemplateRow } from "../modules/needs/funding/appropriationWorkbook";
import {
  DI_FUNDING_SEQUENCES,
  defaultWorkbookFacilities,
  demoPackBatchSpecs,
  demoPackSingleSpec,
  diCostedSpec,
  diReference,
  diSeedProposals,
  needsOpenYear,
  seedFileContext,
  SEED_COSTING_STANDARD,
} from "../db/needsSeedSpecs";

/**
 * Needs pipeline wave 5 (N9, M4): the demo pack's needs pipeline files, pure (no database). Used by
 * `buildDemoPack.ts` (writes them) and `routes.demo.test.ts` (imports the appropriated schedule).
 *
 * - The appropriated schedule of the open Direct Intervention cycle (Y = the year after the run day):
 *   the three proposals the seed leaves at Funding, Y-DI-001 (Dawakin Tofa, the demo project) and
 *   Y-DI-002 funded at their approved amounts, Y-DI-003 partly funded (90 %). The approved amounts are
 *   the costed totals of the seed's costed versions, read here with the real parser.
 * - Needs assessments to upload into that cycle: one on its own (two schools in Gombe) and a batch of
 *   five, the fourth with row errors (refused with row, column and reason; the other four are created).
 *   Facilities are written "Name (CODE)", so the files read on the normal seed and on the demo overlay
 *   (which renames the catalogue but keeps the codes).
 */

export const DEMO_APPROPRIATION_FILE = (year: number) => `16 Appropriated schedule ${year}.xlsx`;
export const DEMO_NEEDS_SINGLE_FILE = "17 Needs assessment, Kumo and Akko schools.xlsx";
export const demoNeedsBatchFile = (k: number, spec: NeedsFileSpec) => `18 Batch ${k} - ${spec.sites[0].schoolName.replace(/[^A-Za-z0-9 '.-]/g, "")}${spec.valid ? "" : " (row errors)"}.xlsx`;

/** Y-DI-003 is funded at this share of its approved amount (partly funded). */
export const DEMO_PARTLY_FUNDED_SHARE = 0.9;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** "Toilet ×2, Borehole ×1" (as the funding template writes the facility scope). */
function facilitiesSummary(rows: ReadonlyArray<{ facilityCode: string; proposedQuantity: number }>, names: ReadonlyMap<string, string>): string {
  const totals = new Map<string, number>();
  for (const r of rows) if (r.proposedQuantity > 0) totals.set(r.facilityCode, (totals.get(r.facilityCode) ?? 0) + r.proposedQuantity);
  return [...totals.entries()].map(([code, n]) => names.get(code) + " ×" + n).join(", ");
}

/** The catalogue with names written "Name (CODE)": read by code on any workspace. */
function codedFacilities(): NeedsWorkbookFacility[] {
  return defaultWorkbookFacilities().map((f) => ({ ...f, name: `${f.name} (${f.code})` }));
}

async function parseSpec(buffer: Buffer, year: number, programme: "DI" | "MG"): Promise<ParsedNeedsAssessment> {
  const ctx = seedFileContext(programme, year);
  const result = await parseNeedsWorkbook(buffer, { facilities: ctx.facilities, interventionYear: year, cycleStateCode: ctx.stateCode, requiredFields: [], costingStandard: { version: 1, standard: SEED_COSTING_STANDARD } });
  if (!result.parsed) throw new Error(`Needs file does not read back: ${JSON.stringify(result.issues.slice(0, 5))}`);
  return result.parsed;
}

/** A needs assessment as a person fills it in on the cycle's blank template (facilities "Name (CODE)"). */
export async function buildDemoNeedsFile(spec: NeedsFileSpec, year: number): Promise<Buffer> {
  const ctx = seedFileContext(spec.programme, year);
  const { buffer } = await buildNeedsWorkbook({ ...ctx, prefill: null, proposalReference: null });
  return fillNeedsWorkbook(buffer, spec, { facilities: codedFacilities() });
}

/** The rows of the appropriated schedule (approved amounts from the seed's costed versions). */
export async function demoAppropriationRows(today: string): Promise<Array<AppropriationTemplateRow & { appropriatedNgn: number }>> {
  const year = needsOpenYear(today);
  const names = new Map(DEFAULT_FACILITIES.map((f) => [f.code, f.name]));
  const out: Array<AppropriationTemplateRow & { appropriatedNgn: number }> = [];
  for (const n of DI_FUNDING_SEQUENCES) {
    const p = diSeedProposals(year).find((x) => x.n === n)!;
    const ctx = seedFileContext("DI", year);
    const { buffer } = await buildNeedsWorkbook({ ...ctx, prefill: null, proposalReference: null });
    const parsed = await parseSpec(await fillNeedsWorkbook(buffer, diCostedSpec(p), { facilities: ctx.facilities }), year, "DI");
    const approved = parsed.costingSummary!.totalNgn;
    const appropriatedNgn = n === 3 ? round2(approved * DEMO_PARTLY_FUNDED_SHARE) : approved;
    out.push({
      reference: diReference(year, n),
      title: parsed.project.title ?? p.spec.project.title,
      schoolNames: parsed.sites.map((s) => s.schoolName),
      stateName: stateByCode(parsed.project.stateCode)?.name ?? null,
      lgaNames: [...new Set(parsed.sites.map((s) => lgaByCode(s.lgaCode)?.name ?? s.lgaCode))],
      facilityScope: facilitiesSummary(parsed.breakdownRows, names) || null,
      approvedAmountNgn: appropriatedNgn,
      appropriatedNgn,
    });
  }
  return out;
}

/** The appropriated schedule file Finance imports (read back with the real parser; throws on any issue). */
export async function buildDemoAppropriatedSchedule(today: string, generatedAt = new Date()): Promise<{ buffer: Buffer; year: number; rows: Awaited<ReturnType<typeof demoAppropriationRows>> }> {
  const year = needsOpenYear(today);
  const rows = await demoAppropriationRows(today);
  const buffer = await buildAppropriationWorkbook({ generatedAt, brandName: "UBEC", interventionYear: year, rows });
  const parsed = await parseAppropriationWorkbook(buffer);
  const issues = [...parsed.issues, ...parsed.rows.flatMap((r) => r.issues)];
  if (issues.length || parsed.rows.length !== rows.length || parsed.rows.some((r, i) => r.proposalRef !== rows[i].reference)) {
    throw new Error(`The demo appropriated schedule does not read back cleanly: ${JSON.stringify(issues.slice(0, 5))}`);
  }
  return { buffer, year, rows };
}

/** The needs assessments to upload live: the single file and the batch of five (the fourth invalid). Each is read back. */
export async function buildDemoNeedsUploads(today: string): Promise<Array<{ fileName: string; buffer: Buffer; spec: NeedsFileSpec; issues: number }>> {
  const year = needsOpenYear(today);
  const out = [];
  const single = demoPackSingleSpec(year);
  out.push({ fileName: DEMO_NEEDS_SINGLE_FILE, spec: single, buffer: await buildDemoNeedsFile(single, year), issues: 0 });
  for (const [i, spec] of demoPackBatchSpecs(year).entries()) out.push({ fileName: demoNeedsBatchFile(i + 1, spec), spec, buffer: await buildDemoNeedsFile(spec, year), issues: 0 });
  for (const f of out) {
    const ctx = seedFileContext("DI", year);
    const r = await parseNeedsWorkbook(f.buffer, { facilities: ctx.facilities, interventionYear: year, cycleStateCode: null, requiredFields: ["NEED", "SITES", "BREAKDOWN", "JUSTIFICATION"], costingStandard: { version: 1, standard: SEED_COSTING_STANDARD } });
    f.issues = r.issues.length;
    if (f.spec.valid && r.issues.length) throw new Error(`${f.fileName} should read cleanly: ${JSON.stringify(r.issues.slice(0, 5))}`);
    if (!f.spec.valid && !r.issues.length) throw new Error(`${f.fileName} should have row errors`);
  }
  return out;
}
