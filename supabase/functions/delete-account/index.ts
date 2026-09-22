// Supabase Edge Function: delete-account
// POST { appleAuthorizationCode?: string } with the caller's user JWT -> { deleted: true }
// The caller can only ever delete themselves: the uid comes from the user the auth server verified, never from the body.
// Order: Apple token revocation (when a code is sent), then every object under covers/<uid>/, then
// auth.admin.deleteUser(uid); its on delete cascade removes all their rows.
// Errors are generic. Logs carry only a request id and an outcome word.
// Deploy: Sean runs `supabase functions deploy delete-account`. Subagents never deploy.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2.116.0';
import { appleClientSecret, callerUid, chunk, coverPaths, isMissingBucket, parseDeleteRequest } from '../_shared/accountCore.ts';

const MAX_BODY_BYTES = 4096;
const APPLE_TIMEOUT_MS = 8000;
const LIST_PAGE = 1000;

Deno.serve(async (req) => {
  const reqId = crypto.randomUUID().slice(0, 8);
  const done = (outcome: string, status: number, body: unknown) => {
    console.log(JSON.stringify({ fn: 'delete-account', reqId, outcome }));
    return json(body, status);
  };
  try {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (Number(req.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) return done('rejected', 413, { error: 'invalid_request' });
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return done('rejected', 413, { error: 'invalid_request' });
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      return done('rejected', 400, { error: 'invalid_request' });
    }
    const request = parseDeleteRequest(body);
    if (!request) return done('rejected', 400, { error: 'invalid_request' });

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const auth = req.headers.get('Authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
    if (!token) return done('unauthorized', 401, { error: 'unauthorized' });
    // getUser, not getClaims: it checks with the auth server that the session still exists, so a revoked token can't delete.
    const { data, error } = await admin.auth.getUser(token);
    const uid = error ? null : callerUid(data?.user);
    if (!uid) return done('unauthorized', 401, { error: 'unauthorized' });

    if (request.appleAuthorizationCode && !(await revokeApple(request.appleAuthorizationCode))) {
      return done('failed:apple', 502, { error: 'delete_failed' });
    }
    if (!(await removeCovers(admin, uid))) return done('failed:storage', 500, { error: 'delete_failed' });
    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) return done('failed:auth', 500, { error: 'delete_failed' });
    return done('deleted', 200, { deleted: true });
  } catch {
    return done('failed:unhandled', 500, { error: 'delete_failed' });
  }
});

/** Exchanges the fresh authorisation code, then revokes the token (Apple requires this when an account is deleted). */
async function revokeApple(code: string): Promise<boolean> {
  const clientId = Deno.env.get('APPLE_CLIENT_ID');
  const teamId = Deno.env.get('APPLE_TEAM_ID');
  const keyId = Deno.env.get('APPLE_KEY_ID');
  const pem = Deno.env.get('APPLE_PRIVATE_KEY');
  if (!clientId || !teamId || !keyId || !pem) return false;
  const secret = await appleClientSecret(crypto.subtle, pem, { teamId, keyId, clientId, nowSec: Math.floor(Date.now() / 1000) });
  const form = (fields: Record<string, string>): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(APPLE_TIMEOUT_MS),
  });
  const tokenRes = await fetch('https://appleid.apple.com/auth/token', form({ client_id: clientId, client_secret: secret, code, grant_type: 'authorization_code' }));
  if (!tokenRes.ok) {
    await tokenRes.body?.cancel();
    return false;
  }
  const tokens = (await tokenRes.json()) as { refresh_token?: string; access_token?: string };
  const token = tokens.refresh_token ?? tokens.access_token;
  if (!token) return false;
  const revokeRes = await fetch(
    'https://appleid.apple.com/auth/revoke',
    form({ client_id: clientId, client_secret: secret, token, token_type_hint: tokens.refresh_token ? 'refresh_token' : 'access_token' }),
  );
  await revokeRes.body?.cancel();
  return revokeRes.ok;
}

/** Deletes every object in covers/<uid>/. A missing bucket counts as nothing to delete. */
async function removeCovers(admin: SupabaseClient, uid: string): Promise<boolean> {
  const bucket = admin.storage.from('covers');
  for (let round = 0; round < 50; round++) {
    const { data, error } = await bucket.list(uid, { limit: LIST_PAGE });
    if (error) return isMissingBucket(error);
    const paths = coverPaths(uid, (data ?? []).map((o) => o.name));
    if (paths.length === 0) return true;
    for (const part of chunk(paths, 100)) {
      const { error: rmErr } = await bucket.remove(part);
      if (rmErr) return false;
    }
    if ((data ?? []).length < LIST_PAGE) return true;
  }
  return false;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
