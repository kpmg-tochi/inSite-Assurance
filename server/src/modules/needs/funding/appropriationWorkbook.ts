import ExcelJS from 'exceljs';
import { APPROPRIATED_SCHEDULE_COLUMNS, APPROVED_LIST_SHEETS, type AppropriationIssue } from '@insite/shared';
import { cellText, findSheet, loadWorkbook, readTable, type SheetIssue } from '../../../utils/sheetReader';
import {
  buildApprovedListWorkbook,
  parseApprovedListWorkbook,
  type ApprovedListRowInput,
  type ParsedApprovedListHeader,
  type ParsedApprovedListRow,
} from '../../approvedLists/approvedListWorkbook';

/**
 * Needs pipeline wave 4, B2 (D-N.12): the appropriated schedule workbook (pure, no database). It is the
 * approved list upload workbook (same sheets, same version stamp, same row rules) with a required
 * "Proposal reference" column in place of "Project ID" (`APPROPRIATED_SCHEDULE_COLUMNS`). The template
 * is pre-filled with the cycle's proposals at Funding; Finance keeps the appropriated rows, edits the
 * amounts the appropriation act gives and deletes the rows it does not fund.
 *
 * Reading: `parseApprovedListWorkbook` reads the List and Rows sheets with every approved-list rule;
 * the "Proposal reference" column is read beside it. The List sheet's "Approved by" and "Approved on"
 * are not required here: the date of the appropriation is given on confirm and the list is recorded as
 * approved by the person who confirms (wave 4 decision B-3).
 */

const S = APPROVED_LIST_SHEETS;
const PROPOSAL_REF_HEADER = APPROPRIATED_SCHEDULE_COLUMNS.find((c) => c.key === 'proposalRef')!.header;

/** List sheet issues the appropriation does not raise (date from the confirm, approver = the confirmer). */
const IGNORED_HEADER_CODES = new Set(['APPROVED_BY_REQUIRED', 'APPROVED_ON_REQUIRED', 'APPROVED_ON_INVALID']);

export const appropriationTitle = (year: number) => `${year} Appropriated schedule`;

export function appropriationTemplateFileName(shortName: string | null, year: number): string {
  return `${shortName ? `${shortName} ` : ''}${year} appropriated schedule.xlsx`;
}

export interface AppropriationTemplateRow {
  reference: string;
  title: string;
  schoolNames: string[];
  stateName: string | null;
  lgaNames: string[];
  facilityScope: string | null;
  approvedAmountNgn: number | null;
}

export async function buildAppropriationWorkbook(data: { generatedAt: Date; brandName: string | null; interventionYear: number; rows: AppropriationTemplateRow[] }): Promise<Buffer> {
  const rows: ApprovedListRowInput[] = data.rows.map((r) => ({
    rowRef: r.reference,
    projectTitle: r.title,
    schools: r.schoolNames.join('; ') || null,
    state: r.stateName,
    lgas: r.lgaNames.join('; ') || null,
    facilityScope: r.facilityScope,
    costEstimate: r.approvedAmountNgn,
    lotTitle: null,
    proposalRef: r.reference,
  }));
  return buildApprovedListWorkbook({
    generatedAt: data.generatedAt,
    brandName: data.brandName,
    columns: APPROPRIATED_SCHEDULE_COLUMNS,
    title: 'Appropriated schedule',
    intro:
      'The projects the appropriation funds, one row per proposed project. Pre-filled with the approved proposed projects waiting at Funding: keep the rows the appropriation funds with the amount it gives, delete the others, and upload it on the Funding tab.',
    steps: [
      `${S.list}: keep the intervention year and the kind (the Direct Intervention schedule). "Approved by" and "Approved on" may stay blank: you give the date of the appropriation when you confirm.`,
      `${S.rows}: one row per funded project. "Proposal reference" names the proposed project (e.g. 2027-DI-014) or an approved out-of-cycle request; keep it as it is.`,
      '"Cost estimate" is the appropriated amount: equal to the approved amount (funded), or below it (partly funded). An amount above the approved amount is refused.',
      'Approved proposed projects you delete from the file are recorded "Not funded, carried forward" and are offered to the next cycle.',
      'The whole file is saved or nothing is: every funded proposed project becomes a draft project, and the list is written to Approved lists with each row linked to its project.',
    ],
    header: { interventionYear: data.interventionYear, kind: 'DI_SCHEDULE', title: appropriationTitle(data.interventionYear) },
    rows,
  });
}

export interface ParsedAppropriationRow extends ParsedApprovedListRow {
  proposalRef: string | null;
}

export interface ParsedAppropriation {
  header: ParsedApprovedListHeader;
  rows: ParsedAppropriationRow[];
  /** File and List sheet issues. */
  issues: AppropriationIssue[];
}

const toIssue = (i: { row: number | null; column: string | null; code: string; message: string }): AppropriationIssue => ({
  row: i.row,
  column: i.column,
  code: i.code,
  message: i.message,
});

export async function parseAppropriationWorkbook(buffer: Buffer): Promise<ParsedAppropriation> {
  const parsed = await parseApprovedListWorkbook(buffer);
  const issues: AppropriationIssue[] = parsed.issues.filter((i) => i.row === null && !IGNORED_HEADER_CODES.has(i.code)).map(toIssue);
  const refs = new Map<number, string | null>();
  if (parsed.rows.length) {
    const wb = new ExcelJS.Workbook();
    const sheetIssues: SheetIssue[] = [];
    const ws = (await loadWorkbook(wb, buffer)) ? findSheet(wb, S.rows) : undefined;
    const table = ws ? readTable(ws, S.rows, [PROPOSAL_REF_HEADER], sheetIssues) : null;
    issues.push(...sheetIssues.map((i) => toIssue({ row: null, column: i.column ?? null, code: i.code, message: i.message })));
    for (const r of table?.rows ?? []) {
      const text = cellText(r.get(PROPOSAL_REF_HEADER)).replace(/\s+/g, '');
      refs.set(r.row, text ? text.toUpperCase() : null);
    }
  }
  return {
    header: parsed.header,
    rows: parsed.rows.map((r) => ({ ...r, proposalRef: refs.get(r.row) ?? null })),
    issues,
  };
}
