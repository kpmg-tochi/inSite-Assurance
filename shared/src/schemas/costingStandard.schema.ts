import { z } from 'zod';
import { NIGERIA_ZONES, NigeriaZoneCodeEnum, type NigeriaZoneCode } from '../data/nigeriaAdminAreas';
import { FACILITY_CODE_REGEX } from './facility.schema';
import { InterventionActionEnum } from './needsPipeline.schema';
import { UnitOfMeasureEnum } from './scope.schema';

/**
 * Needs pipeline N1/N2: costing standards (D-N.8). A versioned rate library per tenant. A version a
 * costed needs assessment refers to is locked and never edited: saving makes the next version, like
 * the form library. The needs assessment template carries the version it was built from, and costing
 * compares each rate to it (`utils/needsCosting.ts`).
 */

const Uuid = z.string().uuid();

export const COSTING_ITEM_CODE_REGEX = /^[A-Z0-9][A-Z0-9._-]{0,39}$/;
export const COSTING_RATES_MAX = 5000;

const FacilityCodeSchema = z.string().trim().toUpperCase().regex(FACILITY_CODE_REGEX, 'Unknown facility code');

/** One rated item of the standard. */
export const CostingStandardRateSchema = z.object({
  itemCode: z.string().trim().toUpperCase().regex(COSTING_ITEM_CODE_REGEX, 'Item code: up to 40 capital letters, digits, dots, dashes or underscores'),
  description: z.string().trim().min(3).max(600),
  /** The facility the item belongs to; null for an item used across facilities. */
  facilityCode: FacilityCodeSchema.nullable().default(null),
  unitOfMeasure: UnitOfMeasureEnum,
  /** Base rate (₦), before the zone factor. */
  rateNgn: z.number().nonnegative(),
});
export type CostingStandardRate = z.infer<typeof CostingStandardRateSchema>;
export type CostingStandardRateInput = z.input<typeof CostingStandardRateSchema>;

const Factor = z.number().positive().max(10).default(1);

/** Multiplier on every rate per geopolitical zone (1.0 = the base rate). */
export const CostingZoneFactorsSchema = z.object({
  NC: Factor,
  NE: Factor,
  NW: Factor,
  SE: Factor,
  SS: Factor,
  SW: Factor,
});
export type CostingZoneFactors = z.infer<typeof CostingZoneFactorsSchema>;

export const DEFAULT_COSTING_ZONE_FACTORS: CostingZoneFactors = Object.fromEntries(NIGERIA_ZONES.map((z0) => [z0.code, 1])) as CostingZoneFactors;

/** The most one unit of a facility may cost (optionally for one intervention action). */
export const CostingCeilingSchema = z.object({
  facilityCode: FacilityCodeSchema,
  /** Null: the ceiling applies to every action without its own ceiling. */
  interventionAction: InterventionActionEnum.nullable().default(null),
  maxNgnPerUnit: z.number().positive(),
});
export type CostingCeiling = z.infer<typeof CostingCeilingSchema>;
export type CostingCeilingInput = z.input<typeof CostingCeilingSchema>;

/** The content of a costing standard version. */
export const CostingStandardSchema = z
  .object({
    rates: z.array(CostingStandardRateSchema).max(COSTING_RATES_MAX).default([]),
    zoneFactors: CostingZoneFactorsSchema.default({}),
    /** D-N.18: share of the works subtotal for supervision and monitoring. */
    supervisionMonitoringPct: z.number().min(0).max(100).default(0),
    contingencyPct: z.number().min(0).max(100).default(0),
    ceilings: z.array(CostingCeilingSchema).max(500).default([]),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.rates.forEach((r, i) => {
      if (seen.has(r.itemCode)) ctx.addIssue({ code: 'custom', path: ['rates', i, 'itemCode'], message: `The item code "${r.itemCode}" is used twice.` });
      seen.add(r.itemCode);
    });
    const ceilings = new Set<string>();
    v.ceilings.forEach((c, i) => {
      const key = `${c.facilityCode}|${c.interventionAction ?? '*'}`;
      if (ceilings.has(key)) ctx.addIssue({ code: 'custom', path: ['ceilings', i, 'facilityCode'], message: 'This ceiling is listed twice.' });
      ceilings.add(key);
    });
  });
export type CostingStandard = z.infer<typeof CostingStandardSchema>;
export type CostingStandardInput = z.input<typeof CostingStandardSchema>;

/** Save = a new version when the latest one is locked, else the latest is edited in place (wave 2). */
export const SaveCostingStandardRequestSchema = z.object({
  standard: CostingStandardSchema,
  /** Design standard documents (standard drawings, specifications) shown beside the rates. Wave 2 settles where they are stored. */
  designStandardDocumentIds: z.array(Uuid).max(200).default([]),
  /** What changed, for the version list. */
  note: z.string().trim().max(500).nullable().default(null),
});
export type SaveCostingStandardRequest = z.infer<typeof SaveCostingStandardRequestSchema>;
export type SaveCostingStandardRequestInput = z.input<typeof SaveCostingStandardRequestSchema>;

export const CostingStandardVersionDtoSchema = z.object({
  id: Uuid,
  version: z.number().int(),
  standard: CostingStandardSchema,
  designStandardDocumentIds: z.array(Uuid),
  note: z.string().nullable(),
  /** A cycle or a needs assessment version refers to it: it can no longer be edited. */
  isLocked: z.boolean(),
  isLatest: z.boolean(),
  savedByName: z.string(),
  savedAt: z.string(),
});
export type CostingStandardVersionDto = z.infer<typeof CostingStandardVersionDtoSchema>;

/** The factor of a zone; 1 for an unknown or missing zone. */
export function costingZoneFactor(standard: Pick<CostingStandard, 'zoneFactors'>, zone: NigeriaZoneCode | null | undefined): number {
  if (!zone || !NigeriaZoneCodeEnum.safeParse(zone).success) return 1;
  return standard.zoneFactors[zone] ?? 1;
}

/** The standard's rate for an item in a zone (base rate × zone factor, 2 dp); null when the item is not in the standard. */
export function standardRateFor(
  standard: Pick<CostingStandard, 'rates' | 'zoneFactors'>,
  itemCode: string | null | undefined,
  zone: NigeriaZoneCode | null | undefined
): number | null {
  if (!itemCode) return null;
  const code = itemCode.trim().toUpperCase();
  const rate = standard.rates.find((r) => r.itemCode === code);
  if (!rate) return null;
  return Math.round(rate.rateNgn * costingZoneFactor(standard, zone) * 100) / 100;
}
