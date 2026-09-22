/** Rows the server refused (spec §6.2 4xx). Tapping "⟨N⟩ change(s) couldn't sync" on Profile lists them. */
import { getDb } from '@/db/database';
import { deleteMeta, setMeta } from '@/db/localData';
import { enqueueOp, type OpKind } from '@/db/pendingOps';
import { refreshCounts, requestSync } from '@/sync/engine';
import { BOOK_REJECTS, COVER_REJECTS, discardedBookKey, discardedCoverKey, isSyncedTable, ROW_KEY } from './logic';
import { cursorKey } from './pull';

export interface RejectRow { id: number; tableName: string; rowId: string; op: OpKind; payload: Record<string, unknown>; errorCode: string; rejectedAt: string }

const toReject = (r: any): RejectRow => {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(r.payload) ?? {};
  } catch {
    payload = {};
  }
  return { id: r.id, tableName: r.table_name, rowId: r.row_id, op: r.op === 'delete' ? 'delete' : 'upsert', payload, errorCode: r.error_code, rejectedAt: r.rejected_at };
};

export function listRejects(): RejectRow[] {
  return getDb().getAllSync<any>('SELECT * FROM sync_rejects ORDER BY id').map(toReject);
}

/**
 * Puts a row back on the queue with its CURRENT local state — never the stale rejected payload. The refusal
 * might be old news: the person may have fixed the value since (a shorter name), or whatever it pointed to
 * (23503) may have synced since; re-sending the old payload could loop or clobber a newer edit. Push always
 * sends shelves, then copies, then readings … in that fixed table order (src/sync/push.ts), so a retried
 * parent goes out before its retried children regardless of which was tapped first — no extra ordering
 * needed here. (push.ts also clears a row's reject the moment any op for it pushes successfully, so a fix
 * made and synced before the person ever opens this screen already clears itself.)
 *
 * A row gone from its own table (only book_edits hard-deletes) still needs its delete pushed — dropping the
 * reject with nothing queued would silently undo the person's own delete the next time a pull re-applies
 * whatever the server still has for it. If this reject's own op was that delete, its payload is already the
 * tombstone shape ({ book_id, cover_object, deleted_at } — db/repository.ts deleteBookEdit) and goes out
 * as-is. If it was a refused upsert and the row was deleted separately since, a tombstone is synthesized from
 * what the payload last knew (its cover_object), deleted_at stamped now. Only a table whose row can never
 * truly disappear — every other synced table only soft-deletes, so `current` below is never null for them —
 * has genuinely nothing left to reconstruct, and only then is the reject just dropped.
 *
 * A 'covers' reject (Task 16) also has nothing to re-queue: its book_edits row still has cover_path set and
 * cover_object null, so uploadPendingCovers offers the photo again on its own once the reject is gone.
 * Nor does a 'books' reject (I5): the book's rows never left the queue, and once the reject is gone the next
 * run asks ensure about the book again.
 */
export function retryReject(id: number): void {
  const d = getDb();
  const raw = d.getFirstSync<any>('SELECT * FROM sync_rejects WHERE id = ?', [id]);
  if (!raw) return;
  const r = toReject(raw);
  d.withTransactionSync(() => {
    if (r.tableName !== COVER_REJECTS && isSyncedTable(r.tableName)) {
      const key = ROW_KEY[r.tableName];
      const current = d.getFirstSync<Record<string, unknown>>(`SELECT * FROM ${r.tableName} WHERE ${key} = ?`, [r.rowId]);
      if (current) {
        enqueueOp(r.tableName, r.rowId, 'upsert', current);
      } else if (r.op === 'delete') {
        enqueueOp(r.tableName, r.rowId, 'delete', r.payload);
      } else if (r.tableName === 'book_edits') {
        const deletedAt = d.getFirstSync<{ n: string }>("SELECT datetime('now') AS n")!.n;
        enqueueOp('book_edits', r.rowId, 'delete', { book_id: r.rowId, cover_object: r.payload.cover_object ?? null, deleted_at: deletedAt });
      }
    }
    d.runSync('DELETE FROM sync_rejects WHERE id = ?', [id]);
  });
  refreshCounts();
  requestSync(0);
}

/**
 * Drops the reject. A row reject also clears that table's pull cursor, so the next run re-applies the
 * server's version of the row (a row the server never had stays local and unsynced until it is edited again).
 *
 * A 'covers' reject (Task 16) has no server version to fall back to — the photo simply never reached the
 * backup — so instead of a cursor reset this marks the book's cover discarded: a sync_meta key
 * (discardedCoverKey), not another sync_rejects row, so it never counts toward rejectedCount() or blocks
 * resetIfStale the way a reject would. uploadPendingCovers stops offering that photo, the file and
 * book_edits.cover_path are untouched (it keeps showing on this phone), and the marker is cleared the moment
 * a new photo replaces or removes it (db/repository.ts clearCoverReject).
 *
 * A 'books' reject (I5) likewise has no server version: this marks the book discarded (discardedBookKey) so
 * ensure isn't asked about it every run. Its rows stay queued and unsynced on this phone, and aren't retried.
 */
export function discardReject(id: number): void {
  const d = getDb();
  const row = d.getFirstSync<{ table_name: string; row_id: string }>('SELECT table_name, row_id FROM sync_rejects WHERE id = ?', [id]);
  if (!row) return;
  d.withTransactionSync(() => {
    d.runSync('DELETE FROM sync_rejects WHERE id = ?', [id]);
    if (row.table_name === COVER_REJECTS) setMeta(discardedCoverKey(row.row_id), '1');
    else if (row.table_name === BOOK_REJECTS) setMeta(discardedBookKey(row.row_id), '1');
    else if (isSyncedTable(row.table_name)) deleteMeta(cursorKey(row.table_name));
  });
  refreshCounts();
  requestSync(0);
}

export function describeReject(r: RejectRow, titleFor: (bookId: string) => string | null): string {
  const book = () => (typeof r.payload.book_id === 'string' ? titleFor(r.payload.book_id) : null) ?? 'a book';
  switch (r.tableName) {
    case 'shelves': return `The ${String(r.payload.name ?? 'unnamed')} shelf`;
    case 'user_books': return `Your copy of ${book()}`;
    case 'readings': return `Your reading of ${book()}`;
    case 'book_edits': return `Your details for ${book()}`;
    case 'loans': return `The loan to ${String(r.payload.borrower_name ?? 'a friend')}`;
    case 'profiles': return 'Your name';
    case COVER_REJECTS: return `Cover photo for ${book()}`;
    case BOOK_REJECTS: return `Couldn't match ${book()} in the catalog`;
    default: return 'A change';
  }
}

export function reasonFor(code: string, tableName?: string): string {
  if (tableName === BOOK_REJECTS) return "Its changes stay on this phone until it's matched.";
  // CHECK constraints cover more than length (ranges, allowed values), so the copy stays general (H5).
  if (code === '23514') return 'The backup refused this change. Edit it, then try again.';
  if (code === '42501') return 'It belongs to a different account.';
  if (code === '23503') return "Something it points to hasn't backed up yet. Try again in a moment.";
  if (code === '23505') return 'It clashes with something already backed up.';
  return 'The backup turned it down.';
}
