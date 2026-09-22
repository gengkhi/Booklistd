import { reactionFor } from '@/features/rating/reactions';
import { canRate, formatShortDate, READING_LABEL, type ReadingFields } from '@/features/reading/readingLogic';
import { UNSHELVED } from '@/features/shelves/shelfRules';

export type CardRowKey = 'shelf' | 'status' | 'rating' | 'started' | 'finished' | 'copies' | 'loan' | 'edition' | 'isbn';
export interface CardRow { key: CardRowKey; label: string; value: string; tappable: boolean }
export interface CardInput {
  copies: { shelfName: string | null; borrower: string | null; loanedAt: string | null }[];
  focusShelfName: string | null;
  wishlist: boolean;
  reading: ReadingFields | null;
  book: { publisher: string | null; publishedYear: number | null; isbn13: string | null };
}

const daysSince = (sqlUtc: string, now: Date) =>
  Math.max(1, Math.round((now.getTime() - new Date(sqlUtc.replace(' ', 'T') + 'Z').getTime()) / 86400000));

/** The library card, top to bottom. Rows only appear when they apply (spec §3.2). */
export function cardRows(input: CardInput, today: string, now: Date): CardRow[] {
  const { copies, reading, book } = input;
  const rows: CardRow[] = [];
  const shelf = copies.length ? input.focusShelfName ?? UNSHELVED : input.wishlist ? 'On your wishlist' : 'Not on your shelves';
  rows.push({ key: 'shelf', label: 'Shelf', value: shelf, tappable: true });
  rows.push({ key: 'status', label: 'Status', value: reading ? READING_LABEL[reading.state] : 'Not started', tappable: true });
  if (reading && canRate(reading.state)) {
    rows.push({ key: 'rating', label: 'Rating', value: reactionFor(reading.rating)?.label ?? 'Rate it', tappable: true });
  }
  if (reading && reading.state !== 'want') {
    rows.push({ key: 'started', label: 'Started', value: reading.startedAt ? formatShortDate(reading.startedAt, today) : 'Add date', tappable: true });
  }
  if (reading && canRate(reading.state)) {
    rows.push({ key: 'finished', label: 'Finished', value: reading.finishedAt ? formatShortDate(reading.finishedAt, today) : 'Add date', tappable: true });
  }
  if (copies.length >= 2) {
    const names = [...new Set(copies.map((c) => c.shelfName ?? UNSHELVED))].join(', ');
    rows.push({ key: 'copies', label: 'Copies', value: `${copies.length} · ${names}`, tappable: true });
  }
  const lent = copies.find((c) => c.borrower);
  if (lent?.borrower) {
    const days = lent.loanedAt ? daysSince(lent.loanedAt, now) : 0;
    rows.push({ key: 'loan', label: 'On loan', value: `${lent.borrower} · ${days} ${days === 1 ? 'day' : 'days'}`, tappable: true });
  }
  const edition = [book.publisher, book.publishedYear].filter(Boolean).join(', ');
  rows.push({ key: 'edition', label: 'Edition', value: edition || '—', tappable: true });
  rows.push({ key: 'isbn', label: 'ISBN', value: book.isbn13 ?? '—', tappable: false });
  return rows;
}
