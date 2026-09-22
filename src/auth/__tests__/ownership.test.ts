jest.mock('@/features/bookEdits/coverFiles', () => ({
  ...jest.requireActual('@/features/bookEdits/coverFiles'),
  deleteAllCoverFiles: jest.fn(),
}));

import { deleteAllCoverFiles } from '@/features/bookEdits/coverFiles';
import { addUserBook, createShelf, upsertBook } from '@/db/repository';
import { getOwner } from '@/db/localData';
import { newId } from '@/db/ids';
import { bookMeta } from '@/test/fixtures';
import { freshDb, LOCAL_TABLES, seedEveryLocalTable } from '@/test/testDb';
import { bindOwner, ownershipAction } from '../ownership';

describe('ownershipAction', () => {
  it('claims an unowned library (including pre-accounts installs)', () => {
    expect(ownershipAction(null, 'u1')).toBe('claim');
  });
  it('continues for the same user', () => {
    expect(ownershipAction('u1', 'u1')).toBe('continue');
  });
  it('wipes for a different user', () => {
    expect(ownershipAction('u1', 'u2')).toBe('wipe');
  });
});

describe('bindOwner', () => {
  let db: Awaited<ReturnType<typeof freshDb>>;
  beforeEach(async () => {
    db = await freshDb();
    jest.clearAllMocks();
  });
  const count = (table: string) => db.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n;

  it('claim sets the owner', () => {
    expect(bindOwner('u1')).toBe('claim');
    expect(getOwner()).toBe('u1');
  });

  it('continue changes nothing', () => {
    bindOwner('u1');
    createShelf('Study');
    const ops = count('pending_ops');
    expect(bindOwner('u1')).toBe('continue');
    expect(count('pending_ops')).toBe(ops);
    expect(count('shelves')).toBe(1);
  });

  it('a different user wipes every local row and the covers, then takes ownership', () => {
    bindOwner('u1');
    const shelf = createShelf('Study');
    const book = upsertBook(bookMeta());
    addUserBook(book.id, 'owned', shelf.id);
    seedEveryLocalTable(db);
    for (const t of LOCAL_TABLES) expect(count(t)).toBeGreaterThan(0);
    expect(bindOwner('u2')).toBe('wipe');
    for (const t of LOCAL_TABLES.filter((n) => n !== 'sync_meta')) expect(count(t)).toBe(0);
    // Only the new owner is left in sync_meta.
    expect(db.getAllSync('SELECT key FROM sync_meta')).toEqual([{ key: 'owner_user_id' }]);
    expect(getOwner()).toBe('u2');
    expect(deleteAllCoverFiles).toHaveBeenCalledTimes(1);
    expect(db.getFirstSync<{ user_version: number }>('PRAGMA user_version')!.user_version).toBeGreaterThanOrEqual(5);
  });
});

describe('newId', () => {
  it('is a v4 UUID', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
