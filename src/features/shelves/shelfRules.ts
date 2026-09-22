import type { LibraryRow, Plank, ShelfRow } from '@/lib/types';
import { ink } from '@/theme/palette';

export const UNSHELVED = 'Unshelved';
export const PLANK_INKS: readonly Plank[] = ['bus', 'tomato', 'pool', 'grass', 'plum'];
/** Offered when you have no shelves yet; tapping one creates it. */
export const SUGGESTED_SHELVES: readonly string[] = ['Living room', 'Bedroom', 'Study'];

export const normaliseName = (s: string): string => s.trim().toLowerCase();
export const isPlank = (p: unknown): p is Plank => typeof p === 'string' && (PLANK_INKS as readonly string[]).includes(p);
export const plankColor = (p: Plank): string => ink[p];

/** The ink after the last shelf's (by order), cycling; the first shelf gets bus. */
export function nextPlank(existing: { plank: Plank; sortOrder: number }[]): Plank {
  if (existing.length === 0) return 'bus';
  const last = existing.reduce((a, b) => (b.sortOrder > a.sortOrder ? b : a));
  return PLANK_INKS[(PLANK_INKS.indexOf(last.plank) + 1) % PLANK_INKS.length];
}

interface MigratedShelf { key: string; name: string; sortOrder: number; plank: Plank }

/**
 * Pre-v4 rooms (free-text location) → shelves. Names merge by normaliseName; the display spelling is the
 * one most copies used (ties: earliest copy). Shelves are ordered by book count, ties by name — the order
 * the bookcase already showed. Blank names are Unshelved (null).
 */
export function migrateLocations(copies: { id: string; location: string | null; createdAt: string }[]) {
  const groups = new Map<string, { spellings: Map<string, { n: number; first: string }>; total: number }>();
  const copyShelf: Record<string, string | null> = {};
  for (const c of copies) {
    const name = c.location?.trim() ?? '';
    if (!name) {
      copyShelf[c.id] = null;
      continue;
    }
    const key = normaliseName(name);
    copyShelf[c.id] = key;
    const g = groups.get(key) ?? { spellings: new Map(), total: 0 };
    const s = g.spellings.get(name) ?? { n: 0, first: c.createdAt };
    s.n += 1;
    if (c.createdAt < s.first) s.first = c.createdAt;
    g.spellings.set(name, s);
    g.total += 1;
    groups.set(key, g);
  }
  const named = [...groups.entries()]
    .map(([key, g]) => {
      const [name] = [...g.spellings.entries()].sort((a, b) => b[1].n - a[1].n || a[1].first.localeCompare(b[1].first))[0];
      return { key, name, total: g.total };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const shelves: MigratedShelf[] = [];
  for (const [i, s] of named.entries()) shelves.push({ key: s.key, name: s.name, sortOrder: i, plank: nextPlank(shelves) });
  return { shelves, copyShelf };
}

export interface ShelfGroup { shelf: ShelfRow | null; name: string; rows: LibraryRow[] }

/** Bookcase shelves in your order (empty ones included), then Unshelved if it has books. Wishlist copies never sit on a shelf. */
export function groupByShelf(rows: LibraryRow[], shelves: ShelfRow[]): ShelfGroup[] {
  const known = new Set(shelves.map((s) => s.id));
  const byShelf = new Map<string, LibraryRow[]>();
  const unshelved: LibraryRow[] = [];
  for (const r of rows) {
    if (r.status === 'wishlist') continue;
    if (r.shelfId && known.has(r.shelfId)) byShelf.set(r.shelfId, [...(byShelf.get(r.shelfId) ?? []), r]);
    else unshelved.push(r);
  }
  const groups: ShelfGroup[] = [...shelves]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => ({ shelf: s, name: s.name, rows: byShelf.get(s.id) ?? [] }));
  if (unshelved.length) groups.push({ shelf: null, name: UNSHELVED, rows: unshelved });
  return groups;
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
