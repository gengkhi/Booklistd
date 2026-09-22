jest.mock('@/features/bookEdits/coverFiles', () => ({
  ...jest.requireActual('@/features/bookEdits/coverFiles'),
  deleteCoverFile: jest.fn(),
  deleteAllCoverFiles: jest.fn(),
}));

import { deleteAllCoverFiles, deleteCoverFile } from '@/features/bookEdits/coverFiles';
import { addUserBook, createShelf, getBook, listLibrary, listReadings, upsertBook } from '@/db/repository';
import { getMeta, setMeta } from '@/db/localData';
import { asClient, FakeSupabase } from '@/test/fakeSupabase';
import { bookMeta } from '@/test/fixtures';
import { freshDb } from '@/test/testDb';
import { SyncAborted } from '../client';
import { discardedCoverKey, STALE_AFTER_MS, serializeCursor } from '../logic';
import { overlapStart, pull, readCursor, resetIfStale } from '../pull';

let db: Awaited<ReturnType<typeof freshDb>>;
let fake: FakeSupabase;
beforeEach(async () => {
  db = await freshDb();
  fake = new FakeSupabase();
  fake.userId = 'u1';
  jest.clearAllMocks();
});

const ISBN = '9780441172719';
const B1 = '0b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
function serverLibrary() {
  fake.seed('books', { id: B1, isbn13: ISBN, isbn10: null, title: 'Dune', authors: ['Frank Herbert'], genres: [], source: 'google' });
  fake.seed('shelves', { id: 'S1', name: 'Study', sort_order: 0, plank: 'pool', icon: null });
  fake.seed('user_books', { id: 'C1', book_id: B1, status: 'owned', is_favorite: false, shelf_id: 'S1' });
  fake.seed('readings', { id: 'R1', book_id: B1, state: 'reading', started_at: '2026-09-01', finished_at: null, rating: null });
  fake.seed('book_edits', { book_id: B1, title: 'Dune (mine)', subtitle: null, authors: null, publisher: null, published_year: null, edition: null, cover_object: null });
}
const touch = (table: string, match: (r: Record<string, unknown>) => boolean, patch: Record<string, unknown>) =>
  Object.assign(fake.tables[table].find(match)!, patch, { updated_at: fake.stamp() });

it('pulls every table into an empty phone, fetching referenced books first', async () => {
  serverLibrary();
  expect(await pull(asClient(fake))).toBe(4); // shelf, copy, reading, edits (books are fetched, not counted)
  expect(listLibrary()).toEqual([expect.objectContaining({ id: 'C1', shelfName: 'Study', book: expect.objectContaining({ id: B1, title: 'Dune (mine)', authors: ['Frank Herbert'] }) })]);
  expect(listReadings('reading')).toHaveLength(1);
  expect(readCursor('shelves')).toMatchObject({ id: 'S1' });
});

it('checks the guard before applying each page and stops the pull when it throws (H1: owner changed mid-run)', async () => {
  serverLibrary();
  const guard = jest.fn(() => { throw new SyncAborted(); });
  await expect(pull(asClient(fake), Date.now(), guard)).rejects.toBeInstanceOf(SyncAborted);
  expect(guard).toHaveBeenCalledTimes(1);
  expect(db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM shelves')!.n).toBe(0);
  expect(readCursor('shelves')).toBeNull();
});

it('pages with the (updated_at, id) keyset, even when a whole page shares one timestamp', async () => {
  for (let i = 0; i < 501; i++) fake.seed('shelves', { id: `s${String(i).padStart(3, '0')}`, name: `Shelf ${i}`, sort_order: i, plank: 'bus', icon: null });
  for (const r of fake.tables.shelves) r.updated_at = '2026-09-22T00:00:00+00:00';
  await pull(asClient(fake));
  expect(db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM shelves')!.n).toBe(501);
  expect(readCursor('shelves')).toMatchObject({ id: 's500' });
});

it('a pending local op wins over the server row', async () => {
  const mine = createShelf('Study');
  fake.seed('shelves', { id: mine.id, name: 'Old name', sort_order: 0, plank: 'bus', icon: null });
  await pull(asClient(fake));
  expect(db.getFirstSync<{ name: string }>('SELECT name FROM shelves WHERE id = ?', [mine.id])!.name).toBe('Study');
});

it('applies soft deletes, and a book_edits tombstone removes the local row', async () => {
  serverLibrary();
  await pull(asClient(fake));
  touch('user_books', (r) => r.id === 'C1', { deleted_at: '2026-09-23T00:00:00+00:00' });
  touch('book_edits', (r) => r.book_id === B1, { deleted_at: '2026-09-23T00:00:00+00:00' });
  await pull(asClient(fake));
  expect(listLibrary()).toEqual([]);
  expect(getBook(B1)!.title).toBe('Dune');
});

it("another phone's reading replaces this phone's reading of the same book", async () => {
  db.runSync("INSERT INTO books (id, isbn13, title, server_known) VALUES (?, ?, 'Dune', 1)", [B1, ISBN]);
  db.runSync("INSERT INTO readings (id, book_id, state) VALUES ('Rlocal', ?, 'want')", [B1]);
  fake.seed('books', { id: B1, isbn13: ISBN, title: 'Dune', authors: [], genres: [], source: 'google' });
  fake.seed('readings', { id: 'R1', book_id: B1, state: 'reading', started_at: '2026-09-01', finished_at: null, rating: null });
  await pull(asClient(fake));
  expect(db.getAllSync('SELECT id, state FROM readings')).toEqual([{ id: 'R1', state: 'reading' }]);
});

it('a replaced synced photo drops the stale local file', async () => {
  db.runSync("INSERT INTO books (id, isbn13, title, server_known) VALUES (?, ?, 'Dune', 1)", [B1, ISBN]);
  db.runSync("INSERT INTO book_edits (book_id, cover_path, cover_object) VALUES (?, 'covers/old.jpg', 'u1/old.jpg')", [B1]);
  fake.seed('book_edits', { book_id: B1, title: null, subtitle: null, authors: null, publisher: null, published_year: null, edition: null, cover_object: 'u1/new.jpg' });
  await pull(asClient(fake));
  expect(db.getFirstSync('SELECT cover_path, cover_object FROM book_edits')).toEqual({ cover_path: null, cover_object: 'u1/new.jpg' });
  expect(deleteCoverFile).toHaveBeenCalledWith('covers/old.jpg');
});

it('a local book with the same ISBN takes the catalog id', async () => {
  const local = upsertBook(bookMeta());
  addUserBook(local.id, 'wishlist');
  db.execSync('DELETE FROM pending_ops');
  fake.seed('books', { id: B1, isbn13: ISBN, title: 'Dune', authors: ['Frank Herbert'], genres: [], source: 'google' });
  fake.seed('user_books', { id: 'C9', book_id: B1, status: 'owned', is_favorite: false, shelf_id: null });
  await pull(asClient(fake));
  expect(db.getAllSync<{ id: string }>('SELECT id FROM books').map((r) => r.id)).toEqual([B1]);
  expect(db.getAllSync<{ book_id: string }>('SELECT book_id FROM user_books').map((r) => r.book_id)).toEqual([B1, B1]);
});

it('re-pulling rows already applied changes nothing and counts nothing', async () => {
  serverLibrary();
  await pull(asClient(fake));
  expect(await pull(asClient(fake))).toBe(0);
});

it('a row committed late, with an updated_at just before the cursor, is still pulled (overlap window)', async () => {
  fake.seed('shelves', { id: 'S1', name: 'Study', sort_order: 0, plank: 'pool', icon: null });
  await pull(asClient(fake));
  const cursor = readCursor('shelves')!;
  // A concurrent transaction that started earlier commits after our pull: its stamp predates the cursor.
  const late = new Date(new Date(cursor.updatedAt).getTime() - 60_000).toISOString().replace('.000Z', '+00:00');
  fake.tables.shelves.push({ id: 'S0', user_id: 'u1', name: 'Late', sort_order: 1, plank: 'bus', icon: null, created_at: late, updated_at: late, deleted_at: null });
  expect(await pull(asClient(fake))).toBe(1);
  expect(db.getFirstSync<{ name: string }>("SELECT name FROM shelves WHERE id = 'S0'")!.name).toBe('Late');
  expect(readCursor('shelves')).toMatchObject({ id: 'S1', updatedAt: cursor.updatedAt });
});

it('writes only server columns, so local-only columns survive a pull of the same row', async () => {
  serverLibrary();
  await pull(asClient(fake));
  db.runSync("UPDATE user_books SET rating = 4, location = 'Hall' WHERE id = 'C1'");
  db.runSync("UPDATE book_edits SET cover_path = 'covers/mine.jpg', cover_object = 'u1/mine.jpg', contributed_at = '2026-09-20 10:00:00' WHERE book_id = ?", [B1]);
  touch('user_books', (r) => r.id === 'C1', { is_favorite: true });
  touch('book_edits', (r) => r.book_id === B1, { title: 'Dune (again)', cover_object: 'u1/mine.jpg' });
  expect(await pull(asClient(fake))).toBe(2);
  expect(db.getFirstSync("SELECT rating, location, is_favorite FROM user_books WHERE id = 'C1'")).toEqual({ rating: 4, location: 'Hall', is_favorite: 1 });
  expect(db.getFirstSync('SELECT title, cover_path, contributed_at FROM book_edits')).toEqual({ title: 'Dune (again)', cover_path: 'covers/mine.jpg', contributed_at: '2026-09-20 10:00:00' });
  expect(deleteCoverFile).not.toHaveBeenCalled();
});

it('accepts a placeholder catalog book with no title', async () => {
  fake.seed('books', { id: B1, isbn13: ISBN, isbn10: null, title: null, authors: [], genres: [], source: 'placeholder' });
  fake.seed('user_books', { id: 'C1', book_id: B1, status: 'owned', is_favorite: false, shelf_id: null });
  expect(await pull(asClient(fake))).toBe(1);
  expect(getBook(B1)).toMatchObject({ title: `ISBN ${ISBN}`, source: 'placeholder' });
});

it('a pulled reading tombstone replaces a live local reading of the same book', async () => {
  db.runSync("INSERT INTO books (id, isbn13, title, server_known) VALUES (?, ?, 'Dune', 1)", [B1, ISBN]);
  db.runSync("INSERT INTO readings (id, book_id, state) VALUES ('Rlocal', ?, 'want')", [B1]);
  fake.seed('readings', { id: 'R1', book_id: B1, state: 'reading', started_at: null, finished_at: null, rating: null, deleted_at: '2026-09-21T00:00:00+00:00' });
  await pull(asClient(fake));
  expect(db.getAllSync('SELECT id, deleted_at FROM readings')).toEqual([{ id: 'R1', deleted_at: '2026-09-21 00:00:00' }]);
});

it("keeps this phone's reading of the book while it has a pending op", async () => {
  db.runSync("INSERT INTO books (id, isbn13, title, server_known) VALUES (?, ?, 'Dune', 1)", [B1, ISBN]);
  db.runSync("INSERT INTO readings (id, book_id, state) VALUES ('Rlocal', ?, 'want')", [B1]);
  db.runSync("INSERT INTO pending_ops (table_name, row_id, op, payload) VALUES ('readings', 'Rlocal', 'upsert', '{}')");
  fake.seed('readings', { id: 'R1', book_id: B1, state: 'reading', started_at: null, finished_at: null, rating: null });
  await pull(asClient(fake));
  expect(db.getAllSync('SELECT id, state FROM readings')).toEqual([{ id: 'Rlocal', state: 'want' }]);
});

describe('a photo taken here and not uploaded yet is kept', () => {
  beforeEach(() => {
    db.runSync("INSERT INTO books (id, isbn13, title, server_known) VALUES (?, ?, 'Dune', 1)", [B1, ISBN]);
    db.runSync("INSERT INTO book_edits (book_id, cover_path, cover_object) VALUES (?, 'covers/new.jpg', NULL)", [B1]);
  });
  const edits = { book_id: B1, title: 'Other', subtitle: null, authors: null, publisher: null, published_year: null, edition: null };

  it('against a pulled row with another photo', async () => {
    fake.seed('book_edits', { ...edits, cover_object: 'u1/other.jpg' });
    expect(await pull(asClient(fake))).toBe(0);
    expect(db.getFirstSync('SELECT title, cover_path, cover_object FROM book_edits')).toEqual({ title: null, cover_path: 'covers/new.jpg', cover_object: null });
    expect(deleteCoverFile).not.toHaveBeenCalled();
  });

  it('against a pulled tombstone', async () => {
    fake.seed('book_edits', { ...edits, cover_object: 'u1/other.jpg', deleted_at: '2026-09-21T00:00:00+00:00' });
    expect(await pull(asClient(fake))).toBe(0);
    expect(db.getFirstSync('SELECT cover_path, cover_object FROM book_edits')).toEqual({ cover_path: 'covers/new.jpg', cover_object: null });
    expect(deleteCoverFile).not.toHaveBeenCalled();
  });
});

// Task 17 review fix: a discarded photo (sync_meta 'discard:covers:…', src/sync/rejects.ts) must not keep a
// pulled book_edits row local forever — unlike an un-uploaded or refused photo, the person chose not to back
// this one up, so someone else's edits, a photo they synced instead, or a tombstone must still apply.
describe('a discarded photo (Task 17) no longer blocks a pull', () => {
  beforeEach(() => {
    db.runSync("INSERT INTO books (id, isbn13, title, server_known) VALUES (?, ?, 'Dune', 1)", [B1, ISBN]);
    db.runSync("INSERT INTO book_edits (book_id, cover_path, cover_object) VALUES (?, 'covers/new.jpg', NULL)", [B1]);
    setMeta(discardedCoverKey(B1), '1');
  });
  const edits = { book_id: B1, title: 'Other title', subtitle: null, authors: null, publisher: null, published_year: null, edition: null, cover_object: null };

  it('a title change from another phone applies', async () => {
    fake.seed('book_edits', edits);
    expect(await pull(asClient(fake))).toBe(1);
    expect(db.getFirstSync<{ title: string; cover_path: string }>('SELECT title, cover_path FROM book_edits WHERE book_id = ?', [B1]))
      .toEqual({ title: 'Other title', cover_path: 'covers/new.jpg' }); // the discarded photo itself is untouched
  });

  it('a photo synced from elsewhere applies and clears the discard marker', async () => {
    fake.seed('book_edits', { ...edits, cover_object: 'u1/other.jpg' });
    expect(await pull(asClient(fake))).toBe(1);
    expect(db.getFirstSync('SELECT cover_path, cover_object FROM book_edits')).toEqual({ cover_path: null, cover_object: 'u1/other.jpg' });
    expect(deleteCoverFile).toHaveBeenCalledWith('covers/new.jpg');
    expect(getMeta(discardedCoverKey(B1))).toBeNull();
  });

  it('a tombstone removes the row and clears the discard marker', async () => {
    fake.seed('book_edits', { ...edits, deleted_at: '2026-09-21T00:00:00+00:00' });
    expect(await pull(asClient(fake))).toBe(1);
    expect(db.getFirstSync('SELECT 1 FROM book_edits WHERE book_id = ?', [B1])).toBeNull();
    expect(getMeta(discardedCoverKey(B1))).toBeNull();
  });
});

it('moves from the overlap first page to the strict keyset when the window holds more than a page', async () => {
  for (let i = 0; i < 600; i++) fake.seed('shelves', { id: `s${String(i).padStart(3, '0')}`, name: `Shelf ${i}`, sort_order: i, plank: 'bus', icon: null });
  for (const r of fake.tables.shelves) r.updated_at = '2026-09-22T00:00:00+00:00';
  await pull(asClient(fake));
  expect(readCursor('shelves')).toMatchObject({ id: 's599' });
  const from = jest.spyOn(fake, 'from');
  expect(await pull(asClient(fake))).toBe(0);
  // Page 1: gte (cursor − overlap) returns s000–s499; page 2: keyset after s499 returns s500–s599 (short), then stop.
  expect(from.mock.calls.filter(([t]) => t === 'shelves')).toHaveLength(2);
  expect(readCursor('shelves')).toMatchObject({ id: 's599', updatedAt: '2026-09-22T00:00:00+00:00' });
});

it('computes the overlap start without the engine parsing the timestamp', () => {
  const at = (updatedAt: string) => overlapStart({ updatedAt, id: 'x', pulledAt: 0 });
  expect(at('2026-09-22T00:05:00.123456+00:00')).toBe('2026-09-22T00:00:00+00:00');
  expect(at('2026-09-22T00:05:00Z')).toBe('2026-09-22T00:00:00+00:00');
  expect(at('2026-09-22T02:05:00.5+02:00')).toBe('2026-09-22T00:00:00+00:00');
  expect(at('2026-09-22T00:02:00+00')).toBe('2026-09-21T23:57:00+00:00');
  expect(at('not a time')).toBeNull();
});

describe('resetIfStale', () => {
  const old = (now: number) => serializeCursor({ updatedAt: '2026-01-01T00:00:00+00:00', id: 'x', pulledAt: now - STALE_AFTER_MS - 1 });

  it('after 30 days without a pull, clears synced tables and cursors so the next pull is full', () => {
    const now = Date.now();
    createShelf('Study');
    db.execSync('DELETE FROM pending_ops');
    setMeta('pull:shelves', old(now));
    expect(resetIfStale(now)).toBe(true);
    expect(db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM shelves')!.n).toBe(0);
    expect(readCursor('shelves')).toBeNull();
  });

  it('never resets while changes are waiting', () => {
    const now = Date.now();
    createShelf('Study');
    setMeta('pull:shelves', old(now));
    expect(resetIfStale(now)).toBe(false);
  });
  it('clears local-only shelf_books too, so foreign keys never block the reset', () => {
    const now = Date.now();
    const shelf = createShelf('Study');
    const copy = addUserBook(upsertBook(bookMeta()).id, 'owned', shelf.id);
    db.runSync('INSERT INTO shelf_books (shelf_id, user_book_id) VALUES (?, ?)', [shelf.id, copy.id]);
    db.execSync('DELETE FROM pending_ops');
    setMeta('pull:user_books', old(now));
    expect(resetIfStale(now)).toBe(true);
    expect(db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM user_books')!.n).toBe(0);
    expect(deleteAllCoverFiles).toHaveBeenCalled();
  });

  it('never resets while a photo is waiting to upload or a change was refused', () => {
    const now = Date.now();
    db.runSync("INSERT INTO books (id, isbn13, title) VALUES (?, ?, 'Dune')", [B1, ISBN]);
    db.runSync("INSERT INTO book_edits (book_id, cover_path) VALUES (?, 'covers/new.jpg')", [B1]);
    setMeta('pull:shelves', old(now));
    expect(resetIfStale(now)).toBe(false);
    db.runSync('DELETE FROM book_edits');
    db.runSync("INSERT INTO sync_rejects (op_id, table_name, row_id, op, payload, error_code) VALUES (1, 'shelves', 'S1', 'upsert', '{}', '23514')");
    expect(resetIfStale(now)).toBe(false);
  });

  // Task 17: Discard (src/sync/rejects.ts) leaves no reject and no pending op behind, so resetIfStale needs its
  // own check for a discarded photo — otherwise it would wait on it forever.
  it('a discarded photo (Task 17) no longer blocks the reset', () => {
    const now = Date.now();
    db.runSync("INSERT INTO books (id, isbn13, title) VALUES (?, ?, 'Dune')", [B1, ISBN]);
    db.runSync("INSERT INTO book_edits (book_id, cover_path) VALUES (?, 'covers/new.jpg')", [B1]);
    setMeta('pull:shelves', old(now));
    setMeta(discardedCoverKey(B1), '1');
    expect(resetIfStale(now)).toBe(true);
  });

  it('does nothing while every cursor is fresh', () => {
    const now = Date.now();
    setMeta('pull:shelves', serializeCursor({ updatedAt: '2026-01-01T00:00:00+00:00', id: 'x', pulledAt: now }));
    expect(resetIfStale(now)).toBe(false);
  });
});
