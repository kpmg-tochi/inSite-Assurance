import {
  CONTRACTOR_RATING_COMPONENT_LABELS,
  ContractorPerformanceSettings,
  ContractorPerformanceSettingsSchema,
  ContractorRatingComponent,
  ContractorRatingComponentKey,
} from '../schemas/contractor.schema';

/**
 * Client demo updates F.3: a contractor's reliability, 0–5, from approved data only. Pure; the
 * server loads the facts in batches and stores a snapshot. Every component is scored 0–5:
 * - WORKMANSHIP: the 1–5 workmanship answer of accepted monitoring reports, weighted by recency
 *   (window, half-life);
 * - SCHEDULE: share of verified work phases MET on time, and mobilisation on time, as 0–5;
 * - FINDINGS: 5 minus major/critical findings per report (×2.5, floor 0), plus/minus how fast they
 *   were rectified (average days ≤ 14: +0.5; > 45: −0.5), clamped 0–5;
 * - CLOSURE: average of closure ratings (1–5) on completed projects.
 * A component with no facts has a null score and its weight is spread over the others.
 */

export interface ContractorRatingFacts {
  /** Accepted monitoring reports with a workmanship answer. */
  reports: { date: string; workmanship: number; projectId: string }[];
  workPhases: { verifiedMetOnTime: number; verified: number };
  mobilisation: { onTime: number; total: number };
  findings: { majorOrCritical: number; rectifiedAverageDays: number | null };
  /** Averages of the closure rating criteria per completed project (1–5). */
  closureRatings: number[];
}

export interface ContractorReliability {
  rated: boolean;
  score: number | null;
  stars: number | null;
  reportCount: number;
  projectCount: number;
  components: ContractorRatingComponent[];
  summary: string;
}

const DAY_MS = 86_400_000;

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

function clamp(v: number, lo = 0, hi = 5): number {
  return Math.min(hi, Math.max(lo, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** "★★★½" for 3.5; empty stars are not drawn. */
export function starGlyphs(stars: number | null): string {
  if (stars === null) return '';
  const full = Math.floor(stars);
  return '★'.repeat(full) + (stars - full >= 0.5 ? '½' : '');
}

export function contractorReliability(
  facts: ContractorRatingFacts,
  today: string,
  settingsInput?: Partial<ContractorPerformanceSettings> | null
): ContractorReliability {
  const settings = ContractorPerformanceSettingsSchema.parse(settingsInput ?? {});
  const windowDays = settings.windowMonths * 30.44;
  const halfLifeDays = settings.halfLifeMonths * 30.44;
  const inWindow = facts.reports.filter((r) => {
    const age = daysBetween(r.date, today);
    return age >= 0 && age <= windowDays && r.workmanship >= 1 && r.workmanship <= 5;
  });
  const reportCount = inWindow.length;
  const projectCount = new Set(inWindow.map((r) => r.projectId)).size;

  const raw: Record<ContractorRatingComponentKey, { score: number | null; basis: string }> = {
    WORKMANSHIP: { score: null, basis: 'No accepted reports yet' },
    SCHEDULE: { score: null, basis: 'No work phase verified yet' },
    FINDINGS: { score: null, basis: 'No accepted reports yet' },
    CLOSURE: { score: null, basis: 'No completed project rated yet' },
  };

  if (reportCount > 0) {
    let wSum = 0;
    let vSum = 0;
    for (const r of inWindow) {
      const w = Math.pow(0.5, daysBetween(r.date, today) / halfLifeDays);
      wSum += w;
      vSum += w * r.workmanship;
    }
    const avg = vSum / wSum;
    raw.WORKMANSHIP = { score: round1(clamp(avg)), basis: `${reportCount} report${reportCount === 1 ? '' : 's'}, recent ones count more` };

    const perReport = facts.findings.majorOrCritical / reportCount;
    let f = 5 - perReport * 2.5;
    const days = facts.findings.rectifiedAverageDays;
    if (days !== null) f += days <= 14 ? 0.5 : days > 45 ? -0.5 : 0;
    raw.FINDINGS = {
      score: round1(clamp(f)),
      basis: `${facts.findings.majorOrCritical} major or critical finding${facts.findings.majorOrCritical === 1 ? '' : 's'} on ${reportCount} report${reportCount === 1 ? '' : 's'}${days !== null ? `, rectified in ${Math.round(days)} days on average` : ''}`,
    };
  }

  const scheduleTotal = facts.workPhases.verified + facts.mobilisation.total;
  if (scheduleTotal > 0) {
    const share = (facts.workPhases.verifiedMetOnTime + facts.mobilisation.onTime) / scheduleTotal;
    raw.SCHEDULE = {
      score: round1(clamp(share * 5)),
      basis: `${facts.workPhases.verifiedMetOnTime} of ${facts.workPhases.verified} work phases met on time; mobilised on time ${facts.mobilisation.onTime} of ${facts.mobilisation.total}`,
    };
  }

  const closure = facts.closureRatings.filter((v) => v >= 1 && v <= 5);
  if (closure.length > 0) {
    const avg = closure.reduce((s, v) => s + v, 0) / closure.length;
    raw.CLOSURE = { score: round1(clamp(avg)), basis: `${closure.length} completed project${closure.length === 1 ? '' : 's'} rated` };
  }

  const keys: ContractorRatingComponentKey[] = ['WORKMANSHIP', 'SCHEDULE', 'FINDINGS', 'CLOSURE'];
  const baseWeight: Record<ContractorRatingComponentKey, number> = {
    WORKMANSHIP: settings.weights.workmanship,
    SCHEDULE: settings.weights.schedule,
    FINDINGS: settings.weights.findings,
    CLOSURE: settings.weights.closure,
  };
  const scored = keys.filter((k) => raw[k].score !== null);
  const scoredWeight = scored.reduce((s, k) => s + baseWeight[k], 0);
  const components: ContractorRatingComponent[] = keys.map((k) => ({
    key: k,
    label: CONTRACTOR_RATING_COMPONENT_LABELS[k],
    score: raw[k].score,
    weight: raw[k].score !== null && scoredWeight > 0 ? Math.round((baseWeight[k] / scoredWeight) * 1000) / 1000 : 0,
    basis: raw[k].basis,
  }));

  const rated = reportCount >= settings.minReports && scoredWeight > 0;
  if (!rated) {
    return {
      rated: false,
      score: null,
      stars: null,
      reportCount,
      projectCount,
      components,
      summary: `Not yet rated: ${reportCount} report${reportCount === 1 ? '' : 's'}`,
    };
  }
  const score = round1(components.reduce((s, c) => s + (c.score ?? 0) * c.weight, 0));
  const stars = Math.round(score * 2) / 2;
  return {
    rated: true,
    score,
    stars,
    reportCount,
    projectCount,
    components,
    summary: `${starGlyphs(stars)} ${score.toFixed(1)} · ${reportCount} reports on ${projectCount} project${projectCount === 1 ? '' : 's'}`,
  };
}
