/**
 * Mobile project join codes:
 * - `{codePrefix}-{roleSuffix}-{random}`, e.g. `LKK-402-CON-7K2QXM`
 * - `{codePrefix}-{roleSuffix}-{tradeCode}-{random}`, e.g. `LKK-402-CON-ELEC-7K2QXM`, for a
 *   contractor-executor role on a project with several contractors (Phase 6). The trade code ties
 *   the session to one `ProjectContractor`.
 *
 * - codePrefix: project prefix, `AAA-999`
 * - roleSuffix: the role's 2-4 character `codeSuffix`
 * - tradeCode: the contractor's 2-6 character trade code (letters and digits)
 * - random: 6 characters from the Crockford base32 alphabet (no I, L, O, U)
 */
export const JOIN_CODE_RANDOM_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const JOIN_CODE_RANDOM_LENGTH = 6;
export const JOIN_CODE_REGEX =
  /^[A-Z0-9]{3}-[0-9]{3}-[A-Z0-9]{2,4}-(?:[A-Z0-9]{2,6}-)?[0-9A-HJKMNP-TV-Z]{6}$/;
export const JOIN_CODE_MAX_LENGTH = 26;
export const JOIN_CODE_EXAMPLE = 'LKK-402-CON-7K2QXM';

/** A contractor package's trade code, used in join codes and IPC numbering. */
export const TRADE_CODE_REGEX = /^[A-Z0-9]{2,6}$/;

export function isValidJoinCode(value: string): boolean {
  return JOIN_CODE_REGEX.test(value.trim().toUpperCase());
}
