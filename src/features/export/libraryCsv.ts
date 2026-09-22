/**
 * The library as a spreadsheet (spec §7.2): one row per copy (wishlist included), plus books that only have a reading.
 * RFC 4180 quoting. A cell starting with = + - @ (or tab/CR, per OWASP) gets a leading ' so spreadsheets never run it.
 */
import type { BookStatus, ReadingState } from '@/lib/types';
import { reactionFor } from '@/features/rating/reactions';
import { READING_LABEL } from '@/features/reading/readingLogic';
import { UNSHELVED } from '@/features/shelves/shelfRules';

export interface ExportRow {
  title: string;
  authors: string[];
  isbn13: string | null;
  status: BookStatus | null;
  shelf: string | null;
  readingState: ReadingState | null;
  startedAt: string | null;
  finishedAt: string | null;
  rating: number | null;
  loanedTo: string | null;
  loanedSince: string | null;
}

export const CSV_HEADER = ['Title', 'Authors', 'ISBN-13', 'Status', 'Shelf', 'Reading', 'Started', 'Finished', 'Rating', 'On loan to', 'Loaned since'] as const;
const STATUS_LABEL: Record<BookStatus, string> = { owned: 'At home', wishlist: 'Wishlist' };
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(raw: string | null | undefined): string {
  let v = raw ?? '';
  if (FORMULA_START.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function libraryCsv(rows: ExportRow[]): string {
  const lines = [CSV_HEADER.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.title,
        r.authors.join('; '),
        r.isbn13,
        r.status ? STATUS_LABEL[r.status] : '',
        r.status === 'owned' ? r.shelf ?? UNSHELVED : r.shelf,
        r.readingState ? READING_LABEL[r.readingState] : '',
        r.startedAt,
        r.finishedAt,
        reactionFor(r.rating)?.label ?? '',
        r.loanedTo,
        r.loanedSince ? r.loanedSince.slice(0, 10) : '',
      ].map(csvCell).join(',')
    );
  }
  // The BOM makes Excel read the file as UTF-8 (accented titles, curly quotes).
  return `﻿${lines.join('\r\n')}\r\n`;
}

const pad = (n: number) => String(n).padStart(2, '0');
export function exportFileName(d: Date): string {
  return `booklistd-library-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`;
}
