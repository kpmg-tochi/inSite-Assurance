import type { BriefPersona, FieldPersonaType } from '@insite/shared';

/**
 * Persona-aware wording for the field app (Phase 7 Step 8).
 *
 * An independent verifier inspects and records; a contractor executes and logs. The persona comes
 * from the session (`FieldProjectContext.fieldPersonaType`). As on the server
 * (`resolveBriefPersona`), anything other than CONTRACTOR_EXECUTOR reads as a verifier.
 */

export function copyPersona(fieldPersonaType: FieldPersonaType | BriefPersona | null | undefined): BriefPersona {
  return fieldPersonaType === 'CONTRACTOR_EXECUTOR' ? 'CONTRACTOR_EXECUTOR' : 'INDEPENDENT_VERIFIER';
}

export interface PersonaCopy {
  /** Inbox header subtitle. */
  inboxSubtitle: string;
  /** Title of the morning brief card in a WBS thread. */
  briefCardTitle: string;
  /** Heading above the brief's checklist lines. */
  pointersHeading: string;
  /** Heading above the standards listed on a brief. */
  standardsHeading: string;
  /** End-of-day button in a WBS thread. */
  endOfDayButton: string;
  /** Title of the end-of-day report sheet. */
  reportSheetTitle: string;
  /** Inbox banner while the reporter's identity check is pending. */
  verificationPendingPill: string;
  verificationPendingText: string;
  /** Sync status screen. */
  backlogEmptyDescription: string;
  heldReportsDescription: string;
}

const CONTRACTOR: PersonaCopy = {
  inboxSubtitle: 'Daily Field WBS Breakdown',
  briefCardTitle: "Today's deliverable",
  pointersHeading: 'Report pointers:',
  standardsHeading: 'Standards to follow:',
  endOfDayButton: 'Submit full report for today',
  reportSheetTitle: 'Submit your daily report',
  verificationPendingPill: 'Verification Pending',
  verificationPendingText:
    'Your reports are sent and held by the server until your identity is approved, then submitted automatically. Tap for sync status.',
  backlogEmptyDescription: 'Every daily report from this device has been accepted by the server.',
  heldReportsDescription:
    'The server keeps these until your identity check is approved, then submits them automatically. You do not need to send them again.',
};

const VERIFIER: PersonaCopy = {
  inboxSubtitle: 'Daily Inspection & Verification',
  briefCardTitle: "Today's inspection brief",
  pointersHeading: 'What to verify and record:',
  standardsHeading: 'Standards to check:',
  endOfDayButton: 'Record inspection summary & submit',
  reportSheetTitle: 'Submit your inspection report',
  // "Verification" alone would read as the inspection work itself; this is the identity check.
  verificationPendingPill: 'Identity Check Pending',
  verificationPendingText:
    'Your inspection reports are sent and held by the server until your identity is approved, then submitted automatically. Tap for sync status.',
  backlogEmptyDescription: 'Every inspection report from this device has been accepted by the server.',
  heldReportsDescription:
    'The server keeps your inspection reports until your identity check is approved, then submits them automatically. You do not need to send them again.',
};

export function personaCopy(persona: FieldPersonaType | BriefPersona | null | undefined): PersonaCopy {
  return copyPersona(persona) === 'CONTRACTOR_EXECUTOR' ? CONTRACTOR : VERIFIER;
}
