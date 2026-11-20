import { z } from 'zod';
import { FieldPersonaTypeEnum, GeofenceStatusEnum, ReportingCadenceEnum } from '../enums';
import { CALENDAR_DATE_REGEX } from '../utils/time';
import { ProjectCadenceSettingsDtoSchema, ReportingPeriodDtoSchema } from './cadence.schema';
import { ApprovalProgressDtoSchema } from './process.schema';
import { SubmissionGeotagInputSchema, SubmissionGeotagSchema, WorkdayReportCaptureSummarySchema } from './workday.schema';

/**
 * Phase 14: reporting streams, site inspection checklists and reports, inspection findings and
 * supervision workload.
 */

const Uuid = z.string().uuid();
const CalendarDate = z.string().regex(CALENDAR_DATE_REGEX, 'Use YYYY-MM-DD');
const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');
const IsoWeekday = z.number().int().min(1).max(7);
/** Stable keys for streams, sections and checklist items: lower-case letters, digits, "_" and "-". */
export const CHECKLIST_KEY_REGEX = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const Key = z.string().trim().regex(CHECKLIST_KEY_REGEX, 'Use 1 to 48 lower-case letters, digits, "-" or "_"');

// ---------------------------------------------------------------------------
// Visit types
// ---------------------------------------------------------------------------

export const InspectionVisitTypeEnum = z.enum(['BASELINE', 'ROUTINE', 'MOBILISATION_CHECK', 'FINAL_EVALUATION']);
export type InspectionVisitType = z.infer<typeof InspectionVisitTypeEnum>;

export const INSPECTION_VISIT_TYPE_LABELS: Record<InspectionVisitType, string> = {
  BASELINE: 'Baseline survey',
  ROUTINE: 'Routine monitoring visit',
  MOBILISATION_CHECK: 'Mobilisation check',
  FINAL_EVALUATION: 'Final evaluation',
};

// ---------------------------------------------------------------------------
// Checklist templates
// ---------------------------------------------------------------------------

export const ChecklistResponseTypeEnum = z.enum(['RATING_1_5', 'PASS_FAIL_NA', 'YES_NO', 'NUMBER', 'TEXT', 'PHOTO_ONLY']);
export type ChecklistResponseType = z.infer<typeof ChecklistResponseTypeEnum>;

export const CHECKLIST_RESPONSE_TYPE_LABELS: Record<ChecklistResponseType, string> = {
  RATING_1_5: 'Rating 1 to 5',
  PASS_FAIL_NA: 'Pass / fail / not applicable',
  YES_NO: 'Yes / no',
  NUMBER: 'Number',
  TEXT: 'Text',
  PHOTO_ONLY: 'Photo only',
};

/** A rating at or below this counts as failed (raises a finding, needs a comment). */
export const CHECKLIST_RATING_FAIL_AT_OR_BELOW = 2;

export const ChecklistItemSchema = z.object({
  key: Key,
  label: z.string().trim().min(2, 'Enter the question').max(300),
  guidance: z.string().trim().max(1000).nullable().optional(),
  responseType: ChecklistResponseTypeEnum,
  /** NUMBER only: unit shown next to the value. */
  unit: z.string().trim().max(30).nullable().optional(),
  required: z.boolean().default(true),
  photoRequired: z.boolean().default(false),
  /** A photo is needed when the answer is a fail (rating <= 2, FAIL or NO). */
  photoRequiredOnFail: z.boolean().default(false),
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;
export type ChecklistItemInput = z.input<typeof ChecklistItemSchema>;

export const ChecklistSectionSchema = z.object({
  key: Key,
  title: z.string().trim().min(2, 'Enter the section title').max(160),
  items: z.array(ChecklistItemSchema).min(1, 'A section needs at least one item').max(60),
});
export type ChecklistSection = z.infer<typeof ChecklistSectionSchema>;

/** A template's sections. Section keys and item keys are unique across the whole template. */
export const ChecklistSectionsSchema = z
  .array(ChecklistSectionSchema)
  .min(1, 'Add at least one section')
  .max(30)
  .superRefine((sections, ctx) => {
    const sectionKeys = new Set<string>();
    const itemKeys = new Set<string>();
    sections.forEach((s, si) => {
      if (sectionKeys.has(s.key)) ctx.addIssue({ code: 'custom', message: `Section key "${s.key}" is used twice`, path: [si, 'key'] });
      sectionKeys.add(s.key);
      s.items.forEach((item, ii) => {
        if (itemKeys.has(item.key)) {
          ctx.addIssue({ code: 'custom', message: `Item key "${item.key}" is used twice`, path: [si, 'items', ii, 'key'] });
        }
        itemKeys.add(item.key);
      });
    });
  });
export type ChecklistSections = z.infer<typeof ChecklistSectionsSchema>;
export type ChecklistSectionsInput = z.input<typeof ChecklistSectionsSchema>;

export const TEMPLATE_CODE_REGEX = /^[A-Z][A-Z0-9_]{1,39}$/;

export const SaveChecklistTemplateRequestSchema = z.object({
  code: z.string().trim().toUpperCase().regex(TEMPLATE_CODE_REGEX, 'Code: 2 to 40 capital letters, digits or underscores'),
  name: z.string().trim().min(3).max(160),
  visitTypes: z.array(InspectionVisitTypeEnum).min(1, 'Pick at least one visit type').max(4),
  sections: ChecklistSectionsSchema,
});
export type SaveChecklistTemplateRequest = z.infer<typeof SaveChecklistTemplateRequestSchema>;
export type SaveChecklistTemplateRequestInput = z.input<typeof SaveChecklistTemplateRequestSchema>;

export const InspectionChecklistTemplateDtoSchema = z.object({
  id: Uuid,
  code: z.string(),
  name: z.string(),
  visitTypes: z.array(InspectionVisitTypeEnum),
  version: z.number().int(),
  sections: ChecklistSectionsSchema,
  isArchived: z.boolean(),
  /** Inspections that used this version (a used version is never edited: saving makes a new one). */
  usageCount: z.number().int(),
  isLatest: z.boolean(),
  createdAt: z.string(),
});
export type InspectionChecklistTemplateDto = z.infer<typeof InspectionChecklistTemplateDtoSchema>;

// ---------------------------------------------------------------------------
// Reporting streams
// ---------------------------------------------------------------------------

export const ReportingStreamKindEnum = z.enum(['ITEM_REPORTS', 'INSPECTION']);
export type ReportingStreamKind = z.infer<typeof ReportingStreamKindEnum>;

export const REPORTING_STREAM_KIND_LABELS: Record<ReportingStreamKind, string> = {
  ITEM_REPORTS: 'Item reports (per BOQ item per period)',
  INSPECTION: 'Site inspection (one per period)',
};

const streamCadenceShape = {
  reportingCadence: ReportingCadenceEnum,
  workWeekDays: z
    .array(IsoWeekday)
    .min(1)
    .max(7)
    .transform((d) => [...new Set(d)].sort((a, b) => a - b))
    .default([1, 2, 3, 4, 5, 6]),
  periodStartDayOfWeek: IsoWeekday.default(1),
  customIntervalDays: z.number().int().min(1).max(366).nullable().default(null),
  quarterAnchorMonth: z.number().int().min(1).max(12).nullable().default(null),
  reportDueTime: TimeOfDay.nullable().default(null),
  reportGraceMinutes: z.number().int().min(0).max(7 * 24 * 60).default(0),
  /** INSPECTION: days after the visit date the report must be uploaded (process: 7). */
  submissionDeadlineDays: z.number().int().min(0).max(90).nullable().default(null),
  visitType: InspectionVisitTypeEnum.nullable().default(null),
};

function refineStream(
  v: { kind: ReportingStreamKind; visitType: unknown; reportingCadence: string; customIntervalDays: number | null },
  ctx: z.RefinementCtx
): void {
  if (v.kind === 'INSPECTION' && !v.visitType) {
    ctx.addIssue({ code: 'custom', message: 'An inspection stream needs a visit type', path: ['visitType'] });
  }
  if (v.reportingCadence === 'CUSTOM_INTERVAL' && !(v.customIntervalDays && v.customIntervalDays >= 1)) {
    ctx.addIssue({ code: 'custom', message: 'Set how many days a custom period lasts', path: ['customIntervalDays'] });
  }
}

export const ReportingStreamInputSchema = z
  .object({
    /** Present when editing an existing stream. */
    id: Uuid.nullable().optional(),
    key: Key,
    label: z.string().trim().min(2).max(120),
    kind: ReportingStreamKindEnum,
    /** Roles that owe the stream (a user or session owes it when its role is listed). */
    roleIds: z.array(Uuid).min(1, 'Pick at least one role').max(20),
    /** Optional: limit the stream to one contractor package. */
    projectContractorId: Uuid.nullable().default(null),
    cadenceAnchorDate: CalendarDate.nullable().default(null),
    isActive: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(100).default(0),
    ...streamCadenceShape,
  })
  .superRefine(refineStream);
export type ReportingStreamInput = z.infer<typeof ReportingStreamInputSchema>;
export type ReportingStreamInputRaw = z.input<typeof ReportingStreamInputSchema>;

export const SaveReportingStreamsRequestSchema = z
  .object({ streams: z.array(ReportingStreamInputSchema).max(10) })
  .superRefine((v, ctx) => {
    const keys = new Set<string>();
    v.streams.forEach((s, i) => {
      if (keys.has(s.key)) ctx.addIssue({ code: 'custom', message: `Stream key "${s.key}" is used twice`, path: ['streams', i, 'key'] });
      keys.add(s.key);
    });
  });
export type SaveReportingStreamsRequest = z.infer<typeof SaveReportingStreamsRequestSchema>;

export const ReportingStreamDtoSchema = z.object({
  id: Uuid,
  key: z.string(),
  label: z.string(),
  kind: ReportingStreamKindEnum,
  roleIds: z.array(Uuid),
  roleNames: z.array(z.string()),
  projectContractorId: Uuid.nullable(),
  projectContractorName: z.string().nullable(),
  reportingCadence: ReportingCadenceEnum,
  workWeekDays: z.array(z.number().int()),
  periodStartDayOfWeek: z.number().int(),
  customIntervalDays: z.number().int().nullable(),
  quarterAnchorMonth: z.number().int().nullable(),
  reportDueTime: z.string().nullable(),
  reportGraceMinutes: z.number().int(),
  cadenceAnchorDate: z.string().nullable(),
  visitType: InspectionVisitTypeEnum.nullable(),
  submissionDeadlineDays: z.number().int().nullable(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  /** A cadence change on a live project waiting for the stream's next period. */
  pendingChange: z.object({ effectiveFrom: z.string() }).nullable(),
  /** Settings in force today and the period they give (null without periods). */
  settings: ProjectCadenceSettingsDtoSchema,
  currentPeriod: ReportingPeriodDtoSchema.nullable(),
});
export type ReportingStreamDto = z.infer<typeof ReportingStreamDtoSchema>;

/** GET /projects/:id/reporting-streams. With no streams the project runs one implicit "Default" stream. */
export const ProjectReportingStreamsDtoSchema = z.object({
  usesImplicitDefault: z.boolean(),
  /** The implicit stream: the project cadence, owed by verifiers and contractors as before Phase 14. */
  defaultStream: z.object({ label: z.string(), settings: ProjectCadenceSettingsDtoSchema }),
  streams: z.array(ReportingStreamDtoSchema),
  /** Roles of the workspace a stream can name (for the editor). */
  roleOptions: z.array(z.object({ id: Uuid, name: z.string(), code: z.string(), fieldPersonaType: FieldPersonaTypeEnum })),
});
export type ProjectReportingStreamsDto = z.infer<typeof ProjectReportingStreamsDtoSchema>;

// ---------------------------------------------------------------------------
// Project type config (Phase 14 keys)
// ---------------------------------------------------------------------------

/** A stream on a project type: roles by code (role ids are per tenant and resolved when applied). */
export const ProjectTypeReportingStreamSchema = z
  .object({
    key: Key,
    label: z.string().trim().min(2).max(120),
    kind: ReportingStreamKindEnum,
    roleCodes: z.array(z.string().trim().min(1).max(64)).min(1).max(20),
    ...streamCadenceShape,
  })
  .superRefine(refineStream);
export type ProjectTypeReportingStream = z.infer<typeof ProjectTypeReportingStreamSchema>;

export const ProjectTypeInspectionsConfigSchema = z.object({
  /** Template code per visit type; the latest version of that template is used. */
  templateCodeByVisitType: z.record(InspectionVisitTypeEnum, z.string().trim().min(1).max(40)).default({}),
});
export type ProjectTypeInspectionsConfig = z.infer<typeof ProjectTypeInspectionsConfigSchema>;

export const ProjectTypeSupervisionConfigSchema = z.object({
  /** Roles whose holders count as supervisors (by role code). */
  supervisorRoleCodes: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
  /** Warn when a supervisor would cover more active sites than this. null = no limit. */
  maxSitesPerSupervisor: z.number().int().min(1).max(500).nullable().default(null),
  /** Warn when a supervisor's sites are further apart than this (km between geofence centres). */
  maxSpreadKm: z.number().min(0.1).max(5000).nullable().default(null),
});
export type ProjectTypeSupervisionConfig = z.infer<typeof ProjectTypeSupervisionConfigSchema>;

// ---------------------------------------------------------------------------
// Site inspection reports
// ---------------------------------------------------------------------------

export const InspectionOverallFindingEnum = z.enum(['SATISFACTORY', 'MINOR_ISSUES', 'MAJOR_ISSUES']);
export type InspectionOverallFinding = z.infer<typeof InspectionOverallFindingEnum>;
export const INSPECTION_OVERALL_FINDING_LABELS: Record<InspectionOverallFinding, string> = {
  SATISFACTORY: 'Satisfactory',
  MINOR_ISSUES: 'Minor issues',
  MAJOR_ISSUES: 'Major issues',
};

export const SiteInspectionStatusEnum = z.enum(['SUBMITTED', 'PENDING_APPROVAL', 'APPROVED', 'RETURNED']);
export type SiteInspectionStatus = z.infer<typeof SiteInspectionStatusEnum>;

/** One answer. `value` type follows the item's response type (see validateInspectionAnswers). */
export const InspectionAnswerSchema = z.object({
  itemKey: z.string().min(1).max(48),
  value: z.union([z.number(), z.string().max(4000), z.null()]),
  comment: z.string().trim().max(2000).nullable().optional(),
  /** Photos for this item: registered captures (clientCaptureId), sent before the inspection. */
  clientCaptureIds: z.array(Uuid).max(20).default([]),
});
export type InspectionAnswer = z.infer<typeof InspectionAnswerSchema>;
export type InspectionAnswerInput = z.input<typeof InspectionAnswerSchema>;

export const SubmitSiteInspectionRequestSchema = z.object({
  /** Client UUID; a retry with the same id returns the original inspection. */
  clientReportId: Uuid,
  visitType: InspectionVisitTypeEnum,
  templateId: Uuid,
  templateVersion: z.number().int().min(1),
  visitDate: CalendarDate,
  answers: z.array(InspectionAnswerSchema).max(1000),
  overallFinding: InspectionOverallFindingEnum,
  summaryText: z.string().trim().min(10, 'Write a short summary (at least 10 characters)').max(8000),
  submissionGeotag: SubmissionGeotagInputSchema.nullable().optional(),
  confirmedAt: z.string().datetime(),
});
export type SubmitSiteInspectionRequest = z.infer<typeof SubmitSiteInspectionRequestSchema>;
export type SubmitSiteInspectionRequestInput = z.input<typeof SubmitSiteInspectionRequestSchema>;

export const ReviewSiteInspectionRequestSchema = z
  .object({
    decision: z.enum(['APPROVE', 'RETURN']),
    notes: z.string().trim().max(1500).nullable().optional(),
  })
  .refine((v) => v.decision !== 'RETURN' || (v.notes ?? '').length >= 5, {
    message: 'Say what the inspector must change (at least 5 characters)',
    path: ['notes'],
  });
export type ReviewSiteInspectionRequest = z.infer<typeof ReviewSiteInspectionRequestSchema>;

export const InspectionFindingSeverityEnum = z.enum(['MINOR', 'MAJOR', 'CRITICAL']);
export type InspectionFindingSeverity = z.infer<typeof InspectionFindingSeverityEnum>;
export const InspectionFindingStatusEnum = z.enum(['OPEN', 'RESOLVED', 'DISMISSED']);
export type InspectionFindingStatus = z.infer<typeof InspectionFindingStatusEnum>;

export const InspectionFindingDtoSchema = z.object({
  id: Uuid,
  projectId: Uuid,
  inspectionId: Uuid,
  inspectionVisitType: InspectionVisitTypeEnum,
  inspectionVisitDate: z.string(),
  checklistItemKey: z.string(),
  checklistItemLabel: z.string(),
  projectContractorId: Uuid.nullable(),
  contractorName: z.string().nullable(),
  description: z.string(),
  severity: InspectionFindingSeverityEnum,
  status: InspectionFindingStatusEnum,
  resolvedNotes: z.string().nullable(),
  resolutionCaptures: z.array(WorkdayReportCaptureSummarySchema),
  raisedByName: z.string().nullable(),
  resolvedByName: z.string().nullable(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  /** Whether the viewer may resolve or dismiss it (server-computed). */
  canResolve: z.boolean(),
  canDismiss: z.boolean(),
});
export type InspectionFindingDto = z.infer<typeof InspectionFindingDtoSchema>;

export const RaiseInspectionFindingRequestSchema = z.object({
  checklistItemKey: z.string().min(1).max(48),
  /** The contractor the finding is aimed at; null for a monitoring-side finding. */
  projectContractorId: Uuid.nullable().default(null),
  description: z.string().trim().min(5, 'Describe the finding (at least 5 characters)').max(2000),
  severity: InspectionFindingSeverityEnum.default('MAJOR'),
});
export type RaiseInspectionFindingRequest = z.infer<typeof RaiseInspectionFindingRequestSchema>;

export const ResolveInspectionFindingRequestSchema = z
  .object({
    notes: z.string().trim().max(2000).default(''),
    clientCaptureIds: z.array(Uuid).max(20).default([]),
  })
  .refine((v) => v.clientCaptureIds.length > 0 || v.notes.length >= 5, {
    message: 'Add photos of the fix or describe what was done',
    path: ['notes'],
  });
export type ResolveInspectionFindingRequest = z.infer<typeof ResolveInspectionFindingRequestSchema>;

export const DismissInspectionFindingRequestSchema = z.object({
  reason: z.string().trim().min(5, 'Say why the finding is dismissed (at least 5 characters)').max(1000),
});
export type DismissInspectionFindingRequest = z.infer<typeof DismissInspectionFindingRequestSchema>;

export const InspectionAiFlagSchema = z.object({ itemKey: z.string(), message: z.string() });
export type InspectionAiFlag = z.infer<typeof InspectionAiFlagSchema>;

export const SiteInspectionSummaryDtoSchema = z.object({
  id: Uuid,
  clientReportId: Uuid,
  projectId: Uuid,
  streamId: Uuid.nullable(),
  streamLabel: z.string().nullable(),
  visitType: InspectionVisitTypeEnum,
  templateId: Uuid,
  templateCode: z.string(),
  templateName: z.string(),
  templateVersion: z.number().int(),
  visitDate: z.string(),
  reporterName: z.string(),
  reporterRoleName: z.string(),
  reporterPersonaType: FieldPersonaTypeEnum,
  overallFinding: InspectionOverallFindingEnum,
  status: SiteInspectionStatusEnum,
  isLate: z.boolean(),
  /** Last day the report could be uploaded without being late (visit date + deadline), if any. */
  submissionDeadline: z.string().nullable(),
  geofenceStatus: GeofenceStatusEnum.nullable(),
  failedItemCount: z.number().int(),
  openFindingCount: z.number().int(),
  photoCount: z.number().int(),
  createdAt: z.string(),
});
export type SiteInspectionSummaryDto = z.infer<typeof SiteInspectionSummaryDtoSchema>;

export const SiteInspectionAnswerDtoSchema = z.object({
  itemKey: z.string(),
  value: z.union([z.number(), z.string(), z.null()]),
  comment: z.string().nullable(),
  failed: z.boolean(),
  captures: z.array(WorkdayReportCaptureSummarySchema),
});
export type SiteInspectionAnswerDto = z.infer<typeof SiteInspectionAnswerDtoSchema>;

export const SiteInspectionDtoSchema = SiteInspectionSummaryDtoSchema.extend({
  summaryText: z.string(),
  sections: ChecklistSectionsSchema,
  answers: z.array(SiteInspectionAnswerDtoSchema),
  submissionGeotag: SubmissionGeotagSchema.nullable(),
  aiCheckStatus: z.string(),
  aiCheckEngine: z.string().nullable(),
  aiFlags: z.array(InspectionAiFlagSchema),
  approval: ApprovalProgressDtoSchema.nullable(),
  findings: z.array(InspectionFindingDtoSchema),
  /** Reviewer return notes, latest first. */
  returnedNotes: z.string().nullable(),
});
export type SiteInspectionDto = z.infer<typeof SiteInspectionDtoSchema>;

export const InspectionOverviewDtoSchema = z.object({
  lastByVisitType: z.record(
    InspectionVisitTypeEnum,
    z.object({ id: Uuid, visitDate: z.string(), status: SiteInspectionStatusEnum, overallFinding: InspectionOverallFindingEnum }).nullable()
  ),
  nextDue: z
    .object({
      streamId: Uuid,
      streamLabel: z.string(),
      visitType: InspectionVisitTypeEnum.nullable(),
      periodStart: z.string(),
      periodEnd: z.string(),
      dueAt: z.string(),
      status: z.string(),
    })
    .nullable(),
  openFindings: z.number().int(),
  missedInspections: z.number().int(),
  /** Has an approved (or accepted, when approval is off) BASELINE inspection. */
  baselineComplete: z.boolean(),
});
export type InspectionOverviewDto = z.infer<typeof InspectionOverviewDtoSchema>;

// ---------------------------------------------------------------------------
// Mobile pack
// ---------------------------------------------------------------------------

export const MobileStreamSchema = z.object({
  id: Uuid,
  key: z.string(),
  label: z.string(),
  kind: ReportingStreamKindEnum,
  visitType: InspectionVisitTypeEnum.nullable(),
  submissionDeadlineDays: z.number().int().nullable(),
  cadence: ProjectCadenceSettingsDtoSchema,
});
export type MobileStream = z.infer<typeof MobileStreamSchema>;

/** Added to the baseline pack: the streams this person owes and the templates their visits use. */
export const MobileInspectionPackSchema = z.object({
  streams: z.array(MobileStreamSchema),
  templates: z.array(
    InspectionChecklistTemplateDtoSchema.pick({ id: true, code: true, name: true, visitTypes: true, version: true, sections: true })
  ),
  /** The template to use for each visit type this person can inspect. */
  templateIdByVisitType: z.record(InspectionVisitTypeEnum, Uuid).default({}),
  canSubmitInspections: z.boolean(),
});
export type MobileInspectionPack = z.infer<typeof MobileInspectionPackSchema>;

// ---------------------------------------------------------------------------
// Supervision workload
// ---------------------------------------------------------------------------

export const SupervisorWorkloadDtoSchema = z.object({
  userId: Uuid,
  fullName: z.string(),
  roleName: z.string(),
  projects: z.array(
    z.object({
      projectId: Uuid,
      name: z.string(),
      codePrefix: z.string(),
      point: z.object({ latitude: z.number(), longitude: z.number() }).nullable(),
      lastInspectionDate: z.string().nullable(),
    })
  ),
  activeProjectCount: z.number().int(),
  /** Furthest distance between two of the supervisor's project geofence centres (km). */
  spreadKm: z.number().nullable(),
  maxSitesPerSupervisor: z.number().int().nullable(),
  maxSpreadKm: z.number().nullable(),
  overSiteLimit: z.boolean(),
  overSpread: z.boolean(),
});
export type SupervisorWorkloadDto = z.infer<typeof SupervisorWorkloadDtoSchema>;
