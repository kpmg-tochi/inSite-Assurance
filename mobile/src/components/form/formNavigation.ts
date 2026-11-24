/**
 * Redesign R5c: the review screen sends the officer back to one section of the form. The `VisitForm`
 * route takes only `{ visitId }` (navigation is R5b's), so the wanted section is handed over here and
 * read once by the form screen when it gains focus.
 */
const requested = new Map<string, string>();

export function requestFormScreen(visitId: string, screenKey: string): void {
  requested.set(visitId, screenKey);
}

export function takeRequestedFormScreen(visitId: string): string | null {
  const key = requested.get(visitId) ?? null;
  requested.delete(visitId);
  return key;
}
