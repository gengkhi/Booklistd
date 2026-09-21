import { shelvesLines, ownedLine, wishlistLine, searchAside, roomNote, newFindLine, EMPTY_SHELF, MAX_LINE, countWord } from '../lines';
import { row } from '@/test/fixtures';
import { UNSHELVED } from '@/features/shelves/shelfRules';

const long = 'An Extraordinarily Long Title That Goes On And On Forever';

describe('Dewey lines', () => {
  it('empty library gets the reserved-shelf line', () => {
    expect(shelvesLines({ totalBooks: 0, rooms: [], mostCopied: null, loaned: 0 })).toEqual([EMPTY_SHELF]);
  });
  it('uses real data and never exceeds the length cap', () => {
    const lines = shelvesLines({
      totalBooks: 412,
      rooms: [{ name: 'An Absurdly Long Room Name Indeed', count: 146 }],
      mostCopied: { title: long, copies: 3 },
      loaned: 3,
    });
    expect(lines[0]).toMatch(/^Three copies of /);
    expect(lines.some((l) => l.startsWith('146 books in the'))).toBe(true);
    expect(lines.some((l) => l.includes('Three books are out visiting friends'))).toBe(true);
    lines.forEach((l) => expect(l.length).toBeLessThanOrEqual(MAX_LINE));
  });
  it('never calls out the big room when it is the unshelved pile', () => {
    const lines = shelvesLines({ totalBooks: 24, rooms: [{ name: UNSHELVED, count: 24 }], mostCopied: null, loaned: 0 });
    expect(lines.some((l) => l.includes('books in the'))).toBe(false);
  });
  it('tape notes never claim facts they cannot know', () => {
    const names = ['Study', 'Bedroom', 'Living room', 'Hall', 'Kitchen', 'Attic', 'Garage', 'Office', 'Den', 'Nook', 'Loft', 'Porch'];
    names.forEach((name) => expect(roomNote({ name, rows: [row()] })).not.toBe('mostly finished'));
  });
  it('owned line reflects copies and edition', () => {
    expect(ownedLine(3, true)).toBe("Copy #4? You own three. I've counted.");
    expect(ownedLine(1, true)).toBe('Already yours. Put it back gently.');
    expect(ownedLine(2, false)).toBe('Same book, different coat. You already own it.');
  });
  it('wishlist line scales with count', () => {
    expect(wishlistLine(0)).toBe('Nothing wished for. Suspiciously content.');
    expect(wishlistLine(1)).toBe('One maybe. Someday is a real day.');
    expect(wishlistLine(4)).toBe('Four maybes. Someday is a real day.');
    expect(wishlistLine(27)).toBe('At this rate it needs its own room.');
  });
  it('search aside reports real matches', () => {
    expect(searchAside('', 0)).toBe('Your shelves first, then the catalog.');
    expect(searchAside('dune', 3)).toBe('Searching "dune". You own three already.');
    expect(searchAside('emma', 0)).toBe('No "emma" on your shelves. Yet.');
  });
  it('room note calls out true duplicates, otherwise a stable generic note', () => {
    const dupes = { name: 'Bedroom', rows: [row({ bookId: 'd', title: 'Dune' }), row({ bookId: 'd', title: 'Dune' }), row({ bookId: 'd', title: 'Dune' })] };
    expect(roomNote(dupes)).toBe('3× Dune, no regrets');
    const plain = { name: 'Study', rows: [row(), row()] };
    expect(roomNote(plain)).toBe(roomNote(plain));
    expect(roomNote(plain).length).toBeLessThanOrEqual(30);
  });
  it('new-find line is stable per seed and countWord falls back to digits', () => {
    expect(newFindLine(7)).toBe(newFindLine(7));
    expect(countWord(3)).toBe('Three');
    expect(countWord(42)).toBe('42');
  });
});
