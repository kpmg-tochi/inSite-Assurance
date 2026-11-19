import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { DEVICE_SIGNATURE_ALGORITHM } from '@insite/shared';
import {
  bytesToHex,
  ED25519_SECRET_KEY_BYTES,
  hexToBytes,
  publicKeyBase64,
  signCanonical,
} from './signing';

/**
 * Per-install Ed25519 signing key (Phase 4).
 *
 * The secret key lives only in the OS keystore (expo-secure-store) and never leaves the device.
 * The public key is registered with the server at join, or once via `POST /auth/device-key`.
 */

const SECRET_KEY_STORE_KEY = 'insite.deviceSigningKey.v1';

let cachedSecret: Uint8Array | null = null;

async function loadOrCreateSecret(): Promise<Uint8Array> {
  if (cachedSecret) return cachedSecret;
  const stored = await SecureStore.getItemAsync(SECRET_KEY_STORE_KEY);
  if (stored) {
    cachedSecret = hexToBytes(stored);
    return cachedSecret;
  }
  const secret = Crypto.getRandomBytes(ED25519_SECRET_KEY_BYTES);
  await SecureStore.setItemAsync(SECRET_KEY_STORE_KEY, bytesToHex(secret), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  cachedSecret = secret;
  return secret;
}

export async function getDevicePublicKey(): Promise<{
  devicePublicKey: string;
  devicePublicKeyAlg: typeof DEVICE_SIGNATURE_ALGORITHM;
}> {
  return {
    devicePublicKey: publicKeyBase64(await loadOrCreateSecret()),
    devicePublicKeyAlg: DEVICE_SIGNATURE_ALGORITHM,
  };
}

/** Signs a canonical string from `@insite/shared` with the device key. */
export async function signWithDeviceKey(canonical: string): Promise<string> {
  return signCanonical(canonical, await loadOrCreateSecret());
}
