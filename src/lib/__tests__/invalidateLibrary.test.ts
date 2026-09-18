import { QueryClient } from '@tanstack/react-query';
import { invalidateLibrary } from '../invalidateLibrary';

describe('invalidateLibrary', () => {
  it('marks every user_books-backed query stale, and leaves catalog lookups alone', () => {
    const qc = new QueryClient();
    const keys = [['library'], ['library', 'wishlist'], ['stats'], ['search', 'dune'], ['book', 'ub1'], ['isbn', '9780441172719']];
    keys.forEach((k) => qc.setQueryData(k, 1));
    invalidateLibrary(qc);
    const stale = (k: string[]) => qc.getQueryState(k)?.isInvalidated;
    expect(keys.slice(0, 5).every(stale)).toBe(true);
    expect(stale(['isbn', '9780441172719'])).toBe(false);
    qc.clear();
  });
});
