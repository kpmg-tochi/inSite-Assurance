/**
 * Needs pipeline wave 1 (N0 + N1), no database: every pure rule later waves build on.
 * - Type config: the defaults parse; a type without `needsPipeline` is unchanged (disabled);
 *   an enabled pipeline needs its stages, rubric and chains.
 * - Stages: order, next and return targets, reopen stage, allowed actions per stage, status and
 *   permissions, status labels, minimum fields.
 * - Separation of duties: every rule and error code, the override, committee recusals.
 * - Scoring: the plan's example (Impact 4.5/5, Ease 3/5 → 78), divergence, ranking and ties, the
 *   funding line.
 * - Facilities breakdown: row issues with row, column and reason; essential facility gaps; totals
 *   and grouping.
 * - Costing: summary, rate variances against the standard and zone factor, ceilings, the
 *   supervision and monitoring line.
 * - References, duplicates, the cycle calendar across the year boundary.
 * - N0: the kick-off window after contract award.
 * - D-N.23: a cycle chain step passes the project chain engine's pure gate.
 * - The shared enums and the Prisma (database) enums are the same lists.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AuditActionType as DbAuditActionType, PermissionCategory as DbPermissionCategory, ProjectOrigin as DbProjectOrigin } from '@prisma/client';
import {
  allowedProposalActions,
  AuditActionTypeEnum,
  authorisationProblem,
  breakdownRowCost,
  breakdownShortfall,
  breakdownTotals,
  ceilingBreaches,
  checkSeparation,
  ConflictDeclarationRequestSchema,
  CostingStandardSchema,
  costingSummary,
  cycleDeadlines,
  deadlineState,
  DEFAULT_DI_NEEDS_PIPELINE,
  DEFAULT_ESSENTIAL_FACILITY_GROUPS,
  DEFAULT_MG_NEEDS_PIPELINE,
  divergentCriteria,
  essentialFacilityGaps,
  FACILITY_BREAKDOWN_COLUMNS,
  FacilityBreakdownRowSchema,
  findDuplicateMatches,
  formatProposalReference,
  fundingLine,
  groupBreakdownByFacility,
  hasSupervisionLine,
  kickoffAfterAwardWindow,
  minimumFieldsFor,
  missingMinimumFields,
  monthDayInYear,
  NEEDS_SEPARATION_ERROR_MESSAGES,
  NeedsPipelineConfigSchema,
  NeedsSeparationErrorCodeEnum,
  nextStage,
  normaliseSchoolName,
  ParsedNeedsAssessmentSchema,
  parseProposalReference,
  PermissionCategoryEnum,
  previousStage,
  PROJECT_TYPE_CONFIG_GROUPS,
  ProjectOriginEnum,
  ProjectTypeConfigSchema,
  proposalScore,
  proposalStatusLabel,
  rankProposals,
  rateVariances,
  recusalsFor,
  reopenStageFor,
  returnTarget,
  separationViolation,
  SeparationOverrideDecisionRequestSchema,
  SeparationOverrideRequestSchema,
  stagesFor,
  StageDecisionRequestSchema,
  standardRateFor,
  SYSTEM_PERMISSIONS_CATALOG,
  validateBreakdownRows,
  type BreakdownRowDraft,
  type DuplicateCandidate,
  type FacilityBreakdownRow,
  type NeedsBoqLine,
  type RankInput,
} from '@insite/shared';
import { gateForStep, nextApplicableStep, stepApplies } from '../modules/process/approvalChain';
import type { WebJwtPayload } from '../middleware/auth.middleware';

const DI = NeedsPipelineConfigSchema.parse(DEFAULT_DI_NEEDS_PIPELINE);
const MG = NeedsPipelineConfigSchema.parse(DEFAULT_MG_NEEDS_PIPELINE);
const CATALOG_KEYS = new Set(SYSTEM_PERMISSIONS_CATALOG.map((p) => p.key));

// ---------------------------------------------------------------------------
// Type config (B3, B11, B12, D2)
// ---------------------------------------------------------------------------

describe('Needs pipeline N1: type config and defaults', () => {
  it('a type without needsPipeline parses to a disabled pipeline, and the other keys are unchanged', () => {
    const config = ProjectTypeConfigSchema.parse({});
    assert.equal(config.needsPipeline.enabled, false);
    assert.deepEqual(config.needsPipeline.stages, []);
    assert.deepEqual(config.needsPipeline.approvalChains, { NEEDS_PORTFOLIO: [], BEAP: [], OUT_OF_CYCLE: [] });
    // A stored config from before the pipeline round-trips with only the new key added.
    const before = { payments: { retentionPercentage: 5, retentionDurationMonths: 12 }, kickoff: { noticeLeadDays: 7 } };
    const parsed = ProjectTypeConfigSchema.parse(before);
    assert.equal(parsed.payments.retentionPercentage, 5);
    assert.equal(parsed.kickoff.noticeLeadDays, 7);
    assert.equal(PROJECT_TYPE_CONFIG_GROUPS.needsPipeline, 'needs');
  });

  it('the Direct Intervention default follows plan 3.3, 4.3 and 6.2', () => {
    assert.equal(DI.enabled, true);
    assert.equal(DI.fundingGate, 'APPROPRIATION');
    assert.equal(DI.referencePrefix, 'DI');
    assert.equal(DI.cycleScope, 'NATIONAL');
    assert.deepEqual(DI.cycleOpens, { month: 3, day: 1 });
    assert.deepEqual(stagesFor(DI), ['IDENTIFICATION', 'VALIDATION', 'DESIGN', 'COSTING', 'PRIORITISATION', 'APPROVAL', 'FUNDING']);
    assert.deepEqual(
      DI.stages.map((s) => s.actorPermissionKey),
      ['needs:submit', 'needs:validate', 'needs:submit', 'needs:cost', 'needs:chair_committee', null, 'needs:record_funding']
    );
    assert.equal(DI.requireCounterpartEvidenceBeforeActivation, false);
    assert.deepEqual(DI.approvalChains.NEEDS_PORTFOLIO.map((s) => s.requiredPermissionKey), ['needs:review_portfolio', 'needs:approve_portfolio']);
    assert.deepEqual(DI.approvalChains.OUT_OF_CYCLE.map((s) => s.requiredPermissionKey), ['needs:approve_out_of_cycle']);
    assert.deepEqual(DI.approvalChains.BEAP, []);
    assert.deepEqual(minimumFieldsFor(DI, 'IDENTIFICATION'), ['NEED', 'SITES', 'BREAKDOWN', 'JUSTIFICATION']);
    assert.ok(minimumFieldsFor(DI, 'DESIGN').includes('BOQ') && minimumFieldsFor(DI, 'DESIGN').includes('DRAWINGS'));
  });

  it('the Matching Grants default has no Design stage, a BEAP gate and the counterpart rule', () => {
    assert.equal(MG.fundingGate, 'BEAP_APPROVAL');
    assert.equal(MG.referencePrefix, 'MG');
    assert.equal(MG.cycleScope, 'STATE');
    assert.deepEqual(stagesFor(MG), ['IDENTIFICATION', 'VALIDATION', 'COSTING', 'PRIORITISATION', 'APPROVAL', 'FUNDING']);
    assert.equal(MG.stages.find((s) => s.stage === 'VALIDATION')?.label, 'Field verification');
    assert.equal(MG.requireCounterpartEvidenceBeforeActivation, true);
    assert.ok(minimumFieldsFor(MG, 'IDENTIFICATION').includes('BOQ'), 'a Matching Grants draft is complete at upload (A8)');
    assert.deepEqual(MG.approvalChains.NEEDS_PORTFOLIO.map((s) => s.organizationScope), ['PROJECT_OWNER', 'PROJECT_OWNER']);
    assert.deepEqual(MG.approvalChains.BEAP.map((s) => s.requiredPermissionKey), ['needs:review_beap', 'needs:approve_beap']);
    assert.equal(MG.approvalChains.OUT_OF_CYCLE.length, 2);
  });

  it('both defaults share the A6 rubric, the essential groups and the tolerances', () => {
    for (const c of [DI, MG]) {
      assert.deepEqual(c.rubric.dimensions.map((d) => [d.key, d.weight]), [['IMPACT', 60], ['EASE', 40]]);
      assert.equal(c.rubric.criteria.filter((x) => x.dimension === 'IMPACT').length, 5);
      assert.equal(c.rubric.criteria.filter((x) => x.dimension === 'EASE').length, 5);
      assert.ok(c.rubric.criteria.every((x) => x.descriptors.length === 5));
      assert.equal(c.rubric.divergenceThreshold, 2);
      assert.equal(c.rubric.quorum, 3);
      assert.deepEqual(c.essentialFacilityGroups, DEFAULT_ESSENTIAL_FACILITY_GROUPS);
      assert.equal(c.rateVarianceTolerancePct, 15);
      assert.equal(c.duplicateRadiusMeters, 100);
      assert.equal(c.duplicateLookbackYears, 3);
      assert.equal(c.requireSiteVerification, true);
    }
  });

  it('every permission the defaults name is in the catalogue, and the 18 keys are there', () => {
    for (const c of [DI, MG]) {
      const keys = [
        ...c.stages.map((s) => s.actorPermissionKey).filter((k): k is string => k !== null),
        ...Object.values(c.approvalChains).flatMap((chain) => chain.map((s) => s.requiredPermissionKey)),
      ];
      for (const key of keys) assert.ok(CATALOG_KEYS.has(key), `${key} is not in the catalogue`);
    }
    const needs = SYSTEM_PERMISSIONS_CATALOG.filter((p) => p.category === 'NEEDS_FUNDING').map((p) => p.key);
    assert.equal(needs.length, 17);
    assert.ok(needs.includes('standards:manage'));
    assert.equal(SYSTEM_PERMISSIONS_CATALOG.find((p) => p.key === 'procurement:plan_lots')?.category, 'PORTFOLIO_PROJECTS');
  });

  it('refuses an enabled pipeline without its stages, rubric or chains', () => {
    const bare = NeedsPipelineConfigSchema.safeParse({ enabled: true });
    assert.equal(bare.success, false);
    const messages = bare.success ? [] : bare.error.issues.map((i) => i.message);
    assert.ok(messages.some((m) => m.includes('Validation stage')));
    assert.ok(messages.some((m) => m.includes('weights must add up to 100')));
    assert.ok(messages.some((m) => m.includes('portfolio approval chain')));

    const outOfOrder = NeedsPipelineConfigSchema.safeParse({
      ...DEFAULT_DI_NEEDS_PIPELINE,
      stages: [...DEFAULT_DI_NEEDS_PIPELINE.stages!].reverse(),
    });
    assert.equal(outOfOrder.success, false);
    const noBeapChain = NeedsPipelineConfigSchema.safeParse({ ...DEFAULT_MG_NEEDS_PIPELINE, approvalChains: { ...DEFAULT_MG_NEEDS_PIPELINE.approvalChains, BEAP: [] } });
    assert.equal(noBeapChain.success, false);
    const badWeights = NeedsPipelineConfigSchema.safeParse({
      ...DEFAULT_DI_NEEDS_PIPELINE,
      rubric: { ...DEFAULT_DI_NEEDS_PIPELINE.rubric, dimensions: [{ key: 'IMPACT', label: 'Impact', weight: 70 }, { key: 'EASE', label: 'Ease', weight: 40 }] },
    });
    assert.equal(badWeights.success, false);
  });
});

// ---------------------------------------------------------------------------
// Stages (B4)
// ---------------------------------------------------------------------------

describe('Needs pipeline N1: stages', () => {
  it('next and previous stage follow the type, and the funding stage is the last', () => {
    assert.equal(nextStage(DI, 'VALIDATION'), 'DESIGN');
    assert.equal(nextStage(MG, 'VALIDATION'), 'COSTING');
    assert.equal(nextStage(DI, 'FUNDING'), null);
    assert.equal(nextStage(MG, 'DESIGN'), null, 'a stage the type does not use');
    assert.equal(previousStage(DI, 'COSTING'), 'DESIGN');
    assert.equal(previousStage(MG, 'COSTING'), 'VALIDATION');
    assert.equal(previousStage(DI, 'IDENTIFICATION'), null);
  });

  it('a returned proposal goes to the actor of the stage before, and comes back to the same stage', () => {
    assert.deepEqual(returnTarget(DI, 'VALIDATION'), { correctionStage: 'IDENTIFICATION', actorPermissionKey: 'needs:submit', resubmitTo: 'VALIDATION' });
    assert.deepEqual(returnTarget(DI, 'COSTING'), { correctionStage: 'DESIGN', actorPermissionKey: 'needs:submit', resubmitTo: 'COSTING' });
    assert.deepEqual(returnTarget(MG, 'COSTING'), { correctionStage: 'VALIDATION', actorPermissionKey: 'needs:validate', resubmitTo: 'COSTING' });
    assert.deepEqual(returnTarget(DI, 'PRIORITISATION'), { correctionStage: 'COSTING', actorPermissionKey: 'needs:cost', resubmitTo: 'PRIORITISATION' });
    assert.equal(returnTarget(DI, 'IDENTIFICATION'), null);
  });

  it('a changed scope reopens Validation, a changed cost reopens Costing', () => {
    assert.equal(reopenStageFor('SCOPE'), 'VALIDATION');
    assert.equal(reopenStageFor('COST'), 'COSTING');
  });

  it('offers actions by stage, status and permissions', () => {
    const actions = (stage: Parameters<typeof allowedProposalActions>[0]['stage'], status: Parameters<typeof allowedProposalActions>[0]['status'], keys: string[], config = DI) =>
      allowedProposalActions({ stage, status }, config, keys);

    assert.deepEqual(actions('IDENTIFICATION', 'DRAFT', ['needs:submit']), ['UPLOAD_VERSION', 'SUBMIT', 'WITHDRAW']);
    assert.deepEqual(actions('IDENTIFICATION', 'DRAFT', ['needs:validate']), []);
    assert.deepEqual(actions('VALIDATION', 'IN_PROGRESS', ['needs:validate']), ['RECORD_VALIDATION', 'RETURN']);
    assert.deepEqual(actions('VALIDATION', 'IN_PROGRESS', ['needs:submit']), ['WITHDRAW'], 'the uploader cannot validate');
    assert.deepEqual(actions('VALIDATION', 'RETURNED', ['needs:submit']), ['UPLOAD_VERSION', 'RESUBMIT', 'WITHDRAW']);
    assert.deepEqual(actions('VALIDATION', 'RETURNED', ['needs:validate']), []);
    assert.deepEqual(actions('DESIGN', 'IN_PROGRESS', ['needs:submit']), ['UPLOAD_VERSION', 'SUBMIT', 'WITHDRAW']);
    assert.deepEqual(actions('COSTING', 'IN_PROGRESS', ['needs:cost']), ['UPLOAD_COSTED_VERSION', 'SIGN_OFF_COSTING', 'RETURN']);
    assert.deepEqual(actions('PRIORITISATION', 'IN_PROGRESS', ['needs:score']), ['SCORE']);
    assert.deepEqual(actions('PRIORITISATION', 'IN_PROGRESS', ['needs:score', 'needs:chair_committee']), ['SCORE', 'FINALISE_PRIORITISATION', 'RETURN']);
    assert.deepEqual(actions('PRIORITISATION', 'RETURNED', ['needs:cost']), ['UPLOAD_COSTED_VERSION', 'RESUBMIT']);
    assert.deepEqual(actions('APPROVAL', 'IN_PROGRESS', ['needs:submit_portfolio', 'needs:submit']), ['INCLUDE_IN_PORTFOLIO'], 'no withdrawal once the list is going for approval');
    assert.deepEqual(actions('FUNDING', 'IN_PROGRESS', ['needs:record_funding']), ['RECORD_FUNDING']);
    assert.deepEqual(actions('FUNDING', 'IN_PROGRESS', ['needs:record_funding'], MG), [], 'Matching Grants fund through the BEAP');
    assert.deepEqual(actions('FUNDING', 'IN_PROGRESS', ['needs:prepare_beap'], MG), ['INCLUDE_IN_BEAP']);
    assert.deepEqual(actions('DESIGN', 'IN_PROGRESS', ['needs:submit'], MG), [], 'a stage the type does not use');
    assert.deepEqual(actions('FUNDING', 'NOT_SELECTED', ['needs:manage_cycle']), ['CARRY_FORWARD']);
    for (const status of ['CONVERTED', 'NOT_VALIDATED', 'WITHDRAWN', 'MERGED'] as const) {
      assert.deepEqual(actions('COSTING', status, [...CATALOG_KEYS]), [], status);
    }
  });

  it('labels a proposal from its stage and status', () => {
    assert.equal(proposalStatusLabel({ stage: 'IDENTIFICATION', status: 'DRAFT' }, DI), 'Draft');
    assert.equal(proposalStatusLabel({ stage: 'COSTING', status: 'IN_PROGRESS' }, DI), 'Pending costing');
    assert.equal(proposalStatusLabel({ stage: 'VALIDATION', status: 'IN_PROGRESS' }, MG), 'Pending field verification');
    assert.equal(proposalStatusLabel({ stage: 'FUNDING', status: 'IN_PROGRESS' }, MG), 'Pending BEAP');
    assert.equal(proposalStatusLabel({ stage: 'VALIDATION', status: 'RETURNED' }, DI), 'Returned for correction');
    assert.equal(proposalStatusLabel({ stage: 'FUNDING', status: 'NOT_SELECTED' }, DI), 'Not funded, carried forward');
    assert.equal(proposalStatusLabel({ stage: 'FUNDING', status: 'CONVERTED' }, DI), 'Funded, converted to project');
  });

  it('finds the template fields a version still lacks', () => {
    const identification = ParsedNeedsAssessmentSchema.parse({
      templateVersion: 'INSITE-NEEDS-v2',
      project: { title: 'Renovation of LEA Primary School, Garki', justification: 'Classrooms are unsafe.' },
      sites: [{ siteNumber: 1, schoolName: 'LEA Primary School, Garki', schoolLevel: 'PRIMARY', lgaCode: 'FC-ABUJA-MUNICIPAL' }],
      breakdownRows: [row({ unitId: 'U01' })],
    });
    assert.deepEqual(missingMinimumFields(identification, minimumFieldsFor(DI, 'IDENTIFICATION'), { drawingCount: 0 }), []);
    assert.deepEqual(missingMinimumFields(identification, minimumFieldsFor(DI, 'DESIGN'), { drawingCount: 0 }), ['BOQ', 'DRAWINGS', 'PRELIMINARY_COST']);
    assert.deepEqual(missingMinimumFields(identification, minimumFieldsFor(MG, 'IDENTIFICATION'), { drawingCount: 2 }), ['BOQ', 'PRELIMINARY_COST']);
  });
});

// ---------------------------------------------------------------------------
// Separation of duties (B5)
// ---------------------------------------------------------------------------

describe('Needs pipeline N1: separation of duties', () => {
  const history = {
    uploaderUserIds: ['procurement'],
    validatorUserIds: ['me-officer'],
    costerUserIds: ['qs'],
    submitterUserId: 'procurement',
    chainApproverUserIds: ['dpp'],
    portfolioApproverUserIds: ['dpp', 'es'],
  };

  it('the uploader of any version cannot validate (SAME_PERSON_VALIDATION)', () => {
    assert.equal(separationViolation('VALIDATE', 'procurement', history), 'SAME_PERSON_VALIDATION');
    assert.equal(separationViolation('VALIDATE', 'me-officer', history), null);
  });

  it('the validator cannot cost (SAME_PERSON_COSTING)', () => {
    assert.equal(separationViolation('COST', 'me-officer', history), 'SAME_PERSON_COSTING');
    assert.equal(separationViolation('COST', 'qs', history), null);
    assert.equal(separationViolation('COST', 'procurement', history), null, 'the uploader may cost; only the validator may not');
  });

  it('a chain step is not for the submitter of the list, nor twice for one person (SAME_PERSON_APPROVAL)', () => {
    assert.equal(separationViolation('APPROVE_STEP', 'procurement', history), 'SAME_PERSON_APPROVAL');
    assert.equal(separationViolation('APPROVE_STEP', 'dpp', history), 'SAME_PERSON_APPROVAL');
    assert.equal(separationViolation('APPROVE_STEP', 'es', history), null);
  });

  it('the funding is not confirmed by someone who approved the portfolio (SAME_PERSON_FUNDING)', () => {
    assert.equal(separationViolation('CONFIRM_FUNDING', 'es', history), 'SAME_PERSON_FUNDING');
    assert.equal(separationViolation('CONFIRM_FUNDING', 'finance', history), null);
    assert.equal(separationViolation('CONFIRM_FUNDING', 'finance', {}), null, 'missing history lists are empty');
  });

  it('every error code has a message', () => {
    assert.deepEqual(Object.keys(NEEDS_SEPARATION_ERROR_MESSAGES).sort(), [...NeedsSeparationErrorCodeEnum.options].sort());
  });

  it('an override is a second person\'s authorisation, for this action and this person (D-N.9)', () => {
    const sameValidator = { validatorUserIds: ['kano-dpp'] };
    const authorised = {
      action: 'COST' as const,
      requestedByUserId: 'kano-dpp',
      reason: 'The SUBEB has one Physical Planning officer',
      authorisedByUserId: 'kano-chairman',
      authoriserPermissionKeys: ['needs:view', 'needs:override_separation'],
    };
    assert.deepEqual(checkSeparation('COST', 'kano-dpp', sameValidator, null), { violation: 'SAME_PERSON_COSTING', allowed: false, overridden: false });
    assert.deepEqual(checkSeparation('COST', 'kano-dpp', sameValidator, authorised), { violation: 'SAME_PERSON_COSTING', allowed: true, overridden: true });
    // Nobody overrides their own block, even holding the permission.
    assert.equal(authorisationProblem('COST', 'kano-dpp', { ...authorised, authorisedByUserId: 'kano-dpp', authoriserPermissionKeys: ['needs:override_separation'] }), 'SELF_AUTHORISED');
    assert.equal(checkSeparation('COST', 'kano-dpp', sameValidator, { ...authorised, authorisedByUserId: 'kano-dpp' }).allowed, false);
    assert.equal(authorisationProblem('COST', 'kano-dpp', { ...authorised, authoriserPermissionKeys: ['needs:cost'] }), 'NOT_AUTHORISER');
    assert.equal(authorisationProblem('COST', 'kano-dpp', { ...authorised, action: 'VALIDATE' }), 'WRONG_ACTION');
    assert.equal(authorisationProblem('COST', 'someone-else', authorised), 'WRONG_PERSON');
    assert.equal(authorisationProblem('COST', 'kano-dpp', { ...authorised, reason: '  ' }), 'NO_REASON');
    assert.equal(authorisationProblem('COST', 'kano-dpp', authorised), null);
    // No rule broken: nothing to authorise.
    assert.deepEqual(checkSeparation('COST', 'qs', sameValidator, null), { violation: null, allowed: true, overridden: false });
    // The request and decision schemas.
    const proposalId = '00000000-0000-4000-8000-000000000001';
    assert.equal(SeparationOverrideRequestSchema.safeParse({ proposalId, action: 'COST', reason: 'short' }).success, false);
    assert.equal(SeparationOverrideRequestSchema.safeParse({ proposalId, action: 'COST', reason: 'The SUBEB has one officer' }).success, true);
    assert.equal(SeparationOverrideDecisionRequestSchema.safeParse({ decision: 'AUTHORISED' }).success, true);
  });

  it('recuses a member from proposals they uploaded, validated, costed or declared', () => {
    const proposals = [
      { id: 'p1', uploaderUserIds: ['procurement'], validatorUserIds: ['me-officer'], costerUserIds: ['qs'] },
      { id: 'p2', uploaderUserIds: ['other'], validatorUserIds: ['procurement'] },
      { id: 'p3', costerUserIds: ['procurement'] },
      { id: 'p4' },
      { id: 'p5' },
    ];
    const declarations = [
      { memberUserId: 'procurement', conflictedProposalIds: ['p4', 'p1'] },
      { memberUserId: 'dpp', conflictedProposalIds: ['p5'] },
    ];
    assert.deepEqual(recusalsFor('procurement', proposals, declarations), [
      { proposalId: 'p1', reason: 'UPLOADED' },
      { proposalId: 'p2', reason: 'VALIDATED' },
      { proposalId: 'p3', reason: 'COSTED' },
      { proposalId: 'p4', reason: 'DECLARED_CONFLICT' },
    ]);
    assert.deepEqual(recusalsFor('dpp', proposals, declarations), [{ proposalId: 'p5', reason: 'DECLARED_CONFLICT' }]);
    assert.deepEqual(recusalsFor('es', proposals, declarations), []);
  });

  it('a conflict declaration names proposals only when there is a conflict', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    assert.equal(ConflictDeclarationRequestSchema.safeParse({ hasConflict: false }).success, true);
    assert.equal(ConflictDeclarationRequestSchema.safeParse({ hasConflict: true }).success, false);
    assert.equal(ConflictDeclarationRequestSchema.safeParse({ hasConflict: true, conflictedProposalIds: [id] }).success, true);
    assert.equal(ConflictDeclarationRequestSchema.safeParse({ hasConflict: false, conflictedProposalIds: [id] }).success, false);
  });

  it('a batch decision needs a reason for every outcome other than advance (D-N.4)', () => {
    const a = '00000000-0000-4000-8000-00000000000a';
    const b = '00000000-0000-4000-8000-00000000000b';
    const base = { stage: 'VALIDATION' as const };
    assert.equal(StageDecisionRequestSchema.safeParse({ ...base, items: [{ proposalId: a, outcome: 'ADVANCE' }] }).success, true);
    assert.equal(StageDecisionRequestSchema.safeParse({ ...base, items: [{ proposalId: a, outcome: 'RETURN' }] }).success, false);
    assert.equal(StageDecisionRequestSchema.safeParse({ ...base, items: [{ proposalId: a, outcome: 'ADVANCE' }, { proposalId: b, outcome: 'RETURN', reason: 'Site 2 has no GPS' }] }).success, true);
    assert.equal(StageDecisionRequestSchema.safeParse({ ...base, items: [{ proposalId: a, outcome: 'ADVANCE' }, { proposalId: a, outcome: 'ADVANCE' }] }).success, false);
    assert.equal(StageDecisionRequestSchema.safeParse({ ...base, items: [] }).success, false);
  });
});

// ---------------------------------------------------------------------------
// Scoring (B6)
// ---------------------------------------------------------------------------

describe('Needs pipeline N1: scoring, ranking and the funding line', () => {
  const rubric = DI.rubric;
  const impactKeys = rubric.criteria.filter((c) => c.dimension === 'IMPACT').map((c) => c.key);
  const easeKeys = rubric.criteria.filter((c) => c.dimension === 'EASE').map((c) => c.key);
  const sheet = (impact: number, ease: number, overrides: Record<string, number> = {}) => ({
    scores: { ...Object.fromEntries(impactKeys.map((k) => [k, impact])), ...Object.fromEntries(easeKeys.map((k) => [k, ease])), ...overrides },
  });

  it("the plan's example: Impact 4.5/5 and Ease 3/5 give 78", () => {
    // Two members: Impact 4 and 5 (mean 4.5), Ease 3 and 3.
    assert.deepEqual(proposalScore([sheet(4, 3), sheet(5, 3)], rubric), { impact: 90, ease: 60, total: 78 });
    assert.deepEqual(proposalScore([sheet(5, 5)], rubric), { impact: 100, ease: 100, total: 100 });
    assert.deepEqual(proposalScore([sheet(1, 1)], rubric), { impact: 20, ease: 20, total: 20 });
    assert.equal(proposalScore([], rubric), null);
  });

  it('means are per sub-criterion with equal sub-weights', () => {
    // One Impact criterion scored 1 by one member and 5 by the other: its mean is 3; the others 4.
    const a = sheet(4, 4, { [impactKeys[0]]: 1 });
    const b = sheet(4, 4, { [impactKeys[0]]: 5 });
    const score = proposalScore([a, b], rubric)!;
    assert.equal(score.impact, ((3 + 4 * 4) / 5 / 5) * 100);
    assert.equal(score.ease, 80);
  });

  it('flags sub-criteria scored two or more points apart, and never hides them in the mean', () => {
    const a = sheet(4, 3, { [impactKeys[0]]: 2 });
    const b = sheet(4, 3, { [impactKeys[0]]: 4, [easeKeys[1]]: 4 });
    const c = sheet(4, 3, { [impactKeys[0]]: 5 });
    assert.deepEqual(divergentCriteria([a, b, c], rubric.divergenceThreshold), [{ criterionKey: impactKeys[0], min: 2, max: 5, spread: 3 }]);
    assert.deepEqual(divergentCriteria([a], rubric.divergenceThreshold), [], 'one sheet cannot diverge');
    assert.equal(divergentCriteria([b, sheet(4, 3)], 1).length, 1, 'a one-point spread counts at threshold 1');
  });

  const item = (id: string, total: number | null, impact: number, costNgn: number | null): RankInput => ({
    id,
    reference: `2027-DI-${id}`,
    score: total === null ? null : { total, impact, ease: 50 },
    costNgn,
  });

  it('ranks by total, then higher Impact, then lower cost (D-N.10)', () => {
    const ranked = rankProposals([
      item('004', 70, 80, 50_000_000),
      item('001', 78, 90, 90_000_000),
      item('003', 78, 90, 60_000_000),
      item('002', 78, 95, 120_000_000),
      item('005', null, 0, 10_000_000),
    ]);
    assert.deepEqual(ranked.map((r) => [r.id, r.rank]), [['002', 1], ['003', 2], ['001', 3], ['004', 4], ['005', null]]);
    // The order does not depend on the input order.
    const again = rankProposals([item('003', 78, 90, 60_000_000), item('005', null, 0, 10_000_000), item('002', 78, 95, 120_000_000), item('001', 78, 90, 90_000_000), item('004', 70, 80, 50_000_000)]);
    assert.deepEqual(again.map((r) => r.id), ranked.map((r) => r.id));
  });

  it('draws the funding line at the first proposal that does not fit the ceiling', () => {
    const ranked = rankProposals([item('001', 90, 90, 100_000_000), item('002', 80, 80, 150_000_000), item('003', 70, 70, 100_000_000), item('004', 60, 60, 20_000_000), item('005', null, 0, 10_000_000)]);
    const line = fundingLine(ranked, 300_000_000);
    assert.equal(line.linePosition, 2);
    assert.equal(line.totalAboveNgn, 250_000_000);
    assert.deepEqual(line.items.map((i) => [i.id, i.aboveLine, i.cumulativeNgn]), [
      ['001', true, 100_000_000],
      ['002', true, 250_000_000],
      ['003', false, 350_000_000],
      // Smaller, but below the line: pulling it up is a committee override, with a reason.
      ['004', false, 370_000_000],
      ['005', false, null],
    ]);
    assert.equal(fundingLine(ranked, null).linePosition, 4, 'no ceiling: every ranked proposal is above the line');
    assert.equal(fundingLine(ranked, 50_000_000).linePosition, 0);
    assert.equal(fundingLine(ranked, 250_000_000).linePosition, 2, 'exactly on the ceiling fits');
  });
});

// ---------------------------------------------------------------------------
// Facilities breakdown (B7)
// ---------------------------------------------------------------------------

function row(overrides: Partial<FacilityBreakdownRow> = {}): FacilityBreakdownRow {
  return FacilityBreakdownRowSchema.parse({
    unitId: 'U01',
    siteNumber: 1,
    facilityCode: 'CLASSROOM',
    interventionAction: 'RENOVATION',
    existingQuantity: 6,
    existingCondition: 'DILAPIDATED',
    requiredQuantity: 6,
    proposedQuantity: 6,
    unitOfMeasure: 'nr',
    technicalJustification: 'Roof and floors have failed.',
    criticality: 'HIGH',
    ...overrides,
  });
}

describe('Needs pipeline N1: facilities breakdown', () => {
  const facilities = [
    { code: 'CLASSROOM', name: 'Classroom' },
    { code: 'TOILET', name: 'Toilet' },
    { code: 'BOREHOLE', name: 'Borehole' },
    { code: 'SOLAR_POWER', name: 'Solar power' },
    { code: 'SHOP', name: 'Shop', isRetired: true },
  ];
  const sites = [
    { siteNumber: 1, schoolName: 'LEA Primary School, Garki' },
    { siteNumber: 2, schoolName: 'LEA Primary School, Wuse' },
  ];
  const draft = (r: number, o: Partial<BreakdownRowDraft> = {}): BreakdownRowDraft => ({
    row: r,
    unitId: `U0${r}`,
    siteNumber: 1,
    facilityCode: 'CLASSROOM',
    interventionAction: 'RENOVATION',
    existingQuantity: 6,
    existingCondition: 'DILAPIDATED',
    requiredQuantity: 6,
    proposedQuantity: 6,
    unitOfMeasure: 'nr',
    technicalJustification: 'Roof and floors have failed.',
    criticality: 'HIGH',
    ...o,
  });

  it('accepts clean rows, including the same facility with another action at one site', () => {
    assert.deepEqual(validateBreakdownRows([draft(4), draft(5, { interventionAction: 'NEW_CONSTRUCTION' }), draft(6, { siteNumber: 2 })], sites, facilities), []);
  });

  it('names the row, the column and the reason of every problem', () => {
    const issues = validateBreakdownRows(
      [
        draft(4),
        draft(5, { unitId: 'U04' }),
        draft(6, { facilityCode: 'SPACESHIP', siteNumber: 2 }),
        draft(7, { facilityCode: 'SHOP', siteNumber: 2 }),
        draft(8, { siteNumber: 9, facilityCode: 'TOILET' }),
        draft(9, { existingCondition: 'ABSENT', existingQuantity: 2, facilityCode: 'BOREHOLE' }),
        draft(10, { proposedQuantity: 0, existingQuantity: 0, existingCondition: 'ABSENT', facilityCode: 'SOLAR_POWER' }),
        draft(11, { interventionAction: 'DEMOLITION', unitOfMeasure: 'furlong', technicalJustification: ' ', criticality: null, facilityCode: 'TOILET', siteNumber: 2 }),
        draft(12, { unitId: null, requiredQuantity: -1, preliminaryCostNgn: -5, facilityCode: 'TOILET' }),
      ],
      sites,
      facilities
    );
    const at = (r: number) => issues.filter((i) => i.row === r).map((i) => i.column).sort();
    assert.deepEqual(at(4), []);
    assert.deepEqual(at(5), [FACILITY_BREAKDOWN_COLUMNS.facilityCode, FACILITY_BREAKDOWN_COLUMNS.unitId].sort(), 'duplicate unit ID and duplicate facility, action and site');
    assert.deepEqual(at(6), [FACILITY_BREAKDOWN_COLUMNS.facilityCode]);
    assert.match(issues.find((i) => i.row === 6)!.reason, /not in the facility catalogue/);
    assert.match(issues.find((i) => i.row === 7)!.reason, /retired/);
    assert.match(issues.find((i) => i.row === 8)!.reason, /Site 9 is not on the Sites sheet/);
    assert.deepEqual(at(9), [FACILITY_BREAKDOWN_COLUMNS.existingQuantity]);
    assert.deepEqual(at(10), [FACILITY_BREAKDOWN_COLUMNS.proposedQuantity]);
    assert.deepEqual(
      at(11),
      [
        FACILITY_BREAKDOWN_COLUMNS.interventionAction,
        FACILITY_BREAKDOWN_COLUMNS.unitOfMeasure,
        FACILITY_BREAKDOWN_COLUMNS.technicalJustification,
        FACILITY_BREAKDOWN_COLUMNS.criticality,
      ].sort()
    );
    assert.deepEqual(at(12), [FACILITY_BREAKDOWN_COLUMNS.unitId, FACILITY_BREAKDOWN_COLUMNS.requiredQuantity, FACILITY_BREAKDOWN_COLUMNS.preliminaryCostNgn].sort());
    assert.ok(issues.every((i) => i.reason.length > 0));
  });

  it('the row schema keeps the same rules (absent means 0; proposed 0 only for an existing facility)', () => {
    assert.equal(FacilityBreakdownRowSchema.safeParse({ ...row(), existingCondition: 'ABSENT', existingQuantity: 2 }).success, false);
    assert.equal(FacilityBreakdownRowSchema.safeParse({ ...row(), proposedQuantity: 0, existingQuantity: 0, existingCondition: 'ABSENT' }).success, false);
    assert.equal(FacilityBreakdownRowSchema.safeParse({ ...row(), proposedQuantity: 0, existingQuantity: 4, existingCondition: 'FUNCTIONAL' }).success, true);
    assert.equal(row({ unitId: 'u7' }).unitId, 'U7');
  });

  it('finds essential facility gaps per site and group (D-N.17)', () => {
    const rows = [
      row({ unitId: 'U01', siteNumber: 1, facilityCode: 'CLASSROOM' }),
      // Site 1: toilets proposed; water exists and is functional; no solar.
      row({ unitId: 'U02', siteNumber: 1, facilityCode: 'TOILET', interventionAction: 'NEW_CONSTRUCTION', existingQuantity: 0, existingCondition: 'ABSENT' }),
      row({ unitId: 'U03', siteNumber: 1, facilityCode: 'BOREHOLE', proposedQuantity: 0, existingQuantity: 1, existingCondition: 'FUNCTIONAL', requiredQuantity: 1 }),
      // Site 2: an existing toilet that is not functional and nothing proposed for it; an overhead tank proposed.
      row({ unitId: 'U04', siteNumber: 2, facilityCode: 'TOILET', proposedQuantity: 0, existingQuantity: 2, existingCondition: 'NON_FUNCTIONAL' }),
      row({ unitId: 'U05', siteNumber: 2, facilityCode: 'OVERHEAD_TANK', interventionAction: 'NEW_CONSTRUCTION', existingQuantity: 0, existingCondition: 'ABSENT' }),
    ];
    const gaps = essentialFacilityGaps(rows, sites, DEFAULT_ESSENTIAL_FACILITY_GROUPS);
    assert.deepEqual(gaps.map((g) => [g.siteNumber, g.groupLabel]), [
      [1, 'Solar'],
      [2, 'Toilets'],
      [2, 'Solar'],
    ]);
    assert.equal(gaps[0].schoolName, 'LEA Primary School, Garki');
    assert.deepEqual(essentialFacilityGaps(rows, sites, []), []);
  });

  it('totals the breakdown and groups it by facility with the number of sites derived', () => {
    const rows = [
      row({ unitId: 'U01', siteNumber: 1, requiredQuantity: 8, proposedQuantity: 6, preliminaryCostNgn: 30_000_000 }),
      row({ unitId: 'U02', siteNumber: 2, requiredQuantity: 4, proposedQuantity: 4, preliminaryCostNgn: 20_000_000 }),
      row({ unitId: 'U03', siteNumber: 2, facilityCode: 'TOILET', interventionAction: 'NEW_CONSTRUCTION', existingQuantity: 0, existingCondition: 'ABSENT', requiredQuantity: 6, proposedQuantity: 4 }),
      row({ unitId: 'U04', siteNumber: 1, facilityCode: 'BOREHOLE', proposedQuantity: 0, existingQuantity: 1, existingCondition: 'FUNCTIONAL', requiredQuantity: 0 }),
    ];
    assert.equal(breakdownShortfall(rows[0]), 2);
    assert.deepEqual(breakdownTotals(rows), { rowCount: 4, proposedRowCount: 3, siteCount: 2, facilityCount: 3, rowsWithShortfall: 2, preliminaryCostNgn: 50_000_000 });
    assert.equal(breakdownTotals([row({ preliminaryCostNgn: null })]).preliminaryCostNgn, null);
    const groups = groupBreakdownByFacility(rows);
    assert.deepEqual(groups.map((g) => g.facilityCode), ['CLASSROOM', 'TOILET', 'BOREHOLE']);
    const classrooms = groups[0];
    assert.equal(classrooms.siteCount, 2);
    assert.deepEqual(classrooms.siteNumbers, [1, 2]);
    assert.equal(classrooms.requiredQuantity, 12);
    assert.equal(classrooms.proposedQuantity, 10);
    assert.equal(classrooms.shortfall, 2);
    assert.equal(classrooms.preliminaryCostNgn, 50_000_000);
    assert.equal(groups[1].preliminaryCostNgn, null);
  });
});

// ---------------------------------------------------------------------------
// Costing (B2, B8)
// ---------------------------------------------------------------------------

describe('Needs pipeline N1: costing against the standard', () => {
  const standard = CostingStandardSchema.parse({
    rates: [
      { itemCode: 'CLS-ROOF-01', description: 'Long-span aluminium roofing sheet', facilityCode: 'CLASSROOM', unitOfMeasure: 'm2', rateNgn: 10_000 },
      { itemCode: 'CLS-FLR-01', description: 'Cement screed floor', facilityCode: 'CLASSROOM', unitOfMeasure: 'm2', rateNgn: 5_000 },
      { itemCode: 'GEN-FREE', description: 'Site clearance', unitOfMeasure: 'LS', rateNgn: 0 },
    ],
    zoneFactors: { NE: 1.2 },
    supervisionMonitoringPct: 3,
    contingencyPct: 5,
    ceilings: [
      { facilityCode: 'CLASSROOM', maxNgnPerUnit: 9_000_000 },
      { facilityCode: 'CLASSROOM', interventionAction: 'RENOVATION', maxNgnPerUnit: 4_000_000 },
    ],
  });
  const line = (wbsCode: string, unitId: string, itemCode: string | null, totalQuantity: number, rateNgn: number): NeedsBoqLine => ({
    wbsCode,
    unitId,
    itemCode,
    description: 'Works item',
    unit: 'm2',
    totalQuantity,
    rateNgn,
    amountNgn: Math.round(totalQuantity * rateNgn * 100) / 100,
  });
  const lines = [
    line('1.1', 'U01', 'CLS-ROOF-01', 200, 11_000), // +10% on the base rate
    line('1.2', 'U01', 'CLS-FLR-01', 300, 6_500), // +30%
    line('1.3', 'U01', null, 1, 500_000), // not in the standard
    line('2.1', 'U02', 'CLS-ROOF-01', 100, 8_000), // −20%
  ];

  it('defaults the zone factors to 1 and applies the zone to the standard rate', () => {
    assert.deepEqual(standard.zoneFactors, { NC: 1, NE: 1.2, NW: 1, SE: 1, SS: 1, SW: 1 });
    assert.equal(standardRateFor(standard, 'cls-roof-01', 'NW'), 10_000);
    assert.equal(standardRateFor(standard, 'CLS-ROOF-01', 'NE'), 12_000);
    assert.equal(standardRateFor(standard, 'CLS-ROOF-01', null), 10_000);
    assert.equal(standardRateFor(standard, 'UNKNOWN', 'NW'), null);
    assert.equal(CostingStandardSchema.safeParse({ rates: [standard.rates[0], standard.rates[0]] }).success, false, 'an item code is used once');
  });

  it('summarises the cost with supervision and monitoring and contingency at the standard percentages', () => {
    const summary = costingSummary(lines, standard, 'NW');
    assert.equal(summary.subtotalNgn, 2_200_000 + 1_950_000 + 500_000 + 800_000);
    assert.equal(summary.supervisionMonitoringNgn, 163_500);
    assert.equal(summary.contingencyNgn, 272_500);
    assert.equal(summary.totalNgn, 5_450_000 + 163_500 + 272_500);
    assert.equal(summary.atStandardRatesNgn, 200 * 10_000 + 300 * 5_000 + 100 * 10_000);
    assert.equal(costingSummary(lines, standard, 'NE').atStandardRatesNgn, (200 * 10_000 + 300 * 5_000 + 100 * 10_000) * 1.2);
    assert.equal(costingSummary([lines[2]], standard, 'NW').atStandardRatesNgn, null);
    assert.equal(hasSupervisionLine(summary), true);
    assert.equal(hasSupervisionLine({ ...summary, supervisionMonitoringNgn: 0 }), false);
    assert.equal(hasSupervisionLine({ ...summary, supervisionMonitoringPct: 0 }), false);
    assert.equal(hasSupervisionLine(null), false);
  });

  it('flags rates outside the tolerance either way, against the rate of the zone', () => {
    const nw = rateVariances(lines, standard, 'NW', 15);
    assert.deepEqual(nw.map((v) => [v.wbsCode, v.variancePct, v.direction]), [
      ['1.2', 30, 'ABOVE'],
      ['2.1', -20, 'BELOW'],
    ]);
    assert.equal(nw[0].standardRateNgn, 5_000);
    // North East rates are 20% higher: the +30% floor is now within tolerance, the roof lines are below.
    const ne = rateVariances(lines, standard, 'NE', 15);
    assert.deepEqual(ne.map((v) => v.wbsCode), ['2.1']);
    assert.equal(ne[0].variancePct, -33.33);
    assert.deepEqual(rateVariances(lines, standard, 'NW', 30).map((v) => v.wbsCode), [], 'exactly at the tolerance is not flagged');
    assert.deepEqual(rateVariances([line('9', 'U09', 'GEN-FREE', 1, 100)], standard, 'NW', 15), [], 'a zero standard rate is not compared');
  });

  it('flags a unit above its cost ceiling, the ceiling of its action first', () => {
    const rows = [
      row({ unitId: 'U01', proposedQuantity: 1 }), // 4.65m from lines; renovation ceiling 4m
      row({ unitId: 'U02', proposedQuantity: 1 }), // 0.8m
      row({ unitId: 'U03', interventionAction: 'NEW_CONSTRUCTION', existingQuantity: 0, existingCondition: 'ABSENT', proposedQuantity: 2, preliminaryCostNgn: 20_000_000 }), // 10m each; general ceiling 9m
      row({ unitId: 'U04', facilityCode: 'TOILET', preliminaryCostNgn: 99_000_000 }), // no ceiling
      row({ unitId: 'U05', proposedQuantity: 0, existingQuantity: 2, existingCondition: 'FUNCTIONAL', preliminaryCostNgn: 50_000_000 }), // existing only
    ];
    assert.equal(breakdownRowCost(rows[0], lines), 4_650_000);
    assert.equal(breakdownRowCost(rows[2], lines), 20_000_000);
    const breaches = ceilingBreaches(rows, lines, standard);
    assert.deepEqual(breaches.map((b) => [b.unitId, b.costPerUnitNgn, b.ceilingNgn, b.excessPct]), [
      ['U01', 4_650_000, 4_000_000, 16.25],
      ['U03', 10_000_000, 9_000_000, 11.11],
    ]);
  });
});

// ---------------------------------------------------------------------------
// References, duplicates, calendar (B9)
// ---------------------------------------------------------------------------

describe('Needs pipeline N1: references, duplicates and the calendar', () => {
  it('formats and parses proposal references (D-N.15)', () => {
    assert.equal(formatProposalReference({ interventionYear: 2027, prefix: 'DI', stateCode: null, sequence: 14 }), '2027-DI-014');
    assert.equal(formatProposalReference({ interventionYear: 2027, prefix: 'MG', stateCode: 'kn', sequence: 7 }), '2027-MG-KN-007');
    assert.equal(formatProposalReference({ interventionYear: 2027, prefix: 'DI', stateCode: null, sequence: 1234 }), '2027-DI-1234');
    assert.throws(() => formatProposalReference({ interventionYear: 2027, prefix: 'MG', stateCode: null, sequence: 1 }));
    assert.deepEqual(parseProposalReference(' 2027-di-014 '), { interventionYear: 2027, prefix: 'DI', stateCode: null, sequence: 14 });
    assert.deepEqual(parseProposalReference('2027-MG-KN-007'), { interventionYear: 2027, prefix: 'MG', stateCode: 'KN', sequence: 7 });
    for (const bad of ['2027-DI-14', '2027-MG-007', '2027-MG-ZZ-007', '2027-DI-KN-007', '2027-LOT-5-BATCH-7', 'PRG-102', '2027-DI-000', '', null]) {
      assert.equal(parseProposalReference(bad), null, String(bad));
    }
  });

  it('normalises school names for comparison', () => {
    assert.equal(normaliseSchoolName('L.E.A. Pri. Sch., Garki'), 'lea primary school garki');
    assert.equal(normaliseSchoolName('LEA Primary School Garki'), 'lea primary school garki');
    assert.equal(normaliseSchoolName("Govt. Girls' JSS, Minna"), 'government girls junior secondary school minna');
    assert.equal(normaliseSchoolName('  Crèche   School  '), 'creche school');
    assert.equal(normaliseSchoolName(null), '');
  });

  it('matches the same school in the same LGA, or a site within the radius (D-N.16)', () => {
    const site = { schoolName: 'LEA Primary School, Garki', lgaCode: 'FC-ABUJA-MUNICIPAL', latitude: 9.0335, longitude: 7.4892 };
    const candidate = (o: Partial<DuplicateCandidate>): DuplicateCandidate => ({
      source: 'PROPOSAL',
      id: 'p',
      reference: '2027-DI-001',
      siteNumber: 1,
      schoolName: 'Another School',
      lgaCode: 'FC-BWARI',
      latitude: null,
      longitude: null,
      ...o,
    });
    const matches = findDuplicateMatches(
      site,
      [
        candidate({ id: 'far-same-name-other-lga', schoolName: 'L.E.A. Pri. Sch. Garki', lgaCode: 'FC-BWARI' }),
        candidate({ id: 'near', schoolName: 'Garki Model School', lgaCode: 'FC-ABUJA-MUNICIPAL', latitude: 9.0339, longitude: 7.4895 }), // about 55 m
        candidate({ id: 'same-school', source: 'PROJECT', reference: 'LOT 1 BATCH 1', schoolName: 'L.E.A. Pri. Sch. Garki', lgaCode: 'FC-ABUJA-MUNICIPAL' }),
        candidate({ id: 'half-a-km', lgaCode: 'FC-ABUJA-MUNICIPAL', latitude: 9.038, longitude: 7.4892 }),
      ],
      100
    );
    assert.deepEqual(matches.map((m) => m.candidate.id), ['same-school', 'near']);
    assert.equal(matches[0].sameSchool, true);
    assert.equal(matches[0].distanceMeters, null);
    assert.equal(matches[1].sameSchool, false);
    assert.equal(matches[1].withinRadius, true);
    assert.ok(matches[1].distanceMeters! > 30 && matches[1].distanceMeters! < 100, String(matches[1].distanceMeters));
    assert.deepEqual(findDuplicateMatches({ ...site, latitude: null, longitude: null, lgaCode: null }, [candidate({ schoolName: site.schoolName })], 100), []);
  });

  it('places the Direct Intervention calendar in the year before the intervention year (plan 4.3)', () => {
    const d = cycleDeadlines(DI, 2027);
    const date = (key: string) => d.find((x) => x.key === key)?.date;
    assert.equal(date('cycle-opens'), '2026-03-01');
    assert.equal(date('stage:IDENTIFICATION'), '2026-05-30');
    assert.equal(date('extra:stakeholder-engagement-summary'), '2026-06-30');
    assert.equal(date('stage:VALIDATION'), '2026-07-31');
    assert.equal(date('stage:DESIGN'), '2026-09-30');
    assert.equal(date('stage:COSTING'), '2026-10-14');
    assert.equal(date('stage:PRIORITISATION'), '2026-10-21');
    assert.equal(date('stage:APPROVAL'), '2026-10-31');
    assert.equal(date('chain:NEEDS_PORTFOLIO:2'), '2026-10-31');
    assert.equal(date('extra:budget-submission'), '2026-12-15');
    assert.equal(date('stage:FUNDING'), undefined, 'the appropriation date is not known in advance');
    assert.deepEqual([...d].map((x) => x.date), [...d].map((x) => x.date).sort(), 'in date order');
    assert.equal(d[0].kind, 'CYCLE_OPENS');
  });

  it('places the Matching Grants calendar, with the BEAP steps', () => {
    const d = cycleDeadlines(MG, 2027);
    const date = (key: string) => d.find((x) => x.key === key)?.date;
    assert.equal(date('cycle-opens'), '2026-07-31');
    assert.equal(date('stage:IDENTIFICATION'), '2026-08-31');
    assert.equal(date('stage:VALIDATION'), '2026-09-30');
    assert.equal(date('chain:NEEDS_PORTFOLIO:1'), '2026-10-27');
    assert.equal(date('chain:NEEDS_PORTFOLIO:2'), '2026-10-30');
    assert.equal(date('extra:beap-submitted'), '2026-11-15');
    assert.equal(date('chain:BEAP:1'), '2026-11-22');
    assert.equal(date('chain:BEAP:2'), '2026-11-30');
    assert.equal(date('stage:FUNDING'), '2026-11-30');
    assert.equal(d.find((x) => x.key === 'chain:BEAP:1')?.stage, 'FUNDING');
  });

  it('carries a deadline before the opening date across the year boundary', () => {
    // A cycle that opens on 1 October: November is in Y − 1, January and February are in Y.
    const config = NeedsPipelineConfigSchema.parse({
      ...DEFAULT_DI_NEEDS_PIPELINE,
      cycleOpens: { month: 10, day: 1 },
      stages: DEFAULT_DI_NEEDS_PIPELINE.stages!.map((s) => ({
        ...s,
        deadline:
          s.stage === 'IDENTIFICATION' ? { month: 11, day: 30 } : s.stage === 'VALIDATION' ? { month: 1, day: 31 } : s.stage === 'DESIGN' ? { month: 2, day: 30 } : null,
      })),
      extraDeadlines: [],
      approvalChains: { ...DEFAULT_DI_NEEDS_PIPELINE.approvalChains, NEEDS_PORTFOLIO: DEFAULT_DI_NEEDS_PIPELINE.approvalChains!.NEEDS_PORTFOLIO!.map((s) => ({ ...s, deadline: null })) },
    });
    const d = cycleDeadlines(config, 2028);
    assert.deepEqual(d.map((x) => [x.key, x.date]), [
      ['cycle-opens', '2027-10-01'],
      ['stage:IDENTIFICATION', '2027-11-30'],
      ['stage:VALIDATION', '2028-01-31'],
      // 30 February does not exist: the last day of the month, and 2028 is a leap year.
      ['stage:DESIGN', '2028-02-29'],
    ]);
    assert.equal(monthDayInYear(2027, { month: 2, day: 30 }), '2027-02-28');
    assert.equal(monthDayInYear(2026, { month: 9, day: 31 }), '2026-09-30', 'the PCM\'s "31 September"');
  });

  it('tells where a deadline stands today', () => {
    assert.equal(deadlineState(null, '2026-07-01'), 'NOT_SET');
    assert.equal(deadlineState('2026-07-31', '2026-07-01'), 'UPCOMING');
    assert.equal(deadlineState('2026-07-31', '2026-07-24'), 'DUE_SOON');
    assert.equal(deadlineState('2026-07-31', '2026-07-23'), 'UPCOMING');
    assert.equal(deadlineState('2026-07-31', '2026-07-31'), 'DUE_TODAY');
    assert.equal(deadlineState('2026-07-31', '2026-08-01'), 'OVERDUE');
    assert.equal(deadlineState('2027-01-05', '2026-12-30'), 'DUE_SOON', 'across the year end');
  });
});

// ---------------------------------------------------------------------------
// N0: the kick-off window after contract award (A3)
// ---------------------------------------------------------------------------

describe('Needs pipeline N0: kick-off within 14 days of contract award', () => {
  const fromAward = [
    { anchor: 'KICKOFF' as const, completionMode: 'AUTO_KICKOFF_QUORUM' },
    { anchor: 'CONTRACT_AWARD' as const, completionMode: 'AUTO_CONTRACTOR_ON_SITE' },
  ];
  const fromKickoff = [{ anchor: 'KICKOFF' as const, completionMode: 'AUTO_CONTRACTOR_ON_SITE' }];

  it('warns when the planned kick-off is later than award + 14 days', () => {
    assert.deepEqual(kickoffAfterAwardWindow({ templates: fromAward, contractAwardDate: '2026-11-01', plannedKickoffDate: '2026-11-20' }), {
      contractAwardDate: '2026-11-01',
      plannedKickoffDate: '2026-11-20',
      latestKickoffDate: '2026-11-15',
      windowDays: 14,
      daysLate: 5,
    });
  });

  it('does not warn inside the window, without both dates, or where mobilisation counts from the kick-off', () => {
    assert.equal(kickoffAfterAwardWindow({ templates: fromAward, contractAwardDate: '2026-11-01', plannedKickoffDate: '2026-11-15' }), null);
    assert.equal(kickoffAfterAwardWindow({ templates: fromAward, contractAwardDate: null, plannedKickoffDate: '2026-12-20' }), null);
    assert.equal(kickoffAfterAwardWindow({ templates: fromAward, contractAwardDate: '2026-11-01', plannedKickoffDate: null }), null);
    assert.equal(kickoffAfterAwardWindow({ templates: fromKickoff, contractAwardDate: '2026-11-01', plannedKickoffDate: '2026-12-20' }), null, 'Matching Grants');
    assert.equal(kickoffAfterAwardWindow({ templates: [], contractAwardDate: '2026-11-01', plannedKickoffDate: '2026-12-20' }), null);
  });
});

// ---------------------------------------------------------------------------
// D-N.23: cycle chain steps on the project chain engine's pure functions
// ---------------------------------------------------------------------------

describe('Needs pipeline N1: cycle approval steps reuse the chain engine (D-N.23)', () => {
  // The shape of a NeedsApprovalStep row (no projectId, a string chain type).
  const step = (stepOrder: number, requiredPermissionKey: string, organizationScope: 'ANY' | 'PROJECT_OWNER' = 'PROJECT_OWNER') => ({
    id: `step-${stepOrder}`,
    cycleId: 'cycle-1',
    chainType: 'NEEDS_PORTFOLIO',
    version: 1,
    stepOrder,
    label: stepOrder === 1 ? 'Management review' : 'Executive Secretary approval',
    requiredPermissionKey,
    requiredRoleId: null,
    minAmountThresholdNgn: null,
    isSystemStep: false,
    organizationScope,
    isActive: true,
    createdAt: new Date(),
  });
  const steps = [step(1, 'needs:review_portfolio'), step(2, 'needs:approve_portfolio')];
  const user = (userId: string, permissions: string[], organizationId = 'ubec'): WebJwtPayload => ({
    tokenType: 'WEB_USER',
    userId,
    email: `${userId}@ubec.test`,
    fullName: userId,
    tenantId: 't',
    isPlatformSuperAdmin: false,
    roleId: 'r',
    roleCode: 'R',
    roleName: 'Role',
    permissions,
    organizationId,
    mustChangePassword: false,
  });
  // The cycle's owning organisation supplies the context.
  const orgContext = { owningOrganizationId: 'ubec', ownerAncestorIds: [], funderOrganizationId: null };

  it('walks the steps in order and gates on permission, organisation and the previous approver', () => {
    assert.equal(stepApplies(steps[0], null), true);
    assert.equal(nextApplicableStep(steps, 0, null)?.id, 'step-1');
    assert.equal(nextApplicableStep(steps, 1, null)?.id, 'step-2');
    assert.equal(nextApplicableStep(steps, 2, null), null);

    assert.equal(gateForStep({ webUser: user('dpp', ['needs:review_portfolio']), step: steps[0], actions: [], orgContext }).allowed, true);
    assert.equal(gateForStep({ webUser: user('qs', ['needs:cost']), step: steps[0], actions: [], orgContext }).allowed, false);
    assert.equal(gateForStep({ webUser: user('kano', ['needs:review_portfolio'], 'kano-subeb'), step: steps[0], actions: [], orgContext }).allowed, false, 'another organisation');
    assert.equal(gateForStep({ webUser: user('dpp', ['needs:review_portfolio']), step: steps[0], actions: [], orgContext, excludedUserId: 'dpp' }).allowed, false, 'the submitter');

    const reviewed = [{ decision: 'APPROVE' as const, stepOrder: 1, actorUserId: 'dpp' }];
    const both = ['needs:review_portfolio', 'needs:approve_portfolio'];
    assert.equal(gateForStep({ webUser: user('dpp', both), step: steps[1], actions: reviewed, orgContext }).allowed, false, 'one person, two steps');
    assert.equal(gateForStep({ webUser: user('es', both), step: steps[1], actions: reviewed, orgContext }).allowed, true);
  });
});

// ---------------------------------------------------------------------------
// B12, B13, C15: the shared enums and the database enums
// ---------------------------------------------------------------------------

describe('Needs pipeline N1: the shared enums and the database enums agree', () => {
  const sorted = (values: readonly string[]) => [...values].sort();

  it('audit actions, permission categories and project origins are the same lists on both sides', () => {
    assert.deepEqual(sorted(Object.values(DbAuditActionType)), sorted(AuditActionTypeEnum.options));
    assert.deepEqual(sorted(Object.values(DbPermissionCategory)), sorted(PermissionCategoryEnum.options));
    assert.deepEqual(sorted(Object.values(DbProjectOrigin)), sorted(ProjectOriginEnum.options));
  });

  it('the 23 pipeline audit actions and the new permission category are there', () => {
    const pipeline = AuditActionTypeEnum.options.filter((a) => a.startsWith('NEEDS_') && a !== 'NEEDS_ASSESSMENT_UPLOADED' && a !== 'NEEDS_ASSESSMENT_DELETED' && a !== 'NEEDS_DOCUMENT_ADDED' && a !== 'NEEDS_SEPARATION_OVERRIDE_REQUESTED' && a !== 'NEEDS_RANKING_OVERRIDDEN');
    // Wave 4 added NEEDS_SUBMISSION_UPDATED, NEEDS_COUNTERPART_RECORDED, NEEDS_LOTS_ASSIGNED.
    assert.equal(pipeline.length, 24);
    for (const action of [...pipeline, 'COSTING_STANDARD_SAVED', 'PROJECT_CREATED_FROM_PROPOSAL'] as const) {
      assert.ok((Object.values(DbAuditActionType) as string[]).includes(action), action);
    }
    assert.ok(PermissionCategoryEnum.options.includes('NEEDS_FUNDING'));
    assert.deepEqual([...ProjectOriginEnum.options], ['NEEDS_PIPELINE', 'OUT_OF_CYCLE', 'REGISTER_IMPORT', 'LEGACY']);
  });
});
