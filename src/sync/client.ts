import type { SupabaseClient } from '@supabase/supabase-js';

/** The slice of supabase-js the engine uses; tests pass src/test/fakeSupabase.ts instead. */
export type SyncClient = Pick<SupabaseClient, 'from' | 'functions' | 'storage'>;

/** A failure worth retrying with backoff: offline (status 0), timeout, throttling or 5xx. */
export class SyncRetryable extends Error {
  constructor(readonly status: number) {
    super(`sync paused (${status})`);
    this.name = 'SyncRetryable';
  }
}

/** The library changed hands mid-run (sign-out, delete, a different sign-in wiped it): stop at once (H1). */
export class SyncAborted extends Error {
  constructor() {
    super('sync aborted: owner changed');
    this.name = 'SyncAborted';
  }
}

/** Throws SyncAborted when the run must stop; checked before each push chunk and each pull page. */
export type RunGuard = () => void;

/** HTTP status carried by a functions.invoke error (FunctionsHttpError holds the Response as context). 0 = no response. */
export function statusOf(error: unknown): number {
  const s = (error as { context?: { status?: unknown } } | null)?.context?.status;
  return typeof s === 'number' ? s : 0;
}
