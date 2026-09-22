jest.mock('@/features/bookEdits/coverFiles', () => ({
  ...jest.requireActual('@/features/bookEdits/coverFiles'),
  saveCoverFile: jest.fn(async (bookId: string) => `covers/${bookId}-1.jpg`),
  deleteCoverFile: jest.fn(),
}));

import { removeBookCover, resetBookEdits, saveBookEdit, setBookCover, upsertBook } from '@/db/repository';
import { bookMeta } from '@/test/fixtures';
import { freshDb } from '@/test/testDb';

const PATCH = { title: 'Mine', subtitle: null, authors: ['Me'], publisher: null, publishedYear: null, edition: null };
const EMPTY = { title: null, subtitle: null, authors: null, publisher: null, publishedYear: null, edition: null };

let db: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => {
  db = await freshDb();
});
const lastOp = () => db.getFirstSync<{ op: string; row_id: string; payload: string }>("SELECT op, row_id, payload FROM pending_ops WHERE table_name = 'book_edits' ORDER BY id DESC LIMIT 1");

it('saving details queues an upsert snapshot', () => {
  const b = upsertBook(bookMeta());
  saveBookEdit(b.id, PATCH);
  expect(lastOp()).toMatchObject({ op: 'upsert', row_id: b.id });
  expect(JSON.parse(lastOp()!.payload)).toMatchObject({ book_id: b.id, title: 'Mine', authors: '["Me"]' });
});

it('clearing every override queues a tombstone', () => {
  const b = upsertBook(bookMeta());
  saveBookEdit(b.id, PATCH);
  saveBookEdit(b.id, EMPTY);
  expect(lastOp()!.op).toBe('delete');
  expect(JSON.parse(lastOp()!.payload)).toEqual({ book_id: b.id, cover_object: null, deleted_at: expect.stringMatching(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/) });
});

it('a new photo forgets the old synced object, and removing it queues the change', async () => {
  const b = upsertBook(bookMeta());
  await setBookCover(b.id, 'file:///tmp/pick.jpg');
  db.runSync("UPDATE book_edits SET cover_object = 'u/x-1.jpg' WHERE book_id = ?", [b.id]);
  await setBookCover(b.id, 'file:///tmp/pick2.jpg');
  expect(db.getFirstSync<{ cover_object: string | null }>('SELECT cover_object FROM book_edits WHERE book_id = ?', [b.id])!.cover_object).toBeNull();
  saveBookEdit(b.id, PATCH);
  removeBookCover(b.id);
  expect(JSON.parse(lastOp()!.payload)).toMatchObject({ cover_path: null, cover_object: null, title: 'Mine' });
});

it('reset to catalog queues a tombstone', () => {
  const b = upsertBook(bookMeta());
  saveBookEdit(b.id, PATCH);
  resetBookEdits(b.id);
  expect(lastOp()!.op).toBe('delete');
});

it('a tombstone keeps the synced photo, so the server does not purge it', () => {
  const b = upsertBook(bookMeta());
  saveBookEdit(b.id, PATCH);
  db.runSync("UPDATE book_edits SET cover_object = 'u/x-1.jpg' WHERE book_id = ?", [b.id]);
  resetBookEdits(b.id);
  expect(lastOp()!.op).toBe('delete');
  expect(JSON.parse(lastOp()!.payload)).toMatchObject({ book_id: b.id, cover_object: 'u/x-1.jpg' });
});

it('removing the only override, the photo, queues a tombstone without it', async () => {
  const b = upsertBook(bookMeta());
  await setBookCover(b.id, 'file:///tmp/pick.jpg');
  db.runSync("UPDATE book_edits SET cover_object = 'u/x-1.jpg' WHERE book_id = ?", [b.id]);
  removeBookCover(b.id);
  expect(lastOp()!.op).toBe('delete');
  expect(JSON.parse(lastOp()!.payload)).toMatchObject({ book_id: b.id, cover_object: null });
});

it('an empty save for a book with no edits queues nothing', () => {
  const b = upsertBook(bookMeta());
  saveBookEdit(b.id, EMPTY);
  expect(lastOp()).toBeNull();
});
