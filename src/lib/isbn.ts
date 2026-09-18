/** ISBN utilities — the scan pipeline's first stop. */

export function clean(raw: string): string {
  return raw.replace(/[^0-9Xx]/g, '').toUpperCase();
}

/**
 * Normalize a scanner payload to ISBN-13 or null.
 * - Books are EAN-13 starting 978/979 (Bookland); anything else is not a book barcode.
 * - iOS reports UPC-A as EAN-13 with a leading 0 — correctly rejected by the prefix check.
 * - ISBN-10 input (manual entry) is upgraded to ISBN-13.
 */
export function normalizeToIsbn13(raw: string): string | null {
  const s = clean(raw);
  if (s.length === 13 && (s.startsWith('978') || s.startsWith('979')) && isValidIsbn13(s)) return s;
  if (s.length === 10 && isValidIsbn10(s)) return isbn10To13(s);
  return null;
}

export function isValidIsbn13(isbn: string): boolean {
  if (!/^\d{13}$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(isbn[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(isbn[12]);
}

export function isValidIsbn10(isbn: string): boolean {
  if (!/^\d{9}[\dX]$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(isbn[i]) * (10 - i);
  sum += isbn[9] === 'X' ? 10 : Number(isbn[9]);
  return sum % 11 === 0;
}

export function isbn10To13(isbn10: string): string {
  const core = '978' + isbn10.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3);
  return core + String((10 - (sum % 10)) % 10);
}

/** Fallback work key when the metadata source has none: normalized title + first author. */
export function fallbackWorkKey(title: string, author?: string): string {
  const norm = (t: string) =>
    t.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  return `local:${norm(title)}|${norm(author ?? '')}`;
}
