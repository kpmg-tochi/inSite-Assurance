/**
 * Phase 10: defect work on mobile (pure; tested in Node). Staff-only since redesign R1c/R1d.
 *
 * The Defects entry appears once a project is in handover or later and the session's role holds
 * defects:manage. An officer closes an open or assigned ticket with site photos, or
 * closes or reopens one awaiting verification. Whether the person may act on a given ticket is
 * decided by the server (each ticket carries its allowed actions); the app only shows those.
 */

export const DEFECT_PHASES = ['HANDOVER_IN_PROGRESS', 'RETENTION_PERIOD', 'COMPLETED_CLOSED'] as const;

export function showDefectsEntry(phase: string | null | undefined, permissions: string[] | null | undefined): boolean {
  return Boolean(phase && (DEFECT_PHASES as readonly string[]).includes(phase) && permissions?.includes('defects:manage'));
}

/**
 * Redesign R5b (D-R5.15): the project screen offers Defects when the project is past construction
 * or already has open defects, and the role holds defects:manage.
 */
export function showDefectsShortcut(
  phase: string | null | undefined,
  openDefectCount: number | null | undefined,
  permissions: string[] | null | undefined
): boolean {
  if (!permissions?.includes('defects:manage')) return false;
  return showDefectsEntry(phase, permissions) || (openDefectCount ?? 0) > 0;
}

/** Server codes that mean the action was already applied (a retry after a lost response). */
export const DEFECT_ALREADY_APPLIED_CODES = ['DEFECT_TICKET_NOT_OPEN', 'DEFECT_TICKET_NOT_RECTIFIED'];

/** A verify action (`POST .../defects/:id/verify`), queued as the payload of a DEFECT_ACTION row. */
export interface DefectActionPayload {
  ticketId: string;
  decision: 'CLOSE' | 'REOPEN';
  notes: string;
  captureIds: string[];
}

export const RECTIFY_REMOVED_MESSAGE =
  'Marking a defect as fixed from the phone is no longer available. An officer closes the defect with site photos.';

/** The request body for the server, validated the way the server validates it. */
export function defectActionBody(p: DefectActionPayload): Record<string, unknown> {
  // Rows queued before R1d may carry the removed contractor "mark fixed" action.
  if ((p as { kind?: string }).kind === 'rectify') throw new Error(RECTIFY_REMOVED_MESSAGE);
  const notes = p.notes.trim();
  if (p.decision === 'REOPEN') {
    if (notes.length < 5) throw new Error('Say what is still wrong.');
    return { decision: 'REOPEN', notes, captureIds: p.captureIds };
  }
  if (p.captureIds.length === 0) throw new Error('Take photos of the repair before closing the defect.');
  return { decision: 'CLOSE', notes, captureIds: p.captureIds };
}
