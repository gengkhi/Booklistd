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

function migrate(d: SQLiteDatabase) {
  const row = d.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let v = current; v < SCHEMA_VERSION; v++) {
    d.withTransactionSync(() => {
      const m = MIGRATIONS[v];
      if (typeof m === 'string') d.execSync(m);
      else m(d);
      d.execSync(`PRAGMA user_version = ${v + 1}`);
    });
  }
}
