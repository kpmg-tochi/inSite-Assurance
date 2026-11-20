/**
 * Phase 14: site inspection checklist rules and supervision workload maths. Pure functions shared
 * by server, web and mobile, so all three agree on what a complete inspection is.
 */
import type { ChecklistItem, ChecklistSection, InspectionAnswerInput } from '../schemas/inspection.schema';
import { CHECKLIST_RATING_FAIL_AT_OR_BELOW } from '../schemas/inspection.schema';
import { addDays } from './reportingPeriod';

export interface InspectionAnswerIssue {
  itemKey: string;
  message: string;
}

export interface InspectionAnswersCheck {
  /** False when any error exists: the server refuses the inspection. */
  valid: boolean;
  errors: InspectionAnswerIssue[];
  /**
   * Items that need a photo and have none (photo required, or required on fail and failed).
   * Not an error: the server accepts the inspection and the omission check flags it. The mobile
   * app asks for the photo before the inspector can confirm.
   */
  missingPhotoItemKeys: string[];
  /** Items answered as a fail (rating <= 2, FAIL, NO): these can raise findings. */
  failedItemKeys: string[];
}

const PASS_FAIL_VALUES = ['PASS', 'FAIL', 'NA'];
const YES_NO_VALUES = ['YES', 'NO'];

export function allChecklistItems(sections: ChecklistSection[]): ChecklistItem[] {
  return sections.flatMap((s) => s.items);
}

/** Whether an answer value counts as a fail for the item's response type. */
export function isFailedAnswer(item: Pick<ChecklistItem, 'responseType'>, value: unknown): boolean {
  switch (item.responseType) {
    case 'RATING_1_5':
      return typeof value === 'number' && value <= CHECKLIST_RATING_FAIL_AT_OR_BELOW;
    case 'PASS_FAIL_NA':
      return value === 'FAIL';
    case 'YES_NO':
      return value === 'NO';
    default:
      return false;
  }
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/** Type error for a non-empty value, or null when it fits the response type. */
function valueError(item: ChecklistItem, value: unknown): string | null {
  switch (item.responseType) {
    case 'RATING_1_5':
      return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5 ? null : 'Give a rating from 1 to 5';
    case 'PASS_FAIL_NA':
      return typeof value === 'string' && PASS_FAIL_VALUES.includes(value) ? null : 'Answer pass, fail or not applicable';
    case 'YES_NO':
      return typeof value === 'string' && YES_NO_VALUES.includes(value) ? null : 'Answer yes or no';
    case 'NUMBER':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'Enter a number';
    case 'TEXT':
      return typeof value === 'string' && value.trim().length <= 4000 ? null : 'Enter text (up to 4000 characters)';
    case 'PHOTO_ONLY':
      return 'This item takes photos only';
    default:
      return 'Unknown response type';
  }
}

/**
 * Checks answers against a template version's sections:
 * - every answer names an item of the template, at most once;
 * - every required item has a value (PHOTO_ONLY items are answered by their photos);
 * - each value fits its response type;
 * - a failed item needs a comment (at least 3 characters) saying what is wrong.
 * Missing photos are reported separately, never as errors.
 */
export function validateInspectionAnswers(
  sections: ChecklistSection[],
  answers: Array<Pick<InspectionAnswerInput, 'itemKey' | 'value' | 'comment' | 'clientCaptureIds'>>
): InspectionAnswersCheck {
  const items = new Map(allChecklistItems(sections).map((i) => [i.key, i]));
  const errors: InspectionAnswerIssue[] = [];
  const byKey = new Map<string, (typeof answers)[number]>();
  for (const a of answers) {
    if (!items.has(a.itemKey)) {
      errors.push({ itemKey: a.itemKey, message: 'Not an item of this checklist version' });
      continue;
    }
    if (byKey.has(a.itemKey)) {
      errors.push({ itemKey: a.itemKey, message: 'Answered more than once' });
      continue;
    }
    byKey.set(a.itemKey, a);
  }

  const missingPhotoItemKeys: string[] = [];
  const failedItemKeys: string[] = [];
  for (const item of items.values()) {
    const answer = byKey.get(item.key);
    const photos = answer?.clientCaptureIds?.length ?? 0;
    if (item.responseType === 'PHOTO_ONLY') {
      if (answer && !isEmpty(answer.value)) errors.push({ itemKey: item.key, message: valueError(item, answer.value)! });
      if ((item.required || item.photoRequired) && photos === 0) missingPhotoItemKeys.push(item.key);
      continue;
    }
    if (!answer || isEmpty(answer.value)) {
      if (item.required) errors.push({ itemKey: item.key, message: 'Answer this item' });
      if (item.photoRequired && photos === 0 && item.required) missingPhotoItemKeys.push(item.key);
      continue;
    }
    const typeError = valueError(item, answer.value);
    if (typeError) {
      errors.push({ itemKey: item.key, message: typeError });
      continue;
    }
    const failed = isFailedAnswer(item, answer.value);
    if (failed) {
      failedItemKeys.push(item.key);
      if ((answer.comment ?? '').trim().length < 3) errors.push({ itemKey: item.key, message: 'Say what is wrong' });
    }
    if (photos === 0 && (item.photoRequired || (failed && item.photoRequiredOnFail))) missingPhotoItemKeys.push(item.key);
  }
  return { valid: errors.length === 0, errors, missingPhotoItemKeys, failedItemKeys };
}

/** Last day an inspection report can be uploaded without being late, or null without a deadline. */
export function inspectionSubmissionDeadline(visitDate: string, deadlineDays: number | null | undefined): string | null {
  if (deadlineDays === null || deadlineDays === undefined) return null;
  return addDays(visitDate, deadlineDays);
}

// ---------------------------------------------------------------------------
// Supervision workload
// ---------------------------------------------------------------------------

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** Great-circle distance in km (haversine, mean Earth radius). */
export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371.0088;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Furthest distance between any two points (km); null with fewer than two points. */
export function maxPairwiseDistanceKm(points: LatLng[]): number | null {
  if (points.length < 2) return null;
  let max = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) max = Math.max(max, distanceKm(points[i], points[j]));
  }
  return Math.round(max * 10) / 10;
}

export interface WorkloadThresholds {
  maxSitesPerSupervisor: number | null;
  maxSpreadKm: number | null;
}

/** Warn (never block) when a supervisor covers too many sites or sites too far apart. */
export function evaluateWorkload(
  siteCount: number,
  spreadKm: number | null,
  thresholds: WorkloadThresholds
): { overSiteLimit: boolean; overSpread: boolean } {
  return {
    overSiteLimit: thresholds.maxSitesPerSupervisor !== null && siteCount > thresholds.maxSitesPerSupervisor,
    overSpread: thresholds.maxSpreadKm !== null && spreadKm !== null && spreadKm > thresholds.maxSpreadKm,
  };
}
