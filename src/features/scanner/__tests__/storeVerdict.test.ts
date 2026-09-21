import { newFindNote, readVerdictLine, storeVerdict } from '../storeVerdict';

describe('storeVerdict', () => {
  const v = (ownedCopies: number, wishlistCopies: number, state: 'want' | 'reading' | 'read' | 'dnf' | null) =>
    storeVerdict({ ownedCopies, wishlistCopies, reading: state ? { state } : null });
  it('owning wins over everything', () => {
    expect(v(1, 1, 'read')).toBe('owned');
  });
  it('a wishlist hit beats a past read', () => {
    expect(v(0, 1, 'read')).toBe('wishlist');
  });
  it('a finished or abandoned read with no copy is "read"', () => {
    expect(v(0, 0, 'read')).toBe('read');
    expect(v(0, 0, 'dnf')).toBe('read');
  });
  it('want or reading with no copy is still a new find', () => {
    expect(v(0, 0, 'want')).toBe('new');
    expect(v(0, 0, 'reading')).toBe('new');
    expect(v(0, 0, null)).toBe('new');
  });
});

describe('verdict lines', () => {
  it('new-find note mentions an unowned TBR or current read', () => {
    expect(newFindNote({ state: 'want' })).toBe('On your TBR pile');
    expect(newFindNote({ state: 'reading' })).toBe("You're reading this");
    expect(newFindNote(null)).toBeNull();
  });
  it('read line shows the verdict and when', () => {
    expect(readVerdictLine({ state: 'read', startedAt: null, finishedAt: '2025-03-14', rating: 5 })).toBe("Couldn't put it down · Finished Mar 2025");
    expect(readVerdictLine({ state: 'read', startedAt: null, finishedAt: null, rating: null })).toBe('Read');
    expect(readVerdictLine({ state: 'dnf', startedAt: null, finishedAt: '2025-03-14', rating: 1 })).toBe('You gave up on this one');
  });
});
