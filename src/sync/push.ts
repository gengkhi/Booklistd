/** Spec §6.2. Never logs payloads: they hold borrower names and notes. */
import { getDb } from '@/db/database';
import { adoptShelvesOnClaim, ShelfAdoptionRefused } from './adoptShelves';
import { SyncRetryable, type RunGuard, type SyncClient } from './client';
import {
  classifyStatus, coalesce, CONFLICT_TARGET, PUSH_CHUNK, PUSH_ORDER, rejectCode, toServerRow,
  type CoalescedOp, type PendingOp, type SyncedTable,
} from './logic';
import { resolveBooks } from './resolveBooks';

/** `skipped` rows stay queued (their book or shelf isn't settled yet); the engine retries them with backoff. */
export interface PushResult { pushed: number; rejected: number; skipped: number }

/** One row to send, plus older rows with the same conflict key that it replaces on the server. */
interface PushRow extends CoalescedOp { superseded: { rowId: string; maxOpId: number }[] }

function readQueue(): CoalescedOp[] {
  const d = getDb();
  const { ops, dropped } = coalesce(d.getAllSync<PendingOp>('SELECT id, table_name, row_id, op, payload FROM pending_ops ORDER BY id'));
  if (dropped.length) d.withTransactionSync(() => dropped.forEach((id) => d.runSync('DELETE FROM pending_ops WHERE id = ?', [id])));
  return ops;
}

const bookIdOf = (o: CoalescedOp): string | null =>
  (o.table === 'user_books' || o.table === 'readings' || o.table === 'book_edits') && typeof o.payload.book_id === 'string' ? o.payload.book_id : null;

/**
 * Runs shelf adoption. Offline or 5xx pauses the push (SyncRetryable). A refusal returns true: adoption is still
 * owed, so shelves and the copies on them wait, but every other table pushes. The flag stays for the next run.
 */
async function adoptShelves(client: SyncClient): Promise<boolean> {
  try {
    await adoptShelvesOnClaim(client);
    return false;
  } catch (e) {
    if (e instanceof ShelfAdoptionRefused) return true;
    throw e;
  }
}

/**
 * Splits the queue into rows to send (grouped by table in push order) and rows held back: rows whose book the
 * server hasn't resolved, shelves while adoption is owed, and children of a held parent (copies on a held shelf,
 * loans on a held copy). Held rows stay queued, unrejected. `held` counts only rows worth a backoff retry: rows
 * held for a refused book (or a copy of one) wait on the person via its 'books' reject instead (I5).
 */
function holdBack(ops: CoalescedOp[], failedBooks: Set<string>, refusedBooks: Set<string>, adoptionOwed: boolean): { ready: CoalescedOp[]; held: number } {
  const heldShelves = new Set<string>();
  const heldCopies = new Set<string>();
  const waitingCopies = new Set<string>();
  const ready: CoalescedOp[] = [];
  let held = 0;
  for (const table of PUSH_ORDER) {
    for (const o of ops) {
      if (o.table !== table) continue;
      const book = bookIdOf(o);
      const onHeldShelf = table === 'user_books' && heldShelves.has(String(o.payload.shelf_id));
      const onHeldCopy = table === 'loans' && heldCopies.has(String(o.payload.user_book_id));
      const hold = (table === 'shelves' && adoptionOwed) || (book !== null && failedBooks.has(book)) || onHeldShelf || onHeldCopy;
      if (!hold) {
        ready.push(o);
        continue;
      }
      const waiting =
        !onHeldShelf && ((book !== null && refusedBooks.has(book)) || (onHeldCopy && waitingCopies.has(String(o.payload.user_book_id))));
      if (!waiting) held += 1;
      if (table === 'shelves') heldShelves.add(o.rowId);
      if (table === 'user_books') {
        heldCopies.add(o.rowId);
        if (waiting) waitingCopies.add(o.rowId);
      }
    }
  }
  return { ready, held };
}

/**
 * One statement can't touch a conflict key twice (Postgres 21000), e.g. two local readings of one book. The row
 * with the newest op wins; the older rows' ops clear with it, or they would push later and overwrite it.
 */
function byConflictKey(table: SyncedTable, ops: CoalescedOp[]): PushRow[] {
  const cols = CONFLICT_TARGET[table].split(',').filter((c) => c !== 'user_id');
  const rows = new Map<string, PushRow>();
  for (const o of [...ops].sort((a, b) => a.maxOpId - b.maxOpId)) {
    const key = JSON.stringify(cols.map((c) => o.payload[c] ?? null));
    const prev = rows.get(key);
    rows.delete(key);
    rows.set(key, { ...o, superseded: prev ? [...prev.superseded, { rowId: prev.rowId, maxOpId: prev.maxOpId }] : [] });
  }
  return [...rows.values()];
}

/** Deletes a row's ops up to the id this push included; ops written during the push stay. Caller holds the transaction. */
function deleteIncluded(r: PushRow) {
  const d = getDb();
  for (const { rowId, maxOpId } of [r, ...r.superseded]) {
    d.runSync('DELETE FROM pending_ops WHERE table_name = ? AND row_id = ? AND id <= ?', [r.table, rowId, maxOpId]);
  }
}

/**
 * A row that just pushed is no longer "couldn't sync" — clear any earlier reject for it, and for rows it
 * superseded (an older local duplicate merged into this one by conflict key): both are now resolved on the
 * server. Otherwise a stale reject from before a later, successful fix would linger forever (Task 17 review).
 */
function clearOps(chunk: PushRow[]) {
  const d = getDb();
  d.withTransactionSync(() => {
    for (const r of chunk) {
      deleteIncluded(r);
      for (const { rowId } of [r, ...r.superseded]) d.runSync('DELETE FROM sync_rejects WHERE table_name = ? AND row_id = ?', [r.table, rowId]);
    }
  });
}

function rejectOp(r: PushRow, code: string) {
  const d = getDb();
  d.withTransactionSync(() => {
    d.runSync(
      'INSERT INTO sync_rejects (op_id, table_name, row_id, op, payload, error_code) VALUES (?, ?, ?, ?, ?, ?)',
      [r.maxOpId, r.table, r.rowId, r.op, JSON.stringify(r.payload), code]
    );
    deleteIncluded(r);
  });
}

async function pushChunk(client: SyncClient, table: SyncedTable, chunk: PushRow[], result: PushResult, guard: RunGuard): Promise<void> {
  guard();
  const { error, status } = await client.from(table).upsert(chunk.map((r) => toServerRow(table, r.payload)), { onConflict: CONFLICT_TARGET[table] });
  if (!error) {
    clearOps(chunk);
    result.pushed += chunk.length;
    return;
  }
  if (classifyStatus(status) === 'retry') throw new SyncRetryable(status);
  if (chunk.length === 1) {
    rejectOp(chunk[0], rejectCode(error, status));
    result.rejected += 1;
    return;
  }
  // One bad row fails the whole statement; find it by sending the rows one at a time.
  for (const one of chunk) await pushChunk(client, table, [one], result, guard);
}

/**
 * Throws SyncRetryable on offline, 401, 408, 429 or 5xx; everything pushed before that stays pushed. `guard`
 * runs before every chunk and throws SyncAborted when the library changed hands mid-run (H1).
 */
export async function push(client: SyncClient, guard: RunGuard = () => {}): Promise<PushResult> {
  const adoptionOwed = await adoptShelves(client);
  const { failed, refused } = await resolveBooks(client, readQueue().map(bookIdOf).filter((b): b is string => !!b));
  // Adoption and resolution rewrite ids inside queued payloads, so only now is the queue safe to send.
  const { ready, held } = holdBack(readQueue(), failed, refused, adoptionOwed);

  const result: PushResult = { pushed: 0, rejected: 0, skipped: held };
  for (const table of PUSH_ORDER) {
    const rows = byConflictKey(table, ready.filter((o) => o.table === table));
    for (let i = 0; i < rows.length; i += PUSH_CHUNK) await pushChunk(client, table, rows.slice(i, i + PUSH_CHUNK), result, guard);
  }
  return result;
}
