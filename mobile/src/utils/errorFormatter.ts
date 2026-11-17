/**
 * Converts low-level network, Java/Android socket, or server errors
 * into clear, user-friendly messages safe for UI display.
 */
export function formatMobileErrorMessage(
  error: unknown,
  status?: number
): string {
  const rawMessage =
    error instanceof Error
      ? error.message.trim()
      : typeof error === 'string'
        ? error.trim()
        : '';

  const lower = rawMessage.toLowerCase();

  // 1. Connectivity / Socket failures (e.g. ConnectException, Network request failed)
  if (
    lower.includes('failed to connect') ||
    lower.includes('connectexception') ||
    lower.includes('network request failed') ||
    lower.includes('network error') ||
    lower.includes('fetch failed') ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('unable to resolve host') ||
    lower.includes('socketexception') ||
    lower.includes('err_network')
  ) {
    return 'Failed to connect to server. Please check your connection and ensure the server is running.';
  }

  // 2. Timeouts / Aborts
  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('aborterror') ||
    lower.includes('aborted')
  ) {
    return 'Connection timed out while contacting the server. Please try again.';
  }

  // 3. HTTP status mapping
  if (status === 401 || status === 403) {
    return 'Your session has expired or you do not have permission for this action.';
  }
  if (status && status >= 500) {
    return 'Something went wrong on the server. Please try again shortly.';
  }

  // 4. Filter out overly technical/internal backend or native errors
  const looksTechnical =
    rawMessage.length > 140 ||
    lower.includes('prisma') ||
    lower.includes('invocation') ||
    lower.includes('column `') ||
    lower.includes('does not exist') ||
    lower.includes('sql') ||
    lower.includes('java.') ||
    lower.includes('c:\\') ||
    lower.includes('/src/');

  if (looksTechnical) {
    return 'Something went wrong while communicating with the server. Please try again.';
  }

  if (rawMessage) {
    return rawMessage;
  }

  if (status === 404) {
    return 'The requested record could not be found.';
  }

  return 'Unable to complete the request right now. Please try again.';
}

