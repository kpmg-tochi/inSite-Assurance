import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils';

/**
 * Pure Ed25519 signing (no React Native imports, so it runs in Node tests).
 *
 * The device signs the canonical strings from `@insite/shared` (canonicalCaptureString,
 * canonicalReportString, canonicalPingString). The server verifies with Node's built-in crypto.
 * Random bytes for key generation come from the caller (expo-crypto on the device), because React
 * Native has no secure `crypto.getRandomValues` of its own.
 */

// noble-ed25519 v3: synchronous signing needs a SHA-512 implementation.
ed.hashes.sha512 = (message) => new Uint8Array(sha512(message));

export const ED25519_SECRET_KEY_BYTES = 32;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error('Invalid hex string');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function assertSecretKey(secretKey: Uint8Array) {
  if (secretKey.length !== ED25519_SECRET_KEY_BYTES) {
    throw new Error('Ed25519 secret key must be 32 bytes');
  }
}

/** Base64 raw public key, the format `POST /auth/device-key` and the join request expect. */
export function publicKeyBase64(secretKey: Uint8Array): string {
  assertSecretKey(secretKey);
  return bytesToBase64(ed.getPublicKey(secretKey));
}

/** Base64 Ed25519 signature over the UTF-8 bytes of `message`. */
export function signCanonical(message: string, secretKey: Uint8Array): string {
  assertSecretKey(secretKey);
  return bytesToBase64(ed.sign(utf8ToBytes(message), secretKey));
}
