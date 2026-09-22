import type { SQLiteDatabase } from 'expo-sqlite';
import { __setDbForTest, migrate } from '@/db/database';
import { openMemoryDb } from './memoryDb';

/** A migrated, empty database that getDb() now returns. Call in beforeEach. */
export async function freshDb(): Promise<SQLiteDatabase> {
  const d = await openMemoryDb();
  d.execSync('PRAGMA foreign_keys = ON;');
  migrate(d);
  __setDbForTest(d);
  return d;
}

/** Every table wipeLocalData must empty (S2): wipe tests seed them all before asserting. */
export const LOCAL_TABLES = [
  'books', 'shelves', 'user_books', 'shelf_books', 'readings', 'book_edits', 'loans', 'profiles', 'pending_ops', 'sync_rejects', 'sync_meta',
] as const;

/** One row in every local table (raw SQL, so it doesn't depend on repository behavior). */
export function seedEveryLocalTable(d: SQLiteDatabase): void {
  d.runSync("INSERT INTO books (id, isbn13, title) VALUES ('seed-b', '9780547928227', 'The Hobbit')");
  d.runSync("INSERT INTO shelves (id, name) VALUES ('seed-s', 'Seed shelf')");
  d.runSync("INSERT INTO user_books (id, book_id, shelf_id) VALUES ('seed-c', 'seed-b', 'seed-s')");
  d.runSync("INSERT INTO shelf_books (shelf_id, user_book_id) VALUES ('seed-s', 'seed-c')");
  d.runSync("INSERT INTO readings (id, book_id, state) VALUES ('seed-r', 'seed-b', 'reading')");
  d.runSync("INSERT INTO book_edits (book_id, title) VALUES ('seed-b', 'Mine')");
  d.runSync("INSERT INTO loans (id, user_book_id, borrower_name, loaned_at) VALUES ('seed-l', 'seed-c', 'Ada', '2026-09-01 10:00:00')");
  d.runSync("INSERT INTO profiles (id, display_name) VALUES ('seed-u', 'Reader')");
  d.runSync("INSERT INTO pending_ops (table_name, row_id, op, payload) VALUES ('shelves', 'seed-s', 'upsert', '{}')");
  d.runSync("INSERT INTO sync_rejects (op_id, table_name, row_id, op, payload, error_code) VALUES (1, 'shelves', 'seed-s', 'upsert', '{}', '23514')");
  d.runSync("INSERT INTO sync_meta (key, value) VALUES ('seed', '1')");
}
