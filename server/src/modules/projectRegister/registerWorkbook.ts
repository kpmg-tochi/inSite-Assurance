import ExcelJS from 'exceljs';
import {
  FUNDING_SOURCE_SUGGESTIONS,
  INTERVENTION_YEAR_MAX,
  INTERVENTION_YEAR_MIN,
  PROJECT_REGISTER_COLUMNS,
  PROJECT_REGISTER_IMPORT_STATUS_LABELS,
  PROJECT_REGISTER_SHEETS,
  PROJECT_REGISTER_TEMPLATE_VERSION,
  ProjectRegisterColumnKey,
  RegisterRowRaw,
} from '@insite/shared';
import {
  CELL_BOX,
  DATE_FMT,
  DATE_VALIDATION,
  decimalValidation,
  headerRow,
  hideListsSheet,
  listRange,
  listValidation,
  metaRow,
  MONEY_FMT,
  sectionRow,
  SHEET_FONT,
  solidFill,
  stepRows,
  tableBody,
  titleBand,
  UBEC_SHEET_COLOR,
  UBEC_SHEET_FIRST_DATA_ROW,
  UBEC_SHEET_HEADER_ROW,
  wrappedHeight,
  type BodyColumn,
} from '../../utils/ubecSheetStyle';

/**
 * UBEC IRL: the project register import workbook (pure, no database): Instructions with the version
 * stamp, the Projects sheet (one row per project, dropdowns from the workspace lists) and a hidden
 * Lists sheet. The template is built empty; the demo pack builds it with rows.
 */

const S = PROJECT_REGISTER_SHEETS;
const HR = UBEC_SHEET_HEADER_ROW;
const FR = UBEC_SHEET_FIRST_DATA_ROW;
/** Pre-sized rows with dropdowns in the template. */
const TEMPLATE_ROWS = 300;

/** The column header as the template writes it (the client project ID uses the workspace term). */
export function headerFor(key: ProjectRegisterColumnKey, term: string): string {
  const col = PROJECT_REGISTER_COLUMNS.find((c) => c.key === key)!;
  return key === 'externalReference' ? term : col.header;
}

/** "UBEC project register template.xlsx" (from the workspace short name). */
export function registerTemplateFileName(shortName: string | null): string {
  return shortName ? `${shortName} project register template.xlsx` : 'Project register template.xlsx';
}

const COLUMN_STYLE: Partial<Record<ProjectRegisterColumnKey, BodyColumn & { width: number }>> = {
  code: { width: 11, align: 'center' },
  externalReference: { width: 22 },
  name: { width: 40, wrap: true },
  school: { width: 32, wrap: true },
  state: { width: 16 },
  lga: { width: 16 },
  siteAddress: { width: 32, wrap: true },
  latitude: { width: 12, numFmt: '0.000000', align: 'right' },
  longitude: { width: 12, numFmt: '0.000000', align: 'right' },
  projectType: { width: 22 },
  owner: { width: 26 },
  contractor: { width: 30, wrap: true },
  contractSum: { width: 18, numFmt: MONEY_FMT, align: 'right' },
  budget: { width: 18, numFmt: MONEY_FMT, align: 'right' },
  contractAwardDate: { width: 14, numFmt: DATE_FMT, align: 'center' },
  contractSignedDate: { width: 14, numFmt: DATE_FMT, align: 'center' },
  plannedStartDate: { width: 14, numFmt: DATE_FMT, align: 'center' },
  plannedCompletionDate: { width: 14, numFmt: DATE_FMT, align: 'center' },
  interventionYear: { width: 12, align: 'center' },
  fundingSource: { width: 30 },
  status: { width: 14 },
  percentComplete: { width: 11, numFmt: '0.0', align: 'right' },
};

/** What the register workbook is built from (pure, so the demo pack can build a filled file without a database). */
export interface RegisterWorkbookData {
  generatedAt: Date;
  /** Short workspace name for the title bands (e.g. "UBEC"). */
  brandName: string | null;
  /** The workspace term for the client project ID (e.g. "UBEC project ID"). */
  term: string;
  states: string[];
  projectTypes: string[];
  owners: string[];
  contractors: string[];
  /** Pre-filled rows (the demo pack); empty for the template. */
  rows?: RegisterRowRaw[];
}

export async function buildRegisterWorkbook(data: RegisterWorkbookData): Promise<Buffer> {
  const ctx = { term: data.term };
  const brand = data.brandName;
  const title = `${brand ? `${brand} · ` : ''}Project register import`;
  const wb = new ExcelJS.Workbook();
  wb.creator = brand ?? 'InSite Assurance';
  wb.created = data.generatedAt;
  wb.title = title;

  // Instructions
  const ins = wb.addWorksheet(S.instructions, { properties: { tabColor: { argb: UBEC_SHEET_COLOR.navy } } });
  ins.columns = [{ width: 26 }, { width: 100 }];
  ins.views = [{ showGridLines: false }];
  titleBand(ins, 2, title, 'One row per project. Import it from the projects register (Import projects). You will see a preview with any errors before anything is saved.');
  metaRow(ins, 4, 'Version', PROJECT_REGISTER_TEMPLATE_VERSION);
  metaRow(ins, 5, 'Generated', data.generatedAt.toISOString().slice(0, 10));
  sectionRow(ins, 7, 'How to fill it in');
  const steps = [
    'Projects: one row per project. Keep the title rows and the green header row; do not rename the sheet or the headers.',
    `Status: "Not started" (or blank) creates a draft that you then set up and activate as usual (needs assessment, sprints, team). "Ongoing" and "Completed" create live projects at once, with the % complete you report; their progress shows that figure until their scope (needs assessment) is added.`,
    'Ongoing and completed projects need the site GPS (latitude and longitude), the contractor and, for ongoing ones, the % complete.',
    `Code: leave it blank to number the project automatically after the highest code in use (e.g. PRG-125). A code already in use gets the next free number.`,
    `${ctx.term}: your own reference for the project; each one may be used once in the workspace.`,
    'State, project type and owning organisation: pick from the list. Contractor: type the company name; a new name is added to the organisations.',
    `Budget: blank uses the contract sum. Dates: YYYY-MM-DD or DD/MM/YYYY. Intervention year: ${INTERVENTION_YEAR_MIN}–${INTERVENTION_YEAR_MAX}.`,
    'The whole file is imported or nothing is: fix every error shown in the preview and upload it again.',
  ];
  stepRows(ins, 8, steps);
  const colRow = 8 + steps.length + 1;
  sectionRow(ins, colRow, 'Columns');
  PROJECT_REGISTER_COLUMNS.forEach((c, i) => {
    const r = colRow + 1 + i;
    const a = ins.getCell(`A${r}`);
    a.value = headerFor(c.key, ctx.term);
    a.font = { name: SHEET_FONT, bold: c.required, color: { argb: UBEC_SHEET_COLOR.ink } };
    a.fill = solidFill(UBEC_SHEET_COLOR.label);
    a.border = CELL_BOX;
    a.alignment = { vertical: 'top', indent: 1 };
    const b = ins.getCell(`B${r}`);
    b.value = `${c.required ? 'Required. ' : ''}${c.note}`;
    b.border = CELL_BOX;
    b.alignment = { vertical: 'top', wrapText: true, indent: 1 };
    ins.getRow(r).height = wrappedHeight(String(b.value).length, 100);
  });

  // Lists (moved to the end, hidden)
  const lists = wb.addWorksheet(S.lists);
  lists.columns = [
    { header: 'States', width: 24 },
    { header: 'Project types', width: 28 },
    { header: 'Organisations', width: 34 },
    { header: 'Contractors', width: 34 },
    { header: 'Funding sources', width: 36 },
    { header: 'Statuses', width: 16 },
  ];
  const { contractors, owners } = data;
  const statuses = Object.values(PROJECT_REGISTER_IMPORT_STATUS_LABELS);
  const fill = (col: string, values: string[]) => values.forEach((v, i) => (lists.getCell(`${col}${i + 2}`).value = v));
  fill('A', data.states);
  fill('B', data.projectTypes);
  fill('C', owners);
  fill('D', contractors);
  fill('E', [...FUNDING_SOURCE_SUGGESTIONS]);
  fill('F', statuses);
  const ref = (col: string, n: number) => `${S.lists}!${listRange(col, n)}`;

  // Projects
  const ws = wb.addWorksheet(S.projects, { properties: { tabColor: { argb: UBEC_SHEET_COLOR.primary } } });
  const cols = PROJECT_REGISTER_COLUMNS;
  titleBand(ws, cols.length, `${title} · ${S.projects}`, 'One row per project. Bold headers on the Instructions sheet are required; ongoing and completed projects also need GPS, contractor and % complete.');
  headerRow(ws, cols.map((c) => headerFor(c.key, ctx.term)), cols.map((c) => COLUMN_STYLE[c.key]?.width ?? 16));
  const last = TEMPLATE_ROWS + HR;
  tableBody(ws, cols.map((c) => COLUMN_STYLE[c.key] ?? {}), last);
  const letter = (key: ProjectRegisterColumnKey) => String.fromCharCode(65 + cols.findIndex((c) => c.key === key));
  const suggest = (formula: string): ExcelJS.DataValidation => ({ ...listValidation(formula, ''), showErrorMessage: false });
  for (let r = FR; r <= last; r++) {
    const cell = (key: ProjectRegisterColumnKey) => ws.getCell(`${letter(key)}${r}`);
    if (data.states.length) cell('state').dataValidation = listValidation(ref('A', data.states.length), 'Choose a state from the list.');
    if (data.projectTypes.length) cell('projectType').dataValidation = listValidation(ref('B', data.projectTypes.length), 'Choose a project type from the list.');
    if (owners.length) cell('owner').dataValidation = listValidation(ref('C', owners.length), 'Choose an organisation from the list.');
    if (contractors.length) cell('contractor').dataValidation = suggest(ref('D', contractors.length));
    cell('fundingSource').dataValidation = suggest(ref('E', FUNDING_SOURCE_SUGGESTIONS.length));
    cell('status').dataValidation = listValidation(ref('F', statuses.length), 'Choose Not started, Ongoing or Completed.');
    cell('latitude').dataValidation = { type: 'decimal', operator: 'between', allowBlank: true, formulae: [-90, 90], showErrorMessage: true, error: 'Enter decimal degrees.' };
    cell('longitude').dataValidation = { type: 'decimal', operator: 'between', allowBlank: true, formulae: [-180, 180], showErrorMessage: true, error: 'Enter decimal degrees.' };
    cell('contractSum').dataValidation = decimalValidation(0, 'Enter the amount as a number.');
    cell('budget').dataValidation = decimalValidation(0, 'Enter the amount as a number.');
    for (const k of ['contractAwardDate', 'contractSignedDate', 'plannedStartDate', 'plannedCompletionDate'] as const) cell(k).dataValidation = DATE_VALIDATION;
    cell('interventionYear').dataValidation = {
      type: 'whole',
      operator: 'between',
      allowBlank: true,
      formulae: [INTERVENTION_YEAR_MIN, INTERVENTION_YEAR_MAX],
      showErrorMessage: true,
      error: `Enter a year from ${INTERVENTION_YEAR_MIN} to ${INTERVENTION_YEAR_MAX}.`,
    };
    cell('percentComplete').dataValidation = { type: 'decimal', operator: 'between', allowBlank: true, formulae: [0, 100], showErrorMessage: true, error: 'Enter 0 to 100.' };
  }
  ws.autoFilter = { from: { row: HR, column: 1 }, to: { row: HR, column: cols.length } };
  (data.rows ?? []).forEach((row, i) => {
    cols.forEach((c, j) => {
      const v = row[c.key];
      if (v === undefined || v === null || v === '') return;
      const isDate = c.key === 'contractAwardDate' || c.key === 'contractSignedDate' || c.key === 'plannedStartDate' || c.key === 'plannedCompletionDate';
      ws.getCell(FR + i, j + 1).value = isDate && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : (v as ExcelJS.CellValue);
    });
  });

  await hideListsSheet(wb, lists, S.lists);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
