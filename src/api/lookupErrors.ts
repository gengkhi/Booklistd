/**
 * How the app reads a failed book-lookup call. Kept free of supabase-js imports so it
 * can be unit tested; the invoke error's `context` is the fetch Response.
 */

/** The lookup service is throttling us: temporary, not "not found". */
export class LookupRateLimitedError extends Error {
  readonly retryAfterSec: number;
  constructor(retryAfterSec: number) {
    super('book lookup rate limited');
    this.name = 'LookupRateLimitedError';
    this.retryAfterSec = retryAfterSec;
  }
}

export function isRateLimited(e: unknown): e is LookupRateLimitedError {
  return e instanceof LookupRateLimitedError;
}

export type InvokeFailure =
  | { kind: 'rate_limited'; retryAfterSec: number }
  | { kind: 'invalid' } // 400/413: the server will never accept this request
  | { kind: 'not_found' } // 404: both catalogs were asked and neither has it
  | { kind: 'other' }; // network, timeout, 5xx: worth trying the direct sources

const DEFAULT_RETRY_SEC = 60;

export function classifyInvokeError(error: unknown): InvokeFailure {
  const ctx = (error as { context?: unknown } | null)?.context as
    | { status?: unknown; headers?: { get?: (name: string) => string | null } }
    | undefined;
  const status = typeof ctx?.status === 'number' ? ctx.status : null;
  if (status === 429) {
    const raw = typeof ctx?.headers?.get === 'function' ? ctx.headers.get('Retry-After') : null;
    const n = raw != null ? Number(raw) : NaN;
    return { kind: 'rate_limited', retryAfterSec: Number.isFinite(n) && n > 0 ? Math.min(Math.ceil(n), 3600) : DEFAULT_RETRY_SEC };
  }
  if (status === 400 || status === 413) return { kind: 'invalid' };
  if (status === 404) return { kind: 'not_found' };
  return { kind: 'other' };
}

/** Friendly copy for the throttled state, shared by Store Mode and Search. */
export function rateLimitedMessage(retryAfterSec: number, canAddDetails = true): string {
  const wait = retryAfterSec <= 90 ? 'a minute' : `${Math.ceil(retryAfterSec / 60)} minutes`;
  const tail = canAddDetails ? ', or add the details yourself.' : '.';
  return `Lots of lookups just now, so the catalog asked us to slow down. Try this one again in ${wait}${tail}`;
}
