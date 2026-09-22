import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import { MIGRATIONS, SCHEMA_VERSION } from './schema';

export { newId } from './ids';

let db: SQLiteDatabase | null = null;

export function getDb(): SQLiteDatabase {
  if (db) return db;
  db = openDatabaseSync('mylibrary.db');
  db.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

/** `target` is for tests that seed an older schema before upgrading it (the app always migrates to the latest). */
export function migrate(d: SQLiteDatabase, target: number = SCHEMA_VERSION) {
  const row = d.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let v = current; v < target; v++) {
    d.withTransactionSync(() => {
      const m = MIGRATIONS[v];
      if (typeof m === 'string') d.execSync(m);
      else m(d);
      d.execSync(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/** Tests only: point getDb() at an in-memory database (see src/test/testDb.ts). */
export function __setDbForTest(d: SQLiteDatabase | null): void {
  db = d;
}
