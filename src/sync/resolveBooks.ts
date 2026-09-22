/**
 * Spec §6.4: a local book id the server doesn't know is swapped for the catalog id `ensure` returns.
 * Every reference moves in one transaction, queued and rejected payloads included, so nothing ever pushes a stale id.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb } from '@/db/database';
import { enqueueOp } from '@/db/pendingOps';
import { deleteCoverFile, renameCoverFile } from '@/features/bookEdits/coverFiles';
import { statusOf, SyncRetryable, type SyncClient } from './client';
import { BOOK_REJECTS, classifyStatus, discardedBookKey } from './logic';
import { dropQueued, rewriteQueued } from './queued';

const BOOK_TABLES = ['user_books', 'readings', 'book_edits'] as const;

/**
 * The server keeps one reading per (user, book), so a merge must leave exactly one local row for the book:
 * a live row over a tombstone (a newer clear must not delete the other side's live, rated reading), then the most
 * recently updated, then the catalog side's. The others are dropped along with
 * their queued ops, so a push never carries two readings for one book (Postgres 21000). Returns the survivor's
 * id when rows were dropped (the caller queues it once it points at the new book id), else null.
 */
function collapseReadings(d: SQLiteDatabase, fromId: string, toId: string): string | null {
  const rows = d.getAllSync<{ id: string }>(
    `SELECT id FROM readings WHERE book_id IN (?, ?)
      ORDER BY deleted_at IS NULL DESC, updated_at DESC, book_id = ? DESC, id`,
    [fromId, toId, toId]
  );
  if (rows.length < 2) return null;
  const [winner, ...losers] = rows;
  for (const l of losers) {
    d.runSync('DELETE FROM readings WHERE id = ?', [l.id]);
    dropQueued(d, 'readings', l.id);
  }
  return winner.id;
}

/**
 * Moves the local book `fromId` (and everything that points at it) to the server id `toId`. When `toId` is
 * already on this phone the two merge: copies move over, readings collapse to one, and the catalog side's
 * book_edits row wins. Opens its own transaction, so never call it from inside one.
 */
export function rewriteBookId(fromId: string, toId: string): void {
  if (fromId === toId) return;
  const d = getDb();
  let coverPath: string | null = null;
  let droppedCover: string | null = null;
  d.withTransactionSync(() => {
    d.execSync('PRAGMA defer_foreign_keys = ON');
    const targetExists = !!d.getFirstSync('SELECT 1 FROM books WHERE id = ?', [toId]);
    d.runSync('UPDATE user_books SET book_id = ? WHERE book_id = ?', [toId, fromId]);

    const survivor = collapseReadings(d, fromId, toId);
    d.runSync('UPDATE readings SET book_id = ? WHERE book_id = ?', [toId, fromId]);

    const mine = d.getFirstSync<{ cover_path: string | null }>('SELECT cover_path FROM book_edits WHERE book_id = ?', [fromId]);
    if (d.getFirstSync('SELECT 1 FROM book_edits WHERE book_id = ?', [toId])) {
      // The catalog side already has edits (the row the server has), so it stays. The local side's row and
      // queued ops (a reset's tombstone included) would otherwise overwrite it once rewritten to toId.
      dropQueued(d, 'book_edits', fromId);
      if (mine) {
        d.runSync('DELETE FROM book_edits WHERE book_id = ?', [fromId]);
        droppedCover = mine.cover_path;
      }
    } else if (mine) {
      coverPath = mine.cover_path;
      d.runSync('UPDATE book_edits SET book_id = ? WHERE book_id = ?', [toId, fromId]);
    }

    if (targetExists) d.runSync('DELETE FROM books WHERE id = ?', [fromId]);
    else d.runSync('UPDATE books SET id = ? WHERE id = ?', [toId, fromId]);
    d.runSync('UPDATE books SET server_known = 1 WHERE id = ?', [toId]);
    // The book is resolved now, however that happened: a refusal or discard for the old id no longer applies (I5).
    d.runSync('DELETE FROM sync_rejects WHERE table_name = ? AND row_id = ?', [BOOK_REJECTS, fromId]);
    d.runSync('DELETE FROM sync_meta WHERE key = ?', [discardedBookKey(fromId)]);

    rewriteQueued(d, BOOK_TABLES, fromId, (op, p) => {
      if (p.book_id !== fromId) return null;
      p.book_id = toId;
      return op.table_name === 'book_edits' ? toId : op.row_id;
    });
    if (survivor) {
      const row = d.getFirstSync<{ deleted_at: string | null }>('SELECT * FROM readings WHERE id = ?', [survivor]);
      if (row) enqueueOp('readings', survivor, row.deleted_at ? 'delete' : 'upsert', row);
    }
  });
  if (droppedCover) deleteCoverFile(droppedCover);
  if (coverPath) {
    const moved = renameCoverFile(coverPath, toId);
    if (moved) d.runSync('UPDATE book_edits SET cover_path = ? WHERE book_id = ? AND cover_path = ?', [moved, toId, coverPath]);
  }
}

/** The ids (deduplicated) of local books the server hasn't confirmed yet. */
export function unknownBookIds(bookIds: string[]): string[] {
  const ids = [...new Set(bookIds)];
  const out: string[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    const q = part.map(() => '?').join(',');
    out.push(...getDb().getAllSync<{ id: string }>(`SELECT id FROM books WHERE server_known = 0 AND id IN (${q})`, part).map((r) => r.id));
  }
  return out;
}

export interface ResolveResult {
  /** local id → catalog id, already rewritten locally. */
  resolved: Map<string, string>;
  /** Books not resolved this run (refused, no ISBN, or skipped after throttling): their rows stay queued. */
  failed: Set<string>;
  /**
   * The subset of `failed` waiting on the person (I5): ensure definitely refused them (a 'books' reject, shown as
   * "couldn't sync") or the person discarded that reject. Their rows stay held but aren't retried with backoff.
   */
  refused: Set<string>;
  /** ensure answered 429, so the rest were skipped: the engine should retry with backoff (ruling F5). */
  throttled: boolean;
}

/** A refused (or discarded) book waits on the person: Try again drops the reject, Discard sets the marker. */
function waitsOnPerson(bookId: string): boolean {
  return !!getDb().getFirstSync(
    'SELECT 1 FROM sync_rejects WHERE table_name = ? AND row_id = ? UNION ALL SELECT 1 FROM sync_meta WHERE key = ?',
    [BOOK_REJECTS, bookId, discardedBookKey(bookId)]
  );
}

function rejectBook(bookId: string, isbn13: string, status: number): void {
  getDb().runSync(
    'INSERT INTO sync_rejects (op_id, table_name, row_id, op, payload, error_code) VALUES (0, ?, ?, ?, ?, ?)',
    [BOOK_REJECTS, bookId, 'upsert', JSON.stringify({ book_id: bookId, isbn13 }), `http_${status}`]
  );
}

/**
 * Asks `ensure` for each unknown book, one at a time. Offline, 5xx, 408 and 401 throw SyncRetryable (the whole
 * push pauses); a 429 stops asking and leaves the rest in `failed`; any other 4xx is a definite refusal: it
 * records a 'books' reject (I5) and fails just that book, which isn't asked about again until the person acts.
 */
export async function resolveBooks(client: SyncClient, bookIds: string[]): Promise<ResolveResult> {
  const resolved = new Map<string, string>();
  const failed = new Set<string>();
  const refused = new Set<string>();
  let throttled = false;
  for (const localId of unknownBookIds(bookIds)) {
    if (waitsOnPerson(localId)) {
      failed.add(localId);
      refused.add(localId);
      continue;
    }
    if (throttled) {
      failed.add(localId);
      continue;
    }
    const isbn13 = getDb().getFirstSync<{ isbn13: string | null }>('SELECT isbn13 FROM books WHERE id = ?', [localId])?.isbn13 ?? null;
    if (!isbn13) {
      failed.add(localId);
      continue;
    }
    const { data, error } = await client.functions.invoke<{ id?: string }>('book-lookup', { body: { ensure: { isbn13 } } });
    if (error) {
      const status = statusOf(error);
      if (status === 429) throttled = true;
      else if (classifyStatus(status) === 'retry') throw new SyncRetryable(status);
      else {
        rejectBook(localId, isbn13, status);
        refused.add(localId);
      }
      failed.add(localId);
      continue;
    }
    const serverId = data?.id;
    if (typeof serverId !== 'string' || !serverId) {
      failed.add(localId);
      continue;
    }
    rewriteBookId(localId, serverId);
    resolved.set(localId, serverId);
  }
  return { resolved, failed, refused, throttled };
}
