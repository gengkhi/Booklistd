/**
 * Local SQLite schema — the device is the source of truth; Supabase is sync/backup.
 * Mirror of supabase/migrations/0001_init.sql (minus RLS). Version every change.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { migrateV3ReadingTracking } from './migrations/v3ReadingTracking';
import { migrateV4ShelfCreation } from './migrations/v4ShelfCreation';

export const SCHEMA_VERSION = 4;

export const MIGRATIONS: (string | ((d: SQLiteDatabase) => void))[] = [
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
  // v2 — user overrides for catalog data (manual details + cover photos), merged by a view.
  // Keep books_effective in sync with applyEdits() in src/features/bookEdits/editLogic.ts.
  `
  CREATE TABLE IF NOT EXISTS book_edits (
    book_id TEXT PRIMARY KEY REFERENCES books(id),
    title TEXT,
    subtitle TEXT,
    authors TEXT,
    publisher TEXT,
    published_year INTEGER,
    edition TEXT,
    cover_path TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    contributed_at TEXT
  );

  CREATE VIEW IF NOT EXISTS books_effective AS
  SELECT b.id, b.isbn13, b.isbn10,
         COALESCE(e.title, b.title) AS title,
         COALESCE(e.subtitle, b.subtitle) AS subtitle,
         COALESCE(e.authors, b.authors) AS authors,
         COALESCE(e.publisher, b.publisher) AS publisher,
         COALESCE(e.published_year, b.published_year) AS published_year,
         COALESCE(e.edition, b.edition) AS edition,
         b.genres, b.page_count, b.cover_url, e.cover_path,
         b.description, b.work_key, b.source,
         (e.book_id IS NOT NULL) AS edited
    FROM books b LEFT JOIN book_edits e ON e.book_id = b.id;
  `,
  // v3 — reading tracking (JS: reuses the tested legacy mapping). See src/db/migrations/v3ReadingTracking.ts.
  migrateV3ReadingTracking,
  // v4 — shelves are places: shelves.plank, user_books.shelf_id; location retired. See src/db/migrations/v4ShelfCreation.ts.
  migrateV4ShelfCreation,
];
