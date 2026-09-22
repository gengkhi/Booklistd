/**
 * Single-flight sync orchestrator (spec §6.1). No background tasks, no polling: runs come from a 2s
 * debounce after writes, the app coming to the foreground, and sign-in. Never logs rows or errors.
 */
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { supabase } from '@/api/supabase';
import { useSession } from '@/auth/session';
import { getOwner, rejectedCount } from '@/db/localData';
import { pendingCount, setOnEnqueue } from '@/db/pendingOps';
import { SyncAborted, SyncRetryable, type SyncClient } from './client';
import { uploadPendingCovers } from './covers';
import { backoffMs } from './logic';
import { pull, resetIfStale } from './pull';
import { push } from './push';
import { useSyncStatus } from './status';

export const DEBOUNCE_MS = 2000;

export interface SyncDeps {
  client: SyncClient;
  /** The signed-in user's id, or null when there's no usable session. Throws SyncRetryable(0) when offline. */
  getUserId: () => Promise<string | null>;
  /** Called after a run that changed local rows (the app refreshes its queries). */
  onPulled?: () => void;
}

const defaultDeps = (): SyncDeps => ({
  client: supabase,
  getUserId: async () => {
    const { data, error } = await supabase.auth.getSession();
    // A token that can't refresh for lack of a network is "offline", not "signed out".
    if (error && isAuthRetryableFetchError(error)) throw new SyncRetryable(0);
    return data.session?.user.id ?? null;
  },
});

let deps: SyncDeps | null = null;
let current: Promise<void> | null = null;
let followUp = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;
/** Bumped by stopTimers: a run that started before a stop (sign-out, delete, cleanup) can't arm a retry after it. */
let epoch = 0;

/** Best effort: a failed COUNT never fails a run, a sign-out or a delete. */
export function refreshCounts(): void {
  try {
    useSyncStatus.setState({ pending: pendingCount(), rejected: rejectedCount() });
  } catch {
    // The counts catch up on the next run.
  }
}

function clearRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

/** The next attempt, with backoff (5s → 10s → … → 5 min), never an immediate loop. */
function retryLater(use: SyncDeps, runEpoch: number) {
  if (runEpoch !== epoch) return;
  attempt += 1;
  clearRetry();
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void syncNow(use).catch(() => {});
  }, backoffMs(attempt));
}

async function runOnce(d: SyncDeps): Promise<void> {
  const runEpoch = epoch;
  const pause = (state: 'offline' | 'signedOut') => {
    useSyncStatus.setState({ state });
    // Offline retries with backoff; a session problem waits for sign-in (the session listener starts sync again).
    if (state === 'offline') retryLater(d, runEpoch);
    else clearRetry();
  };
  try {
    // Task 11 ruling: an expired session pauses sync until the person signs in again.
    if (useSession.getState().status === 'expired') return pause('signedOut');
    let userId: string | null = null;
    try {
      userId = await d.getUserId();
    } catch (e) {
      if (e instanceof SyncRetryable) return pause('offline');
    }
    // Only the library's owner ever pushes; signing in as someone else wipes first (spec §4).
    if (!userId || userId !== getOwner()) return pause('signedOut');

    // H1: re-checked before every push chunk and pull page; a sign-out, delete or other sign-in stops the run.
    const guard = () => {
      if (getOwner() !== userId) throw new SyncAborted();
    };
    useSyncStatus.setState({ state: 'syncing' });
    const pushed = await push(d.client, guard);
    // Photos upload after their book_edits rows have pushed (spec §6.7); the cover_object they queue triggers a
    // follow-up run. A storage outage backs off like any network failure but doesn't hold up the pull.
    let coversWaiting = false;
    try {
      await uploadPendingCovers(d.client, userId);
    } catch (e) {
      if (!(e instanceof SyncRetryable)) throw e;
      coversWaiting = true;
    }
    // Push first: a stale reset only happens with nothing waiting, and the pull then fills it back in.
    resetIfStale();
    const applied = await pull(d.client, Date.now(), guard);
    useSyncStatus.setState({ state: 'idle', lastSyncedAt: Date.now() });
    // F5: held-back rows (throttled or refused book, owed shelf adoption) stay queued and show as waiting.
    // Photos that couldn't upload retry the same way.
    if (pushed.skipped > 0 || coversWaiting) retryLater(d, runEpoch);
    else {
      attempt = 0;
      clearRetry();
    }
    // Push rewrites local ids too (book resolution, shelf adoption), so either side can change what screens show.
    if (applied > 0 || pushed.pushed > 0) d.onPulled?.();
  } catch (e) {
    // The library changed hands: nothing to retry for the old owner; the session listener starts the next run.
    if (e instanceof SyncAborted) return pause('signedOut');
    useSyncStatus.setState({ state: e instanceof SyncRetryable && e.status === 0 ? 'offline' : 'error' });
    retryLater(d, runEpoch);
  } finally {
    refreshCounts();
  }
}

/** One run at a time; any requests during a run schedule exactly one follow-up. Resolves when both are done. */
export function syncNow(override?: SyncDeps): Promise<void> {
  const use = override ?? deps ?? defaultDeps();
  if (current) {
    followUp = true;
    return current;
  }
  current = (async () => {
    try {
      do {
        followUp = false;
        await runOnce(use);
      } while (followUp);
    } finally {
      current = null;
    }
  })();
  return current;
}

export function requestSync(delayMs: number = DEBOUNCE_MS): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    // F9: counted once per debounce, not on every write.
    try {
      useSyncStatus.setState({ pending: pendingCount() });
    } catch {
      // The run recounts at its end.
    }
    void syncNow().catch(() => {});
  }, delayMs);
}

/** Cancels scheduled runs and forgets the backoff; a run already in flight can't schedule another. */
export function stopTimers(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  clearRetry();
  attempt = 0;
  epoch += 1;
}

/**
 * Sign-out and delete account: cancel scheduled runs and wait out the one in flight, so nothing it pulls lands
 * after the wipe. Never rejects. Timers armed while waiting (a follow-up's retry) are cancelled at the end.
 */
export async function settleSync(): Promise<void> {
  stopTimers();
  followUp = false;
  try {
    await current;
  } catch {
    // Whatever didn't sync is counted by the caller.
  }
  stopTimers();
}

/** Call once from the root layout. Returns a cleanup. */
export function startSync(options: { onPulled?: () => void } = {}): () => void {
  deps = { ...defaultDeps(), onPulled: options.onPulled };
  setOnEnqueue(() => requestSync());
  const app = AppState.addEventListener('change', (s) => {
    if (s === 'active') requestSync(0);
  });
  const unsubscribe = useSession.subscribe((s, prev) => {
    if (s.status === 'signedIn' && prev.status !== 'signedIn') requestSync(0);
    if (s.status === 'expired') useSyncStatus.setState({ state: 'signedOut' });
  });
  const status = useSession.getState().status;
  if (status === 'signedIn') requestSync(0);
  if (status === 'expired') useSyncStatus.setState({ state: 'signedOut' });
  refreshCounts();
  return () => {
    setOnEnqueue(null);
    app.remove();
    unsubscribe();
    stopTimers();
    deps = null;
  };
}
