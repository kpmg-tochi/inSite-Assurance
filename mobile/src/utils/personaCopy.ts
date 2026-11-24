import type { FieldPersonaType, ReportingCadence } from '@insite/shared';

/**
 * Wording for the field app (Phase 7 Step 8, reduced in redesign R1d).
 *
 * Contractors no longer sign in (decision P2): every mobile user is an officer who inspects and
 * records, so every persona, including a legacy CONTRACTOR_EXECUTOR, reads with the verifier
 * wording. The persona argument stays so callers keep one call shape.
 */

export interface PersonaCopy {
  /** Inbox header subtitle. */
  inboxSubtitle: string;
  /** End-of-day button in a WBS thread. */
  endOfDayButton: string;
  /** Title of the end-of-day report sheet. */
  reportSheetTitle: string;
  /** Sync status screen. */
  backlogEmptyDescription: string;
  /** Phase 14: inbox entry to the checklist inspection flow. */
  inspectionEntry: string;
  /** Phase 14: inbox entry to inspection findings, and the screen subtitle. */
  findingsEntry: string;
  findingsSubtitle: string;
}

/** Phase 8: the span a report covers, by cadence. Daily (or unknown) keeps the original wording. */
function spanAdjective(cadence?: ReportingCadence | null): string {
  switch (cadence) {
    case 'WEEKLY': return 'Weekly';
    case 'BI_WEEKLY': return 'Fortnightly';
    case 'MONTHLY': return 'Monthly';
    case 'QUARTERLY': return 'Quarterly';
    case 'CUSTOM_INTERVAL': return 'Period';
    case 'INSPECTION_ONLY': return 'Inspection';
    default: return 'Daily';
  }
}

export function personaCopy(
  _persona: FieldPersonaType | null | undefined,
  cadence?: ReportingCadence | null
): PersonaCopy {
  const adj = spanAdjective(cadence);
  return {
    inboxSubtitle: cadence === 'INSPECTION_ONLY' ? 'Inspection & Verification' : `${adj} Inspection & Verification`,
    endOfDayButton: 'Record inspection summary & submit',
    reportSheetTitle: 'Submit your inspection report',
    backlogEmptyDescription: 'Every inspection report from this device has been accepted by the server.',
    inspectionEntry: 'Start a site inspection',
    findingsEntry: 'Inspection findings',
    findingsSubtitle: 'Findings raised from inspections on this project. Contractors fix them; you can record the fix too.',
  };
}
