# Shelf Creation — Design Spec

**Date:** 2026-09-22 · **Status:** approved by Sean in brainstorming; awaiting spec review
**Builds on:** Reading tracking (ownership is `owned` | `wishlist` on `user_books`). **Out of scope:** rooms containing shelves, shelf icons, sorting books within a shelf, collections (`shelf_books` stays reserved for them).

## 1. Goal

Today a "shelf" on the bookcase is a free-text `user_books.location`. You can't create one, rename it, reorder it or colour it. The only choices are existing names or three preset chips, and planks are coloured by position.

This spec makes shelves **places**: real records that you create, rename, reorder, recolour and delete. Each At home copy sits on exactly one shelf, or on none (**Unshelved**).

## 2. Data model

### 2.1 `shelves` (already exists on the device and the server; gains `plank`)

```
shelves(id, name, sort_order, plank, icon, created_at, updated_at, deleted_at)
  plank TEXT NOT NULL CHECK (plank IN ('bus','tomato','pool','grass','plum'))
```

- **Unique names** among live shelves, compared with `normaliseName` (trimmed, lower-cased).
- **New shelves:** `sort_order` = max + 1; `plank` = `nextPlank(existing)`, the ink after the last shelf's plank in `PLANKS` order (`bus, tomato, pool, grass, plum`, cycling). The first shelf gets `bus`.
- Soft delete via `deleted_at`, as on other tables.

### 2.2 Copies

- `user_books.shelf_id` → `shelves.id`, nullable; NULL = Unshelved.
- **Only `owned` copies have a shelf.** Setting a copy to `wishlist` clears its `shelf_id`, and adding a wishlist copy never sets one.
- `user_books.location` is retired: always NULL and never read. The column stays because SQLite can't drop it without rebuilding the table.
- `LibraryRow` / `UserBook` / `CopyRow` expose `shelfId: string | null` and `shelfName: string | null`, the latter joined from live shelves.

### 2.3 Device migration (SQLite v4, one transaction, JS function)

1. `ALTER TABLE shelves ADD COLUMN plank TEXT NOT NULL DEFAULT 'bus'`; `ALTER TABLE user_books ADD COLUMN shelf_id TEXT REFERENCES shelves(id)`; `CREATE INDEX idx_user_books_shelf ON user_books(shelf_id)`.
2. `migrateLocations(copies)` (pure, tested) turns live copies' `location` values into shelf specs:
   - trim each name; blank names mean Unshelved;
   - group names that differ only by capitals;
   - within a group, the display name is the capitalisation used by the most copies (a tie goes to the earliest copy's);
   - shelves are ordered by book count descending, ties by name. That matches today's bookcase order.
   - planks are assigned in order via `nextPlank`.
3. Insert the shelves, set each copy's `shelf_id`, set `location = NULL` on every row (including soft-deleted rows), and queue `pending_ops` upserts for the new shelves and the changed copies.
4. Rewrite queued `user_books` op payloads: drop `location`, and set `shelf_id = null`. These ops predate the shelf upserts queued in step 3, so referencing a shelf id here would fail the server FK and stall the oldest-first queue; the fresh post-shelf upsert from step 3 already carries the real `shelf_id` for any copy that got one.

### 2.4 Server migration (`20260922000000_shelf_creation.sql`)

1. `alter table public.shelves add column plank text not null default 'bus' check (plank in ('bus','tomato','pool','grass','plum'))`.
2. `alter table public.user_books add column shelf_id text references public.shelves (id)`, plus an index.
3. Backfill per user, with the same rules as §2.3.2 (trimmed, merged by lower-case, most-used capitalisation, ordered by count), using server-generated ids (`gen_random_uuid()::text`). Planks cycle by `sort_order` over the five inks.
4. `update public.user_books set shelf_id = …, location = null`.

**Server and device ids differ.** The Phase 3 sync note in `src/sync/syncEngine.ts` gains a line saying shelves must be matched on `(user_id, lower(trim(name)))` when push/pull is wired. This is the same class of problem as readings.

## 3. Repository API

| Function | Behaviour |
|---|---|
| `listShelves(): ShelfRow[]` | Live shelves ordered by `sort_order`: `{ id, name, plank, sortOrder, bookCount }` (count of live `owned` copies). |
| `createShelf(name): ShelfRow` | Trims. Throws on blank. Returns the existing live shelf on a normalised name match. Otherwise inserts at the end with `nextPlank`. |
| `renameShelf(id, name)` | Trims. Throws on blank. Throws `ShelfNameTaken` if another live shelf has the same normalised name. |
| `setShelfPlank(id, plank)` | Only the five inks. |
| `reorderShelves(ids: string[])` | One transaction. Given ids get `sort_order` 0..n-1; live shelves not listed keep their relative order after them. |
| `deleteShelf(id, moveTo: string \| null)` | One transaction. Every live copy on the shelf moves to `moveTo` (a live shelf id) or Unshelved, then the shelf is soft-deleted. |
| `setCopyShelf(copyId, shelfId \| null)` | Replaces `setLocation`. Ignored (kept null) for wishlist copies. |
| `addUserBook(bookId, status, shelfId?)` | The third argument is a shelf id; it's ignored for `wishlist`. |
| `setStatus(copyId, 'wishlist')` | Also clears `shelf_id`. |
| Removed | `listRooms`, `setLocation`. |

Every write queues `pending_ops` (`shelves` upserts, a `delete` op for soft-deleted shelves, `user_books` upserts carrying `shelf_id`).

## 4. Pure rules (`src/features/shelves/shelfRules.ts`)

- `PLANK_INKS = ['bus','tomato','pool','grass','plum'] as const`; `type Plank`.
- `normaliseName(s) = s.trim().toLowerCase()`.
- `nextPlank(existing: { plank: Plank; sortOrder: number }[]): Plank`: the ink after the plank of the shelf with the highest `sortOrder`, or `bus` if there are none.
- `migrateLocations(copies: { id; location: string | null; createdAt }[])` → `{ shelves: { key, name, sortOrder, plank }[]; copyShelf: Record<copyId, key | null> }`.
- `groupByShelf(rows: LibraryRow[], shelves: ShelfRow[])` → `{ shelf: ShelfRow | null; rows: LibraryRow[] }[]`:
  - shelves in `sortOrder`, including empty ones;
  - an Unshelved group (`shelf: null`) last, only if it has rows;
  - wishlist rows are left out.

  It replaces `groupByRoom`. `mostCopied` stays.
- `plankColor(p: Plank) = ink[p]`.

## 5. Screens

### 5.1 Shelves (home)
- The bookcase renders `groupByShelf` in your order with each shelf's saved plank. An empty shelf shows its plank and name with a "Nothing here yet" note.
- A small **"Manage shelves"** link sits in the header area and opens `/shelves`.
- Dewey's shelf lines (`roomNote`, `shelvesLines`) receive names and counts from the groups (the Unshelved group uses "Unshelved").

### 5.2 Manage shelves (`app/shelves.tsx`, pushed)
- **Rows:** plank swatch, name, "N books", and a drag handle.
- **Reorder:** long-press and drag, built with Reanimated plus `react-native-gesture-handler`, which is in Expo Go but only a transitive dependency today, so add it with `npx expo install react-native-gesture-handler` (the SDK 57 version, ~2.32.0). It is the only new dependency. If drag proves unreliable in Expo Go, fall back to ↑/↓ buttons on each row. Either way, the new order saves via `reorderShelves`.
- **Tapping a row** opens an edit sheet with:
  - a Name field, Save, and the inline error "You already have a shelf called ⟨Name⟩.";
  - Plank colour: five swatches;
  - a Delete shelf action.
- **Delete:**
  - an empty shelf asks "Delete the ⟨Name⟩ shelf?";
  - a shelf with books asks "Delete the ⟨Name⟩ shelf? Move its N books to:", with a choice of the other shelves plus **Unshelved** (the default) and a Delete button.
- **"+ New shelf"** at the bottom opens the name prompt.

### 5.3 Inline "+ New shelf" in every shelf picker
- **Where:**
  - the Store Mode verdict's "Shelve it in" chips (new, wishlist and read verdicts);
  - book detail's Move shelf chips;
  - the missing-book form (the `room` param becomes a `shelfId` param).
- **The prompt:** `Alert.prompt` on iOS, a small modal with a TextInput on Android. It calls `createShelf` and selects the result.
- **With no shelves**, pickers show suggestion chips **Living room · Bedroom · Study**. Tapping one creates that shelf and selects it.

### 5.4 Other readers of the old location
Everywhere that used `location` switches to `shelfName`: Store Mode per-shelf lines, the Search "On your shelves" right-hand label, book detail (TapeNote, neighbours, the pocket card copy rows, the ownership pill "At home · ⟨shelf⟩"), and profile stats (`listRooms().length` becomes `listShelves().length`).

## 6. Edge cases

- **Name clashes:** creating an existing name returns that shelf; renaming onto an existing name is refused. Names of deleted shelves are free to reuse.
- **Status changes:** moving an At home copy to the wishlist clears its shelf. Wishlist copies never carry one.
- **Deleting the shelf being viewed:** book detail re-renders with the copy's new shelf, via query invalidation.
- **Upgrading:** whitespace-only locations become Unshelved, and names that differ only by capitals merge (§2.3).
- **Reordering** is atomic and persists across restarts.
- **Invalidation:** `invalidateLibrary` also invalidates a `['shelves']` key.

## 7. Testing

- **Unit (Jest):**
  - `nextPlank`: none, cycling, and wrapping after `plum`;
  - `normaliseName`;
  - `migrateLocations`: merging by capitals, blank → Unshelved, count ordering, the capitalisation tie-break, plank cycling;
  - `groupByShelf`: order, empty shelves included, Unshelved last and only when non-empty, wishlist left out;
  - update the `invalidateLibrary` test for `['shelves']`;
  - move or retire `groupByRoom` tests into `groupByShelf` tests.
- **Manual (iPhone, Expo Go SDK 57):**
  1. Upgrade an install that has rooms: same shelves, same order, planks assigned.
  2. Create a shelf inline mid-scan.
  3. Rename (including a clashing name), recolour, and drag to reorder.
  4. Delete a shelf with books into another shelf, then into Unshelved.
  5. A first scan with no shelves, using a suggestion chip.
  6. Move a copy to the wishlist and back: its shelf clears.
