/**
 * Spec §6.3. Each page is applied inside one transaction together with its cursor; cover files are deleted
 * after it commits. Rows only ever write the columns the server maps (toLocalRow / toLocalBook), so local-only
 * columns (user_books.rating/location, book_edits.cover_path/contributed_at) survive a pull of the same row.
 */
import { getDb } from '@/db/database';
import { deleteMeta, getMeta, rejectedCount, setMeta } from '@/db/localData';
import { pendingCount } from '@/db/pendingOps';
import { deleteAllCoverFiles, deleteCoverFile } from '@/features/bookEdits/coverFiles';
import { SyncRetryable, type RunGuard, type SyncClient } from './client';
import {
  applyPulled, classifyStatus, COVER_REJECTS, discardedCoverKey, isStale, keysetFilter, nextCursor, parseCursor, PULL_PAGE,
  PUSH_ORDER, ROW_KEY, serializeCursor, toLocalBook, toLocalRow, UNUPLOADED_PHOTO_SQL, type Cursor, type SyncedTable,
} from './logic';
import { rewriteBookId } from './resolveBooks';

type Row = Record<string, unknown>;
type SqlValue = string | number | null;
const BOOK_TABLES = new Set<SyncedTable>(['user_books', 'readings', 'book_edits']);

/**
 * The server stamps updated_at with now() at transaction start, so a transaction that started earlier can commit
 * after a later one and land behind the cursor. Each run re-reads this far back; applying a row twice is harmless.
 */
export const PULL_OVERLAP_MS = 5 * 60_000;

export const cursorKey = (t: SyncedTable) => `pull:${t}`;
export function readCursor(t: SyncedTable): Cursor | null {
  return parseCursor(getMeta(cursorKey(t)));
}

/** A comparable key for a server timestamptz (UTC, 0–6 fractional digits); unparseable values compare as-is. */
function tsKey(v: string): string {
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(?:Z|\+00:00|\+00)$/.exec(v);
  if (m) return `${m[1]}.${(m[2] ?? '').padEnd(6, '0')}`;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : `${d.toISOString().slice(0, 23)}000`;
}

/** The later of two keyset positions, so an overlap re-read never moves the stored cursor backwards. */
function laterCursor(a: Cursor | null, b: Cursor | null): Cursor | null {
  if (!a || !b) return a ?? b;
  const [ka, kb] = [tsKey(a.updatedAt), tsKey(b.updatedAt)];
  return (ka !== kb ? ka > kb : a.id > b.id) ? a : b;
}

/**
 * cursor.updatedAt minus the overlap, whole seconds, as `…+00:00`; null when unparseable. Parsed by regex and
 * Date.UTC rather than new Date(string), whose handling of microseconds and offsets varies by engine (Hermes).
 */
export function overlapStart(c: Cursor): string | null {
  const m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d):(\d\d)(?:\.\d+)?(Z|[+-]\d\d(?::?\d\d)?)$/.exec(c.updatedAt);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec, tz] = m;
  const off = tz === 'Z' ? null : /^([+-])(\d\d):?(\d\d)?$/.exec(tz);
  const offsetMin = off ? (off[1] === '-' ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3] ?? 0)) : 0;
  const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec) - offsetMin * 60_000;
  return `${new Date(ms - PULL_OVERLAP_MS).toISOString().slice(0, 19)}+00:00`;
}

/**
 * INSERT … ON CONFLICT DO UPDATE of exactly `row`'s columns. Column names come from the fixed whitelists in
 * logic.ts, never from the server. A null created_at/updated_at is left to the column default.
 */
function upsertLocal(table: string, pk: string, row: Row) {
  const cols = Object.keys(row).filter((c) => !((c === 'created_at' || c === 'updated_at') && row[c] == null));
  const updates = cols.filter((c) => c !== pk).map((c) => `${c} = excluded.${c}`);
  getDb().runSync(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})` +
      (updates.length ? ` ON CONFLICT(${pk}) DO UPDATE SET ${updates.join(', ')}` : ` ON CONFLICT(${pk}) DO NOTHING`),
    cols.map((c) => row[c] as SqlValue)
  );
}

const unchanged = (local: Row | null, mapped: Row) => !!local && Object.keys(mapped).every((c) => (local[c] ?? null) === (mapped[c] ?? null));

/**
 * Stores a catalog row. A local book with the same isbn13 but another id (looked up on this phone and not yet
 * resolved) would break the local UNIQUE(isbn13), so it is first merged into the catalog id through the same
 * rewrite `ensure` uses (Task 12): its copies, readings, edits and queued ops all move. Opens a transaction
 * (inside rewriteBookId), so never call it from inside one.
 */
export function upsertServerBook(server: Row): void {
  const d = getDb();
  const row = toLocalBook(server);
  const clash = row.isbn13
    ? d.getFirstSync<{ id: string }>('SELECT id FROM books WHERE isbn13 = ? AND id != ?', [row.isbn13 as string, String(row.id)])
    : null;
  if (clash) rewriteBookId(clash.id, String(row.id));
  upsertLocal('books', 'id', row);
}

function failure(status: number, what: string): Error {
  return classifyStatus(status) === 'retry' ? new SyncRetryable(status) : new Error(`${what} failed (${status})`);
}

/** Local foreign keys need the referenced books before a page applies. */
async function ensureBooksLocal(client: SyncClient, ids: string[]) {
  const d = getDb();
  const missing = [...new Set(ids)].filter((id) => id && !d.getFirstSync('SELECT 1 FROM books WHERE id = ?', [id]));
  for (let i = 0; i < missing.length; i += 100) {
    const { data, error, status } = await client.from('books').select('*').in('id', missing.slice(i, i + 100));
    if (error) throw failure(status, 'books fetch');
    for (const b of (data ?? []) as Row[]) upsertServerBook(b);
  }
}

/** Applies one pulled row (inside the page's transaction). Returns true when the local data changed. */
function applyRow(table: SyncedTable, row: Row, staleCovers: string[]): boolean {
  const d = getDb();
  const key = ROW_KEY[table];
  const id = String(row[key]);
  const bookId = row.book_id != null ? String(row.book_id) : null;

  // The server keeps one reading per (user, book) and a push can change its id, so this phone's readings of
  // the same book are the same logical row (plan Decision 8).
  const sameBookReadings =
    table === 'readings' ? d.getAllSync<Row>('SELECT * FROM readings WHERE book_id = ? AND id != ?', [bookId, id]) : [];
  const byId = d.getFirstSync<Row>(`SELECT * FROM ${table} WHERE ${key} = ?`, [id]);
  const local = byId ?? sameBookReadings.find((r) => r.deleted_at == null) ?? sameBookReadings[0] ?? null;
  const rowIds = [id, ...sameBookReadings.map((r) => String(r.id))];
  const hasPending = !!d.getFirstSync(
    `SELECT 1 FROM pending_ops WHERE table_name = ? AND row_id IN (${rowIds.map(() => '?').join(', ')})`,
    [table, ...rowIds]
  );
  // A photo taken here and not uploaded yet (cover_path set, cover_object null) counts as a pending change:
  // applying the pulled row would delete the only copy of that file (controller ruling, Task 14 review). One
  // the bucket refused (a 'covers' reject) or the person discarded (Task 17) waits on the person instead, so
  // server changes apply again — UNUPLOADED_PHOTO_SQL is the one definition of "waiting", shared with covers.ts
  // and resetIfStale.
  const unuploadedPhoto =
    table === 'book_edits' && !!d.getFirstSync(`SELECT 1 FROM book_edits e WHERE e.book_id = ? AND ${UNUPLOADED_PHOTO_SQL}`, [id]);
  if (applyPulled(local, row, hasPending || unuploadedPhoto) !== 'apply') return false;
  if (BOOK_TABLES.has(table) && !d.getFirstSync('SELECT 1 FROM books WHERE id = ?', [bookId])) return false;

  if (table === 'book_edits') {
    const localCover = (byId?.cover_path as string | null | undefined) ?? null;
    if (row.deleted_at) {
      // Plan Decision 7: book_edits rows are hard-deleted locally; the server's tombstone means "no edits".
      d.runSync('DELETE FROM book_edits WHERE book_id = ?', [id]);
      if (localCover) staleCovers.push(localCover);
      d.runSync('DELETE FROM sync_rejects WHERE table_name = ? AND row_id = ?', [COVER_REJECTS, id]);
      deleteMeta(discardedCoverKey(id));
      return true;
    }
    const mapped = toLocalRow('book_edits', row);
    // A replaced or removed synced photo makes this phone's file stale; CoverArt fetches the new one when shown.
    if (localCover && (mapped.cover_object ?? null) !== ((byId?.cover_object as string | null | undefined) ?? null)) {
      staleCovers.push(localCover);
      mapped.cover_path = null;
      // A refused or discarded photo that the server's photo (or its absence, after a removal) just
      // superseded is moot.
      d.runSync('DELETE FROM sync_rejects WHERE table_name = ? AND row_id = ?', [COVER_REJECTS, id]);
      deleteMeta(discardedCoverKey(id));
    }
    if (unchanged(byId, mapped)) return false;
    upsertLocal('book_edits', 'book_id', mapped);
    return true;
  }

  const mapped = toLocalRow(table, row);
  if (table === 'user_books' && mapped.shelf_id && !d.getFirstSync('SELECT 1 FROM shelves WHERE id = ?', [mapped.shelf_id as string])) mapped.shelf_id = null;
  if (table === 'loans' && !d.getFirstSync('SELECT 1 FROM user_books WHERE id = ?', [mapped.user_book_id as string])) return false;
  // Delete the other readings first, so the insert can't trip ux_readings_live (one live reading per book).
  if (sameBookReadings.length) d.runSync('DELETE FROM readings WHERE book_id = ? AND id != ?', [bookId, id]);
  else if (unchanged(byId, mapped)) return false;
  upsertLocal(table, key, mapped);
  return true;
}

async function pullTable(client: SyncClient, table: SyncedTable, nowMs: number, guard: RunGuard): Promise<number> {
  const key = ROW_KEY[table];
  const stored = readCursor(table);
  // First page: from (cursor − overlap). Later pages: strict keyset after the previous page, so a run always ends.
  let after: Cursor | null = null;
  let applied = 0;
  for (;;) {
    let query = client.from(table).select('*');
    if (after) query = query.or(keysetFilter(after, key));
    else if (stored) {
      const from = overlapStart(stored);
      query = from ? query.gte('updated_at', from) : query.or(keysetFilter(stored, key));
    }
    const { data, error, status } = await query.order('updated_at', { ascending: true }).order(key, { ascending: true }).limit(PULL_PAGE);
    if (error) throw failure(status, `pull ${table}`);
    const rows = (data ?? []) as Row[];
    if (BOOK_TABLES.has(table)) await ensureBooksLocal(client, rows.map((r) => String(r.book_id ?? '')));
    const staleCovers: string[] = [];
    const pageEnd = nextCursor(rows, key, null, nowMs);
    const save = laterCursor(readCursor(table), pageEnd);
    // After the awaits, right before writing: a page fetched for the old owner never lands after a wipe (H1).
    guard();
    const d = getDb();
    d.withTransactionSync(() => {
      for (const row of rows) if (applyRow(table, row, staleCovers)) applied++;
      if (save) setMeta(cursorKey(table), serializeCursor({ ...save, pulledAt: nowMs }));
    });
    for (const p of staleCovers) deleteCoverFile(p);
    if (rows.length < PULL_PAGE) return applied;
    after = pageEnd;
  }
}

/**
 * Pulls every synced table, parents first. Returns how many local rows changed. Never call inside a transaction.
 * `guard` runs before each page is applied and throws SyncAborted when the library changed hands (H1).
 */
export async function pull(client: SyncClient, nowMs: number = Date.now(), guard: RunGuard = () => {}): Promise<number> {
  let applied = 0;
  for (const table of PUSH_ORDER) applied += await pullTable(client, table, nowMs, guard);
  return applied;
}

/**
 * Spec §6.3 stale device (offline longer than the 30-day purge window, so purged deletes were missed): start
 * again from the server. Only when nothing is waiting (no pending op, no un-uploaded photo, no refused change),
 * so no local edit is lost. Every synced table and cursor clears together: clearing one table alone would break
 * local foreign keys. books (the catalog cache) stays; local-only shelf_books goes, as it points at copies.
 * Local-only columns go with their rows and are not restored by the full pull: book_edits.contributed_at
 * (so edits count as not yet contributed again), user_books.rating/location and cover_path (photos are
 * fetched again from cover_object when shown).
 */
export function resetIfStale(nowMs: number = Date.now()): boolean {
  if (!PUSH_ORDER.some((t) => isStale(readCursor(t), nowMs))) return false;
  const d = getDb();
  // A refused photo isn't "unsaved" here; its 'covers' reject counts in rejectedCount() instead. Nor is a
  // discarded one (Task 17): it has no reject and no pending op, so without this check it would wait forever.
  const unsavedPhoto = d.getFirstSync(`SELECT 1 FROM book_edits e WHERE ${UNUPLOADED_PHOTO_SQL}`);
  if (pendingCount() > 0 || rejectedCount() > 0 || unsavedPhoto) return false;
  d.withTransactionSync(() => {
    d.runSync('DELETE FROM shelf_books');
    for (const t of [...PUSH_ORDER].reverse()) d.runSync(`DELETE FROM ${t}`);
    for (const t of PUSH_ORDER) deleteMeta(cursorKey(t));
  });
  deleteAllCoverFiles();
  return true;
}
