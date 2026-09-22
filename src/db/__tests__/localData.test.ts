jest.mock('@/features/bookEdits/coverFiles', () => ({
  ...jest.requireActual('@/features/bookEdits/coverFiles'),
  deleteAllCoverFiles: jest.fn(),
}));

import { addUserBook, createShelf, removeCopy, saveBookEdit, setReadingState, upsertBook } from '@/db/repository';
import { bookMeta } from '@/test/fixtures';
import { freshDb, LOCAL_TABLES, seedEveryLocalTable } from '@/test/testDb';
import { ADOPT_SHELVES_KEY, claimLibrary, getMeta, getOwner, rejectedCount, saveProfileName, wipeLocalData } from '../localData';
import { pendingCount } from '../pendingOps';

let db: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => {
  db = await freshDb();
});
const ops = () => db.getAllSync<{ table_name: string; row_id: string }>('SELECT table_name, row_id FROM pending_ops ORDER BY id');

describe('claimLibrary', () => {
  it('snapshots every live row once, in push order, and flags shelf adoption', () => {
    const shelf = createShelf('Study');
    const book = upsertBook(bookMeta());
    const copy = addUserBook(book.id, 'owned', shelf.id);
    const gone = addUserBook(book.id, 'wishlist');
    removeCopy(gone.id);
    setReadingState(book.id, 'reading', '2026-09-01');
    saveBookEdit(book.id, { title: 'Dune (mine)', subtitle: null, authors: null, publisher: null, publishedYear: null, edition: null });
    db.execSync('DELETE FROM pending_ops');

    expect(claimLibrary('u1')).toBe(4);
    expect(ops().map((o) => o.table_name)).toEqual(['shelves', 'user_books', 'readings', 'book_edits']);
    expect(ops().some((o) => o.row_id === gone.id)).toBe(false);
    expect(ops().find((o) => o.table_name === 'user_books')!.row_id).toBe(copy.id);
    expect(getOwner()).toBe('u1');
    expect(getMeta(ADOPT_SHELVES_KEY)).toBe('1');
  });

  it('an empty library claims without snapshots or adoption', () => {
    expect(claimLibrary('u1')).toBe(0);
    expect(ops()).toEqual([]);
    expect(getMeta(ADOPT_SHELVES_KEY)).toBeNull();
  });
});

describe('wipeLocalData', () => {
  it('empties every table but keeps the schema version', () => {
    createShelf('Study');
    saveProfileName('u1', 'Sean');
    seedEveryLocalTable(db);
    for (const t of LOCAL_TABLES) expect(db.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)!.n).toBeGreaterThan(0);
    wipeLocalData();
    for (const t of LOCAL_TABLES) {
      expect(db.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)!.n).toBe(0);
    }
    expect(db.getFirstSync<{ user_version: number }>('PRAGMA user_version')!.user_version).toBeGreaterThanOrEqual(5);
  });
});

describe('rejectedCount', () => {
  it('counts the rows the server refused', () => {
    expect(rejectedCount()).toBe(0);
    db.runSync("INSERT INTO sync_rejects (op_id, table_name, row_id, op, payload, error_code) VALUES (1, 'shelves', 's1', 'upsert', '{}', '23514')");
    expect(rejectedCount()).toBe(1);
  });
});

describe('saveProfileName', () => {
  it('keeps the name locally and queues it for backup', () => {
    saveProfileName('u1', 'Sean Merchant');
    expect(db.getFirstSync<{ display_name: string }>('SELECT display_name FROM profiles WHERE id = ?', ['u1'])!.display_name).toBe('Sean Merchant');
    expect(ops()).toEqual([{ table_name: 'profiles', row_id: 'u1' }]);
    expect(pendingCount()).toBe(1);
  });
});
