# Shelf Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make shelves real places. You can create, rename, reorder, recolour and delete them. Each At home copy sits on exactly one shelf, or on none (Unshelved).

**Architecture:**
- The existing `shelves` table gains a saved `plank` colour, and each copy gets a `shelf_id`.
- Pure rules live in `src/features/shelves/shelfRules.ts`: name matching, next colour, the location → shelves migration mapping, and grouping.
- A JS SQLite v4 migration and a matching Supabase migration convert today's free-text `location` rooms into shelves.
- Screens switch from `location` to `shelfId`/`shelfName`, and a shared `ShelfPicker` with an inline "+ New shelf" appears in every picker.
- A new `/shelves` screen handles rename, recolour, drag-to-reorder and delete-with-move.

**Tech Stack:** Expo SDK 57, expo-router, expo-sqlite (sync API), TanStack Query, Reanimated 4, react-native-gesture-handler (added in Task 6), Supabase migrations, Jest (jest-expo).

**Spec:** `docs/superpowers/specs/2026-09-22-shelf-creation-design.md`

## Global Constraints

- **Git and deploys:** never run `git add`/`commit`/`push`/`rm` or any `supabase` CLI command. Sean pushes at the end. Each task ends with a hand-off that lists the files.
- **Working directory:** paths are relative to `Booklistd/` (`C:\Users\seanj\Documents\personal\Booklistd\Booklistd`).
- **Dependencies:** the only new one is `react-native-gesture-handler`, installed in Task 6 with `npx expo install`.
- **Expo Go:** everything must run in Expo Go SDK 57 on iOS.
- **Planks, verbatim:** `bus`, `tomato`, `pool`, `grass`, `plum`, in this order when cycling. The first shelf gets `bus`.
- **Names:** unique among live shelves, compared with `trim().toLowerCase()`.
- **Copy, verbatim:**
  - "Unshelved"
  - "+ New shelf"
  - "Manage shelves"
  - "Nothing here yet"
  - "You already have a shelf called ⟨Name⟩."
  - "Delete the ⟨Name⟩ shelf?"
  - "Delete the ⟨Name⟩ shelf? Move its N books to:"
  - suggestions "Living room · Bedroom · Study"
- **Copy voice:** warm librarian, sentence case, never twee.
- **Styling:** existing tokens only (`@/theme/palette`, `useTheme()`).
- **Only `owned` copies carry a `shelf_id`.** Wishlist copies never do.
- **Checks after every task:**
  - `npx tsc --noEmit` exits 0.
  - `npx jest` passes. There are 83 tests at the start.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/lib/types.ts` | modify | `Plank`, `ShelfRow`; `UserBook.shelfId`/`shelfName` (T1); drop `UserBook.location` (T5) |
| `src/features/shelves/shelfRules.ts` (+test) | create | `UNSHELVED`, `PLANK_INKS`, `SUGGESTED_SHELVES`, `normaliseName`, `isPlank`, `plankColor`, `nextPlank`, `migrateLocations`, `groupByShelf`, `ShelfGroup`; `mostCopied` moves here in T4 |
| `src/db/migrations/v4ShelfCreation.ts` | create | The v4 JS migration |
| `src/db/schema.ts` | modify | v4 |
| `src/db/repository.ts` | modify | Shelf joins and API; cleanup in T5 |
| `src/test/fixtures.ts` | modify | shelf fields |
| `supabase/migrations/20260922000000_shelf_creation.sql` | create | Server shelf planks, `shelf_id`, backfill |
| `src/sync/syncEngine.ts` | modify | Phase 3 note on matching shelves |
| `src/features/shelves/groupByRoom.ts` (+test) | delete (T4) | Replaced by `groupByShelf` |
| `src/features/dewey/lines.ts`, `src/lib/invalidateLibrary.ts` (+test) | modify | `ShelfGroup` input; `['shelves']` key |
| `app/(tabs)/index.tsx`, `app/(tabs)/profile.tsx` | modify | Bookcase by shelf; shelf count |
| `src/components/shelves/useShelfNamePrompt.tsx` | create | Cross-platform name prompt |
| `src/components/shelves/ShelfPicker.tsx` | create | Shelf chips + "+ New shelf" + suggestions |
| `src/features/scanner/VerdictSheet.tsx`, `app/(tabs)/scan.tsx`, `app/book/[id].tsx`, `app/book/edit.tsx`, `app/(tabs)/search.tsx` | modify | Switch from location to shelves |
| `src/components/shelves/ReorderList.tsx` | create | Long-press drag list with accessibility move actions |
| `app/shelves.tsx` | create | Manage shelves |
| `app/_layout.tsx` | modify | `GestureHandlerRootView` |
| `DESIGN.md` | modify | Document shelves |

---

### Task 1: Shelf rules (pure) and types

**Files:**
- Modify: `src/lib/types.ts`, `src/db/repository.ts` (`toUserBook` only), `src/test/fixtures.ts`
- Create: `src/features/shelves/shelfRules.ts`
- Test: `src/features/shelves/__tests__/shelfRules.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  export type Plank = 'bus' | 'tomato' | 'pool' | 'grass' | 'plum';
  export interface ShelfRow { id: string; name: string; plank: Plank; sortOrder: number; bookCount: number }
  // UserBook gains: shelfId: string | null; shelfName: string | null;   (location stays until Task 5)
  // shelfRules.ts
  export const UNSHELVED = 'Unshelved';
  export const PLANK_INKS: readonly Plank[];
  export const SUGGESTED_SHELVES: readonly string[];
  export function normaliseName(s: string): string;
  export function isPlank(p: unknown): p is Plank;
  export function plankColor(p: Plank): string;
  export function nextPlank(existing: { plank: Plank; sortOrder: number }[]): Plank;
  export interface MigratedShelf { key: string; name: string; sortOrder: number; plank: Plank }
  export function migrateLocations(copies: { id: string; location: string | null; createdAt: string }[]): { shelves: MigratedShelf[]; copyShelf: Record<string, string | null> };
  export interface ShelfGroup { shelf: ShelfRow | null; name: string; rows: LibraryRow[] }
  export function groupByShelf(rows: LibraryRow[], shelves: ShelfRow[]): ShelfGroup[];
  ```

- [ ] **Step 1: Types**

In `src/lib/types.ts`, add after the `BookStatus` line:

```ts
export type Plank = 'bus' | 'tomato' | 'pool' | 'grass' | 'plum';

/** A place a copy lives. bookCount = live At home copies on it. */
export interface ShelfRow {
  id: string;
  name: string;
  plank: Plank;
  sortOrder: number;
  bookCount: number;
}
```

In `UserBook`, after `location: string | null;` add:

```ts
  shelfId: string | null;
  /** Name of the live shelf this copy sits on (joined), null = Unshelved. */
  shelfName: string | null;
```

In `src/db/repository.ts` `toUserBook`, after `location: r.location,` add:

```ts
  shelfId: r.shelf_id ?? null,
  shelfName: r.shelf_name ?? null,
```

In `src/test/fixtures.ts`, extend the options type with `shelfId?: string | null; shelfName?: string | null` and add `shelfId: p.shelfId ?? null, shelfName: p.shelfName ?? null,` to the returned object after `location: p.location ?? null,`.

- [ ] **Step 2: Write the failing test**

Create `src/features/shelves/__tests__/shelfRules.test.ts`:

```ts
import type { ShelfRow } from '@/lib/types';
import { row } from '@/test/fixtures';
import { groupByShelf, isPlank, migrateLocations, nextPlank, normaliseName, UNSHELVED } from '../shelfRules';

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
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `npx jest src/features/shelves/__tests__/shelfRules.test.ts`
Expected: FAIL with `Cannot find module '../shelfRules'`.

- [ ] **Step 4: Implement**

Create `src/features/shelves/shelfRules.ts`:

```ts
import type { LibraryRow, Plank, ShelfRow } from '@/lib/types';
import { ink } from '@/theme/palette';

export const UNSHELVED = 'Unshelved';
export const PLANK_INKS: readonly Plank[] = ['bus', 'tomato', 'pool', 'grass', 'plum'];
/** Offered when you have no shelves yet; tapping one creates it. */
export const SUGGESTED_SHELVES: readonly string[] = ['Living room', 'Bedroom', 'Study'];

export const normaliseName = (s: string): string => s.trim().toLowerCase();
export const isPlank = (p: unknown): p is Plank => typeof p === 'string' && (PLANK_INKS as readonly string[]).includes(p);
export const plankColor = (p: Plank): string => ink[p];

/** The ink after the last shelf's (by order), cycling; the first shelf gets bus. */
export function nextPlank(existing: { plank: Plank; sortOrder: number }[]): Plank {
  if (existing.length === 0) return 'bus';
  const last = existing.reduce((a, b) => (b.sortOrder > a.sortOrder ? b : a));
  return PLANK_INKS[(PLANK_INKS.indexOf(last.plank) + 1) % PLANK_INKS.length];
}

export interface MigratedShelf { key: string; name: string; sortOrder: number; plank: Plank }

/**
 * Pre-v4 rooms (free-text location) → shelves. Names merge by normaliseName; the display spelling is the
 * one most copies used (ties: earliest copy). Shelves are ordered by book count, ties by name — the order
 * the bookcase already showed. Blank names are Unshelved (null).
 */
export function migrateLocations(copies: { id: string; location: string | null; createdAt: string }[]) {
  const groups = new Map<string, { spellings: Map<string, { n: number; first: string }>; total: number }>();
  const copyShelf: Record<string, string | null> = {};
  for (const c of copies) {
    const name = c.location?.trim() ?? '';
    if (!name) {
      copyShelf[c.id] = null;
      continue;
    }
    const key = normaliseName(name);
    copyShelf[c.id] = key;
    const g = groups.get(key) ?? { spellings: new Map(), total: 0 };
    const s = g.spellings.get(name) ?? { n: 0, first: c.createdAt };
    s.n += 1;
    if (c.createdAt < s.first) s.first = c.createdAt;
    g.spellings.set(name, s);
    g.total += 1;
    groups.set(key, g);
  }
  const named = [...groups.entries()]
    .map(([key, g]) => {
      const [name] = [...g.spellings.entries()].sort((a, b) => b[1].n - a[1].n || a[1].first.localeCompare(b[1].first))[0];
      return { key, name, total: g.total };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const shelves: MigratedShelf[] = [];
  for (const [i, s] of named.entries()) shelves.push({ key: s.key, name: s.name, sortOrder: i, plank: nextPlank(shelves) });
  return { shelves, copyShelf };
}

export interface ShelfGroup { shelf: ShelfRow | null; name: string; rows: LibraryRow[] }

/** Bookcase shelves in your order (empty ones included), then Unshelved if it has books. Wishlist copies never sit on a shelf. */
export function groupByShelf(rows: LibraryRow[], shelves: ShelfRow[]): ShelfGroup[] {
  const known = new Set(shelves.map((s) => s.id));
  const byShelf = new Map<string, LibraryRow[]>();
  const unshelved: LibraryRow[] = [];
  for (const r of rows) {
    if (r.status === 'wishlist') continue;
    if (r.shelfId && known.has(r.shelfId)) byShelf.set(r.shelfId, [...(byShelf.get(r.shelfId) ?? []), r]);
    else unshelved.push(r);
  }
  const groups: ShelfGroup[] = [...shelves]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => ({ shelf: s, name: s.name, rows: byShelf.get(s.id) ?? [] }));
  if (unshelved.length) groups.push({ shelf: null, name: UNSHELVED, rows: unshelved });
  return groups;
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx jest src/features/shelves/__tests__/shelfRules.test.ts`
Expected: PASS, 10 tests.

Run: `npx tsc --noEmit && npx jest`
Expected: tsc exits 0. All suites pass.

- [ ] **Step 6: Hand-off**

Files: `src/lib/types.ts`, `src/db/repository.ts`, `src/test/fixtures.ts`, `src/features/shelves/shelfRules.ts`, `src/features/shelves/__tests__/shelfRules.test.ts`.

---

### Task 2: Device data (schema v4 and shelf repository API)

**Files:**
- Create: `src/db/migrations/v4ShelfCreation.ts`
- Modify: `src/db/schema.ts`, `src/db/repository.ts`

**Interfaces:**
- Consumes: `migrateLocations`, `nextPlank`, `normaliseName`, `isPlank` (Task 1); `newId` from `../ids`.
- Produces (repository):
  ```ts
  export class ShelfNameTaken extends Error { existing: string }
  export function listShelves(): ShelfRow[];
  export function createShelf(name: string): ShelfRow;              // returns the existing shelf on a name match
  export function renameShelf(id: string, name: string): void;      // throws ShelfNameTaken
  export function setShelfPlank(id: string, plank: Plank): void;
  export function reorderShelves(ids: string[]): void;
  export function deleteShelf(id: string, moveTo: string | null): void;
  export function setCopyShelf(copyId: string, shelfId: string | null): void;
  export function addUserBook(bookId: string, status: BookStatus, shelfId?: string | null): UserBook; // 3rd arg is now a shelf id
  // setStatus(copyId, 'wishlist') also clears shelf_id. Every UserBook/LibraryRow/CopyRow read now includes shelfName.
  ```
  `setLocation` and `listRooms` stay (deprecated) until Task 5.

> **Testing note:** `expo-sqlite` can't run under Jest. The migration's decisions are `migrateLocations`, tested in Task 1. Check with tsc, Jest and the manual smoke test (for Sean).

- [ ] **Step 1: The v4 migration**

Create `src/db/migrations/v4ShelfCreation.ts`:

```ts
/**
 * v4 — shelves become real places. Adds shelves.plank and user_books.shelf_id, turns each At home copy's
 * free-text location into a shelf (decisions from the tested migrateLocations), then retires location.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { newId } from '../ids';
import { migrateLocations } from '@/features/shelves/shelfRules';

export function migrateV4ShelfCreation(d: SQLiteDatabase): void {
  d.execSync(`
    ALTER TABLE shelves ADD COLUMN plank TEXT NOT NULL DEFAULT 'bus';
    ALTER TABLE user_books ADD COLUMN shelf_id TEXT REFERENCES shelves(id);
    CREATE INDEX IF NOT EXISTS idx_user_books_shelf ON user_books(shelf_id);
  `);
  const enqueue = (table: string, rowId: string, payload: unknown) =>
    d.runSync('INSERT INTO pending_ops (table_name, row_id, op, payload) VALUES (?, ?, ?, ?)', [table, rowId, 'upsert', JSON.stringify(payload)]);

  const copies = d.getAllSync<any>(`SELECT id, location, created_at FROM user_books WHERE deleted_at IS NULL AND status = 'owned'`);
  const { shelves, copyShelf } = migrateLocations(copies.map((c) => ({ id: c.id, location: c.location, createdAt: c.created_at })));

  const idByKey = new Map<string, string>();
  for (const s of shelves) {
    const id = newId();
    idByKey.set(s.key, id);
    d.runSync('INSERT INTO shelves (id, name, sort_order, plank) VALUES (?, ?, ?, ?)', [id, s.name, s.sortOrder, s.plank]);
    enqueue('shelves', id, d.getFirstSync('SELECT * FROM shelves WHERE id = ?', [id]));
  }

  const shelfOf = new Map<string, string | null>();
  for (const c of copies) {
    const key = copyShelf[c.id];
    const shelfId = key ? idByKey.get(key) ?? null : null;
    shelfOf.set(c.id, shelfId);
    if (c.location == null && shelfId == null) continue;
    d.runSync(`UPDATE user_books SET shelf_id = ?, location = NULL, updated_at = datetime('now') WHERE id = ?`, [shelfId, c.id]);
    enqueue('user_books', c.id, d.getFirstSync('SELECT * FROM user_books WHERE id = ?', [c.id]));
  }

  // Wishlist and soft-deleted copies never carry a place.
  d.runSync('UPDATE user_books SET location = NULL WHERE location IS NOT NULL');

  // Queued ops from before v4 carry location; give them the shelf instead.
  for (const op of d.getAllSync<any>(`SELECT id, row_id, payload FROM pending_ops WHERE table_name = 'user_books'`)) {
    const p = JSON.parse(op.payload);
    if (p && typeof p === 'object' && 'location' in p) {
      p.location = null;
      p.shelf_id = shelfOf.get(op.row_id) ?? null;
      d.runSync('UPDATE pending_ops SET payload = ? WHERE id = ?', [JSON.stringify(p), op.id]);
    }
  }
}
```

In `src/db/schema.ts`:
- Add the import `import { migrateV4ShelfCreation } from './migrations/v4ShelfCreation';`
- Change `SCHEMA_VERSION = 3` to `SCHEMA_VERSION = 4`.
- Append this after the v3 entry:

```ts
  // v4 — shelves are places: shelves.plank, user_books.shelf_id; location retired. See src/db/migrations/v4ShelfCreation.ts.
  migrateV4ShelfCreation,
```

- [ ] **Step 2: Join shelf names into copy reads**

In `src/db/repository.ts`:

1. Add imports:

```ts
import type { Plank, ShelfRow } from '@/lib/types';
import { isPlank, nextPlank, normaliseName } from '@/features/shelves/shelfRules';
```

(Merge `Plank, ShelfRow` into the existing `@/lib/types` type import.)

2. In `checkOwnership`'s `copiesWhere`, replace the query with:

```ts
      .getAllSync<any>(
        `SELECT ub.*, s.name AS shelf_name FROM user_books ub
           LEFT JOIN shelves s ON s.id = ub.shelf_id AND s.deleted_at IS NULL
          WHERE ub.book_id IN (${q}) AND ub.deleted_at IS NULL AND ub.${statusSql}`,
        bookIds
      )
```

In the same function, change the two `copiesWhere` call sites' status strings so they fit `ub.${statusSql}`. They are already written as `status != 'wishlist'` and `status = 'wishlist'` (from the reading-tracking cleanup). Confirm, and keep them unprefixed, since the template adds `ub.`.

3. Replace `LIBRARY_SELECT` with:

```ts
const LIBRARY_SELECT = `SELECT ub.*, s.name AS shelf_name, b.id as b_id, b.isbn13, b.isbn10, b.title, b.subtitle, b.authors, b.publisher,
       b.published_year, b.edition, b.genres, b.page_count, b.cover_url, b.cover_path, b.description, b.work_key,
       b.source, b.edited
  FROM user_books ub
  JOIN books_effective b ON b.id = ub.book_id
  LEFT JOIN shelves s ON s.id = ub.shelf_id AND s.deleted_at IS NULL`;
```

4. In `listCopiesOfBook`, change `SELECT ub.*, l.borrower_name …` to `SELECT ub.*, s.name AS shelf_name, l.borrower_name AS loan_borrower, l.loaned_at AS loan_at`, and add `LEFT JOIN shelves s ON s.id = ub.shelf_id AND s.deleted_at IS NULL` after `FROM user_books ub`.

- [ ] **Step 3: Copy writes carry a shelf**

1. Replace `updateUserBook` with a multi-field version:

```ts
type CopyField = 'status' | 'location' | 'shelf_id';
function updateUserBook(userBookId: string, fields: Partial<Record<CopyField, string | null>>) {
  const keys = Object.keys(fields) as CopyField[];
  if (keys.length === 0) return;
  const d = getDb();
  d.runSync(
    `UPDATE user_books SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
    [...keys.map((k) => fields[k] ?? null), userBookId]
  );
  const row = d.getFirstSync<any>('SELECT * FROM user_books WHERE id = ?', [userBookId]);
  if (row) enqueue('user_books', userBookId, 'upsert', row);
}
```

2. Update the existing callers:

```ts
export function setStatus(userBookId: string, status: BookStatus): void {
  // A wishlist copy has no place in the house.
  updateUserBook(userBookId, status === 'wishlist' ? { status, shelf_id: null } : { status });
}

/** @deprecated Task 5 removes location entirely. */
export function setLocation(userBookId: string, location: string | null): void {
  updateUserBook(userBookId, { location: location?.trim() || null });
}

/** Put an At home copy on a shelf (null = Unshelved). Wishlist copies are left alone. */
export function setCopyShelf(copyId: string, shelfId: string | null): void {
  const r = getDb().getFirstSync<{ status: string }>('SELECT status FROM user_books WHERE id = ?', [copyId]);
  if (r?.status !== 'owned') return;
  updateUserBook(copyId, { shelf_id: shelfId });
}
```

3. Replace `addUserBook`:

```ts
export function addUserBook(bookId: string, status: BookStatus, shelfId?: string | null): UserBook {
  const d = getDb();
  const id = newId();
  d.runSync(
    `INSERT INTO user_books (id, book_id, status, shelf_id) VALUES (?, ?, ?, ?)`,
    [id, bookId, status, status === 'owned' ? shelfId ?? null : null]
  );
  enqueue('user_books', id, 'upsert', d.getFirstSync<any>('SELECT * FROM user_books WHERE id = ?', [id]));
  const row = d.getFirstSync<any>(
    `SELECT ub.*, s.name AS shelf_name FROM user_books ub LEFT JOIN shelves s ON s.id = ub.shelf_id AND s.deleted_at IS NULL WHERE ub.id = ?`,
    [id]
  );
  return toUserBook(row);
}
```

> Existing callers pass a room *name* as the 3rd argument: `scan.tsx`, `edit.tsx`, `search.tsx`, `[id].tsx`. Until Task 5 switches them, those names are stored as `shelf_id` values that match no shelf, so the copy shows as Unshelved. That's harmless in a dev build, but **no build ships between Task 2 and Task 5**. If a call site fails to type-check, the argument type is compatible (string), so there's nothing to change here.

- [ ] **Step 4: The shelf API**

Append to `src/db/repository.ts`:

```ts
// ---------- shelves (places) ----------
export class ShelfNameTaken extends Error {
  constructor(public existing: string) {
    super(`You already have a shelf called ${existing}.`);
    this.name = 'ShelfNameTaken';
  }
}

const toShelf = (r: any): ShelfRow => ({
  id: r.id,
  name: r.name,
  plank: isPlank(r.plank) ? r.plank : 'bus',
  sortOrder: r.sort_order,
  bookCount: r.book_count ?? 0,
});

function enqueueShelf(id: string, op: 'upsert' | 'delete' = 'upsert') {
  enqueue('shelves', id, op, getDb().getFirstSync<any>('SELECT * FROM shelves WHERE id = ?', [id]));
}

export function listShelves(): ShelfRow[] {
  return getDb()
    .getAllSync<any>(
      `SELECT s.*, (SELECT COUNT(*) FROM user_books ub
                     WHERE ub.shelf_id = s.id AND ub.deleted_at IS NULL AND ub.status = 'owned') AS book_count
         FROM shelves s WHERE s.deleted_at IS NULL ORDER BY s.sort_order, s.created_at`
    )
    .map(toShelf);
}

/** New shelf at the end with the next plank; an existing name (any case) returns that shelf instead. */
export function createShelf(name: string): ShelfRow {
  const clean = name.trim();
  if (!clean) throw new Error('Give the shelf a name.');
  const shelves = listShelves();
  const existing = shelves.find((s) => normaliseName(s.name) === normaliseName(clean));
  if (existing) return existing;
  const id = newId();
  const sortOrder = shelves.length ? Math.max(...shelves.map((s) => s.sortOrder)) + 1 : 0;
  const plank = nextPlank(shelves);
  getDb().runSync('INSERT INTO shelves (id, name, sort_order, plank) VALUES (?, ?, ?, ?)', [id, clean, sortOrder, plank]);
  enqueueShelf(id);
  return { id, name: clean, plank, sortOrder, bookCount: 0 };
}

export function renameShelf(id: string, name: string): void {
  const clean = name.trim();
  if (!clean) throw new Error('Give the shelf a name.');
  const clash = listShelves().find((s) => s.id !== id && normaliseName(s.name) === normaliseName(clean));
  if (clash) throw new ShelfNameTaken(clash.name);
  getDb().runSync(`UPDATE shelves SET name = ?, updated_at = datetime('now') WHERE id = ?`, [clean, id]);
  enqueueShelf(id);
}

export function setShelfPlank(id: string, plank: Plank): void {
  if (!isPlank(plank)) throw new Error('Pick one of the five plank colours.');
  getDb().runSync(`UPDATE shelves SET plank = ?, updated_at = datetime('now') WHERE id = ?`, [plank, id]);
  enqueueShelf(id);
}

/** Given ids take 0..n-1; any live shelf not listed keeps its relative order after them. */
export function reorderShelves(ids: string[]): void {
  const d = getDb();
  const current = listShelves().map((s) => s.id);
  const given = ids.filter((id) => current.includes(id));
  const order = [...given, ...current.filter((id) => !given.includes(id))];
  d.withTransactionSync(() => {
    order.forEach((id, i) => {
      d.runSync(`UPDATE shelves SET sort_order = ?, updated_at = datetime('now') WHERE id = ?`, [i, id]);
      enqueueShelf(id);
    });
  });
}

/** Moves the shelf's copies to moveTo (or Unshelved), then soft-deletes it — all or nothing. */
export function deleteShelf(id: string, moveTo: string | null): void {
  const d = getDb();
  if (moveTo === id) throw new Error("Books can't move to the shelf you're deleting.");
  if (moveTo && !listShelves().some((s) => s.id === moveTo)) throw new Error('Pick a shelf that still exists.');
  d.withTransactionSync(() => {
    for (const c of d.getAllSync<{ id: string }>('SELECT id FROM user_books WHERE shelf_id = ? AND deleted_at IS NULL', [id])) {
      updateUserBook(c.id, { shelf_id: moveTo });
    }
    d.runSync(`UPDATE shelves SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, [id]);
    enqueueShelf(id, 'delete');
  });
}
```

- [ ] **Step 5: Type-check and run the tests**

Run: `npx tsc --noEmit && npx jest`
Expected: tsc exits 0. All suites pass.

- [ ] **Step 6: Manual smoke test (for Sean; implementers skip and say so)**

Open the app on an install that has rooms. It launches, and every book is still listed (grouping switches in Task 4).

- [ ] **Step 7: Hand-off**

Files: `src/db/migrations/v4ShelfCreation.ts`, `src/db/schema.ts`, `src/db/repository.ts`.

---

### Task 3: Server migration and sync note

**Files:**
- Create: `supabase/migrations/20260922000000_shelf_creation.sql`
- Modify: `src/sync/syncEngine.ts` (comment only)

**Interfaces:**
- Consumes: `public.shelves`, `public.user_books` (`0001_init.sql`).
- Produces: `shelves.plank`, `user_books.shelf_id`, backfilled per user.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260922000000_shelf_creation.sql`:

```sql
-- Shelves become places: a saved plank colour per shelf, one shelf per At home copy (shelf_id),
-- and the free-text user_books.location retired. Same rules as the device's migrateLocations.

alter table public.shelves
  add column plank text not null default 'bus' check (plank in ('bus','tomato','pool','grass','plum'));

alter table public.user_books add column shelf_id text references public.shelves (id);
create index idx_user_books_shelf on public.user_books (shelf_id);

-- One shelf per distinct trimmed name (case-insensitive) per user, spelled the way most copies spell it
-- (ties: earliest copy), ordered by book count then name; planks cycle bus → plum by order.
with spellings as (
  select user_id, btrim(location) as name, lower(btrim(location)) as key,
         count(*) as n, min(created_at) as first_at
    from public.user_books
   where deleted_at is null and status = 'owned' and location is not null and btrim(location) <> ''
   group by user_id, btrim(location), lower(btrim(location))
), picked as (
  select distinct on (user_id, key) user_id, key, name
    from spellings
   order by user_id, key, n desc, first_at asc
), totals as (
  select user_id, key, sum(n) as total from spellings group by user_id, key
), ordered as (
  select p.user_id, p.name,
         (row_number() over (partition by p.user_id order by t.total desc, p.name asc) - 1)::int as sort_order
    from picked p join totals t using (user_id, key)
)
insert into public.shelves (id, user_id, name, sort_order, plank)
select gen_random_uuid()::text, user_id, name, sort_order,
       (array['bus','tomato','pool','grass','plum'])[(sort_order % 5) + 1]
  from ordered;

update public.user_books ub
   set shelf_id = s.id
  from public.shelves s
 where s.user_id = ub.user_id
   and s.deleted_at is null
   and lower(s.name) = lower(btrim(ub.location))
   and ub.deleted_at is null
   and ub.status = 'owned';

update public.user_books set location = null where location is not null;
```

- [ ] **Step 2: Sync note**

In `src/sync/syncEngine.ts`, add this line inside the existing Phase 3 TODO comment block:

```ts
// shelves: the server backfill (20260922000000) creates its own shelf ids — match shelves on (user_id, lower(trim(name))) when wiring push/pull so the device's shelves don't duplicate them.
```

- [ ] **Step 3: Checks**

Run: `npx tsc --noEmit && npx jest`. Both pass.

- [ ] **Step 4: Hand-off**

Files: the new migration and `src/sync/syncEngine.ts`. Sean deploys with `npx supabase db push` **after** the reading-tracking migration.

---

### Task 4: Bookcase by shelf

**Files:**
- Modify: `src/features/shelves/shelfRules.ts` (+ test: move `mostCopied` here)
- Delete: `src/features/shelves/groupByRoom.ts`, `src/features/shelves/__tests__/groupByRoom.test.ts`
- Modify: `src/features/dewey/lines.ts`, `src/lib/invalidateLibrary.ts` (+test), `app/(tabs)/index.tsx`, `app/(tabs)/profile.tsx`, `app/(tabs)/search.tsx` and `app/book/[id].tsx` (import path only)

**Interfaces:**
- Consumes: `listShelves` (Task 2), `groupByShelf`, `plankColor`, `UNSHELVED` (Task 1).
- Produces: `mostCopied` exported from `shelfRules.ts`; `invalidateLibrary` also invalidates `['shelves']`.

- [ ] **Step 1: Move `mostCopied` (test first)**

Append to `src/features/shelves/__tests__/shelfRules.test.ts`:

```ts
import { mostCopied } from '../shelfRules';

describe('mostCopied', () => {
  it('finds the book with the most (2+) copies', () => {
    const rows = [row({ bookId: 'd', title: 'Dune' }), row({ bookId: 'd', title: 'Dune' }), row({ bookId: 'd', title: 'Dune' }), row({ bookId: 'e', title: 'Emma' })];
    expect(mostCopied(rows)).toEqual({ title: 'Dune', copies: 3 });
  });
  it('is null when nothing is duplicated', () => {
    expect(mostCopied([row(), row()])).toBeNull();
  });
});
```

(Move the `import { mostCopied }` into the existing import line at the top instead of a second import.)

Run it and confirm it fails. Then move the `mostCopied` function verbatim from `groupByRoom.ts` into `shelfRules.ts` and run again (PASS). Then delete `src/features/shelves/groupByRoom.ts` and `src/features/shelves/__tests__/groupByRoom.test.ts`.

- [ ] **Step 2: Fix imports of the deleted file**

- `src/features/dewey/lines.ts`: replace `import { UNSHELVED, type Room } from '@/features/shelves/groupByRoom';` with `import { UNSHELVED, type ShelfGroup } from '@/features/shelves/shelfRules';` and change `roomNote(room: Pick<Room, 'name' | 'rows'>)` to `roomNote(room: Pick<ShelfGroup, 'name' | 'rows'>)`.
- `app/(tabs)/search.tsx` and `app/book/[id].tsx`: change `from '@/features/shelves/groupByRoom'` to `from '@/features/shelves/shelfRules'`.

- [ ] **Step 3: Invalidate shelves (test first)**

In `src/lib/__tests__/invalidateLibrary.test.ts`, add `['shelves']` to `keys` just before `['isbn', …]`, and change `slice(0, 6)` to `slice(0, 7)`. Run it and confirm it fails. Then add `'shelves'` to the key list in `src/lib/invalidateLibrary.ts` and update its comment to "Every query that reads user_books, readings or shelves." Run it again: PASS.

- [ ] **Step 4: Shelves screen**

In `app/(tabs)/index.tsx`:
1. Replace the imports:
   - `import { groupByRoom, mostCopied } from '@/features/shelves/groupByRoom';` becomes `import { groupByShelf, mostCopied, plankColor } from '@/features/shelves/shelfRules';`
   - add `listShelves` to the `@/db/repository` import;
   - drop `PLANKS` from the palette import if it's no longer used.
2. Replace `const rooms = useMemo(() => groupByRoom(rows), [rows]);` with:

```tsx
  const { data: shelves = [] } = useQuery({ queryKey: ['shelves'], queryFn: () => listShelves() });
  const rooms = useMemo(() => groupByShelf(rows, shelves), [rows, shelves]);
```

   (The variable keeps the name `rooms`, so `shelvesLines`, `sub`, `deweyShelf` and `empty` read unchanged. `rooms.map((r) => ({ name: r.name, count: r.rows.length }))` still works because `ShelfGroup` has `name` and `rows`.)
3. In the `rooms.map((room, i) => (<Shelf … />))` render:
   - `key={room.shelf?.id ?? 'unshelved'}`
   - `plank={room.shelf ? plankColor(room.shelf.plank) : ink.cream}`
   - `note={room.rows.length === 0 ? 'Nothing here yet' : quiet ? null : roomNote(room)}`

   Everything else stays.

- [ ] **Step 5: Profile**

In `app/(tabs)/profile.tsx`, change the import `listRooms` to `listShelves`, `const rooms = listRooms();` to `const shelves = listShelves();`, and the row `<LeaderRow label="Rooms" value={String(rooms.length)} />` to `<LeaderRow label="Shelves" value={String(shelves.length)} />`. In the Quiet explainer text, change "Room names and counts stay." to "Shelf names and counts stay."

- [ ] **Step 6: Checks**

Run: `npx tsc --noEmit && npx jest`. Both pass.

- [ ] **Step 7: Manual check (for Sean)**

After upgrading, the bookcase shows your old rooms as shelves in the same order, each with a stable colour. Profile says "Shelves N".

- [ ] **Step 8: Hand-off**

Files: those listed above (including the two deletions).

---

### Task 5: Shelf pickers everywhere; retire `location`

**Files:**
- Create: `src/components/shelves/useShelfNamePrompt.tsx`, `src/components/shelves/ShelfPicker.tsx`
- Modify: `src/features/scanner/VerdictSheet.tsx`, `app/(tabs)/scan.tsx`, `app/book/[id].tsx`, `app/book/edit.tsx`, `app/(tabs)/search.tsx`
- Modify: `src/lib/types.ts`, `src/db/repository.ts`, `src/test/fixtures.ts` (remove `location`)

**Interfaces:**
- Consumes: `listShelves`, `createShelf`, `setCopyShelf`, `addUserBook(bookId, status, shelfId)` (Task 2); `SUGGESTED_SHELVES`, `UNSHELVED` (Task 1).
- Produces:
  ```ts
  export function useShelfNamePrompt(): { ask: (onName: (name: string) => void) => void; element: React.ReactNode };
  export function ShelfPicker(props: { shelves: ShelfRow[]; selected: string | null; onSelect: (shelfId: string) => void; onCreated: (s: ShelfRow) => void }): JSX.Element;
  // VerdictSheet props: rooms → shelves: ShelfRow[]; onAdd(status, shelfId: string | null); onAddDetails(shelfId: string | null); + onShelvesChanged: () => void
  // /book/edit create-mode param: room → shelfId
  ```

- [ ] **Step 1: The name prompt**

Create `src/components/shelves/useShelfNamePrompt.tsx`:

```tsx
import React, { useRef, useState } from 'react';
import { Alert, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { font, ink, radius } from '@/theme/palette';

/** "+ New shelf" name prompt: native Alert.prompt on iOS, a tiny modal elsewhere. Render `element` once. */
export function useShelfNamePrompt() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const cb = useRef<(name: string) => void>(() => {});

  const ask = (onName: (name: string) => void) => {
    cb.current = onName;
    if (Platform.OS === 'ios') {
      Alert.prompt('New shelf', 'What should we call it?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Add', onPress: (v?: string) => { if (v?.trim()) onName(v); } },
      ], 'plain-text');
    } else {
      setDraft('');
      setOpen(true);
    }
  };

  const submit = () => {
    const v = draft.trim();
    setOpen(false);
    if (v) cb.current(v);
  };

  const element = Platform.OS === 'ios' ? null : (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <Pressable style={{ flex: 1, backgroundColor: '#0006', justifyContent: 'center', padding: 24 }} onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Cancel">
        <Pressable onPress={() => {}} style={{ backgroundColor: ink.paper, borderWidth: 2.5, borderColor: ink.brown, borderRadius: radius.card, padding: 16 }}>
          <Text style={{ fontFamily: font.black, fontSize: 16, color: ink.brown }}>New shelf</Text>
          <TextInput value={draft} onChangeText={setDraft} autoFocus placeholder="What should we call it?" placeholderTextColor={ink.soft}
            onSubmitEditing={submit} accessibilityLabel="Shelf name"
            style={{ marginTop: 10, minHeight: 44, borderWidth: 2, borderColor: ink.brown, borderRadius: radius.card, paddingHorizontal: 10, fontFamily: font.bold, fontSize: 16, color: ink.brown, backgroundColor: ink.white }} />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginTop: 12 }}>
            <Pressable onPress={() => setOpen(false)} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ fontFamily: font.heavy, fontSize: 14, color: ink.brown }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={submit} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ fontFamily: font.black, fontSize: 14, color: ink.brown }}>Add</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );

  return { ask, element };
}
```

> The scrim `'#0006'` is the only literal colour. If the reviewer flags it, use `ink.brown` with `opacity` on a separate absolute View instead.

- [ ] **Step 2: `ShelfPicker`**

Create `src/components/shelves/ShelfPicker.tsx`:

```tsx
import React from 'react';
import { View } from 'react-native';
import type { ShelfRow } from '@/lib/types';
import { createShelf } from '@/db/repository';
import { SUGGESTED_SHELVES } from '@/features/shelves/shelfRules';
import { Chip } from '@/components/ui/Chip';
import { useShelfNamePrompt } from './useShelfNamePrompt';

/** Pick a shelf; "+ New shelf" creates and selects one. With no shelves, suggestions create on tap. */
export function ShelfPicker({ shelves, selected, onSelect, onCreated }: {
  shelves: ShelfRow[]; selected: string | null; onSelect: (shelfId: string) => void; onCreated: (s: ShelfRow) => void;
}) {
  const prompt = useShelfNamePrompt();
  const create = (name: string) => {
    const s = createShelf(name);
    onCreated(s);
    onSelect(s.id);
  };
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
      {shelves.length
        ? shelves.map((s) => <Chip key={s.id} label={s.name} selected={selected === s.id} onPress={() => onSelect(s.id)} />)
        : SUGGESTED_SHELVES.map((n) => <Chip key={n} label={n} onPress={() => create(n)} />)}
      <Chip label="+ New shelf" onPress={() => prompt.ask(create)} />
      {prompt.element}
    </View>
  );
}
```

- [ ] **Step 3: Store Mode**

In `src/features/scanner/VerdictSheet.tsx`:
1. Imports: add `import type { ShelfRow } from '@/lib/types';` and `import { ShelfPicker } from '@/components/shelves/ShelfPicker';`. Remove `Chip` if it's no longer used.
2. Props: replace `rooms: string[]` with `shelves: ShelfRow[]`, change `onAdd: (status: 'owned' | 'wishlist', room: string | null) => void` to `onAdd: (status: 'owned' | 'wishlist', shelfId: string | null) => void`, change `onAddDetails: (room: string | null) => void` to `onAddDetails: (shelfId: string | null) => void`, and add `onShelvesChanged: () => void`. Update the destructuring to match.
3. Replace `const [room, setRoom] = useState<string | null>(rooms[0] ?? null);` with `const [room, setRoom] = useState<string | null>(shelves[0]?.id ?? null);`. It keeps the name `room` so every existing `onAdd('owned', room)` / `onAddDetails(room)` call passes a shelf id.
4. In `perRoom`, replace `ub.location?.trim() || 'Unshelved'` (both occurrences) with `ub.shelfName ?? 'Unshelved'`.
5. The "Add copy anyway" link: `onAdd('owned', v.userBooks[0]?.location ?? null)` becomes `onAdd('owned', v.userBooks[0]?.shelfId ?? null)`.
6. Replace the `roomPicker` chips row with the picker:

```tsx
  const roomPicker = (
    <>
      <Text style={{ fontFamily: font.heavy, fontSize: 13, color: ink.brown, marginTop: 14 }}>Shelve it in</Text>
      <ShelfPicker shelves={shelves} selected={room} onSelect={setRoom} onCreated={onShelvesChanged} />
    </>
  );
```

In `app/(tabs)/scan.tsx`:
1. Repository import: replace `listRooms` with `listShelves` and `setLocation` with `setCopyShelf`. Add `import { UNSHELVED } from '@/features/shelves/shelfRules';`. Delete the `DEFAULT_ROOMS` constant.
2. Replace the `rooms` `useMemo` with:

```tsx
  const [shelfVersion, setShelfVersion] = useState(0);
  const shelves = useMemo(() => listShelves(), [current?.isbn13, shelfVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const shelfName = (id: string | null) => shelves.find((s) => s.id === id)?.name ?? UNSHELVED;
```

3. In `addAs(status, room)`, rename the parameter to `shelfId` and update the body:
   - `setLocation(wishCopy.id, room)` becomes `setCopyShelf(wishCopy.id, shelfId)`;
   - `addUserBook(…, status === 'owned' ? room ?? undefined : undefined)` becomes `addUserBook(…, status === 'owned' ? shelfId : null)`;
   - both toast strings `${room ?? 'Unshelved'}` become `${shelfName(shelfId)}`.
4. `addDetails(room)` becomes `addDetails(shelfId: string | null)`, and pushes `params: shelfId ? { isbn, shelfId } : { isbn }`.
5. `<VerdictSheet … rooms={rooms} …/>` becomes `shelves={shelves}`, plus `onShelvesChanged={() => setShelfVersion((v) => v + 1)}`.

- [ ] **Step 4: Missing-book form**

In `app/book/edit.tsx`, change the params type `room?: string` to `shelfId?: string` and `addUserBook(book.id, 'owned', params.room || undefined)` to `addUserBook(book.id, 'owned', params.shelfId || null)`.

- [ ] **Step 5: Book detail**

In `app/book/[id].tsx`:
1. Imports: replace `listRooms` with `listShelves` and `setLocation` with `setCopyShelf` in the repository import. Add `import { ShelfPicker } from '@/components/shelves/ShelfPicker';`. Remove `Chip` if it's unused.
2. `const rooms = useMemo(() => listRooms(), [detail]);` becomes `const { data: shelves = [] } = useQuery({ queryKey: ['shelves'], queryFn: () => listShelves() });`. It must stay above the `if (!detail) return`.
3. `const room = focus?.location?.trim() || UNSHELVED;` becomes `const room = focus?.shelfName ?? UNSHELVED;`
4. The neighbours filter becomes `all.filter((r) => r.status !== 'wishlist' && (r.shelfId ?? null) === (focus.shelfId ?? null))` inside the existing `focus ? … : []`.
5. Pocket card copy rows: `cp.location?.trim() || UNSHELVED` becomes `cp.shelfName ?? UNSHELVED`.
6. Replace the Move shelf chips block (`{moving && focus ? (<View …>{(rooms.length ? rooms : [...]).map(…)}</View>) : null}`) with:

```tsx
        {moving && focus ? (
          <View style={{ marginHorizontal: 16, marginTop: 8 }}>
            <ShelfPicker
              shelves={shelves}
              selected={focus.shelfId}
              onSelect={(id) => { setCopyShelf(focus.id, id); setMoving(false); refresh(); }}
              onCreated={refresh}
            />
          </View>
        ) : null}
```

- [ ] **Step 6: Search**

In `app/(tabs)/search.tsx`, change `r.location?.trim() || UNSHELVED` to `r.shelfName ?? UNSHELVED`.

- [ ] **Step 7: Retire `location`**

1. `src/lib/types.ts`: delete `location: string | null;` from `UserBook`.
2. `src/db/repository.ts`:
   - delete `location: r.location,` from `toUserBook`;
   - delete `setLocation` and `listRooms`;
   - change `CopyField` to `'status' | 'shelf_id'`.
3. `src/test/fixtures.ts`: remove the `location` option and field.
4. Verify:

```
grep -rn "location\|listRooms\|setLocation\|DEFAULT_ROOMS\|groupByRoom" app src --include=*.ts --include=*.tsx
```

Expected hits are **only**:
- `src/db/migrations/v3ReadingTracking.ts` and `v4ShelfCreation.ts`, which read the old column on purpose;
- `src/features/shelves/shelfRules.ts` (`migrateLocations`) and its test;
- unrelated words such as `Linking`/`locationInWindow`, if any.

Fix everything else.

- [ ] **Step 8: Checks**

Run: `npx tsc --noEmit && npx jest`. Both pass.

- [ ] **Step 9: Manual checks (for Sean)**
1. In Store Mode, tap "+ New shelf" and name it. It's created and selected, and Add to shelves puts the book on it.
2. On a fresh install with no shelves, the suggestion chips create a shelf.
3. On detail, Move shelf with "+ New shelf" works.
4. The missing-book form shelves onto the chosen shelf.
5. Search shows the shelf name.

- [ ] **Step 10: Hand-off**

Files: those listed above.

---

### Task 6: Manage shelves

**Files:**
- Install: `react-native-gesture-handler` (the SDK 57 version)
- Modify: `app/_layout.tsx` (`GestureHandlerRootView`), `app/(tabs)/index.tsx` ("Manage shelves" link), `DESIGN.md`
- Create: `src/components/shelves/ReorderList.tsx`, `app/shelves.tsx`

**Interfaces:**
- Consumes:
  - `listShelves`, `createShelf`, `renameShelf`, `ShelfNameTaken`, `setShelfPlank`, `reorderShelves`, `deleteShelf` (Task 2);
  - `PLANK_INKS`, `plankColor`, `UNSHELVED` (Task 1);
  - `useShelfNamePrompt` (Task 5);
  - `invalidateLibrary`.
- Produces: route `/shelves`; `ReorderList<T extends { id: string }>({ items, rowHeight, renderRow, onReorder })`.

- [ ] **Step 1: Install and root view**

Run: `npx expo install react-native-gesture-handler`. Expected: the SDK 57 version (~2.32.0) is added.

In `app/_layout.tsx`:
- add `import { GestureHandlerRootView } from 'react-native-gesture-handler';`;
- wrap the returned tree as `<GestureHandlerRootView style={{ flex: 1 }}><QueryProvider>…</QueryProvider></GestureHandlerRootView>`;
- add `<Stack.Screen name="shelves" />` inside the Stack (a normal push; no options needed).

- [ ] **Step 2: `ReorderList`**

Create `src/components/shelves/ReorderList.tsx`:

```tsx
import React, { useCallback } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring, type SharedValue,
} from 'react-native-reanimated';

type Positions = Record<string, number>;

function Row({ id, count, rowHeight, positions, onDrop, onMove, children }: {
  id: string; count: number; rowHeight: number; positions: SharedValue<Positions>;
  onDrop: () => void; onMove: (id: string, dir: -1 | 1) => void; children: React.ReactNode;
}) {
  const top = useSharedValue(positions.value[id] * rowHeight);
  const start = useSharedValue(0);
  const active = useSharedValue(false);

  useAnimatedReaction(
    () => positions.value[id],
    (cur, prev) => {
      if (cur !== prev && !active.value) top.value = withSpring(cur * rowHeight, { damping: 18, stiffness: 220 });
    }
  );

  const pan = Gesture.Pan()
    .activateAfterLongPress(250)
    .onStart(() => {
      active.value = true;
      start.value = top.value;
    })
    .onUpdate((e) => {
      top.value = start.value + e.translationY;
      const to = Math.min(count - 1, Math.max(0, Math.round(top.value / rowHeight)));
      const from = positions.value[id];
      if (to !== from) {
        const next: Positions = { ...positions.value };
        for (const k of Object.keys(next)) if (next[k] === to) next[k] = from;
        next[id] = to;
        positions.value = next;
      }
    })
    .onEnd(() => {
      top.value = withSpring(positions.value[id] * rowHeight, { damping: 18, stiffness: 220 });
      active.value = false;
      runOnJS(onDrop)();
    });

  const style = useAnimatedStyle(() => ({
    position: 'absolute', left: 0, right: 0, height: rowHeight, top: top.value,
    zIndex: active.value ? 10 : 0,
    transform: [{ scale: active.value ? 1.02 : 1 }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={style}
        accessibilityActions={[{ name: 'moveUp', label: 'Move up' }, { name: 'moveDown', label: 'Move down' }]}
        onAccessibilityAction={(e) => onMove(id, e.nativeEvent.actionName === 'moveUp' ? -1 : 1)}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

/** Long-press a row to drag it; VoiceOver users get Move up / Move down actions. Fixed-height rows. */
export function ReorderList<T extends { id: string }>({ items, rowHeight, renderRow, onReorder }: {
  items: T[]; rowHeight: number; renderRow: (item: T, index: number) => React.ReactNode; onReorder: (ids: string[]) => void;
}) {
  const positions = useSharedValue<Positions>(Object.fromEntries(items.map((it, i) => [it.id, i])));

  const commit = useCallback(() => {
    const ids = Object.entries(positions.value).sort((a, b) => a[1] - b[1]).map(([id]) => id);
    if (ids.join() !== items.map((i) => i.id).join()) onReorder(ids);
  }, [items, onReorder, positions]);

  const move = useCallback((id: string, dir: -1 | 1) => {
    const ids = items.map((i) => i.id);
    const at = ids.indexOf(id);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= ids.length) return;
    [ids[at], ids[to]] = [ids[to], ids[at]];
    onReorder(ids);
  }, [items, onReorder]);

  return (
    <View style={{ height: items.length * rowHeight }}>
      {items.map((it, i) => (
        <Row key={it.id} id={it.id} count={items.length} rowHeight={rowHeight} positions={positions} onDrop={commit} onMove={move}>
          {renderRow(it, i)}
        </Row>
      ))}
    </View>
  );
}
```

> Callers must remount `ReorderList` when the set of ids changes, after a create, delete or reorder commit, by passing `key={items.map((i) => i.id).join()}`. That resets `positions`. If `runOnJS` is flagged as removed in the installed Reanimated 4, use `scheduleOnRN` from `react-native-worklets` (the drop-in replacement) and report it. **Fallback, if long-press drag misbehaves in Expo Go:** keep the accessibility actions and also render visible ↑/↓ buttons in each row that call `move`, which the spec allows. Report which you shipped.

- [ ] **Step 3: The Manage shelves screen**

Create `app/shelves.tsx`:

```tsx
import React, { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';
import type { Plank, ShelfRow } from '@/lib/types';
import { createShelf, deleteShelf, listShelves, renameShelf, reorderShelves, setShelfPlank, ShelfNameTaken } from '@/db/repository';
import { PLANK_INKS, plankColor, UNSHELVED } from '@/features/shelves/shelfRules';
import { invalidateLibrary } from '@/lib/invalidateLibrary';
import { ReorderList } from '@/components/shelves/ReorderList';
import { useShelfNamePrompt } from '@/components/shelves/useShelfNamePrompt';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Raised } from '@/components/ui/Raised';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { font, ink, radius } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

const ROW_H = 68;

function EditSheet({ shelf, others, onClose, onChanged }: { shelf: ShelfRow; others: ShelfRow[]; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState(shelf.name);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [moveTo, setMoveTo] = useState<string | null>(null);

  const save = () => {
    try {
      renameShelf(shelf.id, name);
      setError(null);
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof ShelfNameTaken ? e.message : 'Give the shelf a name.');
    }
  };
  const recolour = (p: Plank) => { setShelfPlank(shelf.id, p); onChanged(); };
  const remove = () => { deleteShelf(shelf.id, moveTo); onChanged(); onClose(); };
  const askDelete = () => {
    if (shelf.bookCount === 0) {
      Alert.alert(`Delete the ${shelf.name} shelf?`, undefined, [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: remove },
      ]);
    } else setDeleting(true);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      <View style={{ backgroundColor: ink.paper, borderTopWidth: 2.5, borderColor: ink.brown, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, padding: 20, paddingBottom: 36 }}>
        {deleting ? (
          <>
            <Text accessibilityRole="header" style={{ fontFamily: font.black, fontSize: 17, color: ink.brown }}>
              {`Delete the ${shelf.name} shelf? Move its ${shelf.bookCount} ${shelf.bookCount === 1 ? 'book' : 'books'} to:`}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              {others.map((o) => <Chip key={o.id} label={o.name} selected={moveTo === o.id} onPress={() => setMoveTo(o.id)} />)}
              <Chip label={UNSHELVED} selected={moveTo === null} onPress={() => setMoveTo(null)} />
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
              <Button variant="ghost" flex label="Keep it" onPress={() => setDeleting(false)} />
              <Button flex label="Delete" onPress={remove} />
            </View>
          </>
        ) : (
          <>
            <Text style={{ fontFamily: font.heavy, fontSize: 13, color: ink.brown }}>Name</Text>
            <TextInput value={name} onChangeText={(t) => { setName(t); setError(null); }} accessibilityLabel="Shelf name" onSubmitEditing={save}
              style={{ marginTop: 6, minHeight: 46, paddingHorizontal: 12, borderWidth: 2, borderColor: error ? ink.tomato : ink.brown, borderRadius: radius.card, backgroundColor: ink.white, fontFamily: font.bold, fontSize: 16, color: ink.brown }} />
            {error ? <Text style={{ fontFamily: font.bold, fontSize: 12.5, color: ink.tomato, marginTop: 4 }}>{error}</Text> : null}
            <Text style={{ fontFamily: font.heavy, fontSize: 13, color: ink.brown, marginTop: 16 }}>Plank colour</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
              {PLANK_INKS.map((p) => (
                <Pressable key={p} onPress={() => recolour(p)} accessibilityRole="button" accessibilityLabel={`Plank colour ${p}`} accessibilityState={{ selected: shelf.plank === p }}
                  style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: plankColor(p), borderWidth: shelf.plank === p ? 4 : 2, borderColor: ink.brown }} />
              ))}
            </View>
            <View style={{ marginTop: 18 }}><Button label="Save" onPress={save} /></View>
            <Pressable onPress={askDelete} accessibilityRole="button" style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 6 }}>
              <Text style={{ fontFamily: font.heavy, fontSize: 13.5, color: ink.tomato, textDecorationLine: 'underline' }}>Delete shelf</Text>
            </Pressable>
          </>
        )}
      </View>
    </Modal>
  );
}

export default function ManageShelvesScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { c } = useTheme();
  const { data: shelves = [] } = useQuery({ queryKey: ['shelves'], queryFn: () => listShelves() });
  const [editing, setEditing] = useState<ShelfRow | null>(null);
  const prompt = useShelfNamePrompt();
  const refresh = () => invalidateLibrary(qc);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
          <Raised offset={2} radius={22} style={{ alignSelf: 'flex-start' }}>
            <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back"
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: ink.white, borderWidth: 2.5, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
              <Svg width={20} height={20} fill="none" stroke={ink.brown} strokeWidth={2.8}><Path d="M13 4l-7 6 7 6" /></Svg>
            </Pressable>
          </Raised>
        </View>
        <ScreenHeader title="Manage shelves" sub={shelves.length ? 'Hold a shelf to drag it. Tap to rename or recolour.' : 'No shelves yet. Add your first below.'} />
        <View style={{ marginHorizontal: 16, marginTop: 14 }}>
          <ReorderList
            key={shelves.map((s) => s.id).join()}
            items={shelves}
            rowHeight={ROW_H}
            onReorder={(ids) => { reorderShelves(ids); refresh(); }}
            renderRow={(s) => (
              <Pressable onPress={() => setEditing(s)} accessibilityRole="button"
                accessibilityLabel={`${s.name}, ${s.bookCount} ${s.bookCount === 1 ? 'book' : 'books'}. Tap to edit, hold to drag.`}
                style={{ height: ROW_H - 8, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: ink.white, borderWidth: 2, borderColor: c.line, borderRadius: 12, paddingHorizontal: 12 }}>
                <View style={{ width: 28, height: 14, backgroundColor: plankColor(s.plank), borderWidth: 2, borderColor: ink.brown }} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontFamily: font.black, fontSize: 15, color: ink.brown }}>{s.name}</Text>
                  <Text style={{ fontFamily: font.bold, fontSize: 12.5, color: ink.soft }}>{`${s.bookCount} ${s.bookCount === 1 ? 'book' : 'books'}`}</Text>
                </View>
                <Svg width={18} height={18} stroke={ink.soft} strokeWidth={2.4} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Path d="M3 6h12M3 12h12" /></Svg>
              </Pressable>
            )}
          />
          <View style={{ marginTop: 12 }}>
            <Button variant="ghost" label="+ New shelf" onPress={() => prompt.ask((n) => { createShelf(n); refresh(); })} />
          </View>
        </View>
      </ScrollView>
      {prompt.element}
      {editing ? (
        <EditSheet
          shelf={shelves.find((s) => s.id === editing.id) ?? editing}
          others={shelves.filter((s) => s.id !== editing.id)}
          onClose={() => setEditing(null)}
          onChanged={refresh}
        />
      ) : null}
    </SafeAreaView>
  );
}
```

> `ReorderList` sits inside a `ScrollView`. A long-press-activated Pan doesn't steal ordinary scrolls. If the scroll view still interferes while dragging, pass `scrollEnabled={false}` to the ScrollView while a drag is active, via an `onDragStart`/`onDragEnd` prop you add to `ReorderList`. Report it if you needed that.

- [ ] **Step 4: The "Manage shelves" link on Shelves**

In `app/(tabs)/index.tsx`, directly after `<ScreenHeader … />`, add:

```tsx
        <Pressable onPress={() => router.push('/shelves')} accessibilityRole="button" hitSlop={8}
          style={{ alignSelf: 'flex-start', marginHorizontal: 20, marginTop: 4, minHeight: 32, justifyContent: 'center' }}>
          <Text style={{ fontFamily: font.heavy, fontSize: 13, color: c.text, textDecorationLine: 'underline' }}>Manage shelves</Text>
        </Pressable>
```

(Add `Pressable`/`Text` to the `react-native` import and `font` to the palette import.)

- [ ] **Step 5: DESIGN.md**

Insert a `### Shelves` section immediately before `## Do's and Don'ts`:

```markdown
### Shelves

Shelves are places (`shelves` + `user_books.shelf_id`); each At home copy sits on one shelf or on **Unshelved** (wishlist copies never do). A shelf keeps its **plank colour** (bus · tomato · pool · grass · plum; new shelves take the next ink) and your **order**; the bookcase shows every shelf in that order — empty ones read "Nothing here yet" — with Unshelved last when it has books. **"+ New shelf"** sits in every shelf picker (Store Mode, Move shelf, the missing-book form); with no shelves yet the pickers suggest Living room · Bedroom · Study. **Manage shelves** (`/shelves`, linked under the Shelves header) lists shelves with plank, name and count: hold to drag-reorder (VoiceOver: Move up / Move down), tap to rename or recolour, and delete — a shelf with books asks "Move its N books to:" (another shelf or Unshelved). Names are unique ignoring case; a clash reads "You already have a shelf called ⟨Name⟩."
```

- [ ] **Step 6: Checks**

Run: `npx tsc --noEmit && npx jest && npx expo-doctor`. All pass.

- [ ] **Step 7: Manual checks (for Sean)**
1. Tap Manage shelves: the list shows plank, name and count.
2. Hold and drag a shelf. The order persists and the bookcase follows it.
3. Rename, including onto an existing name (the inline error shows), and recolour.
4. Delete an empty shelf, then a shelf with books into another shelf, then into Unshelved.
5. "+ New shelf" adds a shelf at the end.

- [ ] **Step 8: Hand-off**

Files: `package.json`, `package-lock.json`, `app/_layout.tsx`, `app/(tabs)/index.tsx`, `src/components/shelves/ReorderList.tsx`, `app/shelves.tsx`, `DESIGN.md`.

---

## Spec coverage check

| Spec section | Task |
|---|---|
| §2.1 plank; unique names; new shelves go to the end with the next ink; soft delete | 1 (rules), 2 (API) |
| §2.2 `shelf_id`; owned only; `location` retired; `shelfId`/`shelfName` on rows | 1 (types), 2 (joins and writes), 5 (retire) |
| §2.3 device v4 migration | 1 (`migrateLocations`), 2 |
| §2.4 server migration and sync note | 3 |
| §3 repository API | 2 (removals in 5) |
| §4 pure rules | 1, 4 (`mostCopied`) |
| §5.1 bookcase order, planks, empty shelves, Unshelved last, Dewey lines | 4; the Manage link is in 6 |
| §5.2 Manage shelves (drag, edit, recolour, delete-with-move, new) | 6 |
| §5.3 inline "+ New shelf" everywhere; suggestions | 5 |
| §5.4 other `location` readers | 4 (profile), 5 (Store Mode, Search, detail) |
| §6 edge cases (name clashes, wishlist clears shelf, invalidation, upgrade merging) | 1, 2, 4, 5 |
| §7 tests | 1, 4, plus the manual steps in 2, 4, 5, 6 |

**Deviations:**
- **The "Manage shelves" link lands in Task 6 with its route,** not Task 4. Typed routes need the route file to exist first.
- **`addUserBook`'s third argument changes meaning in Task 2,** and its callers are switched in Task 5. The value is a string either way, so it compiles. Nothing ships in between.
