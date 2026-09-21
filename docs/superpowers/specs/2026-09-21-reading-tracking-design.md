# Reading Tracking — Design Spec

**Date:** 2026-09-21 · **Status:** approved by Sean in brainstorming; awaiting spec review
**Builds on:** Manual book details and Dewey ratings (shipped in `1307d2f`). **Precedes:** shelf creation.

## 1. Goal

Booklistd tracks two separate things about a book:

- **What I have** (ownership): *At home* or *Wishlist*. This is the core promise: out in a shop, you know what you own and what you're hunting for.
- **Where I am with it** (reading): *Want to read · Reading · Read · Did not finish*, with start and finish dates and the Dewey rating.

Today a single `user_books.status` mixes the two. Marking a book read changes `owned` to `read`, and there is no Want to read or Did not finish. This spec separates them.

**Out of scope for now:** page progress; a full log of each re-read; reading goals, and stats beyond counts per year; shelf creation (the next sub-project); a "Borrowed" or "Gave away" ownership state.

## 2. Data model

### 2.1 Copies (`user_books`) are ownership only

- `status` ∈ {`owned`, `wishlist`}. The column keeps its name. `owned` is shown as **At home**.
- `rating` is retired: always NULL and never read. The column stays in SQLite because dropping it would mean rebuilding the table.
- Loans stay in `loans`. A lent-out copy is still `owned`.
- The `BookStatus` type becomes `'owned' | 'wishlist'`.

### 2.2 `readings` (new; SQLite and Supabase)

```sql
readings(
  id          TEXT PRIMARY KEY,            -- client-generated (newId), same as user_books
  user_id     uuid  (Supabase only; default auth.uid())
  book_id     → books(id) NOT NULL,
  state       TEXT NOT NULL CHECK (state IN ('want','reading','read','dnf')),
  started_at  TEXT NULL,                   -- 'YYYY-MM-DD'
  finished_at TEXT NULL,                   -- 'YYYY-MM-DD'
  rating      INTEGER NULL CHECK (rating BETWEEN 1 AND 7),
  created_at, updated_at, deleted_at,
  UNIQUE (user_id, book_id)                -- Supabase; SQLite: CREATE UNIQUE INDEX ux_readings_live ON readings(book_id) WHERE deleted_at IS NULL
)
```

- **One live reading per book.** A new reading for a book with a soft-deleted one brings the old row back (clears `deleted_at` and resets its fields) instead of inserting a second row.
- **Automatic dates** (pure function `applyReadingState(prev, next, today)`):
  - `→ reading`: sets `started_at = today` if it's empty, or if the previous state was `read`/`dnf` (a re-read). Clears `finished_at`.
  - `→ read` / `→ dnf`: sets `finished_at = today`. `started_at` is left alone (it may stay empty).
  - `→ want`: clears both dates.
  - The rating is kept through every state change.
- **Editing dates:** both are editable. `finished_at` can't be earlier than `started_at`; if it would be, it is set to `started_at`.
- **Rating:** can be set when the state is `read` or `dnf`; `setReadingRating` throws otherwise. It stays on the row whatever the state later becomes.
- **Sync:** every write queues a `pending_ops` upsert for `readings`, the same as copies.
- **Supabase:** owner-only RLS (`user_id = auth.uid()`), matching the other per-user tables.

### 2.3 Server migrations

- **Delete** `supabase/migrations/20260921120000_widen_rating_scale.sql`. It is committed but was never applied to the remote. The rating now lives in `readings.rating`, which has its own 1–7 check, and `user_books.rating` stays under the old 1–5 check and is always NULL.
- **New migration** `20260921130000_reading_tracking.sql`:
  1. Create `readings` with RLS, the owner policy, a `touch_updated_at` trigger (reusing the existing function) and an index on `(user_id, book_id)`.
  2. Backfill: insert readings from `user_books` rows with status `reading`/`read`, then `update user_books set status = 'owned' where status in ('reading','read','loaned')` and `set status = 'wishlist' where status = 'want_to_buy'`.
  3. Replace the `user_books` status CHECK with `status in ('owned','wishlist')`. Drop it by looking it up in `pg_constraint` (its name is Postgres-generated), using the same pattern as the deleted rating migration.

## 3. Device migration (SQLite v3)

In one transaction (`SCHEMA_VERSION` 2 → 3):

1. `CREATE TABLE readings` plus an index on `book_id`.
2. For each `book_id` with live copies whose status is `reading`/`read`: insert one reading.
   - **state:** `read` if any copy is `read`, otherwise `reading`.
   - **started_at / finished_at:** the date part of the chosen copy's `updated_at` goes into `finished_at` for `read`, or `started_at` for `reading`.
   - **rating:** `MAX(copy.rating)`, if any.
3. `UPDATE user_books SET status='owned' WHERE status IN ('reading','read','loaned')`, then `SET status='wishlist' WHERE status='want_to_buy'`, then `SET rating = NULL`.
4. Rewrite queued `pending_ops` payloads for `user_books` the same way, so no op carries an old status once the server's check is narrowed.
5. Queue a `pending_ops` upsert for each new reading and each changed copy.

The mapping is a pure function, `migrateStatus(copies) → { copyStatus, reading? }`, and gets unit tests. The SQL mirrors it.

## 4. Store Mode verdict

The pure function `storeVerdict({ copies, reading, workCopies, workReading })` returns one of the verdicts below, checked in this order. `work*` are the matches found on other editions of the same work.

1. **`owned`**: any At home copy, exact or same work. Heading "You own this!" as today, plus a **reading line**:
   - "Read · ⟨Dewey face⟩ ⟨label⟩"
   - "Reading now · day N"
   - "On your TBR pile"
   - "Didn't finish"
   - nothing, when there's no reading.
2. **`wishlist`**: only wishlist copies. Heading "Found one!", a "WISHLIST" sticker, and Dewey's happy pop, plus the reading line if one exists.
   - Primary action: **"Got it! Shelve it"** moves the wishlist copy to `owned` in the chosen room (reusing the existing move-off-wishlist path in `scan.tsx`).
   - Secondary: "Keep scanning".
3. **`read`**: no copies, but a reading with state `read`/`dnf`. Heading "You've read this"; Dewey shows the rating face, or `happy` if unrated.
   - Line: "⟨label⟩ · Finished ⟨Mon YYYY⟩", or "You gave up on this one" for dnf.
   - Actions: Add to shelves · Wishlist it · Keep scanning.
4. **`new`**: as today, "A new find!", with actions **Add to shelves · Wishlist it · Want to read**.
   - If a `want`/`reading` reading exists without a copy, the "Not on any shelf" line becomes "On your TBR pile" or "You're reading this".
   - The lookup-failed state ("We couldn't find this one.") takes priority as before, and also gets **Want to read**.

**Speed:** readings are found with one indexed query on `book_id`, plus the existing work-key sibling lookup. The Store Mode path stays under 150ms offline.

## 5. Screens

### 5.1 Shelves (home, `app/(tabs)/index.tsx`)
- **"Currently reading" strip** above the bookcase: covers you scroll sideways (`CoverArt`), each with its title and "Day N" (days since `started_at`). Tapping one opens book detail.
- **Empty state:** one line, "Nothing on the go. Pick something from your TBR pile.", linking to Reading › Want to read.
- A "See all reading" link opens `/reading`.
- The bookcase itself is unchanged (At home copies only).

### 5.2 Reading screen (`app/reading.tsx`, pushed)
- Segments: **Reading · Want to read · Read · Did not finish.**
- Each row shows the cover, title, author and an ownership hint: "At home", "On your wishlist", or nothing.
- **Read** is grouped by year of `finished_at` ("2026 · 14 books"), newest first; each row shows the Dewey face and the finished date. Readings with no `finished_at` go under "Undated".

### 5.3 Book detail (`app/book/[id].tsx`)
- **The route param becomes the book id.** If the id matches a live `user_books.id` rather than a book, the screen resolves that copy's `book_id` first, so old links keep working.
- **Ownership row:**
  - "At home · ⟨room⟩" with Move shelf, or "On your wishlist" with Found it!;
  - with no copy: "Add to shelves" / "Wishlist it".
- **Reading row:**
  - Chips **Want to read · Reading · Read · Did not finish**. Tapping the current chip clears the reading, after a confirmation if it has a rating: "This removes your rating too."
  - Dates: "Started 3 Sep · Finished 18 Sep", tap to edit.
  - The Dewey `RatingBadge`, or "Rate it", when the state is read/dnf.
  - Choosing **Read** opens the RatingSheet (as today); choosing **Did not finish** doesn't.
- **Primary button** is the next natural step:
  - **Found it!** (wishlist copy)
  - **Start reading** (want)
  - **Finished it** (reading)
  - otherwise **Mark as read** when it's not read
  - A borrower nudge, when a copy is on loan, takes precedence as today.
- Copies, loans, the neighbouring spines, edit details and the missing-details nudge are unchanged, driven by the copies of this book.

### 5.4 Adding books
- The VerdictSheet "new" and lookup-failed branches, and the Search catalog results, gain **Want to read**. It creates or revives a reading with state `want`, and no copy.
- The **Wishlist tab** is unchanged: "Got it!" moves a copy to `owned`, and any reading stays.

## 6. Repository API (new or changed)

| Function | Behaviour |
|---|---|
| `getReading(bookId)` | Live reading for the book, or null. |
| `findReadingForWork(bookId, workKey)` | Exact-book reading first, else any live reading on a book with the same `work_key`. |
| `setReadingState(bookId, state \| null, today)` | Creates, revives, updates or soft-deletes, using `applyReadingState`, and queues a `pending_ops` op. |
| `setReadingDates(bookId, { startedAt?, finishedAt? })` | Clamped per §2.2. |
| `setReadingRating(bookId, n \| null)` | Validates 1–7 (`isValidRating`); throws unless state is read/dnf. |
| `listReadings(state)` | With the book (via `books_effective`) and the ownership hint. |
| `listCurrentlyReading()` | `listReadings('reading')`, ordered by `started_at` desc. |
| `checkOwnership` | Unchanged signature, plus a `reading` field (exact or same-work) so `storeVerdict` has all it needs. |
| Removed | `setRating` (per copy). `setStatus` only accepts `owned`/`wishlist`. |

## 7. Edge cases

- **Deleting the last copy of a read book:** the reading stays, and Store Mode then shows "You've read this".
- **Want to read and Wishlist** can both apply at once.
- **Re-read** (read → reading): the rating is kept, `started_at` is reset and `finished_at` cleared.
- **Clearing a reading** is a soft delete (`deleted_at`) and is synced.
- **Old-build ops queued** with old statuses are rewritten on the device (§3.4) and on the server (§2.3.2).
- **Deploy order:** push the new migration before the app update reaches devices that sync. The sync push isn't wired up yet, so nothing breaks today.

## 8. Testing

- **Unit (Jest), pure logic:**
  - `applyReadingState`: starting, finishing, dnf, re-read, back to want, rating kept;
  - date clamping;
  - `migrateStatus`, including disagreeing copies, `loaned`, `want_to_buy` and a carried-over rating;
  - `storeVerdict`: all four verdicts, precedence, and matches on other editions;
  - grouping Read by year, including Undated;
  - the "Day N" calculation.
- **Manual (iPhone, Expo Go SDK 57):**
  1. Upgrade an install that has read/reading books: they appear in the Reading lists and their copies stay At home.
  2. All four Store Mode verdicts, including a different edition of a book you've read.
  3. The reading chips, dates and rating on book detail.
  4. The Currently reading strip and its empty state.
  5. A library read with no copy: it shows in Read and gives "You've read this" on scan.
  6. Want to read from Search and from Store Mode.
