/**
 * Needs pipeline wave 2 (Track A): the filler that types a fixture spec into a blank template v2.
 * Wave 5 (N9) moved it to `modules/needs/workbook/fillNeedsWorkbook.ts` so the seed and the demo pack
 * can use it without importing from the tests; the fixtures keep importing it from here.
 */
export { fillNeedsWorkbook, type FillOptions } from '../../../modules/needs/workbook/fillNeedsWorkbook';
