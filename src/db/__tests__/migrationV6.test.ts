/** S1: a phone on v5 (accounts, before sync) upgrades to v6 with every row intact. */
import { migrate } from '@/db/database';
import { SCHEMA_VERSION } from '@/db/schema';
import { openMemoryDb } from '@/test/memoryDb';

async function seededV5() {
  const d = await openMemoryDb();
  d.execSync('PRAGMA foreign_keys = ON;');
  migrate(d, 5);
  expect(d.getFirstSync<{ user_version: number }>('PRAGMA user_version')!.user_version).toBe(5);
  d.runSync("INSERT INTO books (id, isbn13, title, authors) VALUES ('b1', '9780441172719', 'Dune', '[\"Frank Herbert\"]')");
  d.runSync("INSERT INTO shelves (id, name, plank) VALUES ('s1', 'Study', 'bus')");
  d.runSync("INSERT INTO user_books (id, book_id, status, shelf_id) VALUES ('c1', 'b1', 'owned', 's1')");
  d.runSync("INSERT INTO readings (id, book_id, state, started_at) VALUES ('r1', 'b1', 'reading', '2026-09-01')");
  d.runSync("INSERT INTO book_edits (book_id, title, cover_path) VALUES ('b1', 'Dune (mine)', 'covers/b1-1.jpg')");
  d.runSync("INSERT INTO loans (id, user_book_id, borrower_name, loaned_at) VALUES ('l1', 'c1', 'Ada', '2026-09-01 10:00:00')");
  d.runSync("INSERT INTO profiles (id, display_name) VALUES ('u1', 'Reader')");
  d.runSync("INSERT INTO pending_ops (table_name, row_id, op, payload) VALUES ('shelves', 's1', 'upsert', '{\"id\":\"s1\"}')");
  d.runSync("INSERT INTO sync_meta (key, value) VALUES ('owner', 'u1')");
  return d;
}

it('keeps every row, defaults the new columns and rebuilds books_effective', async () => {
  const d = await seededV5();
  migrate(d);
  expect(d.getFirstSync<{ user_version: number }>('PRAGMA user_version')!.user_version).toBe(SCHEMA_VERSION);

  for (const [table, n] of [['books', 1], ['shelves', 1], ['user_books', 1], ['readings', 1], ['book_edits', 1], ['loans', 1], ['profiles', 1], ['pending_ops', 1], ['sync_meta', 1]] as const) {
    expect(d.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n).toBe(n);
  }
  expect(d.getFirstSync('SELECT server_known FROM books')).toEqual({ server_known: 0 });
  expect(d.getFirstSync('SELECT cover_path, cover_object FROM book_edits')).toEqual({ cover_path: 'covers/b1-1.jpg', cover_object: null });
  expect(d.getFirstSync('SELECT COUNT(*) AS n FROM sync_rejects')).toEqual({ n: 0 });
  expect(d.getFirstSync('SELECT id, title, authors, cover_path, cover_object, edited FROM books_effective')).toEqual({
    id: 'b1', title: 'Dune (mine)', authors: '["Frank Herbert"]', cover_path: 'covers/b1-1.jpg', cover_object: null, edited: 1,
  });
  expect(d.getAllSync('PRAGMA foreign_key_check')).toEqual([]);
});

it('a second migrate on the upgraded database is a no-op', async () => {
  const d = await seededV5();
  migrate(d);
  migrate(d);
  expect(d.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM books')!.n).toBe(1);
});
