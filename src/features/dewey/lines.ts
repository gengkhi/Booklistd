/**
 * Dewey's lines — the wit contract (spec §5): true, data-driven, ≤ 70 chars,
 * roasts the library, never the owner. Never used for errors or permissions.
 */
import { hashString } from '@/features/shelves/spineStyle';
import { UNSHELVED, type ShelfGroup } from '@/features/shelves/shelfRules';

export const MAX_LINE = 70;
const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
export const countWord = (n: number) => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n));
export const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…');

export const EMPTY_SHELF = "An empty shelf. I've reserved it for you.";

export interface ShelvesContext {
  totalBooks: number;
  rooms: { name: string; count: number }[];
  mostCopied: { title: string; copies: number } | null;
  loaned: number;
}

export function shelvesLines(ctx: ShelvesContext): string[] {
  if (ctx.totalBooks === 0) return [EMPTY_SHELF];
  const out: string[] = [];
  if (ctx.mostCopied) {
    out.push(`${countWord(ctx.mostCopied.copies)} copies of ${clip(ctx.mostCopied.title, 22)}. I'm not judging. (I am.)`);
  }
  const big = ctx.rooms[0];
  if (big && big.count >= 20 && big.name !== UNSHELVED) {
    out.push(`${big.count} books in the ${clip(big.name.toLowerCase(), 16)}. Guests are impressed. Or worried.`);
  }
  if (ctx.loaned === 1) out.push('One book is out visiting a friend. I miss it.');
  if (ctx.loaned > 1) out.push(`${countWord(ctx.loaned)} books are out visiting friends. I keep a list.`);
  if (ctx.totalBooks >= 100) out.push(`${ctx.totalBooks} books. That's a lot of evenings.`);
  out.push("I dusted. You're welcome.");
  return out.map((l) => clip(l, MAX_LINE));
}

export function ownedLine(copies: number, exactIsbnMatch: boolean): string {
  if (!exactIsbnMatch) return 'Same book, different coat. You already own it.';
  if (copies <= 1) return 'Already yours. Put it back gently.';
  return `Copy #${copies + 1}? You own ${countWord(copies).toLowerCase()}. I've counted.`;
}

const NEW_FIND_LINES = ["Ooh. We don't have this one. Yet.", "A stranger! Let's make introductions."];
export const newFindLine = (seed: number) => NEW_FIND_LINES[Math.abs(seed) % NEW_FIND_LINES.length];

export function wishlistLine(count: number): string {
  if (count === 0) return 'Nothing wished for. Suspiciously content.';
  if (count >= 20) return 'At this rate it needs its own room.';
  return `${countWord(count)} ${count === 1 ? 'maybe' : 'maybes'}. Someday is a real day.`;
}

export function searchAside(query: string, ownedMatches: number): string {
  const q = clip(query.trim(), 20);
  if (!q) return 'Your shelves first, then the catalog.';
  if (ownedMatches >= 2) return `Searching "${q}". You own ${countWord(ownedMatches).toLowerCase()} already.`;
  if (ownedMatches === 1) return 'On your shelves already. Of course it is.';
  return `No "${q}" on your shelves. Yet.`;
}

const NOTES = ['the respectable ones', 'do not alphabetize', 'the overflow', 'handle with care', 'the good light', 'in no particular order'];

/** Tape note beside a room tag: a true duplicate call-out, otherwise a stable affectionate label. */
export function roomNote(room: Pick<ShelfGroup, 'name' | 'rows'>): string {
  const byBook = new Map<string, { title: string; n: number }>();
  for (const r of room.rows) {
    const e = byBook.get(r.bookId) ?? { title: r.book.title, n: 0 };
    e.n += 1;
    byBook.set(r.bookId, e);
  }
  const dupe = [...byBook.values()].sort((a, b) => b.n - a.n)[0];
  if (dupe && dupe.n >= 2) return `${dupe.n}× ${clip(dupe.title, 14)}, no regrets`;
  return NOTES[hashString(room.name) % NOTES.length];
}
