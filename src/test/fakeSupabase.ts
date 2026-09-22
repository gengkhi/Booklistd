/// <reference types="node" />
/**
 * An in-memory Supabase for sync tests. It implements exactly the calls src/sync makes, and anything
 * else throws, so a test can't pass by accident:
 * - PostgREST upsert and select, with owner-scoped rows (RLS);
 * - updated_at stamped by the "server";
 * - the book_id foreign key;
 * - `ensure` on book-lookup;
 * - a covers bucket.
 */
import { randomUUID } from 'crypto';
import type { SyncClient } from '@/sync/client';

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string; code: string } | null; status: number };

const OWNER: Record<string, 'user_id' | 'id' | null> = {
  shelves: 'user_id', user_books: 'user_id', readings: 'user_id', book_edits: 'user_id', loans: 'user_id', profiles: 'id', books: null,
};
const BOOK_FK = new Set(['user_books', 'readings', 'book_edits']);
const fail = (status: number, code: string, message: string): Result => ({ data: null, error: { message, code }, status });

export class FakeSupabase {
  userId: string | null = null;
  tables: Record<string, Row[]> = { shelves: [], user_books: [], readings: [], book_edits: [], loans: [], profiles: [], books: [] };
  objects = new Map<string, Uint8Array>();
  upserts: { table: string; rows: Row[] }[] = [];
  ensured: string[] = [];
  /** ISBNs the fake catalog knows (title); others become placeholders. */
  catalog: Record<string, string> = {};
  /** Called after each successful upsert, to simulate writes landing mid-push. */
  onUpsert: ((table: string) => void) | null = null;
  private clock = 0;
  private shots: { table: string; status: number }[] = [];
  private rules: { table: string; status: number; code: string; when: (r: Row) => boolean }[] = [];
  private ensureShots: number[] = [];

  stamp(): string {
    this.clock += 1;
    return new Date(Date.UTC(2026, 8, 22) + this.clock * 1000).toISOString().replace('Z', '+00:00');
  }
  failNext(table: string, status: number) { this.shots.push({ table, status }); }
  reject(table: string, when: (r: Row) => boolean, status = 400, code = '23514') { this.rules.push({ table, status, code, when }); }
  failEnsure(status: number) { this.ensureShots.push(status); }

  /** Insert a server row directly, stamped like a real write. */
  seed(table: string, row: Row, userId = this.userId ?? 'u1'): Row {
    const owner = OWNER[table];
    const full: Row = { created_at: this.stamp(), deleted_at: null, ...row, updated_at: this.stamp() };
    if (owner === 'user_id') full.user_id = userId;
    this.tables[table].push(full);
    return full;
  }
  rows(table: string, userId: string | null = this.userId): Row[] {
    const owner = OWNER[table];
    return this.tables[table].filter((r) => owner === null || r[owner] === userId);
  }
  takeShot(table: string): number | null {
    const i = this.shots.findIndex((s) => s.table === table);
    return i < 0 ? null : this.shots.splice(i, 1)[0].status;
  }

  from(table: string) {
    if (!(table in this.tables)) throw new Error(`fake: unknown table ${table}`);
    return {
      upsert: (rows: Row | Row[], opts?: { onConflict?: string }) =>
        Promise.resolve(this.upsert(table, Array.isArray(rows) ? rows : [rows], opts?.onConflict ?? 'id')),
      select: (_columns = '*') => new FakeQuery(this, table),
    };
  }

  private upsert(table: string, rows: Row[], onConflict: string): Result {
    if (!this.userId) return fail(401, 'PGRST301', 'JWT required');
    const shot = this.takeShot(table);
    if (shot !== null) return fail(shot, '', 'injected failure');
    for (const r of rows) {
      if ('user_id' in r || 'updated_at' in r) return fail(400, 'test_forbidden_column', 'payload carried user_id or updated_at');
      const rule = this.rules.find((x) => x.table === table && x.when(r));
      if (rule) return fail(rule.status, rule.code, 'rejected by rule');
      if (BOOK_FK.has(table) && !this.tables.books.some((b) => b.id === r.book_id)) return fail(409, '23503', 'book_id foreign key');
      if (table === 'user_books' && r.shelf_id != null && !this.rows('shelves').some((s) => s.id === r.shelf_id)) return fail(409, '23503', 'shelf_id foreign key');
      if (table === 'loans' && !this.rows('user_books').some((u) => u.id === r.user_book_id)) return fail(409, '23503', 'user_book_id foreign key');
      if (table === 'profiles' && r.id !== this.userId) return fail(403, '42501', 'row-level security');
    }
    const keys = onConflict.split(',');
    const owner = OWNER[table];
    const fulls = rows.map((r): Row => (owner === 'user_id' ? { ...r, user_id: this.userId } : { ...r }));
    // Postgres: "ON CONFLICT DO UPDATE command cannot affect row a second time".
    const seen = new Set<string>();
    for (const full of fulls) {
      const key = JSON.stringify(keys.map((k) => full[k] ?? null));
      if (seen.has(key)) return fail(500, '21000', 'ON CONFLICT DO UPDATE command cannot affect row a second time');
      seen.add(key);
    }
    // One SQL statement: every row passes RLS before any row changes.
    const targets = fulls.map((full) => this.tables[table].find((e) => keys.every((k) => e[k] === full[k])) ?? null);
    if (owner && targets.some((e) => e && e[owner] !== this.userId)) return fail(403, '42501', 'row-level security');
    const now = this.stamp();
    fulls.forEach((full, i) => {
      const existing = targets[i];
      if (existing) Object.assign(existing, full, { updated_at: now });
      else this.tables[table].push({ created_at: now, deleted_at: null, ...full, updated_at: now });
    });
    this.upserts.push({ table, rows });
    this.onUpsert?.(table);
    return { data: null, error: null, status: 201 };
  }

  functions = {
    invoke: async (name: string, opts: { body?: { ensure?: { isbn13?: string } } }) => {
      const isbn13 = opts?.body?.ensure?.isbn13;
      if (name !== 'book-lookup' || !isbn13) throw new Error(`fake: unsupported invoke ${name}`);
      const shot = this.ensureShots.shift();
      if (shot !== undefined) return { data: null, error: { message: 'injected', context: { status: shot } } };
      if (!this.userId) return { data: null, error: { message: 'sign_in_required', context: { status: 401 } } };
      this.ensured.push(isbn13);
      let book = this.tables.books.find((b) => b.isbn13 === isbn13);
      if (!book) {
        const known = this.catalog[isbn13];
        book = {
          id: randomUUID(), isbn13, isbn10: null, title: known ?? null, subtitle: null, authors: [], publisher: null,
          published_year: null, edition: null, genres: [], page_count: null, cover_url: null, description: null,
          work_key: null, source: known ? 'google' : 'placeholder', created_at: this.stamp(), updated_at: this.stamp(),
        };
        this.tables.books.push(book);
      }
      return { data: { id: book.id }, error: null };
    },
  };

  storage = {
    from: (bucket: string) => {
      if (bucket !== 'covers') throw new Error(`fake: unknown bucket ${bucket}`);
      const mine = (path: string) => !!this.userId && path.startsWith(`${this.userId}/`);
      return {
        upload: async (path: string, body: ArrayBuffer | Uint8Array, _opts?: unknown) => {
          if (!mine(path)) return { data: null, error: { message: 'new row violates row-level security policy', statusCode: '403', status: 403 } };
          this.objects.set(path, new Uint8Array(body instanceof Uint8Array ? body : new Uint8Array(body)));
          return { data: { path }, error: null };
        },
        createSignedUrl: async (path: string, expiresIn: number) =>
          mine(path) && this.objects.has(path)
            ? { data: { signedUrl: `https://fake.storage/${path}?expires=${expiresIn}` }, error: null }
            : { data: null, error: { message: 'Object not found', statusCode: '404', status: 404 } },
        remove: async (paths: string[]) => {
          for (const p of paths) if (mine(p)) this.objects.delete(p);
          return { data: [], error: null };
        },
      };
    },
  };
}

class FakeQuery implements PromiseLike<Result> {
  private filters: ((r: Row) => boolean)[] = [];
  private orders: string[] = [];
  private max = Infinity;
  constructor(private fake: FakeSupabase, private table: string) {}

  or(expr: string) {
    const m = /^updated_at\.gt\."([^"]+)",and\(updated_at\.eq\."([^"]+)",(\w+)\.gt\."([^"]+)"\)$/.exec(expr);
    if (!m || m[1] !== m[2]) throw new Error(`fake: unsupported or(${expr})`);
    const [, u, , key, id] = m;
    this.filters.push((r) => String(r.updated_at) > u || (r.updated_at === u && String(r[key]) > id));
    return this;
  }
  /** String comparison, so tests must use the fake's own timestamp format (…THH:MM:SS+00:00). */
  gte(col: string, value: string) {
    this.filters.push((r) => String(r[col] ?? '') >= value);
    return this;
  }
  in(col: string, values: unknown[]) {
    this.filters.push((r) => values.includes(r[col]));
    return this;
  }
  is(col: string, value: null) {
    this.filters.push((r) => (r[col] ?? null) === value);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    if (opts?.ascending === false) throw new Error(`fake: unsupported descending order(${col})`);
    this.orders.push(col);
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(ok, bad);
  }
  private run(): Result {
    if (!this.fake.userId) return fail(401, 'PGRST301', 'JWT required');
    const shot = this.fake.takeShot(this.table);
    if (shot !== null) return fail(shot, '', 'injected failure');
    const rows = this.fake.rows(this.table).filter((r) => this.filters.every((f) => f(r)));
    rows.sort((a, b) => {
      for (const c of this.orders) {
        const x = String(a[c] ?? '');
        const y = String(b[c] ?? '');
        if (x !== y) return x < y ? -1 : 1;
      }
      return 0;
    });
    return { data: rows.slice(0, this.max).map((r) => ({ ...r })), error: null, status: 200 };
  }
}

export const asClient = (f: FakeSupabase): SyncClient => f as unknown as SyncClient;
