import { Prisma } from '@prisma/client';
import {
  DEFAULT_FORM_LIBRARY,
  EXISTING_CONDITION_LABELS,
  FormSectionDefinitionSchema,
  NEEDS_VERIFICATION_OPEN_STATUSES,
  NEEDS_VERIFICATION_SECTION_CODES,
  NEEDS_VERIFICATION_STATUS_LABELS,
  needsVerificationFacts,
  zonedCalendarDate,
  type BundleSection,
  type NeedsSiteCoordinateCorrection,
  type NeedsVerificationCaptureDto,
  type NeedsVerificationDto,
  type NeedsVerificationForm,
  type NeedsVerificationPurpose,
  type NeedsVerificationSiteLocation,
  type NeedsVerificationStatus,
  type NeedsVerificationSubmissionDto,
  type NeedsVerificationSubmissionStatus,
  type SiteVerification,
  type VisitFormAnswer,
} from '@insite/shared';
import { prisma } from '../../../config/prisma';
import { AppError } from '../../../middleware/error.middleware';
import { storageService } from '../../../integrations/storage.service';
import { tenantAreaPrefix } from '../../../utils/tenantUploads';
import { lockFormLibrary, parseFields } from '../../forms/formLibrary.service';
import { ensureFormLibrary } from '../../forms/formLibraryProvisioning';
import { safeZone } from '../../kpis/kpis.service';

/**
 * Needs pipeline wave 5 (N8): what the web and the field services of field verifications share
 * (loading, the reserved form sections, the DTO). Flow: `needsVerification.schema.ts` header.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export const VERIFICATION_INCLUDE = {
  proposal: { select: { id: true, reference: true, title: true, stateCode: true, lgaCodes: true, stage: true, status: true, currentVersionId: true } },
  cycle: true,
  submissions: { orderBy: { submittedAt: 'desc' } },
  captures: { orderBy: [{ capturedAtDevice: 'asc' }, { registeredAt: 'asc' }] },
} satisfies Prisma.NeedsVerificationInclude;

export type VerificationRow = Prisma.NeedsVerificationGetPayload<{ include: typeof VERIFICATION_INCLUDE }>;
export type SubmissionRow = VerificationRow['submissions'][number];
export type CaptureRow = VerificationRow['captures'][number];

export const VERIFICATION_NOT_FOUND = () => new AppError('Field verification not found', 404, 'NEEDS_VERIFICATION_NOT_FOUND');
export const NOT_OPEN = () => new AppError('This field verification is not waiting for the officer', 409, 'NEEDS_VERIFICATION_NOT_OPEN');

/** ASSIGNED, SUBMITTED, RETURNED: one per proposal and purpose. */
export const LIVE_VERIFICATION_STATUSES: NeedsVerificationStatus[] = ['ASSIGNED', 'SUBMITTED', 'RETURNED'];

export const isOpenForOfficer = (status: string) => NEEDS_VERIFICATION_OPEN_STATUSES.includes(status as NeedsVerificationStatus);

export const formOf = (row: { formJson: Prisma.JsonValue }) => row.formJson as unknown as NeedsVerificationForm;

/** Captures go under `tenants/<tenantId>/needs/verifications/<id>/captures/`. */
export const capturePrefix = (tenantId: string, verificationId: string) => tenantAreaPrefix(tenantId, `needs/verifications/${verificationId}/captures`);

/** Photos and voice notes the phone may upload (same list as the presign request schema). */
export const CAPTURE_UPLOAD_POLICY = {
  mimeTypes: ['image/jpeg', 'image/png', 'audio/m4a', 'audio/mp4', 'audio/aac', 'audio/mpeg'] as readonly string[],
  maxBytes: 25 * 1024 * 1024,
};

/** Locks the verification row for the rest of the transaction (submission and review race on it). */
export async function lockVerificationRow(tx: Prisma.TransactionClient, verificationId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM needs_verifications WHERE id = ${verificationId}::uuid FOR UPDATE`;
}

/** The live submission (SUBMITTED or ACCEPTED), else the latest RETURNED one. Rows newest first. */
export function shownSubmission<T extends { status: string }>(submissions: T[]): T | null {
  return submissions.find((s) => s.status === 'SUBMITTED' || s.status === 'ACCEPTED') ?? submissions.find((s) => s.status === 'RETURNED') ?? null;
}

// ---------------------------------------------------------------------------
// Reserved form sections
// ---------------------------------------------------------------------------

/**
 * The tenant's current NEEDS_VERIFICATION_SITE and NEEDS_VERIFICATION_FACILITY sections (latest
 * unarchived version). Libraries older than wave 5 lack them: they are provisioned at version 1 from
 * the defaults. Call inside the assigning transaction: it takes the form library lock, so no section
 * save edits a version in place while the form is frozen (the save counts verification forms as uses).
 */
export async function verificationSectionsInTx(tx: Prisma.TransactionClient, tenantId: string): Promise<{ site: BundleSection; facility: BundleSection }> {
  await ensureFormLibrary(tx, tenantId);
  await lockFormLibrary(tx, tenantId);
  const codes = Object.values(NEEDS_VERIFICATION_SECTION_CODES);
  const existing = new Set((await tx.formSection.findMany({ where: { tenantId, code: { in: codes } }, select: { code: true } })).map((s) => s.code));
  for (const code of codes.filter((c) => !existing.has(c))) {
    const def = DEFAULT_FORM_LIBRARY.sections.find((s) => s.code === code);
    if (!def) throw new AppError(`The default form library has no ${code} section`, 500, 'NEEDS_VERIFICATION_FORM_MISSING');
    const parsed = FormSectionDefinitionSchema.parse({ title: def.title, description: def.description ?? null, fields: def.fields });
    await tx.formSection.create({
      data: { tenantId, code, version: 1, title: parsed.title, description: parsed.description, fieldsJson: parsed.fields as unknown as Prisma.InputJsonValue },
    });
  }
  const rows = await tx.formSection.findMany({ where: { tenantId, code: { in: codes }, isArchived: false }, orderBy: { version: 'desc' } });
  const pick = (code: string): BundleSection => {
    const s = rows.find((r) => r.code === code);
    if (!s) throw new AppError('The field verification form is archived in the form library. Restore it to assign verifications.', 422, 'NEEDS_VERIFICATION_FORM_MISSING');
    return { id: s.id, code: s.code, version: s.version, title: s.title, description: s.description, fields: parseFields(s.fieldsJson) };
  };
  return { site: pick(NEEDS_VERIFICATION_SECTION_CODES.SITE), facility: pick(NEEDS_VERIFICATION_SECTION_CODES.FACILITY) };
}

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export async function tenantZone(tenantId: string, db: Db = prisma): Promise<string> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
  return safeZone(tenant?.timezone);
}

export async function programmeNames(projectTypeIds: string[], db: Db = prisma): Promise<Map<string, string>> {
  if (!projectTypeIds.length) return new Map();
  const rows = await db.projectType.findMany({ where: { id: { in: [...new Set(projectTypeIds)] } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

const siteLocationsOf = (s: SubmissionRow): NeedsVerificationSiteLocation[] => (Array.isArray(s.siteLocationsJson) ? (s.siteLocationsJson as unknown as NeedsVerificationSiteLocation[]) : []);
const answersOf = (s: SubmissionRow): VisitFormAnswer[] => (Array.isArray(s.answersJson) ? (s.answersJson as unknown as VisitFormAnswer[]) : []);
const correctionsOf = (s: SubmissionRow): NeedsSiteCoordinateCorrection[] | null =>
  Array.isArray(s.siteCorrectionsJson) ? (s.siteCorrectionsJson as unknown as NeedsSiteCoordinateCorrection[]) : null;

export function serializeSubmission(s: SubmissionRow, form: NeedsVerificationForm): NeedsVerificationSubmissionDto {
  const answers = answersOf(s);
  const siteLocations = siteLocationsOf(s);
  const facts = needsVerificationFacts(form, answers, siteLocations);
  return {
    id: s.id,
    clientSubmissionId: s.clientSubmissionId,
    status: s.status as NeedsVerificationSubmissionStatus,
    formHash: s.formHash,
    answers,
    siteLocations,
    notes: s.notes,
    submittedByName: s.submittedByName,
    submittedAtDevice: s.submittedAtDevice.toISOString(),
    submittedAt: s.submittedAt.toISOString(),
    reviewedByName: s.reviewedByName,
    reviewedAt: s.reviewedAt?.toISOString() ?? null,
    reviewReason: s.reviewReason,
    siteCorrections: correctionsOf(s),
    evidenceDocumentIds: s.evidenceDocumentIds,
    siteFacts: facts.siteFacts,
    rowFacts: facts.rowFacts,
  };
}

const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));

/** The site verification's evidence list holds at most this many documents (`SiteVerificationSchema`). */
const MAX_DRAFT_EVIDENCE = 50;

/**
 * "What differs" for the validator, in a few sentences (max 4000 characters). `morePhotos`: photos
 * filed beyond the draft's evidence list, named in a closing sentence that is always kept.
 */
export function differenceSummary(form: NeedsVerificationForm, dto: NeedsVerificationSubmissionDto, morePhotos = 0): string {
  const parts: string[] = [];
  const checked = `${dto.siteFacts.length} site${dto.siteFacts.length === 1 ? '' : 's'} and ${dto.rowFacts.length} facilit${dto.rowFacts.length === 1 ? 'y' : 'ies'} checked on the field app.`;
  parts.push(checked);
  for (const s of dto.siteFacts.filter((f) => f.schoolFound === false)) parts.push(`Site ${s.siteNumber} (${s.schoolName}): school not found at the site${s.comment ? ` (${s.comment})` : ''}.`);
  for (const r of dto.rowFacts.filter((f) => f.differs)) {
    const row = form.rows.find((x) => x.rowId === r.rowId);
    const unit = row?.unitOfMeasure ?? '';
    const bits: string[] = [];
    if (r.countedQuantity !== null && Math.abs(r.countedQuantity - r.recordedQuantity) > 1e-9) {
      bits.push(`${`counted ${qty(r.countedQuantity)} ${unit}`.trim()} (assessment ${qty(r.recordedQuantity)})`);
    }
    if (r.countedCondition && r.countedCondition !== r.recordedCondition) {
      bits.push(`${EXISTING_CONDITION_LABELS[r.countedCondition].toLowerCase()} (assessment ${EXISTING_CONDITION_LABELS[r.recordedCondition].toLowerCase()})`);
    }
    if (r.matchesAssessment === false) bits.push(`does not match the assessment${r.comment ? `: ${r.comment}` : ''}`);
    parts.push(`Site ${r.siteNumber}, ${r.facilityName} ${r.unitId}: ${bits.join('; ')}.`);
  }
  for (const c of dto.siteCorrections ?? []) {
    parts.push(`Site ${c.siteNumber} location corrected${c.distanceMeters !== null ? ` (moved ${c.distanceMeters} m)` : ' (no location was recorded)'}.`);
  }
  if (parts.length === 1) parts.push('Everything matches the needs assessment.');
  if (dto.notes) parts.push(`Officer's notes: ${dto.notes}`);
  const tail = morePhotos > 0 ? ` ${morePhotos} more photo${morePhotos === 1 ? ' is' : 's are'} filed on the proposal's Documents tab.` : '';
  const text = parts.join(' ');
  const room = 4000 - tail.length;
  return (text.length > room ? `${text.slice(0, room - 3)}...` : text) + tail;
}

/**
 * The pre-filled site verification of an ACCEPTED VALIDATION verification (the validator still records
 * it). None once the proposal has a newer version than the one verified (`recordValidation` refuses it).
 */
export function siteVerificationDraft(row: VerificationRow, zone: string): SiteVerification | null {
  if (row.purpose !== 'VALIDATION' || row.status !== 'ACCEPTED') return null;
  if (row.versionId !== row.proposal.currentVersionId) return null;
  const accepted = row.submissions.find((s) => s.status === 'ACCEPTED');
  if (!accepted) return null;
  const form = formOf(row);
  const dto = serializeSubmission(accepted, form);
  return {
    method: 'FIELD_APP',
    verifiedOn: zonedCalendarDate(accepted.submittedAtDevice, zone),
    officerName: (accepted.submittedByName.trim() || row.officerName).slice(0, 160),
    notes: differenceSummary(form, dto, Math.max(0, accepted.evidenceDocumentIds.length - MAX_DRAFT_EVIDENCE)),
    evidenceDocumentIds: accepted.evidenceDocumentIds.slice(0, MAX_DRAFT_EVIDENCE),
    verificationId: row.id,
  };
}

function serializeCapture(c: CaptureRow, url: string | null): NeedsVerificationCaptureDto {
  return {
    clientCaptureId: c.clientCaptureId,
    kind: c.kind as 'PHOTO' | 'AUDIO',
    mimeType: c.mimeType,
    byteSize: c.byteSize,
    capturedAt: c.capturedAtDevice.toISOString(),
    latitude: c.latitude,
    longitude: c.longitude,
    accuracyMeters: c.accuracyMeters,
    headingDegrees: c.headingDegrees,
    answerPath: c.answerPath,
    url,
  };
}

export interface SerializeOptions {
  programmeName: string;
  zone: string;
  /** Today in the tenant zone (overdue). */
  today: string;
  allowedActions: NeedsVerificationDto['allowedActions'];
  /** Signed read links on captures (web reads). */
  signUrls: boolean;
}

export async function serializeVerification(row: VerificationRow, opts: SerializeOptions): Promise<NeedsVerificationDto> {
  const form = formOf(row);
  const shown = shownSubmission(row.submissions);
  const dueDate = row.dueDate.toISOString().slice(0, 10);
  const captures = await Promise.all(row.captures.map(async (c) => serializeCapture(c, opts.signUrls ? await storageService.getPresignedReadUrl(c.objectKey, 300) : null)));
  return {
    id: row.id,
    cycleId: row.cycleId,
    proposalId: row.proposalId,
    reference: row.proposal.reference,
    title: row.proposal.title,
    programmeName: opts.programmeName,
    stateCode: (row.proposal.stateCode as NeedsVerificationDto['stateCode']) ?? null,
    lgaCodes: row.proposal.lgaCodes as NeedsVerificationDto['lgaCodes'],
    purpose: row.purpose as NeedsVerificationPurpose,
    status: row.status as NeedsVerificationStatus,
    statusLabel: NEEDS_VERIFICATION_STATUS_LABELS[row.status as NeedsVerificationStatus] ?? row.status,
    officer: { userId: row.officerUserId, name: row.officerName },
    assignedBy: { userId: row.assignedByUserId, name: row.assignedByName },
    assignedAt: row.assignedAt.toISOString(),
    dueDate,
    overdue: isOpenForOfficer(row.status) && dueDate < opts.today,
    instructions: row.instructions,
    versionNumber: form.context.versionNumber,
    sites: form.sites,
    rowCount: form.rows.length,
    formHash: row.formHash,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
    submission: shown ? serializeSubmission(shown, form) : null,
    captures,
    siteVerificationDraft: siteVerificationDraft(row, opts.zone),
    allowedActions: opts.allowedActions,
  };
}
