export type BookStatus = 'owned' | 'wishlist';

export type Plank = 'bus' | 'tomato' | 'pool' | 'grass' | 'plum';

/** A place a copy lives. bookCount = live At home copies on it. */
export interface ShelfRow {
  id: string;
  name: string;
  plank: Plank;
  sortOrder: number;
  bookCount: number;
}

export type ReadingState = 'want' | 'reading' | 'read' | 'dnf';

/** Where the user is with a book — independent of owning it. One live row per book. */
export interface Reading {
  id: string;
  bookId: string;
  state: ReadingState;
  startedAt: string | null; // 'YYYY-MM-DD'
  finishedAt: string | null; // 'YYYY-MM-DD'
  rating: number | null; // Dewey reaction 1–7
  createdAt: string;
  updatedAt: string;
}

export interface Book {
  id: string;
  isbn13: string | null;
  isbn10: string | null;
  title: string;
  subtitle: string | null;
  authors: string[]; // JSON in SQLite
  publisher: string | null;
  publishedYear: number | null;
  edition: string | null;
  genres: string[];
  pageCount: number | null;
  coverUrl: string | null;
  description: string | null;
  workKey: string | null;
  source: 'google' | 'openlibrary' | 'isbndb' | 'manual';
  /** True when the user has overridden any catalog field or added a cover photo (book_edits row exists). */
  edited?: boolean;
}

export interface UserBook {
  id: string;
  bookId: string;
  status: BookStatus;
  condition: string | null;
  shelfId: string | null;
  /** Name of the live shelf this copy sits on (joined), null = Unshelved. */
  shelfName: string | null;
  purchaseDate: string | null;
  purchasePrice: number | null;
  currency: string | null;
  review: string | null;
  notes: string | null;
  readingProgress: number | null; // current page
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface LibraryRow extends UserBook {
  book: Book;
}

export interface OwnershipVerdict {
  owned: boolean;
  exactIsbnMatch: boolean;
  /** Same work, different ISBN — powers the duplicate warning. */
  workMatch: boolean;
  copies: number;
  book: Book | null;
  userBooks: UserBook[];
  /** Wishlist copies of this book or another edition of the same work (only filled when not owned). */
  wishlistCopies: UserBook[];
  /** The live reading for this book, else for another edition of the same work. */
  reading: Reading | null;
}

export interface ReadingRow extends Reading {
  book: Book;
  ownership: 'owned' | 'wishlist' | null;
}
