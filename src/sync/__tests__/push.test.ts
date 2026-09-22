import { ADOPT_SHELVES_KEY, getMeta, setMeta } from '@/db/localData';
import { enqueueOp } from '@/db/pendingOps';
import { addUserBook, createShelf, renameShelf, setReadingState, upsertBook } from '@/db/repository';
import { asClient, FakeSupabase } from '@/test/fakeSupabase';
import { bookMeta } from '@/test/fixtures';
import { freshDb } from '@/test/testDb';
import { SyncAborted, SyncRetryable } from '../client';
import { push } from '../push';

let db: Awaited<ReturnType<typeof freshDb>>;
let fake: FakeSupabase;
beforeEach(async () => {
  db = await freshDb();
  fake = new FakeSupabase();
  fake.userId = 'u1';
});
const pending = () => db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM pending_ops')!.n;
function library() {
  const shelf = createShelf('Study');
  const book = upsertBook(bookMeta());
  const copy = addUserBook(book.id, 'owned', shelf.id);
  setReadingState(book.id, 'reading', '2026-09-01');
  return { shelf, book, copy };
}
function lendCopy(copyId: string, loanId = 'loan-1') {
  db.runSync("INSERT INTO loans (id, user_book_id, borrower_name, loaned_at) VALUES (?, ?, 'Ada', '2026-09-01 10:00:00')", [loanId, copyId]);
  enqueueOp('loans', loanId, 'upsert', db.getFirstSync('SELECT * FROM loans WHERE id = ?', [loanId]));
}

it('pushes parents first, never sends server-owned columns, and clears the queue', async () => {
  library();
  // The fake answers 400 test_forbidden_column if a payload carries user_id or updated_at.
  expect(await push(asClient(fake))).toEqual({ pushed: 3, rejected: 0, skipped: 0 });
  expect(fake.upserts.map((u) => u.table)).toEqual(['shelves', 'user_books', 'readings']);
  expect(pending()).toBe(0);
});

it('resolves books to catalog ids before pushing the rows that point at them', async () => {
  const { copy } = library();
  await push(asClient(fake));
  const catalogId = fake.tables.books[0].id;
  expect(fake.rows('user_books')[0]).toMatchObject({ id: copy.id, book_id: catalogId, user_id: 'u1' });
  expect(fake.rows('readings')[0].book_id).toBe(catalogId);
});

it('sends only the latest snapshot of a row', async () => {
  const shelf = createShelf('Study');
  renameShelf(shelf.id, 'Office');
  await push(asClient(fake));
  expect(fake.upserts[0].rows).toHaveLength(1);
  expect(fake.rows('shelves')[0].name).toBe('Office');
});

it('keeps ops written while the push was running', async () => {
  const shelf = createShelf('Study');
  fake.onUpsert = () => {
    fake.onUpsert = null;
    renameShelf(shelf.id, 'Office');
  };
  await push(asClient(fake));
  expect(db.getAllSync<{ payload: string }>('SELECT payload FROM pending_ops').map((o) => JSON.parse(o.payload).name)).toEqual(['Office']);
});

it('stops on a network error or 5xx and keeps everything queued', async () => {
  library();
  fake.failNext('shelves', 503);
  await expect(push(asClient(fake))).rejects.toBeInstanceOf(SyncRetryable);
  expect(pending()).toBe(3);
});

it('treats a 401 as an auth pause, not a refused row', async () => {
  createShelf('Study');
  fake.failNext('shelves', 401);
  await expect(push(asClient(fake))).rejects.toBeInstanceOf(SyncRetryable);
  expect(pending()).toBe(1);
  expect(db.getAllSync('SELECT * FROM sync_rejects')).toEqual([]);
});

it('moves a refused row to sync_rejects and carries on with the rest', async () => {
  const a = createShelf('Study');
  const b = createShelf('Hall');
  fake.reject('shelves', (r) => r.id === b.id, 400, '23514');
  expect(await push(asClient(fake))).toMatchObject({ pushed: 1, rejected: 1 });
  expect(fake.rows('shelves').map((s) => s.id)).toEqual([a.id]);
  expect(db.getAllSync('SELECT row_id, error_code FROM sync_rejects')).toEqual([{ row_id: b.id, error_code: '23514' }]);
  expect(pending()).toBe(0);
});

it('a successful push of a row clears any earlier reject left over for that same row (Task 17 review)', async () => {
  const shelf = createShelf('Study');
  // A stale reject from an earlier refusal (e.g. the name was too long then); it's since been fixed (renamed
  // to something short) and is about to push cleanly, but nothing has told the old reject that yet.
  db.runSync(
    "INSERT INTO sync_rejects (op_id, table_name, row_id, op, payload, error_code) VALUES (0, 'shelves', ?, 'upsert', '{}', '23514')",
    [shelf.id]
  );
  expect(await push(asClient(fake))).toMatchObject({ pushed: 1, rejected: 0 });
  expect(db.getAllSync('SELECT 1 FROM sync_rejects')).toEqual([]);
});

it('holds rows for a book the server refused and shows it as a books reject, without a backoff retry (I5)', async () => {
  const { book } = library();
  fake.failEnsure(400);
  expect(await push(asClient(fake))).toMatchObject({ pushed: 1, rejected: 0, skipped: 0 });
  expect(pending()).toBe(2);
  expect(db.getAllSync<{ table_name: string; row_id: string }>('SELECT table_name, row_id FROM sync_rejects')).toEqual([{ table_name: 'books', row_id: book.id }]);
});

it('also holds back loans on a copy whose book the server refused', async () => {
  const { book, copy } = library();
  lendCopy(copy.id);
  fake.failEnsure(400);
  expect(await push(asClient(fake))).toEqual({ pushed: 1, rejected: 0, skipped: 0 });
  expect(fake.upserts.map((u) => u.table)).toEqual(['shelves']);
  expect(db.getAllSync<{ table_name: string; row_id: string }>('SELECT table_name, row_id FROM sync_rejects')).toEqual([{ table_name: 'books', row_id: book.id }]);
  expect(pending()).toBe(3);
});

it('a throttled ensure (429) still holds rows for a backoff retry, with no reject (F5)', async () => {
  library();
  fake.failEnsure(429);
  expect(await push(asClient(fake))).toMatchObject({ pushed: 1, rejected: 0, skipped: 2 });
  expect(db.getAllSync('SELECT 1 FROM sync_rejects')).toEqual([]);
});

it('pushes loans after the copies they belong to', async () => {
  const { copy } = library();
  lendCopy(copy.id);
  expect(await push(asClient(fake))).toEqual({ pushed: 4, rejected: 0, skipped: 0 });
  expect(fake.upserts.map((u) => u.table)).toEqual(['shelves', 'user_books', 'readings', 'loans']);
  expect(fake.rows('loans')[0]).toMatchObject({ id: 'loan-1', user_book_id: copy.id });
});

it('checks the guard before every chunk and stops the push when it throws (H1: owner changed mid-run)', async () => {
  for (let i = 0; i < 201; i++) createShelf(`Shelf ${i}`);
  let calls = 0;
  const guard = () => {
    calls += 1;
    if (calls > 1) throw new SyncAborted();
  };
  await expect(push(asClient(fake), guard)).rejects.toBeInstanceOf(SyncAborted);
  expect(fake.upserts).toHaveLength(1);
  expect(pending()).toBe(1);
});

it('upserts in chunks of 200', async () => {
  for (let i = 0; i < 201; i++) createShelf(`Shelf ${i}`);
  expect(await push(asClient(fake))).toMatchObject({ pushed: 201, rejected: 0 });
  expect(fake.upserts.map((u) => u.rows.length)).toEqual([200, 1]);
  expect(pending()).toBe(0);
});

it('never sends two rows with one conflict key: the newest reading of a book wins', async () => {
  // A book the server already knows, so resolveBooks' merge (which also collapses readings) doesn't run.
  const book = upsertBook(bookMeta());
  db.runSync('UPDATE books SET server_known = 1 WHERE id = ?', [book.id]);
  fake.tables.books.push({ id: book.id, isbn13: book.isbn13 });
  db.runSync("INSERT INTO readings (id, book_id, state, deleted_at) VALUES ('r-old', ?, 'want', '2026-09-01 10:00:00')", [book.id]);
  enqueueOp('readings', 'r-old', 'delete', db.getFirstSync('SELECT * FROM readings WHERE id = ?', ['r-old']));
  db.runSync("INSERT INTO readings (id, book_id, state) VALUES ('r-new', ?, 'reading')", [book.id]);
  enqueueOp('readings', 'r-new', 'upsert', db.getFirstSync('SELECT * FROM readings WHERE id = ?', ['r-new']));

  expect(await push(asClient(fake))).toEqual({ pushed: 1, rejected: 0, skipped: 0 });
  const readingUpserts = fake.upserts.filter((u) => u.table === 'readings');
  expect(readingUpserts).toHaveLength(1);
  expect(readingUpserts[0].rows.map((r) => r.id)).toEqual(['r-new']);
  expect(fake.rows('readings')).toHaveLength(1);
  expect(fake.rows('readings')[0]).toMatchObject({ id: 'r-new', state: 'reading', deleted_at: null });
  // The superseded tombstone must not push later and delete the live reading.
  expect(pending()).toBe(0);
});

describe('shelf adoption', () => {
  it('pauses the whole push when adoption is offline', async () => {
    library();
    setMeta(ADOPT_SHELVES_KEY, '1');
    fake.failNext('shelves', 503);
    await expect(push(asClient(fake))).rejects.toBeInstanceOf(SyncRetryable);
    expect(fake.upserts).toEqual([]);
    expect(pending()).toBe(3);
  });

  it('a refused adoption holds back only shelves and what sits on them, and tries again next time', async () => {
    const { shelf, copy } = library();
    lendCopy(copy.id);
    const loose = addUserBook(upsertBook(bookMeta({ isbn13: '9780547928227', title: 'The Hobbit' })).id, 'owned');
    setMeta(ADOPT_SHELVES_KEY, '1');
    fake.failNext('shelves', 403);

    expect(await push(asClient(fake))).toEqual({ pushed: 2, rejected: 0, skipped: 3 });
    expect(fake.upserts.map((u) => u.table)).toEqual(['user_books', 'readings']);
    expect(fake.rows('user_books').map((u) => u.id)).toEqual([loose.id]);
    expect(getMeta(ADOPT_SHELVES_KEY)).toBe('1');
    expect(db.getAllSync('SELECT * FROM sync_rejects')).toEqual([]);

    fake.seed('shelves', { id: 'srv-study', name: 'study', sort_order: 0, plank: 'pool' });
    expect(await push(asClient(fake))).toEqual({ pushed: 3, rejected: 0, skipped: 0 });
    expect(getMeta(ADOPT_SHELVES_KEY)).toBeNull();
    expect(fake.rows('shelves').map((s) => s.id)).toEqual(['srv-study']);
    expect(fake.rows('user_books').find((u) => u.id === copy.id)!.shelf_id).toBe('srv-study');
    expect(db.getFirstSync('SELECT 1 FROM shelves WHERE id = ?', [shelf.id])).toBeNull();
    expect(pending()).toBe(0);
  });
});
