import { mapCopyStatus, readingFromLegacy } from '../legacy';

describe('mapCopyStatus', () => {
  it('keeps ownership only', () => {
    expect(['owned', 'reading', 'read', 'loaned'].map(mapCopyStatus)).toEqual(['owned', 'owned', 'owned', 'owned']);
    expect(['wishlist', 'want_to_buy'].map(mapCopyStatus)).toEqual(['wishlist', 'wishlist']);
  });
});

describe('readingFromLegacy', () => {
  const c = (status: string, updatedAt: string, rating: number | null = null) => ({ status, updatedAt, rating });
  it('no reading for books that were only owned or wished for', () => {
    expect(readingFromLegacy([c('owned', '2026-01-01 10:00:00'), c('wishlist', '2026-01-02 10:00:00')])).toBeNull();
  });
  it('a read copy becomes a finished reading dated from its last update', () => {
    expect(readingFromLegacy([c('read', '2026-03-04 22:10:00')])).toEqual({ state: 'read', startedAt: null, finishedAt: '2026-03-04', rating: null });
  });
  it('a reading copy becomes an in-progress reading', () => {
    expect(readingFromLegacy([c('reading', '2026-05-06 09:00:00')])).toEqual({ state: 'reading', startedAt: '2026-05-06', finishedAt: null, rating: null });
  });
  it('when copies disagree, read wins and the latest read copy dates it', () => {
    expect(readingFromLegacy([
      c('reading', '2026-07-01 09:00:00'), c('read', '2026-02-01 09:00:00'), c('read', '2026-04-01 09:00:00'),
    ])).toEqual({ state: 'read', startedAt: null, finishedAt: '2026-04-01', rating: null });
  });
  it('carries the best valid rating across copies', () => {
    expect(readingFromLegacy([c('read', '2026-02-01 09:00:00', 3), c('owned', '2026-02-02 09:00:00', 5)])?.rating).toBe(5);
    expect(readingFromLegacy([c('read', '2026-02-01 09:00:00', 9)])?.rating).toBeNull();
  });
  it('a rated owned copy was read, so its rating survives', () => {
    expect(readingFromLegacy([c('owned', '2026-03-01 09:00:00', 4)])).toEqual({ state: 'read', startedAt: null, finishedAt: '2026-03-01', rating: 4 });
  });
  it('a rating beats a later reading copy and dates the finish', () => {
    expect(readingFromLegacy([c('reading', '2026-07-01 09:00:00'), c('owned', '2026-05-01 09:00:00', 5)])).toEqual({ state: 'read', startedAt: null, finishedAt: '2026-05-01', rating: 5 });
  });
});
