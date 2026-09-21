import { primaryAction, primaryLabel } from '../detailActions';

const base = { ownedCopies: 1, wishlistCopy: false, loanedTo: null as string | null, readingState: null as any };

describe('primaryAction', () => {
  it('a wishlist-only book offers Found it!', () => {
    expect(primaryAction({ ...base, ownedCopies: 0, wishlistCopy: true })).toEqual({ kind: 'found' });
  });
  it('a lent-out copy offers the nudge', () => {
    expect(primaryAction({ ...base, loanedTo: 'Mia', readingState: 'want' })).toEqual({ kind: 'nudge', borrower: 'Mia' });
  });
  it('follows the reading: start, finish, mark read, then nothing', () => {
    expect(primaryAction({ ...base, readingState: 'want' })).toEqual({ kind: 'start' });
    expect(primaryAction({ ...base, readingState: 'reading' })).toEqual({ kind: 'finish' });
    expect(primaryAction({ ...base, readingState: null })).toEqual({ kind: 'markRead' });
    expect(primaryAction({ ...base, readingState: 'read' })).toBeNull();
    expect(primaryAction({ ...base, readingState: 'dnf' })).toBeNull();
  });
  it('labels', () => {
    expect(primaryLabel({ kind: 'found' })).toBe('Found it!');
    expect(primaryLabel({ kind: 'nudge', borrower: 'Mia' })).toBe('Nudge Mia');
    expect(primaryLabel({ kind: 'start' })).toBe('Start reading');
    expect(primaryLabel({ kind: 'finish' })).toBe('Finished it');
    expect(primaryLabel({ kind: 'markRead' })).toBe('Mark as read');
  });
});
