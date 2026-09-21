/**
 * v3 — reading tracking. Copies keep only ownership ('owned' | 'wishlist'); reading state, dates and the
 * Dewey rating move to `readings` (one live row per book). Decisions come from the unit-tested
 * readingFromLegacy / mapCopyStatus, so the SQL here only moves data.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { newId } from '../ids';
import { mapCopyStatus, readingFromLegacy, type LegacyCopy } from '@/features/reading/legacy';

export const READINGS_DDL = `
  CREATE TABLE IF NOT EXISTS readings (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id),
    state TEXT NOT NULL CHECK (state IN ('want','reading','read','dnf')),
    started_at TEXT,
    finished_at TEXT,
    rating INTEGER CHECK (rating BETWEEN 1 AND 7),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ux_readings_live ON readings(book_id) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_readings_book ON readings(book_id);
`;

export function migrateV3ReadingTracking(d: SQLiteDatabase): void {
  d.execSync(READINGS_DDL);
  const enqueue = (table: string, rowId: string, payload: unknown) =>
    d.runSync('INSERT INTO pending_ops (table_name, row_id, op, payload) VALUES (?, ?, ?, ?)', [table, rowId, 'upsert', JSON.stringify(payload)]);

  const live = d.getAllSync<any>('SELECT * FROM user_books WHERE deleted_at IS NULL');
  const byBook = new Map<string, any[]>();
  for (const c of live) byBook.set(c.book_id, [...(byBook.get(c.book_id) ?? []), c]);

  for (const [bookId, copies] of byBook) {
    const r = readingFromLegacy(copies.map((c): LegacyCopy => ({ status: c.status, rating: c.rating, updatedAt: c.updated_at })));
    if (!r) continue;
    const id = newId();
    d.runSync(
      'INSERT INTO readings (id, book_id, state, started_at, finished_at, rating) VALUES (?, ?, ?, ?, ?, ?)',
      [id, bookId, r.state, r.startedAt, r.finishedAt, r.rating]
    );
    enqueue('readings', id, d.getFirstSync('SELECT * FROM readings WHERE id = ?', [id]));
  }

  for (const c of live) {
    const status = mapCopyStatus(c.status);
    if (status === c.status && c.rating == null) continue;
    d.runSync(`UPDATE user_books SET status = ?, rating = NULL, updated_at = datetime('now') WHERE id = ?`, [status, c.id]);
    enqueue('user_books', c.id, d.getFirstSync('SELECT * FROM user_books WHERE id = ?', [c.id]));
  }

  // Soft-deleted copies never sync as upserts again, but must not keep values the server will reject.
  d.runSync(`UPDATE user_books SET status = 'owned', rating = NULL WHERE deleted_at IS NOT NULL AND status IN ('reading','read','loaned')`);
  d.runSync(`UPDATE user_books SET status = 'wishlist', rating = NULL WHERE deleted_at IS NOT NULL AND status = 'want_to_buy'`);

  // Queued ops from before v3 would carry old statuses; rewrite them in place.
  for (const op of d.getAllSync<any>(`SELECT id, payload FROM pending_ops WHERE table_name = 'user_books'`)) {
    const p = JSON.parse(op.payload);
    if (p && typeof p.status === 'string') {
      p.status = mapCopyStatus(p.status);
      p.rating = null;
      d.runSync('UPDATE pending_ops SET payload = ? WHERE id = ?', [JSON.stringify(p), op.id]);
    }
  }
}
