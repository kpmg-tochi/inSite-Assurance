import { Prisma } from '@prisma/client';
import {
  OPEN_DEFECT_STATUSES,
  PAYMENT_EXCEPTION_LABELS,
  PAYMENT_KIND_LABELS,
  PaymentDto,
  PaymentException,
  PaymentExceptionEnum,
  ProjectPaymentsQuery,
  ProjectPaymentsSummaryDto,
  RecordPaymentRequest,
  RETENTION_NGN_EPSILON,
  roundNgn2,
  VoidPaymentRequest,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { hasWebPermission, WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { createWebNotification } from '../notifications/notifications.service';
import { getProcessConfig } from '../process/processConfig.service';
import { cocGateReason } from '../completion/completion.service';
import { fmtNgn, projectToday } from '../closeout/closeoutGate';
import { loadSprintInProject } from '../../utils/ownership';
import { activePaymentHold } from '../contractorFlags/contractorFlags.service';

/**
 * Payment record (redesign R1b). Payments are made outside the platform; finance records them here
 * (an ERP feed can later write the same rows with source ERP). The platform never blocks a payment
 * it does not make: rule breaches are stored on the payment as exceptions and notified.
 *
 * Money on the project row, kept in step inside the same transaction:
 * - disbursedToDateNgn: net paid to the contractor (retention releases included);
 * - retentionHeldNgn: retention still held; retentionReleasedNgn: retention released so far.
 */

type Tx = Prisma.TransactionClient;
const PAYMENT_INCLUDE = { sprint: { select: { id: true, number: true, name: true } } } satisfies Prisma.ProjectPaymentInclude;
type PaymentRow = Prisma.ProjectPaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

const RECORD = 'payments:record';

function serializePayment(p: PaymentRow): PaymentDto {
  const exceptions = (Array.isArray(p.exceptionsJson) ? p.exceptionsJson : [])
    .map((e) => PaymentExceptionEnum.safeParse(e))
    .filter((r) => r.success)
    .map((r) => r.data as PaymentException);
  return {
    id: p.id,
    projectId: p.projectId,
    kind: p.kind,
    paidOn: p.paidOn,
    grossAmountNgn: Number(p.grossAmountNgn),
    retentionHeldNgn: Number(p.retentionHeldNgn),
    netAmountNgn: Number(p.netAmountNgn),
    retentionOverrideReason: p.retentionOverrideReason,
    reference: p.reference,
    description: p.description,
    source: p.source,
    externalReference: p.externalReference,
    exceptions,
    recordedByName: p.recordedByName,
    recordedAt: p.createdAt.toISOString(),
    voided: p.voidedAt !== null,
    voidedAt: p.voidedAt?.toISOString() ?? null,
    voidedByName: p.voidedByName,
    voidReason: p.voidReason,
    sprint: p.sprint ? { id: p.sprint.id, number: p.sprint.number, name: p.sprint.name } : null,
  };
}

async function lockProject(tx: Tx, projectId: string) {
  await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId}::uuid FOR UPDATE`;
  return tx.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      id: true,
      status: true,
      contractSumNgn: true,
      retentionPercentage: true,
      retentionEndDate: true,
      retentionHeldNgn: true,
      projectTypeSnapshotJson: true,
    },
  });
}

/**
 * The payment record's filters (search, type, work phase, exceptions only, period), server-side so the
 * page, its totals and its export agree (client demo updates G.1). Exceptions only = live payments
 * with at least one exception; the period is inclusive on `paidOn`.
 */
export function filterPayments(payments: PaymentDto[], q: ProjectPaymentsQuery): PaymentDto[] {
  const t = (q.search ?? '').trim().toLowerCase();
  return payments.filter(
    (p) =>
      (!t || p.reference.toLowerCase().includes(t) || (p.description ?? '').toLowerCase().includes(t)) &&
      (!q.kind || p.kind === q.kind) &&
      (!q.sprint || (q.sprint === 'none' ? p.sprint === null : p.sprint?.id === q.sprint)) &&
      (q.exceptionsOnly !== 'true' || (!p.voided && p.exceptions.length > 0)) &&
      (!q.from || p.paidOn >= q.from) &&
      (!q.to || p.paidOn <= q.to)
  );
}

/** A period whose start is after its end matches nothing; refuse it instead (400). */
export function assertPeriod(q: { from?: string; to?: string }): void {
  if (q.from && q.to && q.from > q.to) {
    throw new AppError('The period starts after it ends', 400, 'INVALID_PERIOD');
  }
}

/**
 * GET /projects/:projectId/payments. `payments` holds the payments matching the query (every payment
 * when there is none); the totals are always the project's to date.
 */
export async function getProjectPayments(projectId: string, viewer: WebJwtPayload, q: ProjectPaymentsQuery = {}): Promise<ProjectPaymentsSummaryDto> {
  assertPeriod(q);
  const [project, payments, openDefects, cocIssued, sprints, paymentHold] = await Promise.all([
    prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: {
        contractSumNgn: true,
        retentionPercentage: true,
        retentionEndDate: true,
        retentionHeldNgn: true,
        retentionReleasedNgn: true,
        disbursedToDateNgn: true,
        timezone: true,
        status: true,
        tenant: { select: { fiscalYearStartMonth: true } },
      },
    }),
    prisma.projectPayment.findMany({ where: { projectId }, include: PAYMENT_INCLUDE, orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }] }),
    prisma.retentionDefectTicket.count({ where: { projectId, status: { in: OPEN_DEFECT_STATUSES } } }),
    prisma.completionCertificate.count({ where: { projectId, status: 'ISSUED' } }),
    prisma.projectSprint.findMany({ where: { projectId }, orderBy: { number: 'asc' }, select: { id: true, number: true, name: true } }),
    activePaymentHold(prisma, projectId), // F.4
  ]);
  const today = projectToday(project.timezone);
  const live = payments.filter((p) => p.voidedAt === null);
  const rows = payments.map(serializePayment);
  return {
    projectId,
    contractSumNgn: project.contractSumNgn === null ? null : Number(project.contractSumNgn),
    paidGrossNgn: roundNgn2(live.filter((p) => p.kind !== 'RETENTION_RELEASE').reduce((s, p) => s + Number(p.grossAmountNgn), 0)),
    paidNetNgn: Number(project.disbursedToDateNgn),
    retentionPercentage: project.retentionPercentage === null ? null : Number(project.retentionPercentage),
    retentionHeldNgn: Number(project.retentionHeldNgn) + Number(project.retentionReleasedNgn),
    retentionReleasedNgn: Number(project.retentionReleasedNgn),
    retentionBalanceNgn: Number(project.retentionHeldNgn),
    retentionPeriodEnd: project.retentionEndDate,
    retentionPeriodEnded: project.retentionEndDate !== null && today >= project.retentionEndDate,
    cocIssued: cocIssued > 0,
    openDefects,
    today,
    sprints,
    exceptionCount: rows.filter((r) => !r.voided).reduce((s, r) => s + r.exceptions.length, 0),
    // An archived project is read-only (the guard refuses the write), so nobody may record there.
    canRecord: hasWebPermission(viewer, RECORD) && project.status !== 'ARCHIVED',
    payments: filterPayments(rows, q),
    fiscalYearStartMonth: project.tenant.fiscalYearStartMonth,
    paymentHold,
  };
}

/** POST /projects/:projectId/payments */
export async function recordPayment(projectId: string, webUser: WebJwtPayload, input: RecordPaymentRequest): Promise<PaymentDto> {
  const config = await getProcessConfig(projectId);
  const row = await prisma.$transaction(async (tx) => {
    const project = await lockProject(tx, projectId);
    if (project.status !== 'ACTIVE') {
      throw new AppError('Payments can be recorded on active projects only', 409, 'PROJECT_NOT_ACTIVE');
    }
    const sprint = input.sprintId ? await loadSprintInProject(tx, projectId, input.sprintId) : null;
    const gross = roundNgn2(input.grossAmountNgn);
    const heldBalance = Number(project.retentionHeldNgn);
    let held = 0;
    let overrideReason: string | null = null;

    if (input.kind === 'RETENTION_RELEASE') {
      if (!config.enableRetentionModule) {
        throw new AppError('Retention is not used on this project', 409, 'RETENTION_MODULE_OFF');
      }
      if (gross > heldBalance + RETENTION_NGN_EPSILON) {
        throw new AppError(`Only ${fmtNgn(heldBalance)} of retention is held; the release cannot be more.`, 422, 'RELEASE_ABOVE_BALANCE');
      }
    } else {
      const pct = config.enableRetentionModule && project.retentionPercentage !== null ? Number(project.retentionPercentage) : 0;
      const expected = roundNgn2((gross * pct) / 100);
      if (input.retentionHeldNgn == null) {
        held = expected;
      } else {
        held = roundNgn2(input.retentionHeldNgn);
        if (!config.enableRetentionModule && held > 0) {
          throw new AppError('Retention is not used on this project', 409, 'RETENTION_MODULE_OFF');
        }
        if (Math.abs(held - expected) > RETENTION_NGN_EPSILON) {
          overrideReason = input.retentionOverrideReason?.trim() || null;
          if (!overrideReason) {
            throw new AppError(
              `The retention held differs from ${fmtNgn(expected)} (${pct}% of the payment). Say why.`,
              422,
              'RETENTION_OVERRIDE_REASON_REQUIRED'
            );
          }
        }
      }
    }
    const net = roundNgn2(gross - held);

    // F.4 (wave 3): a payment hold on the contractor needs an override reason and flags the payment.
    // A retention release is not held (it is the retention already earned).
    const hold = input.kind === 'RETENTION_RELEASE' ? null : await activePaymentHold(tx, projectId);
    const holdOverrideReason = hold ? input.holdOverrideReason?.trim() || null : null;
    if (hold && !holdOverrideReason) {
      throw new AppError('A payment hold is in effect on the contractor. Say why this payment is made during the hold.', 422, 'PAYMENT_HOLD_OVERRIDE_REQUIRED', {
        flagId: hold.flagId,
        actionId: hold.actionId,
      });
    }

    // Exceptions: recorded, never blocking.
    const exceptions: PaymentException[] = [];
    const cocMissing = await cocGateReason(tx, projectId, 'FINAL_PAYMENT', project.projectTypeSnapshotJson);
    if (input.kind === 'FINAL' && cocMissing) exceptions.push('FINAL_BEFORE_COC');
    if (input.kind === 'RETENTION_RELEASE') {
      if (cocMissing) exceptions.push('RETENTION_RELEASE_BEFORE_COC');
      if (!project.retentionEndDate || input.paidOn < project.retentionEndDate) exceptions.push('RETENTION_RELEASE_BEFORE_PERIOD_END');
      const openDefects = await tx.retentionDefectTicket.count({ where: { projectId, status: { in: OPEN_DEFECT_STATUSES } } });
      if (openDefects > 0) exceptions.push('RETENTION_RELEASE_WITH_OPEN_DEFECTS');
    } else if (project.contractSumNgn !== null) {
      const paidBefore = await tx.projectPayment.aggregate({
        where: { projectId, voidedAt: null, kind: { not: 'RETENTION_RELEASE' } },
        _sum: { grossAmountNgn: true },
      });
      if (Number(paidBefore._sum.grossAmountNgn ?? 0) + gross > Number(project.contractSumNgn) + RETENTION_NGN_EPSILON) {
        exceptions.push('PAID_ABOVE_CONTRACT_SUM');
      }
    }
    if (hold) exceptions.push('PAID_DURING_HOLD');
    const description = holdOverrideReason
      ? [input.description?.trim(), `Paid during payment hold: ${holdOverrideReason}`].filter(Boolean).join(' · ')
      : input.description ?? null;

    const created = await tx.projectPayment.create({
      data: {
        projectId,
        kind: input.kind,
        paidOn: input.paidOn,
        grossAmountNgn: gross,
        retentionHeldNgn: held,
        netAmountNgn: net,
        retentionOverrideReason: overrideReason,
        reference: input.reference,
        description,
        source: 'MANUAL',
        exceptionsJson: exceptions as unknown as Prisma.InputJsonValue,
        recordedByUserId: webUser.userId,
        recordedByName: webUser.fullName,
        sprintId: sprint?.id ?? null,
      },
      include: PAYMENT_INCLUDE,
    });
    await tx.project.update({
      where: { id: projectId },
      data:
        input.kind === 'RETENTION_RELEASE'
          ? { disbursedToDateNgn: { increment: net }, retentionHeldNgn: { decrement: gross }, retentionReleasedNgn: { increment: gross } }
          : { disbursedToDateNgn: { increment: net }, retentionHeldNgn: { increment: held } },
    });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
      action: 'PAYMENT_RECORDED',
      summaryText:
        `Recorded ${PAYMENT_KIND_LABELS[input.kind].toLowerCase()} ${input.reference} of ${fmtNgn(gross)} paid on ${input.paidOn}` +
        (sprint ? ` for sprint ${sprint.number} (${sprint.name})` : '') +
        (held > 0 ? ` (${fmtNgn(held)} retention held, ${fmtNgn(net)} net).` : '.') +
        (exceptions.length ? ` Exceptions: ${exceptions.join(', ')}.` : ''),
      payload: {
        paymentId: created.id,
        kind: input.kind,
        grossAmountNgn: gross,
        retentionHeldNgn: held,
        netAmountNgn: net,
        exceptions,
        sprintId: sprint?.id ?? null,
        sprintNumber: sprint?.number ?? null,
        ...(hold ? { paymentHold: { flagId: hold.flagId, actionId: hold.actionId, overrideReason: holdOverrideReason } } : {}),
      },
    });
    if (exceptions.length > 0) {
      await createWebNotification(tx, {
        projectId,
        targetPermissionKey: 'payments:view',
        category: 'PAYMENT_EXCEPTION',
        title: `Payment exception · ${input.reference}`,
        description: exceptions.map((e) => PAYMENT_EXCEPTION_LABELS[e]).join('. ') + '.',
        actionUrl: `/app/projects/${projectId}/payments`,
        metadata: { paymentId: created.id, exceptions },
        hideFromProjectContractors: true,
      });
    }
    return created;
  });
  return serializePayment(row);
}

/** POST /projects/:projectId/payments/:paymentId/void: reverses the payment's effect on the totals. */
export async function voidPayment(
  projectId: string,
  paymentId: string,
  webUser: WebJwtPayload,
  input: VoidPaymentRequest
): Promise<PaymentDto> {
  const row = await prisma.$transaction(async (tx) => {
    const project = await lockProject(tx, projectId);
    const payment = await tx.projectPayment.findFirst({ where: { id: paymentId, projectId } });
    if (!payment) throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
    if (payment.voidedAt) throw new AppError('This payment is already void', 409, 'PAYMENT_ALREADY_VOID');
    const gross = Number(payment.grossAmountNgn);
    const held = Number(payment.retentionHeldNgn);
    const net = Number(payment.netAmountNgn);
    if (payment.kind !== 'RETENTION_RELEASE' && Number(project.retentionHeldNgn) - held < -RETENTION_NGN_EPSILON) {
      throw new AppError(
        'Part of the retention held on this payment has been released. Void the retention release first.',
        409,
        'VOID_WOULD_UNDERFLOW_RETENTION'
      );
    }
    const updated = await tx.projectPayment.update({
      where: { id: payment.id },
      data: { voidedAt: new Date(), voidedByName: webUser.fullName, voidReason: input.reason },
      include: PAYMENT_INCLUDE,
    });
    await tx.project.update({
      where: { id: projectId },
      data:
        payment.kind === 'RETENTION_RELEASE'
          ? { disbursedToDateNgn: { decrement: net }, retentionHeldNgn: { increment: gross }, retentionReleasedNgn: { decrement: gross } }
          : { disbursedToDateNgn: { decrement: net }, retentionHeldNgn: { decrement: held } },
    });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
      action: 'PAYMENT_VOIDED',
      summaryText: `Voided payment ${payment.reference} (${fmtNgn(gross)}). Reason: ${input.reason}`,
      payload: { paymentId: payment.id, kind: payment.kind, grossAmountNgn: gross, reason: input.reason },
    });
    return updated;
  });
  return serializePayment(row);
}
