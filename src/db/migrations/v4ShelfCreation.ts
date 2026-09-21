/**
 * v4 — shelves become real places. Adds shelves.plank and user_books.shelf_id, turns each At home copy's
 * free-text location into a shelf (decisions from the tested migrateLocations), then retires location.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { newId } from '../ids';
import { migrateLocations } from '@/features/shelves/shelfRules';

export function migrateV4ShelfCreation(d: SQLiteDatabase): void {
  d.execSync(`
    ALTER TABLE shelves ADD COLUMN plank TEXT NOT NULL DEFAULT 'bus';
    ALTER TABLE user_books ADD COLUMN shelf_id TEXT REFERENCES shelves(id);
    CREATE INDEX IF NOT EXISTS idx_user_books_shelf ON user_books(shelf_id);
  `);
  const enqueue = (table: string, rowId: string, payload: unknown) =>
    d.runSync('INSERT INTO pending_ops (table_name, row_id, op, payload) VALUES (?, ?, ?, ?)', [table, rowId, 'upsert', JSON.stringify(payload)]);

  const copies = d.getAllSync<any>(`SELECT id, location, created_at FROM user_books WHERE deleted_at IS NULL AND status = 'owned'`);
  const { shelves, copyShelf } = migrateLocations(copies.map((c) => ({ id: c.id, location: c.location, createdAt: c.created_at })));

  const idByKey = new Map<string, string>();
  for (const s of shelves) {
    const id = newId();
    idByKey.set(s.key, id);
    d.runSync('INSERT INTO shelves (id, name, sort_order, plank) VALUES (?, ?, ?, ?)', [id, s.name, s.sortOrder, s.plank]);
    enqueue('shelves', id, d.getFirstSync('SELECT * FROM shelves WHERE id = ?', [id]));
  }

  for (const c of copies) {
    const key = copyShelf[c.id];
    const shelfId = key ? idByKey.get(key) ?? null : null;
    if (c.location == null && shelfId == null) continue;
    d.runSync(`UPDATE user_books SET shelf_id = ?, location = NULL, updated_at = datetime('now') WHERE id = ?`, [shelfId, c.id]);
    enqueue('user_books', c.id, d.getFirstSync('SELECT * FROM user_books WHERE id = ?', [c.id]));
  }

  // Wishlist and soft-deleted copies never carry a place.
  d.runSync('UPDATE user_books SET location = NULL WHERE location IS NOT NULL');

  // Queued ops from before v4 carry location; null the shelf instead of pointing at it. Those ops are
  // older than the shelf upserts queued above, so referencing a shelf before its upsert would fail the
  // server FK and stall the oldest-first pending_ops queue. The loop above already queued a fresh
  // 'user_books' upsert (after the shelf upserts) for every copy that got a shelf, carrying the real id.
  for (const op of d.getAllSync<any>(`SELECT id, row_id, payload FROM pending_ops WHERE table_name = 'user_books'`)) {
    const p = JSON.parse(op.payload);
    if (p && typeof p === 'object' && 'location' in p) {
      p.location = null;
      p.shelf_id = null;
      d.runSync('UPDATE pending_ops SET payload = ? WHERE id = ?', [JSON.stringify(p), op.id]);
    }
  }
}
