# Manual Book Details — Design Spec

**Date:** 2026-09-21 · **Status:** approved by Sean in brainstorming; awaiting spec review
**Sub-project:** 1 of 4 in the catalog-coverage track (1 manual details → 2 shelf creation → 3 bulk import → 4 PH seed catalog)

## 1. Goal

Filipino books are poorly covered by the lookup APIs. In a spike on 2026-09-21, Open Library found 3 of 7 Filipino ISBNs, only 1 of them with a cover. Google Books was rate-limited and couldn't be assessed. Today a failed lookup saves a book titled `ISBN 978…` with no author and no way to fix it. This sub-project lets the user add or correct details and a cover photo for **any** book, stored on the device and marked as a pending contribution to the shared catalog.

Out of scope for now:
- uploading contributions: this needs sign-in, which is a separate sub-project;
- editing genres, description or page count;
- books without an ISBN;
- server schema changes.

## 2. Data model

### 2.1 `book_edits` (SQLite migration v2, `src/db/schema.ts`)

```sql
CREATE TABLE book_edits (
  book_id        TEXT PRIMARY KEY REFERENCES books(id),
  title          TEXT,
  subtitle       TEXT,
  authors        TEXT,   -- JSON array, same encoding as books.authors
  publisher      TEXT,
  published_year INTEGER,
  edition        TEXT,
  cover_path     TEXT,   -- relative to the app documents dir, e.g. 'covers/<book_id>-<ts>.jpg'
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  contributed_at TEXT    -- NULL = pending contribution
);
```

A NULL column means "use the catalog value". Only fields the user changed are stored. `SCHEMA_VERSION` goes from 1 to 2, and the migration also creates the view below.

### 2.2 `books_effective` view

```sql
CREATE VIEW books_effective AS
SELECT b.id, b.isbn13, b.isbn10,
       COALESCE(e.title, b.title) AS title,
       COALESCE(e.subtitle, b.subtitle) AS subtitle,
       COALESCE(e.authors, b.authors) AS authors,
       COALESCE(e.publisher, b.publisher) AS publisher,
       COALESCE(e.published_year, b.published_year) AS published_year,
       COALESCE(e.edition, b.edition) AS edition,
       b.genres, b.page_count, b.cover_url, e.cover_path,
       b.description, b.work_key, b.source,
       (e.book_id IS NOT NULL) AS edited
  FROM books b LEFT JOIN book_edits e ON e.book_id = b.id;
```

- **Reads** in `src/db/repository.ts` use `books_effective` instead of `books`. That covers `checkOwnership` (exact and work-key siblings), `findBookByIsbn`, `LIBRARY_SELECT`, `searchLibrary` and `listCopiesOfBook`, so search matches edited titles.
- **Writes** (`upsertBook`) keep going to `books`. The existing-row lookup inside `upsertBook` stays on `books`.
- **`toBook`** resolves the cover: `coverUrl = cover_path ? documentDirectory + cover_path : cover_url`. It also exposes `edited: boolean`, a new optional field on `Book` in `src/lib/types.ts`.

### 2.3 Repository API (new)

| Function | Behaviour |
|---|---|
| `saveBookEdit(bookId, patch: BookEditPatch)` | Upserts the text overrides. A field set to `null` in the patch clears that override. Sets `updated_at` and resets `contributed_at` to NULL. If no overrides and no cover remain, deletes the row. |
| `setBookCover(bookId, sourceUri)` | Resizes to about 600px wide as JPEG, copies into `covers/`, writes `cover_path` and deletes the previous file. The row is written **only after** the file copy succeeds. |
| `removeBookCover(bookId)` | Clears `cover_path` and deletes the file. |
| `resetBookEdits(bookId)` | Deletes the row and its cover file. |
| `listPendingContributions()` | Returns rows where `contributed_at IS NULL`. Nothing calls it yet; the future upload uses it. |

### 2.4 Pure logic (`src/features/bookEdits/`)

- `toEditPatch(form, catalogBook)` → `BookEditPatch`:
  - trims every field;
  - splits authors on commas and drops empty entries;
  - an empty field, or a value equal to the catalog value, becomes `null` (no override);
  - the title is required, so a blank title means no override rather than an empty title;
  - a year that isn't a 4-digit number is rejected.
- `needsDetails(book)` → true when the effective title matches `/^ISBN \d{13}$/` or the authors are empty.
- `canSave(form)` → the title is non-blank.

## 3. Screens and flows

### 3.1 VerdictSheet: lookup found nothing
- The heading is "We couldn't find this one." with the ISBN in small print.
- The primary action "Add details" opens the form in create mode. Saving creates the placeholder `books` row, applies the edits and adds the copy with the chosen room and status, the same as today's add.
- The secondary link "Add with just the ISBN" keeps today's behaviour.

### 3.2 Book detail (`app/book/[id].tsx`)
- Every book gets an "Edit details" action that opens the form in edit mode.
- An "Edited by you" tag appears when `book.edited` is true.
- If `needsDetails(book)`, a nudge appears: "Missing details — add them" (opens the form).

### 3.3 Edit form (`app/book/edit/[bookId].tsx`, full-screen modal)
- **Cover slot:** tapping it offers "Take photo", "Choose from library" and, when a photo is set, "Remove photo". It uses `expo-image-picker` with `allowsEditing` and a 2:3 aspect ratio.
- **Fields:**
  - Title (required).
  - Authors: one field, comma-separated.
  - Collapsed "More" section: subtitle, publisher, year, edition.
  - The ISBN is shown read-only.
- **Actions:**
  - Save is disabled until `canSave`.
  - Save calls `invalidateLibrary(qc)` so spines, search and detail refresh.
  - "Reset to catalog" (edit mode, only when edits exist) asks for confirmation, then calls `resetBookEdits`.

### 3.4 Permissions and dependencies
- Add `expo-image-picker` (capture and crop), `expo-image-manipulator` (resize to about 600px wide, JPEG) and `expo-file-system` (copy and delete under `covers/`) using `npx expo install`. All three work in Expo Go.
- Add its config plugin in `app.json` with the photo-library and camera usage strings, reusing the camera wording already there.
- If camera or library permission is denied, show an inline message with a link that opens Settings. The rest of the form keeps working.

## 4. Errors and edge cases

- **Photo copy or resize fails:** show "Couldn't save that photo", keep the typed changes, and write no database row for the photo.
- **Cover file missing** (e.g. an iOS reinstall changes the container path): paths are stored relative and resolved at read time. If the file still doesn't exist, `CoverArt` shows the generated spine-coloured cover.
- **A lookup succeeds later for an edited book:** the edits still win, and "Reset to catalog" is how the user switches to the API data.
- **Several copies of one book:** edits belong to the book, so every copy reflects them.

## 5. Testing

- **Unit tests (Jest):**
  - `toEditPatch`: trimming, author splitting, empty and unchanged values become `null`, blank title, invalid year.
  - `needsDetails` and `canSave`.
- **Overlay:** if `expo-sqlite` runs under jest-expo, test the view directly: an override wins, an untouched field falls through, and reset restores the catalog value. If it doesn't, extract the merge into a pure `applyEdits(book, edit)` that mirrors the view, and test that instead.
- **Manual (iPhone, Expo Go SDK 57):**
  1. Scan an unfound Filipino ISBN (e.g. Trese, 9789710545315).
  2. Add details with a photo.
  3. Check the spine title, search and detail.
  4. Edit, then reset.
  5. Deny camera permission and check the fallback.
