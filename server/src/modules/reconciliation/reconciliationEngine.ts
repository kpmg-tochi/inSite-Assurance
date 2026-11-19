import {
  EvidenceStrengthRating,
  ProvidedEvidenceItem,
  RatingEngine,
  ResolvedRatingLabels,
  RuleCapCode,
} from '@insite/shared';

/**
 * Evidence-to-claim reconciliation (Phase 3 Step 6). Pure functions: no database, no network.
 *
 * 1. `computeLineFacts` derives the facts in code: evidenced quantity in the BOQ unit, coverage of
 *    the quantity claimed for the period, independent and hold-point evidence, blockers.
 * 2. A rating engine proposes a rating: the model (when configured and working) or `rulesEngineRate`.
 * 3. `applyRuleCaps` enforces the rules on whatever the engine returned and records which fired.
 *
 * The model never sees a rule as something it may waive: the caps run after it, in code.
 */

/** Coverage at or above which the rules engine may rate SUPPORTED. */
export const SUPPORTED_MIN_COVERAGE_PCT = 90;
/** Coverage below which every engine is capped at PARTIALLY_SUPPORTED. */
export const CAP_MIN_COVERAGE_PCT = 50;
/** Independent coverage below which the rules engine treats the claim as contradicted. */
export const CONTRADICTION_MAX_INDEPENDENT_COVERAGE_PCT = 50;

const RATING_RANK: Record<EvidenceStrengthRating, number> = {
  SUPPORTED: 3,
  PARTIALLY_SUPPORTED: 2,
  UNSUPPORTED: 1,
  CONTRADICTED: 0,
};

function atMost(rating: EvidenceStrengthRating, ceiling: EvidenceStrengthRating): EvidenceStrengthRating {
  return RATING_RANK[rating] > RATING_RANK[ceiling] ? ceiling : rating;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

const UNIT_ALIASES: Record<string, string> = {
  m3: 'm3', 'm^3': 'm3', 'm³': 'm3', cum: 'm3', cubm: 'm3', cubicmetre: 'm3', cubicmeter: 'm3', cubicmetres: 'm3', cubicmeters: 'm3',
  m2: 'm2', 'm^2': 'm2', 'm²': 'm2', sqm: 'm2', sqmetre: 'm2', sqmeter: 'm2', squaremetre: 'm2', squaremeter: 'm2', squaremetres: 'm2', squaremeters: 'm2',
  m: 'm', lm: 'm', metre: 'm', meter: 'm', metres: 'm', meters: 'm', linearmetre: 'm', linearmeter: 'm', rm: 'm',
  km: 'km', kilometre: 'km', kilometer: 'km', kilometres: 'km', kilometers: 'km',
  t: 't', ton: 't', tons: 't', tonne: 't', tonnes: 't', mt: 't',
  kg: 'kg', kgs: 'kg', kilogram: 'kg', kilograms: 'kg',
  nr: 'nr', no: 'nr', nos: 'nr', number: 'nr', numbers: 'nr', item: 'nr', items: 'nr', each: 'nr', ea: 'nr', pcs: 'nr', pc: 'nr', unit: 'nr', units: 'nr',
  ls: 'ls', lumpsum: 'ls', sum: 'ls',
  bag: 'bag', bags: 'bag',
  trip: 'trip', trips: 'trip',
};

export function normalizeUnit(unit: string): string {
  const key = unit.trim().toLowerCase().replace(/[\s.]/g, '');
  return UNIT_ALIASES[key] ?? key;
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

export interface ReconciliationLineInput {
  ipcLineItemId: string;
  boqItemId: string;
  wbsCode: string;
  description: string;
  unit: string;
  totalQuantity: number;
  budgetedCostNgn: number;
  isHoldPoint: boolean;
  isOpaqueLumpSum: boolean;
  previousCertifiedPct: number;
  contractorClaimedPct: number;
  contractorClaimedNgn: number;
  contractorRemarks: string | null;
}

export interface LineFacts {
  /** In-period, inside the geofence and integrity-clean: the only evidence that can support. */
  usableEvidence: ProvidedEvidenceItem[];
  excludedIntegrityEvidenceIds: string[];
  outsideGeofenceEvidenceIds: string[];
  /** Usable evidence that was outside the boundary but within the project tolerance (Phase 6). */
  withinToleranceEvidenceIds: string[];
  /** Integrity-clean evidence whose location could not be evaluated (no fix). Not counted. */
  unknownLocationEvidenceIds: string[];
  claimedPeriodQuantity: number;
  evidencedQuantity: number;
  independentEvidencedQuantity: number;
  /** Evidenced over claimed-for-period quantity, percent. Null when nothing was claimed in quantity terms. */
  coveragePct: number | null;
  independentCoveragePct: number | null;
  /** True when independent evidence reports at least one quantity in the BOQ unit. */
  independentHasMeasuredQuantity: boolean;
  mismatchedUnits: string[];
  hasIndependentEvidence: boolean;
  isContractorOnly: boolean;
  /** Independent, in-geofence, integrity-clean evidence captured at or before the period end. */
  holdPointHasIndependentEvidence: boolean;
  latestIndependentReportsBlocker: boolean;
  blockersReported: boolean;
  topEvidence: { roleName: string; weight: number } | null;
}

const isIndependent = (e: ProvidedEvidenceItem) => e.fieldPersonaType === 'INDEPENDENT_VERIFIER';

export function computeLineFacts(
  line: ReconciliationLineInput,
  evidence: ProvidedEvidenceItem[],
  period: { start: Date; end: Date }
): LineFacts {
  const forItem = evidence.filter(
    (e) => e.boqItemId === line.boqItemId && new Date(e.capturedAt).getTime() <= period.end.getTime()
  );
  const inPeriod = forItem.filter((e) => new Date(e.capturedAt).getTime() >= period.start.getTime());

  const excludedIntegrityEvidenceIds = inPeriod.filter((e) => !e.integrityPassed).map((e) => e.id);
  const outsideGeofenceEvidenceIds = inPeriod
    .filter((e) => e.integrityPassed && e.isWithinGeofence === false)
    .map((e) => e.id);
  const unknownLocationEvidenceIds = inPeriod
    .filter((e) => e.integrityPassed && e.isWithinGeofence === null)
    .map((e) => e.id);
  const usableEvidence = inPeriod.filter((e) => e.integrityPassed && e.isWithinGeofence === true);

  const boqUnit = normalizeUnit(line.unit);
  const mismatched = new Set<string>();
  let evidencedQuantity = 0;
  let independentEvidencedQuantity = 0;
  let independentHasMeasuredQuantity = false;
  for (const e of usableEvidence) {
    for (const q of e.quantities) {
      if (normalizeUnit(q.unit) === boqUnit) {
        evidencedQuantity += q.quantity;
        if (isIndependent(e)) {
          independentEvidencedQuantity += q.quantity;
          independentHasMeasuredQuantity = true;
        }
      } else {
        mismatched.add(q.unit);
      }
    }
  }

  const claimedPeriodQuantity = Math.max(
    0,
    ((line.contractorClaimedPct - line.previousCertifiedPct) / 100) * line.totalQuantity
  );
  const pct = (q: number) => (claimedPeriodQuantity > 0 ? round2((q / claimedPeriodQuantity) * 100) : null);

  const independent = usableEvidence.filter(isIndependent);
  const holdPointEvidence = forItem.filter(
    (e) => e.integrityPassed && e.isWithinGeofence === true && isIndependent(e)
  );
  const latestIndependent = [...independent].sort(
    (a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime()
  )[0];
  const top = [...usableEvidence].sort((a, b) => b.assuranceWeight - a.assuranceWeight)[0];

  return {
    usableEvidence,
    excludedIntegrityEvidenceIds,
    outsideGeofenceEvidenceIds,
    // isWithinGeofence is true for WITHIN_TOLERANCE, so these are already usable; note them.
    withinToleranceEvidenceIds: usableEvidence
      .filter((e) => e.geofenceStatus === 'WITHIN_TOLERANCE')
      .map((e) => e.id),
    unknownLocationEvidenceIds,
    claimedPeriodQuantity: round3(claimedPeriodQuantity),
    evidencedQuantity: round3(evidencedQuantity),
    independentEvidencedQuantity: round3(independentEvidencedQuantity),
    coveragePct: pct(evidencedQuantity),
    independentCoveragePct: pct(independentEvidencedQuantity),
    independentHasMeasuredQuantity,
    mismatchedUnits: [...mismatched].sort(),
    hasIndependentEvidence: independent.length > 0,
    isContractorOnly: usableEvidence.length > 0 && independent.length === 0,
    holdPointHasIndependentEvidence: holdPointEvidence.length > 0,
    latestIndependentReportsBlocker: Boolean(latestIndependent && latestIndependent.blockers.length > 0),
    blockersReported: usableEvidence.some((e) => e.blockers.length > 0),
    topEvidence: top ? { roleName: top.reporterRoleName, weight: top.assuranceWeight } : null,
  };
}

// ---------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------

export interface EngineLineProposal {
  rating: EvidenceStrengthRating;
  rationale: string;
  visitPlannerFlag: boolean;
  visitPlannerReason: string | null;
  corroboratingEvidenceLogIds: string[];
}

const fmtPct = (n: number | null) => (n === null ? 'n/a' : `${n}%`);

/**
 * Deterministic engine used when the AI provider is not configured or fails. It never rates above
 * PARTIALLY_SUPPORTED without independent evidence and at least 90% quantity coverage.
 */
export function rulesEngineRate(line: ReconciliationLineInput, facts: LineFacts): EngineLineProposal {
  const ids = facts.usableEvidence.map((e) => e.id);
  const q = `${facts.evidencedQuantity} of ${facts.claimedPeriodQuantity} ${line.unit} claimed for the period (coverage ${fmtPct(facts.coveragePct)})`;

  if (facts.usableEvidence.length === 0) {
    return {
      rating: 'UNSUPPORTED',
      rationale: `No usable field evidence in the claim period for ${line.wbsCode}.`,
      visitPlannerFlag: true,
      visitPlannerReason: 'No usable field evidence in the claim period.',
      corroboratingEvidenceLogIds: [],
    };
  }

  if (facts.hasIndependentEvidence) {
    // A shortfall needs a measurement: independent evidence without quantities is not a contradiction.
    const shortfall =
      facts.independentHasMeasuredQuantity &&
      facts.independentCoveragePct !== null &&
      facts.independentCoveragePct < CONTRADICTION_MAX_INDEPENDENT_COVERAGE_PCT;
    if (facts.latestIndependentReportsBlocker || shortfall) {
      const why = facts.latestIndependentReportsBlocker
        ? 'the latest independent log reports an active blocker on this item'
        : `independent evidence covers only ${fmtPct(facts.independentCoveragePct)} of the quantity claimed for the period`;
      return {
        rating: 'CONTRADICTED',
        rationale: `Claim of ${line.contractorClaimedPct}% is contradicted: ${why}. Evidenced ${q}.`,
        visitPlannerFlag: true,
        visitPlannerReason: `Independent evidence conflicts with the claim: ${why}.`,
        corroboratingEvidenceLogIds: ids,
      };
    }
    if (facts.coveragePct !== null && facts.coveragePct >= SUPPORTED_MIN_COVERAGE_PCT) {
      return {
        rating: 'SUPPORTED',
        rationale: `Independent in-geofence evidence present. Evidenced ${q}.`,
        visitPlannerFlag: false,
        visitPlannerReason: null,
        corroboratingEvidenceLogIds: ids,
      };
    }
  }

  return {
    rating: 'PARTIALLY_SUPPORTED',
    rationale: `Evidence present but not sufficient for full support. Evidenced ${q}.`,
    visitPlannerFlag: true,
    visitPlannerReason: facts.hasIndependentEvidence
      ? 'Quantity coverage below the threshold for full support.'
      : 'Claim relies on contractor self-reported evidence only.',
    corroboratingEvidenceLogIds: ids,
  };
}

// ---------------------------------------------------------------------------
// Rule caps
// ---------------------------------------------------------------------------

export interface CappedLineResult {
  rating: EvidenceStrengthRating;
  rationale: string;
  visitPlannerFlag: boolean;
  visitPlannerReason: string | null;
  missingHoldPointFlag: boolean;
  corroboratingEvidenceLogIds: string[];
  highestCorroboratingRoleName: string | null;
  highestCorroboratingWeight: number | null;
  ruleCapsApplied: RuleCapCode[];
}

const CAP_TEXT: Record<RuleCapCode, string> = {
  NO_EVIDENCE: 'no usable evidence, rated UNSUPPORTED',
  CONTRACTOR_ONLY_EVIDENCE: 'contractor-only evidence, capped at PARTIALLY_SUPPORTED',
  HOLD_POINT_WITHOUT_INDEPENDENT_EVIDENCE: 'hold point without independent evidence, capped at PARTIALLY_SUPPORTED',
  COVERAGE_BELOW_50_PCT: 'quantity coverage below 50%, capped at PARTIALLY_SUPPORTED',
  INTEGRITY_FLAGGED_EVIDENCE_EXCLUDED: 'integrity-flagged evidence excluded from support',
};

/** Enforces the reconciliation rules on any engine's proposal. Records every rule whose condition held. */
export function applyRuleCaps(
  line: ReconciliationLineInput,
  facts: LineFacts,
  proposal: EngineLineProposal
): CappedLineResult {
  const caps: RuleCapCode[] = [];
  let rating = proposal.rating;
  let visitPlannerFlag = proposal.visitPlannerFlag;
  let visitPlannerReason = proposal.visitPlannerReason;
  let missingHoldPointFlag = false;

  if (facts.excludedIntegrityEvidenceIds.length > 0) caps.push('INTEGRITY_FLAGGED_EVIDENCE_EXCLUDED');

  if (facts.usableEvidence.length === 0) {
    caps.push('NO_EVIDENCE');
    rating = 'UNSUPPORTED';
    visitPlannerFlag = true;
    visitPlannerReason = visitPlannerReason ?? 'No usable field evidence in the claim period.';
  }
  if (facts.isContractorOnly) {
    caps.push('CONTRACTOR_ONLY_EVIDENCE');
    rating = atMost(rating, 'PARTIALLY_SUPPORTED');
    visitPlannerFlag = true;
    visitPlannerReason = visitPlannerReason ?? 'Claim relies on contractor self-reported evidence only.';
  }
  if (line.isHoldPoint && !facts.holdPointHasIndependentEvidence) {
    caps.push('HOLD_POINT_WITHOUT_INDEPENDENT_EVIDENCE');
    rating = atMost(rating, 'PARTIALLY_SUPPORTED');
    missingHoldPointFlag = true;
    visitPlannerFlag = true;
    visitPlannerReason = visitPlannerReason ?? 'Mandatory hold point has no independent inspection evidence.';
  }
  if (facts.usableEvidence.length > 0 && (facts.coveragePct === null || facts.coveragePct < CAP_MIN_COVERAGE_PCT)) {
    caps.push('COVERAGE_BELOW_50_PCT');
    rating = atMost(rating, 'PARTIALLY_SUPPORTED');
  }
  if (rating === 'CONTRADICTED' || rating === 'UNSUPPORTED') visitPlannerFlag = true;
  if (!visitPlannerFlag) visitPlannerReason = null;

  const usableIds = new Set(facts.usableEvidence.map((e) => e.id));
  const corroborating = proposal.corroboratingEvidenceLogIds.filter((id) => usableIds.has(id));

  const notes: string[] = [];
  if (caps.length > 0) notes.push(`Rules applied: ${caps.map((c) => CAP_TEXT[c]).join('; ')}.`);
  if (facts.mismatchedUnits.length > 0) {
    notes.push(`Quantities in other units were not counted (${facts.mismatchedUnits.join(', ')}; BOQ unit ${line.unit}).`);
  }
  if (facts.outsideGeofenceEvidenceIds.length > 0) {
    notes.push(`${facts.outsideGeofenceEvidenceIds.length} report(s) outside the geofence were not counted.`);
  }
  if (facts.withinToleranceEvidenceIds.length > 0) {
    notes.push(
      `${facts.withinToleranceEvidenceIds.length} report(s) were outside the site boundary but within the project's tolerance and were counted.`
    );
  }
  if (facts.unknownLocationEvidenceIds.length > 0) {
    notes.push(
      `${facts.unknownLocationEvidenceIds.length} report(s) without a usable location fix were not counted.`
    );
  }

  return {
    rating,
    rationale: [proposal.rationale, ...notes].join(' '),
    visitPlannerFlag,
    visitPlannerReason,
    missingHoldPointFlag,
    corroboratingEvidenceLogIds: corroborating,
    highestCorroboratingRoleName: facts.topEvidence?.roleName ?? null,
    highestCorroboratingWeight: facts.topEvidence?.weight ?? null,
    ruleCapsApplied: caps,
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/** Structured input for a model rater. Free text is separated so it can be marked untrusted. */
export interface ModelRaterInput {
  projectName: string;
  ipcNumber: number;
  periodStart: string;
  periodEnd: string;
  lines: Array<{
    boqItemId: string;
    wbsCode: string;
    unit: string;
    isHoldPoint: boolean;
    isOpaqueLumpSum: boolean;
    previousCertifiedPct: number;
    contractorClaimedPct: number;
    contractorClaimedNgn: number;
    claimedPeriodQuantity: number;
    evidencedQuantity: number;
    coveragePct: number | null;
    independentCoveragePct: number | null;
    hasIndependentEvidence: boolean;
    holdPointHasIndependentEvidence: boolean;
    blockersReported: boolean;
    evidence: Array<{
      id: string;
      fieldPersonaType: string;
      reporterRoleName: string;
      assuranceWeight: number;
      capturedAt: string;
      quantities: Array<{ quantity: number; unit: string }>;
    }>;
  }>;
  /** Text written by people, including the party being assessed. Data only, never instructions. */
  untrustedText: Array<{ ref: string; kind: string; text: string }>;
}

export interface ModelRaterOutput {
  lineEvaluations: Array<{
    boqItemId: string;
    evidenceStrengthRating: EvidenceStrengthRating;
    aiRationale: string;
    visitPlannerFlag: boolean;
    visitPlannerReason: string | null;
    corroboratingEvidenceLogIds: string[];
  }>;
  executiveSummaryNote: string;
  deploymentName: string;
}

/** Returns null when no model is configured. Throws when the provider fails. */
export type ModelRater = (input: ModelRaterInput) => Promise<ModelRaterOutput | null>;

export interface ReconciliationLineResult extends CappedLineResult {
  ipcLineItemId: string;
  boqItemId: string;
  evidenceQuantityTotal: number;
  evidenceCoveragePct: number | null;
  ratingEngine: RatingEngine;
}

export interface ReconciliationResult {
  engine: RatingEngine;
  engineDetail: string;
  executiveSummary: string;
  lines: ReconciliationLineResult[];
}

function buildModelInput(
  ctx: { projectName: string; ipcNumber: number; periodStart: Date; periodEnd: Date },
  lines: ReconciliationLineInput[],
  factsById: Map<string, LineFacts>
): ModelRaterInput {
  const untrustedText: ModelRaterInput['untrustedText'] = [];
  const out = lines.map((line) => {
    const facts = factsById.get(line.ipcLineItemId)!;
    untrustedText.push({ ref: line.boqItemId, kind: 'BOQ_DESCRIPTION', text: line.description });
    if (line.contractorRemarks) {
      untrustedText.push({ ref: line.boqItemId, kind: 'CONTRACTOR_REMARK', text: line.contractorRemarks });
    }
    for (const e of facts.usableEvidence) {
      if (e.summary) untrustedText.push({ ref: e.id, kind: 'FIELD_SUMMARY', text: e.summary });
      for (const b of e.blockers) untrustedText.push({ ref: e.id, kind: 'FIELD_BLOCKER', text: b });
    }
    return {
      boqItemId: line.boqItemId,
      wbsCode: line.wbsCode,
      unit: line.unit,
      isHoldPoint: line.isHoldPoint,
      isOpaqueLumpSum: line.isOpaqueLumpSum,
      previousCertifiedPct: line.previousCertifiedPct,
      contractorClaimedPct: line.contractorClaimedPct,
      contractorClaimedNgn: line.contractorClaimedNgn,
      claimedPeriodQuantity: facts.claimedPeriodQuantity,
      evidencedQuantity: facts.evidencedQuantity,
      coveragePct: facts.coveragePct,
      independentCoveragePct: facts.independentCoveragePct,
      hasIndependentEvidence: facts.hasIndependentEvidence,
      holdPointHasIndependentEvidence: facts.holdPointHasIndependentEvidence,
      blockersReported: facts.blockersReported,
      evidence: facts.usableEvidence.map((e) => ({
        id: e.id,
        fieldPersonaType: e.fieldPersonaType,
        reporterRoleName: e.reporterRoleName,
        assuranceWeight: e.assuranceWeight,
        capturedAt: e.capturedAt,
        quantities: e.quantities.map((q) => ({ quantity: q.quantity, unit: q.unit })),
      })),
    };
  });
  return {
    projectName: ctx.projectName,
    ipcNumber: ctx.ipcNumber,
    periodStart: ctx.periodStart.toISOString(),
    periodEnd: ctx.periodEnd.toISOString(),
    lines: out,
    untrustedText,
  };
}

function rulesSummary(
  ipcNumber: number,
  results: ReconciliationLineResult[],
  labels: ResolvedRatingLabels
): string {
  const count = (r: EvidenceStrengthRating) => results.filter((l) => l.rating === r).length;
  const parts = (['SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED', 'CONTRADICTED'] as const)
    .map((r) => `${count(r)} ${labels[r].label}`)
    .join(', ');
  const holdPoints = results.filter((l) => l.missingHoldPointFlag).length;
  return (
    `Rules engine evaluated ${results.length} line item(s) on IPC #${ipcNumber}: ${parts}.` +
    (holdPoints > 0 ? ` ${holdPoints} hold point(s) lack independent evidence.` : '')
  );
}

export async function evaluateIpcLines(params: {
  projectName: string;
  ipcNumber: number;
  periodStart: Date;
  periodEnd: Date;
  lines: ReconciliationLineInput[];
  evidence: ProvidedEvidenceItem[];
  labels: ResolvedRatingLabels;
  model?: ModelRater | null;
}): Promise<ReconciliationResult> {
  const period = { start: params.periodStart, end: params.periodEnd };
  const factsById = new Map(
    params.lines.map((l) => [l.ipcLineItemId, computeLineFacts(l, params.evidence, period)])
  );

  let modelOutput: ModelRaterOutput | null = null;
  let engineDetail = 'AI provider not configured';
  if (params.model) {
    try {
      modelOutput = await params.model(buildModelInput(params, params.lines, factsById));
      if (modelOutput) {
        const got = new Set(modelOutput.lineEvaluations.map((e) => e.boqItemId));
        const missing = params.lines.filter((l) => !got.has(l.boqItemId));
        if (missing.length > 0) {
          engineDetail = `AI response omitted ${missing.length} line(s); rules engine used`;
          modelOutput = null;
        }
      }
    } catch (error) {
      const name = error instanceof Error ? error.name : 'Error';
      engineDetail = `AI provider error (${name}); rules engine used`;
      modelOutput = null;
    }
  }

  const engine: RatingEngine = modelOutput ? 'AZURE_OPENAI' : 'RULES_ENGINE';
  const evalByBoq = new Map(modelOutput?.lineEvaluations.map((e) => [e.boqItemId, e]) ?? []);

  const lines = params.lines.map((line): ReconciliationLineResult => {
    const facts = factsById.get(line.ipcLineItemId)!;
    const ev = evalByBoq.get(line.boqItemId);
    const proposal: EngineLineProposal = ev
      ? {
          rating: ev.evidenceStrengthRating,
          rationale: ev.aiRationale,
          visitPlannerFlag: ev.visitPlannerFlag,
          visitPlannerReason: ev.visitPlannerReason,
          corroboratingEvidenceLogIds: ev.corroboratingEvidenceLogIds,
        }
      : rulesEngineRate(line, facts);
    return {
      ...applyRuleCaps(line, facts, proposal),
      ipcLineItemId: line.ipcLineItemId,
      boqItemId: line.boqItemId,
      evidenceQuantityTotal: facts.evidencedQuantity,
      evidenceCoveragePct: facts.coveragePct === null ? null : Math.min(facts.coveragePct, 9_999_999),
      ratingEngine: engine,
    };
  });

  return {
    engine,
    engineDetail: modelOutput ? modelOutput.deploymentName : engineDetail,
    executiveSummary: modelOutput
      ? modelOutput.executiveSummaryNote
      : rulesSummary(params.ipcNumber, lines, params.labels),
    lines,
  };
}
