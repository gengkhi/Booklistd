# Manual Book Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user add or correct title, author, edition details and a cover photo for any book. Edits are stored on the device as overrides on top of the catalog data and marked as pending contributions.

**Architecture:**
- A new SQLite table, `book_edits`, holds only the fields the user overrode, plus a relative `cover_path`.
- A view, `books_effective`, merges those overrides onto `books`, and every book *read* in `src/db/repository.ts` goes through it. Writes (`upsertBook`) still target `books`.
- The merge rules live in a pure `applyEdits` function so they can be unit-tested. `expo-sqlite` can't run under Jest.
- One form route, `app/book/edit.tsx`, serves two modes: edit (`?bookId=`) and "missing book" create (`?isbn=&room=`).

**Tech Stack:**
- Expo SDK 57, expo-router, expo-sqlite (sync API), TanStack Query, Reanimated.
- New dependencies: `expo-image-picker`, `expo-image-manipulator`, `expo-file-system`.
- Tests: Jest (jest-expo preset).

**Spec:** `docs/superpowers/specs/2026-09-21-manual-book-details-design.md`

## Global Constraints

- **Git:** Sean runs all git commands. **Never run `git add`/`git commit`/`git push` yourself.** Each task ends with a "Hand-off" step listing the commit commands for Sean.
- **Working directory:** all paths are relative to `Booklistd/` (the Expo app root: `C:\Users\seanj\Documents\personal\Booklistd\Booklistd`).
- **Dependencies:** install with `npx expo install <pkg>` only, never plain `npm install <pkg>`, so versions match SDK 57.
- **Expo Go:** everything must run in Expo Go SDK 57 on iOS. No custom native code.
- **Copy voice** (PRODUCT.md): warm librarian, plain verbs, sentence case, never twee. Errors name the problem and the fix.
- **Styling:** use existing tokens from `@/theme/palette` (`font`, `ink`, `radius`) and `useTheme()`. No new hard-coded colours.
- **No server changes** in this plan.
- **Checks after every task:**
  - `npx tsc --noEmit` exits 0.
  - `npx jest` passes. There are 26 tests at the start of this plan.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/features/bookEdits/editLogic.ts` | create | Pure rules: `EditForm`, `BookEditPatch`, `formFromBook`, `toEditPatch`, `canSave`, `needsDetails`, `applyEdits` |
| `src/features/bookEdits/__tests__/editLogic.test.ts` | create | Unit tests for the above |
| `src/features/bookEdits/coverFiles.ts` | create | Cover photo files: `coverFileName`, `resolveCoverUri`, `saveCoverFile`, `deleteCoverFile` |
| `src/features/bookEdits/__tests__/coverFiles.test.ts` | create | Unit tests for the pure parts |
| `src/db/schema.ts` | modify | Migration v2: `book_edits` table and `books_effective` view |
| `src/lib/types.ts` | modify | `Book.edited?: boolean` |
| `src/db/repository.ts` | modify | Reads via `books_effective`; new edit and cover functions |
| `app.json` | modify | `expo-image-picker` config plugin and permission strings |
| `src/components/bookEdits/CoverSlot.tsx` | create | Tappable cover with Take photo / Choose from library / Remove photo |
| `app/book/edit.tsx` | create | The edit/create form screen |
| `app/book/[id].tsx` | modify | "Edit details", "Edited by you" tag, missing-details nudge |
| `src/features/scanner/VerdictSheet.tsx` | modify | "We couldn't find this one" state with Add details |
| `app/(tabs)/scan.tsx` | modify | Route "Add details" to the form |
| `DESIGN.md` | modify | Document the edit form and the lookup-failed state |

---

### Task 1: Pure edit rules

**Files:**
- Create: `src/features/bookEdits/editLogic.ts`
- Test: `src/features/bookEdits/__tests__/editLogic.test.ts`

**Interfaces:**
- Consumes: `Book` from `@/lib/types`.
- Produces:
  ```ts
  export interface EditForm { title: string; authors: string; subtitle: string; publisher: string; year: string; edition: string }
  export interface BookEditPatch { title: string | null; subtitle: string | null; authors: string[] | null; publisher: string | null; publishedYear: number | null; edition: string | null }
  export type BookEditRow = BookEditPatch & { coverPath: string | null };
  export const EMPTY_PATCH: BookEditPatch;
  export function formFromBook(b: Book): EditForm;
  export function yearError(year: string): string | null;
  export function canSave(f: EditForm): boolean;
  export function toEditPatch(f: EditForm, catalog: Book): BookEditPatch;
  export function isEmptyPatch(p: BookEditPatch): boolean;
  export function needsDetails(b: Pick<Book, 'title' | 'authors'>): boolean;
  export function applyEdits(catalog: Book, edit: BookEditRow | null): Book; // coverUrl left as the catalog's; covers resolve in repository
  ```

- [ ] **Step 1: Write the failing test**

Create `src/features/bookEdits/__tests__/editLogic.test.ts`:

```ts
import type { Book } from '@/lib/types';
import {
  applyEdits, canSave, EMPTY_PATCH, formFromBook, isEmptyPatch, needsDetails, toEditPatch, yearError,
} from '../editLogic';

const catalog: Book = {
  id: 'b1', isbn13: '9789710545315', isbn10: null, title: 'Trese', subtitle: null, authors: ['Budjette Tan'],
  publisher: 'Visprint', publishedYear: 2013, edition: null, genres: [], pageCount: null, coverUrl: null,
  description: null, workKey: null, source: 'google',
};
const form = (over: Partial<ReturnType<typeof formFromBook>> = {}) => ({ ...formFromBook(catalog), ...over });

describe('formFromBook', () => {
  it('fills the form from a book, joining authors with commas and blanking nulls', () => {
    expect(formFromBook({ ...catalog, authors: ['A', 'B'] })).toEqual({
      title: 'Trese', authors: 'A, B', subtitle: '', publisher: 'Visprint', year: '2013', edition: '',
    });
  });
});

describe('toEditPatch', () => {
  it('stores nothing when the form matches the catalog', () => {
    expect(toEditPatch(form(), catalog)).toEqual(EMPTY_PATCH);
  });
  it('trims and keeps only changed fields', () => {
    expect(toEditPatch(form({ title: '  Trese: Book of Murders ', edition: ' 2nd ' }), catalog)).toEqual({
      ...EMPTY_PATCH, title: 'Trese: Book of Murders', edition: '2nd',
    });
  });
  it('splits authors on commas and drops empty entries', () => {
    expect(toEditPatch(form({ authors: 'Budjette Tan, , Kajo Baldisimo ,' }), catalog).authors).toEqual(['Budjette Tan', 'Kajo Baldisimo']);
  });
  it('treats an emptied field as "use the catalog value", never as blank', () => {
    const p = toEditPatch(form({ publisher: '   ', authors: '' }), catalog);
    expect(p.publisher).toBeNull();
    expect(p.authors).toBeNull();
  });
  it('never overrides the title with blank', () => {
    expect(toEditPatch(form({ title: '   ' }), catalog).title).toBeNull();
  });
  it('parses the year, and ignores it when invalid', () => {
    expect(toEditPatch(form({ year: '2009' }), catalog).publishedYear).toBe(2009);
    expect(toEditPatch(form({ year: '09' }), catalog).publishedYear).toBeNull();
  });
});

describe('yearError / canSave', () => {
  it('accepts blank or four digits only', () => {
    expect(yearError('')).toBeNull();
    expect(yearError('2013')).toBeNull();
    expect(yearError('213')).toBe('Use a four-digit year, like 2013.');
    expect(yearError('20a3')).toBe('Use a four-digit year, like 2013.');
  });
  it('needs a non-blank title and a valid year', () => {
    expect(canSave(form())).toBe(true);
    expect(canSave(form({ title: '  ' }))).toBe(false);
    expect(canSave(form({ year: '13' }))).toBe(false);
  });
});

describe('isEmptyPatch', () => {
  it('is true only when every field is null', () => {
    expect(isEmptyPatch(EMPTY_PATCH)).toBe(true);
    expect(isEmptyPatch({ ...EMPTY_PATCH, edition: 'x' })).toBe(false);
  });
});

describe('needsDetails', () => {
  it('flags ISBN placeholders and books with no author', () => {
    expect(needsDetails({ title: 'ISBN 9789710545315', authors: [] })).toBe(true);
    expect(needsDetails({ title: 'Trese', authors: [] })).toBe(true);
    expect(needsDetails({ title: 'Trese', authors: ['Budjette Tan'] })).toBe(false);
  });
});

describe('applyEdits', () => {
  it('returns the catalog book untouched (edited: false) when there is no edit', () => {
    expect(applyEdits(catalog, null)).toEqual({ ...catalog, edited: false });
  });
  it('overrides only the fields that are set, and marks the book edited', () => {
    const b = applyEdits(catalog, { ...EMPTY_PATCH, title: 'Trese: Book of Murders', coverPath: null });
    expect(b.title).toBe('Trese: Book of Murders');
    expect(b.authors).toEqual(['Budjette Tan']);
    expect(b.publisher).toBe('Visprint');
    expect(b.edited).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest src/features/bookEdits/__tests__/editLogic.test.ts`
Expected: FAIL with `Cannot find module '../editLogic'`.

- [ ] **Step 3: Write the implementation**

First add the `edited` flag to `Book` in `src/lib/types.ts`, directly after the `source` line:

```ts
  source: 'google' | 'openlibrary' | 'isbndb' | 'manual';
  /** True when the user has overridden any catalog field or added a cover photo (book_edits row exists). */
  edited?: boolean;
```

Then create `src/features/bookEdits/editLogic.ts`:

```ts
import type { Book } from '@/lib/types';

/** Raw text as typed in the edit form. */
export interface EditForm { title: string; authors: string; subtitle: string; publisher: string; year: string; edition: string }

/** Per-field overrides. null = "use the catalog value". Mirrors the book_edits columns. */
export interface BookEditPatch {
  title: string | null;
  subtitle: string | null;
  authors: string[] | null;
  publisher: string | null;
  publishedYear: number | null;
  edition: string | null;
}
export type BookEditRow = BookEditPatch & { coverPath: string | null };

export const EMPTY_PATCH: BookEditPatch = { title: null, subtitle: null, authors: null, publisher: null, publishedYear: null, edition: null };

const YEAR = /^\d{4}$/;
const PLACEHOLDER_TITLE = /^ISBN \d{13}$/;

export function formFromBook(b: Book): EditForm {
  return {
    title: b.title,
    authors: b.authors.join(', '),
    subtitle: b.subtitle ?? '',
    publisher: b.publisher ?? '',
    year: b.publishedYear != null ? String(b.publishedYear) : '',
    edition: b.edition ?? '',
  };
}

export function yearError(year: string): string | null {
  const y = year.trim();
  return y === '' || YEAR.test(y) ? null : 'Use a four-digit year, like 2013.';
}

export function canSave(f: EditForm): boolean {
  return f.title.trim().length > 0 && yearError(f.year) === null;
}

/** Only fields that differ from the catalog become overrides; blanks fall back to the catalog. */
export function toEditPatch(f: EditForm, catalog: Book): BookEditPatch {
  const text = (v: string, current: string | null) => {
    const t = v.trim();
    return t === '' || t === (current ?? '') ? null : t;
  };
  const authors = f.authors.split(',').map((a) => a.trim()).filter(Boolean);
  const sameAuthors = authors.length === catalog.authors.length && authors.every((a, i) => a === catalog.authors[i]);
  const y = f.year.trim();
  const year = YEAR.test(y) ? Number(y) : null;
  return {
    title: text(f.title, catalog.title),
    subtitle: text(f.subtitle, catalog.subtitle),
    authors: authors.length === 0 || sameAuthors ? null : authors,
    publisher: text(f.publisher, catalog.publisher),
    publishedYear: year === null || year === catalog.publishedYear ? null : year,
    edition: text(f.edition, catalog.edition),
  };
}

export function isEmptyPatch(p: BookEditPatch): boolean {
  return Object.values(p).every((v) => v === null);
}

export function needsDetails(b: Pick<Book, 'title' | 'authors'>): boolean {
  return PLACEHOLDER_TITLE.test(b.title.trim()) || b.authors.length === 0;
}

/**
 * The same merge the books_effective SQL view performs (keep the two in sync).
 * Cover resolution (cover_path → file URI) happens in the repository, not here.
 */
export function applyEdits(catalog: Book, edit: BookEditRow | null): Book {
  if (!edit) return { ...catalog, edited: false };
  return {
    ...catalog,
    title: edit.title ?? catalog.title,
    subtitle: edit.subtitle ?? catalog.subtitle,
    authors: edit.authors ?? catalog.authors,
    publisher: edit.publisher ?? catalog.publisher,
    publishedYear: edit.publishedYear ?? catalog.publishedYear,
    edition: edit.edition ?? catalog.edition,
    edited: true,
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx jest src/features/bookEdits/__tests__/editLogic.test.ts`
Expected: PASS, 13 tests.

Run: `npx tsc --noEmit`
Expected: no output (exit 0).

- [ ] **Step 5: Hand-off**

Tell Sean the task is done and give him:
```
git add src/lib/types.ts src/features/bookEdits/editLogic.ts src/features/bookEdits/__tests__/editLogic.test.ts
git commit -m "feat(book-edits): pure rules for manual book details"
```

---

### Task 2: Cover file helpers and dependencies

**Files:**
- Create: `src/features/bookEdits/coverFiles.ts`
- Test: `src/features/bookEdits/__tests__/coverFiles.test.ts`
- Modify: `package.json` and `package-lock.json` (via `npx expo install`), `app.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  export const COVERS_DIR = 'covers';
  export function coverFileName(bookId: string, now?: number): string;         // 'covers/<safeId>-<now>.jpg'
  export function resolveCoverUri(coverPath: string | null, documentUri: string): string | null;
  export async function saveCoverFile(bookId: string, sourceUri: string): Promise<string>; // returns relative cover_path
  export function deleteCoverFile(coverPath: string | null): void;              // never throws
  export function documentUri(): string;                                        // Paths.document.uri, always ends with '/'
  ```

- [ ] **Step 1: Install the dependencies**

Run: `npx expo install expo-image-picker expo-image-manipulator expo-file-system`
Expected: the three packages are added to `dependencies` at SDK 57 versions. Then `npx expo install --check` prints "Dependencies are up to date".

- [ ] **Step 2: Add the image-picker config plugin**

In `app.json`, extend the `plugins` array with this entry directly after the `expo-camera` entry:

```json
      [
        "expo-image-picker",
        {
          "photosPermission": "Booklistd uses your photo library so you can pick a cover photo for a book.",
          "cameraPermission": "Booklistd uses the camera to scan book barcodes and to photograph book covers."
        }
      ]
```

Run: `npx expo-doctor`
Expected: all checks pass.

- [ ] **Step 3: Write the failing test**

Create `src/features/bookEdits/__tests__/coverFiles.test.ts`:

```ts
jest.mock('expo-file-system', () => ({ Paths: { document: { uri: 'file:///docs/' } }, File: jest.fn(), Directory: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { JPEG: 'jpeg' } }));

import { coverFileName, resolveCoverUri } from '../coverFiles';

describe('coverFileName', () => {
  it('puts covers in covers/ with the book id and a timestamp', () => {
    expect(coverFileName('b1', 1700000000000)).toBe('covers/b1-1700000000000.jpg');
  });
  it('strips characters that are unsafe in file names', () => {
    expect(coverFileName('a/b:c', 5)).toBe('covers/a_b_c-5.jpg');
  });
});

describe('resolveCoverUri', () => {
  it('joins a relative cover path onto the documents directory', () => {
    expect(resolveCoverUri('covers/b1-5.jpg', 'file:///docs/')).toBe('file:///docs/covers/b1-5.jpg');
  });
  it('tolerates a documents URI without a trailing slash', () => {
    expect(resolveCoverUri('covers/b1-5.jpg', 'file:///docs')).toBe('file:///docs/covers/b1-5.jpg');
  });
  it('returns null when there is no cover path', () => {
    expect(resolveCoverUri(null, 'file:///docs/')).toBeNull();
  });
});
```

- [ ] **Step 4: Run the test and confirm it fails**

Run: `npx jest src/features/bookEdits/__tests__/coverFiles.test.ts`
Expected: FAIL with `Cannot find module '../coverFiles'`.

- [ ] **Step 5: Write the implementation**

Create `src/features/bookEdits/coverFiles.ts`:

```ts
/**
 * Cover photos live in <documents>/covers/. The DB stores the path *relative* to the documents
 * directory, because the absolute container path changes across iOS reinstalls/updates.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export const COVERS_DIR = 'covers';
const COVER_WIDTH = 600;

export function coverFileName(bookId: string, now: number = Date.now()): string {
  return `${COVERS_DIR}/${bookId.replace(/[^A-Za-z0-9-]/g, '_')}-${now}.jpg`;
}

export function resolveCoverUri(coverPath: string | null, documentUri: string): string | null {
  if (!coverPath) return null;
  return `${documentUri.endsWith('/') ? documentUri : `${documentUri}/`}${coverPath}`;
}

export function documentUri(): string {
  const u = Paths.document.uri;
  return u.endsWith('/') ? u : `${u}/`;
}

/** Resize to ~600px wide JPEG and copy into covers/. Returns the relative path. Throws on failure. */
export async function saveCoverFile(bookId: string, sourceUri: string): Promise<string> {
  const ctx = ImageManipulator.manipulate(sourceUri);
  ctx.resize({ width: COVER_WIDTH });
  const image = await ctx.renderAsync();
  const out = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  const dir = new Directory(Paths.document, COVERS_DIR);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const rel = coverFileName(bookId);
  new File(out.uri).copy(new File(Paths.document, rel));
  return rel;
}

/** Best-effort: a missing file is fine. */
export function deleteCoverFile(coverPath: string | null): void {
  if (!coverPath) return;
  try {
    const f = new File(Paths.document, coverPath);
    if (f.exists) f.delete();
  } catch {
    // Leftover file costs a few KB; never block the user on it.
  }
}
```

> If `tsc` reports that `ImageManipulator.manipulate`, `renderAsync` or `saveAsync` don't exist, check `node_modules/expo-image-manipulator/build/index.d.ts` for the SDK 57 names and adapt these three lines only. The contextual `manipulate()` API replaced `manipulateAsync` in SDK 52+. Do the same for `Directory`/`File`/`Paths` against `node_modules/expo-file-system/build/index.d.ts`.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npx jest src/features/bookEdits/__tests__/coverFiles.test.ts`
Expected: PASS, 5 tests.

Run: `npx tsc --noEmit && npx jest`
Expected: tsc exits 0. All suites pass.

- [ ] **Step 7: Hand-off**

```
git add package.json package-lock.json app.json src/features/bookEdits/coverFiles.ts src/features/bookEdits/__tests__/coverFiles.test.ts
git commit -m "feat(book-edits): cover photo storage helpers and image deps"
```

---

### Task 3: Schema v2, the effective view, and repository functions

**Files:**
- Modify: `src/db/schema.ts` (bump `SCHEMA_VERSION`, append migration v2)
- Modify: `src/db/repository.ts`

**Interfaces:**
- Consumes (Task 1): `BookEditPatch`, `BookEditRow`, `isEmptyPatch`, `applyEdits`, `EMPTY_PATCH`. (Task 2): `resolveCoverUri`, `documentUri`, `saveCoverFile`, `deleteCoverFile`.
- Produces (new exports in `src/db/repository.ts`):
  ```ts
  export function getBook(bookId: string): Book | null;          // effective (with edits); edited flag set
  export function getCatalogBook(bookId: string): Book | null;   // raw books row, no edits
  export function getBookEdit(bookId: string): BookEditRow | null;
  export function saveBookEdit(bookId: string, patch: BookEditPatch): void;
  export async function setBookCover(bookId: string, sourceUri: string): Promise<void>;
  export function removeBookCover(bookId: string): void;
  export function resetBookEdits(bookId: string): void;
  export function listPendingContributions(): (BookEditRow & { bookId: string; updatedAt: string })[];
  ```
  Every existing read (`checkOwnership`, `findBookByIsbn`, `listLibrary`, `getLibraryRow`, `searchLibrary`) now returns edited values and `book.edited`.

> **Testing note:** `expo-sqlite` is native and doesn't run under Jest. The merge rules are already covered by `applyEdits` (Task 1) and `resolveCoverUri` (Task 2). This task is checked with `tsc`, the full Jest run, and the manual smoke test in Step 6.

- [ ] **Step 1: Add migration v2**

In `src/db/schema.ts`, change `export const SCHEMA_VERSION = 1;` to:

```ts
export const SCHEMA_VERSION = 2;
```

Then append a second entry to the `MIGRATIONS` array, after the v1 template string (keep the trailing comma style):

```ts
  // v2 — user overrides for catalog data (manual details + cover photos), merged by a view.
  // Keep books_effective in sync with applyEdits() in src/features/bookEdits/editLogic.ts.
  `
  CREATE TABLE IF NOT EXISTS book_edits (
    book_id TEXT PRIMARY KEY REFERENCES books(id),
    title TEXT,
    subtitle TEXT,
    authors TEXT,
    publisher TEXT,
    published_year INTEGER,
    edition TEXT,
    cover_path TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    contributed_at TEXT
  );

  CREATE VIEW IF NOT EXISTS books_effective AS
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
  `,
```

- [ ] **Step 2: Resolve covers and the edited flag in `toBook`**

In `src/db/repository.ts`, update the imports at the top:

```ts
import { getDb, newId } from './database';
import type { Book, BookStatus, LibraryRow, OwnershipVerdict, UserBook } from '@/lib/types';
import { isEmptyPatch, type BookEditPatch, type BookEditRow } from '@/features/bookEdits/editLogic';
import { deleteCoverFile, documentUri, resolveCoverUri, saveCoverFile } from '@/features/bookEdits/coverFiles';
```

Directly above `const toBook`, add a cached documents URI. `toBook` runs once per row, and a big library has thousands of rows.

```ts
let docsUri: string | null = null;
const docs = () => (docsUri ??= documentUri());
```

Replace the `coverUrl` line and add `edited` in `toBook`:

```ts
  coverUrl: resolveCoverUri(r.cover_path ?? null, docs()) ?? r.cover_url,
  description: r.description,
  workKey: r.work_key,
  source: r.source,
  edited: !!r.edited,
});
```

- [ ] **Step 3: Point every read at `books_effective`**

Make these exact replacements in `src/db/repository.ts`. **Do not** touch the `SELECT * FROM books WHERE isbn13 = ?` inside `upsertBook`; it must stay on the raw table.

1. `checkOwnership`: `'SELECT * FROM books WHERE isbn13 = ?'` → `'SELECT * FROM books_effective WHERE isbn13 = ?'`
2. `checkOwnership` siblings: `'SELECT * FROM books WHERE work_key = ?'` → `'SELECT * FROM books_effective WHERE work_key = ?'`
3. `findBookByIsbn`: `'SELECT * FROM books WHERE isbn13 = ?'` → `'SELECT * FROM books_effective WHERE isbn13 = ?'`
4. `LIBRARY_SELECT`: replace the whole constant with:

```ts
const LIBRARY_SELECT = `SELECT ub.*, b.id as b_id, b.isbn13, b.isbn10, b.title, b.subtitle, b.authors, b.publisher,
       b.published_year, b.edition, b.genres, b.page_count, b.cover_url, b.cover_path, b.description, b.work_key,
       b.source, b.edited
  FROM user_books ub JOIN books_effective b ON b.id = ub.book_id`;
```

`searchLibrary` already filters on `b.title`/`b.authors`, so it now matches edited titles with no further change.

- [ ] **Step 4: Add the edit functions**

Append to `src/db/repository.ts`, after `findBookByIsbn`:

```ts
// ---------- manual details (book_edits) ----------
const toEditRow = (r: any): BookEditRow => ({
  title: r.title,
  subtitle: r.subtitle,
  authors: r.authors ? JSON.parse(r.authors) : null,
  publisher: r.publisher,
  publishedYear: r.published_year,
  edition: r.edition,
  coverPath: r.cover_path,
});

export function getBook(bookId: string): Book | null {
  const r = getDb().getFirstSync<any>('SELECT * FROM books_effective WHERE id = ?', [bookId]);
  return r ? toBook(r) : null;
}

export function getCatalogBook(bookId: string): Book | null {
  const r = getDb().getFirstSync<any>('SELECT * FROM books WHERE id = ?', [bookId]);
  return r ? toBook(r) : null;
}

export function getBookEdit(bookId: string): BookEditRow | null {
  const r = getDb().getFirstSync<any>('SELECT * FROM book_edits WHERE book_id = ?', [bookId]);
  return r ? toEditRow(r) : null;
}

/** Replace the text overrides. Any save makes the edit a pending contribution again. */
export function saveBookEdit(bookId: string, patch: BookEditPatch): void {
  const d = getDb();
  const existing = getBookEdit(bookId);
  if (isEmptyPatch(patch) && !existing?.coverPath) {
    d.runSync('DELETE FROM book_edits WHERE book_id = ?', [bookId]);
    return;
  }
  d.runSync(
    `INSERT INTO book_edits (book_id, title, subtitle, authors, publisher, published_year, edition, cover_path, updated_at, contributed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), NULL)
     ON CONFLICT(book_id) DO UPDATE SET
       title=excluded.title, subtitle=excluded.subtitle, authors=excluded.authors, publisher=excluded.publisher,
       published_year=excluded.published_year, edition=excluded.edition,
       updated_at=datetime('now'), contributed_at=NULL`,
    [
      bookId, patch.title, patch.subtitle, patch.authors ? JSON.stringify(patch.authors) : null,
      patch.publisher, patch.publishedYear, patch.edition, existing?.coverPath ?? null,
    ]
  );
}

/** Copies the photo first; the row is only written once the file exists. */
export async function setBookCover(bookId: string, sourceUri: string): Promise<void> {
  const previous = getBookEdit(bookId)?.coverPath ?? null;
  const rel = await saveCoverFile(bookId, sourceUri);
  getDb().runSync(
    `INSERT INTO book_edits (book_id, cover_path, updated_at, contributed_at) VALUES (?, ?, datetime('now'), NULL)
     ON CONFLICT(book_id) DO UPDATE SET cover_path=excluded.cover_path, updated_at=datetime('now'), contributed_at=NULL`,
    [bookId, rel]
  );
  if (previous && previous !== rel) deleteCoverFile(previous);
}

export function removeBookCover(bookId: string): void {
  const edit = getBookEdit(bookId);
  if (!edit?.coverPath) return;
  const d = getDb();
  const { coverPath, ...text } = edit;
  if (isEmptyPatch(text)) d.runSync('DELETE FROM book_edits WHERE book_id = ?', [bookId]);
  else d.runSync(`UPDATE book_edits SET cover_path = NULL, updated_at = datetime('now'), contributed_at = NULL WHERE book_id = ?`, [bookId]);
  deleteCoverFile(coverPath);
}

export function resetBookEdits(bookId: string): void {
  const coverPath = getBookEdit(bookId)?.coverPath ?? null;
  getDb().runSync('DELETE FROM book_edits WHERE book_id = ?', [bookId]);
  deleteCoverFile(coverPath);
}

/** Edits not yet uploaded to the shared catalog. Uploading ships with sign-in (future sub-project). */
export function listPendingContributions(): (BookEditRow & { bookId: string; updatedAt: string })[] {
  return getDb()
    .getAllSync<any>('SELECT * FROM book_edits WHERE contributed_at IS NULL ORDER BY updated_at')
    .map((r) => ({ ...toEditRow(r), bookId: r.book_id, updatedAt: r.updated_at }));
}
```

- [ ] **Step 5: Type-check and run the tests**

Run: `npx tsc --noEmit && npx jest`
Expected: tsc exits 0. All suites pass.

- [ ] **Step 6: Manual smoke test of the migration**

Run `npx expo start`, open the app on the iPhone in Expo Go, then check:
- the app launches, and existing books and spines still show (migration v2 ran on an existing v1 database);
- searching the library still works;
- tapping a book opens detail.

- [ ] **Step 7: Hand-off**

```
git add src/db/schema.ts src/db/repository.ts
git commit -m "feat(book-edits): book_edits table, books_effective view, repository API"
```

---

### Task 4: The edit form screen

**Files:**
- Create: `src/components/bookEdits/CoverSlot.tsx`
- Create: `app/book/edit.tsx`

**Interfaces:**
- Consumes:
  - Task 1: `EditForm`, `formFromBook`, `toEditPatch`, `canSave`, `yearError`.
  - Task 3: `getBook`, `getCatalogBook`, `getBookEdit`, `saveBookEdit`, `setBookCover`, `removeBookCover`, `resetBookEdits`.
  - Existing: `findBookByIsbn`, `upsertBook`, `addUserBook`, `invalidateLibrary`, `CoverArt`, `Button`.
- Produces:
  - Route `/book/edit`, with params `{ bookId: string }` (edit mode) **or** `{ isbn: string; room?: string }` (create mode for a missing book; adds an owned copy on save).
  - `CoverSlot` props: `{ id: string; title: string; coverUri: string | null; onPick: (uri: string) => void; onRemove: () => void }`.

- [ ] **Step 1: Create `CoverSlot`**

Create `src/components/bookEdits/CoverSlot.tsx`:

```tsx
import React, { useState } from 'react';
import { ActionSheetIOS, Alert, Linking, Platform, Pressable, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { CoverArt } from '@/components/shelf/CoverArt';
import { font } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

const PICK: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [2, 3], quality: 1 };

/** Tappable cover: Take photo / Choose from library / Remove photo. */
export function CoverSlot({
  id, title, coverUri, onPick, onRemove,
}: { id: string; title: string; coverUri: string | null; onPick: (uri: string) => void; onRemove: () => void }) {
  const { c } = useTheme();
  const [denied, setDenied] = useState<null | 'camera' | 'library'>(null);

  const take = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return setDenied('camera');
    const r = await ImagePicker.launchCameraAsync(PICK);
    if (!r.canceled) onPick(r.assets[0].uri);
  };
  const choose = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setDenied('library');
    const r = await ImagePicker.launchImageLibraryAsync(PICK);
    if (!r.canceled) onPick(r.assets[0].uri);
  };

  const open = () => {
    setDenied(null);
    const options = ['Take photo', 'Choose from library', ...(coverUri ? ['Remove photo'] : []), 'Cancel'];
    const run = (i: number) => (i === 0 ? take() : i === 1 ? choose() : coverUri && i === 2 ? onRemove() : undefined);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: options.length - 1, destructiveButtonIndex: coverUri ? 2 : undefined },
        run
      );
    } else {
      Alert.alert('Cover photo', undefined, options.slice(0, -1).map((text, i) => ({ text, onPress: () => run(i) })).concat({ text: 'Cancel', onPress: () => undefined }));
    }
  };

  return (
    <View style={{ alignItems: 'center' }}>
      <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={coverUri ? 'Change cover photo' : 'Add a cover photo'}>
        <CoverArt id={id} title={title || 'Untitled'} coverUrl={coverUri} width={120} height={180} />
        <Text style={{ fontFamily: font.heavy, fontSize: 13, color: c.text, textAlign: 'center', marginTop: 8, textDecorationLine: 'underline' }}>
          {coverUri ? 'Change photo' : 'Add a cover photo'}
        </Text>
      </Pressable>
      {denied ? (
        <Pressable onPress={() => Linking.openSettings()} accessibilityRole="button" style={{ marginTop: 6, minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ fontFamily: font.bold, fontSize: 13, color: c.soft, textAlign: 'center' }}>
            {`Booklistd can't use your ${denied === 'camera' ? 'camera' : 'photos'}. Allow it in Settings.`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
```

- [ ] **Step 2: Create the form screen**

Create `app/book/edit.tsx`:

```tsx
import React, { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  addUserBook, findBookByIsbn, getBook, getBookEdit, getCatalogBook, removeBookCover, resetBookEdits,
  saveBookEdit, setBookCover, upsertBook,
} from '@/db/repository';
import { canSave, formFromBook, toEditPatch, yearError, type EditForm } from '@/features/bookEdits/editLogic';
import { invalidateLibrary } from '@/lib/invalidateLibrary';
import { CoverSlot } from '@/components/bookEdits/CoverSlot';
import { Button } from '@/components/ui/Button';
import { font, ink, radius } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

const BLANK: EditForm = { title: '', authors: '', subtitle: '', publisher: '', year: '', edition: '' };

/** Cover change staged until Save: a newly picked image, a removal, or nothing. */
type CoverChange = { kind: 'none' } | { kind: 'pick'; uri: string } | { kind: 'remove' };

function Field({ label, value, onChange, error, keyboardType, autoFocus }: {
  label: string; value: string; onChange: (v: string) => void; error?: string | null;
  keyboardType?: 'default' | 'number-pad'; autoFocus?: boolean;
}) {
  const { c } = useTheme();
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={{ fontFamily: font.heavy, fontSize: 13, color: c.text }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        autoFocus={autoFocus}
        accessibilityLabel={label}
        style={{
          marginTop: 6, minHeight: 46, paddingHorizontal: 12, borderWidth: 2, borderColor: error ? ink.tomato : c.line,
          borderRadius: radius.pill / 2, backgroundColor: ink.white, fontFamily: font.bold, fontSize: 16, color: ink.brown,
        }}
      />
      {error ? <Text style={{ fontFamily: font.bold, fontSize: 12.5, color: ink.tomato, marginTop: 4 }}>{error}</Text> : null}
    </View>
  );
}

export default function EditBookScreen() {
  const params = useLocalSearchParams<{ bookId?: string; isbn?: string; room?: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { c } = useTheme();
  const createIsbn = params.bookId ? null : params.isbn ?? null;

  const effective = useMemo(() => (params.bookId ? getBook(params.bookId) : createIsbn ? findBookByIsbn(createIsbn) : null), [params.bookId, createIsbn]);
  const hasEdits = useMemo(() => (params.bookId ? getBookEdit(params.bookId) !== null : false), [params.bookId]);
  const [form, setForm] = useState<EditForm>(() => {
    if (!effective) return BLANK;
    const f = formFromBook(effective);
    return /^ISBN \d{13}$/.test(f.title) ? { ...f, title: '' } : f; // don't make them delete the placeholder
  });
  const [more, setMore] = useState(false);
  const [cover, setCover] = useState<CoverChange>({ kind: 'none' });
  const [busy, setBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const set = (k: keyof EditForm) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const shownCover = cover.kind === 'pick' ? cover.uri : cover.kind === 'remove' ? null : effective?.coverUrl ?? null;
  const isbn = effective?.isbn13 ?? createIsbn ?? '';

  const save = async () => {
    if (!canSave(form) || busy) return;
    setBusy(true);
    setPhotoError(null);
    try {
      const book =
        effective ??
        upsertBook({
          isbn13: createIsbn, isbn10: null, title: `ISBN ${createIsbn}`, subtitle: null, authors: [], publisher: null,
          publishedYear: null, edition: null, genres: [], pageCount: null, coverUrl: null, description: null, workKey: null, source: 'manual',
        });
      const catalog = getCatalogBook(book.id) ?? book;
      if (cover.kind === 'pick') {
        try {
          await setBookCover(book.id, cover.uri);
        } catch {
          setPhotoError("Couldn't save that photo. Try another one, or save without it.");
          setCover({ kind: 'none' });
          setBusy(false);
          return;
        }
      } else if (cover.kind === 'remove') {
        removeBookCover(book.id);
      }
      saveBookEdit(book.id, toEditPatch(form, catalog));
      if (createIsbn) addUserBook(book.id, 'owned', params.room || undefined);
      invalidateLibrary(qc);
      router.back();
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    if (!params.bookId) return;
    Alert.alert('Reset to catalog?', 'Your changes and cover photo for this book will be removed.', [
      { text: 'Keep my changes', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: () => { resetBookEdits(params.bookId!); invalidateLibrary(qc); router.back(); } },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 }}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ fontFamily: font.heavy, fontSize: 15, color: c.text }}>Cancel</Text>
          </Pressable>
          <Text accessibilityRole="header" style={{ fontFamily: font.black, fontSize: 16, color: c.text }}>
            {createIsbn ? 'Add details' : 'Edit details'}
          </Text>
          <View style={{ width: 52 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <CoverSlot
            id={effective?.id ?? isbn}
            title={form.title}
            coverUri={shownCover}
            onPick={(uri) => setCover({ kind: 'pick', uri })}
            onRemove={() => setCover({ kind: 'remove' })}
          />
          {photoError ? <Text style={{ fontFamily: font.bold, fontSize: 13, color: ink.tomato, textAlign: 'center', marginTop: 8 }}>{photoError}</Text> : null}

          <Field label="Title" value={form.title} onChange={set('title')} autoFocus={!form.title} />
          <Field label="Authors (separate with commas)" value={form.authors} onChange={set('authors')} />

          <Pressable onPress={() => setMore((m) => !m)} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center', marginTop: 8 }}>
            <Text style={{ fontFamily: font.heavy, fontSize: 14, color: c.text, textDecorationLine: 'underline' }}>{more ? 'Fewer details' : 'More details'}</Text>
          </Pressable>
          {more ? (
            <>
              <Field label="Subtitle" value={form.subtitle} onChange={set('subtitle')} />
              <Field label="Publisher" value={form.publisher} onChange={set('publisher')} />
              <Field label="Year" value={form.year} onChange={set('year')} keyboardType="number-pad" error={yearError(form.year)} />
              <Field label="Edition" value={form.edition} onChange={set('edition')} />
            </>
          ) : null}

          <Text style={{ fontFamily: font.bold, fontSize: 13, color: c.soft, marginTop: 16 }}>{`ISBN ${isbn}`}</Text>

          <View style={{ marginTop: 20 }}>
            <Button label={createIsbn ? 'Save and shelve it' : 'Save'} onPress={save} disabled={!canSave(form) || busy} />
          </View>
          {hasEdits ? (
            <Pressable onPress={reset} accessibilityRole="button" style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 8 }}>
              <Text style={{ fontFamily: font.heavy, fontSize: 13.5, color: ink.tomato, textDecorationLine: 'underline' }}>Reset to catalog</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
```

- [ ] **Step 3: Present the route as a modal**

In `app/_layout.tsx`, give the Stack an explicit screen entry for the form so it slides up as a modal. Replace:

```tsx
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.paper } }} />
```

with:

```tsx
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.paper } }}>
        <Stack.Screen name="book/edit" options={{ presentation: 'modal' }} />
      </Stack>
```

Add `app/_layout.tsx` to this task's files.

- [ ] **Step 4: Type-check and run the tests**

Run: `npx tsc --noEmit && npx jest`
Expected: tsc exits 0. All suites pass.

- [ ] **Step 5: Hand-off**

```
git add src/components/bookEdits/CoverSlot.tsx app/book/edit.tsx app/_layout.tsx
git commit -m "feat(book-edits): edit details form with cover photo"
```

---

### Task 5: Book detail entry points

**Files:**
- Modify: `app/book/[id].tsx`

**Interfaces:**
- Consumes: `needsDetails` (Task 1), `row.book.edited` (Task 3), route `/book/edit?bookId=` (Task 4).
- Produces: nothing new.

- [ ] **Step 1: Add the import**

In `app/book/[id].tsx`, add below the `invalidateLibrary` import:

```tsx
import { needsDetails } from '@/features/bookEdits/editLogic';
```

- [ ] **Step 2: Add the "Edited by you" pill**

In the pill row, after the rating pill line (`{row.rating ? <Pill label={`★ ${row.rating}`} /> : null}`), add:

```tsx
              {row.book.edited ? <Pill label="Edited by you" /> : null}
```

- [ ] **Step 3: Add the nudge and the Edit details link**

Directly after the closing `</PocketCard>` tag, insert:

```tsx
        {needsDetails(row.book) ? (
          <Pressable
            onPress={() => router.push({ pathname: '/book/edit', params: { bookId: row.bookId } })}
            accessibilityRole="button"
            style={{ marginHorizontal: 16, marginTop: 14, flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: ink.tape, borderWidth: 2, borderColor: c.line, borderRadius: 10, padding: 10 }}
          >
            <Dewey size={38} mood="gasp" />
            <Text style={{ flex: 1, fontFamily: font.heavy, fontSize: 13, color: ink.brown }}>Missing details. Add them so you can find it later.</Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => router.push({ pathname: '/book/edit', params: { bookId: row.bookId } })}
          accessibilityRole="button"
          style={{ marginHorizontal: 16, marginTop: 10, minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={{ fontFamily: font.heavy, fontSize: 13.5, color: c.text, textDecorationLine: 'underline' }}>Edit details</Text>
        </Pressable>
```

- [ ] **Step 4: Refresh the detail screen after editing**

The detail screen reads `['book', id]` through React Query, and the form calls `invalidateLibrary`, which invalidates the `['book']` prefix. No extra code is needed. Confirm it manually in Step 6.

- [ ] **Step 5: Type-check and run the tests**

Run: `npx tsc --noEmit && npx jest`
Expected: tsc exits 0. All suites pass.

- [ ] **Step 6: Manual check on the iPhone**
1. Open any book, tap **Edit details**, change the title, and Save. The detail title, its spine on the bookcase, and search all show the new title, and the "Edited by you" pill appears.
2. Edit it again and use **Reset to catalog**. The original title returns and the pill disappears.
3. Add a cover photo with **Take photo**. It shows on detail and survives an app restart.
4. Open a book titled "ISBN 978…". The "Missing details" nudge shows.

- [ ] **Step 7: Hand-off**

```
git add "app/book/[id].tsx"
git commit -m "feat(book-edits): edit details and missing-details nudge on book detail"
```

---

### Task 6: "We couldn't find this one" in Store Mode

**Files:**
- Modify: `src/features/scanner/VerdictSheet.tsx`
- Modify: `app/(tabs)/scan.tsx`
- Modify: `DESIGN.md`

**Interfaces:**
- Consumes: route `/book/edit?isbn=&room=` (Task 4).
- Produces: a new `VerdictSheet` prop, `onAddDetails: (room: string | null) => void`.

- [ ] **Step 1: Add the prop and lookup-failed copy to `VerdictSheet`**

In `src/features/scanner/VerdictSheet.tsx`:

1. Extend the props destructuring and type:

```tsx
export function VerdictSheet({
  result, rooms, quiet, wishlisted = false, onKeepScanning, onAdd, onAddDetails,
}: {
  result: ScanResult; rooms: string[]; quiet: boolean; wishlisted?: boolean;
  onKeepScanning: () => void; onAdd: (status: 'owned' | 'wishlist', room: string | null) => void;
  onAddDetails: (room: string | null) => void;
}) {
```

2. Change the heading text from `{owned ? 'You own this!' : 'A new find!'}` to:

```tsx
        {owned ? 'You own this!' : lookupFailed ? "We couldn't find this one." : 'A new find!'}
```

3. Change the lookup-failed line inside the card from `Couldn't reach the catalog. You can still add it by ISBN.` to:

```tsx
                <Text style={{ fontFamily: font.bold, fontSize: 13, color: ink.soft, marginTop: 4 }}>Not in the catalogs yet. Add the details yourself.</Text>
```

4. In the not-owned branch, replace the button row and the "Not now" link (the `<View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>` block and the `Pressable` after it) with:

```tsx
          {lookupFailed ? (
            <>
              <View style={{ marginTop: 16 }}>
                <Button label="Add details" onPress={() => onAddDetails(room)} />
              </View>
              <Pressable onPress={() => onAdd('owned', room)} accessibilityRole="button" style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 }}>
                <Text style={{ fontFamily: font.heavy, fontSize: 13.5, color: ink.brown, textDecorationLine: 'underline' }}>Add with just the ISBN</Text>
              </Pressable>
            </>
          ) : (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              {!wishlisted ? <Button variant="ghost" flex label="Wishlist it" onPress={() => onAdd('wishlist', null)} disabled={metaLoading} /> : null}
              <Button flex label="Add to shelves" onPress={() => onAdd('owned', room)} disabled={metaLoading} />
            </View>
          )}
          <Pressable onPress={onKeepScanning} accessibilityRole="button" style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 }}>
            <Text style={{ fontFamily: font.heavy, fontSize: 13.5, color: ink.brown, textDecorationLine: 'underline' }}>Not now, keep scanning</Text>
          </Pressable>
```

- [ ] **Step 2: Route "Add details" from the scanner**

In `app/(tabs)/scan.tsx`, add this handler directly after the `addAs` function:

```tsx
  const addDetails = (room: string | null) => {
    if (!current) return;
    const isbn = current.isbn13;
    dismiss();
    router.push({ pathname: '/book/edit', params: room ? { isbn, room } : { isbn } });
  };
```

Pass it to the sheet by changing the `<VerdictSheet … />` line to:

```tsx
        <VerdictSheet key={current.isbn13} result={current} rooms={rooms} quiet={quiet} wishlisted={!!wishCopy} onKeepScanning={dismiss} onAdd={addAs} onAddDetails={addDetails} />
```

- [ ] **Step 3: Update DESIGN.md**

In `DESIGN.md`, find the component section that describes the VerdictSheet or Store Mode verdict (search for "A new find"). Add this paragraph after it:

```markdown
**Lookup failed.** When no catalog knows the ISBN, the sheet heading reads "We couldn't find this one." (no Dewey, no bubble — it's an error state). Primary action "Add details" opens the edit form (`/book/edit?isbn=…&room=…`), which shelves the copy on save; the link "Add with just the ISBN" keeps the old one-tap placeholder add.

**Edit details form.** Modal route `/book/edit`. Cover slot on top (Take photo / Choose from library / Remove photo, cropped 2:3, stored on-device at ~600px JPEG), then Title (required) and Authors (comma-separated); Subtitle, Publisher, Year and Edition sit behind "More details". Edits override catalog data per field and never replace it — "Reset to catalog" removes them. Book detail shows an "Edited by you" pill and, for placeholder titles or books with no author, a "Missing details" nudge.
```

- [ ] **Step 4: Type-check and run the tests**

Run: `npx tsc --noEmit && npx jest`
Expected: tsc exits 0. All suites pass.

- [ ] **Step 5: Manual check on the iPhone**
1. In Store Mode, get a scan that no catalog knows. Google now finds most Filipino ISBNs, so to force this state **temporarily** add `return null;` as the first line of `lookupIsbn` in `src/api/bookLookup.ts`, and scan a book you don't own yet. The sheet reads "We couldn't find this one." **Remove that line again before the hand-off.**
2. Tap **Add details**, enter a title, author and photo, and Save. You return to the scanner, and the book is on the chosen shelf with your title on its spine.
3. Scan another unknown ISBN and tap **Add with just the ISBN**. It's added as "ISBN 978…", and its detail page shows the Missing details nudge.
4. Deny photo-library permission in iOS Settings, open the form, and tap Choose from library. The inline "Allow it in Settings" message appears, and Save still works.

- [ ] **Step 6: Hand-off**

```
git add src/features/scanner/VerdictSheet.tsx "app/(tabs)/scan.tsx" DESIGN.md
git commit -m "feat(book-edits): add details when a scan isn't in any catalog"
```

---

## Spec coverage check

| Spec section | Task |
|---|---|
| §2.1 book_edits table, SCHEMA_VERSION 2 | 3 |
| §2.2 books_effective view; reads switched; writes on books; toBook cover and edited flag | 3 (merge rules tested in 1, cover path in 2) |
| §2.3 saveBookEdit / setBookCover / removeBookCover / resetBookEdits / listPendingContributions | 3 |
| §2.4 toEditPatch / needsDetails / canSave | 1 |
| §3.1 VerdictSheet lookup-failed state | 6 |
| §3.2 Book detail: Edit details, Edited by you, nudge | 5 |
| §3.3 Edit form: cover slot, fields, More, ISBN read-only, Save and invalidate, Reset | 4 |
| §3.4 Dependencies, config plugin, permission denied fallback | 2, 4 |
| §4 Photo failure keeps text; missing file falls back; later lookup keeps edits; per-book edits | 3, 4 (a missing file falls back because `CoverArt`'s `<Image>` shows its frame; see note) |
| §5 Tests: unit tests for pure logic, applyEdits fallback, manual list | 1, 2, 5, 6 |

**Note on §4 "cover file missing":** paths are stored relative and resolved at read time (Task 2 and 3), which handles the common iOS reinstall case. If a file were truly deleted, `<Image>` would render an empty frame rather than the generated cover. Checking whether the file exists on every render isn't worth the cost for such a rare case. If it becomes a problem, add an `onError` fallback in `CoverArt`.

**Deviation from spec:** the form route is `app/book/edit.tsx` with `bookId` or `isbn` query params, instead of `app/book/edit/[bookId].tsx`. Create mode has no book id until save, so one route with params is simpler.
