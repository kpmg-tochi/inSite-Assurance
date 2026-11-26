/**
 * Needs pipeline: the scenario tests. They walk a Direct Intervention and a Matching Grants cycle
 * from upload to a live project, plus the out-of-cycle route and the field verification. This file
 * is the pipeline's progress bar (plan `saas_updates/needs_pipeline_implementation_plan.md`
 * section 12): every step starts as `todo` with the wave that builds it, and each wave removes the
 * `todo` of its own steps as they pass. Steps: `needs_pipeline/wave1_contracts.md` section 3.7.
 *
 * People (seedUbecRoster, D-N.25; password Password123!):
 * - UBEC HQ: dpp@ (Director Physical Planning), procurement@, qs@ (Quantity Surveyor), finance@,
 *   es@ (Executive Secretary), me.officer@ (UBEC M&E), admin@;
 * - Kano SUBEB: kano.dpp@, kano.procurement@, kano.admin@ (acts for the Executive Chairman);
 * - Lagos SUBEB: lagos.admin@, lagos.me@ (must not see the Kano cycle).
 *
 * When the first step is built: add `resetTestDatabase()` in a `before` hook (tests must not seed)
 * and keep the steps of a suite in order, since each one continues from the one before.
 */
import { describe, it } from 'node:test';

const todo = (wave: number) => ({ todo: `wave ${wave}` });

describe('Needs pipeline scenario: Direct Intervention (2027 cycle)', () => {
  it('DI-01 dpp@ opens the 2027 DI cycle; config snapshot and deadlines stored', todo(2));
  it('DI-02 procurement@ uploads three files at once; the file with row errors is refused with row, column and reason; two proposals created with references', todo(2));
  it('DI-03 duplicate and essential-facility flags raised on the right proposal', todo(2));
  it('DI-04 procurement@ submits both to Validation', todo(3));
  it('DI-05 procurement@ cannot validate (409 SAME_PERSON_VALIDATION)', todo(3));
  it('DI-06 me.officer@ validates one (duplicate resolved, essential gap justified), returns the other; it is resubmitted and validated; Validated Project List generated', todo(3));
  it('DI-07 design versions uploaded (v2 each; v1 kept)', todo(3));
  it('DI-08 qs@ uploads costed versions; a rate variance is acknowledged with a reason; S&M line present; Cost Estimate Report generated', todo(3));
  it('DI-09 committee (es@ chair, dpp@, finance@, procurement@): declarations, procurement@ recused from its uploads, scores, one divergence flagged, ranking, line, override with reason, finalised; Prioritised Project Portfolio generated', todo(3));
  it('DI-10 procurement@ submits the portfolio; dpp@ management review; es@ approves with one exclusion and the memo', todo(4));
  it('DI-11 finance@ records the budget submission and imports the appropriated schedule; the funded proposal converts; the excluded one is "Not funded, carried forward"', todo(4));
  it("DI-12 the draft project has the proposal's sites, units from breakdown rows, BoQ lines and funded budget, origin NEEDS_PIPELINE, an approved-list row; procurement@ assigns a lot; a draft with origin none cannot be activated", todo(4));
  it('DI-13 opening the 2028 cycle offers the carried-forward proposal; carried, it starts at Validation with its versions linked', todo(4));
});

describe('Needs pipeline scenario: Matching Grants (Kano, 2027 cycle)', () => {
  it('MG-01 kano.dpp@ opens the Kano 2027 MG cycle with the circular', todo(2));
  it('MG-02 kano.procurement@ uploads; a file without BoQ is refused (MG minimum fields)', todo(2));
  it('MG-03 Lagos SUBEB users cannot see the Kano cycle', todo(2));
  it('MG-04 kano.dpp@ field-verifies; costs (separation override with reason because the same person validated, flag raised)', todo(3));
  it('MG-05 SUBEB committee scores and finalises', todo(3));
  it('MG-06 SUBEB management review and kano.admin@ endorsement', todo(4));
  it('MG-07 BEAP built (lot, batch, procurement method per proposal; counterpart declared) and submitted', todo(4));
  it('MG-08 dpp@ reviews, comments on one proposal and returns; SUBEB revises (new version) and resubmits', todo(4));
  it('MG-09 es@ approves (Executive Management); proposals convert, owner Kano SUBEB, lot and batch from the BEAP', todo(4));
  it('MG-10 activation refused until counterpart evidence is recorded; then allowed', todo(4));
  it('OOC-01 out-of-cycle request (emergency, authorising document) approved by es@; converts with origin OUT_OF_CYCLE', todo(4));
  it('FIELD-01 a verification visit submitted from the field app fills the validation record and corrects a site\'s coordinates', todo(5));
});
