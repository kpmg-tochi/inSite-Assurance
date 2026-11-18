/**
 * Mobile project join codes: `{codePrefix}-{roleSuffix}-{random}`, e.g. `LKK-402-CON-7K2QXM`.
 * - codePrefix: project prefix, `AAA-999`
 * - roleSuffix: the role's 2-4 character `codeSuffix`
 * - random: 6 characters from the Crockford base32 alphabet (no I, L, O, U)
 */
export const JOIN_CODE_RANDOM_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const JOIN_CODE_RANDOM_LENGTH = 6;
export const JOIN_CODE_REGEX =
  /^[A-Z0-9]{3}-[0-9]{3}-[A-Z0-9]{2,4}-[0-9A-HJKMNP-TV-Z]{6}$/;
export const JOIN_CODE_MAX_LENGTH = 19;
export const JOIN_CODE_EXAMPLE = 'LKK-402-CON-7K2QXM';

export function isValidJoinCode(value: string): boolean {
  return JOIN_CODE_REGEX.test(value.trim().toUpperCase());
}
