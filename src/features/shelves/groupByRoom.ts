import type { LibraryRow } from '@/lib/types';

export const UNSHELVED = 'Unshelved';
export interface Room { name: string; rows: LibraryRow[] }

/** One shelf per room (user_books.location). Wishlist books never sit on a room shelf. */
export function groupByRoom(rows: LibraryRow[]): Room[] {
  const map = new Map<string, LibraryRow[]>();
  for (const r of rows) {
    if (r.status === 'wishlist') continue;
    const name = r.location?.trim() || UNSHELVED;
    const list = map.get(name) ?? [];
    list.push(r);
    map.set(name, list);
  }
  return [...map.entries()]
    .map(([name, list]) => ({ name, rows: list }))
    .sort((a, b) => {
      if (a.name === UNSHELVED) return 1;
      if (b.name === UNSHELVED) return -1;
      return b.rows.length - a.rows.length || a.name.localeCompare(b.name);
    });
}

export function mostCopied(rows: LibraryRow[]): { title: string; copies: number } | null {
  const counts = new Map<string, { title: string; copies: number }>();
  for (const r of rows) {
    if (r.status === 'wishlist') continue;
    const e = counts.get(r.bookId) ?? { title: r.book.title, copies: 0 };
    e.copies += 1;
    counts.set(r.bookId, e);
  }
  let best: { title: string; copies: number } | null = null;
  for (const e of counts.values()) if (e.copies >= 2 && (!best || e.copies > best.copies)) best = e;
  return best;
}
