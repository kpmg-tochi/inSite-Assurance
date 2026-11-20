import {
  allChecklistItems,
  INSPECTION_VISIT_TYPE_LABELS,
  isFailedAnswer,
  validateInspectionAnswers,
  type CadenceSettings,
  type ChecklistSection,
  type InspectionAnswerInput,
  type InspectionOverallFinding,
  type InspectionVisitType,
  type MobileBaselinePack,
  type MobileInspectionPack,
  type SubmissionGeotagInput,
  type SubmitSiteInspectionRequestInput,
} from '@insite/shared';

/**
 * Phase 14: site inspections on the device (pure; tested in Node).
 *
 * A draft lives in SQLite until the inspector confirms it; then it is queued as one SITE_INSPECTION
 * outbox row that waits for every photo it names, so the server always finds the captures. The
 * device asks for every photo the checklist requires before the inspector can confirm (the server
 * accepts an inspection without them and flags it, which covers web submissions).
 */

export type InspectionTemplate = MobileInspectionPack['templates'][number];

export interface DraftAnswer {
  value: string | number | null;
  comment: string;
  /** clientCaptureIds of photos taken for this item. */
  captureIds: string[];
}

export interface InspectionDraft {
  /** Becomes the clientReportId. */
  id: string;
  projectId: string;
  visitType: InspectionVisitType;
  templateId: string;
  templateVersion: number;
  /** YYYY-MM-DD in the project zone. */
  visitDate: string;
  answers: Record<string, DraftAnswer>;
  overallFinding: InspectionOverallFinding | null;
  summaryText: string;
  /** Index of the section screen the inspector was on (sections.length = the summary screen). */
  step: number;
  updatedAt: string;
}

export function emptyAnswer(): DraftAnswer {
  return { value: null, comment: '', captureIds: [] };
}

/** Visit types the person can inspect on this project (those with a template). */
export function visitTypesOffered(pack: MobileInspectionPack | null | undefined): InspectionVisitType[] {
  if (!pack?.canSubmitInspections) return [];
  return (Object.keys(pack.templateIdByVisitType ?? {}) as InspectionVisitType[]).sort(
    (a, b) => Object.keys(INSPECTION_VISIT_TYPE_LABELS).indexOf(a) - Object.keys(INSPECTION_VISIT_TYPE_LABELS).indexOf(b)
  );
}

export function templateForVisit(pack: MobileInspectionPack | null | undefined, visitType: InspectionVisitType): InspectionTemplate | null {
  const id = pack?.templateIdByVisitType?.[visitType];
  return pack?.templates.find((t) => t.id === id) ?? null;
}

export function newDraft(params: {
  id: string;
  projectId: string;
  visitType: InspectionVisitType;
  template: InspectionTemplate;
  visitDate: string;
  now: string;
}): InspectionDraft {
  return {
    id: params.id,
    projectId: params.projectId,
    visitType: params.visitType,
    templateId: params.template.id,
    templateVersion: params.template.version,
    visitDate: params.visitDate,
    answers: Object.fromEntries(allChecklistItems(params.template.sections).map((i) => [i.key, emptyAnswer()])),
    overallFinding: null,
    summaryText: '',
    step: 0,
    updatedAt: params.now,
  };
}

/** The answers in request form (every item of the template, in template order). */
export function draftAnswers(draft: InspectionDraft, sections: ChecklistSection[]): InspectionAnswerInput[] {
  return allChecklistItems(sections).map((item) => {
    const a = draft.answers[item.key] ?? emptyAnswer();
    const value = item.responseType === 'PHOTO_ONLY' ? null : typeof a.value === 'string' && a.value.trim() === '' ? null : a.value;
    return { itemKey: item.key, value, comment: a.comment.trim() || null, clientCaptureIds: a.captureIds };
  });
}

export function draftCaptureIds(draft: InspectionDraft): string[] {
  return Object.values(draft.answers).flatMap((a) => a.captureIds);
}

/** Problems that keep one section from being complete: the shared rules plus required photos. */
export function sectionIssues(draft: InspectionDraft, sections: ChecklistSection[], sectionIndex: number): Array<{ itemKey: string; message: string }> {
  const section = sections[sectionIndex];
  if (!section) return [];
  const keys = new Set(section.items.map((i) => i.key));
  const check = validateInspectionAnswers(sections, draftAnswers(draft, sections));
  return [
    ...check.errors.filter((e) => keys.has(e.itemKey)),
    ...check.missingPhotoItemKeys.filter((k) => keys.has(k)).map((itemKey) => ({ itemKey, message: 'Take a photo' })),
  ];
}

/** Everything that must be fixed before the inspector can confirm. Empty means ready. */
export function confirmIssues(draft: InspectionDraft, sections: ChecklistSection[]): string[] {
  const labels = new Map(allChecklistItems(sections).map((i) => [i.key, i.label]));
  const check = validateInspectionAnswers(sections, draftAnswers(draft, sections));
  const issues = [
    ...check.errors.map((e) => `${labels.get(e.itemKey) ?? e.itemKey}: ${e.message}`),
    ...check.missingPhotoItemKeys.map((k) => `${labels.get(k) ?? k}: take a photo`),
  ];
  if (!draft.overallFinding) issues.push('Choose the overall finding');
  if (draft.summaryText.trim().length < 10) issues.push('Write a short summary (at least 10 characters)');
  return issues;
}

/** Failed items of a draft (they become findings for the contractor on the server). */
export function failedItems(draft: InspectionDraft, sections: ChecklistSection[]): string[] {
  return allChecklistItems(sections)
    .filter((i) => isFailedAnswer(i, draft.answers[i.key]?.value ?? null))
    .map((i) => i.label);
}

export function buildInspectionRequest(
  draft: InspectionDraft,
  sections: ChecklistSection[],
  params: { geotag: SubmissionGeotagInput | null; confirmedAt: string }
): SubmitSiteInspectionRequestInput {
  if (!draft.overallFinding) throw new Error('Choose the overall finding');
  return {
    clientReportId: draft.id,
    visitType: draft.visitType,
    templateId: draft.templateId,
    templateVersion: draft.templateVersion,
    visitDate: draft.visitDate,
    answers: draftAnswers(draft, sections),
    overallFinding: draft.overallFinding,
    summaryText: draft.summaryText.trim(),
    submissionGeotag: params.geotag,
    confirmedAt: params.confirmedAt,
  };
}

/**
 * Outbox dependencies of an inspection: the open CAPTURE rows of its photos. A photo already sent
 * (no open row) is not waited on.
 */
export function inspectionDependsOn(captureIds: string[], openCaptureRowId: (captureId: string) => string | null): string[] {
  return [...new Set(captureIds)].map(openCaptureRowId).filter((id): id is string => Boolean(id));
}

/** The period cards to show: one per stream the person owes, else the project's own cadence. */
export function streamPeriodCards(
  pack: MobileBaselinePack | null | undefined,
  projectSettings: CadenceSettings
): Array<{ key: string; label: string | null; settings: CadenceSettings }> {
  const streams = pack?.inspections?.streams ?? [];
  if (streams.length === 0) return [{ key: 'default', label: null, settings: projectSettings }];
  return streams.map((s) => ({
    key: s.id,
    label: s.label,
    settings: { ...s.cadence, timezone: s.cadence.timezone || projectSettings.timezone },
  }));
}

/** Findings entry: anyone whose role may manage findings (contractors fix theirs; verifiers record fixes). */
export function showFindingsEntry(permissions: string[] | null | undefined): boolean {
  return Boolean(permissions?.includes('inspections:manage_findings'));
}

/** Server codes meaning the finding was already resolved (a retry after a lost response). */
export const FINDING_ALREADY_RESOLVED_CODES = ['FINDING_NOT_OPEN'];

export interface FindingResolutionPayload {
  findingId: string;
  notes: string;
  captureIds: string[];
}

/** The request body, validated as the server validates it. */
export function findingResolutionBody(p: FindingResolutionPayload): { notes: string; clientCaptureIds: string[] } {
  if (p.captureIds.length === 0 && p.notes.trim().length < 5) throw new Error('Add photos of the fix or describe what was done.');
  return { notes: p.notes.trim(), clientCaptureIds: p.captureIds };
}
