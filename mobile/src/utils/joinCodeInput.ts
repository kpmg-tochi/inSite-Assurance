/**
 * Join code entry helpers. Two formats exist (validated by `isValidJoinCode` from shared):
 * - `AAA-999-SUF-XXXXXX` (e.g. LKK-402-CON-7K2QXM)
 * - `AAA-999-SUF-TRADE-XXXXXX` (e.g. LKK-402-CON-ELEC-7K2QXM, Phase 6 contractor codes)
 *
 * The role suffix is 2-4 characters and the trade code 2-6, so segment boundaries after the
 * project prefix cannot be inferred while the person is still typing. The formatter therefore only
 * inserts the two prefix hyphens and keeps any hyphen the person types; `normalizeJoinCode` fills
 * in the missing boundaries once the whole code is there.
 */

const MAX_TAIL_SEGMENTS = 3; // suffix, trade, random

/** Formats text as it is typed or pasted. Recomputed from scratch on every keystroke. */
export function formatJoinCodeInput(raw: string): string {
  const upper = raw.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  const alnum = upper.replace(/-/g, "");
  const head = alnum.slice(0, 3);
  const mid = alnum.slice(3, 6);

  // Everything after the first 6 alphanumerics, keeping any hyphen the person typed.
  let seen = 0;
  let cut = upper.length;
  for (let i = 0; i < upper.length; i++) {
    if (upper[i] !== "-") seen++;
    if (seen === 6) {
      cut = i + 1;
      break;
    }
  }
  const tail = seen >= 6 ? upper.slice(cut).replace(/^-+/, "").replace(/-+/g, "-") : "";
  const segments = tail.split("-").filter((s) => s.length > 0);
  const kept = segments.slice(0, MAX_TAIL_SEGMENTS - 1);
  const rest = segments.slice(MAX_TAIL_SEGMENTS - 1).join("");
  if (rest) kept.push(rest);

  const out = [head, mid, ...kept].filter((part) => part.length > 0).join("-");
  // Keep a hyphen just typed so the next segment can follow it.
  return tail.endsWith("-") && kept.length > 0 && kept.length < MAX_TAIL_SEGMENTS ? `${out}-` : out;
}

/**
 * Fills in segment boundaries the person did not type, then returns the code to validate and send:
 * `LKK-402-CON7K2QXM` becomes `LKK-402-CON-7K2QXM` and `LKK-402-CON-ELEC7K2QXM` becomes
 * `LKK-402-CON-ELEC-7K2QXM` (the random segment is always the last 6 characters). Anything else is
 * returned trimmed and upper-cased, unchanged.
 */
export function normalizeJoinCode(value: string): string {
  const code = formatJoinCodeInput(value.trim()).replace(/-+$/, "");
  const parts = code.split("-");
  if (parts.length < 3) return code;
  const [head, mid, ...tail] = parts;
  const last = tail[tail.length - 1];
  if (tail.length >= MAX_TAIL_SEGMENTS || last.length <= 6) return code;
  const split = [...tail.slice(0, -1), last.slice(0, -6), last.slice(-6)];
  return [head, mid, ...split].join("-");
}
