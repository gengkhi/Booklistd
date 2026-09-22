const mockRequestSync = jest.fn();
jest.mock('@/sync/engine', () => ({ refreshCounts: jest.fn(), requestSync: (...a: unknown[]) => mockRequestSync(...a) }));
// Only needed to safely import '../covers' below (its end-to-end upload check); this test never talks to it.
jest.mock('@/api/supabase', () => ({ supabase: {} }));

import { getMeta, setMeta } from '@/db/localData';
import { freshDb } from '@/test/testDb';
import { uploadPendingCovers } from '../covers';
import { discardedBookKey, discardedCoverKey } from '../logic';
import { describeReject, discardReject, listRejects, reasonFor, retryReject, type RejectRow } from '../rejects';

let db: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => {
  db = await freshDb();
  jest.clearAllMocks();
});
const reject = (table: string, rowId: string, payload: object, code = '23514', op: 'upsert' | 'delete' = 'upsert') =>
  db.runSync('INSERT INTO sync_rejects (op_id, table_name, row_id, op, payload, error_code) VALUES (9, ?, ?, ?, ?, ?)', [table, rowId, op, JSON.stringify(payload), code]);

it('lists what was refused', () => {
  reject('shelves', 's1', { id: 's1', name: 'x'.repeat(90) });
  expect(listRejects()).toEqual([expect.objectContaining({ tableName: 'shelves', rowId: 's1', op: 'upsert', errorCode: '23514', payload: { id: 's1', name: 'x'.repeat(90) } })]);
});

it('Try again re-sends the CURRENT row, not the stale rejected payload — a fix made since the refusal goes out fixed', () => {
  db.runSync("INSERT INTO shelves (id, name) VALUES ('s1', 'Study desk')"); // fixed since the refusal
  db.runSync("INSERT INTO pending_ops (table_name, row_id, op, payload) VALUES ('shelves', 'other', 'upsert', '{}')");
  reject('shelves', 's1', { id: 's1', name: 'x'.repeat(90) }); // the stale, over-long name that got refused
  retryReject(listRejects()[0].id);
  expect(listRejects()).toEqual([]);
  const last = db.getFirstSync<{ row_id: string; payload: string }>('SELECT row_id, payload FROM pending_ops ORDER BY id DESC LIMIT 1');
  expect(last!.row_id).toBe('s1');
  expect(JSON.parse(last!.payload)).toMatchObject({ id: 's1', name: 'Study desk' });
  expect(mockRequestSync).toHaveBeenCalledWith(0);
});

it("Try again re-sends a synthesized delete when a refused upsert's row was deleted separately since (regression: used to silently drop it)", () => {
  // The row got hard-deleted after this upsert was refused; nothing else is queued to tell the server.
  reject('book_edits', 'b1', { book_id: 'b1', title: 'x'.repeat(999), cover_object: 'u1/old.jpg' });
  retryReject(listRejects()[0].id);
  expect(listRejects()).toEqual([]);
  const last = db.getFirstSync<{ op: string; payload: string }>("SELECT op, payload FROM pending_ops WHERE table_name = 'book_edits' ORDER BY id DESC LIMIT 1");
  expect(last!.op).toBe('delete');
  expect(JSON.parse(last!.payload)).toMatchObject({ book_id: 'b1', cover_object: 'u1/old.jpg' });
  expect(mockRequestSync).toHaveBeenCalledWith(0);
});

it("a rejected book_edits tombstone is retried and a 'delete' op with that payload is queued", () => {
  const tombstone = { book_id: 'b1', cover_object: 'u1/mine.jpg', deleted_at: '2026-09-20 10:00:00' };
  reject('book_edits', 'b1', tombstone, '23503', 'delete'); // the delete itself got refused; row is already gone
  retryReject(listRejects()[0].id);
  expect(listRejects()).toEqual([]);
  const last = db.getFirstSync<{ table_name: string; row_id: string; op: string; payload: string }>(
    'SELECT table_name, row_id, op, payload FROM pending_ops ORDER BY id DESC LIMIT 1'
  );
  expect(last).toEqual({ table_name: 'book_edits', row_id: 'b1', op: 'delete', payload: JSON.stringify(tombstone) });
  expect(mockRequestSync).toHaveBeenCalledWith(0);
});

it('Try again drops the reject when there is truly nothing left to send (only book_edits can go missing like this)', () => {
  reject('shelves', 'ghost', { id: 'ghost', name: 'Gone' }); // no shelves row 'ghost' ever existed
  retryReject(listRejects()[0].id);
  expect(listRejects()).toEqual([]);
  expect(db.getFirstSync('SELECT 1 FROM pending_ops')).toBeNull();
  expect(mockRequestSync).toHaveBeenCalledWith(0);
});

it('Discard drops it and re-pulls that table', () => {
  setMeta('pull:shelves', '{"updatedAt":"t","id":"a","pulledAt":1}');
  reject('shelves', 's1', { id: 's1', name: 'Study' });
  discardReject(listRejects()[0].id);
  expect(listRejects()).toEqual([]);
  expect(getMeta('pull:shelves')).toBeNull();
  expect(mockRequestSync).toHaveBeenCalledWith(0);
});

describe('covers rejects (Task 16/17: a cover photo the bucket refused)', () => {
  it("Try again just drops the reject: the row still has an unuploaded photo, so the next run offers it again on its own", () => {
    reject('covers', 'b1', { book_id: 'b1', cover_path: 'covers/b1-1.jpg' }, 'http_403');
    retryReject(listRejects()[0].id);
    expect(listRejects()).toEqual([]);
    expect(db.getFirstSync('SELECT 1 FROM pending_ops')).toBeNull(); // nothing to push for a photo
    expect(mockRequestSync).toHaveBeenCalledWith(0);
  });

  it('Discard drops it and marks the photo discarded, without touching any pull cursor', () => {
    setMeta('pull:shelves', '{"updatedAt":"t","id":"a","pulledAt":1}');
    reject('covers', 'b1', { book_id: 'b1', cover_path: 'covers/b1-1.jpg' }, 'http_403');
    discardReject(listRejects()[0].id);
    expect(listRejects()).toEqual([]);
    expect(getMeta(discardedCoverKey('b1'))).toBe('1');
    expect(getMeta('pull:shelves')).not.toBeNull(); // 'covers' isn't a synced table; no cursor to clear
    expect(mockRequestSync).toHaveBeenCalledWith(0);
  });
});

describe("books rejects (I5: a book ensure refused, so its rows can't sync)", () => {
  it('Try again just drops the reject, so the next run asks ensure again', () => {
    reject('books', 'b1', { book_id: 'b1', isbn13: '9780441172719' }, 'http_400');
    retryReject(listRejects()[0].id);
    expect(listRejects()).toEqual([]);
    expect(db.getFirstSync('SELECT 1 FROM pending_ops')).toBeNull();
    expect(getMeta(discardedBookKey('b1'))).toBeNull();
    expect(mockRequestSync).toHaveBeenCalledWith(0);
  });

  it('Discard drops it and marks the book so ensure is not retried every run; its queued rows stay', () => {
    db.runSync("INSERT INTO pending_ops (table_name, row_id, op, payload) VALUES ('user_books', 'c1', 'upsert', '{\"book_id\":\"b1\"}')");
    setMeta('pull:shelves', '{"updatedAt":"t","id":"a","pulledAt":1}');
    reject('books', 'b1', { book_id: 'b1', isbn13: '9780441172719' }, 'http_400');
    discardReject(listRejects()[0].id);
    expect(listRejects()).toEqual([]);
    expect(getMeta(discardedBookKey('b1'))).toBe('1');
    expect(getMeta('pull:shelves')).not.toBeNull();
    expect(db.getAllSync('SELECT 1 FROM pending_ops')).toHaveLength(1);
  });
});

// End-to-end: Discard a cover reject, then confirm the engine's own upload query (src/sync/covers.ts) really
// does leave the photo alone afterward and the reject never comes back — not just that the marker was set.
describe('end-to-end: discarding a cover reject (Task 17 review)', () => {
  it("uploadPendingCovers uploads nothing for a discarded book, and the reject doesn't reappear", async () => {
    db.runSync("INSERT INTO books (id, isbn13, title, server_known) VALUES ('b1', '9780000000001', 'Dune', 1)");
    db.runSync("INSERT INTO book_edits (book_id, cover_path, cover_object) VALUES ('b1', 'covers/b1-1.jpg', NULL)");
    reject('covers', 'b1', { book_id: 'b1', cover_path: 'covers/b1-1.jpg' }, 'http_403');
    discardReject(listRejects()[0].id);
    expect(listRejects()).toEqual([]);

    const uploaded = jest.fn();
    const client = { storage: { from: () => ({ upload: uploaded }) } } as any;
    expect(await uploadPendingCovers(client, 'u1')).toBe(0);
    expect(uploaded).not.toHaveBeenCalled();
    expect(listRejects()).toEqual([]); // no new reject either
  });
});

describe('copy', () => {
  const r = (tableName: string, payload: Record<string, unknown>): RejectRow => ({ id: 1, tableName, rowId: 'x', op: 'upsert', payload, errorCode: '23514', rejectedAt: '' });
  const title = (id: string) => (id === 'b1' ? 'Dune' : null);
  it.each([
    [r('shelves', { name: 'Study' }), 'The Study shelf'],
    [r('user_books', { book_id: 'b1' }), 'Your copy of Dune'],
    [r('readings', { book_id: 'b1' }), 'Your reading of Dune'],
    [r('book_edits', { book_id: 'b1' }), 'Your details for Dune'],
    [r('book_edits', { book_id: 'b2' }), 'Your details for a book'],
    [r('loans', { borrower_name: 'Ana' }), 'The loan to Ana'],
    [r('profiles', {}), 'Your name'],
    [r('covers', { book_id: 'b1' }), 'Cover photo for Dune'],
    [r('covers', { book_id: 'b2' }), 'Cover photo for a book'],
    [r('books', { book_id: 'b1' }), "Couldn't match Dune in the catalog"],
    [r('books', { book_id: 'b2' }), "Couldn't match a book in the catalog"],
  ])('describes %#', (row, text) => expect(describeReject(row, title)).toBe(text));
  it('explains the reason', () => {
    expect(reasonFor('23514')).toBe('The backup refused this change. Edit it, then try again.');
    expect(reasonFor('42501')).toBe('It belongs to a different account.');
    expect(reasonFor('23503')).toBe("Something it points to hasn't backed up yet. Try again in a moment.");
    expect(reasonFor('http_400')).toBe('The backup turned it down.');
    expect(reasonFor('http_400', 'books')).toBe("Its changes stay on this phone until it's matched.");
  });
});
