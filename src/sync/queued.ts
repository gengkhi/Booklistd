/**
 * Rewrites ids inside rows that are waiting to push (pending_ops) or waiting on the user (sync_rejects),
 * so a local id that was swapped for a server id never goes out stale. Call inside the caller's transaction.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

export interface QueuedOp { table_name: string; row_id: string }

/**
 * For each queued op on one of `tables` whose payload mentions `fromId`, `rewrite` edits the parsed payload in
 * place and returns the op's new row_id, or null to leave the op untouched.
 */
export function rewriteQueued(
  d: SQLiteDatabase,
  tables: readonly string[],
  fromId: string,
  rewrite: (op: QueuedOp, payload: Record<string, unknown>) => string | null
): void {
  const inList = tables.map(() => '?').join(',');
  for (const queue of ['pending_ops', 'sync_rejects'] as const) {
    const rows = d.getAllSync<{ id: number; table_name: string; row_id: string; payload: string }>(
      `SELECT id, table_name, row_id, payload FROM ${queue} WHERE table_name IN (${inList}) AND instr(payload, ?) > 0`,
      [...tables, fromId]
    );
    for (const op of rows) {
      let p: unknown = null;
      try {
        p = JSON.parse(op.payload);
      } catch {
        continue;
      }
      if (!p || typeof p !== 'object') continue;
      const rowId = rewrite(op, p as Record<string, unknown>);
      if (rowId === null) continue;
      d.runSync(`UPDATE ${queue} SET payload = ?, row_id = ? WHERE id = ?`, [JSON.stringify(p), rowId, op.id]);
    }
  }
}

/** Drops every queued op (pending and rejected) for one row, e.g. a row a merge removed. */
export function dropQueued(d: SQLiteDatabase, table: string, rowId: string): void {
  for (const queue of ['pending_ops', 'sync_rejects'] as const) {
    d.runSync(`DELETE FROM ${queue} WHERE table_name = ? AND row_id = ?`, [table, rowId]);
  }
}
