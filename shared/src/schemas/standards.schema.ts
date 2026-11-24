import { z } from 'zod';
import { NeedsAssessmentDocTypeEnum, StandardCategoryEnum } from '../enums';

/**
 * Project standards and needs-assessment documents (Phase 7).
 *
 * A standard applies to the whole project when `applicableWbsCodes` is empty, otherwise to the
 * listed WBS codes and everything below them ("02" covers "02.03.1").
 */

export const STANDARD_CODE_REGEX = /^[A-Za-z0-9][A-Za-z0-9 ._/:-]{0,39}$/;

export const ProjectStandardInputSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(STANDARD_CODE_REGEX, 'Use 1 to 40 letters, digits, spaces or . _ / : -'),
  title: z.string().trim().min(3, 'Enter a title').max(200),
  category: StandardCategoryEnum,
  specificationText: z.string().trim().min(10, 'Describe the requirement').max(20_000),
  /** Optional reference document uploaded through the evidence presign flow. */
  documentObjectKey: z.string().max(500).nullable().optional(),
  applicableWbsCodes: z.array(z.string().trim().min(1).max(40)).max(200).default([]),
  isMandatory: z.boolean().default(true),
});
export type ProjectStandardInput = z.infer<typeof ProjectStandardInputSchema>;

export const UpdateProjectStandardRequestSchema = ProjectStandardInputSchema.partial();
export type UpdateProjectStandardRequest = z.infer<typeof UpdateProjectStandardRequestSchema>;

export const ProjectStandardDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  code: z.string(),
  title: z.string(),
  category: StandardCategoryEnum,
  specificationText: z.string(),
  documentObjectKey: z.string().nullable(),
  applicableWbsCodes: z.array(z.string()),
  isMandatory: z.boolean(),
  createdByUserId: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectStandardDto = z.infer<typeof ProjectStandardDtoSchema>;

/** Registers an uploaded needs-assessment file (uploaded first through the presign flow). */
export const RegisterNeedsAssessmentRequestSchema = z.object({
  title: z.string().trim().min(3).max(200),
  documentType: NeedsAssessmentDocTypeEnum,
  objectKey: z.string().min(1).max(500),
  mimeType: z.string().min(3).max(120),
  byteSize: z.number().int().positive().max(50 * 1024 * 1024),
});
export type RegisterNeedsAssessmentRequest = z.infer<typeof RegisterNeedsAssessmentRequestSchema>;

export const NeedsAssessmentDocumentDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string(),
  documentType: NeedsAssessmentDocTypeEnum,
  objectKey: z.string(),
  mimeType: z.string(),
  byteSize: z.number().int(),
  uploadedByUserId: z.string().uuid(),
  uploadedAt: z.string(),
});
export type NeedsAssessmentDocumentDto = z.infer<typeof NeedsAssessmentDocumentDtoSchema>;

/** One way a report did not show that a standard was met. */
export const StandardsViolationSeverityEnum = z.enum(['CRITICAL', 'WARNING']);
export type StandardsViolationSeverity = z.infer<typeof StandardsViolationSeverityEnum>;

export const StandardsViolationItemSchema = z.object({
  standardCode: z.string(),
  standardTitle: z.string(),
  severity: StandardsViolationSeverityEnum,
  violationSummary: z.string(),
  requiredRectification: z.string(),
});
export type StandardsViolationItem = z.infer<typeof StandardsViolationItemSchema>;

/** A standard as it is shown in a list: the code, title and a one-line rule. */
export const AppliedStandardSchema = z.object({
  code: z.string(),
  title: z.string(),
  summaryRule: z.string(),
});
export type AppliedStandard = z.infer<typeof AppliedStandardSchema>;

/** True when a standard scoped to `codes` applies to `wbsCode` (empty list = whole project). */
export function standardAppliesToWbs(codes: readonly string[], wbsCode: string): boolean {
  if (codes.length === 0) return true;
  const target = wbsCode.trim();
  return codes.some((raw) => {
    const code = raw.trim().replace(/\.+$/, '');
    if (!code) return false;
    return target === code || target.startsWith(`${code}.`);
  });
}

/** First sentence of a specification, trimmed to fit a pill or a short line. */
export function summariseStandardRule(text: string, maxLength = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const firstSentence = clean.split(/(?<=[.;])\s/)[0] ?? clean;
  return firstSentence.length > maxLength ? `${firstSentence.slice(0, maxLength - 1).trimEnd()}…` : firstSentence;
}
