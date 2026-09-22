/**
 * delete-account core, shared by the edge function and Jest. Plain TypeScript with no imports and no
 * Deno or React Native APIs (only WebCrypto passed in, plus btoa/atob/TextEncoder), so it runs unchanged in both.
 */

export interface DeleteRequest {
  appleAuthorizationCode: string | null;
}

const APPLE_CODE = /^[A-Za-z0-9._-]{1,2048}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The body may be empty or { appleAuthorizationCode }. Anything else (a user id, say) is refused. */
export function parseDeleteRequest(body: unknown): DeleteRequest | null {
  if (body === undefined || body === null) return { appleAuthorizationCode: null };
  if (typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((k) => k !== 'appleAuthorizationCode')) return null;
  const code = record.appleAuthorizationCode;
  if (code === undefined || code === null) return { appleAuthorizationCode: null };
  return typeof code === 'string' && APPLE_CODE.test(code) ? { appleAuthorizationCode: code } : null;
}

export function isUuid(s: unknown): s is string {
  return typeof s === 'string' && UUID.test(s);
}

/**
 * The caller's uid from the user auth.getUser(token) returned: getUser asks the auth server, so a revoked or
 * signed-out session has no user (a locally verified JWT would still pass). Only an authenticated user counts.
 */
export function callerUid(user: { id?: unknown; role?: unknown } | null | undefined): string | null {
  if (!user || user.role !== 'authenticated' || !isUuid(user.id)) return null;
  return user.id;
}

export function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** An Apple .p8 file (PEM, possibly stored with literal \n) to PKCS#8 DER bytes. */
export function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const b64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\\n/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

export function appleClientSecretParts(p: { teamId: string; keyId: string; clientId: string; nowSec: number }) {
  return {
    header: { alg: 'ES256' as const, kid: p.keyId },
    payload: { iss: p.teamId, iat: p.nowSec, exp: p.nowSec + 300, aud: 'https://appleid.apple.com' as const, sub: p.clientId },
  };
}

export function jwtSigningInput(header: object, payload: object): string {
  const enc = new TextEncoder();
  return `${base64url(enc.encode(JSON.stringify(header)))}.${base64url(enc.encode(JSON.stringify(payload)))}`;
}

/** Apple's client_secret: an ES256 JWT signed with the Sign in with Apple key. WebCrypto returns the raw r||s form JWTs need. */
export async function appleClientSecret(
  subtle: SubtleCrypto,
  pem: string,
  p: { teamId: string; keyId: string; clientId: string; nowSec: number },
): Promise<string> {
  const { header, payload } = appleClientSecretParts(p);
  const input = jwtSigningInput(header, payload);
  const key = await subtle.importKey('pkcs8', pemToPkcs8(pem), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(input)));
  return `${input}.${base64url(sig)}`;
}

/** Storage list() names under covers/<uid>/ become removable paths, and never anything outside the caller's folder. */
export function coverPaths(uid: string, names: string[]): string[] {
  return names.filter((n) => n.length > 0 && !n.includes('/')).map((n) => `${uid}/${n}`);
}

export function isMissingBucket(err: unknown): boolean {
  const e = (err ?? {}) as { message?: unknown; statusCode?: unknown };
  return e.statusCode === '404' || e.statusCode === 404 || (typeof e.message === 'string' && /bucket not found/i.test(e.message));
}

export function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
