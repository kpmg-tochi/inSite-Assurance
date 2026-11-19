/**
 * What a report's status pill may say (Phase 7 Step 8). Only states the server reported are shown:
 * "Awaiting approval" only for PENDING_APPROVAL, "Confirmed" only for CONFIRMED, and so on. A
 * status this build does not know is shown as "Sent", never as accepted.
 */

export type ReportStatusVariant = 'positive' | 'warning' | 'negative' | 'info' | 'gray';

export interface ReportStatusView {
  label: string;
  variant: ReportStatusVariant;
  /** True when the reporter has something to do (answer the reviewer's query). */
  needsAction: boolean;
}

export function reportStatusView(
  serverStatus: string | null | undefined,
  syncStatus: string | null | undefined
): ReportStatusView {
  switch (serverStatus) {
    case 'STAGED_UNVERIFIED':
      return { label: 'Held until identity approval', variant: 'warning', needsAction: false };
    case 'CONFIRMED':
      return { label: 'Confirmed', variant: 'positive', needsAction: false };
    case 'PENDING_APPROVAL':
      return { label: 'Awaiting approval', variant: 'info', needsAction: false };
    case 'APPROVED_COMPLETED':
      return { label: 'Approved', variant: 'positive', needsAction: false };
    case 'RETURNED_FOR_REVISION':
      return { label: 'Returned for revision', variant: 'negative', needsAction: true };
    default:
      break;
  }
  if (syncStatus === 'SENT' || serverStatus) {
    return { label: 'Sent', variant: 'info', needsAction: false };
  }
  // Refused for good by the server (for example contractor reporting switched off); not retried.
  if (syncStatus === 'FAILED') return { label: 'Not sent', variant: 'negative', needsAction: false };
  return { label: 'Waiting to send', variant: 'gray', needsAction: false };
}

/**
 * Label for a report query in a WBS thread or notification. The standards check, the omission
 * check and a monitor's query are kept apart so the reporter knows what is being asked.
 */
export function reportQueryLabel(querySource: string | null | undefined, messageType?: string | null): string {
  if (querySource === 'AI_STANDARDS_CHECK') return 'Standards check';
  if (querySource === 'AI_OMISSION_CHECK') return 'Missing evidence check';
  if (querySource === 'MONITOR') return 'Monitor query';
  // Older cached messages carry no query details: fall back on the message type.
  if (messageType === 'AI_QUERY') return 'Missing evidence check';
  if (messageType === 'MONITOR_QUERY') return 'Monitor query';
  return 'Query';
}
