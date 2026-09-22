jest.mock('@/features/bookEdits/coverFiles', () => ({
  ...jest.requireActual('@/features/bookEdits/coverFiles'),
  renameCoverFile: jest.fn((_p: string, bookId: string) => `covers/${bookId}-2.jpg`),
  deleteCoverFile: jest.fn(),
}));

import { setMeta } from '@/db/localData';
import { addUserBook, saveBookEdit, setReadingState, upsertBook } from '@/db/repository';
import { deleteCoverFile } from '@/features/bookEdits/coverFiles';
import { asClient, FakeSupabase } from '@/test/fakeSupabase';
import { bookMeta } from '@/test/fixtures';
import { freshDb } from '@/test/testDb';
import { SyncRetryable } from '../client';
import { coalesce, discardedBookKey, type PendingOp } from '../logic';
import { resolveBooks, rewriteBookId } from '../resolveBooks';

const SERVER_ID = '0b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
let db: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => {
  db = await freshDb();
  jest.mocked(deleteCoverFile).mockClear();
});

function library() {
  const book = upsertBook(bookMeta());
  const copy = addUserBook(book.id, 'owned');
  setReadingState(book.id, 'reading', '2026-09-01');
  saveBookEdit(book.id, { title: 'Mine', subtitle: null, authors: null, publisher: null, publishedYear: null, edition: null });
  db.runSync("UPDATE book_edits SET cover_path = 'covers/old-1.jpg' WHERE book_id = ?", [book.id]);
  db.runSync(`INSERT INTO sync_rejects (op_id, table_name, row_id, op, payload, error_code) VALUES (1, 'readings', 'r', 'upsert', ?, '23514')`, [JSON.stringify({ book_id: book.id })]);
  return { book, copy };
}

/** A catalog row already on this phone, with its own (pulled) reading and edits. */
function catalogBookWithReading(readingUpdatedAt: string) {
  db.runSync("INSERT INTO books (id, isbn13, title, server_known) VALUES (?, NULL, 'Dune', 1)", [SERVER_ID]);
  db.runSync(
    "INSERT INTO readings (id, book_id, state, started_at, updated_at) VALUES ('server-reading', ?, 'read', '2025-01-01', ?)",
    [SERVER_ID, readingUpdatedAt]
  );
}

describe('rewriteBookId', () => {
  it('moves the book and every reference, queued payloads included, in one go', () => {
    const { book, copy } = library();
    rewriteBookId(book.id, SERVER_ID);
    expect(db.getFirstSync<{ id: string; server_known: number }>('SELECT id, server_known FROM books')).toEqual({ id: SERVER_ID, server_known: 1 });
    expect(db.getFirstSync<{ book_id: string }>('SELECT book_id FROM user_books WHERE id = ?', [copy.id])!.book_id).toBe(SERVER_ID);
    expect(db.getFirstSync<{ book_id: string }>('SELECT book_id FROM readings')!.book_id).toBe(SERVER_ID);
    expect(db.getFirstSync<{ book_id: string; cover_path: string }>('SELECT book_id, cover_path FROM book_edits')).toEqual({ book_id: SERVER_ID, cover_path: `covers/${SERVER_ID}-2.jpg` });
    const ops = db.getAllSync<{ table_name: string; row_id: string; payload: string }>('SELECT table_name, row_id, payload FROM pending_ops');
    expect(ops.map((o) => o.table_name).sort()).toEqual(['book_edits', 'readings', 'user_books']);
    for (const op of ops) {
      expect(JSON.parse(op.payload).book_id).toBe(SERVER_ID);
      if (op.table_name === 'book_edits') expect(op.row_id).toBe(SERVER_ID);
    }
    expect(JSON.parse(db.getFirstSync<{ payload: string }>('SELECT payload FROM sync_rejects')!.payload).book_id).toBe(SERVER_ID);
    expect(db.getAllSync('PRAGMA foreign_key_check')).toEqual([]);
  });

  it('a rewrite resolves the book, so its books reject and discard marker go (I5: e.g. a pull matched the ISBN)', () => {
    const { book } = library();
    db.runSync("INSERT INTO sync_rejects (op_id, table_name, row_id, op, payload, error_code) VALUES (0, 'books', ?, 'upsert', '{}', 'http_400')", [book.id]);
    setMeta(discardedBookKey(book.id), '1');
    rewriteBookId(book.id, SERVER_ID);
    expect(db.getAllSync("SELECT 1 FROM sync_rejects WHERE table_name = 'books'")).toEqual([]);
    expect(db.getFirstSync('SELECT 1 FROM sync_meta WHERE key = ?', [discardedBookKey(book.id)])).toBeNull();
  });

  it('merges into a catalog row that is already here', () => {
    const { book } = library();
    db.runSync("INSERT INTO books (id, isbn13, title, server_known) VALUES (?, NULL, 'Dune', 1)", [SERVER_ID]);
    rewriteBookId(book.id, SERVER_ID);
    expect(db.getAllSync<{ id: string }>('SELECT id FROM books').map((r) => r.id)).toEqual([SERVER_ID]);
    expect(db.getAllSync('PRAGMA foreign_key_check')).toEqual([]);
  });

  it('a merge leaves one reading per book, the newest, and queues only that one', () => {
    const { book } = library(); // local reading, updated just now
    catalogBookWithReading('2020-01-01 00:00:00');
    rewriteBookId(book.id, SERVER_ID);
    const readings = db.getAllSync<{ id: string; book_id: string; state: string; deleted_at: string | null }>('SELECT id, book_id, state, deleted_at FROM readings');
    expect(readings).toHaveLength(1);
    expect(readings[0]).toMatchObject({ book_id: SERVER_ID, state: 'reading', deleted_at: null });
    const { ops } = coalesce(db.getAllSync<PendingOp>('SELECT id, table_name, row_id, op, payload FROM pending_ops'));
    const queued = ops.filter((o) => o.table === 'readings');
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ rowId: readings[0].id, op: 'upsert', payload: { book_id: SERVER_ID, state: 'reading' } });
    expect(db.getAllSync('PRAGMA foreign_key_check')).toEqual([]);
  });

  it('a merge keeps the catalog reading when it is newer, and drops the local one from the queue', () => {
    const { book } = library();
    catalogBookWithReading('2999-01-01 00:00:00');
    rewriteBookId(book.id, SERVER_ID);
    const readings = db.getAllSync<{ id: string; state: string }>('SELECT id, state FROM readings');
    expect(readings).toEqual([{ id: 'server-reading', state: 'read' }]);
    const { ops } = coalesce(db.getAllSync<PendingOp>('SELECT id, table_name, row_id, op, payload FROM pending_ops'));
    const queued = ops.filter((o) => o.table === 'readings');
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ rowId: 'server-reading', payload: { book_id: SERVER_ID, state: 'read' } });
  });

  it('a merge keeps a live reading over a newer tombstone, and queues no delete', () => {
    const { book } = library();
    setReadingState(book.id, null); // local tombstone, updated just now
    catalogBookWithReading('2020-01-01 00:00:00');
    rewriteBookId(book.id, SERVER_ID);
    const readings = db.getAllSync<{ id: string; deleted_at: string | null }>('SELECT id, deleted_at FROM readings');
    expect(readings).toEqual([{ id: 'server-reading', deleted_at: null }]);
    const readingOps = db.getAllSync<{ row_id: string; op: string }>("SELECT row_id, op FROM pending_ops WHERE table_name = 'readings'");
    expect(readingOps).toEqual([{ row_id: 'server-reading', op: 'upsert' }]);
  });

  it('a merge keeps the catalog book_edits row and drops the local one, its queued ops and its photo', () => {
    const { book } = library();
    db.runSync("INSERT INTO books (id, isbn13, title, server_known) VALUES (?, NULL, 'Dune', 1)", [SERVER_ID]);
    db.runSync("INSERT INTO book_edits (book_id, title) VALUES (?, 'Theirs')", [SERVER_ID]);
    rewriteBookId(book.id, SERVER_ID);
    expect(db.getAllSync('SELECT book_id, title FROM book_edits')).toEqual([{ book_id: SERVER_ID, title: 'Theirs' }]);
    expect(db.getAllSync("SELECT id FROM pending_ops WHERE table_name = 'book_edits'")).toEqual([]);
    expect(deleteCoverFile).toHaveBeenCalledWith('covers/old-1.jpg');
  });
});

describe('resolveBooks', () => {
  it('asks ensure for each unknown book and rewrites to the catalog id', async () => {
    const { book } = library();
    const fake = new FakeSupabase();
    fake.userId = 'u1';
    const { resolved, failed, throttled } = await resolveBooks(asClient(fake), [book.id, book.id]);
    const serverId = fake.tables.books[0].id as string;
    expect(fake.ensured).toEqual(['9780441172719']);
    expect(resolved.get(book.id)).toBe(serverId);
    expect(failed.size).toBe(0);
    expect(throttled).toBe(false);
    expect(db.getFirstSync<{ id: string; server_known: number }>('SELECT id, server_known FROM books')).toEqual({ id: serverId, server_known: 1 });
  });

  it('skips books the server already knows', async () => {
    const { book } = library();
    db.runSync('UPDATE books SET server_known = 1');
    const fake = new FakeSupabase();
    fake.userId = 'u1';
    await resolveBooks(asClient(fake), [book.id]);
    expect(fake.ensured).toEqual([]);
  });

  it('a book with no ISBN is left for later', async () => {
    const book = upsertBook({ ...bookMeta(), isbn13: null });
    const fake = new FakeSupabase();
    fake.userId = 'u1';
    const { failed } = await resolveBooks(asClient(fake), [book.id]);
    expect([...failed]).toEqual([book.id]);
    expect(fake.ensured).toEqual([]);
  });

  it('a refused ISBN (non-429 4xx) is recorded as a books reject and its rows stay held, not fatal (I5)', async () => {
    const { book } = library();
    const fake = new FakeSupabase();
    fake.userId = 'u1';
    fake.failEnsure(400);
    const { failed, refused, throttled } = await resolveBooks(asClient(fake), [book.id]);
    expect([...failed]).toEqual([book.id]);
    expect([...refused]).toEqual([book.id]);
    expect(throttled).toBe(false);
    const rejects = db.getAllSync<{ table_name: string; row_id: string; payload: string; error_code: string }>(
      "SELECT table_name, row_id, payload, error_code FROM sync_rejects WHERE table_name = 'books'"
    );
    expect(rejects).toHaveLength(1);
    expect(rejects[0]).toMatchObject({ table_name: 'books', row_id: book.id, error_code: 'http_400' });
    expect(JSON.parse(rejects[0].payload)).toEqual({ book_id: book.id, isbn13: '9780441172719' });
  });

  it('a refused book is not asked about again while its reject waits on the person (I5)', async () => {
    const { book } = library();
    const fake = new FakeSupabase();
    fake.userId = 'u1';
    fake.failEnsure(400);
    await resolveBooks(asClient(fake), [book.id]);
    const again = await resolveBooks(asClient(fake), [book.id]);
    expect(fake.ensured).toEqual([]);
    expect([...again.refused]).toEqual([book.id]);
    expect(db.getAllSync("SELECT 1 FROM sync_rejects WHERE table_name = 'books'")).toHaveLength(1);
  });

  it('once the reject is dropped (Try again) the next run ensures the book again (I5)', async () => {
    const { book } = library();
    const fake = new FakeSupabase();
    fake.userId = 'u1';
    fake.failEnsure(400);
    await resolveBooks(asClient(fake), [book.id]);
    db.runSync("DELETE FROM sync_rejects WHERE table_name = 'books'");
    const { resolved, refused } = await resolveBooks(asClient(fake), [book.id]);
    expect(fake.ensured).toEqual(['9780441172719']);
    expect(resolved.size).toBe(1);
    expect(refused.size).toBe(0);
  });

  it('a discarded book is never ensured again and its rows stay held (I5)', async () => {
    const { book } = library();
    setMeta(discardedBookKey(book.id), '1');
    const fake = new FakeSupabase();
    fake.userId = 'u1';
    const { failed, refused } = await resolveBooks(asClient(fake), [book.id]);
    expect(fake.ensured).toEqual([]);
    expect([...failed]).toEqual([book.id]);
    expect([...refused]).toEqual([book.id]);
  });

  it('throttling (429) stops asking and leaves the rest queued for a backoff retry', async () => {
    const a = upsertBook(bookMeta({ isbn13: '9780441172719' }));
    const b = upsertBook(bookMeta({ isbn13: '9780547928227', title: 'The Hobbit' }));
    const fake = new FakeSupabase();
    fake.userId = 'u1';
    fake.failEnsure(429);
    const { resolved, failed, throttled } = await resolveBooks(asClient(fake), [a.id, b.id]);
    expect(throttled).toBe(true);
    expect(resolved.size).toBe(0);
    expect([...failed].sort()).toEqual([a.id, b.id].sort());
    expect(fake.ensured).toEqual([]);
  });

  it('offline or 5xx pauses the whole push', async () => {
    const { book } = library();
    const fake = new FakeSupabase();
    fake.userId = 'u1';
    fake.failEnsure(503);
    await expect(resolveBooks(asClient(fake), [book.id])).rejects.toBeInstanceOf(SyncRetryable);
  });

  it('an expired session (401) pauses rather than refusing the book', async () => {
    const { book } = library();
    const fake = new FakeSupabase();
    fake.userId = 'u1';
    fake.failEnsure(401);
    await expect(resolveBooks(asClient(fake), [book.id])).rejects.toMatchObject({ name: 'SyncRetryable', status: 401 });
  });
});
