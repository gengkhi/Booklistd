import type { Book } from '@/lib/types';

/** Raw text as typed in the edit form. */
export interface EditForm { title: string; authors: string; subtitle: string; publisher: string; year: string; edition: string }

/** Per-field overrides. null = "use the catalog value". Mirrors the book_edits columns. */
export interface BookEditPatch {
  title: string | null;
  subtitle: string | null;
  authors: string[] | null;
  publisher: string | null;
  publishedYear: number | null;
  edition: string | null;
}
export type BookEditRow = BookEditPatch & { coverPath: string | null };

export const EMPTY_PATCH: BookEditPatch = { title: null, subtitle: null, authors: null, publisher: null, publishedYear: null, edition: null };

/** The server's book_edits caps (S3): 300 characters per text field, at most 20 authors. */
export const EDIT_LIMITS = { text: 300, authors: 20 } as const;

const YEAR = /^\d{4}$/;
const PLACEHOLDER_TITLE = /^ISBN \d{13}$/;

export function formFromBook(b: Book): EditForm {
  return {
    title: b.title,
    authors: b.authors.join(', '),
    subtitle: b.subtitle ?? '',
    publisher: b.publisher ?? '',
    year: b.publishedYear != null ? String(b.publishedYear) : '',
    edition: b.edition ?? '',
  };
}

export function yearError(year: string): string | null {
  const y = year.trim();
  return y === '' || YEAR.test(y) ? null : 'Use a four-digit year, like 2013.';
}

export function canSave(f: EditForm): boolean {
  return f.title.trim().length > 0 && yearError(f.year) === null;
}

/** Only fields that differ from the catalog become overrides; blanks fall back to the catalog. */
export function toEditPatch(f: EditForm, catalog: Book): BookEditPatch {
  const cap = (v: string) => v.trim().slice(0, EDIT_LIMITS.text).trim();
  const text = (v: string, current: string | null) => {
    const t = cap(v);
    return t === '' || t === (current ?? '') ? null : t;
  };
  // Extra authors are dropped on save, as the backup would refuse more than 20.
  const authors = f.authors.split(',').map(cap).filter(Boolean).slice(0, EDIT_LIMITS.authors);
  const sameAuthors = authors.length === catalog.authors.length && authors.every((a, i) => a === catalog.authors[i]);
  const y = f.year.trim();
  const year = YEAR.test(y) ? Number(y) : null;
  return {
    title: text(f.title, catalog.title),
    subtitle: text(f.subtitle, catalog.subtitle),
    authors: authors.length === 0 || sameAuthors ? null : authors,
    publisher: text(f.publisher, catalog.publisher),
    publishedYear: year === null || year === catalog.publishedYear ? null : year,
    edition: text(f.edition, catalog.edition),
  };
}

export function isEmptyPatch(p: BookEditPatch): boolean {
  return Object.values(p).every((v) => v === null);
}

export function needsDetails(b: Pick<Book, 'title' | 'authors'>): boolean {
  return PLACEHOLDER_TITLE.test(b.title.trim()) || b.authors.length === 0;
}

/**
 * The same merge the books_effective SQL view performs (keep the two in sync).
 * Cover resolution (cover_path → file URI) happens in the repository, not here.
 */
export function applyEdits(catalog: Book, edit: BookEditRow | null): Book {
  if (!edit) return { ...catalog, edited: false };
  return {
    ...catalog,
    title: edit.title ?? catalog.title,
    subtitle: edit.subtitle ?? catalog.subtitle,
    authors: edit.authors ?? catalog.authors,
    publisher: edit.publisher ?? catalog.publisher,
    publishedYear: edit.publishedYear ?? catalog.publishedYear,
    edition: edit.edition ?? catalog.edition,
    edited: true,
  };
}
