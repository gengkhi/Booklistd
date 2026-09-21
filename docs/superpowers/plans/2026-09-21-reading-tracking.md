# Reading Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track two things separately: ownership (At home / Wishlist, on `user_books`) and reading (Want to read / Reading / Read / Did not finish, with dates and the Dewey rating, in a new `readings` table). Store Mode, book detail, Shelves, a new Reading screen and Search all build on that split.

**Architecture:**
- Pure logic lives in `src/features/reading/*` and `src/features/scanner/storeVerdict.ts`, with unit tests:
  - state and date changes;
  - mapping old statuses to the new model;
  - choosing the Store Mode verdict;
  - choosing the detail screen's primary action.
- The SQLite v3 migration is a JS function that reuses `readingFromLegacy`.
- The repository gains reading functions and `getBookDetail`. `checkOwnership` also returns wishlist copies and the reading.
- Screens switch over one at a time. The old status and rating API stays until the final cleanup task narrows it, so every task leaves the app compiling.

**Tech Stack:** Expo SDK 57, expo-router, expo-sqlite (sync API), TanStack Query, Reanimated, Supabase Postgres migrations, Jest (jest-expo). New dependency: `@react-native-community/datetimepicker` (Task 6).

**Spec:** `docs/superpowers/specs/2026-09-21-reading-tracking-design.md`

## Global Constraints

- **Git and deploys:** never run `git add`/`commit`/`push`, `git rm`, or any `supabase` CLI command. Sean commits and deploys. Each task ends with a hand-off listing commands for Sean.
- **Working directory:** paths are relative to `Booklistd/` (`C:\Users\seanj\Documents\personal\Booklistd\Booklistd`).
- **Dependencies:** install only with `npx expo install <pkg>`. The only new dependency is `@react-native-community/datetimepicker` (Task 6).
- **Expo Go:** everything must run in Expo Go SDK 57 on iOS.
- **Vocabulary, verbatim:**
  - Ownership: `owned` is shown as **At home**, `wishlist` as **On your wishlist**.
  - Reading labels: **Want to read · Reading · Read · Did not finish**.
- **Store Mode headings, verbatim:** "You own this!" · "Found one!" · "You've read this" · "A new find!" · "We couldn't find this one." (the lookup-failed heading, unchanged).
- **Copy voice** (PRODUCT.md): warm librarian, plain verbs, sentence case, never twee.
- **Styling:** existing tokens from `@/theme/palette` and `useTheme()` only.
- **Dates:** `readings.started_at` / `finished_at` are local dates as `'YYYY-MM-DD'` strings. Never store a time.
- **Store Mode stays under 150ms offline:** readings are found with indexed queries only.
- **Checks after every task:**
  - `npx tsc --noEmit` exits 0.
  - `npx jest` passes. There are 51 tests at the start.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/lib/types.ts` | modify | `ReadingState`, `Reading`, `ReadingRow`; `OwnershipVerdict` gains `wishlistCopies`, `reading` (T3); narrow `BookStatus` and drop `UserBook.rating` (T8) |
| `src/features/reading/readingLogic.ts` (+test) | create | State and date rules, labels, formatting, year grouping, the verdict reading line |
| `src/features/reading/legacy.ts` (+test) | create | Old status → new model (`mapCopyStatus`, `readingFromLegacy`) |
| `src/features/scanner/storeVerdict.ts` (+test) | create | Picks one of the four verdicts, plus its lines |
| `src/features/reading/detailActions.ts` (+test) | create | Detail screen primary action |
| `src/db/ids.ts` | create | `newId` (moved from database.ts to avoid an import cycle) |
| `src/db/migrations/v3ReadingTracking.ts` | create | The v3 JS migration |
| `src/db/schema.ts`, `src/db/database.ts` | modify | v3, and support for function migrations |
| `src/db/repository.ts` | modify | Reading functions, `getBookDetail`, `checkOwnership` extension; cleanup in T8 |
| `supabase/migrations/20260921130000_reading_tracking.sql` | create | Server `readings` table, backfill, narrowed status check |
| `supabase/migrations/20260921120000_widen_rating_scale.sql` | delete | Superseded; never deployed |
| `src/features/scanner/VerdictSheet.tsx`, `useScanPipeline.ts`, `app/(tabs)/scan.tsx` | modify | The four Store Mode verdicts and Want to read |
| `src/components/reading/ReadingControls.tsx` | create | Reading chips, dates, rating entry |
| `app/book/[id].tsx` | modify | Book-centred detail |
| `src/features/rating/reactions.ts` (+test) | modify | `shouldPromptRating` takes reading states |
| `src/components/reading/CurrentlyReadingStrip.tsx` | create | Shelves strip |
| `app/(tabs)/index.tsx` | modify | Mounts the strip |
| `app/reading.tsx` | create | Reading screen |
| `src/lib/invalidateLibrary.ts` (+test) | modify | Also invalidate `['reading', …]` |
| `app/(tabs)/search.tsx` | modify | Three add actions on catalog results |
| `src/test/fixtures.ts`, `DESIGN.md`, `PRODUCT.md` | modify | Cleanup and docs |

---

### Task 1: Reading rules (pure)

**Files:**
- Modify: `src/lib/types.ts`
- Create: `src/features/reading/readingLogic.ts`
- Test: `src/features/reading/__tests__/readingLogic.test.ts`

**Interfaces:**
- Consumes: `reactionFor` from `@/features/rating/reactions`.
- Produces:
  ```ts
  // src/lib/types.ts
  export type ReadingState = 'want' | 'reading' | 'read' | 'dnf';
  export interface Reading { id: string; bookId: string; state: ReadingState; startedAt: string | null; finishedAt: string | null; rating: number | null; createdAt: string; updatedAt: string }
  // readingLogic.ts
  export const READING_STATES: readonly ReadingState[];
  export const READING_LABEL: Record<ReadingState, string>;
  export type ReadingFields = Pick<Reading, 'state' | 'startedAt' | 'finishedAt' | 'rating'>;
  export function todayIso(d?: Date): string;
  export function isoToDate(iso: string): Date;
  export function applyReadingState(prev: ReadingFields | null, next: ReadingState, today: string): ReadingFields;
  export function clampDates(startedAt: string | null, finishedAt: string | null): { startedAt: string | null; finishedAt: string | null };
  export function canRate(state: ReadingState): boolean;
  export function dayNumber(startedAt: string, today: string): number;
  export function formatMonthYear(iso: string): string;            // 'Mar 2025'
  export function formatShortDate(iso: string, today: string): string; // '3 Sep' or '3 Sep 2025'
  export function groupReadByYear<T extends { finishedAt: string | null }>(items: T[]): { year: string; items: T[] }[];
  export function readingLine(r: ReadingFields | null, today: string): string | null;
  ```

- [ ] **Step 1: Add the types**

In `src/lib/types.ts`, add below the `BookStatus` line:

```ts
export type ReadingState = 'want' | 'reading' | 'read' | 'dnf';

/** Where the user is with a book — independent of owning it. One live row per book. */
export interface Reading {
  id: string;
  bookId: string;
  state: ReadingState;
  startedAt: string | null; // 'YYYY-MM-DD'
  finishedAt: string | null; // 'YYYY-MM-DD'
  rating: number | null; // Dewey reaction 1–7
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/features/reading/__tests__/readingLogic.test.ts`:

```ts
import {
  applyReadingState, canRate, clampDates, dayNumber, formatMonthYear, formatShortDate, groupReadByYear,
  READING_LABEL, readingLine, todayIso,
} from '../readingLogic';

const T = '2026-09-21';

describe('applyReadingState', () => {
  it('starting a book stamps started_at and clears finished_at', () => {
    expect(applyReadingState(null, 'reading', T)).toEqual({ state: 'reading', startedAt: T, finishedAt: null, rating: null });
    expect(applyReadingState({ state: 'want', startedAt: null, finishedAt: null, rating: null }, 'reading', T).startedAt).toBe(T);
  });
  it('keeps the start date of a book already in progress', () => {
    expect(applyReadingState({ state: 'reading', startedAt: '2026-09-01', finishedAt: null, rating: null }, 'reading', T).startedAt).toBe('2026-09-01');
  });
  it('finishing or giving up stamps finished_at and keeps the start date', () => {
    const prev = { state: 'reading' as const, startedAt: '2026-09-01', finishedAt: null, rating: null };
    expect(applyReadingState(prev, 'read', T)).toEqual({ state: 'read', startedAt: '2026-09-01', finishedAt: T, rating: null });
    expect(applyReadingState(prev, 'dnf', T)).toEqual({ state: 'dnf', startedAt: '2026-09-01', finishedAt: T, rating: null });
  });
  it('a re-read restarts the dates but keeps the rating', () => {
    expect(applyReadingState({ state: 'read', startedAt: '2025-01-01', finishedAt: '2025-02-01', rating: 7 }, 'reading', T))
      .toEqual({ state: 'reading', startedAt: T, finishedAt: null, rating: 7 });
  });
  it('back to want to read clears both dates and keeps the rating', () => {
    expect(applyReadingState({ state: 'dnf', startedAt: '2025-01-01', finishedAt: '2025-02-01', rating: 2 }, 'want', T))
      .toEqual({ state: 'want', startedAt: null, finishedAt: null, rating: 2 });
  });
});

describe('clampDates', () => {
  it('never lets a book finish before it started', () => {
    expect(clampDates('2026-09-10', '2026-09-01')).toEqual({ startedAt: '2026-09-10', finishedAt: '2026-09-10' });
  });
  it('leaves valid and partial dates alone', () => {
    expect(clampDates('2026-09-01', '2026-09-10')).toEqual({ startedAt: '2026-09-01', finishedAt: '2026-09-10' });
    expect(clampDates(null, '2026-09-10')).toEqual({ startedAt: null, finishedAt: '2026-09-10' });
    expect(clampDates('2026-09-01', null)).toEqual({ startedAt: '2026-09-01', finishedAt: null });
  });
});

describe('canRate', () => {
  it('only finished or abandoned books can be rated', () => {
    expect(canRate('read')).toBe(true);
    expect(canRate('dnf')).toBe(true);
    expect(canRate('want')).toBe(false);
    expect(canRate('reading')).toBe(false);
  });
});

describe('dayNumber', () => {
  it('counts the start day as day 1', () => {
    expect(dayNumber(T, T)).toBe(1);
    expect(dayNumber('2026-09-10', T)).toBe(12);
    expect(dayNumber('2026-08-31', '2026-09-01')).toBe(2);
  });
});

describe('formatting', () => {
  it('formats month-year and short dates', () => {
    expect(formatMonthYear('2025-03-14')).toBe('Mar 2025');
    expect(formatShortDate('2026-09-03', T)).toBe('3 Sep');
    expect(formatShortDate('2025-09-03', T)).toBe('3 Sep 2025');
  });
  it('todayIso uses the local calendar date', () => {
    expect(todayIso(new Date(2026, 8, 3, 23, 30))).toBe('2026-09-03');
  });
  it('labels every state', () => {
    expect(READING_LABEL).toEqual({ want: 'Want to read', reading: 'Reading', read: 'Read', dnf: 'Did not finish' });
  });
});

describe('groupReadByYear', () => {
  it('groups by finish year, newest first, undated last', () => {
    const items = [
      { id: 'a', finishedAt: '2025-05-01' },
      { id: 'b', finishedAt: null },
      { id: 'c', finishedAt: '2026-02-01' },
      { id: 'd', finishedAt: '2026-08-01' },
    ];
    expect(groupReadByYear(items)).toEqual([
      { year: '2026', items: [items[3], items[2]] },
      { year: '2025', items: [items[0]] },
      { year: 'Undated', items: [items[1]] },
    ]);
  });
});

describe('readingLine', () => {
  it('summarises a reading for Store Mode', () => {
    expect(readingLine(null, T)).toBeNull();
    expect(readingLine({ state: 'read', startedAt: null, finishedAt: T, rating: 6 }, T)).toBe('Read · Wrecked me (nicely)');
    expect(readingLine({ state: 'read', startedAt: null, finishedAt: T, rating: null }, T)).toBe('Read');
    expect(readingLine({ state: 'reading', startedAt: '2026-09-10', finishedAt: null, rating: null }, T)).toBe('Reading now · day 12');
    expect(readingLine({ state: 'reading', startedAt: null, finishedAt: null, rating: null }, T)).toBe('Reading now');
    expect(readingLine({ state: 'want', startedAt: null, finishedAt: null, rating: null }, T)).toBe('On your TBR pile');
    expect(readingLine({ state: 'dnf', startedAt: null, finishedAt: T, rating: null }, T)).toBe("Didn't finish");
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `npx jest src/features/reading/__tests__/readingLogic.test.ts`
Expected: FAIL with `Cannot find module '../readingLogic'`.

- [ ] **Step 4: Write the implementation**

Create `src/features/reading/readingLogic.ts`:

```ts
import type { Reading, ReadingState } from '@/lib/types';
import { reactionFor } from '@/features/rating/reactions';

export const READING_STATES: readonly ReadingState[] = ['want', 'reading', 'read', 'dnf'];
export const READING_LABEL: Record<ReadingState, string> = {
  want: 'Want to read',
  reading: 'Reading',
  read: 'Read',
  dnf: 'Did not finish',
};

export type ReadingFields = Pick<Reading, 'state' | 'startedAt' | 'finishedAt' | 'rating'>;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date as 'YYYY-MM-DD' (never UTC — a late-night finish belongs to that day). */
export function todayIso(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Moving to a state fills in the dates a person would expect; the rating always survives. */
export function applyReadingState(prev: ReadingFields | null, next: ReadingState, today: string): ReadingFields {
  const rating = prev?.rating ?? null;
  if (next === 'want') return { state: 'want', startedAt: null, finishedAt: null, rating };
  if (next === 'reading') {
    const reread = prev?.state === 'read' || prev?.state === 'dnf';
    return { state: 'reading', startedAt: !reread && prev?.startedAt ? prev.startedAt : today, finishedAt: null, rating };
  }
  return { state: next, startedAt: prev?.startedAt ?? null, finishedAt: today, rating };
}

export function clampDates(startedAt: string | null, finishedAt: string | null) {
  if (startedAt && finishedAt && finishedAt < startedAt) return { startedAt, finishedAt: startedAt };
  return { startedAt, finishedAt };
}

export function canRate(state: ReadingState): boolean {
  return state === 'read' || state === 'dnf';
}

/** "Day N" of a read in progress; the start day is day 1. */
export function dayNumber(startedAt: string, today: string): number {
  const days = Math.round((isoToDate(today).getTime() - isoToDate(startedAt).getTime()) / 86400000);
  return Math.max(1, days + 1);
}

export function formatMonthYear(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function formatShortDate(iso: string, today: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const base = `${d} ${MONTHS[m - 1]}`;
  return String(y) === today.slice(0, 4) ? base : `${base} ${y}`;
}

export function groupReadByYear<T extends { finishedAt: string | null }>(items: T[]): { year: string; items: T[] }[] {
  const dated = items.filter((i) => i.finishedAt).sort((a, b) => b.finishedAt!.localeCompare(a.finishedAt!));
  const groups: { year: string; items: T[] }[] = [];
  for (const item of dated) {
    const year = item.finishedAt!.slice(0, 4);
    const last = groups[groups.length - 1];
    if (last && last.year === year) last.items.push(item);
    else groups.push({ year, items: [item] });
  }
  const undated = items.filter((i) => !i.finishedAt);
  if (undated.length) groups.push({ year: 'Undated', items: undated });
  return groups;
}

/** One short line about a reading, for the Store Mode verdict card. */
export function readingLine(r: ReadingFields | null, today: string): string | null {
  if (!r) return null;
  switch (r.state) {
    case 'read': {
      const label = reactionFor(r.rating)?.label;
      return label ? `Read · ${label}` : 'Read';
    }
    case 'reading':
      return r.startedAt ? `Reading now · day ${dayNumber(r.startedAt, today)}` : 'Reading now';
    case 'want':
      return 'On your TBR pile';
    case 'dnf':
      return "Didn't finish";
  }
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx jest src/features/reading/__tests__/readingLogic.test.ts`
Expected: PASS, 14 tests.

Run: `npx tsc --noEmit && npx jest`
Expected: tsc exits 0. All suites pass.

- [ ] **Step 6: Hand-off**

```
git add src/lib/types.ts src/features/reading
git commit -m "feat(reading): reading states, dates and formatting rules"
```

---

### Task 2: Decision functions (pure)

**Files:**
- Create: `src/features/reading/legacy.ts` + `src/features/reading/__tests__/legacy.test.ts`
- Create: `src/features/scanner/storeVerdict.ts` + `src/features/scanner/__tests__/storeVerdict.test.ts`
- Create: `src/features/reading/detailActions.ts` + `src/features/reading/__tests__/detailActions.test.ts`

**Interfaces:**
- Consumes: `ReadingFields`, `formatMonthYear` (Task 1); `ReadingState`; `reactionFor`, `isValidRating`.
- Produces:
  ```ts
  // legacy.ts
  export type CopyStatus = 'owned' | 'wishlist';
  export interface LegacyCopy { status: string; rating: number | null; updatedAt: string }
  export function mapCopyStatus(old: string): CopyStatus;
  export function readingFromLegacy(copies: LegacyCopy[]): ReadingFields | null;
  // storeVerdict.ts
  export type StoreVerdictKind = 'owned' | 'wishlist' | 'read' | 'new';
  export function storeVerdict(v: { ownedCopies: number; wishlistCopies: number; reading: Pick<ReadingFields, 'state'> | null }): StoreVerdictKind;
  export function newFindNote(reading: Pick<ReadingFields, 'state'> | null): string | null;
  export function readVerdictLine(r: ReadingFields): string;
  // detailActions.ts
  export type PrimaryAction = { kind: 'found' } | { kind: 'nudge'; borrower: string } | { kind: 'start' } | { kind: 'finish' } | { kind: 'markRead' } | null;
  export function primaryAction(i: { ownedCopies: number; wishlistCopy: boolean; loanedTo: string | null; readingState: ReadingState | null }): PrimaryAction;
  export function primaryLabel(a: Exclude<PrimaryAction, null>): string;
  ```

- [ ] **Step 1: Write the failing tests**

`src/features/reading/__tests__/legacy.test.ts`:

```ts
import { mapCopyStatus, readingFromLegacy } from '../legacy';

describe('mapCopyStatus', () => {
  it('keeps ownership only', () => {
    expect(['owned', 'reading', 'read', 'loaned'].map(mapCopyStatus)).toEqual(['owned', 'owned', 'owned', 'owned']);
    expect(['wishlist', 'want_to_buy'].map(mapCopyStatus)).toEqual(['wishlist', 'wishlist']);
  });
});

describe('readingFromLegacy', () => {
  const c = (status: string, updatedAt: string, rating: number | null = null) => ({ status, updatedAt, rating });
  it('no reading for books that were only owned or wished for', () => {
    expect(readingFromLegacy([c('owned', '2026-01-01 10:00:00'), c('wishlist', '2026-01-02 10:00:00')])).toBeNull();
  });
  it('a read copy becomes a finished reading dated from its last update', () => {
    expect(readingFromLegacy([c('read', '2026-03-04 22:10:00')])).toEqual({ state: 'read', startedAt: null, finishedAt: '2026-03-04', rating: null });
  });
  it('a reading copy becomes an in-progress reading', () => {
    expect(readingFromLegacy([c('reading', '2026-05-06 09:00:00')])).toEqual({ state: 'reading', startedAt: '2026-05-06', finishedAt: null, rating: null });
  });
  it('when copies disagree, read wins and the latest read copy dates it', () => {
    expect(readingFromLegacy([
      c('reading', '2026-07-01 09:00:00'), c('read', '2026-02-01 09:00:00'), c('read', '2026-04-01 09:00:00'),
    ])).toEqual({ state: 'read', startedAt: null, finishedAt: '2026-04-01', rating: null });
  });
  it('carries the best valid rating across copies', () => {
    expect(readingFromLegacy([c('read', '2026-02-01 09:00:00', 3), c('owned', '2026-02-02 09:00:00', 5)])?.rating).toBe(5);
    expect(readingFromLegacy([c('read', '2026-02-01 09:00:00', 9)])?.rating).toBeNull();
  });
});
```

`src/features/scanner/__tests__/storeVerdict.test.ts`:

```ts
import { newFindNote, readVerdictLine, storeVerdict } from '../storeVerdict';

describe('storeVerdict', () => {
  const v = (ownedCopies: number, wishlistCopies: number, state: 'want' | 'reading' | 'read' | 'dnf' | null) =>
    storeVerdict({ ownedCopies, wishlistCopies, reading: state ? { state } : null });
  it('owning wins over everything', () => {
    expect(v(1, 1, 'read')).toBe('owned');
  });
  it('a wishlist hit beats a past read', () => {
    expect(v(0, 1, 'read')).toBe('wishlist');
  });
  it('a finished or abandoned read with no copy is "read"', () => {
    expect(v(0, 0, 'read')).toBe('read');
    expect(v(0, 0, 'dnf')).toBe('read');
  });
  it('want or reading with no copy is still a new find', () => {
    expect(v(0, 0, 'want')).toBe('new');
    expect(v(0, 0, 'reading')).toBe('new');
    expect(v(0, 0, null)).toBe('new');
  });
});

describe('verdict lines', () => {
  it('new-find note mentions an unowned TBR or current read', () => {
    expect(newFindNote({ state: 'want' })).toBe('On your TBR pile');
    expect(newFindNote({ state: 'reading' })).toBe("You're reading this");
    expect(newFindNote(null)).toBeNull();
  });
  it('read line shows the verdict and when', () => {
    expect(readVerdictLine({ state: 'read', startedAt: null, finishedAt: '2025-03-14', rating: 5 })).toBe("Couldn't put it down · Finished Mar 2025");
    expect(readVerdictLine({ state: 'read', startedAt: null, finishedAt: null, rating: null })).toBe('Read');
    expect(readVerdictLine({ state: 'dnf', startedAt: null, finishedAt: '2025-03-14', rating: 1 })).toBe('You gave up on this one');
  });
});
```

`src/features/reading/__tests__/detailActions.test.ts`:

```ts
import { primaryAction, primaryLabel } from '../detailActions';

const base = { ownedCopies: 1, wishlistCopy: false, loanedTo: null as string | null, readingState: null as any };

describe('primaryAction', () => {
  it('a wishlist-only book offers Found it!', () => {
    expect(primaryAction({ ...base, ownedCopies: 0, wishlistCopy: true })).toEqual({ kind: 'found' });
  });
  it('a lent-out copy offers the nudge', () => {
    expect(primaryAction({ ...base, loanedTo: 'Mia', readingState: 'want' })).toEqual({ kind: 'nudge', borrower: 'Mia' });
  });
  it('follows the reading: start, finish, mark read, then nothing', () => {
    expect(primaryAction({ ...base, readingState: 'want' })).toEqual({ kind: 'start' });
    expect(primaryAction({ ...base, readingState: 'reading' })).toEqual({ kind: 'finish' });
    expect(primaryAction({ ...base, readingState: null })).toEqual({ kind: 'markRead' });
    expect(primaryAction({ ...base, readingState: 'read' })).toBeNull();
    expect(primaryAction({ ...base, readingState: 'dnf' })).toBeNull();
  });
  it('labels', () => {
    expect(primaryLabel({ kind: 'found' })).toBe('Found it!');
    expect(primaryLabel({ kind: 'nudge', borrower: 'Mia' })).toBe('Nudge Mia');
    expect(primaryLabel({ kind: 'start' })).toBe('Start reading');
    expect(primaryLabel({ kind: 'finish' })).toBe('Finished it');
    expect(primaryLabel({ kind: 'markRead' })).toBe('Mark as read');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx jest src/features/reading src/features/scanner`
Expected: the three new suites FAIL with `Cannot find module`.

- [ ] **Step 3: Implement**

`src/features/reading/legacy.ts`:

```ts
import { isValidRating } from '@/features/rating/reactions';
import type { ReadingFields } from './readingLogic';

export type CopyStatus = 'owned' | 'wishlist';
export interface LegacyCopy { status: string; rating: number | null; updatedAt: string }

/** Pre-v3 statuses mixed ownership and reading; keep only the ownership half. */
export function mapCopyStatus(old: string): CopyStatus {
  return old === 'wishlist' || old === 'want_to_buy' ? 'wishlist' : 'owned';
}

/** The reading implied by one book's pre-v3 copies, or null. */
export function readingFromLegacy(copies: LegacyCopy[]): ReadingFields | null {
  const tracked = copies.filter((c) => c.status === 'read' || c.status === 'reading');
  if (tracked.length === 0) return null;
  const state = tracked.some((c) => c.status === 'read') ? 'read' : 'reading';
  const latest = tracked.filter((c) => c.status === state).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const date = latest.updatedAt.slice(0, 10);
  const ratings = copies.map((c) => c.rating).filter(isValidRating);
  const rating = ratings.length ? Math.max(...ratings) : null;
  return state === 'read'
    ? { state, startedAt: null, finishedAt: date, rating }
    : { state, startedAt: date, finishedAt: null, rating };
}
```

`src/features/scanner/storeVerdict.ts`:

```ts
import { reactionFor } from '@/features/rating/reactions';
import { formatMonthYear, type ReadingFields } from '@/features/reading/readingLogic';

export type StoreVerdictKind = 'owned' | 'wishlist' | 'read' | 'new';

/** Exactly one verdict per scan, in priority order: owned > wishlist > read > new. */
export function storeVerdict(v: { ownedCopies: number; wishlistCopies: number; reading: Pick<ReadingFields, 'state'> | null }): StoreVerdictKind {
  if (v.ownedCopies > 0) return 'owned';
  if (v.wishlistCopies > 0) return 'wishlist';
  if (v.reading && (v.reading.state === 'read' || v.reading.state === 'dnf')) return 'read';
  return 'new';
}

export function newFindNote(reading: Pick<ReadingFields, 'state'> | null): string | null {
  if (reading?.state === 'want') return 'On your TBR pile';
  if (reading?.state === 'reading') return "You're reading this";
  return null;
}

export function readVerdictLine(r: ReadingFields): string {
  if (r.state === 'dnf') return 'You gave up on this one';
  const label = reactionFor(r.rating)?.label ?? 'Read';
  return r.finishedAt ? `${label} · Finished ${formatMonthYear(r.finishedAt)}` : label;
}
```

`src/features/reading/detailActions.ts`:

```ts
import type { ReadingState } from '@/lib/types';

export type PrimaryAction =
  | { kind: 'found' } | { kind: 'nudge'; borrower: string }
  | { kind: 'start' } | { kind: 'finish' } | { kind: 'markRead' } | null;

/** The one big button on book detail: the next natural step for this book. */
export function primaryAction(i: { ownedCopies: number; wishlistCopy: boolean; loanedTo: string | null; readingState: ReadingState | null }): PrimaryAction {
  if (i.wishlistCopy && i.ownedCopies === 0) return { kind: 'found' };
  if (i.loanedTo) return { kind: 'nudge', borrower: i.loanedTo };
  if (i.readingState === 'want') return { kind: 'start' };
  if (i.readingState === 'reading') return { kind: 'finish' };
  if (i.readingState === null) return { kind: 'markRead' };
  return null;
}

export function primaryLabel(a: Exclude<PrimaryAction, null>): string {
  switch (a.kind) {
    case 'found': return 'Found it!';
    case 'nudge': return `Nudge ${a.borrower}`;
    case 'start': return 'Start reading';
    case 'finish': return 'Finished it';
    case 'markRead': return 'Mark as read';
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx jest src/features/reading src/features/scanner`
Expected: PASS: legacy 6 tests, storeVerdict 6, detailActions 4.

Run: `npx tsc --noEmit && npx jest`
Expected: tsc exits 0. All suites pass.

- [ ] **Step 5: Hand-off**

```
git add src/features/reading src/features/scanner/storeVerdict.ts src/features/scanner/__tests__/storeVerdict.test.ts
git commit -m "feat(reading): legacy status mapping, Store Mode verdict and detail action rules"
```

---

### Task 3: Device data layer (schema v3 + repository)

**Files:**
- Create: `src/db/ids.ts`, `src/db/migrations/v3ReadingTracking.ts`
- Modify: `src/db/database.ts`, `src/db/schema.ts`, `src/lib/types.ts`, `src/db/repository.ts`

**Interfaces:**
- Consumes: Task 1 (`ReadingFields`, `applyReadingState`, `clampDates`, `canRate`, `todayIso`, `Reading`, `ReadingState`) and Task 2 (`mapCopyStatus`, `readingFromLegacy`).
- Produces:
  ```ts
  // types.ts
  export interface ReadingRow extends Reading { book: Book; ownership: 'owned' | 'wishlist' | null }
  // OwnershipVerdict gains: wishlistCopies: UserBook[]; reading: Reading | null;
  // repository.ts
  export function getReading(bookId: string): Reading | null;
  export function findReadingForWork(bookId: string | null, workKey: string | null): Reading | null;
  export function setReadingState(bookId: string, state: ReadingState | null, today?: string): Reading | null;
  export function setReadingDates(bookId: string, dates: { startedAt?: string | null; finishedAt?: string | null }): Reading;
  export function setReadingRating(bookId: string, rating: number | null): Reading;
  export function listReadings(state: ReadingState): ReadingRow[];
  export function listCurrentlyReading(): ReadingRow[];
  export interface BookDetail { book: Book; copies: CopyRow[]; wishlistCopy: UserBook | null; reading: Reading | null; focusCopyId: string | null }
  export function getBookDetail(id: string): BookDetail | null; // id may be a book id or a copy id
  ```
  The existing `setStatus`, `setRating`, `getLibraryRow` and the wide `BookStatus` all stay unchanged here. Task 8 removes the old parts.

> **Testing note:** `expo-sqlite` doesn't run under Jest. The migration's decisions come from `readingFromLegacy` and `mapCopyStatus`, and the state rules from `applyReadingState`. All are unit-tested in Tasks 1–2. This task is checked with tsc, Jest and the manual smoke test in Step 7.

- [ ] **Step 1: Move `newId`**

Create `src/db/ids.ts`:

```ts
/** UUID-ish, good enough locally; the server keeps it as-is on sync. */
export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
```

In `src/db/database.ts`, delete the `newId` function and add, below the imports, `export { newId } from './ids';`. Existing imports of `newId` from `./database` keep working.

- [ ] **Step 2: Support function migrations**

In `src/db/database.ts`, replace the body of the `withTransactionSync` callback in `migrate`:

```ts
    d.withTransactionSync(() => {
      const m = MIGRATIONS[v];
      if (typeof m === 'string') d.execSync(m);
      else m(d);
      d.execSync(`PRAGMA user_version = ${v + 1}`);
    });
```

- [ ] **Step 3: The v3 migration**

Create `src/db/migrations/v3ReadingTracking.ts`:

```ts
/**
 * v3 — reading tracking. Copies keep only ownership ('owned' | 'wishlist'); reading state, dates and the
 * Dewey rating move to `readings` (one live row per book). Decisions come from the unit-tested
 * readingFromLegacy / mapCopyStatus, so the SQL here only moves data.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { newId } from '../ids';
import { mapCopyStatus, readingFromLegacy, type LegacyCopy } from '@/features/reading/legacy';

export const READINGS_DDL = `
  CREATE TABLE IF NOT EXISTS readings (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id),
    state TEXT NOT NULL CHECK (state IN ('want','reading','read','dnf')),
    started_at TEXT,
    finished_at TEXT,
    rating INTEGER CHECK (rating BETWEEN 1 AND 7),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ux_readings_live ON readings(book_id) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_readings_book ON readings(book_id);
`;

export function migrateV3ReadingTracking(d: SQLiteDatabase): void {
  d.execSync(READINGS_DDL);
  const enqueue = (table: string, rowId: string, payload: unknown) =>
    d.runSync('INSERT INTO pending_ops (table_name, row_id, op, payload) VALUES (?, ?, ?, ?)', [table, rowId, 'upsert', JSON.stringify(payload)]);

  const live = d.getAllSync<any>('SELECT * FROM user_books WHERE deleted_at IS NULL');
  const byBook = new Map<string, any[]>();
  for (const c of live) byBook.set(c.book_id, [...(byBook.get(c.book_id) ?? []), c]);

  for (const [bookId, copies] of byBook) {
    const r = readingFromLegacy(copies.map((c): LegacyCopy => ({ status: c.status, rating: c.rating, updatedAt: c.updated_at })));
    if (!r) continue;
    const id = newId();
    d.runSync(
      'INSERT INTO readings (id, book_id, state, started_at, finished_at, rating) VALUES (?, ?, ?, ?, ?, ?)',
      [id, bookId, r.state, r.startedAt, r.finishedAt, r.rating]
    );
    enqueue('readings', id, d.getFirstSync('SELECT * FROM readings WHERE id = ?', [id]));
  }

  for (const c of live) {
    const status = mapCopyStatus(c.status);
    if (status === c.status && c.rating == null) continue;
    d.runSync(`UPDATE user_books SET status = ?, rating = NULL, updated_at = datetime('now') WHERE id = ?`, [status, c.id]);
    enqueue('user_books', c.id, d.getFirstSync('SELECT * FROM user_books WHERE id = ?', [c.id]));
  }

  // Soft-deleted copies never sync as upserts again, but must not keep values the server will reject.
  d.runSync(`UPDATE user_books SET status = 'owned', rating = NULL WHERE deleted_at IS NOT NULL AND status IN ('reading','read','loaned')`);
  d.runSync(`UPDATE user_books SET status = 'wishlist', rating = NULL WHERE deleted_at IS NOT NULL AND status = 'want_to_buy'`);

  // Queued ops from before v3 would carry old statuses; rewrite them in place.
  for (const op of d.getAllSync<any>(`SELECT id, payload FROM pending_ops WHERE table_name = 'user_books'`)) {
    const p = JSON.parse(op.payload);
    if (p && typeof p.status === 'string') {
      p.status = mapCopyStatus(p.status);
      p.rating = null;
      d.runSync('UPDATE pending_ops SET payload = ? WHERE id = ?', [JSON.stringify(p), op.id]);
    }
  }
}
```

In `src/db/schema.ts`:
- Add at the top: `import type { SQLiteDatabase } from 'expo-sqlite';` and `import { migrateV3ReadingTracking } from './migrations/v3ReadingTracking';`
- Change `export const SCHEMA_VERSION = 2;` to `export const SCHEMA_VERSION = 3;`
- Change `export const MIGRATIONS: string[] = [` to `export const MIGRATIONS: (string | ((d: SQLiteDatabase) => void))[] = [`
- Append after the v2 entry:

```ts
  // v3 — reading tracking (JS: reuses the tested legacy mapping). See src/db/migrations/v3ReadingTracking.ts.
  migrateV3ReadingTracking,
```

- [ ] **Step 4: Types**

In `src/lib/types.ts`:
- Add to `OwnershipVerdict`, after `userBooks: UserBook[];`:

```ts
  /** Wishlist copies of this book or another edition of the same work (only filled when not owned). */
  wishlistCopies: UserBook[];
  /** The live reading for this book, else for another edition of the same work. */
  reading: Reading | null;
```

- Add at the end:

```ts
export interface ReadingRow extends Reading {
  book: Book;
  ownership: 'owned' | 'wishlist' | null;
}
```

- [ ] **Step 5: Repository**

In `src/db/repository.ts`:

1. Update the imports:

```ts
import type { Book, BookStatus, LibraryRow, OwnershipVerdict, Reading, ReadingRow, ReadingState, UserBook } from '@/lib/types';
import { applyReadingState, canRate, clampDates, todayIso, type ReadingFields } from '@/features/reading/readingLogic';
```

2. Replace the whole `checkOwnership` function with:

```ts
export function checkOwnership(isbn13: string, scannedWorkKey?: string | null): OwnershipVerdict {
  const d = getDb();
  const exact = d.getFirstSync<any>('SELECT * FROM books_effective WHERE isbn13 = ?', [isbn13]);
  const book = exact ? toBook(exact) : null;
  const workKey = scannedWorkKey ?? book?.workKey ?? null;
  const reading = findReadingForWork(book?.id ?? null, workKey);

  const copiesWhere = (bookIds: string[], statusSql: string): UserBook[] => {
    if (bookIds.length === 0) return [];
    const q = bookIds.map(() => '?').join(',');
    return d
      .getAllSync<any>(`SELECT * FROM user_books WHERE book_id IN (${q}) AND deleted_at IS NULL AND ${statusSql}`, bookIds)
      .map(toUserBook);
  };
  const ownedCopies = (ids: string[]) => copiesWhere(ids, "status != 'wishlist'");

  const exactCopies = book ? ownedCopies([book.id]) : [];
  if (exactCopies.length > 0) {
    return { owned: true, exactIsbnMatch: true, workMatch: false, copies: exactCopies.length, book, userBooks: exactCopies, wishlistCopies: [], reading };
  }

  // Work-level match: same work, different edition/ISBN → duplicate warning.
  const siblings = workKey ? d.getAllSync<any>('SELECT * FROM books_effective WHERE work_key = ?', [workKey]).map(toBook) : [];
  const workCopies = ownedCopies(siblings.map((b) => b.id));
  if (workCopies.length > 0) {
    const ownedBook = siblings.find((b) => b.id === workCopies[0].bookId) ?? siblings[0];
    return { owned: true, exactIsbnMatch: false, workMatch: true, copies: workCopies.length, book: ownedBook, userBooks: workCopies, wishlistCopies: [], reading };
  }

  const ids = [...new Set([...(book ? [book.id] : []), ...siblings.map((b) => b.id)])];
  const wishlistCopies = copiesWhere(ids, "status IN ('wishlist', 'want_to_buy')");
  return { owned: false, exactIsbnMatch: false, workMatch: false, copies: 0, book, userBooks: [], wishlistCopies, reading };
}
```

3. Append this section after `libraryStats` at the end of the file:

```ts
// ---------- readings (one live row per book) ----------
const toReading = (r: any): Reading => ({
  id: r.id,
  bookId: r.book_id,
  state: r.state,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  rating: r.rating,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function getReading(bookId: string): Reading | null {
  const r = getDb().getFirstSync<any>('SELECT * FROM readings WHERE book_id = ? AND deleted_at IS NULL', [bookId]);
  return r ? toReading(r) : null;
}

/** This book's reading, else the most recent reading of another edition of the same work. */
export function findReadingForWork(bookId: string | null, workKey: string | null): Reading | null {
  if (bookId) {
    const exact = getReading(bookId);
    if (exact) return exact;
  }
  if (!workKey) return null;
  const r = getDb().getFirstSync<any>(
    `SELECT r.* FROM readings r JOIN books b ON b.id = r.book_id
      WHERE b.work_key = ? AND r.deleted_at IS NULL ORDER BY r.updated_at DESC LIMIT 1`,
    [workKey]
  );
  return r ? toReading(r) : null;
}

/** Update the live row, revive a soft-deleted one, or insert — never a second live row. */
function writeReading(bookId: string, f: ReadingFields): Reading {
  const d = getDb();
  const existing = d.getFirstSync<any>(
    'SELECT id FROM readings WHERE book_id = ? ORDER BY deleted_at IS NULL DESC, updated_at DESC LIMIT 1',
    [bookId]
  );
  const id = existing?.id ?? newId();
  if (existing) {
    d.runSync(
      `UPDATE readings SET state = ?, started_at = ?, finished_at = ?, rating = ?, deleted_at = NULL, updated_at = datetime('now') WHERE id = ?`,
      [f.state, f.startedAt, f.finishedAt, f.rating, id]
    );
  } else {
    d.runSync(
      'INSERT INTO readings (id, book_id, state, started_at, finished_at, rating) VALUES (?, ?, ?, ?, ?, ?)',
      [id, bookId, f.state, f.startedAt, f.finishedAt, f.rating]
    );
  }
  const row = d.getFirstSync<any>('SELECT * FROM readings WHERE id = ?', [id]);
  enqueue('readings', id, 'upsert', row);
  return toReading(row);
}

/** null clears the reading (soft delete, rating included). A revived row starts fresh. */
export function setReadingState(bookId: string, state: ReadingState | null, today: string = todayIso()): Reading | null {
  const prev = getReading(bookId);
  if (state === null) {
    if (!prev) return null;
    const d = getDb();
    d.runSync(`UPDATE readings SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, [prev.id]);
    enqueue('readings', prev.id, 'delete', d.getFirstSync<any>('SELECT * FROM readings WHERE id = ?', [prev.id]));
    return null;
  }
  return writeReading(bookId, applyReadingState(prev, state, today));
}

export function setReadingDates(bookId: string, dates: { startedAt?: string | null; finishedAt?: string | null }): Reading {
  const prev = getReading(bookId);
  if (!prev) throw new Error('There is no reading to date yet.');
  const startedAt = dates.startedAt !== undefined ? dates.startedAt : prev.startedAt;
  const finishedAt = dates.finishedAt !== undefined ? dates.finishedAt : prev.finishedAt;
  return writeReading(bookId, { state: prev.state, rating: prev.rating, ...clampDates(startedAt, finishedAt) });
}

/** Dewey rating 1–7 on a finished or abandoned reading; null clears it. */
export function setReadingRating(bookId: string, rating: number | null): Reading {
  if (rating !== null && !isValidRating(rating)) throw new Error('Rating must be a whole number from 1 to 7.');
  const prev = getReading(bookId);
  if (!prev || !canRate(prev.state)) throw new Error('Only finished or abandoned books can be rated.');
  return writeReading(bookId, { state: prev.state, startedAt: prev.startedAt, finishedAt: prev.finishedAt, rating });
}

const READING_ORDER: Record<ReadingState, string> = {
  reading: 'r.started_at DESC, r.updated_at DESC',
  want: 'r.created_at DESC',
  read: 'r.finished_at IS NULL, r.finished_at DESC, r.updated_at DESC',
  dnf: 'r.finished_at IS NULL, r.finished_at DESC, r.updated_at DESC',
};

export function listReadings(state: ReadingState): ReadingRow[] {
  return getDb()
    .getAllSync<any>(
      `SELECT r.*, b.id AS b_id, b.isbn13, b.isbn10, b.title, b.subtitle, b.authors, b.publisher, b.published_year,
              b.edition, b.genres, b.page_count, b.cover_url, b.cover_path, b.description, b.work_key, b.source, b.edited,
              CASE
                WHEN EXISTS (SELECT 1 FROM user_books ub WHERE ub.book_id = r.book_id AND ub.deleted_at IS NULL AND ub.status != 'wishlist') THEN 'owned'
                WHEN EXISTS (SELECT 1 FROM user_books ub WHERE ub.book_id = r.book_id AND ub.deleted_at IS NULL AND ub.status = 'wishlist') THEN 'wishlist'
              END AS ownership
         FROM readings r JOIN books_effective b ON b.id = r.book_id
        WHERE r.deleted_at IS NULL AND r.state = ?
        ORDER BY ${READING_ORDER[state]}`,
      [state]
    )
    .map((r) => ({ ...toReading(r), book: toBook({ ...r, id: r.b_id }), ownership: r.ownership ?? null }));
}

export function listCurrentlyReading(): ReadingRow[] {
  return listReadings('reading');
}

// ---------- book detail (keyed by book; copy ids still resolve) ----------
export interface BookDetail {
  book: Book;
  copies: CopyRow[];
  wishlistCopy: UserBook | null;
  reading: Reading | null;
  /** The copy whose shelf spot detail shows: the one that was tapped, else the first At home copy. */
  focusCopyId: string | null;
}

export function getBookDetail(id: string): BookDetail | null {
  const copy = getDb().getFirstSync<{ id: string; book_id: string }>(
    'SELECT id, book_id FROM user_books WHERE id = ? AND deleted_at IS NULL',
    [id]
  );
  const bookId = copy?.book_id ?? id;
  const book = getBook(bookId);
  if (!book) return null;
  const copies = listCopiesOfBook(bookId);
  const focusCopyId = copy && copies.some((cp) => cp.id === copy.id) ? copy.id : copies[0]?.id ?? null;
  return { book, copies, wishlistCopy: findWishlistCopy(bookId), reading: getReading(bookId), focusCopyId };
}
```

(`isValidRating` is already imported in this file.)

- [ ] **Step 6: Type-check and run the tests**

Run: `npx tsc --noEmit && npx jest`
Expected: tsc exits 0 and all suites pass. `OwnershipVerdict` is only built inside the repository, so nothing else needs changing.

- [ ] **Step 7: Manual smoke test (for Sean; implementers skip and say so)**

On an install that has books from before this change, open the app. It launches, Shelves still shows every At home book, and Store Mode still recognises owned books.

- [ ] **Step 8: Hand-off**

```
git add src/db src/lib/types.ts
git commit -m "feat(reading): readings table, v3 migration and repository API"
```

---

### Task 4: Server migration

**Files:**
- Create: `supabase/migrations/20260921130000_reading_tracking.sql`
- Delete: `supabase/migrations/20260921120000_widen_rating_scale.sql` (a plain file delete, **not** `git rm`)

**Interfaces:**
- Consumes: the existing `public.touch_updated_at()` function and the `user_books` table (from `0001_init.sql`).
- Produces: `public.readings`, which the device's `pending_ops` for table `readings` sync into.

- [ ] **Step 1: Delete the superseded migration**

Delete `supabase/migrations/20260921120000_widen_rating_scale.sql`. It was never applied to the remote, and ratings now live in `readings.rating`.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260921130000_reading_tracking.sql`:

```sql
-- Reading tracking: ownership stays on user_books ('owned' | 'wishlist'); reading state, dates and the
-- Dewey rating (1–7) move to readings, one row per user per book.

create table public.readings (
  id text primary key, -- client-generated id (offline-first)
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid not null references public.books (id),
  state text not null check (state in ('want','reading','read','dnf')),
  started_at date,
  finished_at date,
  rating int check (rating between 1 and 7),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, book_id)
);
create index idx_readings_user_book on public.readings (user_id, book_id);

create trigger trg_readings_touch before update on public.readings
  for each row execute function public.touch_updated_at();

alter table public.readings enable row level security;
create policy "own readings" on public.readings
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Backfill from the old mixed statuses: read beats reading; the latest copy in that state dates it.
with legacy as (
  select user_id, book_id, status, rating, updated_at,
         bool_or(status = 'read') over (partition by user_id, book_id) as any_read,
         max(rating) over (partition by user_id, book_id) as best_rating
    from public.user_books
   where deleted_at is null and status in ('reading', 'read')
), chosen as (
  select distinct on (user_id, book_id) user_id, book_id, any_read, best_rating, updated_at
    from legacy
   where status = case when any_read then 'read' else 'reading' end
   order by user_id, book_id, updated_at desc
)
insert into public.readings (id, user_id, book_id, state, started_at, finished_at, rating)
select gen_random_uuid()::text, user_id, book_id,
       case when any_read then 'read' else 'reading' end,
       case when any_read then null else updated_at::date end,
       case when any_read then updated_at::date else null end,
       best_rating
  from chosen
on conflict (user_id, book_id) do nothing;

update public.user_books set status = 'owned' where status in ('reading', 'read', 'loaned');
update public.user_books set status = 'wishlist' where status = 'want_to_buy';
update public.user_books set rating = null where rating is not null;

-- Narrow the status check. Its name is Postgres-generated, so find it by definition.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.user_books'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.user_books drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.user_books
  add constraint user_books_status_check check (status in ('owned', 'wishlist'));
```

- [ ] **Step 3: Run the checks**

Run: `npx tsc --noEmit && npx jest`. Nothing in TS changed, so this only confirms nothing broke.

- [ ] **Step 4: Hand-off (git and deploy are Sean's)**

```
git add supabase/migrations/20260921130000_reading_tracking.sql
git add -u supabase/migrations/20260921120000_widen_rating_scale.sql
git commit -m "feat(reading): server readings table and ownership-only statuses"
npx supabase login
npx supabase link --project-ref rmevekabhdfvztnanmrp
npx supabase migration list   # 20260921120000 must NOT be listed as applied remotely
npx supabase db push
```

---

### Task 5: Store Mode's four verdicts

**Files:**
- Modify: `src/features/scanner/VerdictSheet.tsx` (full replacement below)
- Modify: `src/features/scanner/useScanPipeline.ts`
- Modify: `app/(tabs)/scan.tsx`

**Interfaces:**
- Consumes:
  - `storeVerdict`, `newFindNote`, `readVerdictLine` (Task 2);
  - `readingLine`, `todayIso` (Task 1);
  - `OwnershipVerdict.wishlistCopies` / `.reading` and `setReadingState` (Task 3);
  - `reactionFor`.
- Produces: new `VerdictSheet` props `{ result, rooms, quiet, onKeepScanning, onAdd, onAddDetails, onWantToRead }`. The old `wishlisted` prop is removed; it's now derived from the verdict.

- [ ] **Step 1: Replace `VerdictSheet.tsx`**

Replace the whole contents of `src/features/scanner/VerdictSheet.tsx` with:

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import type { ScanResult } from './useScanPipeline';
import { newFindNote, readVerdictLine, storeVerdict } from './storeVerdict';
import { ownedLine, newFindLine } from '@/features/dewey/lines';
import { reactionFor } from '@/features/rating/reactions';
import { readingLine, todayIso } from '@/features/reading/readingLogic';
import { hashString } from '@/features/shelves/spineStyle';
import { CoverArt } from '@/components/shelf/CoverArt';
import { Dewey, type DeweyMood } from '@/components/dewey/Dewey';
import { Bubble } from '@/components/ui/Bubble';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { LeaderRow } from '@/components/ui/PocketCard';
import { Raised } from '@/components/ui/Raised';
import { Stamp } from '@/components/ui/Stamp';
import { Sticker } from '@/components/ui/Sticker';
import { font, ink, radius } from '@/theme/palette';
import { easeOut, motion } from '@/theme/motion';

// Timeline (ms after the sheet starts rising)
const T_MARK = 500; // stamp / sticker
const T_DEWEY = 800;
const T_SAY = 1150;

function LinkButton({ label, onPress, color }: { label: string; onPress: () => void; color: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 }}>
      <Text style={{ fontFamily: font.heavy, fontSize: 13.5, color, textDecorationLine: 'underline' }}>{label}</Text>
    </Pressable>
  );
}

export function VerdictSheet({
  result, rooms, quiet, onKeepScanning, onAdd, onAddDetails, onWantToRead,
}: {
  result: ScanResult; rooms: string[]; quiet: boolean;
  onKeepScanning: () => void; onAdd: (status: 'owned' | 'wishlist', room: string | null) => void;
  onAddDetails: (room: string | null) => void; onWantToRead: () => void;
}) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { verdict: v, meta, metaLoading, isbn13 } = result;
  const kind = storeVerdict({ ownedCopies: v.owned ? v.copies : 0, wishlistCopies: v.wishlistCopies.length, reading: v.reading });
  const owned = kind === 'owned';
  const wishlisted = v.wishlistCopies.length > 0;
  // Catalog lookup failed for an unknown book: an error state, so Dewey stays out of it.
  const lookupFailed = kind === 'new' && !metaLoading && !meta && !v.book;
  const title = v.book?.title ?? meta?.title ?? `ISBN ${isbn13}`;
  const author = (v.book?.authors ?? meta?.authors ?? [])[0];
  const edition = [v.book?.publisher ?? meta?.publisher, v.book?.publishedYear ?? meta?.publishedYear].filter(Boolean).join(', ');
  const today = todayIso();
  const [room, setRoom] = useState<string | null>(rooms[0] ?? null);
  const [say, setSay] = useState(false);

  const rise = useSharedValue(700);
  const shake = useSharedValue(0);
  useEffect(() => {
    rise.value = withTiming(0, { duration: motion.overlay, easing: easeOut });
    const t = setTimeout(() => setSay(true), T_SAY);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const sheet = useAnimatedStyle(() => ({ transform: [{ translateY: rise.value }] }));
  const card = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  const onStampLand = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (!reduced) shake.value = withSequence(withTiming(-3, { duration: 60 }), withTiming(3, { duration: 60 }), withTiming(0, { duration: 80 }));
  };

  const perRoom = useMemo(() => {
    const m = new Map<string, number>();
    v.userBooks.forEach((ub) => m.set(ub.location?.trim() || 'Unshelved', (m.get(ub.location?.trim() || 'Unshelved') ?? 0) + 1));
    return [...m.entries()];
  }, [v.userBooks]);

  const fg = owned ? ink.white : ink.brown;
  const heading =
    kind === 'owned' ? 'You own this!'
      : kind === 'wishlist' ? 'Found one!'
        : kind === 'read' ? "You've read this"
          : lookupFailed ? "We couldn't find this one." : 'A new find!';
  const mood: DeweyMood =
    kind === 'owned' ? 'smug' : kind === 'wishlist' ? 'happy' : kind === 'read' ? reactionFor(v.reading?.rating)?.mood ?? 'happy' : 'gasp';
  const line =
    kind === 'owned' ? ownedLine(v.copies, v.exactIsbnMatch)
      : kind === 'wishlist' ? "That's the one you wanted."
        : kind === 'read' ? "We've met this one before."
          : newFindLine(hashString(isbn13));
  const status = readingLine(v.reading, today);

  const roomPicker = (
    <>
      <Text style={{ fontFamily: font.heavy, fontSize: 13, color: ink.brown, marginTop: 14 }}>Shelve it in</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {rooms.map((r) => <Chip key={r} label={r} selected={room === r} onPress={() => setRoom(r)} />)}
      </View>
    </>
  );

  return (
    <Animated.View
      accessibilityViewIsModal
      style={[
        {
          position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 10,
          backgroundColor: owned ? ink.grass : ink.paper, borderTopWidth: 2.5, borderColor: ink.brown,
          borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
          paddingHorizontal: 20, paddingTop: 22, paddingBottom: insets.bottom + 20,
        },
        sheet,
      ]}
    >
      {!lookupFailed ? (
        <View style={{ position: 'absolute', right: 16, top: -56, zIndex: 11 }}>
          <Dewey mood={mood} size={70} pop popDelay={T_DEWEY} />
        </View>
      ) : null}
      {say && !quiet && !lookupFailed ? <Bubble text={line} width={176} style={{ position: 'absolute', right: 90, top: -66, zIndex: 11 }} /> : null}

      <Text accessibilityRole="header" style={{ fontFamily: font.display, fontSize: 40, lineHeight: 44, color: fg }}>{heading}</Text>

      <Animated.View style={[{ marginTop: 14 }, card]}>
        <Raised offset={3} radius={14}>
          <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center', backgroundColor: ink.white, borderWidth: 2.5, borderColor: ink.brown, borderRadius: 14, padding: 12 }}>
            <CoverArt id={v.book?.id ?? isbn13} title={title} coverUrl={v.book?.coverUrl ?? meta?.coverUrl} width={62} height={92} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={2} style={{ fontFamily: font.black, fontSize: 17, color: ink.brown }}>{title}</Text>
              {author || edition ? <Text numberOfLines={1} style={{ fontFamily: font.bold, fontSize: 13, color: ink.soft, marginTop: 2 }}>{[author, edition].filter(Boolean).join(' · ')}</Text> : null}
              {kind === 'owned' ? (
                <View style={{ marginTop: 4 }}>
                  <LeaderRow label="Copies" value={String(v.copies)} />
                  {perRoom.slice(0, 2).map(([name, n]) => <LeaderRow key={name} label={name} value={String(n)} />)}
                  {status ? <Text style={{ fontFamily: font.heavy, fontSize: 13, color: ink.plum, marginTop: 4 }}>{status}</Text> : null}
                </View>
              ) : metaLoading ? (
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 6 }}>
                  <ActivityIndicator color={ink.brown} />
                  <Text style={{ fontFamily: font.bold, fontSize: 13, color: ink.soft }}>Dewey is looking it up…</Text>
                </View>
              ) : kind === 'wishlist' ? (
                <Text style={{ fontFamily: font.heavy, fontSize: 13, color: ink.plum, marginTop: 4 }}>{status ? `On your wishlist · ${status}` : 'On your wishlist'}</Text>
              ) : kind === 'read' ? (
                <Text style={{ fontFamily: font.heavy, fontSize: 13, color: ink.plum, marginTop: 4 }}>{readVerdictLine(v.reading!)}</Text>
              ) : lookupFailed ? (
                <Text style={{ fontFamily: font.bold, fontSize: 13, color: ink.soft, marginTop: 4 }}>No catalog had it, or we couldn't reach one. You can add the details yourself.</Text>
              ) : (
                <Text style={{ fontFamily: font.heavy, fontSize: 13, color: ink.grass, marginTop: 4 }}>{newFindNote(v.reading) ?? 'Not on any shelf · not on your wishlist'}</Text>
              )}
            </View>
          </View>
        </Raised>
        {kind === 'owned' ? (
          <Stamp label="ALREADY YOURS" play delay={T_MARK} onLand={onStampLand} style={{ position: 'absolute', right: 10, top: -18 }} />
        ) : kind === 'wishlist' ? (
          <Sticker label="WISHLIST" play delay={T_MARK} style={{ position: 'absolute', right: -8, top: -18 }} />
        ) : kind === 'read' ? (
          <Sticker label="READ" play delay={T_MARK} style={{ position: 'absolute', right: -8, top: -18 }} />
        ) : (
          <Sticker label="NEW!" play delay={T_MARK} style={{ position: 'absolute', right: -8, top: -18 }} />
        )}
      </Animated.View>

      {kind === 'owned' ? (
        <>
          <Text style={{ fontFamily: font.heavy, fontSize: 13.5, color: fg, marginTop: 12 }}>
            {v.exactIsbnMatch ? 'Same edition you scanned. Put it back gently.' : `Different edition. You own ${v.copies} of this title.`}
          </Text>
          <View style={{ marginTop: 16 }}>
            <Button label="Keep scanning" onPress={onKeepScanning} />
          </View>
          <LinkButton label={`Add copy #${v.copies + 1} anyway`} onPress={() => onAdd('owned', v.userBooks[0]?.location ?? null)} color={fg} />
        </>
      ) : kind === 'wishlist' ? (
        <>
          {roomPicker}
          <View style={{ marginTop: 16 }}>
            <Button label="Got it! Shelve it" onPress={() => onAdd('owned', room)} />
          </View>
          <LinkButton label="Keep scanning" onPress={onKeepScanning} color={ink.brown} />
        </>
      ) : (
        <>
          {roomPicker}
          {lookupFailed ? (
            <>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                {!wishlisted ? <Button variant="ghost" flex label="Wishlist it" onPress={() => onAdd('wishlist', null)} /> : null}
                <Button flex label="Add details" onPress={() => onAddDetails(room)} />
              </View>
              <LinkButton label="Add with just the ISBN" onPress={() => onAdd('owned', room)} color={ink.brown} />
            </>
          ) : (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              {!wishlisted ? <Button variant="ghost" flex label="Wishlist it" onPress={() => onAdd('wishlist', null)} disabled={metaLoading} /> : null}
              <Button flex label="Add to shelves" onPress={() => onAdd('owned', room)} disabled={metaLoading} />
            </View>
          )}
          {kind === 'new' && !v.reading ? <LinkButton label="Want to read" onPress={onWantToRead} color={ink.brown} /> : null}
          <LinkButton label={kind === 'read' ? 'Keep scanning' : 'Not now, keep scanning'} onPress={onKeepScanning} color={ink.brown} />
        </>
      )}
    </Animated.View>
  );
}
```

> Check that `Sticker` takes `label`/`play`/`delay`/`style` (it does for "NEW!") and that `DeweyMood` is exported from `@/components/dewey/Dewey` (it is). Before the metadata arrives, `metaLoading` shows the spinner for every kind except `owned`, as today.

- [ ] **Step 2: Wishlist hits also get the success haptic**

In `src/features/scanner/useScanPipeline.ts`, change:

```ts
      verdict.owned ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning
```

to:

```ts
      verdict.owned || verdict.wishlistCopies.length > 0 ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning
```

- [ ] **Step 3: Scanner wiring**

In `app/(tabs)/scan.tsx`:

1. In the repository import, replace `findWishlistCopy` with `setReadingState`:

```ts
import {
  addUserBook, findBookByIsbn, libraryStats, listRooms, setLocation, setReadingState, setStatus, upsertBook,
} from '@/db/repository';
```

2. Replace the `wishCopy` `useMemo` block (the comment line and the `useMemo`) with:

```ts
  // Scanning a book that's already on the Someday shelf: adding it moves that copy instead of duplicating it.
  const wishCopy = current && !current.verdict.owned ? current.verdict.wishlistCopies[0] ?? null : null;
```

3. Replace the whole `addAs` function with these three helpers plus `addAs` and `wantToRead`:

```ts
  const showToast = (message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  };

  /** The scanned edition as a catalog row (placeholder when no catalog knew it). */
  const scannedBook = () => {
    const { meta, isbn13 } = current!;
    return (
      (meta ? upsertBook(meta) : findBookByIsbn(isbn13)) ??
      upsertBook({
        isbn13, isbn10: null, title: `ISBN ${isbn13}`, subtitle: null, authors: [], publisher: null, publishedYear: null,
        edition: null, genres: [], pageCount: null, coverUrl: null, description: null, workKey: null, source: 'manual',
      })
    );
  };

  const addAs = (status: 'owned' | 'wishlist', room: string | null) => {
    if (!current || busyRef.current) return;
    busyRef.current = true;
    let message: string;
    if (status === 'owned' && wishCopy) {
      setStatus(wishCopy.id, 'owned');
      setLocation(wishCopy.id, room);
      message = `Moved off the Someday shelf. Shelved in ${room ?? 'Unshelved'}.`;
    } else {
      // Always the scanned edition — on a work match verdict.book is the sibling edition already owned.
      addUserBook(scannedBook().id, status, status === 'owned' ? room ?? undefined : undefined);
      message =
        status === 'owned'
          ? `Shelved in ${room ?? 'Unshelved'}. Book #${libraryStats().totalBooks}.`
          : quiet ? 'Added to your wishlist.' : 'Wishlisted. The Someday shelf grows.';
    }
    invalidateLibrary(qc);
    dismiss();
    showToast(message);
  };

  const wantToRead = () => {
    if (!current || busyRef.current) return;
    busyRef.current = true;
    setReadingState(scannedBook().id, 'want');
    invalidateLibrary(qc);
    dismiss();
    showToast('On your TBR pile.');
  };
```

4. Replace the `<VerdictSheet … />` line with:

```tsx
        <VerdictSheet key={current.isbn13} result={current} rooms={rooms} quiet={quiet} onKeepScanning={dismiss} onAdd={addAs} onAddDetails={addDetails} onWantToRead={wantToRead} />
```

- [ ] **Step 4: Type-check and run the tests**

Run: `npx tsc --noEmit && npx jest`
Expected: tsc exits 0. All suites pass.

- [ ] **Step 5: Manual checks (for Sean)**
1. Scan an owned book: "You own this!" with the reading line, for example "Read · Forever shelf".
2. Scan a wishlisted book: "Found one!", then **Got it! Shelve it**. It moves to the chosen room.
3. Mark a book read, delete its copy, then scan it: "You've read this" with the rating and finish date.
4. Scan an unknown book and tap **Want to read**. The toast shows, and scanning it again shows "On your TBR pile".

- [ ] **Step 6: Hand-off**

```
git add src/features/scanner "app/(tabs)/scan.tsx"
git commit -m "feat(reading): four Store Mode verdicts and Want to read"
```

---

### Task 6: Book detail around the book

**Files:**
- Install: `@react-native-community/datetimepicker` (the SDK 57 version)
- Create: `src/components/reading/ReadingControls.tsx`
- Modify: `app/book/[id].tsx` (full replacement below)
- Modify: `src/features/rating/reactions.ts` and `src/features/rating/__tests__/reactions.test.ts` (`shouldPromptRating`)

**Interfaces:**
- Consumes:
  - `getBookDetail`, `setReadingState`, `setReadingDates`, `setReadingRating`, `addUserBook`, `setStatus`, `setLocation`, `listLibrary`, `listRooms` (repository);
  - `primaryAction`, `primaryLabel` (Task 2);
  - `READING_STATES`, `READING_LABEL`, `canRate`, `todayIso`, `isoToDate`, `formatShortDate` (Task 1);
  - `RatingSheet`, `RatingBadge`.
- Produces:
  - `ReadingControls({ reading, today, onState, onDates, onRate })`;
  - `shouldPromptRating(prev: ReadingState | null, next: ReadingState | null): boolean`.

- [ ] **Step 1: Install the date picker**

Run: `npx expo install @react-native-community/datetimepicker`
Expected: added at the SDK 57 version (9.1.0). `npx expo install --check` prints "Dependencies are up to date".

- [ ] **Step 2: Update `shouldPromptRating` (test first)**

In `src/features/rating/__tests__/reactions.test.ts`, replace the `shouldPromptRating` describe block with:

```ts
describe('shouldPromptRating', () => {
  it('prompts only when a book becomes read', () => {
    expect(shouldPromptRating(null, 'read')).toBe(true);
    expect(shouldPromptRating('reading', 'read')).toBe(true);
    expect(shouldPromptRating('read', 'read')).toBe(false);
    expect(shouldPromptRating('read', 'want')).toBe(false);
    expect(shouldPromptRating('reading', 'dnf')).toBe(false);
  });
});
```

Run: `npx jest src/features/rating`. Expected: FAIL at compile, because `null` isn't assignable to `BookStatus`.

In `src/features/rating/reactions.ts`, change the import to `import type { ReadingState } from '@/lib/types';` and the function to:

```ts
export function shouldPromptRating(prev: ReadingState | null, next: ReadingState | null): boolean {
  return prev !== 'read' && next === 'read';
}
```

Run: `npx jest src/features/rating`. Expected: PASS.

- [ ] **Step 3: `ReadingControls`**

Create `src/components/reading/ReadingControls.tsx`:

```tsx
import React, { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { Reading, ReadingState } from '@/lib/types';
import { canRate, formatShortDate, isoToDate, READING_LABEL, READING_STATES, todayIso } from '@/features/reading/readingLogic';
import { RatingBadge } from '@/components/rating/RatingBadge';
import { Chip } from '@/components/ui/Chip';
import { font } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

function DateField({ label, value, today, min, onChange }: {
  label: string; value: string | null; today: string; min?: string | null; onChange: (iso: string) => void;
}) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const text = { fontFamily: font.heavy, fontSize: 13, color: c.text };
  if (!value) {
    return (
      <Pressable onPress={() => onChange(today)} accessibilityRole="button" hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
        <Text style={[text, { textDecorationLine: 'underline' }]}>{`Add ${label.toLowerCase()} date`}</Text>
      </Pressable>
    );
  }
  const picker = (
    <DateTimePicker
      value={isoToDate(value)}
      mode="date"
      display={Platform.OS === 'ios' ? 'compact' : 'default'}
      maximumDate={isoToDate(today)}
      minimumDate={min ? isoToDate(min) : undefined}
      onChange={(e: DateTimePickerEvent, d?: Date) => {
        setOpen(false);
        if (e.type === 'set' && d) onChange(todayIso(d));
      }}
    />
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 }}>
      <Text style={text}>{label}</Text>
      {Platform.OS === 'ios' ? picker : (
        <>
          <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`${label} ${value}. Change date`} hitSlop={8}>
            <Text style={[text, { textDecorationLine: 'underline' }]}>{formatShortDate(value, today)}</Text>
          </Pressable>
          {open ? picker : null}
        </>
      )}
    </View>
  );
}

/** Reading row on book detail: the four states, the dates, and the Dewey rating. */
export function ReadingControls({ reading, today, onState, onDates, onRate }: {
  reading: Reading | null;
  today: string;
  onState: (s: ReadingState) => void;
  onDates: (d: { startedAt?: string | null; finishedAt?: string | null }) => void;
  onRate: () => void;
}) {
  const { c } = useTheme();
  const state = reading?.state ?? null;
  return (
    <View style={{ marginHorizontal: 16, marginTop: 18 }}>
      <Text style={{ fontFamily: font.black, fontSize: 13, color: c.text, marginBottom: 8 }}>Reading</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {READING_STATES.map((s) => (
          <Chip key={s} label={READING_LABEL[s]} selected={state === s} onPress={() => onState(s)} />
        ))}
      </View>
      {reading && state !== 'want' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, marginTop: 10 }}>
          <DateField label="Started" value={reading.startedAt} today={today} onChange={(iso) => onDates({ startedAt: iso })} />
          {canRate(reading.state) ? (
            <DateField label="Finished" value={reading.finishedAt} today={today} min={reading.startedAt} onChange={(iso) => onDates({ finishedAt: iso })} />
          ) : null}
        </View>
      ) : null}
      {reading && canRate(reading.state) ? (
        <View style={{ flexDirection: 'row', marginTop: 10 }}>
          {reading.rating ? (
            <RatingBadge rating={reading.rating} onPress={onRate} />
          ) : (
            <Pressable onPress={onRate} accessibilityRole="button" hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} style={{ height: 32, justifyContent: 'center' }}>
              <Text style={{ fontFamily: font.heavy, fontSize: 13, color: c.text, textDecorationLine: 'underline' }}>Rate it</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );
}
```

- [ ] **Step 4: Replace `app/book/[id].tsx`**

Replace the whole file with:

```tsx
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';
import Animated, { FadeInUp } from 'react-native-reanimated';
import {
  addUserBook, getBookDetail, listLibrary, listRooms, setLocation, setReadingDates, setReadingRating, setReadingState, setStatus,
} from '@/db/repository';
import type { ReadingState } from '@/lib/types';
import { UNSHELVED } from '@/features/shelves/groupByRoom';
import { needsDetails } from '@/features/bookEdits/editLogic';
import { primaryAction, primaryLabel } from '@/features/reading/detailActions';
import { READING_LABEL, todayIso } from '@/features/reading/readingLogic';
import { shouldPromptRating } from '@/features/rating/reactions';
import { invalidateLibrary } from '@/lib/invalidateLibrary';
import { useSettings } from '@/stores/settings';
import { CoverArt } from '@/components/shelf/CoverArt';
import { Spine } from '@/components/shelf/Spine';
import { Dewey } from '@/components/dewey/Dewey';
import { RatingSheet } from '@/components/rating/RatingSheet';
import { ReadingControls } from '@/components/reading/ReadingControls';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { LeaderRow, PocketCard } from '@/components/ui/PocketCard';
import { Raised } from '@/components/ui/Raised';
import { TapeNote } from '@/components/ui/TapeNote';
import { font, ink, radius } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

const daysSince = (iso: string) => Math.max(1, Math.round((Date.now() - new Date(iso.replace(' ', 'T') + 'Z').getTime()) / 86400000));

/** Non-interactive status badge — same look as Chip but never a fake button. */
function Pill({ label, selected }: { label: string; selected?: boolean }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        height: 32, paddingHorizontal: 13, borderRadius: radius.pill, borderWidth: 2, borderColor: c.line,
        backgroundColor: selected ? ink.brown : ink.white, alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Text style={{ fontFamily: font.heavy, fontSize: 12.5, color: selected ? ink.white : ink.brown }}>{label}</Text>
    </View>
  );
}

export default function BookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { c } = useTheme();
  const quiet = useSettings((s) => s.quiet);
  const [moving, setMoving] = useState(false);
  const [rateOpen, setRatingOpen] = useState(false);
  const { data: detail } = useQuery({ queryKey: ['book', id], queryFn: () => getBookDetail(id) });
  const { data: all = [] } = useQuery({ queryKey: ['library'], queryFn: () => listLibrary() });
  const rooms = useMemo(() => listRooms(), [detail]);
  if (!detail) return <View style={{ flex: 1, backgroundColor: c.paper }} />;

  const { book, copies, wishlistCopy, reading, focusCopyId } = detail;
  const today = todayIso();
  const focus = copies.find((cp) => cp.id === focusCopyId) ?? null;
  const room = focus?.location?.trim() || UNSHELVED;
  const neighbours = focus ? all.filter((r) => (r.location?.trim() || UNSHELVED) === room && r.status !== 'wishlist') : [];
  const at = focus ? neighbours.findIndex((r) => r.id === focus.id) : -1;
  const left = at === -1 ? [] : neighbours.slice(Math.max(0, at - 3), at);
  const right = at === -1 ? [] : neighbours.slice(at + 1, at + 4);
  const loaned = copies.find((cp) => cp.borrower);
  const loanDays = loaned?.loanedAt ? daysSince(loaned.loanedAt) : 0;
  const refresh = () => invalidateLibrary(qc);

  const changeState = (s: ReadingState) => {
    const prev = reading?.state ?? null;
    if (prev === s) {
      const clear = () => { setReadingState(book.id, null); refresh(); };
      if (reading?.rating) {
        Alert.alert('Clear your reading?', 'This removes your rating too.', [
          { text: 'Keep it', style: 'cancel' },
          { text: 'Clear', style: 'destructive', onPress: clear },
        ]);
      } else clear();
      return;
    }
    setReadingState(book.id, s, today);
    refresh();
    if (shouldPromptRating(prev, s)) setRatingOpen(true);
  };

  const action = primaryAction({
    ownedCopies: copies.length, wishlistCopy: !!wishlistCopy, loanedTo: loaned?.borrower ?? null, readingState: reading?.state ?? null,
  });
  const runPrimary = () => {
    if (!action) return;
    switch (action.kind) {
      case 'found': setStatus(wishlistCopy!.id, 'owned'); refresh(); return;
      case 'nudge':
        Share.share({ message: `Hi ${action.borrower}! How is ${book.title} treating you?${quiet ? '' : ' No rush. (Some rush.)'}` });
        return;
      case 'start': changeState('reading'); return;
      case 'finish':
      case 'markRead': changeState('read'); return;
    }
  };

  const ownershipLabel = copies.length ? 'At home' : wishlistCopy ? 'On your wishlist' : 'Not on your shelves';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 4 }}>
          <Raised offset={2} radius={22}>
            <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back"
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: ink.white, borderWidth: 2.5, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
              <Svg width={20} height={20} fill="none" stroke={ink.brown} strokeWidth={2.8}><Path d="M13 4l-7 6 7 6" /></Svg>
            </Pressable>
          </Raised>
        </View>

        {focus ? (
          <View style={{ marginHorizontal: 16, marginTop: 8 }}>
            <TapeNote text={`${room} — its spot`} style={{ alignSelf: 'flex-start', marginBottom: 4 }} />
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 2, height: 74 }}>
              {left.map((r) => <Spine key={r.id} id={r.id} title="" scale={0.55} />)}
              <View style={{ width: 32, height: 62, borderWidth: 2, borderStyle: 'dashed', borderColor: c.line, borderRadius: radius.spine, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 3 }}>
                <Text style={{ fontFamily: font.black, fontSize: 8, color: c.text }}>HERE</Text>
              </View>
              {right.map((r) => <Spine key={r.id} id={r.id} title="" scale={0.55} />)}
            </View>
            <View style={{ height: 12, backgroundColor: ink.tomato, borderWidth: 2, borderColor: c.line }} />
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 18, paddingHorizontal: 20, paddingTop: 22, alignItems: 'flex-end' }}>
          <Animated.View entering={FadeInUp.duration(600).withInitialValues({ transform: [{ translateY: -120 }] })}>
            <View style={{ transform: [{ rotate: '-4deg' }] }}>
              <Raised offset={5} radius={6}>
                <CoverArt id={focus?.id ?? book.id} title={book.title} author={book.authors[0]} coverUrl={book.coverUrl} width={132} height={196} />
              </Raised>
            </View>
          </Animated.View>
          <View style={{ flex: 1, paddingBottom: 6 }}>
            <Text accessibilityRole="header" style={{ fontFamily: font.display, fontSize: 34, lineHeight: 38, color: c.text }}>{book.title}</Text>
            <Text style={{ fontFamily: font.heavy, fontSize: 14, color: c.soft, marginTop: 4 }}>{book.authors.join(', ')}</Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              <Pill label={ownershipLabel} selected />
              {reading ? <Pill label={READING_LABEL[reading.state]} /> : null}
              {book.edited ? <Pill label="Edited by you" /> : null}
            </View>
          </View>
        </View>

        <ReadingControls
          reading={reading}
          today={today}
          onState={changeState}
          onDates={(d) => { setReadingDates(book.id, d); refresh(); }}
          onRate={() => setRatingOpen(true)}
        />

        {copies.length === 0 && !wishlistCopy ? (
          <View style={{ flexDirection: 'row', gap: 10, marginHorizontal: 16, marginTop: 18 }}>
            <Button variant="ghost" flex label="Wishlist it" onPress={() => { addUserBook(book.id, 'wishlist'); refresh(); }} />
            <Button flex label="Add to shelves" onPress={() => { addUserBook(book.id, 'owned'); refresh(); }} />
          </View>
        ) : null}

        <PocketCard title={copies.length ? `Pocket card · ${copies.length} ${copies.length === 1 ? 'copy' : 'copies'}` : 'Pocket card'} style={{ marginHorizontal: 16, marginTop: 22 }}>
          {copies.map((cp, i) => (
            <LeaderRow key={cp.id} label={`Copy ${i + 1}`} value={cp.borrower ? `Visiting ${cp.borrower}` : cp.location?.trim() || UNSHELVED} />
          ))}
          {book.publisher || book.publishedYear ? <LeaderRow label="Edition" value={[book.publisher, book.publishedYear].filter(Boolean).join(', ')} /> : null}
          <LeaderRow label="ISBN" value={book.isbn13 ?? '—'} />
        </PocketCard>

        {needsDetails(book) ? (
          <Pressable
            onPress={() => router.push({ pathname: '/book/edit', params: { bookId: book.id } })}
            accessibilityRole="button"
            style={{ marginHorizontal: 16, marginTop: 14, flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: ink.tape, borderWidth: 2, borderColor: c.line, borderRadius: 10, padding: 10 }}
          >
            <Dewey size={38} mood="gasp" />
            <Text style={{ flex: 1, fontFamily: font.heavy, fontSize: 13, color: ink.brown }}>Missing details. Add them so you can find it later.</Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => router.push({ pathname: '/book/edit', params: { bookId: book.id } })}
          accessibilityRole="button"
          style={{ marginHorizontal: 16, marginTop: 10, minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={{ fontFamily: font.heavy, fontSize: 13.5, color: c.text, textDecorationLine: 'underline' }}>Edit details</Text>
        </Pressable>

        {loaned?.loanedAt ? (
          <View style={{ marginHorizontal: 16, marginTop: 14, flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: ink.tape, borderWidth: 2, borderColor: c.line, borderRadius: 10, padding: 10 }}>
            <Dewey size={38} />
            <Text style={{ flex: 1, fontFamily: font.heavy, fontSize: 13, color: ink.brown }}>
              {`A copy has been visiting ${loaned.borrower} for ${loanDays} ${loanDays === 1 ? 'day' : 'days'}.`}
            </Text>
          </View>
        ) : null}

        {moving && focus ? (
          <View style={{ marginHorizontal: 16, marginTop: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(rooms.length ? rooms : ['Living room', 'Bedroom', 'Study']).map((r) => (
              <Chip key={r} label={r} selected={r === room} onPress={() => { setLocation(focus.id, r); setMoving(false); refresh(); }} />
            ))}
          </View>
        ) : null}

        {focus || action ? (
          <View style={{ flexDirection: 'row', gap: 10, marginHorizontal: 16, marginTop: 16 }}>
            {focus ? <Button variant="ghost" flex label={moving ? 'Cancel' : 'Move shelf'} onPress={() => setMoving((m) => !m)} /> : null}
            {action ? <Button flex label={primaryLabel(action)} onPress={runPrimary} /> : null}
          </View>
        ) : null}
      </ScrollView>
      <RatingSheet
        visible={rateOpen}
        rating={reading?.rating ?? null}
        onRate={(n) => { setReadingRating(book.id, n); refresh(); }}
        onClose={() => setRatingOpen(false)}
      />
    </SafeAreaView>
  );
}
```

> `RatingSheet` only opens once a reading is Read (after `changeState('read')`, or from the badge / "Rate it", which only show when `canRate`). So `setReadingRating` never throws here.

- [ ] **Step 5: Type-check and run the tests**

Run: `npx tsc --noEmit && npx jest`
Expected: tsc exits 0 and all suites pass. Detail no longer uses `setRating`/`getLibraryRow`; they stay exported until Task 8.

- [ ] **Step 6: Manual checks (for Sean)**
1. Open a book from Shelves. The ownership pill reads "At home" and the spot on the shelf still shows.
2. Tap each reading chip. Dates appear, and choosing Read opens the Dewey sheet.
3. Tap the selected chip on a rated book, and confirm the "Clear your reading?" prompt.
4. Change the dates using the compact pickers.
5. Open a wishlist book: **Found it!** moves it to At home.

- [ ] **Step 7: Hand-off**

```
git add package.json package-lock.json src/components/reading/ReadingControls.tsx "app/book/[id].tsx" src/features/rating
git commit -m "feat(reading): book detail with ownership and reading rows"
```

---

### Task 7: Currently reading strip and the Reading screen

**Files:**
- Create: `src/components/reading/CurrentlyReadingStrip.tsx`
- Create: `app/reading.tsx`
- Modify: `app/(tabs)/index.tsx`
- Modify: `src/lib/invalidateLibrary.ts` and `src/lib/__tests__/invalidateLibrary.test.ts`

**Interfaces:**
- Consumes: `listCurrentlyReading`, `listReadings`, `ReadingRow` (Task 3); `READING_STATES`, `READING_LABEL`, `dayNumber`, `formatShortDate`, `groupReadByYear`, `todayIso` (Task 1); `reactionFor`.
- Produces: the route `/reading?state=<ReadingState>`; `CurrentlyReadingStrip({ rows, today, onOpen, onSeeAll, onPickFromPile })`.

- [ ] **Step 1: Invalidate reading queries (test first)**

In `src/lib/__tests__/invalidateLibrary.test.ts`, change the `keys` array and the slice:

```ts
    const keys = [['library'], ['library', 'wishlist'], ['stats'], ['search', 'dune'], ['book', 'ub1'], ['reading', 'current'], ['isbn', '9780441172719']];
    keys.forEach((k) => qc.setQueryData(k, 1));
    invalidateLibrary(qc);
    const stale = (k: string[]) => qc.getQueryState(k)?.isInvalidated;
    expect(keys.slice(0, 6).every(stale)).toBe(true);
```

Run: `npx jest src/lib/__tests__/invalidateLibrary.test.ts`. Expected: FAIL.

In `src/lib/invalidateLibrary.ts`, change the key list to `['library', 'stats', 'search', 'book', 'reading']`, and the doc comment to "Every query that reads user_books or readings."

Run it again. Expected: PASS.

- [ ] **Step 2: The strip**

Create `src/components/reading/CurrentlyReadingStrip.tsx`:

```tsx
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { ReadingRow } from '@/lib/types';
import { dayNumber } from '@/features/reading/readingLogic';
import { CoverArt } from '@/components/shelf/CoverArt';
import { font } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

/** "Currently reading" covers above the bookcase. */
export function CurrentlyReadingStrip({ rows, today, onOpen, onSeeAll, onPickFromPile }: {
  rows: ReadingRow[]; today: string; onOpen: (bookId: string) => void; onSeeAll: () => void; onPickFromPile: () => void;
}) {
  const { c } = useTheme();
  return (
    <View style={{ marginTop: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 20 }}>
        <Text accessibilityRole="header" style={{ fontFamily: font.black, fontSize: 14, color: c.text }}>Currently reading</Text>
        <Pressable onPress={onSeeAll} accessibilityRole="button" hitSlop={10} style={{ minHeight: 32, justifyContent: 'center' }}>
          <Text style={{ fontFamily: font.heavy, fontSize: 13, color: c.text, textDecorationLine: 'underline' }}>See all reading</Text>
        </Pressable>
      </View>
      {rows.length === 0 ? (
        <Pressable onPress={onPickFromPile} accessibilityRole="button" style={{ marginHorizontal: 20, marginTop: 6, minHeight: 36, justifyContent: 'center' }}>
          <Text style={{ fontFamily: font.bold, fontSize: 13.5, color: c.soft }}>Nothing on the go. Pick something from your TBR pile.</Text>
        </Pressable>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12, paddingTop: 8 }}>
          {rows.map((r) => (
            <Pressable key={r.id} onPress={() => onOpen(r.bookId)} accessibilityRole="button"
              accessibilityLabel={`${r.book.title}${r.startedAt ? `, day ${dayNumber(r.startedAt, today)}` : ''}`} style={{ width: 84 }}>
              <CoverArt id={r.bookId} title={r.book.title} coverUrl={r.book.coverUrl} width={84} height={124} />
              <Text numberOfLines={1} style={{ fontFamily: font.heavy, fontSize: 12, color: c.text, marginTop: 6 }}>{r.book.title}</Text>
              {r.startedAt ? <Text style={{ fontFamily: font.bold, fontSize: 11.5, color: c.soft }}>{`Day ${dayNumber(r.startedAt, today)}`}</Text> : null}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
```

- [ ] **Step 3: Mount it on Shelves**

In `app/(tabs)/index.tsx`:
1. Add the imports:

```tsx
import { listCurrentlyReading } from '@/db/repository';
import { todayIso } from '@/features/reading/readingLogic';
import { CurrentlyReadingStrip } from '@/components/reading/CurrentlyReadingStrip';
```

(Merge `listCurrentlyReading` into the existing `@/db/repository` import line.)

2. Below the `stats` query add:

```tsx
  const { data: current = [] } = useQuery({ queryKey: ['reading', 'current'], queryFn: () => listCurrentlyReading() });
```

3. Between `<ScreenHeader … />` and `<Bookcase …>` insert:

```tsx
        {!empty || current.length ? (
          <CurrentlyReadingStrip
            rows={current}
            today={todayIso()}
            onOpen={(bookId) => router.push({ pathname: '/book/[id]', params: { id: bookId } })}
            onSeeAll={() => router.push({ pathname: '/reading', params: { state: 'reading' } })}
            onPickFromPile={() => router.push({ pathname: '/reading', params: { state: 'want' } })}
          />
        ) : null}
```

(On a brand-new empty library the strip stays hidden, so the "Scan your first book" empty state keeps the whole screen.)

- [ ] **Step 4: The Reading screen**

Create `app/reading.tsx`:

```tsx
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';
import { listReadings } from '@/db/repository';
import type { ReadingRow, ReadingState } from '@/lib/types';
import { dayNumber, formatShortDate, groupReadByYear, READING_LABEL, READING_STATES, todayIso } from '@/features/reading/readingLogic';
import { reactionFor } from '@/features/rating/reactions';
import { CoverArt } from '@/components/shelf/CoverArt';
import { Dewey } from '@/components/dewey/Dewey';
import { Chip } from '@/components/ui/Chip';
import { Raised } from '@/components/ui/Raised';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { font, ink } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

const EMPTY: Record<ReadingState, string> = {
  reading: 'Nothing on the go right now.',
  want: 'Your TBR pile is empty. For now.',
  read: 'No finished books yet.',
  dnf: 'No books abandoned. Yet.',
};

const OWNERSHIP_HINT = { owned: 'At home', wishlist: 'On your wishlist' } as const;

function Row({ r, today, onPress }: { r: ReadingRow; today: string; onPress: () => void }) {
  const { c } = useTheme();
  const face = reactionFor(r.rating);
  const when =
    r.state === 'reading' ? (r.startedAt ? `Day ${dayNumber(r.startedAt, today)}` : null)
      : r.state === 'read' || r.state === 'dnf' ? (r.finishedAt ? `Finished ${formatShortDate(r.finishedAt, today)}` : null)
        : null;
  const sub = [r.book.authors[0], when, r.ownership ? OWNERSHIP_HINT[r.ownership] : null].filter(Boolean).join(' · ');
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${r.book.title}, ${sub}${face ? `, ${face.label}` : ''}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 10, backgroundColor: ink.white, borderWidth: 2, borderColor: c.line, borderRadius: 12, padding: 10, minHeight: 76 }}>
      <CoverArt id={r.bookId} title={r.book.title} coverUrl={r.book.coverUrl} width={40} height={60} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: font.black, fontSize: 15, color: ink.brown }}>{r.book.title}</Text>
        {sub ? <Text numberOfLines={1} style={{ fontFamily: font.bold, fontSize: 12.5, color: ink.soft, marginTop: 2 }}>{sub}</Text> : null}
      </View>
      {face ? <Dewey mood={face.mood} size={34} still /> : null}
    </Pressable>
  );
}

export default function ReadingScreen() {
  const params = useLocalSearchParams<{ state?: string }>();
  const router = useRouter();
  const { c } = useTheme();
  const initial = (READING_STATES as readonly string[]).includes(params.state ?? '') ? (params.state as ReadingState) : 'reading';
  const [seg, setSeg] = useState<ReadingState>(initial);
  const { data: rows = [] } = useQuery({ queryKey: ['reading', seg], queryFn: () => listReadings(seg) });
  const today = todayIso();
  const groups = seg === 'read' ? groupReadByYear(rows) : [{ year: '', items: rows }];
  const open = (bookId: string) => router.push({ pathname: '/book/[id]', params: { id: bookId } });

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
        <ScreenHeader title="Reading" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginHorizontal: 16, marginTop: 12, marginBottom: 8 }}>
          {READING_STATES.map((s) => <Chip key={s} label={READING_LABEL[s]} selected={seg === s} onPress={() => setSeg(s)} />)}
        </View>
        {rows.length === 0 ? (
          <Text style={{ marginHorizontal: 20, marginTop: 16, fontFamily: font.bold, fontSize: 14, color: c.soft }}>{EMPTY[seg]}</Text>
        ) : (
          groups.map((g) => (
            <View key={g.year || 'all'}>
              {g.year ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginTop: 14, marginBottom: 8 }}>
                  <View style={{ width: 18, height: 2, backgroundColor: c.text }} />
                  <Text accessibilityRole="header" style={{ fontFamily: font.black, fontSize: 13, color: c.text }}>
                    {`${g.year} · ${g.items.length} ${g.items.length === 1 ? 'book' : 'books'}`}
                  </Text>
                </View>
              ) : null}
              {g.items.map((r) => <Row key={r.id} r={r} today={today} onPress={() => open(r.bookId)} />)}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
```

> Check that `Raised` accepts a `style` prop. If it doesn't, wrap it in `<View style={{ alignSelf: 'flex-start' }}>` instead. Check that `ScreenHeader` renders with only `title` (its `kicker`/`sub` are optional; confirm in `src/components/ui/ScreenHeader.tsx`).

- [ ] **Step 5: Type-check and run the tests**

Run: `npx tsc --noEmit && npx jest`
Expected: tsc exits 0. All suites pass.

- [ ] **Step 6: Manual checks (for Sean)**
1. Start reading a book. It appears in the strip as "Day 1".
2. "See all reading" opens the Reading screen on Reading.
3. The Read tab is grouped by year with Dewey faces.
4. With nothing in progress, the strip's empty line opens Want to read.

- [ ] **Step 7: Hand-off**

```
git add src/components/reading/CurrentlyReadingStrip.tsx app/reading.tsx "app/(tabs)/index.tsx" src/lib/invalidateLibrary.ts src/lib/__tests__/invalidateLibrary.test.ts
git commit -m "feat(reading): currently reading strip and Reading screen"
```

---

### Task 8: Search actions, cleanup of the old model, docs

**Files:**
- Modify: `app/(tabs)/search.tsx`
- Modify: `src/lib/types.ts`, `src/db/repository.ts`, `src/test/fixtures.ts`
- Modify: `DESIGN.md`, `PRODUCT.md`

**Interfaces:**
- Consumes: `checkOwnership` (with `wishlistCopies`/`reading`), `addUserBook`, `setReadingState`, `upsertBook`.
- Produces:
  - `BookStatus = 'owned' | 'wishlist'`;
  - `UserBook` without `rating`;
  - `setRating` and `getLibraryRow` removed;
  - `updateUserBook` limited to `'status' | 'location'`.

- [ ] **Step 1: Search, three add actions**

In `app/(tabs)/search.tsx`:
1. Change the repository import to `import { addUserBook, checkOwnership, searchLibrary, setReadingState, upsertBook } from '@/db/repository';`
2. Replace the two filter lines with:

```ts
  const owned = mine.filter((r) => r.status === 'owned');
  const wished = mine.filter((r) => r.status === 'wishlist');
```

3. Replace the whole `gate` query, `canAdd` and the `add` function with:

```ts
  // Catalog actions only for books not already owned; each action hides once it's done.
  const { data: gate } = useQuery({
    queryKey: ['search', 'catalog-gate', isbn],
    queryFn: () => {
      const v = checkOwnership(isbn!);
      return { owned: v.owned, wished: v.wishlistCopies.length > 0, reading: !!v.reading };
    },
    enabled: !!isbn,
  });
  const showCatalog = !!gate && !gate.owned && !(gate.wished && gate.reading);

  const act = (run: (bookId: string) => void) => {
    if (!catalog || busyRef.current) return;
    busyRef.current = true;
    run(upsertBook(catalog).id);
    invalidateLibrary(qc);
    busyRef.current = false;
  };
```

4. Replace the "From the catalog" block (`{isbn && catalog && canAdd ? ( … ) : null}`) with:

```tsx
        {isbn && catalog && showCatalog ? (
          <>
            <Section label="From the catalog" count={1} />
            <ResultRow id={isbn} title={catalog.title} sub={[catalog.authors[0], catalog.publishedYear].filter(Boolean).join(' · ')} right={null} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginHorizontal: 16 }}>
              {[
                { label: 'Add to shelves', show: true, run: (id: string) => addUserBook(id, 'owned') },
                { label: 'Wishlist it', show: !gate!.wished, run: (id: string) => addUserBook(id, 'wishlist') },
                { label: 'Want to read', show: !gate!.reading, run: (id: string) => setReadingState(id, 'want') },
              ].filter((a) => a.show).map((a) => (
                <Pressable key={a.label} onPress={() => act(a.run)} accessibilityRole="button" accessibilityLabel={`${a.label}: ${catalog.title}`} hitSlop={6}
                  style={{ height: 36, paddingHorizontal: 14, borderWidth: 2, borderColor: c.line, borderRadius: 10, backgroundColor: a.label === 'Add to shelves' ? ink.bus : ink.white, justifyContent: 'center' }}>
                  <Text style={{ fontFamily: font.black, fontSize: 13, color: ink.brown }}>{a.label}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
```

(`busyRef` and its `useEffect` stay. The guard is released after each synchronous action, so a second action, like Want to read after Wishlist it, still works.)

- [ ] **Step 2: Narrow the old model**

1. `src/lib/types.ts`:
   - `export type BookStatus = 'owned' | 'wishlist';`
   - delete the `rating: number | null;` line from `UserBook`.
2. `src/db/repository.ts`:
   - delete `rating: r.rating,` from `toUserBook`;
   - delete the whole `setRating` function and the `getLibraryRow` function;
   - change `updateUserBook`'s signature to `(userBookId: string, column: 'status' | 'location', value: string | null)`;
   - in `findWishlistCopy`, change `status IN ('wishlist', 'want_to_buy')` to `status = 'wishlist'`;
   - in `checkOwnership`, change `"status IN ('wishlist', 'want_to_buy')"` to `"status = 'wishlist'"`.
3. `src/test/fixtures.ts`: delete `rating: null, ` from the returned object.
4. Verify nothing still uses the old model:

```
grep -rn "want_to_buy\|'loaned'\|setRating\b\|getLibraryRow\|status === 'read'\|status === 'reading'" app src --include=*.ts --include=*.tsx
```

Expected: matches **only** in `src/features/reading/legacy.ts`, its test, and `src/db/migrations/v3ReadingTracking.ts`, which read the old values on purpose. Fix any other hit.

- [ ] **Step 3: Docs**

1. In `DESIGN.md`, add a new `### Reading tracking` section immediately before `## Do's and Don'ts`:

```markdown
### Reading tracking

Ownership and reading are separate. A copy is **At home** (`owned`) or **On your wishlist**; reading lives in `readings` (one per book): **Want to read · Reading · Read · Did not finish**, with local `YYYY-MM-DD` start/finish dates (starting stamps the start, finishing or giving up stamps the finish, a re-read restarts them) and the Dewey rating (read/dnf only). Shelves opens with a **Currently reading** strip (covers + "Day N", "See all reading"); `/reading` lists the four states, Read grouped by year. Book detail shows an ownership pill and a reading row (chips, dates via compact pickers, rating), with one primary button for the next step (Found it! · Start reading · Finished it · Mark as read, or the loan nudge). Store Mode gives exactly one verdict: **You own this!** (with a reading line) · **Found one!** (wishlist, "Got it! Shelve it") · **You've read this** (Dewey wears the rating face) · **A new find!** (Add to shelves · Wishlist it · Want to read).
```

2. In `PRODUCT.md`, under "The core promise", add as item 5:

```markdown
5. Track reading separately from owning — Want to read, Reading, Read, Did not finish — so a library read still counts and a wishlist stays about owning
```

- [ ] **Step 4: Type-check and run the tests**

Run: `npx tsc --noEmit && npx jest && npx expo-doctor`
Expected: tsc exits 0, all suites pass, and `expo-doctor` passes every check.

- [ ] **Step 5: Hand-off**

```
git add "app/(tabs)/search.tsx" src/lib/types.ts src/db/repository.ts src/test/fixtures.ts DESIGN.md PRODUCT.md
git commit -m "feat(reading): search actions, retire mixed statuses, docs"
```

---

## Spec coverage check

| Spec section | Task |
|---|---|
| §1 two tracks, out-of-scope list | whole plan (no page progress, re-read log or borrowed state) |
| §2.1 copies are ownership only; rating retired; `BookStatus` narrowed | 3 (verdict), 8 (narrowing) |
| §2.2 readings shape, one live row, revive, automatic dates, clamping, rating on read/dnf, sync | 1 (rules), 3 (table and writes) |
| §2.3 delete the old rating migration; server readings, backfill, status check | 4 |
| §3 SQLite v3 in one transaction, pending_ops rewrite, `migrateStatus` tested | 2 (mapping), 3 (migration). The spec's `migrateStatus` is split into `mapCopyStatus` + `readingFromLegacy` |
| §4 four verdicts, priority, lines, lookup-failed + Want to read, speed | 2 (rules), 3 (verdict data), 5 (UI) |
| §5.1 Currently reading strip and empty state | 7 |
| §5.2 Reading screen, year groups, Undated, ownership hint | 7 |
| §5.3 detail by book id with copy-id fallback, ownership row, reading row, primary button | 3 (`getBookDetail`), 6 |
| §5.4 Want to read in Store Mode and Search; Wishlist tab unchanged | 5, 8 |
| §6 repository API | 3 (removals in 8) |
| §7 edge cases | 3 (last copy deleted keeps the reading; soft delete; revive), 1 (re-read), 3/4 (old ops rewritten), 4 (deploy order) |
| §8 unit and manual tests | 1, 2, 6 (shouldPromptRating), 7 (invalidate), plus the manual steps in 3, 5, 6, 7 |

**Deviations from the spec:**
- **`storeVerdict` takes counts,** `{ ownedCopies, wishlistCopies, reading }`, instead of `{ copies, reading, workCopies, workReading }`. `checkOwnership` already merges exact and same-work matches, so the pure function stays simple.
- **The spec's `migrateStatus` is two functions,** `mapCopyStatus` and `readingFromLegacy`. The v3 migration runs as JS and calls them directly, so SQL no longer has to repeat that logic.
- **Tapping a selected chip asks for confirmation only when a rating would be lost,** as the spec says ("after a confirmation if it has a rating").
