export type BookStatus = 'owned' | 'reading' | 'read' | 'wishlist' | 'loaned' | 'want_to_buy';

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
  location: string | null;
  purchaseDate: string | null;
  purchasePrice: number | null;
  currency: string | null;
  rating: number | null;
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
}
