/**
 * Repository — every screen talks to this, never to SQLite directly.
 * Writes also enqueue a pending_op so the sync engine can push later.
 */
import { getDb, newId } from './database';
import type { Book, BookStatus, LibraryRow, OwnershipVerdict, Plank, Reading, ReadingRow, ReadingState, ShelfRow, UserBook } from '@/lib/types';
import { isEmptyPatch, type BookEditPatch, type BookEditRow } from '@/features/bookEdits/editLogic';
import { deleteCoverFile, documentUri, resolveCoverUri, saveCoverFile } from '@/features/bookEdits/coverFiles';
import { isValidRating } from '@/features/rating/reactions';
import { applyReadingState, canRate, clampDates, todayIso, type ReadingFields } from '@/features/reading/readingLogic';
import { isPlank, nextPlank, normaliseName } from '@/features/shelves/shelfRules';

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
  shelfId: r.shelf_id ?? null,
  shelfName: r.shelf_name ?? null,
  purchaseDate: r.purchase_date,
  purchasePrice: r.purchase_price,
  currency: r.currency,
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

/** A stale/unknown/legacy-room-name id is treated as Unshelved rather than tripping the shelf_id FK. */
const liveShelfId = (id: string | null | undefined): string | null =>
  id && getDb().getFirstSync('SELECT 1 FROM shelves WHERE id = ? AND deleted_at IS NULL', [id]) ? id : null;

// ---------- the Store Mode hot path (must stay <150ms, fully offline) ----------
export function checkOwnership(isbn13: string, scannedWorkKey?: string | null): OwnershipVerdict {
  const d = getDb();
  const exact = d.getFirstSync<any>('SELECT * FROM books_effective WHERE isbn13 = ?', [isbn13]);
  const book = exact ? toBook(exact) : null;
  const workKey = scannedWorkKey ?? book?.workKey ?? null;
  const reading = findReadingForWork(book?.id ?? null, workKey);

  const copiesWhere = (bookIds: string[], statusSql: string): UserBook[] => {
    if (bookIds.length === 0) return [];
    const q = bookIds.map(() => '?').join(',');
    return d
      .getAllSync<any>(
        `SELECT ub.*, s.name AS shelf_name FROM user_books ub
           LEFT JOIN shelves s ON s.id = ub.shelf_id AND s.deleted_at IS NULL
          WHERE ub.book_id IN (${q}) AND ub.deleted_at IS NULL AND ub.${statusSql}`,
        bookIds
      )
      .map(toUserBook);
  };
  const ownedCopies = (ids: string[]) => copiesWhere(ids, "status != 'wishlist'");

  const exactCopies = book ? ownedCopies([book.id]) : [];
  if (exactCopies.length > 0) {
    return { owned: true, exactIsbnMatch: true, workMatch: false, copies: exactCopies.length, book, userBooks: exactCopies, wishlistCopies: [], reading };
  }

  // Work-level match: same work, different edition/ISBN → duplicate warning.
  const siblings = workKey ? d.getAllSync<any>('SELECT * FROM books_effective WHERE work_key = ?', [workKey]).map(toBook) : [];
  const workCopies = ownedCopies(siblings.map((b) => b.id));
  if (workCopies.length > 0) {
    const ownedBook = siblings.find((b) => b.id === workCopies[0].bookId) ?? siblings[0];
    return { owned: true, exactIsbnMatch: false, workMatch: true, copies: workCopies.length, book: ownedBook, userBooks: workCopies, wishlistCopies: [], reading };
  }

  const ids = [...new Set([...(book ? [book.id] : []), ...siblings.map((b) => b.id)])];
  const wishlistCopies = copiesWhere(ids, "status = 'wishlist'");
  return { owned: false, exactIsbnMatch: false, workMatch: false, copies: 0, book, userBooks: [], wishlistCopies, reading };
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
    `SELECT * FROM user_books WHERE book_id = ? AND status = 'wishlist' AND deleted_at IS NULL
      ORDER BY created_at LIMIT 1`,
    [bookId]
  );
  return r ? toUserBook(r) : null;
}

export function addUserBook(bookId: string, status: BookStatus, shelfId?: string | null): UserBook {
  const d = getDb();
  const id = newId();
  d.runSync(
    `INSERT INTO user_books (id, book_id, status, shelf_id) VALUES (?, ?, ?, ?)`,
    [id, bookId, status, status === 'owned' ? liveShelfId(shelfId) : null]
  );
  enqueue('user_books', id, 'upsert', d.getFirstSync<any>('SELECT * FROM user_books WHERE id = ?', [id]));
  const row = d.getFirstSync<any>(
    `SELECT ub.*, s.name AS shelf_name FROM user_books ub LEFT JOIN shelves s ON s.id = ub.shelf_id AND s.deleted_at IS NULL WHERE ub.id = ?`,
    [id]
  );
  return toUserBook(row);
}

const LIBRARY_SELECT = `SELECT ub.*, s.name AS shelf_name, b.id as b_id, b.isbn13, b.isbn10, b.title, b.subtitle, b.authors, b.publisher,
       b.published_year, b.edition, b.genres, b.page_count, b.cover_url, b.cover_path, b.description, b.work_key,
       b.source, b.edited
  FROM user_books ub
  JOIN books_effective b ON b.id = ub.book_id
  LEFT JOIN shelves s ON s.id = ub.shelf_id AND s.deleted_at IS NULL`;

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
      `SELECT ub.*, s.name AS shelf_name, l.borrower_name AS loan_borrower, l.loaned_at AS loan_at
         FROM user_books ub
         LEFT JOIN shelves s ON s.id = ub.shelf_id AND s.deleted_at IS NULL
         LEFT JOIN loans l ON l.user_book_id = ub.id AND l.returned_at IS NULL AND l.deleted_at IS NULL
        WHERE ub.book_id = ? AND ub.deleted_at IS NULL AND ub.status != 'wishlist'
        ORDER BY ub.created_at`,
      [bookId]
    )
    .map((r) => ({ ...toUserBook(r), borrower: r.loan_borrower ?? null, loanedAt: r.loan_at ?? null }));
}

type CopyField = 'status' | 'shelf_id';
function updateUserBook(userBookId: string, fields: Partial<Record<CopyField, string | null>>) {
  const keys = Object.keys(fields) as CopyField[];
  if (keys.length === 0) return;
  const d = getDb();
  d.runSync(
    `UPDATE user_books SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
    [...keys.map((k) => fields[k] ?? null), userBookId]
  );
  const row = d.getFirstSync<any>('SELECT * FROM user_books WHERE id = ?', [userBookId]);
  if (row) enqueue('user_books', userBookId, 'upsert', row);
}

export function setStatus(userBookId: string, status: BookStatus): void {
  // A wishlist copy has no place in the house.
  updateUserBook(userBookId, status === 'wishlist' ? { status, shelf_id: null } : { status });
}

/** Put an At home copy on a shelf (null = Unshelved). Wishlist copies are left alone. */
export function setCopyShelf(copyId: string, shelfId: string | null): void {
  const r = getDb().getFirstSync<{ status: string }>('SELECT status FROM user_books WHERE id = ?', [copyId]);
  if (r?.status !== 'owned') return;
  updateUserBook(copyId, { shelf_id: liveShelfId(shelfId) });
}

/** Soft-delete a copy (e.g. another edition's wishlist entry once this edition is shelved). */
export function removeCopy(userBookId: string): void {
  const d = getDb();
  d.runSync(`UPDATE user_books SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, [userBookId]);
  enqueue('user_books', userBookId, 'delete', d.getFirstSync<any>('SELECT * FROM user_books WHERE id = ?', [userBookId]));
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

// ---------- readings (one live row per book) ----------
const toReading = (r: any): Reading => ({
  id: r.id,
  bookId: r.book_id,
  state: r.state,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  rating: r.rating,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function getReading(bookId: string): Reading | null {
  const r = getDb().getFirstSync<any>('SELECT * FROM readings WHERE book_id = ? AND deleted_at IS NULL', [bookId]);
  return r ? toReading(r) : null;
}

/** This book's reading, else the most recent reading of another edition of the same work. */
export function findReadingForWork(bookId: string | null, workKey: string | null): Reading | null {
  if (bookId) {
    const exact = getReading(bookId);
    if (exact) return exact;
  }
  if (!workKey) return null;
  const r = getDb().getFirstSync<any>(
    `SELECT r.* FROM readings r JOIN books b ON b.id = r.book_id
      WHERE b.work_key = ? AND r.deleted_at IS NULL ORDER BY r.updated_at DESC LIMIT 1`,
    [workKey]
  );
  return r ? toReading(r) : null;
}

/** Update the live row, revive a soft-deleted one, or insert — never a second live row. */
function writeReading(bookId: string, f: ReadingFields): Reading {
  const d = getDb();
  const existing = d.getFirstSync<any>(
    'SELECT id FROM readings WHERE book_id = ? ORDER BY deleted_at IS NULL DESC, updated_at DESC LIMIT 1',
    [bookId]
  );
  const id = existing?.id ?? newId();
  if (existing) {
    d.runSync(
      `UPDATE readings SET state = ?, started_at = ?, finished_at = ?, rating = ?, deleted_at = NULL, updated_at = datetime('now') WHERE id = ?`,
      [f.state, f.startedAt, f.finishedAt, f.rating, id]
    );
  } else {
    d.runSync(
      'INSERT INTO readings (id, book_id, state, started_at, finished_at, rating) VALUES (?, ?, ?, ?, ?, ?)',
      [id, bookId, f.state, f.startedAt, f.finishedAt, f.rating]
    );
  }
  const row = d.getFirstSync<any>('SELECT * FROM readings WHERE id = ?', [id]);
  enqueue('readings', id, 'upsert', row);
  return toReading(row);
}

/** null clears the reading (soft delete, rating included). A revived row starts fresh. */
export function setReadingState(bookId: string, state: ReadingState | null, today: string = todayIso()): Reading | null {
  const prev = getReading(bookId);
  if (state === null) {
    if (!prev) return null;
    const d = getDb();
    d.runSync(`UPDATE readings SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, [prev.id]);
    enqueue('readings', prev.id, 'delete', d.getFirstSync<any>('SELECT * FROM readings WHERE id = ?', [prev.id]));
    return null;
  }
  return writeReading(bookId, applyReadingState(prev, state, today));
}

export function setReadingDates(bookId: string, dates: { startedAt?: string | null; finishedAt?: string | null }): Reading {
  const prev = getReading(bookId);
  if (!prev) throw new Error('There is no reading to date yet.');
  const startedAt = dates.startedAt !== undefined ? dates.startedAt : prev.startedAt;
  const finishedAt = dates.finishedAt !== undefined ? dates.finishedAt : prev.finishedAt;
  return writeReading(bookId, { state: prev.state, rating: prev.rating, ...clampDates(startedAt, finishedAt) });
}

/** Dewey rating 1–7 on a finished or abandoned reading; null clears it. */
export function setReadingRating(bookId: string, rating: number | null): Reading {
  if (rating !== null && !isValidRating(rating)) throw new Error('Rating must be a whole number from 1 to 7.');
  const prev = getReading(bookId);
  if (!prev || !canRate(prev.state)) throw new Error('Only finished or abandoned books can be rated.');
  return writeReading(bookId, { state: prev.state, startedAt: prev.startedAt, finishedAt: prev.finishedAt, rating });
}

const READING_ORDER: Record<ReadingState, string> = {
  reading: 'r.started_at DESC, r.updated_at DESC',
  want: 'r.updated_at DESC',
  read: 'r.finished_at IS NULL, r.finished_at DESC, r.updated_at DESC',
  dnf: 'r.finished_at IS NULL, r.finished_at DESC, r.updated_at DESC',
};

export function listReadings(state: ReadingState): ReadingRow[] {
  return getDb()
    .getAllSync<any>(
      `SELECT r.*, b.id AS b_id, b.isbn13, b.isbn10, b.title, b.subtitle, b.authors, b.publisher, b.published_year,
              b.edition, b.genres, b.page_count, b.cover_url, b.cover_path, b.description, b.work_key, b.source, b.edited,
              CASE
                WHEN EXISTS (SELECT 1 FROM user_books ub WHERE ub.book_id = r.book_id AND ub.deleted_at IS NULL AND ub.status != 'wishlist') THEN 'owned'
                WHEN EXISTS (SELECT 1 FROM user_books ub WHERE ub.book_id = r.book_id AND ub.deleted_at IS NULL AND ub.status = 'wishlist') THEN 'wishlist'
              END AS ownership
         FROM readings r JOIN books_effective b ON b.id = r.book_id
        WHERE r.deleted_at IS NULL AND r.state = ?
        ORDER BY ${READING_ORDER[state]}`,
      [state]
    )
    .map((r) => ({ ...toReading(r), book: toBook({ ...r, id: r.b_id }), ownership: r.ownership ?? null }));
}

export function listCurrentlyReading(): ReadingRow[] {
  return listReadings('reading');
}

// ---------- book detail (keyed by book; copy ids still resolve) ----------
export interface BookDetail {
  book: Book;
  copies: CopyRow[];
  wishlistCopy: UserBook | null;
  reading: Reading | null;
  /** The copy whose shelf spot detail shows: the one that was tapped, else the first At home copy. */
  focusCopyId: string | null;
}

export function getBookDetail(id: string): BookDetail | null {
  const copy = getDb().getFirstSync<{ id: string; book_id: string }>(
    'SELECT id, book_id FROM user_books WHERE id = ? AND deleted_at IS NULL',
    [id]
  );
  const bookId = copy?.book_id ?? id;
  const book = getBook(bookId);
  if (!book) return null;
  const copies = listCopiesOfBook(bookId);
  const focusCopyId = copy && copies.some((cp) => cp.id === copy.id) ? copy.id : copies[0]?.id ?? null;
  return { book, copies, wishlistCopy: findWishlistCopy(bookId), reading: getReading(bookId), focusCopyId };
}

// ---------- shelves (places) ----------
export class ShelfNameTaken extends Error {
  constructor(public existing: string) {
    super(`You already have a shelf called ${existing}.`);
    this.name = 'ShelfNameTaken';
  }
}

const toShelf = (r: any): ShelfRow => ({
  id: r.id,
  name: r.name,
  plank: isPlank(r.plank) ? r.plank : 'bus',
  sortOrder: r.sort_order,
  bookCount: r.book_count ?? 0,
});

function enqueueShelf(id: string, op: 'upsert' | 'delete' = 'upsert') {
  enqueue('shelves', id, op, getDb().getFirstSync<any>('SELECT * FROM shelves WHERE id = ?', [id]));
}

export function listShelves(): ShelfRow[] {
  return getDb()
    .getAllSync<any>(
      `SELECT s.*, (SELECT COUNT(*) FROM user_books ub
                     WHERE ub.shelf_id = s.id AND ub.deleted_at IS NULL AND ub.status = 'owned') AS book_count
         FROM shelves s WHERE s.deleted_at IS NULL ORDER BY s.sort_order, s.created_at`
    )
    .map(toShelf);
}

/** New shelf at the end with the next plank; an existing name (any case) returns that shelf instead. */
export function createShelf(name: string): ShelfRow {
  const clean = name.trim();
  if (!clean) throw new Error('Give the shelf a name.');
  const shelves = listShelves();
  const existing = shelves.find((s) => normaliseName(s.name) === normaliseName(clean));
  if (existing) return existing;
  const id = newId();
  const sortOrder = shelves.length ? Math.max(...shelves.map((s) => s.sortOrder)) + 1 : 0;
  const plank = nextPlank(shelves);
  getDb().runSync('INSERT INTO shelves (id, name, sort_order, plank) VALUES (?, ?, ?, ?)', [id, clean, sortOrder, plank]);
  enqueueShelf(id);
  return { id, name: clean, plank, sortOrder, bookCount: 0 };
}

export function renameShelf(id: string, name: string): void {
  const clean = name.trim();
  if (!clean) throw new Error('Give the shelf a name.');
  const shelves = listShelves();
  if (!shelves.some((s) => s.id === id)) throw new Error('That shelf no longer exists.');
  const clash = shelves.find((s) => s.id !== id && normaliseName(s.name) === normaliseName(clean));
  if (clash) throw new ShelfNameTaken(clash.name);
  getDb().runSync(`UPDATE shelves SET name = ?, updated_at = datetime('now') WHERE id = ?`, [clean, id]);
  enqueueShelf(id);
}

export function setShelfPlank(id: string, plank: Plank): void {
  if (!isPlank(plank)) throw new Error('Pick one of the five plank colours.');
  if (!listShelves().some((s) => s.id === id)) throw new Error('That shelf no longer exists.');
  getDb().runSync(`UPDATE shelves SET plank = ?, updated_at = datetime('now') WHERE id = ?`, [plank, id]);
  enqueueShelf(id);
}

/** Given ids take 0..n-1; any live shelf not listed keeps its relative order after them. */
export function reorderShelves(ids: string[]): void {
  const d = getDb();
  const current = listShelves().map((s) => s.id);
  const given = ids.filter((id) => current.includes(id));
  const order = [...given, ...current.filter((id) => !given.includes(id))];
  d.withTransactionSync(() => {
    order.forEach((id, i) => {
      d.runSync(`UPDATE shelves SET sort_order = ?, updated_at = datetime('now') WHERE id = ?`, [i, id]);
      enqueueShelf(id);
    });
  });
}

/** Moves the shelf's copies to moveTo (or Unshelved), then soft-deletes it — all or nothing. */
export function deleteShelf(id: string, moveTo: string | null): void {
  const d = getDb();
  if (moveTo === id) throw new Error("Books can't move to the shelf you're deleting.");
  const shelves = listShelves();
  if (!shelves.some((s) => s.id === id)) throw new Error('That shelf no longer exists.');
  if (moveTo && !shelves.some((s) => s.id === moveTo)) throw new Error('Pick a shelf that still exists.');
  d.withTransactionSync(() => {
    for (const c of d.getAllSync<{ id: string }>('SELECT id FROM user_books WHERE shelf_id = ? AND deleted_at IS NULL', [id])) {
      updateUserBook(c.id, { shelf_id: moveTo });
    }
    d.runSync(`UPDATE shelves SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, [id]);
    enqueueShelf(id, 'delete');
  });
}
