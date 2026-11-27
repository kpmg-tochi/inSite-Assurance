import type { CostingStandardInput } from '../schemas/costingStandard.schema';

/**
 * Needs pipeline wave 2 (N2): the costing standard the seed saves as version 1 for the programme
 * tenant, and the rates the needs assessment fixtures (template v2) are built from.
 *
 * SPECIMEN DATA, NOT UBEC'S RATES. The items follow the facility catalogue (`DEFAULT_FACILITIES`) and
 * the amounts are plausible placeholders for a demo. UBEC replaces them by uploading its own rates on
 * the Standards page (a new version). Supervision and monitoring 5 % and contingency 5 % are assumed
 * (PCM p.8 names the line, not the percentage).
 *
 * Item codes are stable: fixtures and tests refer to them.
 */
export const DEFAULT_COSTING_STANDARD: CostingStandardInput = {
  rates: [
    { itemCode: 'CLS-NEW', description: 'New classroom to the standard design (per classroom, incl. finishes)', facilityCode: 'CLASSROOM', unitOfMeasure: 'nr', rateNgn: 9_500_000 },
    { itemCode: 'CLS-REN', description: 'Classroom renovation: roof, floor, plaster, paint, doors and windows (per classroom)', facilityCode: 'CLASSROOM', unitOfMeasure: 'nr', rateNgn: 3_200_000 },
    { itemCode: 'OFF-NEW', description: 'New head teacher office with store', facilityCode: 'OFFICE', unitOfMeasure: 'nr', rateNgn: 7_800_000 },
    { itemCode: 'LIB-NEW', description: 'New library block', facilityCode: 'LIBRARY', unitOfMeasure: 'nr', rateNgn: 14_000_000 },
    { itemCode: 'TLT-NEW', description: 'New 4-compartment toilet block with hand-washing point', facilityCode: 'TOILET', unitOfMeasure: 'nr', rateNgn: 6_800_000 },
    { itemCode: 'TLT-REN', description: 'Toilet block renovation (plumbing, fittings, finishes)', facilityCode: 'TOILET', unitOfMeasure: 'nr', rateNgn: 1_900_000 },
    { itemCode: 'BHL-SOLAR', description: 'Motorised borehole with solar pump, reticulation and tap stand', facilityCode: 'BOREHOLE', unitOfMeasure: 'nr', rateNgn: 7_500_000 },
    { itemCode: 'OHT-5000', description: '5,000-litre overhead tank on steel stand', facilityCode: 'OVERHEAD_TANK', unitOfMeasure: 'nr', rateNgn: 1_650_000 },
    { itemCode: 'SOL-5KVA', description: '5 kVA solar power system (panels, inverter, batteries, wiring)', facilityCode: 'SOLAR_POWER', unitOfMeasure: 'nr', rateNgn: 6_200_000 },
    { itemCode: 'FUR-PUP-2', description: "Two-seater pupils' desk and bench", facilityCode: 'PUPILS_FURNITURE', unitOfMeasure: 'nr', rateNgn: 68_000 },
    { itemCode: 'FUR-TCH', description: "Teacher's table and chair", facilityCode: 'TEACHERS_FURNITURE', unitOfMeasure: 'set', rateNgn: 95_000 },
    { itemCode: 'BRD-MAG', description: 'Magnetic white board, 2.4 m × 1.2 m, fixed', facilityCode: 'MAGNETIC_BOARD', unitOfMeasure: 'nr', rateNgn: 120_000 },
    { itemCode: 'FNC-BLK', description: 'Perimeter block fence, 2.4 m high, with columns and coping', facilityCode: 'FENCE', unitOfMeasure: 'm', rateNgn: 85_000 },
    { itemCode: 'DRN-CONC', description: 'Open concrete drain, 450 mm', facilityCode: 'DRAINAGE', unitOfMeasure: 'm', rateNgn: 42_000 },
    { itemCode: 'GEN-SITECLR', description: 'Site clearance and setting out', facilityCode: null, unitOfMeasure: 'm2', rateNgn: 650 },
    { itemCode: 'GEN-PRELIM', description: 'Preliminaries (site establishment, signboard, insurances)', facilityCode: null, unitOfMeasure: 'LS', rateNgn: 1_500_000 },
  ],
  zoneFactors: { NC: 1, NE: 1.1, NW: 1, SE: 1, SS: 1.05, SW: 1 },
  supervisionMonitoringPct: 5,
  contingencyPct: 5,
  ceilings: [
    { facilityCode: 'CLASSROOM', interventionAction: 'NEW_CONSTRUCTION', maxNgnPerUnit: 11_000_000 },
    { facilityCode: 'CLASSROOM', interventionAction: 'RENOVATION', maxNgnPerUnit: 4_000_000 },
    { facilityCode: 'TOILET', interventionAction: null, maxNgnPerUnit: 8_000_000 },
    { facilityCode: 'BOREHOLE', interventionAction: null, maxNgnPerUnit: 9_000_000 },
    { facilityCode: 'SOLAR_POWER', interventionAction: null, maxNgnPerUnit: 7_500_000 },
  ],
};
