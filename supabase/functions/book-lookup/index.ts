// Supabase Edge Function: book-lookup
// POST { isbn: "9780441172719" } -> normalized book metadata.
// POST { ensure: { isbn13 } } (signed-in users only) -> { id }: the catalog id for that ISBN, creating it if needed.
// Waterfall: shared catalog cache -> negative cache -> Google Books -> Open Library.
// Every hit is cached into public.books and every definite miss into public.lookup_misses,
// so repeated scans never re-hit the sources.
//
// Hardening (security review F2, F7, F8, F10):
// - strict input: POST only, body capped, ISBN-10/13 with a valid checksum, else 400
// - per-caller fixed-window rate limit in Postgres (lookup_rate_hit), keyed on the
//   verified user id, else a salted SHA-256 of the client IP; plus a shared hourly pool
//   for anonymous callers so the anon key alone can't drain the Google Books quota
// - the limiter fails closed for upstream calls; cached answers are still served
// - ensure has its own per-user bucket (ensure:user:<id>, per minute) plus a daily cap on row-creating ensures
// - upstream URLs and refs are allow-listed (bookCore.ts), fetches time out
// - clients only ever see generic error codes; console.error logs a request id and an outcome word only
// Deploy: supabase functions deploy book-lookup
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2.116.0';
import {
  ENSURE_LIMITS,
  ensureBucket,
  isAllowedFetchUrl,
  lookupGoogleBooks,
  lookupOpenLibrary,
  parseEnsureRequest,
  parseIsbnStrict,
  placeholderBook,
  safeCoverUrl,
  type FetchJson,
  type SourceBook,
} from '../_shared/bookCore.ts';

const MAX_BODY_BYTES = 1024;
const UPSTREAM_TIMEOUT_MS = 5000;
const MISS_TTL_DAYS = 7;
/** Every valid request from one caller (user or IP) counts against this. */
const CALLER_LIMIT = { windowSeconds: 60, max: 60 } as const;
/** Upstream lookups by all anonymous (anon-key only) callers combined. */
const ANON_UPSTREAM_POOL = { bucket: 'pool:anon-upstream', windowSeconds: 3600, max: 1000 } as const;
/** Retry-After sent when the limiter itself is unavailable. */
const UNAVAILABLE_RETRY_SEC = 30;

type Admin = SupabaseClient;
type Limit = { allowed: boolean; retryAfter: number };

Deno.serve(async (req) => {
  const reqId = crypto.randomUUID().slice(0, 8);
  try {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });

    const body = await readJsonCapped(req, MAX_BODY_BYTES);
    if (body === TOO_LARGE) return json({ error: 'invalid_request' }, 413);
    const ensureIsbn = parseEnsureRequest(body);
    if (ensureIsbn) return await ensureBook(req, ensureIsbn, reqId);
    const isbn13 = parseRequest(body);
    if (!isbn13) return json({ error: 'invalid_request' }, 400);

    const admin = adminClient();

    const caller = await identifyCaller(req, admin);

    // Limiter errors must not take cached answers down with them: remember the failure
    // and refuse only the upstream step (fail closed where it costs quota).
    const callerLimit = await hit(admin, caller.bucket, CALLER_LIMIT.windowSeconds, CALLER_LIMIT.max).catch(() => {
      log(reqId, 'rate_limiter_unavailable');
      return null;
    });
    const limiterDown = callerLimit === null;
    if (callerLimit && !callerLimit.allowed) return tooMany(callerLimit.retryAfter);

    // 1) shared catalog
    const { data: cached, error: cacheErr } = await admin.from('books').select('*').eq('isbn13', isbn13).maybeSingle();
    if (cacheErr) throw new Error(`books read failed: ${cacheErr.message}`);
    // An ensure placeholder is not an answer: fall through, and a hit upserts over it (same id).
    if (cached && cached.source !== 'placeholder') return json(shape(cached));

    // 2) negative cache
    const since = new Date(Date.now() - MISS_TTL_DAYS * 86_400_000).toISOString();
    const { data: miss, error: missErr } = await admin
      .from('lookup_misses').select('isbn13').eq('isbn13', isbn13).gte('checked_at', since).maybeSingle();
    if (missErr) throw new Error(`lookup_misses read failed: ${missErr.message}`);
    if (miss) return json({ error: 'not_found' }, 404);

    // 3) upstream, only with a working limiter and room in the anonymous pool
    if (limiterDown) return json({ error: 'lookup_unavailable' }, 503, { 'Retry-After': String(UNAVAILABLE_RETRY_SEC) });
    if (caller.anonymous) {
      const pool = await hit(admin, ANON_UPSTREAM_POOL.bucket, ANON_UPSTREAM_POOL.windowSeconds, ANON_UPSTREAM_POOL.max)
        .catch(() => {
          log(reqId, 'rate_limiter_unavailable_pool');
          return null;
        });
      if (!pool) return json({ error: 'lookup_unavailable' }, 503, { 'Retry-After': String(UNAVAILABLE_RETRY_SEC) });
      if (!pool.allowed) return tooMany(pool.retryAfter);
    }

    let upstreamFailed = false;
    const attempt = async (run: () => Promise<SourceBook | null>) => {
      try {
        return await run();
      } catch {
        upstreamFailed = true;
        log(reqId, 'upstream_lookup_failed');
        return null;
      }
    };
    const found =
      (await attempt(() => lookupGoogleBooks(isbn13, fetchJson))) ??
      (await attempt(() => lookupOpenLibrary(isbn13, fetchJson)));

    if (found) {
      const row = await cache(admin, found, reqId);
      await admin.from('lookup_misses').delete().eq('isbn13', isbn13);
      return json(row);
    }

    // Only a definite "no" from both sources is cached; a timeout or quota error is not.
    if (upstreamFailed) return json({ error: 'lookup_failed' }, 502);
    await recordMiss(admin, isbn13, reqId);
    return json({ error: 'not_found' }, 404);
  } catch {
    log(reqId, 'unhandled');
    return json({ error: 'lookup_failed' }, 500);
  }
});

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

const TOO_LARGE = Symbol('too_large');

/** Reads at most maxBytes of the body; anything unparseable comes back as undefined. */
async function readJsonCapped(req: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) return TOO_LARGE;
  if (!req.body) return undefined;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return TOO_LARGE;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buf));
  } catch {
    return undefined;
  }
}

/** The app sends exactly { isbn: "<isbn13>" }; ISBN-10 and hyphenated forms are tolerated. */
function parseRequest(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  return parseIsbnStrict((body as Record<string, unknown>).isbn);
}

// ---------------------------------------------------------------------------
// Caller identity and rate limiting
// ---------------------------------------------------------------------------

/**
 * A verified signed-in user is keyed on their id. Everyone else (the public anon key)
 * is keyed on a salted SHA-256 of the first X-Forwarded-For hop; the raw IP is never
 * stored or logged.
 */
async function identifyCaller(req: Request, admin: Admin): Promise<{ bucket: string; anonymous: boolean }> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
  if (token && unverifiedRole(token) === 'authenticated') {
    try {
      const { data, error } = await admin.auth.getClaims(token);
      const claims = data?.claims;
      if (!error && claims?.role === 'authenticated' && typeof claims.sub === 'string' && claims.sub) {
        return { bucket: `user:${claims.sub}`, anonymous: false };
      }
    } catch {
      // unverifiable token: treat as anonymous
    }
  }
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const salt = Deno.env.get('RATE_LIMIT_SALT') ?? '';
  return { bucket: `ip:${await sha256Hex(`booklistd-rl:v1:${salt}:${ip}`)}`, anonymous: true };
}

/** Reads the role claim without verifying; only used to skip verification for anon keys. */
function unverifiedRole(token: string): string | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const payload = JSON.parse(atob(b64));
    return typeof payload?.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hit(admin: Admin, bucket: string, windowSeconds: number, max: number): Promise<Limit> {
  const { data, error } = await admin.rpc('lookup_rate_hit', {
    p_bucket: bucket,
    p_window_seconds: windowSeconds,
    p_limit: max,
  });
  if (error) throw new Error(`lookup_rate_hit failed: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as { allowed?: unknown; retry_after?: unknown } | null;
  if (!row || typeof row.allowed !== 'boolean') throw new Error('lookup_rate_hit returned no row');
  return { allowed: row.allowed, retryAfter: Math.max(1, Number(row.retry_after) || 1) };
}

function tooMany(retryAfter: number) {
  return json({ error: 'rate_limited' }, 429, { 'Retry-After': String(retryAfter) });
}

// ---------------------------------------------------------------------------
// Upstream
// ---------------------------------------------------------------------------

/**
 * Allow-listed, time-limited JSON fetch. 404 resolves null (a definite "not found");
 * every other failure throws. The Google key travels in a header, never the URL, so it
 * can't end up in an error message or a log line.
 */
const fetchJson: FetchJson = async (url) => {
  if (!isAllowedFetchUrl(url)) throw new Error('blocked upstream url');
  const headers: Record<string, string> = { Accept: 'application/json' };
  const key = Deno.env.get('GOOGLE_BOOKS_KEY');
  if (key && new URL(url).hostname === 'www.googleapis.com') headers['X-Goog-Api-Key'] = key;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  // Open Library answers /isbn/… with a redirect to /books/…; the final URL must still be allowed.
  if (res.url && !isAllowedFetchUrl(res.url)) {
    await res.body?.cancel();
    throw new Error('upstream redirected off the allow-list');
  }
  if (res.status === 404) {
    await res.body?.cancel();
    return null;
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`upstream status ${res.status} from ${new URL(url).hostname}`);
  }
  return await res.json();
};

// ---------------------------------------------------------------------------
// Catalog writes and response shape
// ---------------------------------------------------------------------------

function shape(row: Record<string, unknown>) {
  return {
    isbn13: row.isbn13, isbn10: row.isbn10, title: row.title, subtitle: row.subtitle,
    authors: row.authors ?? [], publisher: row.publisher, publishedYear: row.published_year,
    edition: row.edition, genres: row.genres ?? [], pageCount: row.page_count,
    // Rows cached before the URL allow-list existed are filtered on the way out too.
    coverUrl: safeCoverUrl(row.cover_url), description: row.description, workKey: row.work_key, source: row.source,
  };
}

async function cacheRow(admin: Admin, meta: SourceBook, reqId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin
    .from('books')
    .upsert(
      {
        isbn13: meta.isbn13, isbn10: meta.isbn10,
        title: meta.title, subtitle: meta.subtitle, authors: meta.authors,
        publisher: meta.publisher, published_year: meta.publishedYear, edition: meta.edition,
        genres: meta.genres, page_count: meta.pageCount, cover_url: meta.coverUrl,
        description: meta.description, work_key: meta.workKey, source: meta.source,
      },
      { onConflict: 'isbn13' },
    )
    .select()
    .single();
  if (error) log(reqId, 'books_upsert_failed');
  return data ?? null;
}

async function cache(admin: Admin, meta: SourceBook, reqId: string) {
  const row = await cacheRow(admin, meta, reqId);
  return row ? shape(row) : meta;
}

async function recordMiss(admin: Admin, isbn13: string, reqId: string) {
  const { error } = await admin
    .from('lookup_misses')
    .upsert({ isbn13, checked_at: new Date().toISOString() }, { onConflict: 'isbn13' });
  if (error) log(reqId, 'lookup_misses_upsert_failed');
  // Expired misses are useless (they get re-checked anyway), so sweep them now and then.
  if (Math.random() < 0.02) {
    const cutoff = new Date(Date.now() - MISS_TTL_DAYS * 86_400_000).toISOString();
    const { error: sweepErr } = await admin.from('lookup_misses').delete().lt('checked_at', cutoff);
    if (sweepErr) log(reqId, 'lookup_misses_sweep_failed');
  }
}

// ---------------------------------------------------------------------------
// Sync: ensure (spec §6.4)
// ---------------------------------------------------------------------------

function adminClient(): Admin {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function bookIdFor(admin: Admin, isbn13: string): Promise<string | null> {
  const { data, error } = await admin.from('books').select('id').eq('isbn13', isbn13).maybeSingle();
  if (error) throw new Error(`books read failed: ${error.message}`);
  return data ? String(data.id) : null;
}

/**
 * Returns the catalog id for an ISBN, creating the row if needed: a real lookup when a source knows it,
 * else a bare placeholder (service role only; clients never insert into books, F16).
 */
async function ensureBook(req: Request, isbn13: string, reqId: string): Promise<Response> {
  const admin = adminClient();
  const caller = await identifyCaller(req, admin);
  if (caller.anonymous) return json({ error: 'sign_in_required' }, 401);
  // Its own bucket (I4): a first backup's ensures never use up the scans' CALLER_LIMIT.
  const bucket = ensureBucket(caller.bucket);
  const limit = await hit(admin, bucket, ENSURE_LIMITS.minute.windowSeconds, ENSURE_LIMITS.minute.max).catch(() => {
    log(reqId, 'rate_limiter_unavailable_ensure');
    return null;
  });
  if (!limit) return json({ error: 'lookup_unavailable' }, 503, { 'Retry-After': String(UNAVAILABLE_RETRY_SEC) });
  if (!limit.allowed) return tooMany(limit.retryAfter);

  const existing = await bookIdFor(admin, isbn13);
  if (existing) return json({ id: existing });

  // Only an ensure that may create a row (upstream calls, a placeholder) counts against the daily cap.
  const daily = await hit(admin, bucket, ENSURE_LIMITS.day.windowSeconds, ENSURE_LIMITS.day.max).catch(() => {
    log(reqId, 'rate_limiter_unavailable_ensure_daily');
    return null;
  });
  if (!daily) return json({ error: 'lookup_unavailable' }, 503, { 'Retry-After': String(UNAVAILABLE_RETRY_SEC) });
  if (!daily.allowed) return tooMany(daily.retryAfter);

  let found: SourceBook | null = null;
  for (const run of [lookupGoogleBooks, lookupOpenLibrary]) {
    try {
      found = await run(isbn13, fetchJson);
    } catch {
      log(reqId, 'upstream_lookup_failed_ensure');
    }
    if (found) break;
  }
  if (found) {
    const row = await cacheRow(admin, found, reqId);
    if (row?.id) return json({ id: String(row.id) });
  }

  const { error } = await admin.from('books').upsert(placeholderBook(isbn13), { onConflict: 'isbn13', ignoreDuplicates: true });
  if (error) throw new Error(`placeholder insert failed: ${error.message}`);
  const id = await bookIdFor(admin, isbn13);
  if (!id) throw new Error('placeholder row missing');
  return json({ id });
}

// ---------------------------------------------------------------------------
// Responses and logging
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  });
}

/** Only a request id and a fixed outcome word — never an error message, ISBN, IP or payload. */
function log(reqId: string, outcome: string) {
  console.error(JSON.stringify({ fn: 'book-lookup', reqId, outcome }));
}
