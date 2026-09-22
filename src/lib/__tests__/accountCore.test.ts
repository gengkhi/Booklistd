/// <reference types="node" />
import { webcrypto } from 'crypto';
import {
  appleClientSecret, appleClientSecretParts, base64url, callerUid, chunk, coverPaths, isMissingBucket, isUuid, jwtSigningInput,
  parseDeleteRequest, pemToPkcs8,
} from '../../../supabase/functions/_shared/accountCore';

const subtle = webcrypto.subtle as unknown as SubtleCrypto;

describe('parseDeleteRequest', () => {
  it('accepts an empty body or a null code', () => {
    expect(parseDeleteRequest(undefined)).toEqual({ appleAuthorizationCode: null });
    expect(parseDeleteRequest({})).toEqual({ appleAuthorizationCode: null });
    expect(parseDeleteRequest({ appleAuthorizationCode: null })).toEqual({ appleAuthorizationCode: null });
  });
  it('accepts an Apple authorization code', () => {
    expect(parseDeleteRequest({ appleAuthorizationCode: 'c1a2.b3-c_4' })).toEqual({ appleAuthorizationCode: 'c1a2.b3-c_4' });
  });
  it.each([[[]], ['x'], [{ userId: 'someone-else' }], [{ appleAuthorizationCode: 'has space' }], [{ appleAuthorizationCode: 'x'.repeat(2049) }]])(
    'rejects %p', (body) => expect(parseDeleteRequest(body)).toBeNull()
  );
});

describe('helpers', () => {
  it('callerUid takes the id only from a verified, authenticated user (I2)', () => {
    const id = '6f1c1b8e-3b0a-4c55-9d7e-2a1f0c9b8d7e';
    expect(callerUid({ id, role: 'authenticated' })).toBe(id);
    expect(callerUid(null)).toBeNull();
    expect(callerUid(undefined)).toBeNull();
    expect(callerUid({ id, role: 'anon' })).toBeNull();
    expect(callerUid({ id, role: 'service_role' })).toBeNull();
    expect(callerUid({ id: '../other', role: 'authenticated' })).toBeNull();
  });
  it('isUuid', () => {
    expect(isUuid('6f1c1b8e-3b0a-4c55-9d7e-2a1f0c9b8d7e')).toBe(true);
    expect(isUuid('../other')).toBe(false);
  });
  it('base64url has no padding or +/', () => expect(base64url(new Uint8Array([251, 255, 191]))).toBe('-_-_'));
  it('coverPaths keeps flat names under the caller only', () => {
    expect(coverPaths('u1', ['a.jpg', '', 'nested/b.jpg', 'c.jpg'])).toEqual(['u1/a.jpg', 'u1/c.jpg']);
  });
  it('isMissingBucket', () => {
    expect(isMissingBucket({ message: 'Bucket not found' })).toBe(true);
    expect(isMissingBucket({ statusCode: '404' })).toBe(true);
    expect(isMissingBucket({ message: 'permission denied' })).toBe(false);
  });
  it('chunk', () => expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]));
});

describe('Apple client secret', () => {
  it('has the claims Apple expects, valid for five minutes', () => {
    expect(appleClientSecretParts({ teamId: 'TEAM', keyId: 'KEY', clientId: 'com.sean.booklistd', nowSec: 1000 })).toEqual({
      header: { alg: 'ES256', kid: 'KEY' },
      payload: { iss: 'TEAM', iat: 1000, exp: 1300, aud: 'https://appleid.apple.com', sub: 'com.sean.booklistd' },
    });
  });

  it('signs an ES256 JWT with a .p8 key', async () => {
    const pair = (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey));
    const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(pkcs8).toString('base64')}\n-----END PRIVATE KEY-----`;
    expect(Array.from(pemToPkcs8(pem))).toEqual(Array.from(pkcs8));

    const jwt = await appleClientSecret(subtle, pem, { teamId: 'TEAM', keyId: 'KEY', clientId: 'com.sean.booklistd', nowSec: 1000 });
    const [h, p, s] = jwt.split('.');
    expect(`${h}.${p}`).toBe(jwtSigningInput({ alg: 'ES256', kid: 'KEY' }, { iss: 'TEAM', iat: 1000, exp: 1300, aud: 'https://appleid.apple.com', sub: 'com.sean.booklistd' }));
    const sig = new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
    expect(sig.length).toBe(64);
    const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, sig, new TextEncoder().encode(`${h}.${p}`));
    expect(ok).toBe(true);
  });
});
