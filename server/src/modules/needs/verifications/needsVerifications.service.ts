import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import {
  NEEDS_OPEN_PROPOSAL_STATUSES,
  NEEDS_SEPARATION_ERROR_MESSAGES,
  NEEDS_TEMPLATE_VERSION,
  NEEDS_VERIFICATION_PURPOSE_LABELS,
  assembleNeedsVerificationForm,
  canonicalNeedsVerificationForm,
  formatCalendarDate,
  normaliseSchoolName,
  siteCoordinateCorrections,
  sitesNotFound,
  zonedCalendarDate,
  type AssignNeedsVerificationRequest,
  type CancelNeedsVerificationRequest,
  type ExistingCondition,
  type NeedsProposalStatus,
  type NeedsSiteCoordinateCorrection,
  type NeedsVerificationDto,
  type NeedsVerificationFormRow,
  type NeedsVerificationFormSite,
  type NeedsVerificationOfficer,
  type NeedsVerificationPurpose,
  type NeedsVerificationSiteLocation,
  type ReviewNeedsVerificationRequest,
  type VisitFormAnswer,
} from '@insite/shared';
import { prisma } from '../../../config/prisma';
import { AppError } from '../../../middleware/error.middleware';
import type { WebJwtPayload } from '../../../middleware/auth.middleware';
import { sendMessage } from '../../../integrations/messaging';
import { recordAuditEvent } from '../../audit/audit.service';
import { organizationAncestorIds, organizationSubtreeIds } from '../../organizations/hierarchy';
import { cycleLabel, proposalUrl } from '../decisions/needsEmails';
import { recordOverrideUseInTx } from '../decisions/needsOverrides.service';
import { holds, loadRuleFacts, separationFor, type OverrideFlagFact } from '../decisions/proposalRules';
import { assertCycleWritable, isUuid, loadVisibleCycle, loadVisibleProposal, webActor, type CycleRow, type Db } from '../needsAccess';
import { applyFlagFindings, computeFlagFindings } from '../needsFlags.service';
import { costingStandardById, cycleConfig, facilityNames, parsedOf } from '../needsSupport';
import { lockCycle } from '../needsVersions';
import { overlayCurrentSiteCoordinates } from './siteCorrections';
import {
  LIVE_VERIFICATION_STATUSES,
  VERIFICATION_INCLUDE,
  VERIFICATION_NOT_FOUND,
  formOf,
  isOpenForOfficer,
  lockVerificationRow,
  programmeNames,
  serializeVerification,
  tenantZone,
  verificationSectionsInTx,
  type VerificationRow,
} from './needsVerificationSupport';

/**
 * Needs pipeline wave 5 (N8): the web side of field verifications under /api/v1/needs (assign,
 * officers, read, cancel, review). Flow: `needsVerification.schema.ts` header.
 *
 * Who (per purpose):
 * - VALIDATION: `needs:validate`, the cycle's owning organisation writing, the cycle OPEN (the
 *   `assertCycleWritable` rule). Assigning needs the proposal IN_PROGRESS at Validation; accepting
 *   applies the VALIDATE separation rule (uploaders may not validate; a second person's authorisation
 *   lets them, `recordOverrideUseInTx`).
 * - BEAP_REVIEW: `needs:review_beap`, an organisation strictly above the cycle's owner (UBEC above the
 *   SUBEB), the cycle OPEN. Assigning needs the proposal on the cycle's latest BEAP while IN_REVIEW.
 * Officers: active users of the tenant with an effective mobile role whose main role holds
 * `needs:view`; VALIDATION: in the owner's organisation or below it; BEAP_REVIEW: strictly above it.
 */

type Tx = Prisma.TransactionClient;

const forbidden = (message: string, code = 'FORBIDDEN_PERMISSION') => new AppError(message, 403, code);
const PERMISSION_OF: Record<NeedsVerificationPurpose, string> = { VALIDATION: 'needs:validate', BEAP_REVIEW: 'needs:review_beap' };

async function aboveOwner(db: Db, user: WebJwtPayload, cycle: Pick<CycleRow, 'owningOrganizationId'>): Promise<boolean> {
  if (user.isPlatformSuperAdmin) return true;
  return (await organizationAncestorIds(cycle.owningOrganizationId, db)).includes(user.organizationId);
}

/** The purpose's permission, organisation and open-cycle rule (throws the first problem). */
async function assertPurposeGate(db: Db, user: WebJwtPayload, cycle: CycleRow, purpose: NeedsVerificationPurpose): Promise<void> {
  const permission = PERMISSION_OF[purpose];
  if (!holds(user, permission)) throw forbidden(`Access requires permission(s): ${permission}`);
  if (purpose === 'VALIDATION') {
    assertCycleWritable(user, cycle);
    return;
  }
  if (!(await aboveOwner(db, user, cycle))) {
    throw forbidden("A BEAP site visit is UBEC's: it needs an organisation above the State's SUBEB.", 'NEEDS_CYCLE_FORBIDDEN');
  }
  if (cycle.status !== 'OPEN') throw new AppError('This cycle is not open', 409, 'NEEDS_CYCLE_NOT_OPEN');
}

async function passesPurposeGate(db: Db, user: WebJwtPayload, cycle: CycleRow, purpose: NeedsVerificationPurpose): Promise<boolean> {
  try {
    await assertPurposeGate(db, user, cycle, purpose);
    return true;
  } catch {
    return false;
  }
}

/** The proposal is on the cycle's latest BEAP while it is in UBEC's review. */
async function onBeapInReview(db: Db, cycleId: string, proposalId: string): Promise<boolean> {
  const beap = await db.needsSubmission.findFirst({ where: { cycleId, kind: 'BEAP' }, orderBy: { createdAt: 'desc' }, select: { status: true, items: { select: { proposalId: true } } } });
  return Boolean(beap && beap.status === 'IN_REVIEW' && beap.items.some((i) => i.proposalId === proposalId));
}

// ---------------------------------------------------------------------------
// Officers
// ---------------------------------------------------------------------------

async function eligibleOrganizationIds(db: Db, cycle: CycleRow, purpose: NeedsVerificationPurpose): Promise<string[]> {
  return purpose === 'VALIDATION' ? organizationSubtreeIds(cycle.tenantId, cycle.owningOrganizationId, db) : organizationAncestorIds(cycle.owningOrganizationId, db);
}

const mobileCapable = (role: { surface: string } | null | undefined) => Boolean(role && role.surface !== 'WEB');

async function officersFor(db: Db, cycle: CycleRow, purpose: NeedsVerificationPurpose): Promise<NeedsVerificationOfficer[]> {
  const orgIds = await eligibleOrganizationIds(db, cycle, purpose);
  if (!orgIds.length) return [];
  const users = await db.user.findMany({
    where: {
      tenantId: cycle.tenantId,
      isActive: true,
      organizationId: { in: orgIds },
      role: { rolePermissions: { some: { permission: { key: 'needs:view' } } } },
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      organization: { select: { name: true } },
      role: { select: { name: true, surface: true } },
      mobileRole: { select: { name: true, surface: true } },
    },
    orderBy: { fullName: 'asc' },
  });
  // effectiveMobileRole: the separate mobile role if mobile-capable, else the main role if it is.
  const eligible = users.filter((u) => mobileCapable(u.mobileRole) || mobileCapable(u.role));
  if (!eligible.length) return [];
  const open = await db.needsVerification.groupBy({
    by: ['officerUserId'],
    where: { tenantId: cycle.tenantId, officerUserId: { in: eligible.map((u) => u.id) }, status: { in: ['ASSIGNED', 'RETURNED'] } },
    _count: { _all: true },
  });
  const openBy = new Map(open.map((o) => [o.officerUserId, o._count._all]));
  return eligible.map((u) => ({
    userId: u.id,
    name: u.fullName,
    email: u.email,
    organizationName: u.organization?.name ?? null,
    roleName: (mobileCapable(u.mobileRole) ? u.mobileRole!.name : u.role.name) ?? u.role.name,
    openVerifications: openBy.get(u.id) ?? 0,
  }));
}

export async function listVerificationOfficers(user: WebJwtPayload, proposalId: string, purpose: NeedsVerificationPurpose): Promise<NeedsVerificationOfficer[]> {
  const p = await loadVisibleProposal(user, proposalId);
  return officersFor(prisma, p.cycle, purpose);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The actions the viewer may take on each row (CANCEL, REVIEW). */
async function allowedActionsFor(db: Db, user: WebJwtPayload, rows: VerificationRow[]): Promise<Map<string, NeedsVerificationDto['allowedActions']>> {
  const out = new Map<string, NeedsVerificationDto['allowedActions']>();
  const reviewable = rows.filter((r) => r.status === 'SUBMITTED' && r.purpose === 'VALIDATION');
  const facts = reviewable.length ? await loadRuleFacts(db, user, [], [...new Set(reviewable.map((r) => r.proposalId))]) : null;
  const gateCache = new Map<string, boolean>();
  for (const r of rows) {
    const key = `${r.cycleId}|${r.purpose}`;
    if (!gateCache.has(key)) gateCache.set(key, await passesPurposeGate(db, user, r.cycle, r.purpose as NeedsVerificationPurpose));
    const gate = gateCache.get(key)!;
    const actions: NeedsVerificationDto['allowedActions'] = [];
    if (gate && isOpenForOfficer(r.status)) actions.push('CANCEL');
    if (gate && r.status === 'SUBMITTED') {
      const allowed = r.purpose !== 'VALIDATION' || separationFor(facts!, r.proposal, 'VALIDATE', user.userId).check.allowed;
      if (allowed) actions.push('REVIEW');
    }
    out.set(r.id, actions);
  }
  return out;
}

async function serializeForViewer(user: WebJwtPayload, rows: VerificationRow[], signUrls: boolean): Promise<NeedsVerificationDto[]> {
  if (!rows.length) return [];
  const [names, zone, actions] = await Promise.all([
    programmeNames(rows.map((r) => r.cycle.projectTypeId)),
    tenantZone(user.tenantId),
    allowedActionsFor(prisma, user, rows),
  ]);
  const today = zonedCalendarDate(new Date(), zone);
  return Promise.all(
    rows.map((r) => serializeVerification(r, { programmeName: names.get(r.cycle.projectTypeId) ?? 'Needs assessment', zone, today, allowedActions: actions.get(r.id) ?? [], signUrls }))
  );
}

export async function listProposalVerifications(user: WebJwtPayload, proposalId: string): Promise<NeedsVerificationDto[]> {
  const p = await loadVisibleProposal(user, proposalId);
  const rows = await prisma.needsVerification.findMany({ where: { proposalId: p.id }, include: VERIFICATION_INCLUDE, orderBy: { assignedAt: 'desc' } });
  return serializeForViewer(user, rows, true);
}

export async function listCycleVerifications(user: WebJwtPayload, cycleId: string): Promise<NeedsVerificationDto[]> {
  const cycle = await loadVisibleCycle(user, cycleId);
  const rows = await prisma.needsVerification.findMany({ where: { cycleId: cycle.id }, include: VERIFICATION_INCLUDE, orderBy: { assignedAt: 'desc' } });
  return serializeForViewer(user, rows, false);
}

/** A verification whose proposal the user can see, else 404 NEEDS_VERIFICATION_NOT_FOUND. */
async function loadVisibleVerification(user: WebJwtPayload, verificationId: string, db: Db = prisma): Promise<VerificationRow> {
  if (!isUuid(verificationId)) throw VERIFICATION_NOT_FOUND();
  const row = await db.needsVerification.findFirst({ where: { id: verificationId, tenantId: user.tenantId }, include: VERIFICATION_INCLUDE });
  if (!row) throw VERIFICATION_NOT_FOUND();
  try {
    await loadVisibleProposal(user, row.proposalId, db);
  } catch {
    throw VERIFICATION_NOT_FOUND();
  }
  return row;
}

export async function getVerification(user: WebJwtPayload, verificationId: string): Promise<NeedsVerificationDto> {
  const row = await loadVisibleVerification(user, verificationId);
  return (await serializeForViewer(user, [row], true))[0];
}

async function dtoById(user: WebJwtPayload, id: string): Promise<NeedsVerificationDto> {
  const row = await prisma.needsVerification.findUniqueOrThrow({ where: { id }, include: VERIFICATION_INCLUDE });
  return (await serializeForViewer(user, [row], true))[0];
}

// ---------------------------------------------------------------------------
// Assign
// ---------------------------------------------------------------------------

const dec = (v: Prisma.Decimal | number) => Number(v);

export async function assignVerification(user: WebJwtPayload, proposalId: string, input: AssignNeedsVerificationRequest): Promise<NeedsVerificationDto> {
  const base = await loadVisibleProposal(user, proposalId);
  const purpose = input.purpose;
  await assertPurposeGate(prisma, user, base.cycle, purpose);
  const zone = await tenantZone(user.tenantId);
  const today = zonedCalendarDate(new Date(), zone);
  if (input.dueDate < today) throw new AppError('The due date cannot be in the past', 422, 'NEEDS_VERIFICATION_DUE_DATE_INVALID');

  const created = await prisma.$transaction(
    async (tx) => {
      await lockCycle(tx, base.cycleId);
      const cycle = await tx.needsCycle.findUniqueOrThrow({ where: { id: base.cycleId } });
      await assertPurposeGate(tx, user, cycle, purpose);
      const proposal = await tx.needsProposal.findUniqueOrThrow({ where: { id: base.id }, include: { currentVersion: { select: { id: true, number: true } } } });
      if (purpose === 'VALIDATION' && (proposal.stage !== 'VALIDATION' || proposal.status !== 'IN_PROGRESS')) {
        throw new AppError(`${proposal.reference} is not waiting for validation`, 409, 'NEEDS_STAGE_ACTION_NOT_ALLOWED');
      }
      if (purpose === 'BEAP_REVIEW' && !(await onBeapInReview(tx, cycle.id, proposal.id))) {
        throw new AppError(`${proposal.reference} is not on a BEAP in UBEC's review`, 409, 'NEEDS_STAGE_ACTION_NOT_ALLOWED');
      }
      if (!proposal.currentVersion) throw new AppError(`${proposal.reference} has no needs assessment to verify`, 422, 'NEEDS_VERIFICATION_SITES_INVALID');

      const officers = await officersFor(tx, cycle, purpose);
      const officer = officers.find((o) => o.userId === input.officerUserId);
      if (!officer) throw new AppError('Choose an officer with a field app sign-in in the right organisation', 422, 'NEEDS_VERIFICATION_OFFICER_INVALID');

      const live = await tx.needsVerification.count({ where: { proposalId: proposal.id, purpose, status: { in: LIVE_VERIFICATION_STATUSES } } });
      if (live > 0) throw new AppError(`${proposal.reference} already has an open ${NEEDS_VERIFICATION_PURPOSE_LABELS[purpose].toLowerCase()}`, 409, 'NEEDS_VERIFICATION_OPEN_EXISTS');

      const allSites = await tx.needsProposalSite.findMany({ where: { proposalId: proposal.id }, orderBy: { siteNumber: 'asc' } });
      const wanted = [...new Set(input.siteNumbers)];
      const unknown = wanted.filter((n) => !allSites.some((s) => s.siteNumber === n));
      if (!allSites.length || unknown.length) {
        throw new AppError(
          allSites.length ? `Site${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not on ${proposal.reference}` : `${proposal.reference} lists no site`,
          422,
          'NEEDS_VERIFICATION_SITES_INVALID',
          { unknownSiteNumbers: unknown }
        );
      }
      const sites = wanted.length ? allSites.filter((s) => wanted.includes(s.siteNumber)) : allSites;
      const siteNumbers = sites.map((s) => s.siteNumber);
      const rows = await tx.needsFacilityBreakdownRow.findMany({ where: { proposalId: proposal.id, siteNumber: { in: siteNumbers } }, orderBy: [{ siteNumber: 'asc' }, { sortOrder: 'asc' }] });
      const names = await facilityNames(user.tenantId, tx);
      const sections = await verificationSectionsInTx(tx, user.tenantId);
      const formSites: NeedsVerificationFormSite[] = sites.map((s) => ({
        siteNumber: s.siteNumber,
        schoolName: s.schoolName,
        lgaCode: s.lgaCode,
        address: s.address,
        latitude: s.latitude,
        longitude: s.longitude,
      }));
      const formRows: NeedsVerificationFormRow[] = rows.map((r) => ({
        rowId: r.id,
        unitId: r.unitId,
        siteNumber: r.siteNumber,
        facilityCode: r.facilityCode,
        facilityName: names.get(r.facilityCode.toUpperCase()) ?? r.facilityCode,
        interventionAction: r.interventionAction,
        existingQuantity: dec(r.existingQuantity),
        existingCondition: r.existingCondition as ExistingCondition,
        proposedQuantity: dec(r.proposedQuantity),
        unitOfMeasure: r.unitOfMeasure,
      }));
      const form = assembleNeedsVerificationForm({
        cycleId: cycle.id,
        proposalId: proposal.id,
        reference: proposal.reference,
        title: proposal.title,
        purpose,
        versionNumber: proposal.currentVersion.number,
        siteSection: sections.site,
        facilitySection: sections.facility,
        sites: formSites,
        rows: formRows,
        builtAt: new Date().toISOString(),
      });
      const formHash = crypto.createHash('sha256').update(canonicalNeedsVerificationForm(form)).digest('hex');
      const row = await tx.needsVerification.create({
        data: {
          tenantId: user.tenantId,
          cycleId: cycle.id,
          proposalId: proposal.id,
          versionId: proposal.currentVersion.id,
          purpose,
          officerUserId: officer.userId,
          officerName: officer.name,
          assignedByUserId: user.userId,
          assignedByName: user.fullName,
          dueDate: new Date(`${input.dueDate}T00:00:00.000Z`),
          instructions: input.instructions,
          siteNumbers: wanted.length ? siteNumbers : [],
          formJson: form as unknown as Prisma.InputJsonValue,
          formHash,
        },
      });
      await recordAuditEvent(tx, {
        tenantId: user.tenantId,
        projectId: null,
        ...webActor(user),
        action: 'NEEDS_VERIFICATION_ASSIGNED',
        summaryText: `Assigned a ${NEEDS_VERIFICATION_PURPOSE_LABELS[purpose].toLowerCase()} of ${proposal.reference} (site${siteNumbers.length === 1 ? '' : 's'} ${siteNumbers.join(', ')}) to ${officer.name}, due ${formatCalendarDate(input.dueDate)}.`,
        payload: {
          cycleId: cycle.id,
          proposalId: proposal.id,
          reference: proposal.reference,
          verificationId: row.id,
          purpose,
          officerUserId: officer.userId,
          dueDate: input.dueDate,
          siteNumbers,
          versionNumber: proposal.currentVersion.number,
          formHash,
          sectionVersions: form.sources.sections,
        },
      });
      return { id: row.id, officer, cycle, reference: proposal.reference, title: proposal.title };
    },
    { timeout: 30_000 }
  );

  // The phone feed is the main channel; the email is a courtesy (a failed send never fails the request).
  try {
    await sendMessage({
      tenantId: user.tenantId,
      projectId: null,
      channel: 'EMAIL',
      to: created.officer.email,
      templateKey: 'NEEDS_TASK_NOTICE',
      data: {
        kind: 'WAITING',
        recipientName: created.officer.name,
        cycleLabel: await cycleLabel(created.cycle),
        stageLabel: `${NEEDS_VERIFICATION_PURPOSE_LABELS[purpose]} on the field app`,
        proposals: [{ reference: created.reference, title: created.title }],
        reason: [`Due ${formatCalendarDate(input.dueDate)}.`, input.instructions].filter(Boolean).join(' '),
        dueDate: formatCalendarDate(input.dueDate),
        url: proposalUrl(base.id),
      },
    });
  } catch (error) {
    console.error('[needs verifications] assignment email failed', error);
  }
  return dtoById(user, created.id);
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

export async function cancelVerification(user: WebJwtPayload, verificationId: string, input: CancelNeedsVerificationRequest): Promise<NeedsVerificationDto> {
  const base = await loadVisibleVerification(user, verificationId);
  await prisma.$transaction(async (tx) => {
    await lockCycle(tx, base.cycleId);
    await lockVerificationRow(tx, base.id);
    const row = await tx.needsVerification.findUniqueOrThrow({ where: { id: base.id }, include: VERIFICATION_INCLUDE });
    await assertPurposeGate(tx, user, row.cycle, row.purpose as NeedsVerificationPurpose);
    if (!isOpenForOfficer(row.status)) {
      throw new AppError('Only a verification the officer has not submitted (or that was returned) can be cancelled', 409, 'NEEDS_VERIFICATION_NOT_OPEN');
    }
    await tx.needsVerification.update({ where: { id: row.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledByName: user.fullName, cancelReason: input.reason } });
    await recordAuditEvent(tx, {
      tenantId: user.tenantId,
      projectId: null,
      ...webActor(user),
      action: 'NEEDS_VERIFICATION_CANCELLED',
      summaryText: `Cancelled the ${NEEDS_VERIFICATION_PURPOSE_LABELS[row.purpose as NeedsVerificationPurpose].toLowerCase()} of ${row.proposal.reference} assigned to ${row.officerName}: ${input.reason}`,
      payload: { cycleId: row.cycleId, proposalId: row.proposalId, reference: row.proposal.reference, verificationId: row.id, purpose: row.purpose, reason: input.reason },
    });
  });
  return dtoById(user, base.id);
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

const PHOTO_SITE_RE = /^n:site:(\d+)\//;
const PHOTO_ROW_RE = /^n:row:([0-9a-f-]{36})\//i;

/** The stored file name: the key's tail without the `<ms>-<uuid>-` prefix. */
function fileNameOfKey(objectKey: string): string {
  const tail = objectKey.slice(objectKey.lastIndexOf('/') + 1);
  return tail.split('-').slice(6).join('-') || tail;
}

/** Files the accepted submission's photos as PHOTO documents of the proposal. Returns their ids in order. */
async function filePhotosInTx(tx: Tx, row: VerificationRow, submissionId: string, submittedBy: { userId: string; name: string }): Promise<string[]> {
  const form = formOf(row);
  const photos = row.captures
    .filter((c) => c.submissionId === submissionId && c.kind === 'PHOTO')
    .map((c) => {
      const site = c.answerPath?.match(PHOTO_SITE_RE);
      const rowMatch = c.answerPath?.match(PHOTO_ROW_RE);
      const siteNumber = site ? Number(site[1]) : rowMatch ? (form.rows.find((r) => r.rowId === rowMatch[1])?.siteNumber ?? null) : null;
      return { capture: c, siteNumber };
    })
    .sort((a, b) => (a.siteNumber ?? 1e9) - (b.siteNumber ?? 1e9) || a.capture.capturedAtDevice.getTime() - b.capture.capturedAtDevice.getTime());
  const counter = new Map<number | null, number>();
  const ids: string[] = [];
  for (const { capture, siteNumber } of photos) {
    const already = await tx.needsProposalDocument.findFirst({ where: { proposalId: row.proposalId, objectKey: capture.objectKey }, select: { id: true } });
    if (already) {
      ids.push(already.id);
      continue;
    }
    const k = (counter.get(siteNumber) ?? 0) + 1;
    counter.set(siteNumber, k);
    const doc = await tx.needsProposalDocument.create({
      data: {
        proposalId: row.proposalId,
        kind: 'PHOTO',
        title: `Field verification ${row.proposal.reference}${siteNumber !== null ? `, site ${siteNumber}` : ''}: photo ${k}`,
        objectKey: capture.objectKey,
        fileName: fileNameOfKey(capture.objectKey),
        mimeType: capture.mimeType,
        byteSize: capture.byteSize,
        sha256: capture.serverSha256 ?? capture.clientSha256,
        uploadedByUserId: submittedBy.userId,
        uploadedByName: submittedBy.name,
      },
    });
    ids.push(doc.id);
  }
  return ids;
}

/**
 * Applies the corrections to the current sites (same site number and school name). Returns what was
 * applied. A site the officer answered "school not found" is never moved (review fix, wave 5).
 */
async function correctSitesInTx(tx: Tx, row: VerificationRow, siteLocations: NeedsVerificationSiteLocation[], answers: VisitFormAnswer[]): Promise<NeedsSiteCoordinateCorrection[]> {
  const form = formOf(row);
  const current = await tx.needsProposalSite.findMany({ where: { proposalId: row.proposalId } });
  const matched = form.sites.flatMap((s) => {
    const site = current.find((c) => c.siteNumber === s.siteNumber && c.schoolNameKey === normaliseSchoolName(s.schoolName));
    return site ? [{ site, formSite: { ...s, latitude: site.latitude, longitude: site.longitude } }] : [];
  });
  const corrections = siteCoordinateCorrections(
    matched.map((m) => m.formSite),
    siteLocations,
    { skipSiteNumbers: sitesNotFound(form, answers) }
  );
  for (const c of corrections) {
    const m = matched.find((x) => x.formSite.siteNumber === c.siteNumber)!;
    await tx.needsProposalSite.update({ where: { id: m.site.id }, data: { latitude: c.to.latitude, longitude: c.to.longitude } });
  }
  return corrections;
}

/** Re-runs the proposal's flags on its current version with the corrected sites (duplicate radius). */
async function rerunFlagsInTx(tx: Tx, cycle: CycleRow, proposal: { id: string; reference: string; stateCode: string | null; currentVersionId: string | null }): Promise<void> {
  if (!proposal.currentVersionId) return;
  const version = await tx.needsAssessmentVersion.findUnique({ where: { id: proposal.currentVersionId } });
  const fileParse = parsedOf(version?.parsedJson);
  if (!version || !fileParse) return;
  const parsed = await overlayCurrentSiteCoordinates(tx, proposal.id, fileParse);
  const findings = await computeFlagFindings(
    tx,
    {
      tenantId: cycle.tenantId,
      config: cycleConfig(cycle),
      standard: await costingStandardById(cycle.costingStandardVersionId, tx),
      stateCode: proposal.stateCode,
      proposalId: proposal.id,
      isLegacyTemplate: version.templateVersion !== NEEDS_TEMPLATE_VERSION,
    },
    parsed
  );
  await applyFlagFindings(tx, { tenantId: cycle.tenantId, cycleId: cycle.id, proposalId: proposal.id, reference: proposal.reference, versionId: version.id, versionNumber: version.number, findings });
}

export async function reviewVerification(user: WebJwtPayload, verificationId: string, input: ReviewNeedsVerificationRequest): Promise<NeedsVerificationDto> {
  const base = await loadVisibleVerification(user, verificationId);
  await prisma.$transaction(
    async (tx) => {
      await lockCycle(tx, base.cycleId);
      await lockVerificationRow(tx, base.id);
      const row = await tx.needsVerification.findUniqueOrThrow({ where: { id: base.id }, include: VERIFICATION_INCLUDE });
      const purpose = row.purpose as NeedsVerificationPurpose;
      const submission = row.submissions.find((s) => s.status === 'SUBMITTED');
      if (row.status !== 'SUBMITTED' || !submission) throw new AppError('Nothing is waiting for review on this verification', 409, 'NEEDS_VERIFICATION_NOT_SUBMITTED');
      await assertPurposeGate(tx, user, row.cycle, purpose);
      const proposal = await tx.needsProposal.findUniqueOrThrow({ where: { id: row.proposalId } });
      let overrideFlag: OverrideFlagFact | null = null;
      if (purpose === 'VALIDATION') {
        const facts = await loadRuleFacts(tx, user, [], [proposal.id]);
        const { check, flag } = separationFor(facts, proposal, 'VALIDATE', user.userId);
        if (!check.allowed) throw new AppError(NEEDS_SEPARATION_ERROR_MESSAGES[check.violation!], 409, check.violation!);
        overrideFlag = flag;
      }
      const label = NEEDS_VERIFICATION_PURPOSE_LABELS[purpose].toLowerCase();
      const now = new Date();

      if (input.decision === 'RETURN') {
        await tx.needsVerificationSubmission.update({
          where: { id: submission.id },
          data: { status: 'RETURNED', reviewedByUserId: user.userId, reviewedByName: user.fullName, reviewedAt: now, reviewReason: input.reason },
        });
        await tx.needsVerification.update({ where: { id: row.id }, data: { status: 'RETURNED' } });
        await recordAuditEvent(tx, {
          tenantId: user.tenantId,
          projectId: null,
          ...webActor(user),
          action: 'NEEDS_VERIFICATION_REVIEWED',
          summaryText: `Returned the ${label} of ${proposal.reference} to ${row.officerName}: ${input.reason}`,
          payload: { cycleId: row.cycleId, proposalId: proposal.id, reference: proposal.reference, verificationId: row.id, submissionId: submission.id, purpose, decision: 'RETURN', reason: input.reason },
        });
        return;
      }

      if (!NEEDS_OPEN_PROPOSAL_STATUSES.includes(proposal.status as NeedsProposalStatus)) {
        throw new AppError(`${proposal.reference} is closed: return or leave the verification`, 409, 'NEEDS_STAGE_ACTION_NOT_ALLOWED');
      }
      // Review fix (wave 5, S-3): acceptance applies only to the version the form was built from, and a
      // validation verification only while the proposal still waits for validation. Returning stays allowed.
      const stale =
        row.versionId !== proposal.currentVersionId || (purpose === 'VALIDATION' && (proposal.stage !== 'VALIDATION' || proposal.status !== 'IN_PROGRESS'));
      if (stale) {
        throw new AppError('The proposed project has moved on since this verification was assigned: return or cancel it', 409, 'NEEDS_VERIFICATION_STALE');
      }
      if (overrideFlag) await recordOverrideUseInTx(tx, user, row.cycle, proposal, overrideFlag, 'Accepted a field verification');

      const siteLocations = (Array.isArray(submission.siteLocationsJson) ? submission.siteLocationsJson : []) as unknown as NeedsVerificationSiteLocation[];
      const answers = (Array.isArray(submission.answersJson) ? submission.answersJson : []) as unknown as VisitFormAnswer[];
      const corrections = input.correctCoordinates ? await correctSitesInTx(tx, row, siteLocations, answers) : [];
      const evidenceDocumentIds = await filePhotosInTx(tx, row, submission.id, { userId: submission.submittedByUserId, name: submission.submittedByName });
      await tx.needsVerificationSubmission.update({
        where: { id: submission.id },
        data: {
          status: 'ACCEPTED',
          reviewedByUserId: user.userId,
          reviewedByName: user.fullName,
          reviewedAt: now,
          reviewReason: input.reason,
          siteCorrectionsJson: input.correctCoordinates ? (corrections as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          evidenceDocumentIds,
        },
      });
      await tx.needsVerification.update({ where: { id: row.id }, data: { status: 'ACCEPTED' } });
      if (corrections.length) {
        const words = corrections.map((c) => `site ${c.siteNumber} (${c.schoolName}) ${c.distanceMeters !== null ? `moved ${c.distanceMeters} m` : 'located'}`);
        await recordAuditEvent(tx, {
          tenantId: user.tenantId,
          projectId: null,
          ...webActor(user),
          action: 'NEEDS_SITE_COORDINATES_CORRECTED',
          summaryText: `Corrected the site coordinates of ${proposal.reference} from the field verification: ${words.join('; ')}.`,
          payload: { cycleId: row.cycleId, proposalId: proposal.id, reference: proposal.reference, verificationId: row.id, submissionId: submission.id, corrections },
        });
        await rerunFlagsInTx(tx, row.cycle, proposal);
      }
      await recordAuditEvent(tx, {
        tenantId: user.tenantId,
        projectId: null,
        ...webActor(user),
        action: 'NEEDS_VERIFICATION_REVIEWED',
        summaryText: `Accepted the ${label} of ${proposal.reference} by ${row.officerName}: ${evidenceDocumentIds.length} photo${evidenceDocumentIds.length === 1 ? '' : 's'} filed${corrections.length ? `, ${corrections.length} site location${corrections.length === 1 ? '' : 's'} corrected` : ''}.`,
        payload: {
          cycleId: row.cycleId,
          proposalId: proposal.id,
          reference: proposal.reference,
          verificationId: row.id,
          submissionId: submission.id,
          purpose,
          decision: 'ACCEPT',
          reason: input.reason,
          evidenceDocumentIds,
          correctedSiteNumbers: corrections.map((c) => c.siteNumber),
        },
      });
    },
    { timeout: 30_000 }
  );
  return dtoById(user, base.id);
}
