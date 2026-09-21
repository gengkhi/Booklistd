/**
 * Repository — every screen talks to this, never to SQLite directly.
 * Writes also enqueue a pending_op so the sync engine can push later.
 */
import { getDb, newId } from './database';
import type { Book, BookStatus, LibraryRow, OwnershipVerdict, UserBook } from '@/lib/types';
import { isEmptyPatch, type BookEditPatch, type BookEditRow } from '@/features/bookEdits/editLogic';
import { deleteCoverFile, documentUri, resolveCoverUri, saveCoverFile } from '@/features/bookEdits/coverFiles';
import { isValidRating } from '@/features/rating/reactions';

// ---------- mappers ----------
// toBook runs once per row, and a big library has thousands of rows — cache the documents URI.
let docsUri: string | null = null;
const docs = () => (docsUri ??= documentUri());

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
  coverUrl: resolveCoverUri(r.cover_path ?? null, docs()) ?? r.cover_url,
  description: r.description,
  workKey: r.work_key,
  source: r.source,
  edited: !!r.edited,
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
  const exact = d.getFirstSync<any>('SELECT * FROM books_effective WHERE isbn13 = ?', [isbn13]);
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
    const siblings = d.getAllSync<any>('SELECT * FROM books_effective WHERE work_key = ?', [workKey]).map(toBook);
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

export function findBookByIsbn(isbn13: string): Book | null {
  const r = getDb().getFirstSync<any>('SELECT * FROM books_effective WHERE isbn13 = ?', [isbn13]);
  return r ? toBook(r) : null;
}

// ---------- manual details (book_edits) ----------
const toEditRow = (r: any): BookEditRow => ({
  title: r.title,
  subtitle: r.subtitle,
  authors: r.authors ? JSON.parse(r.authors) : null,
  publisher: r.publisher,
  publishedYear: r.published_year,
  edition: r.edition,
  coverPath: r.cover_path,
});

export function getBook(bookId: string): Book | null {
  const r = getDb().getFirstSync<any>('SELECT * FROM books_effective WHERE id = ?', [bookId]);
  return r ? toBook(r) : null;
}

export function getCatalogBook(bookId: string): Book | null {
  const r = getDb().getFirstSync<any>('SELECT * FROM books WHERE id = ?', [bookId]);
  return r ? toBook(r) : null;
}

export function getBookEdit(bookId: string): BookEditRow | null {
  const r = getDb().getFirstSync<any>('SELECT * FROM book_edits WHERE book_id = ?', [bookId]);
  return r ? toEditRow(r) : null;
}

/** Replace the text overrides. Any save makes the edit a pending contribution again. */
export function saveBookEdit(bookId: string, patch: BookEditPatch): void {
  const d = getDb();
  const existing = getBookEdit(bookId);
  if (isEmptyPatch(patch) && !existing?.coverPath) {
    d.runSync('DELETE FROM book_edits WHERE book_id = ?', [bookId]);
    return;
  }
  d.runSync(
    `INSERT INTO book_edits (book_id, title, subtitle, authors, publisher, published_year, edition, cover_path, updated_at, contributed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), NULL)
     ON CONFLICT(book_id) DO UPDATE SET
       title=excluded.title, subtitle=excluded.subtitle, authors=excluded.authors, publisher=excluded.publisher,
       published_year=excluded.published_year, edition=excluded.edition,
       updated_at=datetime('now'), contributed_at=NULL`,
    [
      bookId, patch.title, patch.subtitle, patch.authors ? JSON.stringify(patch.authors) : null,
      patch.publisher, patch.publishedYear, patch.edition, existing?.coverPath ?? null,
    ]
  );
}

/** Copies the photo first; the row is only written once the file exists. */
export async function setBookCover(bookId: string, sourceUri: string): Promise<void> {
  const previous = getBookEdit(bookId)?.coverPath ?? null;
  const rel = await saveCoverFile(bookId, sourceUri);
  getDb().runSync(
    `INSERT INTO book_edits (book_id, cover_path, updated_at, contributed_at) VALUES (?, ?, datetime('now'), NULL)
     ON CONFLICT(book_id) DO UPDATE SET cover_path=excluded.cover_path, updated_at=datetime('now'), contributed_at=NULL`,
    [bookId, rel]
  );
  if (previous && previous !== rel) deleteCoverFile(previous);
}

export function removeBookCover(bookId: string): void {
  const edit = getBookEdit(bookId);
  if (!edit?.coverPath) return;
  const d = getDb();
  const { coverPath, ...text } = edit;
  if (isEmptyPatch(text)) d.runSync('DELETE FROM book_edits WHERE book_id = ?', [bookId]);
  else d.runSync(`UPDATE book_edits SET cover_path = NULL, updated_at = datetime('now'), contributed_at = NULL WHERE book_id = ?`, [bookId]);
  deleteCoverFile(coverPath);
}

export function resetBookEdits(bookId: string): void {
  const coverPath = getBookEdit(bookId)?.coverPath ?? null;
  getDb().runSync('DELETE FROM book_edits WHERE book_id = ?', [bookId]);
  deleteCoverFile(coverPath);
}

/** Edits not yet uploaded to the shared catalog. Uploading ships with sign-in (future sub-project). */
export function listPendingContributions(): (BookEditRow & { bookId: string; updatedAt: string })[] {
  return getDb()
    .getAllSync<any>('SELECT * FROM book_edits WHERE contributed_at IS NULL ORDER BY updated_at')
    .map((r) => ({ ...toEditRow(r), bookId: r.book_id, updatedAt: r.updated_at }));
}

// ---------- user library ----------
/** A live wishlist copy of this exact book, if one exists (checkOwnership ignores wishlist rows). */
export function findWishlistCopy(bookId: string): UserBook | null {
  const r = getDb().getFirstSync<any>(
    `SELECT * FROM user_books WHERE book_id = ? AND status IN ('wishlist', 'want_to_buy') AND deleted_at IS NULL
      ORDER BY created_at LIMIT 1`,
    [bookId]
  );
  return r ? toUserBook(r) : null;
}

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

const LIBRARY_SELECT = `SELECT ub.*, b.id as b_id, b.isbn13, b.isbn10, b.title, b.subtitle, b.authors, b.publisher,
       b.published_year, b.edition, b.genres, b.page_count, b.cover_url, b.cover_path, b.description, b.work_key,
       b.source, b.edited
  FROM user_books ub JOIN books_effective b ON b.id = ub.book_id`;

const toRow = (r: any): LibraryRow => ({ ...toUserBook(r), book: toBook({ ...r, id: r.b_id }) });

export function listLibrary(filter?: { status?: BookStatus }): LibraryRow[] {
  const where = ['ub.deleted_at IS NULL'];
  const params: any[] = [];
  if (filter?.status) {
    where.push('ub.status = ?');
    params.push(filter.status);
  }
  return getDb()
    .getAllSync<any>(`${LIBRARY_SELECT} WHERE ${where.join(' AND ')} ORDER BY ub.created_at DESC`, params)
    .map(toRow);
}

export function getLibraryRow(userBookId: string): LibraryRow | null {
  const r = getDb().getFirstSync<any>(`${LIBRARY_SELECT} WHERE ub.id = ?`, [userBookId]);
  return r ? toRow(r) : null;
}

/** Library-first search: title, authors (JSON text) or ISBN. */
export function searchLibrary(q: string): LibraryRow[] {
  const term = q.trim();
  if (!term) return [];
  const like = `%${term}%`;
  return getDb()
    .getAllSync<any>(
      `${LIBRARY_SELECT} WHERE ub.deleted_at IS NULL AND (b.title LIKE ? OR b.authors LIKE ? OR b.isbn13 LIKE ?)
       ORDER BY b.title COLLATE NOCASE LIMIT 50`,
      [like, like, like]
    )
    .map(toRow);
}

export interface CopyRow extends UserBook {
  borrower: string | null;
  loanedAt: string | null;
}

/** Every owned copy of one book, with its active loan (if any). */
export function listCopiesOfBook(bookId: string): CopyRow[] {
  return getDb()
    .getAllSync<any>(
      `SELECT ub.*, l.borrower_name AS loan_borrower, l.loaned_at AS loan_at
         FROM user_books ub
         LEFT JOIN loans l ON l.user_book_id = ub.id AND l.returned_at IS NULL AND l.deleted_at IS NULL
        WHERE ub.book_id = ? AND ub.deleted_at IS NULL AND ub.status != 'wishlist'
        ORDER BY ub.created_at`,
      [bookId]
    )
    .map((r) => ({ ...toUserBook(r), borrower: r.loan_borrower ?? null, loanedAt: r.loan_at ?? null }));
}

function updateUserBook(userBookId: string, column: 'status' | 'location' | 'rating', value: string | number | null) {
  const d = getDb();
  d.runSync(`UPDATE user_books SET ${column} = ?, updated_at = datetime('now') WHERE id = ?`, [value, userBookId]);
  const row = d.getFirstSync<any>('SELECT * FROM user_books WHERE id = ?', [userBookId]);
  if (row) enqueue('user_books', userBookId, 'upsert', row);
}

export function setStatus(userBookId: string, status: BookStatus): void {
  updateUserBook(userBookId, 'status', status);
}

export function setLocation(userBookId: string, location: string | null): void {
  updateUserBook(userBookId, 'location', location?.trim() || null);
}

/** Dewey rating 1–7 (see src/features/rating/reactions.ts); null clears it. */
export function setRating(userBookId: string, rating: number | null): void {
  if (rating !== null && !isValidRating(rating)) throw new Error('Rating must be a whole number from 1 to 7.');
  updateUserBook(userBookId, 'rating', rating);
}

export function listRooms(): string[] {
  return getDb()
    .getAllSync<{ location: string }>(
      `SELECT DISTINCT location FROM user_books
        WHERE location IS NOT NULL AND TRIM(location) != '' AND deleted_at IS NULL
        ORDER BY location COLLATE NOCASE`
    )
    .map((r) => r.location);
}

export function libraryStats() {
  const d = getDb();
  const one = (sql: string) => d.getFirstSync<{ n: number }>(sql)?.n ?? 0;
  return {
    totalBooks: one(`SELECT COUNT(*) n FROM user_books WHERE deleted_at IS NULL AND status != 'wishlist'`),
    estValue: one(`SELECT COALESCE(SUM(purchase_price), 0) n FROM user_books WHERE deleted_at IS NULL`),
    activeLoans: one(`SELECT COUNT(*) n FROM loans WHERE returned_at IS NULL AND deleted_at IS NULL`),
    wishlist: one(`SELECT COUNT(*) n FROM user_books WHERE deleted_at IS NULL AND status = 'wishlist'`),
  };
}
