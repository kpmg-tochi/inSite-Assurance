import type { NeedsRubric, ScoreDimension } from '../schemas/needsPipeline.schema';

/**
 * Needs pipeline N1: prioritisation maths (A6, D-N.10), pure.
 *
 * Each committee member scores every sub-criterion 1–5. A sub-criterion's score is the mean over
 * the members' sheets; a dimension's score is the mean of its sub-criteria (equal sub-weights),
 * shown on 0–100 (mean ÷ scale); the total is the dimensions weighted (Impact 60, Ease 40).
 * Example: Impact 4.5/5 and Ease 3/5 give 90 × 0.6 + 60 × 0.4 = 78.
 *
 * Divergent scores are flagged, never silently averaged away: the mean is still shown, with the
 * sub-criteria whose scores are `divergenceThreshold` or more apart.
 */

type RubricForScoring = Pick<NeedsRubric, 'scale' | 'dimensions' | 'criteria'>;

/** One member's scores: criterion key → 1 … scale. */
export interface ScoreSheetValues {
  scores: Readonly<Record<string, number>>;
}

export interface ProposalScore {
  /** 0–100. */
  impact: number;
  /** 0–100. */
  ease: number;
  /** 0–100, the weighted sum. */
  total: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function mean(values: number[]): number | null {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

/** Mean score per criterion over the sheets that scored it. */
export function criterionMeans(sheets: readonly ScoreSheetValues[], rubric: Pick<NeedsRubric, 'criteria'>): Map<string, number> {
  const out = new Map<string, number>();
  for (const criterion of rubric.criteria) {
    const m = mean(sheets.map((s) => s.scores[criterion.key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v)));
    if (m !== null) out.set(criterion.key, m);
  }
  return out;
}

/** The score of a proposal from its members' sheets; null when no sheet scored a dimension. */
export function proposalScore(sheets: readonly ScoreSheetValues[], rubric: RubricForScoring): ProposalScore | null {
  if (sheets.length === 0) return null;
  const means = criterionMeans(sheets, rubric);
  const dimensionPct = (dimension: ScoreDimension): number | null => {
    const m = mean(rubric.criteria.filter((c) => c.dimension === dimension && means.has(c.key)).map((c) => means.get(c.key)!));
    return m === null ? null : (m / rubric.scale) * 100;
  };
  const impact = dimensionPct('IMPACT');
  const ease = dimensionPct('EASE');
  if (impact === null || ease === null) return null;
  const weight = (dimension: ScoreDimension) => rubric.dimensions.find((d) => d.key === dimension)?.weight ?? 0;
  const total = (impact * weight('IMPACT') + ease * weight('EASE')) / 100;
  return { impact: round2(impact), ease: round2(ease), total: round2(total) };
}

export interface DivergentCriterion {
  criterionKey: string;
  min: number;
  max: number;
  spread: number;
}

/** Sub-criteria whose highest and lowest score are `threshold` or more apart (D-N.10: ≥ 2 points). */
export function divergentCriteria(sheets: readonly ScoreSheetValues[], threshold: number): DivergentCriterion[] {
  const byKey = new Map<string, number[]>();
  for (const sheet of sheets) {
    for (const [key, value] of Object.entries(sheet.scores)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      byKey.set(key, [...(byKey.get(key) ?? []), value]);
    }
  }
  const out: DivergentCriterion[] = [];
  for (const [criterionKey, values] of byKey) {
    if (values.length < 2) continue;
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (max - min >= threshold) out.push({ criterionKey, min, max, spread: max - min });
  }
  return out;
}

export interface RankInput {
  id: string;
  /** For a stable order when everything else is equal. */
  reference: string;
  /** Null until the proposal has a score. */
  score: ProposalScore | null;
  /** The costed amount (₦); null when not costed. */
  costNgn: number | null;
}

export interface RankedProposal extends RankInput {
  /** 1 = first; null for a proposal without a score (listed last). */
  rank: number | null;
}

/**
 * Proposals in priority order: higher total first; ties by higher Impact, then lower cost (D-N.10),
 * then the reference so the order never depends on the input order. Unscored proposals come last,
 * unranked.
 */
export function rankProposals(items: readonly RankInput[]): RankedProposal[] {
  const scored = items.filter((i) => i.score !== null);
  const unscored = items.filter((i) => i.score === null);
  const cost = (i: RankInput) => (i.costNgn === null ? Number.POSITIVE_INFINITY : i.costNgn);
  scored.sort(
    (a, b) =>
      b.score!.total - a.score!.total ||
      b.score!.impact - a.score!.impact ||
      cost(a) - cost(b) ||
      a.reference.localeCompare(b.reference)
  );
  unscored.sort((a, b) => a.reference.localeCompare(b.reference));
  return [...scored.map((item, i) => ({ ...item, rank: i + 1 })), ...unscored.map((item) => ({ ...item, rank: null }))];
}

export interface FundingLine {
  /** How many ranked proposals are above the line. */
  linePosition: number;
  totalAboveNgn: number;
  items: Array<{ id: string; rank: number | null; cumulativeNgn: number | null; aboveLine: boolean }>;
}

/**
 * Where the indicative ceiling falls in the ranked list: proposals are taken in rank order while the
 * running total stays within the ceiling, and the line is drawn at the first one that does not fit
 * (nothing below it is pulled up to use the remainder: that is a committee override, with a reason).
 * Without a ceiling every ranked proposal is above the line. Unranked and uncosted proposals are
 * below it.
 */
export function fundingLine(ranked: readonly RankedProposal[], ceilingNgn: number | null): FundingLine {
  let running = 0;
  let closed = false;
  let linePosition = 0;
  const items = ranked.map((p) => {
    if (p.rank === null || p.costNgn === null) return { id: p.id, rank: p.rank, cumulativeNgn: null, aboveLine: false };
    const cumulativeNgn = round2(running + p.costNgn);
    if (!closed && (ceilingNgn === null || cumulativeNgn <= ceilingNgn)) {
      running = cumulativeNgn;
      linePosition += 1;
      return { id: p.id, rank: p.rank, cumulativeNgn, aboveLine: true };
    }
    closed = true;
    running = cumulativeNgn;
    return { id: p.id, rank: p.rank, cumulativeNgn, aboveLine: false };
  });
  const totalAboveNgn = round2(ranked.filter((p, i) => items[i].aboveLine).reduce((s, p) => s + (p.costNgn ?? 0), 0));
  return { linePosition, totalAboveNgn, items };
}

export interface ResolvedRankingItem {
  id: string;
  rank: number | null;
  cumulativeNgn: number | null;
  /** Above the line the ceiling (or the chair's line position) draws. */
  computedAboveLine: boolean;
  /** After the chair's placement, if any. */
  aboveLine: boolean;
  placement: 'ABOVE' | 'BELOW' | null;
}

export interface ResolvedRanking {
  /** Where the ceiling draws the line (`fundingLine`). */
  computedLinePosition: number;
  /** The line in force: the chair's position, else the computed one. */
  linePosition: number;
  /** Sum of the costs of the proposals above the line after placements. */
  totalAboveNgn: number;
  items: ResolvedRankingItem[];
}

/**
 * Needs pipeline wave 3 (B3): the committee's line (D-N.10). The ceiling draws a line
 * (`fundingLine`); the chair may move it (`linePosition`: the first N ranked proposals are above)
 * and may place single proposals above or below it, each with a reason (`placements`). A placement
 * wins over the line; an unranked or uncosted proposal is above only when placed there.
 */
export function resolveRankingLine(params: {
  ranked: readonly RankedProposal[];
  ceilingNgn: number | null;
  linePosition: number | null;
  placements: ReadonlyMap<string, 'ABOVE' | 'BELOW'>;
}): ResolvedRanking {
  const computed = fundingLine(params.ranked, params.ceilingNgn);
  const rankedCount = params.ranked.filter((p) => p.rank !== null && p.costNgn !== null).length;
  const linePosition = params.linePosition === null ? computed.linePosition : Math.min(params.linePosition, rankedCount);
  let rankedSeen = 0;
  const items = params.ranked.map((p, i) => {
    const line = computed.items[i];
    let computedAboveLine: boolean;
    if (params.linePosition === null) computedAboveLine = line.aboveLine;
    else if (p.rank === null || p.costNgn === null) computedAboveLine = false;
    else computedAboveLine = ++rankedSeen <= linePosition;
    const placement = params.placements.get(p.id) ?? null;
    const aboveLine = placement === 'ABOVE' ? true : placement === 'BELOW' ? false : computedAboveLine;
    return { id: p.id, rank: p.rank, cumulativeNgn: line.cumulativeNgn, computedAboveLine, aboveLine, placement };
  });
  const totalAboveNgn = round2(params.ranked.reduce((sum, p, i) => sum + (items[i].aboveLine ? (p.costNgn ?? 0) : 0), 0));
  return { computedLinePosition: computed.linePosition, linePosition, totalAboveNgn, items };
}
