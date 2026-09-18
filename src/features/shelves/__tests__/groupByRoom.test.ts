import { groupByRoom, mostCopied, UNSHELVED } from '../groupByRoom';
import { row } from '@/test/fixtures';

describe('groupByRoom', () => {
  it('groups by location, biggest room first, Unshelved last, wishlist excluded', () => {
    const rooms = groupByRoom([
      row({ location: 'Study' }), row({ location: 'Living room' }), row({ location: 'Living room' }),
      row({ location: null }), row({ location: '  ' }), row({ location: 'Study', status: 'wishlist' }),
    ]);
    expect(rooms.map((r) => [r.name, r.rows.length])).toEqual([['Living room', 2], ['Study', 1], [UNSHELVED, 2]]);
  });
  it('returns [] for no rows', () => {
    expect(groupByRoom([])).toEqual([]);
  });
});

describe('mostCopied', () => {
  it('finds the book with the most (2+) copies', () => {
    const rows = [row({ bookId: 'd', title: 'Dune' }), row({ bookId: 'd', title: 'Dune' }), row({ bookId: 'd', title: 'Dune' }), row({ bookId: 'e', title: 'Emma' })];
    expect(mostCopied(rows)).toEqual({ title: 'Dune', copies: 3 });
  });
  it('is null when nothing is duplicated', () => {
    expect(mostCopied([row(), row()])).toBeNull();
  });
});
