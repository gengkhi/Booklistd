import type { LibraryRow } from '@/lib/types';

let n = 0;
export function row(p: { title?: string; bookId?: string; shelfId?: string | null; shelfName?: string | null; status?: LibraryRow['status']; createdAt?: string } = {}): LibraryRow {
  n += 1;
  const bookId = p.bookId ?? `b${n}`;
  return {
    id: `ub${n}`, bookId, status: p.status ?? 'owned', condition: null,
    shelfId: p.shelfId ?? null, shelfName: p.shelfName ?? null,
    purchaseDate: null, purchasePrice: null, currency: null, review: null, notes: null,
    readingProgress: null, isFavorite: false, createdAt: p.createdAt ?? '2026-01-01 10:00:00',
    updatedAt: '2026-01-01 10:00:00', deletedAt: null,
    book: {
      id: bookId, isbn13: null, isbn10: null, title: p.title ?? `Book ${n}`, subtitle: null, authors: ['A. Author'],
      publisher: null, publishedYear: null, edition: null, genres: [], pageCount: null, coverUrl: null,
      description: null, workKey: null, source: 'manual',
    },
  };
}
