import type { RespondToVisitRequestInput, VisitCheckInRequestInput, CreateUnscheduledVisitRequestInput } from '@insite/shared';
import { postUnscheduledVisit, postVisitCheckIn, postVisitResponse, postVisitSubmission } from '../../api/visits/visitsApi';
import { postSiteLogEntry } from '../../api/siteLog/siteLogApi';
import { buildSiteLogRequest } from '../../utils/siteLog';
import { finaliseSubmissionBody } from '../../utils/visitForm';
import {
  completeVisitResponse,
  failVisitResponse,
  getQueuedSubmission,
  getVisit,
  markCheckInSent,
  markDraftRefused,
  markDraftSent,
  markUnscheduledVisitCreated,
  markUnscheduledVisitRefused,
  noteDraftError,
} from '../visitStore';
import { getSiteLogEntry, markSiteLogSent, siteLogServerIds } from '../siteLogStore';
import { classifyFailure, failureMessage, SUBMISSION_REFUSED_CODES, type ClassifiableError } from './outboxPolicy';
import { LocalPermanentError, registerOutboxHandler } from './outboxProcessor';

/**
 * Redesign R5a (D-R5.9): the visit app's outbox handlers. Every request carries a client UUID, and
 * R4 replays it (200 with the original result), so a retry after a lost response counts as done.
 * Permanent refusals also update the local record (response overlay, refused draft, refused
 * unscheduled visit) so the screens can say what happened; the row itself is dead-lettered as usual.
 */

/** A request that cannot be built yet (something it needs is still on its way): retried later. */
export class NotReadyError extends Error {
  readonly kind = 'network' as const;
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'NotReadyError';
  }
}

const codeOf = (e: unknown) => (e as ClassifiableError)?.code;
const isPermanent = (e: unknown) => classifyFailure(e as ClassifiableError) === 'PERMANENT';

let registered = false;

export function registerVisitHandlers(): void {
  if (registered) return;
  registered = true;

  registerOutboxHandler('VISIT_RESPONSE', async (row) => {
    const { visitId, body } = row.payload as { visitId: string; body: RespondToVisitRequestInput };
    const v = await getVisit(visitId);
    if (!v) throw new LocalPermanentError('This monitoring visit is no longer on the phone.');
    if (!v.serverId) throw new LocalPermanentError('An Ad hoc monitoring visit takes no responses.');
    try {
      const dto = await postVisitResponse(row.projectId, v.serverId, body);
      await completeVisitResponse(v.id, body.clientActionId, dto);
    } catch (error) {
      if (isPermanent(error)) await failVisitResponse(v.id, body.clientActionId, failureMessage(error as ClassifiableError, 'VISIT_RESPONSE')).catch(() => undefined);
      throw error;
    }
  });

  // Waits for its unscheduled visit (dependsOn). The server answers a replay, or a visit already
  // checked in, with the visit: done.
  registerOutboxHandler('VISIT_CHECK_IN', async (row) => {
    const { visitId, body } = row.payload as { visitId: string; body: VisitCheckInRequestInput };
    const v = await getVisit(visitId);
    if (!v) throw new LocalPermanentError('This monitoring visit is no longer on the phone.');
    if (!v.serverId) throw new NotReadyError('VISIT_NOT_CREATED', 'The Ad hoc monitoring visit has not reached the server yet.');
    const dto = await postVisitCheckIn(row.projectId, v.serverId, body);
    await markCheckInSent(v.id, body.clientCheckInId, dto);
  });

  // Waits for its captures, check-in, unscheduled visit and site log entries (dependsOn). The
  // snapshot id of a phone-built Ad hoc form and the site log server ids are filled in here.
  registerOutboxHandler('VISIT_SUBMISSION', async (row) => {
    const q = await getQueuedSubmission(row.entityId);
    if (!q?.request) throw new LocalPermanentError('This monitoring report is no longer on the phone.');
    if (q.status === 'SENT') return;
    if (q.status === 'REFUSED') throw new LocalPermanentError(q.lastError ?? 'This monitoring report was refused by the server.');
    const v = await getVisit(q.request.visitId);
    if (!v) throw new LocalPermanentError('This monitoring visit is no longer on the phone.');
    if (!v.serverId) throw new NotReadyError('VISIT_NOT_CREATED', 'The Ad hoc monitoring visit has not reached the server yet.');
    const finalised = finaliseSubmissionBody(q.request, {
      visitFormSnapshotId: v.visit.formSnapshotId,
      siteLogServerIdByClientId: await siteLogServerIds(q.request.siteLogClientEntryIds),
    });
    if (!finalised.ok) throw new NotReadyError(finalised.code, finalised.message);
    try {
      const submission = await postVisitSubmission(row.projectId, v.serverId, finalised.body);
      await markDraftSent(row.entityId, submission);
    } catch (error) {
      const code = codeOf(error);
      const message = failureMessage(error as ClassifiableError, 'VISIT_SUBMISSION');
      if (code && SUBMISSION_REFUSED_CODES.includes(code)) await markDraftRefused(row.entityId, message).catch(() => undefined);
      else if (isPermanent(error)) await noteDraftError(row.entityId, message).catch(() => undefined);
      throw error;
    }
  });

  registerOutboxHandler('UNSCHEDULED_VISIT', async (row) => {
    const { visitId, body } = row.payload as { visitId: string; body: CreateUnscheduledVisitRequestInput };
    const v = await getVisit(visitId);
    if (!v) throw new LocalPermanentError('This monitoring visit is no longer on the phone.');
    if (v.serverId) return;
    try {
      const dto = await postUnscheduledVisit(row.projectId, body);
      await markUnscheduledVisitCreated(v.id, dto);
    } catch (error) {
      if (isPermanent(error)) await markUnscheduledVisitRefused(v.id, failureMessage(error as ClassifiableError, 'UNSCHEDULED_VISIT')).catch(() => undefined);
      throw error;
    }
  });

  // Waits for its capture (dependsOn). An entry whose photo moved into a form is not sent.
  registerOutboxHandler('SITE_LOG_ENTRY', async (row) => {
    const entry = await getSiteLogEntry(row.entityId);
    if (!entry) throw new LocalPermanentError('This site log entry is no longer on the phone.');
    if (entry.status === 'SENT' || entry.status === 'MOVED_TO_FORM') return;
    const dto = await postSiteLogEntry(row.projectId, buildSiteLogRequest(entry));
    await markSiteLogSent(entry.id, dto);
  });
}
