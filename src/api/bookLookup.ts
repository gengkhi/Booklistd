/**
 * Metadata pipeline. Production path: Supabase Edge Function (book-lookup),
 * which runs the Google Books -> Open Library waterfall server-side and caches
 * into the shared public.books catalog. Dev fallback: hit the sources directly
 * so the app works before Supabase is configured.
 *
 * Parsing, URL checks and work keys come from the same shared core the edge function
 * uses (supabase/functions/_shared/bookCore.ts), so both paths produce identical rows.
 */
import {
  isAllowedFetchUrl,
  lookupGoogleBooks,
  lookupOpenLibrary,
  type FetchJson,
} from '../../supabase/functions/_shared/bookCore';
import type { Book } from '@/lib/types';
import { classifyInvokeError, LookupRateLimitedError } from './lookupErrors';
import { supabase, supabaseConfigured } from './supabase';

export type BookMeta = Omit<Book, 'id'>;
export { isRateLimited, LookupRateLimitedError } from './lookupErrors';

/** Store Mode waits on this, so a dead connection must fail fast instead of spinning forever. */
const TIMEOUT_MS = 8000;

const getJson: FetchJson = async (url) => {
  if (!isAllowedFetchUrl(url)) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res.ok ? await res.json() : null;
  } finally {
    clearTimeout(t);
  }
};

/**
 * Resolves the book, or null when no catalog has it.
 * Throws LookupRateLimitedError when the lookup service is throttling this device: that
 * is a temporary failure, and callers should say so rather than show "not found".
 */
export async function lookupIsbn(isbn13: string): Promise<BookMeta | null> {
  if (supabaseConfigured) {
    let failure: ReturnType<typeof classifyInvokeError> | null = null;
    try {
      const { data, error } = await supabase.functions.invoke<BookMeta>('book-lookup', {
        body: { isbn: isbn13 },
        timeout: TIMEOUT_MS,
      });
      if (!error && data?.title) return data;
      if (error) failure = classifyInvokeError(error);
    } catch {
      // network-level failure: fall through to direct sources
    }
    if (failure?.kind === 'rate_limited') throw new LookupRateLimitedError(failure.retryAfterSec);
    // The server already asked both catalogs (not_found) or will never accept this ISBN (invalid).
    if (failure?.kind === 'not_found' || failure?.kind === 'invalid') return null;
  }
  return (await direct(() => lookupGoogleBooks(isbn13, getJson))) ?? (await direct(() => lookupOpenLibrary(isbn13, getJson)));
}

async function direct(run: () => Promise<BookMeta | null>): Promise<BookMeta | null> {
  try {
    return await run();
  } catch {
    return null;
  }
}
