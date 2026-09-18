/**
 * Local SQLite schema — the device is the source of truth; Supabase is sync/backup.
 * Mirror of supabase/migrations/0001_init.sql (minus RLS). Version every change.
 */
export const SCHEMA_VERSION = 1;

export const MIGRATIONS: string[] = [
  // v1 — initial
  `
  CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    isbn13 TEXT UNIQUE,
    isbn10 TEXT,
    title TEXT NOT NULL,
    subtitle TEXT,
    authors TEXT NOT NULL DEFAULT '[]',
    publisher TEXT,
    published_year INTEGER,
    edition TEXT,
    genres TEXT NOT NULL DEFAULT '[]',
    page_count INTEGER,
    cover_url TEXT,
    description TEXT,
    work_key TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_books_isbn13 ON books(isbn13);
  CREATE INDEX IF NOT EXISTS idx_books_work_key ON books(work_key);

  CREATE TABLE IF NOT EXISTS user_books (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id),
    status TEXT NOT NULL DEFAULT 'owned',
    condition TEXT,
    location TEXT,
    purchase_date TEXT,
    purchase_price REAL,
    currency TEXT,
    rating INTEGER,
    review TEXT,
    notes TEXT,
    reading_progress INTEGER,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_user_books_book ON user_books(book_id);
  CREATE INDEX IF NOT EXISTS idx_user_books_status ON user_books(status);

  CREATE TABLE IF NOT EXISTS shelves (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    icon TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS shelf_books (
    shelf_id TEXT NOT NULL REFERENCES shelves(id),
    user_book_id TEXT NOT NULL REFERENCES user_books(id),
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (shelf_id, user_book_id)
  );

  CREATE TABLE IF NOT EXISTS loans (
    id TEXT PRIMARY KEY,
    user_book_id TEXT NOT NULL REFERENCES user_books(id),
    borrower_name TEXT NOT NULL,
    loaned_at TEXT NOT NULL,
    due_reminder_at TEXT,
    returned_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  );

  -- Offline-first plumbing
  CREATE TABLE IF NOT EXISTS pending_ops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    row_id TEXT NOT NULL,
    op TEXT NOT NULL,            -- 'upsert' | 'delete'
    payload TEXT NOT NULL,       -- JSON row snapshot
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  `,
];
