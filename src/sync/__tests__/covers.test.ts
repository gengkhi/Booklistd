jest.mock('@/api/supabase', () => ({ supabase: {} }));
const mockBytes = jest.fn(async () => new Uint8Array([1, 2, 3]));
const mockDownload = jest.fn(async (_url: string, dest: unknown) => dest);
jest.mock('expo-file-system', () => {
  const join = (parts: unknown[]) => parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
  class File {
    uri: string;
    exists = true;
    constructor(...parts: unknown[]) { this.uri = join(parts); }
    static downloadFileAsync = (url: string, dest: unknown) => mockDownload(url, dest);
    bytes() { return mockBytes(); }
    delete() {}
    copySync() {}
    moveSync() {}
  }
  class Directory {
    uri: string;
    exists = true;
    constructor(...parts: unknown[]) { this.uri = join(parts); }
    create() {}
    delete() {}
  }
  return { File, Directory, Paths: { document: { uri: 'file:///docs' }, cache: { uri: 'file:///cache' } } };
});
jest.mock('@/features/bookEdits/coverFiles', () => ({
  ...jest.requireActual('@/features/bookEdits/coverFiles'),
  saveCoverFile: jest.fn(async (bookId: string) => `covers/${bookId}-1.jpg`),
}));

import { getBook, setBookCover, upsertBook } from '@/db/repository';
import { asClient, FakeSupabase } from '@/test/fakeSupabase';
import { bookMeta } from '@/test/fixtures';
import { freshDb } from '@/test/testDb';
import { bindOwner } from '@/auth/ownership';
import { getMeta, rejectedCount, setMeta } from '@/db/localData';
import { useSession } from '@/auth/session';
import { SyncRetryable, type SyncClient } from '../client';
import { discardedCoverKey, serializeCursor, STALE_AFTER_MS } from '../logic';
import { pull, resetIfStale } from '../pull';
import { coverObjectPath, ensureLocal, uploadPendingCovers } from '../covers';
import { stopTimers, syncNow } from '../engine';
import { useSyncStatus } from '../status';

let db: Awaited<ReturnType<typeof freshDb>>;
let fake: FakeSupabase;
beforeEach(async () => {
  db = await freshDb();
  fake = new FakeSupabase();
  fake.userId = 'u1';
  jest.clearAllMocks();
});
afterEach(() => {
  stopTimers();
  jest.useRealTimers();
});
const AT = () => 1726963200000;

async function bookWithPhoto() {
  const b = upsertBook(bookMeta());
  await setBookCover(b.id, 'file:///picked.jpg');
  db.runSync('UPDATE books SET server_known = 1');
  return b;
}

it('waits until the book_edits row has pushed', async () => {
  await bookWithPhoto();
  expect(await uploadPendingCovers(asClient(fake), 'u1', AT)).toBe(0);
  expect(fake.objects.size).toBe(0);
});

it('uploads to covers/<uid>/<book>-<ms>.jpg, then queues cover_object to push', async () => {
  const b = await bookWithPhoto();
  db.execSync('DELETE FROM pending_ops');
  expect(await uploadPendingCovers(asClient(fake), 'u1', AT)).toBe(1);
  const path = `u1/${b.id}-1726963200000.jpg`;
  expect([...fake.objects.keys()]).toEqual([path]);
  const op = db.getFirstSync<{ payload: string }>("SELECT payload FROM pending_ops WHERE table_name = 'book_edits'");
  expect(JSON.parse(op!.payload).cover_object).toBe(path);
});

it('another phone shows the painted cover, then downloads the photo once when it is first shown', async () => {
  const b = upsertBook(bookMeta());
  db.runSync("UPDATE books SET cover_url = 'https://covers.openlibrary.org/b/id/1-L.jpg'");
  db.runSync('INSERT INTO book_edits (book_id, cover_object) VALUES (?, ?)', [b.id, `u1/${b.id}-1.jpg`]);
  fake.objects.set(`u1/${b.id}-1.jpg`, new Uint8Array([1]));
  expect(getBook(b.id)).toMatchObject({ coverPending: true, coverUrl: null });

  const [first, second] = await Promise.all([ensureLocal(b.id, asClient(fake)), ensureLocal(b.id, asClient(fake))]);
  expect(first).toMatch(/^covers\/.+\.jpg$/);
  expect(second).toBe(first);
  expect(mockDownload).toHaveBeenCalledTimes(1);
  expect(mockDownload.mock.calls[0][0]).toContain('expires=60');
  expect(getBook(b.id)!.coverPending).toBe(false);
});

it('has nothing to fetch when no photo is synced', async () => {
  const b = upsertBook(bookMeta());
  expect(await ensureLocal(b.id, asClient(fake))).toBeNull();
});

// Beyond the brief: the server CHECK shape, failure handling, and the engine wiring.
it('builds the exact path the server CHECK accepts (lowercase uuid text, 13-digit ms)', () => {
  const uid = 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';
  const book = '11111111-2222-4333-8444-555555555555';
  expect(coverObjectPath(uid, book, 1726963200000)).toBe(`${uid.toLowerCase()}/${book}-1726963200000.jpg`);
  expect(coverObjectPath(uid, book, 1726963200000)).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}-[0-9]{13}\.jpg$/);
});

it('a storage outage throws SyncRetryable and leaves the photo waiting', async () => {
  await bookWithPhoto();
  db.execSync('DELETE FROM pending_ops');
  const failing = { from: () => ({ upload: async () => ({ data: null, error: { message: 'down', status: 503 } }) }) };
  await expect(uploadPendingCovers({ ...asClient(fake), storage: failing } as unknown as SyncClient, 'u1', AT)).rejects.toBeInstanceOf(SyncRetryable);
  expect(db.getFirstSync('SELECT 1 FROM pending_ops')).toBeNull();
  expect(db.getFirstSync<{ cover_object: string | null }>('SELECT cover_object FROM book_edits')!.cover_object).toBeNull();
});

async function refusedPhoto() {
  const b = await bookWithPhoto();
  db.execSync('DELETE FROM pending_ops');
  fake.userId = 'someone-else'; // storage policy: only the owner's folder → 403
  expect(await uploadPendingCovers(asClient(fake), 'u1', AT)).toBe(0);
  fake.userId = 'u1';
  return b;
}

it('a refused upload (non-auth 4xx) is recorded as a covers reject and not retried every run', async () => {
  const b = await refusedPhoto();
  expect(db.getFirstSync('SELECT 1 FROM pending_ops')).toBeNull();
  const reject = db.getFirstSync<{ table_name: string; row_id: string; payload: string; error_code: string }>(
    'SELECT table_name, row_id, payload, error_code FROM sync_rejects'
  );
  expect(reject).toMatchObject({ table_name: 'covers', row_id: b.id, error_code: 'http_403' });
  expect(JSON.parse(reject!.payload)).toEqual({ book_id: b.id, cover_path: `covers/${b.id}-1.jpg` });
  expect(rejectedCount()).toBe(1);
  // The next run leaves it alone even though the bucket would now accept it.
  expect(await uploadPendingCovers(asClient(fake), 'u1', AT)).toBe(0);
  expect(fake.objects.size).toBe(0);
});

it('a new photo supersedes a refused one', async () => {
  const b = await refusedPhoto();
  await setBookCover(b.id, 'file:///again.jpg');
  expect(rejectedCount()).toBe(0);
});

// Task 17: Discard (src/sync/rejects.ts) marks a book's cover discarded instead of leaving a reject behind.
it('a discarded photo (Task 17) is never offered for upload, but a new photo supersedes the discard', async () => {
  const b = await bookWithPhoto();
  db.execSync('DELETE FROM pending_ops');
  setMeta(discardedCoverKey(b.id), '1');
  expect(await uploadPendingCovers(asClient(fake), 'u1', AT)).toBe(0);
  expect(fake.objects.size).toBe(0);

  await setBookCover(b.id, 'file:///again.jpg');
  expect(getMeta(discardedCoverKey(b.id))).toBeNull();
  db.execSync('DELETE FROM pending_ops'); // as if the book_edits row had already pushed
  expect(await uploadPendingCovers(asClient(fake), 'u1', AT)).toBe(1);
});

it('pull applies server changes to a row whose photo was refused', async () => {
  const b = await refusedPhoto();
  fake.seed('book_edits', { book_id: b.id, title: 'Server title', subtitle: null, authors: null, publisher: null, published_year: null, edition: null, cover_object: null });
  await pull(asClient(fake));
  expect(db.getFirstSync<{ title: string; cover_path: string }>('SELECT title, cover_path FROM book_edits WHERE book_id = ?', [b.id]))
    .toEqual({ title: 'Server title', cover_path: `covers/${b.id}-1.jpg` });
});

it('reset: a refused photo no longer counts as an unsaved photo, but as a refused change it still waits', async () => {
  await refusedPhoto();
  const now = Date.now();
  setMeta('pull:shelves', serializeCursor({ updatedAt: '2026-01-01T00:00:00+00:00', id: 'x', pulledAt: now - STALE_AFTER_MS - 1 }));
  // Blocked by rejectedCount() (Task 14 rule: a refused change waits on the person), which keeps the only copy of
  // the photo; Task 17's Try again / Discard resolves it.
  expect(resetIfStale(now)).toBe(false);
  expect(db.getFirstSync('SELECT 1 FROM book_edits WHERE cover_path IS NOT NULL')).not.toBeNull();
});

it('a photo replaced while it uploaded takes the uploaded object back', async () => {
  const b = await bookWithPhoto();
  db.execSync('DELETE FROM pending_ops');
  const bucket = fake.storage.from('covers');
  const racing = {
    from: () => ({
      ...bucket,
      upload: async (path: string, body: ArrayBuffer) => {
        const res = await bucket.upload(path, body);
        db.runSync("UPDATE book_edits SET cover_path = 'covers/newer.jpg' WHERE book_id = ?", [b.id]);
        return res;
      },
    }),
  };
  expect(await uploadPendingCovers({ ...asClient(fake), storage: racing } as unknown as SyncClient, 'u1', AT)).toBe(0);
  expect(fake.objects.size).toBe(0);
  expect(db.getFirstSync('SELECT 1 FROM pending_ops')).toBeNull();
});

it('a photo replaced while it downloaded is thrown away', async () => {
  const b = upsertBook(bookMeta());
  db.runSync('INSERT INTO book_edits (book_id, cover_object) VALUES (?, ?)', [b.id, `u1/${b.id}-1.jpg`]);
  fake.objects.set(`u1/${b.id}-1.jpg`, new Uint8Array([1]));
  mockDownload.mockImplementationOnce(async (_url: string, dest: unknown) => {
    db.runSync('UPDATE book_edits SET cover_object = ? WHERE book_id = ?', [`u1/${b.id}-2.jpg`, b.id]);
    return dest;
  });
  expect(await ensureLocal(b.id, asClient(fake))).toBeNull();
  expect(getBook(b.id)!.coverPending).toBe(true);
});

it('the engine uploads after push and still pulls when storage is down', async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  bindOwner('u1');
  useSession.setState({ status: 'signedIn' });
  const b = await bookWithPhoto();
  fake.tables.books.push({ id: b.id, isbn13: b.isbn13 });
  await syncNow({ client: asClient(fake), getUserId: async () => 'u1' });
  // First run: the edits row pushes, then its photo uploads and queues cover_object for the follow-up run.
  expect([...fake.objects.keys()]).toEqual([expect.stringMatching(new RegExp(`^u1/${b.id}-[0-9]{13}[.]jpg$`))]);
  await syncNow({ client: asClient(fake), getUserId: async () => 'u1' });
  expect(fake.rows('book_edits')[0].cover_object).toBe([...fake.objects.keys()][0]);
  expect(jest.getTimerCount()).toBe(0); // nothing left to retry

  // Storage down: the pull still lands.
  await setBookCover(b.id, 'file:///another.jpg');
  const shelf = fake.seed('shelves', { id: '99999999-9999-4999-8999-999999999999', name: 'Server', sort_order: 0, icon: null, plank: 'pool' });
  const down = { from: () => ({ upload: async () => ({ data: null, error: { message: 'down', status: 503 } }) }) };
  await syncNow({ client: { ...asClient(fake), from: fake.from.bind(fake), storage: down } as unknown as SyncClient, getUserId: async () => 'u1' });
  expect(db.getFirstSync('SELECT 1 FROM shelves WHERE id = ?', [shelf.id as string])).not.toBeNull();
  expect(useSyncStatus.getState().state).toBe('idle');
  expect(jest.getTimerCount()).toBe(1); // coversWaiting armed the backoff retry
});
