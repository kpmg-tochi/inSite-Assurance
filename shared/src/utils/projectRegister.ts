import { PROJECT_CODE_PREFIX_REGEX } from '../schemas/projectSetup.schema';
import {
  ExternalReferenceSchema,
  FundingSourceSchema,
  INTERVENTION_YEAR_MAX,
  INTERVENTION_YEAR_MIN,
  PROJECT_REGISTER_COLUMNS,
  PROJECT_REGISTER_IMPORT_STATUS_ALIASES,
  ProjectRegisterColumnKey,
  ProjectRegisterImportStatus,
  ProjectRegisterImportStatusEnum,
} from '../schemas/projectRegister.schema';
import { parseSheetDate, parseSheetNumber } from './sheetValues';

/**
 * UBEC IRL: pure rules of the project register import (no database). The server reads the cells,
 * calls `validateRegisterRow` per row, then resolves names against the workspace (types, regions,
 * organisations, codes and client project IDs already in use) and numbers the rows with
 * `assignRegisterCodes`.
 */

export type RegisterRowRaw = Partial<Record<ProjectRegisterColumnKey, unknown>>;

export interface RegisterRowValues {
  code: string | null;
  externalReference: string | null;
  name: string;
  school: string | null;
  state: string | null;
  lga: string | null;
  siteAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  projectType: string | null;
  owner: string | null;
  contractor: string | null;
  contractSumNgn: number | null;
  /** The budget, or the contract sum when the budget is blank. */
  budgetNgn: number | null;
  contractAwardDate: string | null;
  contractSignedDate: string | null;
  plannedStartDate: string | null;
  plannedCompletionDate: string | null;
  interventionYear: number | null;
  fundingSource: string | null;
  status: ProjectRegisterImportStatus;
  /** 0–100; null for projects not started. */
  percentComplete: number | null;
}

export interface RegisterRowIssue {
  /** The column header (template wording). */
  column: string;
  code: string;
  message: string;
}

const header = (key: ProjectRegisterColumnKey) => PROJECT_REGISTER_COLUMNS.find((c) => c.key === key)!.header;

const asText = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  return String(v).trim();
};
const orNull = (s: string) => (s === '' ? null : s);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** "Ongoing", "in progress", "Completed"… → the status; blank → NOT_STARTED; unknown → null. */
export function parseRegisterImportStatus(raw: unknown): ProjectRegisterImportStatus | null {
  const t = norm(asText(raw));
  if (!t) return 'NOT_STARTED';
  for (const status of ProjectRegisterImportStatusEnum.options) {
    if (PROJECT_REGISTER_IMPORT_STATUS_ALIASES[status].some((a) => norm(a) === t)) return status;
  }
  return null;
}

/**
 * Checks one row of the Projects sheet: shapes, ranges, dates in order, and what a live (ongoing or
 * completed) project needs. Names are resolved by the server.
 */
export function validateRegisterRow(raw: RegisterRowRaw): { values: RegisterRowValues; issues: RegisterRowIssue[]; warnings: RegisterRowIssue[] } {
  const issues: RegisterRowIssue[] = [];
  const warnings: RegisterRowIssue[] = [];
  const bad = (key: ProjectRegisterColumnKey, code: string, message: string) => issues.push({ column: header(key), code, message });
  const warn = (key: ProjectRegisterColumnKey, code: string, message: string) => warnings.push({ column: header(key), code, message });
  const text = (key: ProjectRegisterColumnKey) => asText(raw[key]);

  // Text fields
  const name = text('name');
  if (!name) bad('name', 'MISSING_VALUE', 'Enter the project name.');
  else if (name.length < 3) bad('name', 'INVALID_VALUE', 'The project name needs at least 3 characters.');
  else if (name.length > 200) bad('name', 'TOO_LONG', 'The project name is longer than 200 characters.');

  const codeText = text('code').toUpperCase();
  if (codeText && !PROJECT_CODE_PREFIX_REGEX.test(codeText)) {
    bad('code', 'INVALID_CODE', `"${codeText}" is not a project code: use three letters or digits, a dash and three digits (e.g. PRG-120), or leave it blank.`);
  }

  const refText = text('externalReference');
  let externalReference: string | null = null;
  if (refText) {
    const r = ExternalReferenceSchema.safeParse(refText);
    if (r.success) externalReference = r.data;
    else bad('externalReference', 'INVALID_VALUE', r.error.issues[0]?.message ?? 'Invalid project ID.');
  }

  const state = text('state');
  if (!state) bad('state', 'MISSING_VALUE', 'Choose the state.');

  const limit = (key: ProjectRegisterColumnKey, max: number) => {
    const v = text(key);
    if (v.length > max) bad(key, 'TOO_LONG', `Longer than ${max} characters.`);
    return orNull(v.slice(0, max));
  };
  const school = limit('school', 200);
  if (school && school.length < 2) bad('school', 'INVALID_VALUE', 'The school name needs at least 2 characters.');
  const lga = limit('lga', 120);
  const siteAddress = limit('siteAddress', 400);
  const projectType = limit('projectType', 120);
  const owner = limit('owner', 200);
  const contractor = limit('contractor', 200);
  if (contractor && contractor.length < 2) bad('contractor', 'INVALID_VALUE', 'The contractor name needs at least 2 characters.');

  const fundingText = text('fundingSource');
  let fundingSource: string | null = null;
  if (fundingText) {
    const f = FundingSourceSchema.safeParse(fundingText);
    if (f.success) fundingSource = f.data;
    else bad('fundingSource', 'INVALID_VALUE', f.error.issues[0]?.message ?? 'Invalid funding source.');
  }

  // Numbers
  const number = (key: ProjectRegisterColumnKey) => {
    const n = parseSheetNumber(raw[key] === undefined ? null : raw[key]);
    if (n !== null && Number.isNaN(n)) {
      bad(key, 'INVALID_NUMBER', `"${text(key)}" is not a number.`);
      return null;
    }
    return n;
  };
  const latitude = number('latitude');
  const longitude = number('longitude');
  if ((latitude === null) !== (longitude === null)) {
    bad(latitude === null ? 'latitude' : 'longitude', 'INVALID_GPS', 'Enter both latitude and longitude, or neither.');
  }
  if (latitude !== null && Math.abs(latitude) > 90) bad('latitude', 'INVALID_GPS', 'Latitude must be between -90 and 90.');
  if (longitude !== null && Math.abs(longitude) > 180) bad('longitude', 'INVALID_GPS', 'Longitude must be between -180 and 180.');

  const contractSumNgn = number('contractSum');
  if (contractSumNgn !== null && contractSumNgn < 0) bad('contractSum', 'INVALID_NUMBER', 'The contract sum cannot be negative.');
  const budgetGiven = number('budget');
  if (budgetGiven !== null && budgetGiven <= 0) bad('budget', 'INVALID_NUMBER', 'The budget must be above zero.');
  const budgetNgn = budgetGiven ?? (contractSumNgn !== null && contractSumNgn > 0 ? contractSumNgn : null);
  if (budgetGiven === null && budgetNgn === null && !issues.some((i) => i.column === header('contractSum'))) {
    bad('budget', 'BUDGET_REQUIRED', 'Enter the budget or the contract sum.');
  }

  let interventionYear: number | null = null;
  const yearRaw = number('interventionYear');
  if (yearRaw !== null) {
    if (!Number.isInteger(yearRaw) || yearRaw < INTERVENTION_YEAR_MIN || yearRaw > INTERVENTION_YEAR_MAX) {
      bad('interventionYear', 'INVALID_YEAR', `Enter a year from ${INTERVENTION_YEAR_MIN} to ${INTERVENTION_YEAR_MAX}.`);
    } else interventionYear = yearRaw;
  }

  // Dates
  const date = (key: ProjectRegisterColumnKey) => {
    const v = raw[key];
    if (v === null || v === undefined || asText(v) === '') return null;
    const d = parseSheetDate(v);
    if (!d) bad(key, 'BAD_DATE', `"${asText(v)}" is not a date (use YYYY-MM-DD or DD/MM/YYYY).`);
    return d;
  };
  const contractAwardDate = date('contractAwardDate');
  const contractSignedDate = date('contractSignedDate');
  const plannedStartDate = date('plannedStartDate');
  const plannedCompletionDate = date('plannedCompletionDate');
  if (contractAwardDate && contractSignedDate && contractAwardDate > contractSignedDate) {
    bad('contractSignedDate', 'DATES_OUT_OF_ORDER', 'The contract cannot be signed before it is awarded.');
  }
  if (plannedStartDate && plannedCompletionDate && plannedStartDate > plannedCompletionDate) {
    bad('plannedCompletionDate', 'DATES_OUT_OF_ORDER', 'The planned completion is before the planned start.');
  }

  // Status and progress
  const parsedStatus = parseRegisterImportStatus(raw.status);
  if (!parsedStatus) bad('status', 'UNKNOWN_STATUS', `"${text('status')}" is not a status: use Not started, Ongoing or Completed.`);
  const status: ProjectRegisterImportStatus = parsedStatus ?? 'NOT_STARTED';
  let percentComplete = number('percentComplete');
  if (percentComplete !== null && typeof raw.percentComplete === 'number' && percentComplete > 0 && percentComplete < 1) {
    // A cell formatted as a percentage holds a fraction (45% = 0.45).
    percentComplete = Math.round(percentComplete * 10000) / 100;
  }
  if (percentComplete !== null && (percentComplete < 0 || percentComplete > 100)) {
    bad('percentComplete', 'INVALID_PERCENT', '% complete must be between 0 and 100.');
    percentComplete = null;
  }
  if (status === 'NOT_STARTED') {
    if (percentComplete !== null && percentComplete > 0) {
      warn('percentComplete', 'PERCENT_IGNORED', 'A project not started is imported as a draft; the % complete is ignored.');
    }
    percentComplete = null;
  } else {
    if (status === 'ONGOING' && percentComplete === null) bad('percentComplete', 'PERCENT_REQUIRED', 'Enter the % complete of an ongoing project.');
    if (status === 'COMPLETED' && percentComplete === null) percentComplete = 100;
    if (status === 'COMPLETED' && percentComplete !== null && percentComplete < 100) {
      warn('percentComplete', 'COMPLETED_BELOW_100', `Marked completed at ${percentComplete}%: the project is imported at that figure.`);
    }
    if (latitude === null || longitude === null) {
      if (!issues.some((i) => i.code === 'INVALID_GPS')) bad('latitude', 'GPS_REQUIRED', 'An ongoing or completed project needs the site GPS (latitude and longitude).');
    }
    if (!contractor) bad('contractor', 'CONTRACTOR_REQUIRED', 'An ongoing or completed project needs its contractor.');
  }

  return {
    values: {
      code: codeText && PROJECT_CODE_PREFIX_REGEX.test(codeText) ? codeText : null,
      externalReference,
      name,
      school,
      state: orNull(state),
      lga,
      siteAddress,
      latitude,
      longitude,
      projectType,
      owner,
      contractor,
      contractSumNgn,
      budgetNgn,
      contractAwardDate,
      contractSignedDate,
      plannedStartDate,
      plannedCompletionDate,
      interventionYear,
      fundingSource,
      status,
      percentComplete,
    },
    issues,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Project codes
// ---------------------------------------------------------------------------

/** "PRG-104" → { prefix: "PRG", number: 104 }; null when not a project code. */
export function splitProjectCode(code: string): { prefix: string; number: number } | null {
  const c = code.trim().toUpperCase();
  if (!PROJECT_CODE_PREFIX_REGEX.test(c)) return null;
  return { prefix: c.slice(0, 3), number: Number(c.slice(4)) };
}

/** The series most of the workspace's codes use (ties: the highest number); "PRJ" when there are none. */
export function dominantCodeSeries(existingCodes: string[]): string {
  const stats = new Map<string, { count: number; max: number }>();
  for (const code of existingCodes) {
    const s = splitProjectCode(code);
    if (!s) continue;
    const cur = stats.get(s.prefix) ?? { count: 0, max: 0 };
    stats.set(s.prefix, { count: cur.count + 1, max: Math.max(cur.max, s.number) });
  }
  let best: { prefix: string; count: number; max: number } | null = null;
  for (const [prefix, v] of stats) {
    if (!best || v.count > best.count || (v.count === best.count && v.max > best.max)) best = { prefix, ...v };
  }
  return best?.prefix ?? 'PRJ';
}

/** The next free code after the highest in the series ("PRG" with PRG-101…PRG-124 taken → PRG-125); null when the series is full. */
export function nextFreeProjectCode(prefix: string, taken: Set<string>): string | null {
  let max = 0;
  for (const code of taken) {
    const s = splitProjectCode(code);
    if (s && s.prefix === prefix) max = Math.max(max, s.number);
  }
  for (let n = max + 1; n <= 999; n++) {
    const code = `${prefix}-${String(n).padStart(3, '0')}`;
    if (!taken.has(code)) return code;
  }
  return null;
}

/**
 * Codes for the rows of one import, in row order. A valid code that is free keeps its code; a code
 * already used (in the workspace or by an earlier row) gets the next free code of its own series,
 * with a note; a blank code gets the next free code of the workspace's main series.
 */
export function assignRegisterCodes(
  rows: Array<{ code: string | null }>,
  existingCodes: string[]
): Array<{ code: string | null; assigned: boolean; note: string | null }> {
  const taken = new Set(existingCodes.map((c) => c.trim().toUpperCase()));
  const series = dominantCodeSeries(existingCodes.length ? existingCodes : rows.map((r) => r.code ?? '').filter(Boolean));
  // Given codes are reserved first, so an automatic code never takes a code a later row asked for.
  const reserved = new Set<number>();
  rows.forEach((r, i) => {
    if (r.code && !taken.has(r.code)) {
      taken.add(r.code);
      reserved.add(i);
    }
  });
  return rows.map((r, i) => {
    if (r.code && reserved.has(i)) return { code: r.code, assigned: false, note: null };
    const prefix = r.code ? splitProjectCode(r.code)!.prefix : series;
    const next = nextFreeProjectCode(prefix, taken);
    if (next) taken.add(next);
    return {
      code: next,
      assigned: true,
      note: r.code
        ? next
          ? `${r.code} is already used; the project is numbered ${next}.`
          : `${r.code} is already used and the ${prefix} series is full.`
        : null,
    };
  });
}
