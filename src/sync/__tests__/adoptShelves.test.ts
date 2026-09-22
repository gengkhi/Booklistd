import { addUserBook, createShelf, upsertBook } from '@/db/repository';
import { ADOPT_SHELVES_KEY, getMeta, setMeta } from '@/db/localData';
import { asClient, FakeSupabase } from '@/test/fakeSupabase';
import { bookMeta } from '@/test/fixtures';
import { freshDb } from '@/test/testDb';
import { SyncRetryable } from '../client';
import { adoptionPlan, adoptShelvesOnClaim, rewriteShelfId } from '../adoptShelves';

describe('adoptionPlan', () => {
  it('matches on lower(trim(name))', () => {
    expect(adoptionPlan([{ id: 'l1', name: ' study' }, { id: 'l2', name: 'Hall' }], [{ id: 's1', name: 'Study ' }])).toEqual([{ from: 'l1', to: 's1' }]);
  });
  it('the first server shelf of a name wins, and a server shelf is adopted once', () => {
    expect(adoptionPlan([{ id: 'l1', name: 'Den' }, { id: 'l2', name: 'den' }], [{ id: 's1', name: 'Den' }, { id: 's2', name: 'DEN' }])).toEqual([{ from: 'l1', to: 's1' }]);
  });
  it('ignores a shelf that already has the server id', () => {
    expect(adoptionPlan([{ id: 's1', name: 'Den' }], [{ id: 's1', name: 'Den' }])).toEqual([]);
  });
});

describe('adoptShelvesOnClaim', () => {
  let db: Awaited<ReturnType<typeof freshDb>>;
  let fake: FakeSupabase;
  beforeEach(async () => {
    db = await freshDb();
    fake = new FakeSupabase();
    fake.userId = 'u1';
  });

  it('gives the local shelf the server id and rewrites copies and queued payloads', async () => {
    const shelf = createShelf('study');
    const copy = addUserBook(upsertBook(bookMeta()).id, 'owned', shelf.id);
    fake.seed('shelves', { id: 'server-shelf', name: 'Study ', sort_order: 0, plank: 'pool' });
    setMeta(ADOPT_SHELVES_KEY, '1');

    await adoptShelvesOnClaim(asClient(fake));

    expect(db.getAllSync<{ id: string }>('SELECT id FROM shelves').map((r) => r.id)).toEqual(['server-shelf']);
    expect(db.getFirstSync<{ shelf_id: string }>('SELECT shelf_id FROM user_books WHERE id = ?', [copy.id])!.shelf_id).toBe('server-shelf');
    const ops = db.getAllSync<{ table_name: string; row_id: string; payload: string }>('SELECT table_name, row_id, payload FROM pending_ops');
    const shelfOps = ops.filter((o) => o.table_name === 'shelves');
    const copyOps = ops.filter((o) => o.table_name === 'user_books');
    expect(shelfOps).toHaveLength(1);
    expect(copyOps).toHaveLength(1);
    expect(shelfOps.every((o) => o.row_id === 'server-shelf' && JSON.parse(o.payload).id === 'server-shelf')).toBe(true);
    expect(copyOps.every((o) => JSON.parse(o.payload).shelf_id === 'server-shelf')).toBe(true);
    expect(getMeta(ADOPT_SHELVES_KEY)).toBeNull();
    expect(db.getAllSync('PRAGMA foreign_key_check')).toEqual([]);
  });

  it('adopts several shelves in one transaction', async () => {
    const study = createShelf('Study');
    const hall = createShelf('Hall');
    createShelf('Attic');
    fake.seed('shelves', { id: 'srv-study', name: 'study', sort_order: 0, plank: 'pool' });
    fake.seed('shelves', { id: 'srv-hall', name: 'HALL', sort_order: 1, plank: 'bus' });
    setMeta(ADOPT_SHELVES_KEY, '1');
    const d = db;
    const spy = jest.spyOn(d, 'withTransactionSync');

    await adoptShelvesOnClaim(asClient(fake));

    expect(spy).toHaveBeenCalledTimes(1);
    const ids = db.getAllSync<{ id: string }>('SELECT id FROM shelves ORDER BY sort_order').map((r) => r.id);
    expect(ids).toHaveLength(3);
    expect(ids).toEqual(expect.arrayContaining(['srv-study', 'srv-hall']));
    expect(ids).not.toContain(study.id);
    expect(ids).not.toContain(hall.id);
    expect(getMeta(ADOPT_SHELVES_KEY)).toBeNull();
  });

  it('does nothing unless a claim asked for it', async () => {
    createShelf('study');
    fake.seed('shelves', { id: 'server-shelf', name: 'Study', sort_order: 0, plank: 'pool' });
    await adoptShelvesOnClaim(asClient(fake));
    expect(db.getFirstSync<{ id: string }>('SELECT id FROM shelves')!.id).not.toBe('server-shelf');
  });

  it('ignores deleted server shelves', async () => {
    const shelf = createShelf('study');
    fake.seed('shelves', { id: 'server-shelf', name: 'Study', sort_order: 0, plank: 'pool', deleted_at: '2026-09-01T00:00:00+00:00' });
    setMeta(ADOPT_SHELVES_KEY, '1');
    await adoptShelvesOnClaim(asClient(fake));
    expect(db.getFirstSync<{ id: string }>('SELECT id FROM shelves')!.id).toBe(shelf.id);
    expect(getMeta(ADOPT_SHELVES_KEY)).toBeNull();
  });

  it('an offline or 5xx fetch pauses and keeps the flag for next time', async () => {
    createShelf('study');
    setMeta(ADOPT_SHELVES_KEY, '1');
    fake.failNext('shelves', 503);
    await expect(adoptShelvesOnClaim(asClient(fake))).rejects.toBeInstanceOf(SyncRetryable);
    expect(getMeta(ADOPT_SHELVES_KEY)).toBe('1');
  });
});

describe('rewriteShelfId', () => {
  let db: Awaited<ReturnType<typeof freshDb>>;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('merges into a shelf already here and moves its shelf_books rows', () => {
    const local = createShelf('Study');
    const copy = addUserBook(upsertBook(bookMeta()).id, 'owned', local.id);
    db.runSync("INSERT INTO shelves (id, name, sort_order, plank) VALUES ('srv', 'Study', 0, 'pool')");
    db.runSync('INSERT INTO shelf_books (shelf_id, user_book_id) VALUES (?, ?)', [local.id, copy.id]);
    rewriteShelfId(local.id, 'srv');
    expect(db.getAllSync<{ id: string }>('SELECT id FROM shelves').map((r) => r.id)).toEqual(['srv']);
    expect(db.getAllSync('SELECT shelf_id, user_book_id FROM shelf_books')).toEqual([{ shelf_id: 'srv', user_book_id: copy.id }]);
    expect(db.getFirstSync<{ shelf_id: string }>('SELECT shelf_id FROM user_books')!.shelf_id).toBe('srv');
    expect(db.getAllSync('PRAGMA foreign_key_check')).toEqual([]);
  });
});
