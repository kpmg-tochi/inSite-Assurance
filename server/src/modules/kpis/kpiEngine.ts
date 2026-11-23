import { addDays, KPI_CATALOGUE, KpiKey, KpiPeriod, ProjectTypeConfig } from '@insite/shared';

/**
 * Programme KPI engine (Phase 16): one pure function per catalogue KPI. Each takes the facts of
 * one project (loaded in batches by `kpiFacts.ts`) and the period, and returns the project's
 * numerator and denominator, or null when the project does not track the KPI (its inputs are not
 * configured). A tracked project may still contribute 0/0 when nothing fell in the period.
 *
 * Dates are `YYYY-MM-DD` strings in the project's zone; timestamps are converted by the loader.
 */

export interface KpiMilestoneFact {
  completionMode: string;
  anchor: string;
  requiredDocumentTypeCodes: string[];
  dueDate: string | null;
  status: string;
  completedDate: string | null;
}

export interface KpiKickoffFact {
  /** The meeting date (scheduled, or the project's kick-off date when no meeting is recorded). */
  date: string;
  hasMeeting: boolean;
  hasAgenda: boolean;
  heldDate: string | null;
  minutesSigned: boolean;
  invited: number;
  attended: number;
}

export interface KpiObligationCounts {
  /** Owed and past their late time, or no longer pending (excused excluded). */
  due: number;
  /** SUBMITTED (on time). */
  onTime: number;
  /** SUBMITTED or LATE. */
  done: number;
}

export interface KpiDurationSum {
  totalDays: number;
  count: number;
}

export interface KpiProjectFacts {
  projectId: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  constructionPhase: 'ACTIVE_CONSTRUCTION' | 'HANDOVER_IN_PROGRESS' | 'RETENTION_PERIOD' | 'COMPLETED_CLOSED';
  /** Today in the project's zone. */
  today: string;
  /** The project's own rules (snapshot); null for a project without a type. */
  typeConfig: ProjectTypeConfig | null;
  requireReportApproval: boolean;
  budgetNgn: number;
  disbursedNgn: number;
  scheduleStatus: string | null;
  plannedEndDate: string | null;
  kickoff: KpiKickoffFact | null;
  milestones: KpiMilestoneFact[];
  hasSupervisor: boolean;
  /** Codes of document types with a non-archived document in the register. */
  documentTypeCodes: Set<string>;
  activeStreamCount: number;
  /** Visit types of the project's active inspection streams. */
  inspectionStreamVisitTypes: string[];
  hasApprovedBaseline: boolean;
  /** Any obligation was ever generated (the project reports on a cadence). */
  hasObligations: boolean;
  /** Obligations whose period starts in the KPI period. */
  inspectionObligations: KpiObligationCounts;
  allObligations: KpiObligationCounts;
  approvals: KpiDurationSum;
  /** The live (issued) Certificate of Completion. */
  certificate: { issuedDate: string; completionDate: string } | null;
  /** Overall finding of the latest approved final evaluation. */
  finalEvaluationFinding: string | null;
  /** Stored closure checklist rows (key → status). */
  closureItemStatus: Map<string, string>;
  publishedLessonCount: number;
}

export interface KpiCount {
  numerator: number;
  denominator: number;
}

type KpiFn = (f: KpiProjectFacts, period: KpiPeriod) => KpiCount | null;

const inPeriod = (date: string | null, period: KpiPeriod) => Boolean(date) && date! >= period.from && date! <= period.to;
const LIVE = (f: KpiProjectFacts) => f.status === 'ACTIVE' && f.constructionPhase !== 'COMPLETED_CLOSED';
const UNDER_CONSTRUCTION = (f: KpiProjectFacts) => f.status === 'ACTIVE' && f.constructionPhase === 'ACTIVE_CONSTRUCTION';
const CLOSED = (f: KpiProjectFacts) => f.constructionPhase === 'COMPLETED_CLOSED';
const one = (met: boolean): KpiCount => ({ numerator: met ? 1 : 0, denominator: 1 });

/**
 * Milestones met by their due date. Tracked when the project has a matching milestone that is not
 * waived. Counted: milestones due in the period that are already due (or done early); met: done
 * on or before the due date.
 */
export function milestonesOnTime(f: KpiProjectFacts, period: KpiPeriod, match: (m: KpiMilestoneFact) => boolean): KpiCount | null {
  const list = f.milestones.filter((m) => match(m) && m.status !== 'WAIVED');
  if (list.length === 0) return null;
  let numerator = 0;
  let denominator = 0;
  for (const m of list) {
    if (!m.dueDate || !inPeriod(m.dueDate, period)) continue;
    const done = m.status === 'DONE';
    if (!done && m.dueDate >= f.today) continue; // not due yet
    denominator += 1;
    if (done && m.completedDate !== null && m.completedDate <= m.dueDate) numerator += 1;
  }
  return { numerator, denominator };
}

/** Days a meeting's minutes may take before the KPI counts the meeting as undocumented. */
export const MINUTES_GRACE_DAYS = 7;

export const KPI_FUNCTIONS: Record<KpiKey, KpiFn> = {
  // Kick-off ----------------------------------------------------------------------------------
  kickoff_agenda_prepared: (f, period) => {
    if (!f.kickoff) return null;
    const k = f.kickoff;
    if (!inPeriod(k.date, period) || (k.date > f.today && !k.hasAgenda)) return { numerator: 0, denominator: 0 };
    return one(k.hasAgenda);
  },
  kickoff_notice_on_time: (f, period) => milestonesOnTime(f, period, (m) => m.completionMode === 'AUTO_KICKOFF_NOTICE_SENT'),
  kickoff_attendance_rate: (f, period) => {
    if (!f.kickoff?.hasMeeting) return null;
    const k = f.kickoff;
    if (!inPeriod(k.heldDate, period) || k.invited === 0) return { numerator: 0, denominator: 0 };
    return { numerator: k.attended, denominator: k.invited };
  },
  kickoff_minutes_signed: (f, period) => {
    if (!f.kickoff?.hasMeeting) return null;
    const k = f.kickoff;
    if (!k.heldDate || !inPeriod(k.heldDate, period)) return { numerator: 0, denominator: 0 };
    if (!k.minutesSigned && addDays(k.heldDate, MINUTES_GRACE_DAYS) > f.today) return { numerator: 0, denominator: 0 };
    return one(k.minutesSigned);
  },
  // Mobilisation ------------------------------------------------------------------------------
  supervisors_assigned: (f) => {
    if (!f.typeConfig?.supervision.supervisorRoleCodes.length || !LIVE(f)) return null;
    return one(f.hasSupervisor);
  },
  introduction_letters_on_time: (f, period) =>
    milestonesOnTime(f, period, (m) => m.requiredDocumentTypeCodes.includes('LETTER_OF_INTRODUCTION')),
  contractors_mobilised_on_time: (f, period) => milestonesOnTime(f, period, (m) => m.completionMode === 'AUTO_CONTRACTOR_ON_SITE'),
  mobilisation_documents_complete: (f) => {
    const codes = f.typeConfig?.documentRequirements.beforeMobilisation ?? [];
    if (codes.length === 0 || !UNDER_CONSTRUCTION(f)) return null;
    return one(codes.every((c) => f.documentTypeCodes.has(c)));
  },
  // Monitoring and evaluation -----------------------------------------------------------------
  monitoring_framework_established: (f) => {
    const expected = (f.typeConfig?.reportingStreams.length ?? 0) > 0 || f.activeStreamCount > 0;
    if (!expected || !UNDER_CONSTRUCTION(f)) return null;
    return one(f.activeStreamCount > 0);
  },
  baseline_uploaded: (f) => {
    const usesBaseline =
      f.inspectionStreamVisitTypes.includes('BASELINE') || Boolean(f.typeConfig?.inspections.templateCodeByVisitType.BASELINE);
    if (!usesBaseline || !LIVE(f)) return null;
    return one(f.hasApprovedBaseline);
  },
  visits_conducted: (f) => {
    if (f.inspectionStreamVisitTypes.length === 0) return null;
    return { numerator: f.inspectionObligations.done, denominator: f.inspectionObligations.due };
  },
  reports_on_time: (f) => {
    if (!f.hasObligations) return null;
    return { numerator: f.allObligations.onTime, denominator: f.allObligations.due };
  },
  approval_turnaround_days: (f) => {
    if (!f.requireReportApproval && f.approvals.count === 0) return null;
    return { numerator: f.approvals.totalDays, denominator: f.approvals.count };
  },
  // Payments ----------------------------------------------------------------------------------
  financial_utilisation: (f) => {
    if (!(f.budgetNgn > 0)) return null;
    return { numerator: f.disbursedNgn, denominator: f.budgetNgn };
  },
  // Completion and closure --------------------------------------------------------------------
  verified_on_time: (f, period) => {
    if (!f.plannedEndDate) return null;
    const c = f.certificate;
    if (!c || !inPeriod(c.issuedDate, period)) return { numerator: 0, denominator: 0 };
    return one(c.completionDate <= f.plannedEndDate && f.finalEvaluationFinding !== 'MAJOR_ISSUES');
  },
  handed_over_on_time: (f, period) =>
    milestonesOnTime(f, period, (m) => m.anchor === 'COC_ISSUED' && m.completionMode === 'AUTO_HANDOVER_ACCEPTED'),
  closure_documentation_complete: (f) => {
    const closure = f.typeConfig?.closure;
    const codes = [...(closure?.beforeClose ?? []), ...(closure?.beforeArchive ?? [])]
      .filter((i) => i.kind === 'DOCUMENT_TYPE' && i.documentTypeCode)
      .map((i) => i.documentTypeCode!);
    if (codes.length === 0) return null;
    if (f.constructionPhase !== 'RETENTION_PERIOD' && !CLOSED(f)) return null;
    return one(codes.every((c) => f.documentTypeCodes.has(c)));
  },
  lessons_documented: (f) => {
    if (!CLOSED(f)) return null;
    return one(f.publishedLessonCount > 0);
  },
  audited_post_closure: (f) => {
    const closure = f.typeConfig?.closure;
    const keys = [...(closure?.beforeClose ?? []), ...(closure?.beforeArchive ?? [])].filter((i) => i.kind === 'AUDIT_SIGNOFF').map((i) => i.key);
    if (keys.length === 0 || !CLOSED(f)) return null;
    return one(keys.every((k) => f.closureItemStatus.get(k) === 'DONE'));
  },
  // Schedule ----------------------------------------------------------------------------------
  projects_on_schedule: (f) => {
    if (!UNDER_CONSTRUCTION(f) || !f.scheduleStatus || ['UNSCHEDULED', 'NOT_STARTED'].includes(f.scheduleStatus)) return null;
    return one(['ON_TRACK', 'AHEAD', 'COMPLETE'].includes(f.scheduleStatus));
  },
};

/** Every KPI of one project: null entries are not tracked. */
export function computeProjectKpis(f: KpiProjectFacts, period: KpiPeriod): Record<KpiKey, KpiCount | null> {
  const out = {} as Record<KpiKey, KpiCount | null>;
  for (const def of KPI_CATALOGUE) out[def.key] = KPI_FUNCTIONS[def.key](f, period);
  return out;
}

/** Sums per-project counts; `tracked` is the number of projects that track the KPI. */
export function sumCounts(counts: Array<KpiCount | null | undefined>): KpiCount & { tracked: number } {
  let numerator = 0;
  let denominator = 0;
  let tracked = 0;
  for (const c of counts) {
    if (!c) continue;
    tracked += 1;
    numerator += c.numerator;
    denominator += c.denominator;
  }
  return { numerator, denominator, tracked };
}
