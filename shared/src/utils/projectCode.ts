/**
 * Project codes (client demo updates C3). UBEC codes are `{year}-LOT-{lot}-BATCH-{batch}`
 * (e.g. `2026-LOT-5-BATCH-7`), unique per tenant because the year is in the code, and shown as
 * "LOT 5 BATCH 7" beside an Intervention year column. The older `AAA-999` form (e.g. `PRG-102`)
 * stays valid for existing data and is shown as stored.
 */

/** The older code form: three letters or digits, a dash and three digits. */
export const LEGACY_PROJECT_CODE_REGEX = /^[A-Z0-9]{3}-[0-9]{3}$/;

/** The UBEC lot/batch form. */
export const LOT_BATCH_CODE_REGEX = /^(\d{4})-LOT-(\d+)-BATCH-(\d+)$/;

export interface LotBatchCode {
  year: number;
  lot: number;
  batch: number;
}

export function buildLotBatchCode(year: number, lot: number, batch: number): string {
  return `${year}-LOT-${lot}-BATCH-${batch}`;
}

export function parseLotBatchCode(code: string | null | undefined): LotBatchCode | null {
  if (!code) return null;
  const m = LOT_BATCH_CODE_REGEX.exec(code.trim().toUpperCase());
  if (!m) return null;
  return { year: Number(m[1]), lot: Number(m[2]), batch: Number(m[3]) };
}

/** "LOT 5 BATCH 7" (the preview and display form, without the year). */
export function formatLotBatch(lot: number, batch: number): string {
  return `LOT ${lot} BATCH ${batch}`;
}

/**
 * The code as people read it: a lot/batch code drops its year ("2026-LOT-5-BATCH-7" → "LOT 5 BATCH 7");
 * any other code is shown as stored.
 */
export function formatProjectCode(code: string | null | undefined): string {
  if (!code) return '';
  const parsed = parseLotBatchCode(code);
  return parsed ? formatLotBatch(parsed.lot, parsed.batch) : code;
}
