/**
 * Whose library this is (spec §4) and the two things that change it: claim and wipe.
 * The owner lives in sync_meta under OWNER_KEY. Nothing from a previous owner is ever pushed under a new session.
 */
import { getDb } from './database';
import { enqueueOp } from './pendingOps';
import { deleteAllCoverFiles } from '@/features/bookEdits/coverFiles';

export const OWNER_KEY = 'owner_user_id';
/** Set when a non-empty library is claimed; the first push matches local shelves to server shelves by name. */
export const ADOPT_SHELVES_KEY = 'adopt_shelves';

/** Children before parents, so foreign keys never block the wipe. Tables added later are skipped until they exist. */
const WIPE_ORDER = [
  'loans', 'readings', 'book_edits', 'shelf_books', 'user_books', 'shelves', 'books', 'profiles',
  'pending_ops', 'sync_rejects', 'sync_meta',
] as const;

/** Live rows snapshotted on claim, in push order. */
const CLAIM_SNAPSHOTS: { table: string; key: string; sql: string }[] = [
  { table: 'shelves', key: 'id', sql: 'SELECT * FROM shelves WHERE deleted_at IS NULL' },
  { table: 'user_books', key: 'id', sql: 'SELECT * FROM user_books WHERE deleted_at IS NULL' },
  { table: 'readings', key: 'id', sql: 'SELECT * FROM readings WHERE deleted_at IS NULL' },
  { table: 'book_edits', key: 'book_id', sql: 'SELECT * FROM book_edits' },
  { table: 'loans', key: 'id', sql: 'SELECT * FROM loans WHERE deleted_at IS NULL' },
];

export function getMeta(key: string): string | null {
  return getDb().getFirstSync<{ value: string | null }>('SELECT value FROM sync_meta WHERE key = ?', [key])?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  getDb().runSync('INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}

export function deleteMeta(key: string): void {
  getDb().runSync('DELETE FROM sync_meta WHERE key = ?', [key]);
}

export function getOwner(): string | null {
  return getMeta(OWNER_KEY);
}

/** Rows the server refused (sync_rejects). F7 ruling: these also mean "not backed up" for the sign-out warning. */
export function rejectedCount(): number {
  return getDb().getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM sync_rejects')?.n ?? 0;
}

/** Takes ownership. A non-empty library is snapshotted once, so all of it uploads on the first push. */
export function claimLibrary(userId: string): number {
  const d = getDb();
  let n = 0;
  let shelves = 0;
  d.withTransactionSync(() => {
    for (const s of CLAIM_SNAPSHOTS) {
      for (const row of d.getAllSync<Record<string, unknown>>(s.sql)) {
        enqueueOp(s.table, String(row[s.key]), 'upsert', row);
        n++;
        if (s.table === 'shelves') shelves++;
      }
    }
    setMeta(OWNER_KEY, userId);
    if (shelves > 0) setMeta(ADOPT_SHELVES_KEY, '1');
  });
  return n;
}

/** Deletes every local row (the schema and PRAGMA user_version stay) and the covers folder. */
export function wipeLocalData(): void {
  const d = getDb();
  d.withTransactionSync(() => {
    for (const t of WIPE_ORDER) {
      const exists = d.getFirstSync("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", [t]);
      if (exists) d.runSync(`DELETE FROM ${t}`);
    }
  });
  deleteAllCoverFiles();
}

/** Apple returns the name only on the first authorisation, so it is stored at once and queued for backup. */
export function saveProfileName(userId: string, name: string): void {
  const d = getDb();
  d.runSync(
    `INSERT INTO profiles (id, display_name, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = datetime('now')`,
    [userId, name.slice(0, 80)]
  );
  enqueueOp('profiles', userId, 'upsert', d.getFirstSync('SELECT * FROM profiles WHERE id = ?', [userId]));
}
