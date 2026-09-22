import { FakeSupabase } from '@/test/fakeSupabase';

/** The fake must fail where the real server fails, or push tests can pass against a friendlier server. */
describe('FakeSupabase upsert', () => {
  let fake: FakeSupabase;
  beforeEach(() => {
    fake = new FakeSupabase();
    fake.userId = 'u1';
    fake.seed('books', { id: 'b1' });
  });

  it('two rows with the same conflict key in one batch fail with 21000 and change nothing', async () => {
    const res = await fake.from('readings').upsert(
      [{ id: 'r1', book_id: 'b1', state: 'read' }, { id: 'r2', book_id: 'b1', state: 'want' }],
      { onConflict: 'user_id,book_id' }
    );
    expect(res.error?.code).toBe('21000');
    expect(res.status).toBe(500);
    expect(fake.rows('readings')).toEqual([]);
    expect(fake.upserts).toEqual([]);
  });

  it('the same book for two users is not a duplicate', async () => {
    fake.seed('readings', { id: 'r0', book_id: 'b1', state: 'read' }, 'u2');
    const res = await fake.from('readings').upsert([{ id: 'r1', book_id: 'b1', state: 'read' }], { onConflict: 'user_id,book_id' });
    expect(res.error).toBeNull();
    expect(fake.rows('readings')).toHaveLength(1);
  });

  it('user_books.shelf_id must name one of my shelves (null is fine)', async () => {
    fake.seed('shelves', { id: 'mine', name: 'Study' });
    fake.seed('shelves', { id: 'theirs', name: 'Den' }, 'u2');
    const copy = (id: string, shelf_id: string | null) => ({ id, book_id: 'b1', status: 'owned', shelf_id });
    expect((await fake.from('user_books').upsert([copy('c1', 'missing')])).error?.code).toBe('23503');
    expect((await fake.from('user_books').upsert([copy('c1', 'theirs')])).error?.code).toBe('23503');
    expect((await fake.from('user_books').upsert([copy('c1', 'mine'), copy('c2', null)])).error).toBeNull();
    expect(fake.rows('user_books')).toHaveLength(2);
  });

  it('loans.user_book_id must name one of my copies', async () => {
    fake.seed('user_books', { id: 'c1', book_id: 'b1', status: 'owned' });
    fake.seed('user_books', { id: 'c2', book_id: 'b1', status: 'owned' }, 'u2');
    const loan = (id: string, user_book_id: string) => ({ id, user_book_id, borrower_name: 'x', loaned_at: '2026-09-01T00:00:00Z' });
    expect((await fake.from('loans').upsert([loan('l1', 'nope')])).error?.code).toBe('23503');
    expect((await fake.from('loans').upsert([loan('l1', 'c2')])).error?.code).toBe('23503');
    expect((await fake.from('loans').upsert([loan('l1', 'c1')])).error).toBeNull();
    expect(fake.rows('loans')).toHaveLength(1);
  });

  it('an RLS failure on any row leaves every row unchanged', async () => {
    fake.seed('shelves', { id: 'theirs', name: 'Den' }, 'u2');
    const res = await fake.from('shelves').upsert([{ id: 'new', name: 'Hall' }, { id: 'theirs', name: 'Mine now' }]);
    expect(res.error?.code).toBe('42501');
    expect(fake.tables.shelves).toHaveLength(1);
    expect(fake.tables.shelves[0]).toMatchObject({ id: 'theirs', name: 'Den', user_id: 'u2' });
  });
});

describe('FakeSupabase select', () => {
  it('descending order is unsupported and throws', () => {
    const fake = new FakeSupabase();
    fake.userId = 'u1';
    expect(() => fake.from('shelves').select('*').order('updated_at', { ascending: false })).toThrow(/unsupported/);
  });
});
