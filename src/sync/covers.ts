/** Spec §6.7: cover photos in the private covers bucket, under the owner's folder. Signed URLs are never logged. */
import { Directory, File, Paths } from 'expo-file-system';
import { supabase } from '@/api/supabase';
import { getDb } from '@/db/database';
import { enqueueOp } from '@/db/pendingOps';
import { coverFileName, deleteCoverFile } from '@/features/bookEdits/coverFiles';
import { SyncRetryable, type SyncClient } from './client';
import { classifyStatus, COVER_REJECTS, UNUPLOADED_PHOTO_SQL } from './logic';

export { COVER_REJECTS };

export const SIGNED_URL_SECONDS = 60;

/**
 * A fresh path per upload, so other phones can tell a replaced photo from the old one. Lowercase uuid text,
 * matching the server CHECK `^<user_id>/<book_id>-[0-9]{13}\.jpg$`.
 */
export function coverObjectPath(userId: string, bookId: string, nowMs: number = Date.now()): string {
  return `${userId.toLowerCase()}/${bookId.toLowerCase()}-${nowMs}.jpg`;
}

const storageStatus = (e: unknown): number => {
  const err = (e ?? {}) as { status?: unknown; statusCode?: unknown };
  const n = typeof err.status === 'number' ? err.status : Number(err.statusCode);
  return Number.isFinite(n) ? n : 0;
};

/** A refused photo waits on the person (Try again / Discard), so it no longer counts as "not yet uploaded". */
function rejectCover(bookId: string, coverPath: string, status: number) {
  const d = getDb();
  d.withTransactionSync(() => {
    d.runSync('DELETE FROM sync_rejects WHERE table_name = ? AND row_id = ?', [COVER_REJECTS, bookId]);
    d.runSync(
      'INSERT INTO sync_rejects (op_id, table_name, row_id, op, payload, error_code) VALUES (0, ?, ?, ?, ?, ?)',
      [COVER_REJECTS, bookId, 'upsert', JSON.stringify({ book_id: bookId, cover_path: coverPath }), `http_${status}`]
    );
  });
}

/**
 * Uploads photos whose book_edits row has already pushed (no pending op) and whose book is a catalog id, then
 * queues the row with its new cover_object (the queued op triggers the follow-up run that pushes it).
 * Offline, throttled, 401 or 5xx throws SyncRetryable, so the engine backs off; any other 4xx records a
 * 'covers' reject and the photo stays local (the row syncs without it). A photo the person discarded (Task 17)
 * is left out the same way, with no reject. Returns how many photos were uploaded. Never call inside a transaction.
 */
export async function uploadPendingCovers(client: SyncClient, userId: string, now: () => number = Date.now): Promise<number> {
  const d = getDb();
  const rows = d.getAllSync<{ book_id: string; cover_path: string }>(
    `SELECT e.book_id, e.cover_path FROM book_edits e JOIN books b ON b.id = e.book_id
      WHERE ${UNUPLOADED_PHOTO_SQL} AND b.server_known = 1
        AND NOT EXISTS (SELECT 1 FROM pending_ops p WHERE p.table_name = 'book_edits' AND p.row_id = e.book_id)`
  );
  let uploaded = 0;
  for (const r of rows) {
    let body: ArrayBuffer;
    try {
      const file = new File(Paths.document, r.cover_path);
      if (!file.exists) continue;
      const bytes = await file.bytes();
      body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    } catch {
      continue; // An unreadable file stays local; the rest still upload.
    }
    const path = coverObjectPath(userId, r.book_id, now());
    let error: unknown = null;
    try {
      ({ error } = await client.storage.from('covers').upload(path, body, { contentType: 'image/jpeg', upsert: true }));
    } catch {
      throw new SyncRetryable(0); // No response: offline.
    }
    if (error) {
      const status = storageStatus(error);
      if (status === 0 || classifyStatus(status) === 'retry') throw new SyncRetryable(status);
      rejectCover(r.book_id, r.cover_path, status);
      continue;
    }
    // Only if the photo wasn't replaced or removed while it uploaded. One transaction, so a crash can't leave
    // cover_object set locally with nothing queued to push it.
    let applied = false;
    d.withTransactionSync(() => {
      d.runSync(`UPDATE book_edits SET cover_object = ?, updated_at = datetime('now') WHERE book_id = ? AND cover_path = ? AND cover_object IS NULL`, [
        path, r.book_id, r.cover_path,
      ]);
      const row = d.getFirstSync<Record<string, unknown>>('SELECT * FROM book_edits WHERE book_id = ? AND cover_object = ?', [r.book_id, path]);
      if (row) {
        enqueueOp('book_edits', r.book_id, 'upsert', row);
        applied = true;
      }
    });
    if (applied) uploaded++;
    else {
      // Replaced or removed mid-upload: nothing references this object, so take it back (best effort).
      try {
        await client.storage.from('covers').remove([path]);
      } catch {
        // The object lingers in the owner's folder; harmless.
      }
    }
  }
  return uploaded;
}

const inflight = new Map<string, Promise<string | null>>();

async function download(bookId: string, coverObject: string, client: Pick<SyncClient, 'storage'>): Promise<string | null> {
  const d = getDb();
  const rel = coverFileName(bookId);
  try {
    const { data, error } = await client.storage.from('covers').createSignedUrl(coverObject, SIGNED_URL_SECONDS);
    if (error || !data?.signedUrl) return null;
    const dir = new Directory(Paths.document, 'covers');
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    await File.downloadFileAsync(data.signedUrl, new File(Paths.document, rel));
  } catch {
    return null; // Offline or gone: the painted cover stays, and the next showing tries again.
  }
  // A pull may have replaced or removed the photo while it downloaded; then this file is stale.
  const { changes } = d.runSync('UPDATE book_edits SET cover_path = ? WHERE book_id = ? AND cover_object = ? AND cover_path IS NULL', [
    rel, bookId, coverObject,
  ]);
  if (changes === 0) {
    deleteCoverFile(rel);
    return null;
  }
  return rel;
}

/**
 * Downloads a synced photo the first time it's shown. Concurrent calls for one photo share a download; a photo
 * replaced meanwhile gets its own. Never rejects.
 */
export function ensureLocal(bookId: string, client: Pick<SyncClient, 'storage'> = supabase): Promise<string | null> {
  let row: { cover_path: string | null; cover_object: string | null } | null;
  try {
    row = getDb().getFirstSync('SELECT cover_path, cover_object FROM book_edits WHERE book_id = ?', [bookId]);
  } catch {
    return Promise.resolve(null);
  }
  if (!row?.cover_object) return Promise.resolve(null);
  if (row.cover_path) return Promise.resolve(row.cover_path);
  const key = row.cover_object; // the path names the book, so it keys one photo
  const running = inflight.get(key);
  if (running) return running;
  const p = download(bookId, key, client)
    .catch(() => null)
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
