import { resolveTerm, resolveTerminology, type FieldPersonaType, type ResolvedTerminology } from '@insite/shared';

/**
 * Wording for the field app (redesign R5b, D-R5.23). Every field role (M&E officer, resident
 * supervisor, independent monitor) uses the same visit app, so every persona gets the same text;
 * the persona argument stays so callers keep one call shape. Tenant words for the contractor, the
 * funder and the beneficiary come from `useActiveBranding().terminology`.
 */

export interface PersonaCopy {
  /** Home header subtitle. */
  homeSubtitle: string;
  /** Home section above the project cards. */
  myProjectsTitle: string;
  /** The selected day has no visits. */
  noVisitsOnDay: string;
  /** Home and project button to record a visit that was not planned (recorded as Ad hoc). */
  unscheduledVisitButton: string;
  unscheduledVisitHelp: string;
  /** Visit screen actions. */
  checkInButton: string;
  startFormButton: string;
  resumeFormButton: string;
  correctFormButton: string;
  /** Something is saved on this phone and not sent yet. */
  waitingToSend: string;
  /** Outbox screen when nothing is waiting. */
  outboxEmptyDescription: string;
  /** Site log screen subtitle. */
  siteLogSubtitle: string;
  /** Tenant term for the contractor (project details). */
  contractorLabel: string;
  /** Tenant term for the beneficiary (the school). */
  beneficiaryLabel: string;
  /** Incident report subtitle. */
  incidentSubtitle: string;
}

export function personaCopy(
  _persona: FieldPersonaType | null | undefined,
  terminology?: ResolvedTerminology | null
): PersonaCopy {
  const terms = terminology ?? resolveTerminology({});
  const funder = resolveTerm(terms, 'funderParty', { lower: true });
  return {
    homeSubtitle: 'Your site visits',
    myProjectsTitle: 'My projects',
    noVisitsOnDay: 'No visits on this day.',
    unscheduledVisitButton: 'Unscheduled visit',
    unscheduledVisitHelp: 'Record a visit that was not planned. It is saved as an Ad hoc visit.',
    checkInButton: 'Check in',
    startFormButton: 'Start the visit form',
    resumeFormButton: 'Resume the visit form',
    correctFormButton: 'Correct and resubmit',
    waitingToSend: 'Waiting to send',
    outboxEmptyDescription: 'Every visit report, check-in, response and site log entry from this phone has been accepted by the server.',
    siteLogSubtitle: 'Photos, voice notes and notes from site. Saved on this phone and sent when you are online.',
    contractorLabel: resolveTerm(terms, 'contractor'),
    beneficiaryLabel: resolveTerm(terms, 'beneficiary'),
    incidentSubtitle: `Direct alert to the monitor and the ${funder}`,
  };
}
