/** purge-covers core shared by the edge function and Jest. Plain TypeScript, no imports. */

export function bearerToken(header: string | null): string {
  return header && header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
}

/** Constant-time for equal lengths, so the shared secret can't be guessed a character at a time. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const COVER_OBJECT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-\d{13}\.jpg$/i;

export function isCoverObjectPath(p: unknown): p is string {
  return typeof p === 'string' && COVER_OBJECT.test(p);
}

/**
 * Queued paths that are safe to delete: well-formed, and not the current photo of any book_edits row.
 * Soft-deleted rows count too (they can be restored for 30 days); hard-deleting one queues its path again.
 */
export function orphanedPaths(queued: string[], stillReferenced: string[]): string[] {
  const live = new Set(stillReferenced);
  return queued.filter((p) => isCoverObjectPath(p) && !live.has(p));
}
