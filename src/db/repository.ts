/**
 * Repository — every screen talks to this, never to SQLite directly.
 * Writes also enqueue a pending_op so the sync engine can push later.
 */
import { getDb, newId } from './database';
import type { Book, BookStatus, LibraryRow, OwnershipVerdict, UserBook } from '@/lib/types';

// ---------- mappers ----------
const toBook = (r: any): Book => ({
  id: r.id,
  isbn13: r.isbn13,
  isbn10: r.isbn10,
  title: r.title,
  subtitle: r.subtitle,
  authors: JSON.parse(r.authors ?? '[]'),
  publisher: r.publisher,
  publishedYear: r.published_year,
  edition: r.edition,
  genres: JSON.parse(r.genres ?? '[]'),
  pageCount: r.page_count,
  coverUrl: r.cover_url,
  description: r.description,
  workKey: r.work_key,
  source: r.source,
});

const toUserBook = (r: any): UserBook => ({
  id: r.id,
  bookId: r.book_id,
  status: r.status,
  condition: r.condition,
  location: r.location,
  purchaseDate: r.purchase_date,
  purchasePrice: r.purchase_price,
  currency: r.currency,
  rating: r.rating,
  review: r.review,
  notes: r.notes,
  readingProgress: r.reading_progress,
  isFavorite: !!r.is_favorite,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
});

function enqueue(table: string, rowId: string, op: 'upsert' | 'delete', payload: unknown) {
  getDb().runSync(
    'INSERT INTO pending_ops (table_name, row_id, op, payload) VALUES (?, ?, ?, ?)',
    [table, rowId, op, JSON.stringify(payload)]
  );
}

// ---------- the Store Mode hot path (must stay <150ms, fully offline) ----------
export function checkOwnership(isbn13: string, scannedWorkKey?: string | null): OwnershipVerdict {
  const d = getDb();
  const exact = d.getFirstSync<any>('SELECT * FROM books WHERE isbn13 = ?', [isbn13]);
  const book = exact ? toBook(exact) : null;

  const copiesFor = (bookIds: string[]): UserBook[] => {
    if (bookIds.length === 0) return [];
    const q = bookIds.map(() => '?').join(',');
    return d
      .getAllSync<any>(
        `SELECT * FROM user_books WHERE book_id IN (${q}) AND deleted_at IS NULL AND status != 'wishlist'`,
        bookIds
      )
      .map(toUserBook);
  };

  const exactCopies = book ? copiesFor([book.id]) : [];
  if (exactCopies.length > 0) {
    return { owned: true, exactIsbnMatch: true, workMatch: false, copies: exactCopies.length, book, userBooks: exactCopies };
  }

  // Work-level match: same work, different edition/ISBN → duplicate warning.
  const workKey = scannedWorkKey ?? book?.workKey ?? null;
  if (workKey) {
    const siblings = d.getAllSync<any>('SELECT * FROM books WHERE work_key = ?', [workKey]).map(toBook);
    const workCopies = copiesFor(siblings.map((b) => b.id));
    if (workCopies.length > 0) {
      const ownedBook = siblings.find((b) => b.id === workCopies[0].bookId) ?? siblings[0];
      return { owned: true, exactIsbnMatch: false, workMatch: true, copies: workCopies.length, book: ownedBook, userBooks: workCopies };
    }
  }

  return { owned: false, exactIsbnMatch: false, workMatch: false, copies: 0, book, userBooks: [] };
}

// ---------- books catalog cache ----------
export function upsertBook(b: Omit<Book, 'id'> & { id?: string }): Book {
  const d = getDb();
  const existing = b.isbn13 ? d.getFirstSync<any>('SELECT * FROM books WHERE isbn13 = ?', [b.isbn13]) : null;
  const id = existing?.id ?? b.id ?? newId();
  d.runSync(
    `INSERT INTO books (id, isbn13, isbn10, title, subtitle, authors, publisher, published_year, edition, genres, page_count, cover_url, description, work_key, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       title=excluded.title, subtitle=excluded.subtitle, authors=excluded.authors,
       publisher=excluded.publisher, published_year=excluded.published_year, edition=excluded.edition,
       genres=excluded.genres, page_count=excluded.page_count, cover_url=excluded.cover_url,
       description=excluded.description, work_key=excluded.work_key, source=excluded.source,
       updated_at=datetime('now')`,
    [
      id, b.isbn13, b.isbn10, b.title, b.subtitle, JSON.stringify(b.authors),
      b.publisher, b.publishedYear, b.edition, JSON.stringify(b.genres),
      b.pageCount, b.coverUrl, b.description, b.workKey, b.source,
    ]
  );
  return { ...b, id } as Book;
}

// ---------- user library ----------
export function addUserBook(bookId: string, status: BookStatus, location?: string): UserBook {
  const d = getDb();
  const id = newId();
  d.runSync(
    `INSERT INTO user_books (id, book_id, status, location) VALUES (?, ?, ?, ?)`,
    [id, bookId, status, location ?? null]
  );
  const row = d.getFirstSync<any>('SELECT * FROM user_books WHERE id = ?', [id]);
  const ub = toUserBook(row);
  enqueue('user_books', id, 'upsert', row);
  return ub;
}

export function listLibrary(filter?: { status?: BookStatus }): LibraryRow[] {
  const d = getDb();
  const where = ['ub.deleted_at IS NULL'];
  const params: any[] = [];
  if (filter?.status) {
    where.push('ub.status = ?');
    params.push(filter.status);
  }
  const rows = d.getAllSync<any>(
    `SELECT ub.*, b.id as b_id, b.isbn13, b.isbn10, b.title, b.subtitle, b.authors, b.publisher,
            b.published_year, b.edition, b.genres, b.page_count, b.cover_url, b.description, b.work_key, b.source
     FROM user_books ub JOIN books b ON b.id = ub.book_id
     WHERE ${where.join(' AND ')}
     ORDER BY ub.created_at DESC`,
    params
  );
  return rows.map((r) => ({ ...toUserBook(r), book: toBook({ ...r, id: r.b_id }) }));
}

export function getLibraryRow(userBookId: string): LibraryRow | null {
  const d = getDb();
  const r = d.getFirstSync<any>(
    `SELECT ub.*, b.id as b_id, b.isbn13, b.isbn10, b.title, b.subtitle, b.authors, b.publisher,
            b.published_year, b.edition, b.genres, b.page_count, b.cover_url, b.description, b.work_key, b.source
     FROM user_books ub JOIN books b ON b.id = ub.book_id WHERE ub.id = ?`,
    [userBookId]
  );
  return r ? { ...toUserBook(r), book: toBook({ ...r, id: r.b_id }) } : null;
}

export function libraryStats() {
  const d = getDb();
  const total = d.getFirstSync<{ n: number }>(
    `SELECT COUNT(*) n FROM user_books WHERE deleted_at IS NULL AND status != 'wishlist'`
  );
  const value = d.getFirstSync<{ v: number }>(
    `SELECT COALESCE(SUM(purchase_price), 0) v FROM user_books WHERE deleted_at IS NULL`
  );
  return { totalBooks: total?.n ?? 0, estValue: value?.v ?? 0 };
}
