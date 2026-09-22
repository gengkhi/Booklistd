/// <reference types="node" />
/**
 * sql.js (SQLite compiled to WebAssembly) behind the subset of expo-sqlite's sync API the app uses,
 * so repository, migrations and sync code run against real SQL in Jest.
 */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import type { SQLiteDatabase } from 'expo-sqlite';

type Bind = (string | number | null | Uint8Array)[];
let SQL: SqlJsStatic | null = null;

const bindable = (params: unknown): Bind =>
  (Array.isArray(params) ? params : params === undefined ? [] : [params]).map((v) =>
    v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : (v as string | number | null | Uint8Array)
  );

export async function openMemoryDb(): Promise<SQLiteDatabase> {
  SQL ??= await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) });
  const raw: Database = new SQL.Database();
  let inTransaction = false;

  const all = <T>(source: string, params?: unknown): T[] => {
    const stmt = raw.prepare(source);
    try {
      stmt.bind(bindable(params));
      const out: T[] = [];
      while (stmt.step()) out.push(stmt.getAsObject() as T);
      return out;
    } finally {
      stmt.free();
    }
  };

  const db = {
    execSync: (source: string) => {
      raw.exec(source);
    },
    runSync: (source: string, params?: unknown) => {
      raw.run(source, bindable(params));
      const changes = raw.getRowsModified();
      const last = all<{ id: number }>('SELECT last_insert_rowid() AS id')[0]?.id ?? 0;
      return { changes, lastInsertRowId: Number(last) };
    },
    getFirstSync: <T>(source: string, params?: unknown): T | null => all<T>(source, params)[0] ?? null,
    getAllSync: all,
    // expo-sqlite runs BEGIN…COMMIT and can't nest ("cannot start a transaction within a transaction"),
    // so nesting fails loudly here too instead of passing in tests and crashing on a phone.
    withTransactionSync: (task: () => void) => {
      if (inTransaction) throw new Error('withTransactionSync cannot be nested (expo-sqlite would fail)');
      inTransaction = true;
      raw.exec('BEGIN');
      try {
        task();
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      } finally {
        inTransaction = false;
      }
    },
    closeSync: () => raw.close(),
  };
  return db as unknown as SQLiteDatabase;
}
