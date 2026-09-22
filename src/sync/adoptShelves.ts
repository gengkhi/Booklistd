/**
 * Spec §6.2 step 4: on the first push after a claim, a local shelf whose lower(trim(name)) matches a server
 * shelf takes the server id, so a reinstall or second phone doesn't end up with two "Study" shelves.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb } from '@/db/database';
import { ADOPT_SHELVES_KEY, deleteMeta, getMeta } from '@/db/localData';
import { normaliseName } from '@/features/shelves/shelfRules';
import { SyncRetryable, type SyncClient } from './client';
import { classifyStatus } from './logic';
import { rewriteQueued } from './queued';

/** The server refused the shelf lookup outright (a non-retryable 4xx). The flag stays, so the next push asks again. */
export class ShelfAdoptionRefused extends Error {
  constructor(readonly status: number) {
    super(`shelf adoption refused (${status})`);
    this.name = 'ShelfAdoptionRefused';
  }
}

export function adoptionPlan(local: { id: string; name: string }[], server: { id: string; name: string }[]): { from: string; to: string }[] {
  const byName = new Map<string, string>();
  for (const s of server) {
    const k = normaliseName(s.name);
    if (!byName.has(k)) byName.set(k, s.id);
  }
  const taken = new Set<string>();
  const plan: { from: string; to: string }[] = [];
  for (const l of local) {
    const to = byName.get(normaliseName(l.name));
    if (!to || to === l.id || taken.has(to)) continue;
    taken.add(to);
    plan.push({ from: l.id, to });
  }
  return plan;
}

/** The rewrite itself; the caller holds the transaction. A shelf already here under `toId` absorbs `fromId`. */
function moveShelf(d: SQLiteDatabase, fromId: string, toId: string): void {
  if (d.getFirstSync('SELECT 1 FROM shelves WHERE id = ?', [toId])) d.runSync('DELETE FROM shelves WHERE id = ?', [fromId]);
  else d.runSync('UPDATE shelves SET id = ? WHERE id = ?', [toId, fromId]);
  // shelf_books is local-only; a copy already on the target shelf keeps that row.
  d.runSync('UPDATE OR IGNORE shelf_books SET shelf_id = ? WHERE shelf_id = ?', [toId, fromId]);
  d.runSync('DELETE FROM shelf_books WHERE shelf_id = ?', [fromId]);
  d.runSync('UPDATE user_books SET shelf_id = ? WHERE shelf_id = ?', [toId, fromId]);
  rewriteQueued(d, ['shelves', 'user_books'], fromId, (op, p) => {
    if (op.table_name === 'shelves' && p.id === fromId) {
      p.id = toId;
      return toId;
    }
    if (op.table_name === 'user_books' && p.shelf_id === fromId) {
      p.shelf_id = toId;
      return op.row_id;
    }
    return null;
  });
}

function inTransaction(d: SQLiteDatabase, task: () => void): void {
  d.withTransactionSync(() => {
    d.execSync('PRAGMA defer_foreign_keys = ON');
    task();
  });
}

/** Gives local shelf `fromId` the id `toId`, copies and queued payloads included. Opens its own transaction. */
export function rewriteShelfId(fromId: string, toId: string): void {
  if (fromId === toId) return;
  const d = getDb();
  inTransaction(d, () => moveShelf(d, fromId, toId));
}

/**
 * Runs once after a claim (ADOPT_SHELVES_KEY). Every adoption and clearing the flag happen in one transaction
 * (ruling F14), so never call this from inside one. A failed fetch keeps the flag for the next push.
 */
export async function adoptShelvesOnClaim(client: SyncClient): Promise<void> {
  if (getMeta(ADOPT_SHELVES_KEY) !== '1') return;
  const { data, error, status } = await client.from('shelves').select('id,name').is('deleted_at', null);
  if (error) {
    if (classifyStatus(status) === 'retry') throw new SyncRetryable(status);
    throw new ShelfAdoptionRefused(status);
  }
  const d = getDb();
  const local = d.getAllSync<{ id: string; name: string }>('SELECT id, name FROM shelves WHERE deleted_at IS NULL ORDER BY sort_order, created_at');
  const plan = adoptionPlan(local, (data ?? []) as { id: string; name: string }[]);
  inTransaction(d, () => {
    for (const { from, to } of plan) moveShelf(d, from, to);
    deleteMeta(ADOPT_SHELVES_KEY);
  });
}
