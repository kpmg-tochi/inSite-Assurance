import {
  calendarDateInTimeZone,
  type SubmissionGeotagInput,
  type WorkdayReportDto,
  type WorkdayTextNote,
} from '@insite/shared';
import { listOwnWorkdayReports } from '../api/workday/workdayApi';
import { getCachedBaselinePack } from '../config/apiConfig';
import { signWithDeviceKey } from '../security/deviceKey';
import type { LocationFix } from '../services/locationService';
import { getDb, newId, nowIso } from './db/database';
import { enqueue, findOpenRowId } from './outbox/outboxStore';
import { kickOutbox } from './outbox/outboxProcessor';
import { reportCanonical, type LocalReport } from './reportPayload';

/**
 * Workday reports (Phase 4, owner rule 2026-11-19).
 *
 * During the period the reporter adds photos, voice notes and notes to the WBS thread. At the end
 * they submit one full report and confirm it is final. The report links every capture and note
 * for that WBS item not yet in a report. A second report for the same item and period is refused
 * here and by the server; a revision is only possible to answer an open query.
 *
 * The report is saved with its outbox row before anything is sent, so a confirmed report survives
 * the app being killed at any point.
 */

export type ReportSyncStatus = 'QUEUED' | 'SENT' | 'FAILED';

export interface StoredReport extends LocalReport {
  serverReportId: string | null;
  serverStatus: WorkdayReportDto['status'] | null;
  syncStatus: ReportSyncStatus;
  lastError: string | null;
  createdAt: string;
}

type Row = {
  id: string;
  project_id: string;
  wbs_item_id: string;
  workday_date: string;
  reporter_timezone: string;
  summary_text: string;
  reported_quantity: number;
  unit: string;
  is_hold_point_claimed: number;
  delays_or_blockers: string | null;
  capture_ids_json: string;
  text_notes_json: string;
  geotag_json: string | null;
  confirmed_at: string;
  signature: string | null;
  revises_server_report_id: string | null;
  report_query_id: string | null;
  server_report_id: string | null;
  server_status: string | null;
  sync_status: string;
  last_error: string | null;
  created_at: string;
};

function map(r: Row): StoredReport {
  return {
    id: r.id,
    projectId: r.project_id,
    wbsItemId: r.wbs_item_id,
    workdayDate: r.workday_date,
    reporterTimezone: r.reporter_timezone,
    summaryText: r.summary_text,
    reportedQuantity: r.reported_quantity,
    unit: r.unit,
    isHoldPointClaimed: Boolean(r.is_hold_point_claimed),
    delaysOrBlockers: r.delays_or_blockers,
    captureIds: JSON.parse(r.capture_ids_json),
    textNotes: JSON.parse(r.text_notes_json),
    geotag: r.geotag_json ? JSON.parse(r.geotag_json) : null,
    confirmedAt: r.confirmed_at,
    signature: r.signature,
    revisesServerReportId: r.revises_server_report_id,
    reportQueryId: r.report_query_id,
    serverReportId: r.server_report_id,
    serverStatus: r.server_status as StoredReport['serverStatus'],
    syncStatus: r.sync_status as ReportSyncStatus,
    lastError: r.last_error,
    createdAt: r.created_at,
  };
}

/** The phone's own time zone (recorded on the report for reference). */
export function reporterTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * The zone that defines a reporting day: the project's (from the saved baseline pack), so every
 * reporter on the project shares the same "today". The server checks the same rule.
 */
export function projectTimeZone(): string {
  return getCachedBaselinePack()?.timezone || reporterTimeZone();
}

export function currentPeriod(at: Date = new Date()): string {
  return calendarDateInTimeZone(at, projectTimeZone());
}

export class ReportAlreadySubmittedError extends Error {
  constructor() {
    super('You have already submitted your report for this WBS item today. It can only be revised to answer a query.');
    this.name = 'ReportAlreadySubmittedError';
  }
}

/** The original (non-revision) report for a WBS item and period, if one exists on this device. */
export async function getReportForPeriod(
  projectId: string,
  wbsItemId: string,
  workdayDate: string
): Promise<StoredReport | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Row>(
    `SELECT * FROM workday_reports WHERE project_id = ? AND wbs_item_id = ? AND workday_date = ?
       AND revises_server_report_id IS NULL
     ORDER BY created_at ASC LIMIT 1`,
    [projectId, wbsItemId, workdayDate]
  );
  return row ? map(row) : null;
}

/** WBS item IDs that already have a report this period (local or on the server). */
export async function reportedWbsItemIds(projectId: string, workdayDate: string): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ wbs_item_id: string }>(
    `SELECT DISTINCT wbs_item_id FROM workday_reports WHERE project_id = ? AND workday_date = ?`,
    [projectId, workdayDate]
  );
  const ids = new Set(rows.map((r) => r.wbs_item_id));
  try {
    for (const r of await listOwnWorkdayReports(projectId, workdayDate)) ids.add(r.wbsItemId);
  } catch {
    // Offline: local reports only.
  }
  return ids;
}

export interface ConfirmReportInput {
  projectId: string;
  wbsItemId: string;
  summaryText: string;
  reportedQuantity: number;
  unit: string;
  isHoldPointClaimed: boolean;
  delaysOrBlockers: string | null;
  /** The fix when the reporter confirmed. Required: a report without a location is not accepted. */
  fix: LocationFix;
  /** Set when answering a query: the server ID of the report being revised. */
  revision?: { serverReportId: string; reportQueryId?: string | null };
}

async function revisionPeriod(projectId: string, serverReportId: string): Promise<string | null> {
  const db = await getDb();
  const local = await db.getFirstAsync<{ workday_date: string }>(
    'SELECT workday_date FROM workday_reports WHERE server_report_id = ?',
    [serverReportId]
  );
  if (local) return local.workday_date;
  try {
    const all = await listOwnWorkdayReports(projectId);
    return all.find((r) => r.id === serverReportId)?.workdayDate ?? null;
  } catch {
    return null;
  }
}

/**
 * Saves the confirmed report with every unreported capture and note for the WBS item, signs it,
 * and queues it behind those captures. Returns once it is safely stored; sending happens after.
 */
export async function confirmReport(input: ConfirmReportInput): Promise<StoredReport> {
  const db = await getDb();
  const confirmedAt = nowIso();
  const timezone = reporterTimeZone();

  if (!input.fix) {
    throw new Error('A GPS location is required to submit a report.');
  }
  let workdayDate = calendarDateInTimeZone(confirmedAt, projectTimeZone());
  let signable = true;
  if (input.revision) {
    const original = await revisionPeriod(input.projectId, input.revision.serverReportId);
    if (original) workdayDate = original;
    else signable = false; // The server keeps the original period; an unsigned revision is flagged, not failed.
  } else if (await getReportForPeriod(input.projectId, input.wbsItemId, workdayDate)) {
    throw new ReportAlreadySubmittedError();
  }

  const captures = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM captures WHERE project_id = ? AND wbs_item_id = ? AND report_id IS NULL ORDER BY captured_at ASC`,
    [input.projectId, input.wbsItemId]
  );
  const notes = await db.getAllAsync<{ id: string; text_content: string; created_at: string }>(
    `SELECT id, text_content, created_at FROM chat_messages
     WHERE project_id = ? AND wbs_item_id = ? AND message_type = 'TEXT_COMMENT' AND client_message_id IS NOT NULL
       AND report_id IS NULL AND text_content IS NOT NULL
     ORDER BY created_at ASC`,
    [input.projectId, input.wbsItemId]
  );

  const geotag: SubmissionGeotagInput = {
    latitude: input.fix.latitude,
    longitude: input.fix.longitude,
    accuracyMeters: input.fix.accuracyMeters,
    altitudeMeters: input.fix.altitudeMeters,
    isMocked: input.fix.isMocked,
    capturedAt: input.fix.capturedAt,
  };
  const textNotes: WorkdayTextNote[] = notes.map((n) => ({
    id: n.id,
    text: n.text_content.slice(0, 2000),
    capturedAt: n.created_at,
  }));

  const report: LocalReport = {
    id: newId(),
    projectId: input.projectId,
    wbsItemId: input.wbsItemId,
    workdayDate,
    reporterTimezone: timezone,
    summaryText: input.summaryText,
    reportedQuantity: input.reportedQuantity,
    unit: input.unit,
    isHoldPointClaimed: input.isHoldPointClaimed,
    delaysOrBlockers: input.delaysOrBlockers,
    captureIds: captures.map((c) => c.id),
    textNotes,
    geotag,
    confirmedAt,
    signature: null,
    revisesServerReportId: input.revision?.serverReportId ?? null,
    reportQueryId: input.revision?.reportQueryId ?? null,
  };
  if (signable) report.signature = await signWithDeviceKey(reportCanonical(report));

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO workday_reports (id, project_id, wbs_item_id, workday_date, reporter_timezone,
         summary_text, reported_quantity, unit, is_hold_point_claimed, delays_or_blockers,
         capture_ids_json, text_notes_json, geotag_json, confirmed_at, signature,
         revises_server_report_id, report_query_id, sync_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?)`,
      [
        report.id,
        report.projectId,
        report.wbsItemId,
        report.workdayDate,
        report.reporterTimezone,
        report.summaryText,
        report.reportedQuantity,
        report.unit,
        report.isHoldPointClaimed ? 1 : 0,
        report.delaysOrBlockers,
        JSON.stringify(report.captureIds),
        JSON.stringify(report.textNotes),
        JSON.stringify(report.geotag),
        report.confirmedAt,
        report.signature,
        report.revisesServerReportId,
        report.reportQueryId,
        confirmedAt,
      ]
    );
    for (const id of report.captureIds) {
      await db.runAsync('UPDATE captures SET report_id = ? WHERE id = ?', [report.id, id]);
    }
    for (const n of notes) {
      await db.runAsync('UPDATE chat_messages SET report_id = ? WHERE id = ?', [report.id, n.id]);
    }
    // The report waits for every capture it links that is still being sent.
    const dependsOn: string[] = [];
    for (const id of report.captureIds) {
      const open = await findOpenRowId(db, 'CAPTURE', id);
      if (open) dependsOn.push(open);
    }
    await enqueue(db, {
      projectId: report.projectId,
      kind: report.revisesServerReportId ? 'REVALIDATION' : 'REPORT',
      entityId: report.id,
      dependsOn,
    });
  });
  kickOutbox();

  const saved = await getReport(report.id);
  if (!saved) throw new Error('Report was not saved');
  return saved;
}

export async function getReport(id: string): Promise<StoredReport | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Row>('SELECT * FROM workday_reports WHERE id = ?', [id]);
  return row ? map(row) : null;
}

export async function markReportSent(id: string, server: WorkdayReportDto): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE workday_reports SET server_report_id = ?, server_status = ?, sync_status = 'SENT', last_error = NULL WHERE id = ?`,
    [server.id, server.status, id]
  );
}

/** Reports still on the device or held by the server until identity approval (read-only list). */
export async function listPendingOrStagedReports(projectId: string): Promise<StoredReport[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM workday_reports WHERE project_id = ?
       AND (sync_status != 'SENT' OR server_status = 'STAGED_UNVERIFIED')
     ORDER BY created_at DESC`,
    [projectId]
  );
  return rows.map(map);
}

/** Refreshes the server status of sent reports (e.g. STAGED_UNVERIFIED released after approval). */
export async function refreshReportStatuses(projectId: string): Promise<void> {
  const server = await listOwnWorkdayReports(projectId);
  const db = await getDb();
  for (const r of server) {
    await db.runAsync(
      'UPDATE workday_reports SET server_status = ? WHERE server_report_id = ? OR id = ?',
      [r.status, r.id, r.clientReportId]
    );
  }
}
