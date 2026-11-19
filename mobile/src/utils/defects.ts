/**
 * Phase 10: defect work on mobile (pure; tested in Node).
 *
 * The Defects entry appears once a project is in handover or later and the session's role holds
 * retention:manage_defects. Whether the person may fix or verify a given ticket is decided by the
 * server (each ticket carries its allowed actions); the app only shows those actions.
 */

export const DEFECT_PHASES = ['HANDOVER_IN_PROGRESS', 'RETENTION_PERIOD', 'COMPLETED_CLOSED'] as const;

export function showDefectsEntry(phase: string | null | undefined, permissions: string[] | null | undefined): boolean {
  return Boolean(phase && (DEFECT_PHASES as readonly string[]).includes(phase) && permissions?.includes('retention:manage_defects'));
}

/** Server codes that mean the action was already applied (a retry after a lost response). */
export const DEFECT_ALREADY_APPLIED_CODES = ['DEFECT_TICKET_NOT_OPEN', 'DEFECT_TICKET_NOT_RECTIFIED'];

export type DefectActionKind = 'rectify' | 'verify';

export interface DefectActionPayload {
  ticketId: string;
  kind: DefectActionKind;
  notes: string;
  captureIds: string[];
  /** verify only */
  decision?: 'CLOSE' | 'REOPEN';
  /**
   * Set when the monitoring side captures the evidence (contractors do not report from site on
   * this project): closing then needs the verifier's photos, as the server requires.
   */
  photosRequired?: boolean;
}

/** The request body for the server, validated the way the server validates it. */
export function defectActionBody(p: DefectActionPayload): Record<string, unknown> {
  if (p.kind === 'rectify') {
    if (p.captureIds.length === 0 && p.notes.trim().length < 5) throw new Error('Add photos of the repair or describe what was done.');
    return { notes: p.notes.trim(), captureIds: p.captureIds };
  }
  if (p.decision === 'REOPEN' && p.notes.trim().length < 5) throw new Error('Say what is still wrong.');
  if (p.decision !== 'REOPEN' && p.photosRequired && p.captureIds.length === 0) {
    throw new Error('Take photos of the repair before closing the defect.');
  }
  return { decision: p.decision ?? 'CLOSE', notes: p.notes.trim(), captureIds: p.captureIds };
}
