/**
 * Pure sync decisions (spec §6.1). No I/O: push.ts, pull.ts and resolveBooks.ts read and write.
 * Timestamps: SQLite keeps 'YYYY-MM-DD HH:MM:SS' (UTC); the server speaks ISO-8601 timestamptz.
 */

export const SYNCED_TABLES = ['shelves', 'user_books', 'readings', 'book_edits', 'loans', 'profiles'] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];
/** Parents before children, so foreign keys resolve on the server (push) and locally (pull). */
export const PUSH_ORDER: readonly SyncedTable[] = SYNCED_TABLES;
export const PUSH_CHUNK = 200;
export const PULL_PAGE = 500;
export const STALE_AFTER_MS = 30 * 86_400_000;

export const CONFLICT_TARGET: Record<SyncedTable, string> = {
  shelves: 'id', user_books: 'id', readings: 'user_id,book_id', book_edits: 'user_id,book_id', loans: 'id', profiles: 'id',
};
/** Local primary key, pending_ops.row_id, and the pull cursor's tiebreaker. */
export const ROW_KEY: Record<SyncedTable, 'id' | 'book_id'> = {
  shelves: 'id', user_books: 'id', readings: 'id', book_edits: 'book_id', loans: 'id', profiles: 'id',
};

export const isSyncedTable = (t: string): t is SyncedTable => (SYNCED_TABLES as readonly string[]).includes(t);

export interface PendingOp { id: number; table_name: string; row_id: string; op: string; payload: string }
export interface CoalescedOp { table: SyncedTable; rowId: string; op: 'upsert' | 'delete'; payload: Record<string, unknown>; maxOpId: number }

/** Latest snapshot per (table, row), in the order rows were last touched. */
export function coalesce(ops: PendingOp[]): { ops: CoalescedOp[]; dropped: number[] } {
  const latest = new Map<string, CoalescedOp>();
  const dropped: number[] = [];
  for (const o of [...ops].sort((a, b) => a.id - b.id)) {
    let payload: unknown = null;
    try {
      payload = JSON.parse(o.payload);
    } catch {
      payload = null;
    }
    if (!isSyncedTable(o.table_name) || !payload || typeof payload !== 'object') {
      dropped.push(o.id);
      continue;
    }
    const key = `${o.table_name}\u0000${o.row_id}`;
    latest.delete(key);
    latest.set(key, { table: o.table_name, rowId: o.row_id, op: o.op === 'delete' ? 'delete' : 'upsert', payload: payload as Record<string, unknown>, maxOpId: o.id });
  }
  return { ops: [...latest.values()], dropped };
}

export function pushOrder(tables: string[]): SyncedTable[] {
  return PUSH_ORDER.filter((t) => tables.includes(t));
}

const SERVER_COLUMNS: Record<SyncedTable, readonly string[]> = {
  shelves: ['id', 'name', 'sort_order', 'icon', 'plank', 'created_at', 'deleted_at'],
  user_books: ['id', 'book_id', 'status', 'condition', 'purchase_date', 'purchase_price', 'currency', 'review', 'notes', 'reading_progress', 'is_favorite', 'shelf_id', 'created_at', 'deleted_at'],
  readings: ['id', 'book_id', 'state', 'started_at', 'finished_at', 'rating', 'created_at', 'deleted_at'],
  book_edits: ['book_id', 'title', 'subtitle', 'authors', 'publisher', 'published_year', 'edition', 'cover_object', 'deleted_at'],
  loans: ['id', 'user_book_id', 'borrower_name', 'loaned_at', 'due_reminder_at', 'returned_at', 'deleted_at'],
  profiles: ['id', 'display_name'],
};
const LOCAL_COLUMNS: Record<SyncedTable, readonly string[]> = {
  shelves: ['id', 'name', 'sort_order', 'icon', 'plank', 'created_at', 'updated_at', 'deleted_at'],
  user_books: ['id', 'book_id', 'status', 'condition', 'purchase_date', 'purchase_price', 'currency', 'review', 'notes', 'reading_progress', 'is_favorite', 'shelf_id', 'created_at', 'updated_at', 'deleted_at'],
  readings: ['id', 'book_id', 'state', 'started_at', 'finished_at', 'rating', 'created_at', 'updated_at', 'deleted_at'],
  book_edits: ['book_id', 'title', 'subtitle', 'authors', 'publisher', 'published_year', 'edition', 'cover_object', 'updated_at'],
  loans: ['id', 'user_book_id', 'borrower_name', 'loaned_at', 'due_reminder_at', 'returned_at', 'updated_at', 'deleted_at'],
  profiles: ['id', 'display_name', 'updated_at'],
};
const TIMESTAMPS = new Set(['created_at', 'updated_at', 'deleted_at', 'loaned_at', 'due_reminder_at', 'returned_at']);

export function sqlToIso(v: unknown): unknown {
  return typeof v === 'string' && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(v) ? `${v.replace(' ', 'T')}Z` : v;
}

export function isoToSql(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const utc = /^(\d{4}-\d\d-\d\d)T(\d\d:\d\d:\d\d)(?:\.\d+)?(?:Z|\+00:00|\+00)$/.exec(v);
  if (utc) return `${utc[1]} ${utc[2]}`;
  if (/^\d{4}-\d\d-\d\dT/.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 19).replace('T', ' ');
  }
  return v;
}

function parseAuthors(v: unknown): unknown {
  if (typeof v !== 'string') return v ?? null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

/** Whitelisted server columns only: never user_id (auth.uid() default) or updated_at (server trigger). */
export function toServerRow(table: SyncedTable, local: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of SERVER_COLUMNS[table]) {
    let v: unknown = local[c] ?? null;
    if (TIMESTAMPS.has(c)) v = sqlToIso(v);
    if (c === 'is_favorite') v = !!v;
    if (table === 'book_edits' && c === 'authors') v = parseAuthors(v);
    out[c] = v;
  }
  return out;
}

export function toLocalRow(table: SyncedTable, server: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of LOCAL_COLUMNS[table]) {
    let v: unknown = server[c] ?? null;
    if (TIMESTAMPS.has(c)) v = isoToSql(v);
    if (c === 'is_favorite') v = v ? 1 : 0;
    if (table === 'book_edits' && c === 'authors' && v !== null) v = JSON.stringify(v);
    out[c] = v;
  }
  return out;
}

/** A catalog row for the local books cache. Placeholders get the same "ISBN …" title the scanner uses. */
export function toLocalBook(s: Record<string, unknown>): Record<string, unknown> {
  const isbn13 = (s.isbn13 as string | null) ?? null;
  return {
    id: s.id,
    isbn13,
    isbn10: s.isbn10 ?? null,
    title: (s.title as string | null) ?? (isbn13 ? `ISBN ${isbn13}` : 'Untitled'),
    subtitle: s.subtitle ?? null,
    authors: JSON.stringify(s.authors ?? []),
    publisher: s.publisher ?? null,
    published_year: s.published_year ?? null,
    edition: s.edition ?? null,
    genres: JSON.stringify(s.genres ?? []),
    page_count: s.page_count ?? null,
    cover_url: s.cover_url ?? null,
    description: s.description ?? null,
    work_key: s.work_key ?? null,
    source: s.source ?? 'manual',
    updated_at: isoToSql(s.updated_at) ?? '1970-01-01 00:00:00',
    server_known: 1,
  };
}

export type PullDecision = 'keepLocal' | 'skip' | 'apply';

/** Spec §6.3: a pending local op keeps local (it will push and win); otherwise the server row applies, deletes included. */
export function applyPulled(localRow: object | null, pulledRow: { deleted_at?: unknown }, hasPending: boolean): PullDecision {
  if (hasPending) return 'keepLocal';
  if (!localRow && pulledRow.deleted_at) return 'skip';
  return 'apply';
}

export interface Cursor { updatedAt: string; id: string; pulledAt: number }

export function nextCursor(rows: Record<string, unknown>[], key: 'id' | 'book_id' = 'id', prev: Cursor | null = null, nowMs: number = Date.now()): Cursor | null {
  const last = rows[rows.length - 1];
  if (!last) return prev ? { ...prev, pulledAt: nowMs } : null;
  return { updatedAt: String(last.updated_at), id: String(last[key]), pulledAt: nowMs };
}

export function serializeCursor(c: Cursor): string {
  return JSON.stringify(c);
}

export function parseCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw);
    return typeof c?.updatedAt === 'string' && typeof c?.id === 'string' && typeof c?.pulledAt === 'number' ? c : null;
  } catch {
    return null;
  }
}

/** Device time is only used for elapsed time here; ordering always uses the server's updated_at. */
export function isStale(c: Cursor | null, nowMs: number): boolean {
  return c !== null && nowMs - c.pulledAt > STALE_AFTER_MS;
}

/** (updated_at, key) > cursor, as a PostgREST or= filter. Values are quoted because timestamps contain ':' and '+'. */
export function keysetFilter(c: Cursor, key: 'id' | 'book_id'): string {
  return `updated_at.gt."${c.updatedAt}",and(updated_at.eq."${c.updatedAt}",${key}.gt."${c.id}")`;
}

/** sync_rejects.table_name for a cover photo the bucket refused; row_id is the book id. */
export const COVER_REJECTS = 'covers';

/**
 * sync_meta key marking a book's refused cover photo as discarded (Task 17). Deliberately not a sync_rejects
 * row: those count toward rejectedCount() and block resetIfStale, and a discarded photo must do neither. It's
 * cleared the moment a new photo supersedes it, or a pulled server change resolves the row (db/repository.ts
 * clearCoverReject; sync/pull.ts applyRow).
 */
const DISCARD_COVER_PREFIX = 'discard:covers:';
export const discardedCoverKey = (bookId: string) => `${DISCARD_COVER_PREFIX}${bookId}`;

/** sync_rejects.table_name for a book `ensure` definitely refused (a non-429 4xx, I5); row_id is the local book id. */
export const BOOK_REJECTS = 'books';

/**
 * sync_meta key marking a refused book discarded (I5): ensure isn't asked about it again, and its rows stay
 * queued, unsynced, on this phone (they aren't retried with backoff either). Wiped with the rest of sync_meta.
 */
export const discardedBookKey = (bookId: string) => `discard:books:${bookId}`;

/**
 * SQL condition for a query that aliases book_edits as `e`: true when this book's local photo hasn't reached
 * the backup and isn't waiting on the person — a live 'covers' reject (Task 16) or a discarded marker
 * (Task 17) both mean "waiting on the person", not "unsaved". The one definition of "un-uploaded photo",
 * shared by covers.ts (which rows to offer for upload), pull.ts applyRow (whether a pulled row must keep the
 * local photo instead) and resetIfStale (whether the stale-device reset can proceed) — no per-row JS loops.
 */
export const UNUPLOADED_PHOTO_SQL = `
  e.cover_path IS NOT NULL AND e.cover_object IS NULL
  AND NOT EXISTS (SELECT 1 FROM sync_rejects j WHERE j.table_name = '${COVER_REJECTS}' AND j.row_id = e.book_id)
  AND NOT EXISTS (SELECT 1 FROM sync_meta m WHERE m.key = '${DISCARD_COVER_PREFIX}' || e.book_id)
`;

export function classifyStatus(status: number): 'retry' | 'reject' {
  // 401 is an expired or missing session, not a bad row: retry once auth refreshes (spec §6.2).
  return status >= 400 && status < 500 && ![401, 408, 429].includes(status) ? 'reject' : 'retry';
}

export function backoffMs(attempt: number): number {
  return Math.min(5000 * 2 ** Math.max(0, attempt - 1), 300_000);
}

export function rejectCode(error: { code?: string } | null, status: number): string {
  return error?.code ? error.code : `http_${status}`;
}
