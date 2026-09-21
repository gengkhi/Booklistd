import type { ShelfRow } from '@/lib/types';
import { row } from '@/test/fixtures';
import { groupByShelf, isPlank, migrateLocations, mostCopied, nextPlank, normaliseName, UNSHELVED } from '../shelfRules';

const shelf = (id: string, name: string, sortOrder: number, plank: ShelfRow['plank'] = 'bus'): ShelfRow =>
  ({ id, name, plank, sortOrder, bookCount: 0 });

describe('normaliseName / isPlank', () => {
  it('compares names ignoring case and outer spaces', () => {
    expect(normaliseName('  Study ')).toBe('study');
  });
  it('knows the five inks', () => {
    expect(['bus', 'tomato', 'pool', 'grass', 'plum'].every(isPlank)).toBe(true);
    expect(isPlank('pink')).toBe(false);
  });
});

describe('nextPlank', () => {
  it('starts at bus and follows the last shelf by order, wrapping', () => {
    expect(nextPlank([])).toBe('bus');
    expect(nextPlank([{ plank: 'bus', sortOrder: 0 }, { plank: 'tomato', sortOrder: 1 }])).toBe('pool');
    expect(nextPlank([{ plank: 'plum', sortOrder: 4 }, { plank: 'bus', sortOrder: 0 }])).toBe('bus');
  });
});

describe('migrateLocations', () => {
  const c = (id: string, location: string | null, createdAt = '2026-01-01 00:00:00') => ({ id, location, createdAt });
  it('turns room names into shelves ordered by book count, blank = Unshelved', () => {
    const r = migrateLocations([c('1', 'Study'), c('2', 'Living room'), c('3', 'Living room'), c('4', null), c('5', '   ')]);
    expect(r.shelves).toEqual([
      { key: 'living room', name: 'Living room', sortOrder: 0, plank: 'bus' },
      { key: 'study', name: 'Study', sortOrder: 1, plank: 'tomato' },
    ]);
    expect(r.copyShelf).toEqual({ '1': 'study', '2': 'living room', '3': 'living room', '4': null, '5': null });
  });
  it('merges names that differ only by case, keeping the most-used spelling', () => {
    const r = migrateLocations([c('1', 'study'), c('2', 'Study'), c('3', 'Study '), c('4', 'STUDY')]);
    expect(r.shelves).toEqual([{ key: 'study', name: 'Study', sortOrder: 0, plank: 'bus' }]);
  });
  it('breaks spelling ties by the earliest copy', () => {
    const r = migrateLocations([c('1', 'komiks', '2026-02-01 00:00:00'), c('2', 'Komiks', '2026-01-01 00:00:00')]);
    expect(r.shelves[0].name).toBe('Komiks');
  });
  it('breaks count ties by name and cycles planks', () => {
    const r = migrateLocations(['F', 'E', 'D', 'C', 'B', 'A'].map((n, i) => c(String(i), n)));
    expect(r.shelves.map((s) => [s.name, s.plank])).toEqual([
      ['A', 'bus'], ['B', 'tomato'], ['C', 'pool'], ['D', 'grass'], ['E', 'plum'], ['F', 'bus'],
    ]);
  });
});

describe('groupByShelf', () => {
  it('keeps your order, shows empty shelves, puts Unshelved last and skips wishlist', () => {
    const shelves = [shelf('b', 'Bedroom', 1), shelf('s', 'Study', 0), shelf('k', 'Komiks', 2)];
    const groups = groupByShelf([
      row({ shelfId: 'b' }), row({ shelfId: 's' }), row({ shelfId: 's' }), row({ shelfId: null }),
      row({ shelfId: 'gone' }), row({ shelfId: 's', status: 'wishlist' }),
    ], shelves);
    expect(groups.map((g) => [g.name, g.rows.length, g.shelf?.id ?? null])).toEqual([
      ['Study', 2, 's'], ['Bedroom', 1, 'b'], ['Komiks', 0, 'k'], [UNSHELVED, 2, null],
    ]);
  });
  it('has no Unshelved group when every copy is on a shelf', () => {
    expect(groupByShelf([row({ shelfId: 's' })], [shelf('s', 'Study', 0)]).map((g) => g.name)).toEqual(['Study']);
  });
  it('is empty with no shelves and no copies', () => {
    expect(groupByShelf([], [])).toEqual([]);
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
