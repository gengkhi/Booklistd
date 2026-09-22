import { cardRows, type CardInput } from '../cardRows';

const T = '2026-09-22';
const NOW = new Date('2026-09-22T12:00:00Z');
const base: CardInput = {
  copies: [{ shelfName: 'Study', borrower: null, loanedAt: null }],
  focusShelfName: 'Study', wishlist: false, reading: null,
  book: { publisher: 'Anvil', publishedYear: 2023, isbn13: '9789712737817' },
};
const keys = (i: CardInput) => cardRows(i, T, NOW).map((r) => r.key);
const val = (i: CardInput, k: string) => cardRows(i, T, NOW).find((r) => r.key === k)?.value;

describe('cardRows', () => {
  it('owned, unread: shelf, status, edition, isbn', () => {
    expect(keys(base)).toEqual(['shelf', 'status', 'edition', 'isbn']);
    expect(val(base, 'shelf')).toBe('Study');
    expect(val(base, 'status')).toBe('Not started');
    expect(val(base, 'edition')).toBe('Anvil, 2023');
  });
  it('read with a rating shows rating, started and finished', () => {
    const i = { ...base, reading: { state: 'read' as const, startedAt: '2026-09-03', finishedAt: '2026-09-18', rating: 6 } };
    expect(keys(i)).toEqual(['shelf', 'status', 'rating', 'started', 'finished', 'edition', 'isbn']);
    expect(val(i, 'rating')).toBe('Wrecked me (nicely)');
    expect(val(i, 'started')).toBe('3 Sep');
    expect(val(i, 'finished')).toBe('18 Sep');
  });
  it('unrated finish says Rate it and missing dates say Add date', () => {
    const i = { ...base, reading: { state: 'dnf' as const, startedAt: null, finishedAt: null, rating: null } };
    expect(val(i, 'rating')).toBe('Rate it');
    expect(val(i, 'started')).toBe('Add date');
    expect(val(i, 'finished')).toBe('Add date');
  });
  it('want to read has no dates or rating', () => {
    expect(keys({ ...base, reading: { state: 'want', startedAt: null, finishedAt: null, rating: null } })).toEqual(['shelf', 'status', 'edition', 'isbn']);
  });
  it('reading shows only started', () => {
    expect(keys({ ...base, reading: { state: 'reading', startedAt: '2026-09-10', finishedAt: null, rating: null } }))
      .toEqual(['shelf', 'status', 'started', 'edition', 'isbn']);
  });
  it('several copies and a loan', () => {
    const i: CardInput = { ...base, copies: [
      { shelfName: 'Study', borrower: null, loanedAt: null },
      { shelfName: null, borrower: 'Mia', loanedAt: '2026-09-10 12:00:00' },
    ] };
    expect(keys(i)).toEqual(['shelf', 'status', 'copies', 'loan', 'edition', 'isbn']);
    expect(val(i, 'copies')).toBe('2 · Study, Unshelved');
    expect(val(i, 'loan')).toBe('Mia · 12 days');
  });
  it('wishlist-only and not-owned shelf values', () => {
    expect(val({ ...base, copies: [], focusShelfName: null, wishlist: true }, 'shelf')).toBe('On your wishlist');
    expect(val({ ...base, copies: [], focusShelfName: null }, 'shelf')).toBe('Not on your shelves');
  });
  it('isbn is display-only and edition falls back to a dash', () => {
    const rows = cardRows({ ...base, book: { publisher: null, publishedYear: null, isbn13: null } }, T, NOW);
    expect(rows.find((r) => r.key === 'isbn')).toEqual({ key: 'isbn', label: 'ISBN', value: '—', tappable: false });
    expect(rows.find((r) => r.key === 'edition')?.value).toBe('—');
  });
  it('not owned but being read: shelf says so, status shows the reading', () => {
    const i: CardInput = { ...base, copies: [], focusShelfName: null, reading: { state: 'reading', startedAt: '2026-09-10', finishedAt: null, rating: null } };
    expect(val(i, 'shelf')).toBe('Not on your shelves');
    expect(val(i, 'status')).toBe('Reading');
  });
  it('a placeholder book still lists shelf, status, edition and isbn', () => {
    const i: CardInput = { ...base, book: { publisher: null, publishedYear: null, isbn13: '9789712737817' } };
    expect(keys(i)).toEqual(['shelf', 'status', 'edition', 'isbn']);
    expect(val(i, 'edition')).toBe('—');
    expect(val(i, 'isbn')).toBe('9789712737817');
  });
});
