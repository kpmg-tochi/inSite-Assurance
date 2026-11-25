/**
 * Redesign R5a: Home's layout and project cards (pure; tested in Node). D-R5.7: an account with
 * exactly one ACTIVE project sees that project's card fully instead of the list; the calendar and
 * "+ Unscheduled visit" stay. Same screen and permissions for every field role (no persona branches).
 * Cards are built from the baseline pack (D-R5.3) and the visits on the phone (feed + overlays).
 */
import {
  daysBetween,
  formatProjectCode,
  parseLotBatchCode,
  sprintForDate,
  unitsActiveInSprint,
  VISIT_KIND_META,
  type BaselineFacilityUnit,
  type BaselineOpenFinding,
  type BaselineSprint,
  type MobileBaselinePack,
} from '@insite/shared';
import type { VisitView } from './visitCalendar';
import { formatDay } from './visitText';

export type HomeMode = { mode: 'SINGLE'; projectId: string } | { mode: 'LIST' };

/** SINGLE when exactly one project is ACTIVE (packs not downloaded yet count as unknown, not active). */
export function homeMode(projects: Array<{ projectId: string; projectStatus: string | null | undefined }>): HomeMode {
  const active = projects.filter((p) => p.projectStatus === 'ACTIVE');
  return active.length === 1 ? { mode: 'SINGLE', projectId: active[0].projectId } : { mode: 'LIST' };
}

export interface MobilisationProgress {
  label: string;
  /**
   * Worded as the web portal's deadline text (`daysLeftLabel`): "5 days left, due Sun 29 Nov",
   * "Due today", "3 days overdue". Null without both dates.
   */
  dayText: string | null;
  /** Day N of the window since the kick-off (kick-off day = 1). */
  dayNumber: number | null;
  totalDays: number | null;
  deadline: string | null;
  overdue: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Time left to the contractor-on-site deadline, for today (project zone). */
export function mobilisationProgress(m: MobileBaselinePack['mobilisation'], today: string): MobilisationProgress | null {
  if (!m) return null;
  const overdue = Boolean(m.deadline && today > m.deadline);
  if (!m.startedOn || !m.deadline) return { label: m.label, dayText: null, dayNumber: null, totalDays: null, deadline: m.deadline, overdue };
  const total = daysBetween(m.startedOn, m.deadline) + 1;
  const day = daysBetween(m.startedOn, today) + 1;
  const left = daysBetween(today, m.deadline);
  const dayText = overdue
    ? `${plural(-left, 'day')} overdue`
    : left === 0
      ? 'Due today'
      : `${plural(left, 'day')} left, due ${formatDay(m.deadline)}`;
  return { label: m.label, dayText, dayNumber: Math.max(1, day), totalDays: total, deadline: m.deadline, overdue };
}

export interface ProjectCardModel {
  projectId: string;
  /** The code as people read it ("LOT 5 BATCH 7"; older codes as stored). */
  code: string;
  /** From a lot/batch code (the lot's year); null for older codes. */
  interventionYear: number | null;
  name: string;
  school: string | null;
  address: string | null;
  contractorName: string | null;
  projectStatus: string | null;
  stageLabel: string | null;
  /** The sprint covering today (or the latest started); null before sprint 1 or without sprints. */
  currentSprint: BaselineSprint | null;
  /** "Work phase 3 of 5", "Work phase 1 starts Sun 1 Nov" or null. */
  sprintText: string | null;
  nextSprint: BaselineSprint | null;
  /** Units whose start–end sprints cover the current sprint. */
  unitsInSprint: BaselineFacilityUnit[];
  openFindings: BaselineOpenFinding[];
  openFindingCount: number;
  openDefectCount: number;
  nextVisit: { visitId: string; date: string; kindLabel: string; datePending: boolean } | null;
  /** Overdue or returned visits on this project. */
  attentionCount: number;
  mobilisation: MobilisationProgress | null;
  /** The pack has not been downloaded yet (card shows the name only). */
  packMissing: boolean;
}

/**
 * The card for a project: from its pack (may be null before the first download) and the visits on the
 * phone for it (`views`, built with visitView for the project's today).
 */
export function projectCardModel(
  base: { projectId: string; code: string; name: string },
  pack: MobileBaselinePack | null,
  views: VisitView[],
  today: string
): ProjectCardModel {
  const sprints = [...(pack?.sprints ?? [])].sort((a, b) => a.number - b.number);
  const current = sprintForDate(sprints, today);
  const next = sprints.find((s) => s.startDate > today) ?? null;
  const units = pack?.facilityUnits ?? [];
  let sprintText: string | null = null;
  if (current) sprintText = `Work phase ${current.number} of ${sprints.length}`;
  else if (next) sprintText = `Work phase ${next.number} starts ${formatDay(next.startDate)}`;
  const mine = views.filter((v) => v.projectId === base.projectId);
  const upcoming = mine
    .filter((v) => !v.submitted && (v.status === 'PLANNED' || v.status === 'IN_PROGRESS') && v.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  return {
    projectId: base.projectId,
    code: formatProjectCode(pack?.codePrefix ?? base.code),
    interventionYear: interventionYearOfCode(pack?.codePrefix ?? base.code),
    name: pack?.name ?? base.name,
    school: pack?.school ?? null,
    address: pack?.address ?? null,
    contractorName: pack?.contractorName ?? null,
    projectStatus: pack?.projectStatus ?? null,
    stageLabel: pack?.stage ? (pack.stage.subLabel ? `${pack.stage.currentLabel} · ${pack.stage.subLabel}` : pack.stage.currentLabel) : null,
    currentSprint: current,
    sprintText,
    nextSprint: next,
    unitsInSprint: current ? unitsActiveInSprint(units, current.number) : [],
    openFindings: pack?.openFindings ?? [],
    openFindingCount: pack?.openFindings?.length ?? 0,
    openDefectCount: pack?.openDefectCount ?? 0,
    nextVisit: upcoming ? { visitId: upcoming.id, date: upcoming.date, kindLabel: VISIT_KIND_META[upcoming.visitKind]?.label ?? upcoming.kindLabel, datePending: upcoming.datePending } : null,
    attentionCount: mine.filter((v) => v.overdue || v.returned).length,
    mobilisation: mobilisationProgress(pack?.mobilisation ?? null, today),
    packMissing: !pack,
  };
}

/** The intervention year a lot/batch code carries ("2026-LOT-5-BATCH-7" → 2026); null for older codes. */
export function interventionYearOfCode(code: string | null | undefined): number | null {
  return parseLotBatchCode(code)?.year ?? null;
}

/** Units grouped by facility, in pack order (project screen). */
export function unitsByFacility(units: BaselineFacilityUnit[]): Array<{ facilityId: string; facilityName: string; units: BaselineFacilityUnit[] }> {
  const out: Array<{ facilityId: string; facilityName: string; units: BaselineFacilityUnit[] }> = [];
  for (const u of units) {
    let g = out.find((x) => x.facilityId === u.facilityId);
    if (!g) {
      g = { facilityId: u.facilityId, facilityName: u.facilityName, units: [] };
      out.push(g);
    }
    g.units.push(u);
  }
  return out;
}
