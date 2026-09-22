/** The offline queue. Every repository write lands here as a row snapshot; the sync engine drains it. */
import { getDb } from './database';

let onEnqueue: (() => void) | null = null;

/** The sync engine listens here to debounce a run after every write (spec §6.1). */
export function setOnEnqueue(fn: (() => void) | null): void {
  onEnqueue = fn;
}

export type OpKind = 'upsert' | 'delete';

export function enqueueOp(table: string, rowId: string, op: OpKind, payload: unknown): void {
  getDb().runSync(
    'INSERT INTO pending_ops (table_name, row_id, op, payload) VALUES (?, ?, ?, ?)',
    [table, rowId, op, JSON.stringify(payload)]
  );
  onEnqueue?.();
}

/** Rows (not ops) still waiting to back up. */
export function pendingCount(): number {
  return (
    getDb().getFirstSync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM (SELECT DISTINCT table_name, row_id FROM pending_ops WHERE table_name != 'shelf_books')`
    )?.n ?? 0
  );
}
