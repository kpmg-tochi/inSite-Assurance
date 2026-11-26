/**
 * Client demo updates D3: the text "Find address" looks up, from the parts available (school or
 * project name, address, LGA). Empty parts and parts already contained in an earlier one are
 * left out; the server adds the State name.
 */
export function addressQuery(parts: Array<string | null | undefined>): string {
  const kept: string[] = [];
  for (const raw of parts) {
    const part = (raw ?? '').trim().replace(/\s+/g, ' ');
    if (!part) continue;
    const lower = part.toLowerCase();
    if (kept.some((k) => k.toLowerCase().includes(lower))) continue;
    kept.push(part);
  }
  return kept.join(', ').slice(0, 300);
}
