import {
  applyPulled, backoffMs, classifyStatus, coalesce, isoToSql, isStale, keysetFilter, nextCursor, parseCursor, pushOrder,
  rejectCode, serializeCursor, sqlToIso, STALE_AFTER_MS, toLocalBook, toLocalRow, toServerRow, type PendingOp,
} from '../logic';

const op = (id: number, table: string, rowId: string, payload: object, kind = 'upsert'): PendingOp => ({ id, table_name: table, row_id: rowId, op: kind, payload: JSON.stringify(payload) });

describe('coalesce', () => {
  it('keeps only the latest snapshot per row and remembers the max op id', () => {
    const { ops } = coalesce([op(1, 'shelves', 's1', { name: 'A' }), op(2, 'user_books', 'c1', { id: 'c1' }), op(3, 'shelves', 's1', { name: 'B' }, 'delete')]);
    expect(ops).toEqual([
      { table: 'user_books', rowId: 'c1', op: 'upsert', payload: { id: 'c1' }, maxOpId: 2 },
      { table: 'shelves', rowId: 's1', op: 'delete', payload: { name: 'B' }, maxOpId: 3 },
    ]);
  });
  it('drops ops for tables that never sync, and unreadable payloads', () => {
    const bad: PendingOp = { id: 5, table_name: 'user_books', row_id: 'c2', op: 'upsert', payload: 'null' };
    expect(coalesce([op(4, 'shelf_books', 'x', {}), bad]).dropped).toEqual([4, 5]);
  });
});

describe('pushOrder', () => {
  it('orders parents first and ignores unknown tables', () => {
    expect(pushOrder(['profiles', 'loans', 'shelf_books', 'book_edits', 'shelves', 'readings', 'user_books'])).toEqual(
      ['shelves', 'user_books', 'readings', 'book_edits', 'loans', 'profiles']
    );
  });
});

describe('row mapping', () => {
  it('never sends user_id or updated_at, converts SQLite times to UTC ISO and booleans', () => {
    const row = toServerRow('user_books', {
      id: 'c1', book_id: 'b1', status: 'owned', is_favorite: 1, shelf_id: null, location: 'Hall', rating: null,
      created_at: '2026-09-01 10:00:00', updated_at: '2026-09-02 10:00:00', deleted_at: null, user_id: 'x',
    });
    expect(row).not.toHaveProperty('user_id');
    expect(row).not.toHaveProperty('updated_at');
    expect(row).not.toHaveProperty('location');
    expect(row).toMatchObject({ id: 'c1', is_favorite: true, created_at: '2026-09-01T10:00:00Z', deleted_at: null });
  });
  it('sends book_edits authors as an array and a tombstone with every column', () => {
    expect(toServerRow('book_edits', { book_id: 'b1', authors: '["A","B"]', cover_path: 'covers/x.jpg' })).toEqual({
      book_id: 'b1', title: null, subtitle: null, authors: ['A', 'B'], publisher: null, published_year: null, edition: null, cover_object: null, deleted_at: null,
    });
    expect(toServerRow('book_edits', { book_id: 'b1', deleted_at: '2026-09-03 08:00:00' }).deleted_at).toBe('2026-09-03T08:00:00Z');
  });
  it('maps server rows back to SQLite shapes', () => {
    expect(toLocalRow('user_books', { id: 'c1', user_id: 'u', book_id: 'b1', status: 'owned', is_favorite: false, updated_at: '2026-09-22T10:00:01.123456+00:00', created_at: '2026-09-22T10:00:00+00:00', deleted_at: null })).toMatchObject({
      id: 'c1', is_favorite: 0, updated_at: '2026-09-22 10:00:01', created_at: '2026-09-22 10:00:00',
    });
    expect(toLocalRow('book_edits', { book_id: 'b1', authors: ['A'], updated_at: '2026-09-22T10:00:00Z' }).authors).toBe('["A"]');
  });
  it('gives placeholder catalog rows a readable title', () => {
    expect(toLocalBook({ id: 'b1', isbn13: '9780441172719', title: null, authors: [], genres: [], source: 'placeholder', updated_at: '2026-09-22T10:00:00+00:00' })).toMatchObject({
      id: 'b1', title: 'ISBN 9780441172719', authors: '[]', server_known: 1, source: 'placeholder',
    });
  });
  it('round-trips timestamps', () => {
    expect(sqlToIso('2026-09-01 10:00:00')).toBe('2026-09-01T10:00:00Z');
    expect(isoToSql('2026-09-01T10:00:00.5+00:00')).toBe('2026-09-01 10:00:00');
    expect(isoToSql('2026-09-01T12:00:00+02:00')).toBe('2026-09-01 10:00:00');
    expect(sqlToIso('2026-09-01')).toBe('2026-09-01');
  });
});

describe('applyPulled', () => {
  it('a pending local op wins', () => expect(applyPulled({ id: 'x' }, { deleted_at: null }, true)).toBe('keepLocal'));
  it('a delete applies to a row we have', () => expect(applyPulled({ id: 'x' }, { deleted_at: '2026-09-22T10:00:00Z' }, false)).toBe('apply'));
  it('a delete of a row we never had is skipped', () => expect(applyPulled(null, { deleted_at: '2026-09-22T10:00:00Z' }, false)).toBe('skip'));
  it('a newer server row replaces ours', () => expect(applyPulled({ id: 'x' }, { deleted_at: null }, false)).toBe('apply'));
});

describe('cursors', () => {
  it('advance to the last row of a page, keyed by the table row key', () => {
    expect(nextCursor([{ updated_at: 't1', id: 'a' }, { updated_at: 't2', id: 'b' }], 'id', null, 100)).toEqual({ updatedAt: 't2', id: 'b', pulledAt: 100 });
    expect(nextCursor([{ updated_at: 't3', book_id: 'k' }], 'book_id', null, 5)).toEqual({ updatedAt: 't3', id: 'k', pulledAt: 5 });
  });
  it('an empty page only refreshes pulledAt', () => {
    expect(nextCursor([], 'id', { updatedAt: 't', id: 'a', pulledAt: 1 }, 9)).toEqual({ updatedAt: 't', id: 'a', pulledAt: 9 });
    expect(nextCursor([], 'id', null, 9)).toBeNull();
  });
  it('serialise and parse', () => {
    const c = { updatedAt: '2026-09-22T10:00:00.123456+00:00', id: 'a', pulledAt: 7 };
    expect(parseCursor(serializeCursor(c))).toEqual(c);
    expect(parseCursor(null)).toBeNull();
    expect(parseCursor('garbage')).toBeNull();
  });
  it('is stale after 30 days without a pull', () => {
    const c = { updatedAt: 't', id: 'a', pulledAt: 0 };
    expect(isStale(c, STALE_AFTER_MS)).toBe(false);
    expect(isStale(c, STALE_AFTER_MS + 1)).toBe(true);
    expect(isStale(null, 10 ** 13)).toBe(false);
  });
  it('builds the keyset filter PostgREST expects', () => {
    expect(keysetFilter({ updatedAt: '2026-09-22T10:00:00+00:00', id: 'a', pulledAt: 0 }, 'id')).toBe(
      'updated_at.gt."2026-09-22T10:00:00+00:00",and(updated_at.eq."2026-09-22T10:00:00+00:00",id.gt."a")'
    );
  });
});

describe('failures', () => {
  it('retries network, expired sessions, timeouts, throttling and 5xx; rejects other 4xx', () => {
    for (const s of [0, 401, 408, 429, 500, 503]) expect(classifyStatus(s)).toBe('retry');
    for (const s of [400, 403, 404, 409, 422]) expect(classifyStatus(s)).toBe('reject');
  });
  it('backs off 5s, 10s, 20s… up to 5 minutes', () => {
    expect([1, 2, 3, 7, 20].map(backoffMs)).toEqual([5000, 10000, 20000, 300000, 300000]);
  });
  it('names a rejection by its Postgres code, else the HTTP status', () => {
    expect(rejectCode({ code: '23514' }, 400)).toBe('23514');
    expect(rejectCode({ code: '' }, 403)).toBe('http_403');
  });
});
