/**
 * Sync engine — Phase 3. Category-2 offline-first: optimistic write queue,
 * last-write-wins on updated_at, per-user data so conflicts are rare.
 *
 * push: drain pending_ops oldest-first -> supabase upserts (retry on failure, keep order per row_id)
 * pull: select rows where updated_at > cursor (sync_meta['pull_cursor']) -> apply locally
 *       (skip any row that still has a pending local op newer than the server row)
 *
 * Trigger on: app foreground, connectivity regained, after N local writes.
 */
import { getDb } from '@/db/database';
import { supabase, supabaseConfigured } from '@/api/supabase';

export async function pushPendingOps(): Promise<number> {
  if (!supabaseConfigured) return 0;
  const d = getDb();
  const ops = d.getAllSync<any>('SELECT * FROM pending_ops ORDER BY id ASC LIMIT 100');
  let pushed = 0;
  for (const op of ops) {
    const payload = JSON.parse(op.payload);
    const { error } =
      op.op === 'delete'
        ? await supabase.from(op.table_name).update({ deleted_at: new Date().toISOString() }).eq('id', op.row_id)
        : await supabase.from(op.table_name).upsert(payload);
    if (error) break; // keep order; retry next run
    d.runSync('DELETE FROM pending_ops WHERE id = ?', [op.id]);
    pushed++;
  }
  return pushed;
}

export async function pullChanges(): Promise<void> {
  if (!supabaseConfigured) return;
  // TODO(Phase 3): pull user_books/shelves/loans where updated_at > cursor,
  // apply with LWW against local updated_at, then advance sync_meta.pull_cursor.
}
