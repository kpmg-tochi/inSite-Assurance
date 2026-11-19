import crypto from 'crypto';
import { DEVICE_SIGNATURE_ALGORITHM } from '@insite/shared';
import { AppError } from '../middleware/error.middleware';

/**
 * Ed25519 verification with Node's built-in crypto (no third-party curve library on the server).
 * Devices sign the canonical strings from `@insite/shared` with a per-install key whose public half
 * is registered on the field session.
 */

const ED25519_PUBLIC_KEY_BYTES = 32;
const ED25519_SIGNATURE_BYTES = 64;

function decodeBase64(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null;
  const normalised = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalised, 'base64');
}

/** Validates a base64 raw Ed25519 public key; returns it normalised plus a short fingerprint. */
export function parseDevicePublicKey(
  publicKeyBase64: string,
  alg: string
): { publicKey: string; keyId: string } {
  if (alg !== DEVICE_SIGNATURE_ALGORITHM) {
    throw new AppError('Unsupported device key algorithm', 400, 'UNSUPPORTED_KEY_ALGORITHM');
  }
  const raw = decodeBase64(publicKeyBase64);
  if (!raw || raw.length !== ED25519_PUBLIC_KEY_BYTES) {
    throw new AppError('Device public key must be 32 bytes, base64 encoded', 400, 'INVALID_DEVICE_KEY');
  }
  try {
    toKeyObject(raw);
  } catch {
    throw new AppError('Device public key is not a valid Ed25519 key', 400, 'INVALID_DEVICE_KEY');
  }
  return {
    publicKey: raw.toString('base64'),
    keyId: crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16),
  };
}

function toKeyObject(raw: Buffer): crypto.KeyObject {
  return crypto.createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') },
    format: 'jwk',
  });
}

export type SignatureCheck = {
  /** true = valid, false = present but invalid, null = nothing to verify (unsigned or no key). */
  verified: boolean | null;
  flag: 'SIGNATURE_INVALID' | 'UNSIGNED' | 'NO_DEVICE_KEY' | null;
};

/** Verifies `signature` over `message` with the session's registered key. Never throws. */
export function verifyDeviceSignature(params: {
  publicKey: string | null | undefined;
  alg: string | null | undefined;
  message: string;
  signature: string | null | undefined;
}): SignatureCheck {
  if (!params.signature) {
    return { verified: null, flag: params.publicKey ? 'UNSIGNED' : 'NO_DEVICE_KEY' };
  }
  if (!params.publicKey || params.alg !== DEVICE_SIGNATURE_ALGORITHM) {
    return { verified: null, flag: 'NO_DEVICE_KEY' };
  }
  try {
    const sig = decodeBase64(params.signature);
    const key = decodeBase64(params.publicKey);
    if (!sig || sig.length !== ED25519_SIGNATURE_BYTES || !key) {
      return { verified: false, flag: 'SIGNATURE_INVALID' };
    }
    const ok = crypto.verify(null, Buffer.from(params.message, 'utf8'), toKeyObject(key), sig);
    return ok ? { verified: true, flag: null } : { verified: false, flag: 'SIGNATURE_INVALID' };
  } catch {
    return { verified: false, flag: 'SIGNATURE_INVALID' };
  }
}
