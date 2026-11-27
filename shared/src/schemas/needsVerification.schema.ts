import { z } from 'zod';
import { NigeriaLgaCodeSchema, NigeriaStateCodeSchema } from '../data/nigeriaAdminAreas';
import { VisitFormAnswersSchema, VisitFormSnapshotBlockSchema } from './form.schema';
import { ExistingConditionEnum, SiteVerificationSchema, type ExistingCondition } from './needsPipeline.schema';

/**
 * Needs pipeline wave 5 (N8): field verification of a proposed project from the field app (plan
 * section 10, `needs_pipeline/wave5_field_seed_docs.md`). Names here are binding like plan section 17.
 *
 * A validator (`needs:validate`, purpose VALIDATION, proposal at Validation) or a UBEC BEAP reviewer
 * (`needs:review_beap`, purpose BEAP_REVIEW, proposal on a BEAP in review) assigns one officer with a
 * mobile sign-in. The form is frozen at assignment from the two reserved form library sections
 * (`NEEDS_VERIFICATION_SECTION_CODES`): the site section once per site, the facility section once per
 * facilities breakdown row of those sites. The officer sees it in `GET /api/v1/needs-verifications/mine`
 * (access by assignment: no project, no field session), records a location per site, answers, takes
 * photos (registered as verification captures), and submits through the outbox (idempotent on
 * `clientSubmissionId`). A reviewer accepts or returns it: acceptance corrects the sites' coordinates
 * (`siteCoordinateCorrections`), files the photos as PHOTO documents of the proposal, and gives the
 * validation record a pre-filled site verification (method FIELD_APP, `verificationId`); the validator
 * still writes the desk review and decides.
 */

const Uuid = z.string().uuid();
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const IsoDateTime = z.string().datetime({ offset: true });

// ---------------------------------------------------------------------------
// Enums and fixed names
// ---------------------------------------------------------------------------

export const NeedsVerificationStatusEnum = z.enum(['ASSIGNED', 'SUBMITTED', 'ACCEPTED', 'RETURNED', 'CANCELLED']);
export type NeedsVerificationStatus = z.infer<typeof NeedsVerificationStatusEnum>;
export const NEEDS_VERIFICATION_STATUS_LABELS: Record<NeedsVerificationStatus, string> = {
  ASSIGNED: 'Assigned',
  SUBMITTED: 'Waiting for review',
  ACCEPTED: 'Accepted',
  RETURNED: 'Returned to the officer',
  CANCELLED: 'Cancelled',
};
/** Statuses in which the officer still has work (shown on the phone as to do). */
export const NEEDS_VERIFICATION_OPEN_STATUSES: NeedsVerificationStatus[] = ['ASSIGNED', 'RETURNED'];

export const NeedsVerificationPurposeEnum = z.enum(['VALIDATION', 'BEAP_REVIEW']);
export type NeedsVerificationPurpose = z.infer<typeof NeedsVerificationPurposeEnum>;
export const NEEDS_VERIFICATION_PURPOSE_LABELS: Record<NeedsVerificationPurpose, string> = {
  VALIDATION: 'Site verification (validation)',
  BEAP_REVIEW: 'BEAP site visit',
};

export const NeedsVerificationSubmissionStatusEnum = z.enum(['SUBMITTED', 'ACCEPTED', 'RETURNED']);
export type NeedsVerificationSubmissionStatus = z.infer<typeof NeedsVerificationSubmissionStatusEnum>;

/** Reserved form library section codes (default content in `defaultFormLibrary.ts`). */
export const NEEDS_VERIFICATION_SECTION_CODES = {
  SITE: 'NEEDS_VERIFICATION_SITE',
  FACILITY: 'NEEDS_VERIFICATION_FACILITY',
} as const;
export const NEEDS_VERIFICATION_RESERVED_SECTION_CODES: string[] = Object.values(NEEDS_VERIFICATION_SECTION_CODES);

/** Field keys acceptance and the review read (a tenant may add fields; these keep their meaning). */
export const NEEDS_VERIFICATION_FIELD_KEYS = {
  schoolFound: 'school-found',
  existingQuantity: 'existing-quantity',
  existingCondition: 'existing-condition',
  matchesAssessment: 'matches-assessment',
} as const;

/** Option key of the condition question → the breakdown's condition. */
export const NEEDS_VERIFICATION_CONDITION_BY_OPTION: Record<string, ExistingCondition> = {
  functional: 'FUNCTIONAL',
  'partly-functional': 'PARTLY_FUNCTIONAL',
  dilapidated: 'DILAPIDATED',
  'non-functional': 'NON_FUNCTIONAL',
  absent: 'ABSENT',
};

export const NEEDS_VERIFICATION_FORM_SCHEMA_VERSION = 1 as const;

/** Acceptance moves a site only when the recorded location is this far from the stored one (or none is stored). */
export const NEEDS_VERIFICATION_COORDINATE_TOLERANCE_METERS = 25;
/** A location whose reported accuracy is worse than this is not used to correct a site. */
export const NEEDS_VERIFICATION_MAX_ACCURACY_METERS = 100;

// ---------------------------------------------------------------------------
// The frozen form
// ---------------------------------------------------------------------------

export const NeedsVerificationFormSiteSchema = z.object({
  siteNumber: z.number().int().min(1),
  schoolName: z.string(),
  lgaCode: z.string(),
  address: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
});
export type NeedsVerificationFormSite = z.infer<typeof NeedsVerificationFormSiteSchema>;

export const NeedsVerificationFormRowSchema = z.object({
  /** NeedsFacilityBreakdownRow.id (also the block's unit id and the `n:row:` path id). */
  rowId: Uuid,
  unitId: z.string(),
  siteNumber: z.number().int(),
  facilityCode: z.string(),
  facilityName: z.string(),
  interventionAction: z.string(),
  existingQuantity: z.number(),
  existingCondition: ExistingConditionEnum,
  proposedQuantity: z.number(),
  unitOfMeasure: z.string(),
});
export type NeedsVerificationFormRow = z.infer<typeof NeedsVerificationFormRowSchema>;

/**
 * The form frozen on a verification. Blocks use the visit form snapshot block shape, so the visit
 * answer rules (`validateVisitAnswers`) and the phone's form screens apply unchanged. Blocks: one per
 * site (key `n:site:<siteNumber>`, fields `n:site:<siteNumber>/<key>`), then one per breakdown row of
 * that site (key `n:row:<rowId>`, fields `n:row:<rowId>/<key>`, `unitId` = the row id).
 */
export const NeedsVerificationFormSchema = z.object({
  schemaVersion: z.literal(NEEDS_VERIFICATION_FORM_SCHEMA_VERSION),
  /** Excluded from the content hash. */
  builtAt: z.string(),
  context: z.object({
    cycleId: Uuid,
    proposalId: Uuid,
    reference: z.string(),
    title: z.string(),
    purpose: NeedsVerificationPurposeEnum,
    versionNumber: z.number().int(),
  }),
  sources: z.object({
    sections: z.array(z.object({ id: Uuid, code: z.string(), version: z.number().int() })),
  }),
  sites: z.array(NeedsVerificationFormSiteSchema),
  rows: z.array(NeedsVerificationFormRowSchema),
  blocks: z.array(VisitFormSnapshotBlockSchema),
});
export type NeedsVerificationForm = z.infer<typeof NeedsVerificationFormSchema>;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** `POST /api/v1/needs/proposals/:proposalId/verifications`. Empty `siteNumbers` = every site. */
export const AssignNeedsVerificationRequestSchema = z.object({
  purpose: NeedsVerificationPurposeEnum.default('VALIDATION'),
  officerUserId: Uuid,
  dueDate: IsoDate,
  siteNumbers: z.array(z.number().int().min(1)).max(50).default([]),
  instructions: z.string().trim().max(2000).nullable().default(null),
});
export type AssignNeedsVerificationRequest = z.infer<typeof AssignNeedsVerificationRequestSchema>;
export type AssignNeedsVerificationRequestInput = z.input<typeof AssignNeedsVerificationRequestSchema>;

/** `POST /api/v1/needs/verifications/:verificationId/cancel` (before it is submitted, or after a return). */
export const CancelNeedsVerificationRequestSchema = z.object({
  reason: z.string().trim().min(3, 'Give a reason').max(1000),
});
export type CancelNeedsVerificationRequest = z.infer<typeof CancelNeedsVerificationRequestSchema>;

/** `POST /api/v1/needs/verifications/:verificationId/review`: ACCEPT or RETURN the live submission. */
export const ReviewNeedsVerificationRequestSchema = z
  .object({
    decision: z.enum(['ACCEPT', 'RETURN']),
    reason: z.string().trim().max(2000).nullable().default(null),
    /** ACCEPT: apply the coordinate corrections the submission gives (default yes). */
    correctCoordinates: z.boolean().default(true),
  })
  .refine((v) => v.decision !== 'RETURN' || (v.reason ?? '').length >= 3, { message: 'Say what the officer must redo', path: ['reason'] });
export type ReviewNeedsVerificationRequest = z.infer<typeof ReviewNeedsVerificationRequestSchema>;
export type ReviewNeedsVerificationRequestInput = z.input<typeof ReviewNeedsVerificationRequestSchema>;

/** Where the officer stood at one site (device fix). */
export const NeedsVerificationSiteLocationSchema = z.object({
  siteNumber: z.number().int().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().nonnegative().nullable().default(null),
  capturedAt: IsoDateTime,
  isMockLocation: z.boolean().default(false),
});
export type NeedsVerificationSiteLocation = z.infer<typeof NeedsVerificationSiteLocationSchema>;
export type NeedsVerificationSiteLocationInput = z.input<typeof NeedsVerificationSiteLocationSchema>;

/**
 * `POST /api/v1/needs-verifications/:verificationId/submissions` (field app). Idempotent on
 * `clientSubmissionId` (a replay answers 200 with the stored submission). `formHash` must be the
 * verification's (409 NEEDS_VERIFICATION_FORM_STALE); every capture named must be registered on this
 * verification by this user (retryable 409 CAPTURES_NOT_REGISTERED); one location per site of the form.
 */
export const SubmitNeedsVerificationRequestSchema = z.object({
  clientSubmissionId: Uuid,
  formHash: z.string().min(16).max(128),
  answers: VisitFormAnswersSchema,
  siteLocations: z.array(NeedsVerificationSiteLocationSchema).max(50),
  notes: z.string().trim().max(4000).nullable().default(null),
  submittedAtDevice: IsoDateTime,
});
export type SubmitNeedsVerificationRequest = z.infer<typeof SubmitNeedsVerificationRequestSchema>;
export type SubmitNeedsVerificationRequestInput = z.input<typeof SubmitNeedsVerificationRequestSchema>;

/** `POST /api/v1/needs-verifications/:verificationId/captures/presign` (field app). */
export const PresignNeedsVerificationCaptureRequestSchema = z.object({
  kind: z.enum(['PHOTO', 'AUDIO']),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(['image/jpeg', 'image/png', 'audio/m4a', 'audio/mp4', 'audio/aac', 'audio/mpeg']),
  byteSize: z.number().int().positive().max(25 * 1024 * 1024),
});
export type PresignNeedsVerificationCaptureRequest = z.infer<typeof PresignNeedsVerificationCaptureRequestSchema>;

export const NeedsVerificationPresignDtoSchema = z.object({
  uploadUrl: z.string(),
  objectKey: z.string(),
  expiresAt: z.string(),
});
export type NeedsVerificationPresignDto = z.infer<typeof NeedsVerificationPresignDtoSchema>;

/**
 * `POST /api/v1/needs-verifications/:verificationId/captures` (field app): registers an uploaded photo
 * or voice note, idempotent on `clientCaptureId` (the same id again answers the stored capture). The
 * server reads size and SHA-256 from storage; a missing object is 409 OBJECT_NOT_UPLOADED (upload again).
 */
export const RegisterNeedsVerificationCaptureRequestSchema = z.object({
  clientCaptureId: Uuid,
  kind: z.enum(['PHOTO', 'AUDIO']),
  objectKey: z.string().min(1).max(500),
  mimeType: z.string().min(3).max(100),
  byteSize: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  capturedAt: IsoDateTime,
  location: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      accuracyMeters: z.number().nonnegative().nullable().default(null),
      altitudeMeters: z.number().nullable().default(null),
    })
    .nullable()
    .default(null),
  isMockLocation: z.boolean().default(false),
  headingDegrees: z.number().min(0).max(360).nullable().default(null),
  caption: z.string().trim().max(500).nullable().default(null),
  signature: z.string().max(2000).nullable().default(null),
});
export type RegisterNeedsVerificationCaptureRequest = z.infer<typeof RegisterNeedsVerificationCaptureRequestSchema>;
export type RegisterNeedsVerificationCaptureRequestInput = z.input<typeof RegisterNeedsVerificationCaptureRequestSchema>;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export const NeedsVerificationCaptureDtoSchema = z.object({
  clientCaptureId: Uuid,
  kind: z.enum(['PHOTO', 'AUDIO']),
  mimeType: z.string(),
  byteSize: z.number().int(),
  capturedAt: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  accuracyMeters: z.number().nullable(),
  headingDegrees: z.number().nullable(),
  answerPath: z.string().nullable(),
  /** Signed read link (web reads only; null on the field feed). */
  url: z.string().nullable(),
});
export type NeedsVerificationCaptureDto = z.infer<typeof NeedsVerificationCaptureDtoSchema>;

/** One coordinate correction acceptance applied (or would apply) to a site. */
export const NeedsSiteCoordinateCorrectionSchema = z.object({
  siteNumber: z.number().int(),
  schoolName: z.string(),
  from: z.object({ latitude: z.number(), longitude: z.number() }).nullable(),
  to: z.object({ latitude: z.number(), longitude: z.number() }),
  /** Distance moved (null when no location was stored). */
  distanceMeters: z.number().nullable(),
  accuracyMeters: z.number().nullable(),
});
export type NeedsSiteCoordinateCorrection = z.infer<typeof NeedsSiteCoordinateCorrectionSchema>;

/** What the officer found at one breakdown row (read from the answers). */
export const NeedsVerificationRowFactSchema = z.object({
  rowId: Uuid,
  unitId: z.string(),
  siteNumber: z.number().int(),
  facilityName: z.string(),
  recordedQuantity: z.number(),
  recordedCondition: ExistingConditionEnum,
  countedQuantity: z.number().nullable(),
  countedCondition: ExistingConditionEnum.nullable(),
  matchesAssessment: z.boolean().nullable(),
  comment: z.string().nullable(),
  /** The count or the condition differs from the needs assessment, or the officer said it does not match. */
  differs: z.boolean(),
});
export type NeedsVerificationRowFact = z.infer<typeof NeedsVerificationRowFactSchema>;

export const NeedsVerificationSiteFactSchema = z.object({
  siteNumber: z.number().int(),
  schoolName: z.string(),
  schoolFound: z.boolean().nullable(),
  comment: z.string().nullable(),
  location: NeedsVerificationSiteLocationSchema.nullable(),
});
export type NeedsVerificationSiteFact = z.infer<typeof NeedsVerificationSiteFactSchema>;

export const NeedsVerificationSubmissionDtoSchema = z.object({
  id: Uuid,
  clientSubmissionId: Uuid,
  status: NeedsVerificationSubmissionStatusEnum,
  formHash: z.string(),
  answers: VisitFormAnswersSchema,
  siteLocations: z.array(NeedsVerificationSiteLocationSchema),
  notes: z.string().nullable(),
  submittedByName: z.string(),
  submittedAtDevice: z.string(),
  submittedAt: z.string(),
  reviewedByName: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  reviewReason: z.string().nullable(),
  siteCorrections: z.array(NeedsSiteCoordinateCorrectionSchema).nullable(),
  evidenceDocumentIds: z.array(Uuid),
  siteFacts: z.array(NeedsVerificationSiteFactSchema),
  rowFacts: z.array(NeedsVerificationRowFactSchema),
});
export type NeedsVerificationSubmissionDto = z.infer<typeof NeedsVerificationSubmissionDtoSchema>;

/**
 * A verification as the web and the field app read it. `form` is left out of lists (the phone fetches
 * it with `GET /api/v1/needs-verifications/:id/form`, ETag = `formHash`). `siteVerificationDraft` is
 * the pre-filled site verification of an ACCEPTED VALIDATION verification (the Validation tab uses it).
 */
export const NeedsVerificationDtoSchema = z.object({
  id: Uuid,
  cycleId: Uuid,
  proposalId: Uuid,
  reference: z.string(),
  title: z.string(),
  programmeName: z.string(),
  stateCode: NigeriaStateCodeSchema.nullable(),
  lgaCodes: z.array(NigeriaLgaCodeSchema),
  purpose: NeedsVerificationPurposeEnum,
  status: NeedsVerificationStatusEnum,
  statusLabel: z.string(),
  officer: z.object({ userId: Uuid, name: z.string() }),
  assignedBy: z.object({ userId: Uuid, name: z.string() }),
  assignedAt: z.string(),
  dueDate: IsoDate,
  /** Due date passed while still ASSIGNED or RETURNED (tenant time zone). */
  overdue: z.boolean(),
  instructions: z.string().nullable(),
  versionNumber: z.number().int(),
  sites: z.array(NeedsVerificationFormSiteSchema),
  rowCount: z.number().int(),
  formHash: z.string(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  /** The live submission (SUBMITTED or ACCEPTED), else the latest RETURNED one; null before the first. */
  submission: NeedsVerificationSubmissionDtoSchema.nullable(),
  captures: z.array(NeedsVerificationCaptureDtoSchema),
  siteVerificationDraft: SiteVerificationSchema.nullable(),
  /** What the viewer may do now (web): CANCEL, REVIEW. */
  allowedActions: z.array(z.enum(['CANCEL', 'REVIEW'])),
});
export type NeedsVerificationDto = z.infer<typeof NeedsVerificationDtoSchema>;

/** `GET /api/v1/needs-verifications/:verificationId/form` (ETag = formHash; 304 when unchanged). */
export const NeedsVerificationFormDtoSchema = z.object({
  verificationId: Uuid,
  formHash: z.string(),
  form: NeedsVerificationFormSchema,
});
export type NeedsVerificationFormDto = z.infer<typeof NeedsVerificationFormDtoSchema>;

/**
 * `GET /api/v1/needs-verifications/mine` (field app; any signed-in principal, rows where the caller is
 * the officer): open and submitted ones (ASSIGNED, RETURNED, SUBMITTED) and those accepted or cancelled in the last 30 days.
 */
export const NeedsVerificationFeedDtoSchema = z.object({
  items: z.array(NeedsVerificationDtoSchema),
  serverTime: z.string(),
});
export type NeedsVerificationFeedDto = z.infer<typeof NeedsVerificationFeedDtoSchema>;

/** `GET /api/v1/needs/proposals/:proposalId/verification-officers?purpose=`: who can be assigned. */
export const NeedsVerificationOfficerSchema = z.object({
  userId: Uuid,
  name: z.string(),
  email: z.string(),
  organizationName: z.string().nullable(),
  roleName: z.string(),
  openVerifications: z.number().int(),
});
export type NeedsVerificationOfficer = z.infer<typeof NeedsVerificationOfficerSchema>;
