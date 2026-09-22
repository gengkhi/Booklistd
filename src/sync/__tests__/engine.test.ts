const mockGetSession = jest.fn(async () => ({ data: { session: null }, error: null }));
jest.mock('@/api/supabase', () => ({ supabase: { auth: { getSession: () => mockGetSession() } } }));

import { AppState, type AppStateStatus } from 'react-native';
import { bindOwner } from '@/auth/ownership';
import { useSession } from '@/auth/session';
import * as localData from '@/db/localData';
import { addUserBook, createShelf, upsertBook } from '@/db/repository';
import { asClient, FakeSupabase } from '@/test/fakeSupabase';
import { bookMeta } from '@/test/fixtures';
import { freshDb } from '@/test/testDb';
import { SyncRetryable } from '../client';
import { DEBOUNCE_MS, settleSync, startSync, stopTimers, syncNow, type SyncDeps } from '../engine';
import { statusLine, useSyncStatus } from '../status';

let fake: FakeSupabase;
beforeEach(async () => {
  await freshDb();
  fake = new FakeSupabase();
  fake.userId = 'u1';
  useSyncStatus.setState({ state: 'idle', lastSyncedAt: null, pending: 0, rejected: 0 });
  useSession.setState({ status: 'signedIn' });
  mockGetSession.mockClear();
});
afterEach(() => {
  stopTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});
const fakeTimers = () => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
const macrotasks = async (n: number) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const deps = (over: Partial<SyncDeps> = {}): SyncDeps => ({ client: asClient(fake), getUserId: async () => fake.userId, ...over });

it('runs one at a time; requests during a run collapse into one follow-up', async () => {
  let runs = 0;
  const d = deps({ getUserId: async () => { runs++; await new Promise((r) => setTimeout(r, 5)); return null; } });
  await Promise.all([syncNow(d), syncNow(d), syncNow(d)]);
  expect(runs).toBe(2);
});

it('never pushes under a session that does not own this library', async () => {
  bindOwner('u1');
  createShelf('Study');
  fake.userId = 'u2';
  await syncNow(deps());
  expect(fake.upserts).toEqual([]);
  expect(useSyncStatus.getState().state).toBe('signedOut');
});

it('aborts the run when the owner changes mid-run (H1): no further chunks or pages, no retry', async () => {
  bindOwner('u1');
  createShelf('Study');
  const real = localData.getOwner;
  let calls = 0;
  // The run's own check sees u1; the next (the first push chunk's guard) sees a new owner, as after a wipe.
  jest.spyOn(localData, 'getOwner').mockImplementation(() => (++calls === 1 ? real() : 'u2'));
  await syncNow(deps());
  expect(fake.upserts).toEqual([]);
  expect(fake.rows('shelves')).toEqual([]);
  expect(useSyncStatus.getState().state).toBe('signedOut');
});

it('a full run backs up, pulls, and reports idle', async () => {
  bindOwner('u1');
  createShelf('Study');
  const onPulled = jest.fn();
  await syncNow(deps({ onPulled }));
  expect(fake.rows('shelves')).toHaveLength(1);
  expect(useSyncStatus.getState()).toMatchObject({ state: 'idle', pending: 0, rejected: 0 });
  expect(useSyncStatus.getState().lastSyncedAt).not.toBeNull();
  expect(onPulled).toHaveBeenCalled();
});

it('offline shows as offline and keeps the change waiting', async () => {
  bindOwner('u1');
  createShelf('Study');
  fake.failNext('shelves', 0);
  await syncNow(deps());
  expect(useSyncStatus.getState()).toMatchObject({ state: 'offline', pending: 1 });
});

it('a 5xx shows as an error', async () => {
  bindOwner('u1');
  createShelf('Study');
  fake.failNext('shelves', 503);
  await syncNow(deps());
  expect(useSyncStatus.getState().state).toBe('error');
});

it('no connection while checking the session is offline, not signed out', async () => {
  bindOwner('u1');
  await syncNow(deps({ getUserId: async () => { throw new SyncRetryable(0); } }));
  expect(useSyncStatus.getState().state).toBe('offline');
});

it('an expired session pauses sync: nothing is sent and the line asks to sign in again', async () => {
  bindOwner('u1');
  createShelf('Study');
  useSession.setState({ status: 'expired' });
  await syncNow(deps());
  expect(fake.upserts).toEqual([]);
  expect(statusLine(useSyncStatus.getState(), Date.now())).toBe('Sign in again to back up');
});

it('F5: held-back rows (throttled ensure) show as waiting and retry after a 5s backoff, not at once', async () => {
  bindOwner('u1');
  const book = upsertBook(bookMeta());
  addUserBook(book.id, 'owned', null);
  fake.failEnsure(429);
  fakeTimers();
  const d = deps();
  await syncNow(d);
  expect(fake.rows('user_books')).toHaveLength(0);
  expect(statusLine(useSyncStatus.getState(), Date.now())).toBe('1 change waiting');

  await jest.advanceTimersByTimeAsync(4_999);
  expect(fake.ensured).toHaveLength(0);
  await jest.advanceTimersByTimeAsync(1);
  await settleSync(); // the backoff retry is the run in flight
  expect(fake.rows('user_books')).toHaveLength(1);
  expect(useSyncStatus.getState()).toMatchObject({ state: 'idle', pending: 0 });
});

it('F9: a write is counted when the 2s debounce fires, not on every enqueue', async () => {
  bindOwner('u1');
  fakeTimers();
  const stop = startSync();
  try {
    createShelf('Study');
    expect(useSyncStatus.getState().pending).toBe(0);
    await jest.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await settleSync();
    expect(useSyncStatus.getState().pending).toBe(1);
  } finally {
    stop();
  }
});

it('settleSync stops timers and waits out the run in flight', async () => {
  bindOwner('u1');
  createShelf('Study');
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const run = syncNow(deps({ getUserId: async () => { await gate; return 'u1'; } }));
  let settled = false;
  const s = settleSync().then(() => { settled = true; });
  await macrotasks(5);
  expect(settled).toBe(false);
  release();
  await Promise.all([run, s]);
  expect(settled).toBe(true);
  expect(fake.rows('shelves')).toHaveLength(1);
});

it('a run that fails after settle has begun leaves no retry armed', async () => {
  bindOwner('u1');
  fakeTimers();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const run = syncNow(deps({ getUserId: async () => { await gate; throw new SyncRetryable(0); } }));
  const s = settleSync();
  release();
  await Promise.all([run, s]);
  expect(useSyncStatus.getState().state).toBe('offline');
  expect(jest.getTimerCount()).toBe(0);
});

it('a SQLite error while counting never makes a run or settle reject', async () => {
  bindOwner('u1');
  jest.spyOn(localData, 'rejectedCount').mockImplementation(() => { throw new Error('disk I/O error'); });
  await expect(syncNow(deps())).resolves.toBeUndefined();
  await expect(settleSync()).resolves.toBeUndefined();
});

it('backs off 5s → 10s → 20s → … and caps at 5 min', async () => {
  bindOwner('u1');
  fakeTimers();
  let runs = 0;
  await syncNow(deps({ getUserId: async () => { runs++; throw new SyncRetryable(0); } }));
  expect(runs).toBe(1);
  for (const gap of [5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000]) {
    const before = runs;
    await jest.advanceTimersByTimeAsync(gap - 1);
    expect(runs).toBe(before);
    await jest.advanceTimersByTimeAsync(1);
    expect(runs).toBe(before + 1);
  }
});

describe('startSync triggers', () => {
  let appHandler: ((s: AppStateStatus) => void) | null;
  let appRemove: jest.Mock;
  beforeEach(() => {
    appHandler = null;
    appRemove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      appHandler = handler as (s: AppStateStatus) => void;
      return { remove: appRemove } as never;
    });
    useSession.setState({ status: 'signedOut' });
    bindOwner('u1');
    fakeTimers();
  });

  it('coming to the foreground starts a run; going to the background does not', async () => {
    const stop = startSync();
    try {
      appHandler!('background');
      await jest.advanceTimersByTimeAsync(DEBOUNCE_MS);
      expect(mockGetSession).not.toHaveBeenCalled();
      appHandler!('active');
      await jest.advanceTimersByTimeAsync(0);
      await settleSync();
      expect(mockGetSession).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it('signing in starts a run', async () => {
    const stop = startSync();
    try {
      useSession.setState({ status: 'signedIn' });
      await jest.advanceTimersByTimeAsync(0);
      await settleSync();
      expect(mockGetSession).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it('cleanup removes the AppState listener, the session subscription and the enqueue hook', async () => {
    startSync()();
    expect(appRemove).toHaveBeenCalledTimes(1);
    useSession.setState({ status: 'signedIn' });
    createShelf('Study');
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(mockGetSession).not.toHaveBeenCalled();
  });
});

it('a run still in flight when startSync is cleaned up cannot arm a retry', async () => {
  bindOwner('u1');
  fakeTimers();
  const stop = startSync();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const run = syncNow(deps({ getUserId: async () => { await gate; throw new SyncRetryable(0); } }));
  stop();
  release();
  await run;
  expect(jest.getTimerCount()).toBe(0);
});
