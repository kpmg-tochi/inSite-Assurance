/**
 * Runs in Node (`npm --workspace=@insite/mobile test`). Proves a signature made by the mobile
 * signing module verifies the same way the server verifies it (Node crypto, raw Ed25519 JWK).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { canonicalCaptureString } from '@insite/shared';
import { bytesToBase64, hexToBytes, publicKeyBase64, signCanonical } from './signing';

function serverVerify(publicKeyB64: string, message: string, signatureB64: string): boolean {
  const key = crypto.createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(publicKeyB64, 'base64').toString('base64url') },
    format: 'jwk',
  });
  return crypto.verify(null, Buffer.from(message, 'utf8'), key, Buffer.from(signatureB64, 'base64'));
}

describe('device signing', () => {
  const secret = new Uint8Array(crypto.randomBytes(32));
  const message = canonicalCaptureString({
    clientCaptureId: '7b0c9a5e-0d6b-4c1a-9f62-1c8d2b8e4a11',
    projectId: '0d1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b',
    mediaType: 'SITE_PHOTO',
    sha256: 'ab'.repeat(32),
    byteSize: 123456,
    capturedAt: '2026-11-19T10:00:00.000Z',
    latitude: 6.4502,
    longitude: 3.57,
    accuracyMeters: 4.5,
    isMockLocation: false,
  });

  it('produces signatures the server verifies', () => {
    const sig = signCanonical(message, secret);
    assert.equal(serverVerify(publicKeyBase64(secret), message, sig), true);
  });

  it('fails verification when the message changes', () => {
    const sig = signCanonical(message, secret);
    assert.equal(serverVerify(publicKeyBase64(secret), message.replace('6.4502', '6.4503'), sig), false);
  });

  it('matches Node for the public key and base64', () => {
    const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(secret)]);
    const nodePriv = crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
    const nodePub = crypto.createPublicKey(nodePriv).export({ format: 'jwk' }).x as string;
    assert.equal(publicKeyBase64(secret), Buffer.from(nodePub, 'base64url').toString('base64'));
    const sample = new Uint8Array([0, 1, 2, 250, 251, 252, 253]);
    assert.equal(bytesToBase64(sample), Buffer.from(sample).toString('base64'));
    assert.deepEqual(hexToBytes('00ff10'), new Uint8Array([0, 255, 16]));
  });
});
