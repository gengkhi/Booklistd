# Drag Books, Trash and Library-Card Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Hold a spine to drag it onto another shelf or onto a trash bin (removal with Undo).
- Rebuild book detail as one library card of tap-to-change rows.

**Architecture:**
- **Pure pieces, all unit-tested:**
  - `dropTarget` (a worklet-safe hit test);
  - `cardRows` (which card rows show, with what values);
  - a zustand toast store with an optional Undo.
- **Removal:** one hook, `useRemoveCopy`, handles the loan confirmation, the soft delete, and Undo through `restoreCopy`. It's used by the bin, VoiceOver actions and book detail.
- **Dragging:** a `DragProvider` wraps the bookcase.
  - Shelves and the bin register their on-screen rectangles.
  - Each spine gets a long-press Pan gesture whose UI-thread worklet updates the ghost position and the current target.
  - The drop runs on the JS thread.
- **Book detail** is rewritten around `cardRows` and a shared `CardSheet`.

**Tech Stack:** Expo SDK 57, react-native-gesture-handler 2.32, Reanimated 4.5, expo-haptics, zustand, TanStack Query, Jest.

**Spec:** `docs/superpowers/specs/2026-09-22-drag-and-detail-design.md`

## Global Constraints

- **Git:** never run git state-changing commands or `supabase` commands. The controller commits and pushes at the end.
- **Working directory:** `C:\Users\seanj\Documents\personal\Booklistd\Booklistd`.
- **No new dependencies.**
- **Expo Go:** everything must run in Expo Go SDK 57 on iOS.
- **Copy, verbatim:**
  - "🗑 Remove"
  - "Moved to ⟨Shelf⟩."
  - "Removed from your shelves."
  - "Undo"
  - "It's visiting ⟨Name⟩. Remove anyway?"
  - "Move to shelf…"
  - "Remove from shelves"
  - "Not started", "Rate it", "Add date"
  - "Not on your shelves", "On your wishlist", "Unshelved"
  - "Edit details"
  - "Missing details. Add them so you can find it later."
  - "Edited by you"
- **Haptics:**
  - pick up: Medium impact;
  - the target changes: `Haptics.selectionAsync()`;
  - drop on a shelf: Success notification;
  - drop on the bin: Heavy impact.
- **Timings:**
  - Undo stays for 5000ms;
  - a hold of 400ms starts a drag;
  - auto-scroll kicks in within 80pt of the bookcase's top or bottom edge.
- **Reduce motion:** no ghost tilt, spring or bin slide. Haptics stay.
- **Styling:** existing tokens only; rows and buttons are at least 44pt.
- **Checks after every task:**
  - `npx tsc --noEmit` exits 0.
  - `npx jest` passes. There are 91 tests at the start.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/features/shelves/dropTarget.ts` (+test) | create | `DropZone`, `dropTarget(point, zones)` (worklet) |
| `src/features/bookDetail/cardRows.ts` (+test) | create | `CardRow`, `cardRows(input, today, now)` |
| `src/stores/toast.ts` (+test) | create | `useToast` store: `show(message, onUndo?)`, `undo()`, `dismiss()` |
| `src/components/ui/UndoToast.tsx` | create | Root-level toast with an optional Undo button |
| `src/components/ui/CardSheet.tsx` | create | Bottom sheet (Modal) with title + Done |
| `src/db/repository.ts` | modify | `openLoanFor`, `removeCopyForUndo`, `restoreCopy` |
| `src/features/shelves/useRemoveCopy.ts` | create | Confirm (loan), remove, toast with Undo |
| `app/_layout.tsx` | modify | Mount `UndoToast` |
| `app/book/[id].tsx` | rewrite | Library-card detail |
| `src/components/reading/ReadingControls.tsx` | delete | Replaced by card rows |
| `src/components/shelf/DragLayer.tsx` | create | `DragProvider`, `useDrag`, `useDropZone`, `DraggableSpine`, ghost + bin overlay |
| `src/components/shelf/Spine.tsx`, `src/components/shelf/Shelf.tsx` | modify | hidden spine, a11y actions, drop zone + highlight |
| `app/(tabs)/index.tsx` | modify | Host the provider, handle drops, auto-scroll, Move sheet |
| `DESIGN.md` | modify | Document drag, trash and the library card |

---

### Task 1: Pure pieces (drop target, card rows, toast store)

**Files:**
- Create: `src/features/shelves/dropTarget.ts` and `src/features/shelves/__tests__/dropTarget.test.ts`
- Create: `src/features/bookDetail/cardRows.ts` and `src/features/bookDetail/__tests__/cardRows.test.ts`
- Create: `src/stores/toast.ts` and `src/stores/__tests__/toast.test.ts`

**Interfaces:**
- Consumes: `ReadingFields`, `READING_LABEL`, `canRate`, `formatShortDate` (readingLogic); `reactionFor`; `UNSHELVED`.
- Produces:
  ```ts
  export interface DropZone { key: string; id: string | null; kind: 'shelf' | 'bin'; rect: { x: number; y: number; width: number; height: number } }
  export function dropTarget(point: { x: number; y: number }, zones: DropZone[]): DropZone | null;
  export type CardRowKey = 'shelf' | 'status' | 'rating' | 'started' | 'finished' | 'copies' | 'loan' | 'edition' | 'isbn';
  export interface CardRow { key: CardRowKey; label: string; value: string; tappable: boolean }
  export interface CardInput {
    copies: { shelfName: string | null; borrower: string | null; loanedAt: string | null }[];
    focusShelfName: string | null; wishlist: boolean;
    reading: ReadingFields | null;
    book: { publisher: string | null; publishedYear: number | null; isbn13: string | null };
  }
  export function cardRows(input: CardInput, today: string, now: Date): CardRow[];
  export const TOAST_MS = 5000;
  export const useToast: UseBoundStore<StoreApi<{ message: string | null; onUndo: (() => void) | null; show: (message: string, onUndo?: () => void) => void; undo: () => void; dismiss: () => void }>>;
  ```

- [ ] **Step 1: Write the failing tests**

`src/features/shelves/__tests__/dropTarget.test.ts`:

```ts
import { dropTarget, type DropZone } from '../dropTarget';

const z = (key: string, kind: 'shelf' | 'bin', x: number, y: number, w: number, h: number, id: string | null = key): DropZone =>
  ({ key, id, kind, rect: { x, y, width: w, height: h } });

describe('dropTarget', () => {
  const zones = [z('shelf:a', 'shelf', 0, 100, 300, 150, 'a'), z('shelf:unshelved', 'shelf', 0, 260, 300, 150, null), z('bin', 'bin', 110, 380, 80, 60, null)];
  it('finds the shelf under the finger', () => {
    expect(dropTarget({ x: 50, y: 120 }, zones)?.key).toBe('shelf:a');
    expect(dropTarget({ x: 50, y: 300 }, zones)?.id).toBeNull();
  });
  it('prefers the bin where it overlaps a shelf', () => {
    expect(dropTarget({ x: 150, y: 400 }, zones)?.kind).toBe('bin');
  });
  it('returns null in gaps and outside', () => {
    expect(dropTarget({ x: 50, y: 255 }, zones)).toBeNull();
    expect(dropTarget({ x: 500, y: 120 }, zones)).toBeNull();
  });
});
```

`src/features/bookDetail/__tests__/cardRows.test.ts`:

```ts
import { cardRows, type CardInput } from '../cardRows';

const T = '2026-09-22';
const NOW = new Date('2026-09-22T12:00:00Z');
const base: CardInput = {
  copies: [{ shelfName: 'Study', borrower: null, loanedAt: null }],
  focusShelfName: 'Study', wishlist: false, reading: null,
  book: { publisher: 'Anvil', publishedYear: 2023, isbn13: '9789712737817' },
};
const keys = (i: CardInput) => cardRows(i, T, NOW).map((r) => r.key);
const val = (i: CardInput, k: string) => cardRows(i, T, NOW).find((r) => r.key === k)?.value;

describe('cardRows', () => {
  it('owned, unread: shelf, status, edition, isbn', () => {
    expect(keys(base)).toEqual(['shelf', 'status', 'edition', 'isbn']);
    expect(val(base, 'shelf')).toBe('Study');
    expect(val(base, 'status')).toBe('Not started');
    expect(val(base, 'edition')).toBe('Anvil, 2023');
  });
  it('read with a rating shows rating, started and finished', () => {
    const i = { ...base, reading: { state: 'read' as const, startedAt: '2026-09-03', finishedAt: '2026-09-18', rating: 6 } };
    expect(keys(i)).toEqual(['shelf', 'status', 'rating', 'started', 'finished', 'edition', 'isbn']);
    expect(val(i, 'rating')).toBe('Wrecked me (nicely)');
    expect(val(i, 'started')).toBe('3 Sep');
    expect(val(i, 'finished')).toBe('18 Sep');
  });
  it('unrated finish says Rate it and missing dates say Add date', () => {
    const i = { ...base, reading: { state: 'dnf' as const, startedAt: null, finishedAt: null, rating: null } };
    expect(val(i, 'rating')).toBe('Rate it');
    expect(val(i, 'started')).toBe('Add date');
    expect(val(i, 'finished')).toBe('Add date');
  });
  it('want to read has no dates or rating', () => {
    expect(keys({ ...base, reading: { state: 'want', startedAt: null, finishedAt: null, rating: null } })).toEqual(['shelf', 'status', 'edition', 'isbn']);
  });
  it('reading shows only started', () => {
    expect(keys({ ...base, reading: { state: 'reading', startedAt: '2026-09-10', finishedAt: null, rating: null } }))
      .toEqual(['shelf', 'status', 'started', 'edition', 'isbn']);
  });
  it('several copies and a loan', () => {
    const i: CardInput = { ...base, copies: [
      { shelfName: 'Study', borrower: null, loanedAt: null },
      { shelfName: null, borrower: 'Mia', loanedAt: '2026-09-10 12:00:00' },
    ] };
    expect(keys(i)).toEqual(['shelf', 'status', 'copies', 'loan', 'edition', 'isbn']);
    expect(val(i, 'copies')).toBe('2 · Study, Unshelved');
    expect(val(i, 'loan')).toBe('Mia · 12 days');
  });
  it('wishlist-only and not-owned shelf values', () => {
    expect(val({ ...base, copies: [], focusShelfName: null, wishlist: true }, 'shelf')).toBe('On your wishlist');
    expect(val({ ...base, copies: [], focusShelfName: null }, 'shelf')).toBe('Not on your shelves');
  });
  it('isbn is display-only and edition falls back to a dash', () => {
    const rows = cardRows({ ...base, book: { publisher: null, publishedYear: null, isbn13: null } }, T, NOW);
    expect(rows.find((r) => r.key === 'isbn')).toEqual({ key: 'isbn', label: 'ISBN', value: '—', tappable: false });
    expect(rows.find((r) => r.key === 'edition')?.value).toBe('—');
  });
});
```

`src/stores/__tests__/toast.test.ts`:

```ts
import { TOAST_MS, useToast } from '../toast';

beforeEach(() => {
  jest.useFakeTimers();
  useToast.getState().dismiss();
});
afterEach(() => jest.useRealTimers());

describe('toast store', () => {
  it('shows a message and clears it after TOAST_MS', () => {
    useToast.getState().show('Moved to Study.');
    expect(useToast.getState().message).toBe('Moved to Study.');
    jest.advanceTimersByTime(TOAST_MS);
    expect(useToast.getState().message).toBeNull();
  });
  it('undo runs the callback once and clears', () => {
    const cb = jest.fn();
    useToast.getState().show('Removed from your shelves.', cb);
    useToast.getState().undo();
    useToast.getState().undo();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(useToast.getState().message).toBeNull();
  });
  it('a new toast replaces the pending one (its undo is dropped)', () => {
    const first = jest.fn();
    useToast.getState().show('Removed from your shelves.', first);
    useToast.getState().show('Moved to Study.');
    useToast.getState().undo();
    expect(first).not.toHaveBeenCalled();
    jest.advanceTimersByTime(TOAST_MS - 1);
    expect(useToast.getState().message).toBe('Moved to Study.');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx jest src/features/shelves/__tests__/dropTarget.test.ts src/features/bookDetail src/stores/__tests__/toast.test.ts`
Expected: the three suites FAIL with `Cannot find module`.

- [ ] **Step 3: Implement**

`src/features/shelves/dropTarget.ts`:

```ts
export interface DropZone {
  key: string; // 'bin' | 'shelf:<id>' | 'shelf:unshelved'
  id: string | null; // shelf id; null = Unshelved (or the bin)
  kind: 'shelf' | 'bin';
  rect: { x: number; y: number; width: number; height: number }; // window coordinates
}

/** The zone under the finger; the bin wins where it overlaps a shelf. Runs on the UI thread. */
export function dropTarget(point: { x: number; y: number }, zones: DropZone[]): DropZone | null {
  'worklet';
  let hit: DropZone | null = null;
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    const r = z.rect;
    if (point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height) {
      if (z.kind === 'bin') return z;
      if (!hit) hit = z;
    }
  }
  return hit;
}
```

`src/features/bookDetail/cardRows.ts`:

```ts
import { reactionFor } from '@/features/rating/reactions';
import { canRate, formatShortDate, READING_LABEL, type ReadingFields } from '@/features/reading/readingLogic';
import { UNSHELVED } from '@/features/shelves/shelfRules';

export type CardRowKey = 'shelf' | 'status' | 'rating' | 'started' | 'finished' | 'copies' | 'loan' | 'edition' | 'isbn';
export interface CardRow { key: CardRowKey; label: string; value: string; tappable: boolean }
export interface CardInput {
  copies: { shelfName: string | null; borrower: string | null; loanedAt: string | null }[];
  focusShelfName: string | null;
  wishlist: boolean;
  reading: ReadingFields | null;
  book: { publisher: string | null; publishedYear: number | null; isbn13: string | null };
}

const daysSince = (sqlUtc: string, now: Date) =>
  Math.max(1, Math.round((now.getTime() - new Date(sqlUtc.replace(' ', 'T') + 'Z').getTime()) / 86400000));

/** The library card, top to bottom. Rows only appear when they apply (spec §3.2). */
export function cardRows(input: CardInput, today: string, now: Date): CardRow[] {
  const { copies, reading, book } = input;
  const rows: CardRow[] = [];
  const shelf = copies.length ? input.focusShelfName ?? UNSHELVED : input.wishlist ? 'On your wishlist' : 'Not on your shelves';
  rows.push({ key: 'shelf', label: 'Shelf', value: shelf, tappable: true });
  rows.push({ key: 'status', label: 'Status', value: reading ? READING_LABEL[reading.state] : 'Not started', tappable: true });
  if (reading && canRate(reading.state)) {
    rows.push({ key: 'rating', label: 'Rating', value: reactionFor(reading.rating)?.label ?? 'Rate it', tappable: true });
  }
  if (reading && reading.state !== 'want') {
    rows.push({ key: 'started', label: 'Started', value: reading.startedAt ? formatShortDate(reading.startedAt, today) : 'Add date', tappable: true });
  }
  if (reading && canRate(reading.state)) {
    rows.push({ key: 'finished', label: 'Finished', value: reading.finishedAt ? formatShortDate(reading.finishedAt, today) : 'Add date', tappable: true });
  }
  if (copies.length >= 2) {
    const names = [...new Set(copies.map((c) => c.shelfName ?? UNSHELVED))].join(', ');
    rows.push({ key: 'copies', label: 'Copies', value: `${copies.length} · ${names}`, tappable: true });
  }
  const lent = copies.find((c) => c.borrower);
  if (lent?.borrower) {
    const days = lent.loanedAt ? daysSince(lent.loanedAt, now) : 0;
    rows.push({ key: 'loan', label: 'On loan', value: `${lent.borrower} · ${days} ${days === 1 ? 'day' : 'days'}`, tappable: true });
  }
  const edition = [book.publisher, book.publishedYear].filter(Boolean).join(', ');
  rows.push({ key: 'edition', label: 'Edition', value: edition || '—', tappable: true });
  rows.push({ key: 'isbn', label: 'ISBN', value: book.isbn13 ?? '—', tappable: false });
  return rows;
}
```

`src/stores/toast.ts`:

```ts
import { create } from 'zustand';

export const TOAST_MS = 5000;

interface ToastState {
  message: string | null;
  onUndo: (() => void) | null;
  show: (message: string, onUndo?: () => void) => void;
  undo: () => void;
  dismiss: () => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;
const clearTimer = () => {
  if (timer) clearTimeout(timer);
  timer = null;
};

/** One app-wide toast. A new one replaces the old; its Undo is dropped (that action stays done). */
export const useToast = create<ToastState>((set, get) => ({
  message: null,
  onUndo: null,
  show: (message, onUndo) => {
    clearTimer();
    set({ message, onUndo: onUndo ?? null });
    timer = setTimeout(() => set({ message: null, onUndo: null }), TOAST_MS);
  },
  undo: () => {
    const cb = get().onUndo;
    clearTimer();
    set({ message: null, onUndo: null });
    cb?.();
  },
  dismiss: () => {
    clearTimer();
    set({ message: null, onUndo: null });
  },
}));
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx jest src/features/shelves/__tests__/dropTarget.test.ts src/features/bookDetail src/stores/__tests__/toast.test.ts`
Expected: PASS (3 + 8 + 3 tests).

Run: `npx tsc --noEmit && npx jest`. Both pass.

- [ ] **Step 5: Hand-off**

Files: the six files above.

---

### Task 2: Removal with Undo, toast host and CardSheet

**Files:**
- Modify: `src/db/repository.ts`, `app/_layout.tsx`
- Create: `src/features/shelves/useRemoveCopy.ts`, `src/components/ui/UndoToast.tsx`, `src/components/ui/CardSheet.tsx`

**Interfaces:**
- Consumes: `useToast` (Task 1), `removeCopy`, `invalidateLibrary`.
- Produces:
  ```ts
  export function openLoanFor(copyId: string): { id: string; borrower: string } | null;
  export function removeCopyForUndo(copyId: string): { copyId: string; reopenLoanId: string | null };
  export function restoreCopy(copyId: string, reopenLoanId: string | null): void;
  export function useRemoveCopy(): (copyId: string, opts?: { onRemoved?: () => void }) => void;
  export function UndoToast(): JSX.Element | null;
  export function CardSheet(props: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }): JSX.Element;
  ```

> **Testing note:** the repository and the React hook aren't unit-testable under Jest (native SQLite); the toast store logic is tested in Task 1. Check with tsc and Jest.

- [ ] **Step 1: Repository**

Append to `src/db/repository.ts`:

```ts
// ---------- removing a copy, reversibly ----------
export function openLoanFor(copyId: string): { id: string; borrower: string } | null {
  const r = getDb().getFirstSync<{ id: string; borrower_name: string }>(
    'SELECT id, borrower_name FROM loans WHERE user_book_id = ? AND returned_at IS NULL AND deleted_at IS NULL LIMIT 1',
    [copyId]
  );
  return r ? { id: r.id, borrower: r.borrower_name } : null;
}

/** Soft-delete a copy; an open loan on it is closed. Returns what restoreCopy needs to undo it. */
export function removeCopyForUndo(copyId: string): { copyId: string; reopenLoanId: string | null } {
  const d = getDb();
  const loan = openLoanFor(copyId);
  if (loan) {
    d.runSync(`UPDATE loans SET returned_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, [loan.id]);
    enqueue('loans', loan.id, 'upsert', d.getFirstSync<any>('SELECT * FROM loans WHERE id = ?', [loan.id]));
  }
  removeCopy(copyId);
  return { copyId, reopenLoanId: loan?.id ?? null };
}

/** Undo: the same copy comes back (id, shelf, dates), and a loan closed by the removal reopens. */
export function restoreCopy(copyId: string, reopenLoanId: string | null): void {
  const d = getDb();
  d.runSync(`UPDATE user_books SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ?`, [copyId]);
  enqueue('user_books', copyId, 'upsert', d.getFirstSync<any>('SELECT * FROM user_books WHERE id = ?', [copyId]));
  if (reopenLoanId) {
    d.runSync(`UPDATE loans SET returned_at = NULL, updated_at = datetime('now') WHERE id = ?`, [reopenLoanId]);
    enqueue('loans', reopenLoanId, 'upsert', d.getFirstSync<any>('SELECT * FROM loans WHERE id = ?', [reopenLoanId]));
  }
}
```

- [ ] **Step 2: `useRemoveCopy`**

Create `src/features/shelves/useRemoveCopy.ts`:

```ts
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { openLoanFor, removeCopyForUndo, restoreCopy } from '@/db/repository';
import { invalidateLibrary } from '@/lib/invalidateLibrary';
import { useToast } from '@/stores/toast';

/** Remove a copy from your shelves (reading and rating stay), with Undo. Lent-out copies ask first. */
export function useRemoveCopy() {
  const qc = useQueryClient();
  const show = useToast((s) => s.show);
  return (copyId: string, opts?: { onRemoved?: () => void }) => {
    const go = () => {
      const undo = removeCopyForUndo(copyId);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      invalidateLibrary(qc);
      opts?.onRemoved?.();
      show('Removed from your shelves.', () => {
        restoreCopy(undo.copyId, undo.reopenLoanId);
        invalidateLibrary(qc);
      });
    };
    const loan = openLoanFor(copyId);
    if (!loan) return go();
    Alert.alert(`It's visiting ${loan.borrower}. Remove anyway?`, undefined, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: go },
    ]);
  };
}
```

- [ ] **Step 3: `UndoToast` and root mount**

Create `src/components/ui/UndoToast.tsx`:

```tsx
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeOut, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToast } from '@/stores/toast';
import { font, ink } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';
import { Raised } from './Raised';

/** App-wide toast (bottom), with an optional Undo. Mounted once in the root layout. */
export function UndoToast() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { message, onUndo, undo } = useToast();
  if (!message) return null;
  return (
    <Animated.View key={message} entering={SlideInDown.duration(300)} exiting={FadeOut.duration(200)} accessibilityLiveRegion="polite"
      style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 90, zIndex: 100 }}>
      <Raised offset={3} radius={14}>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: ink.white, borderWidth: 2.5, borderColor: c.line, borderRadius: 14, paddingLeft: 14, paddingRight: 6, minHeight: 52 }}>
          <Text style={{ flex: 1, fontFamily: font.heavy, fontSize: 14, color: ink.brown }}>{message}</Text>
          {onUndo ? (
            <Pressable onPress={undo} accessibilityRole="button" hitSlop={6} style={{ minHeight: 44, minWidth: 60, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: font.black, fontSize: 14, color: ink.pool, textDecorationLine: 'underline' }}>Undo</Text>
            </Pressable>
          ) : null}
        </View>
      </Raised>
    </Animated.View>
  );
}
```

In `app/_layout.tsx`, import `UndoToast` and render `<UndoToast />` right after the `</Stack>` inside `QueryProvider`.

- [ ] **Step 4: `CardSheet`**

Create `src/components/ui/CardSheet.tsx`:

```tsx
import React from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, ink, radius } from '@/theme/palette';

/** Small bottom sheet used by the library card's tap-to-change rows. */
export function CardSheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View accessibilityViewIsModal style={{ backgroundColor: ink.paper, borderTopWidth: 2.5, borderColor: ink.brown, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingHorizontal: 20, paddingTop: 16, paddingBottom: insets.bottom + 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text accessibilityRole="header" style={{ fontFamily: font.black, fontSize: 17, color: ink.brown }}>{title}</Text>
            <Pressable onPress={onClose} accessibilityRole="button" hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ fontFamily: font.heavy, fontSize: 14, color: ink.brown, textDecorationLine: 'underline' }}>Done</Text>
            </Pressable>
          </View>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
```

- [ ] **Step 5: Checks**

Run: `npx tsc --noEmit && npx jest`. Both pass.

- [ ] **Step 6: Hand-off**

Files: those listed.

---

### Task 3: Book detail as a library card

**Files:**
- Rewrite: `app/book/[id].tsx`
- Delete: `src/components/reading/ReadingControls.tsx` (plain delete, only after confirming no other importers)

**Interfaces:**
- Consumes:
  - `cardRows` (Task 1); `CardSheet`, `useRemoveCopy` (Task 2);
  - `getBookDetail`, `listShelves`, `setCopyShelf`, `setReadingState`, `setReadingDates`, `setReadingRating`, `addUserBook`, `setStatus`;
  - `primaryAction`/`primaryLabel`, `READING_STATES`, `READING_LABEL`, `isoToDate`, `todayIso`, `canRate`, `shouldPromptRating`, `reactionFor`, `needsDetails`, `UNSHELVED`;
  - `ShelfPicker`, `RatingSheet`, `Dewey`, `CoverArt`, `Chip`, `Button`, `PocketCard`, `Raised`, `Stamp`;
  - `DateTimePicker` from `@react-native-community/datetimepicker`.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Replace `app/book/[id].tsx`**

```tsx
import React, { useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, { FadeInUp } from 'react-native-reanimated';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  addUserBook, getBookDetail, listShelves, setCopyShelf, setReadingDates, setReadingRating, setReadingState, setStatus,
} from '@/db/repository';
import type { ReadingState } from '@/lib/types';
import { cardRows, type CardRowKey } from '@/features/bookDetail/cardRows';
import { needsDetails } from '@/features/bookEdits/editLogic';
import { primaryAction, primaryLabel } from '@/features/reading/detailActions';
import { isoToDate, READING_LABEL, READING_STATES, todayIso } from '@/features/reading/readingLogic';
import { reactionFor, shouldPromptRating } from '@/features/rating/reactions';
import { UNSHELVED } from '@/features/shelves/shelfRules';
import { useRemoveCopy } from '@/features/shelves/useRemoveCopy';
import { invalidateLibrary } from '@/lib/invalidateLibrary';
import { useSettings } from '@/stores/settings';
import { ShelfPicker } from '@/components/shelves/ShelfPicker';
import { CoverArt } from '@/components/shelf/CoverArt';
import { Dewey } from '@/components/dewey/Dewey';
import { RatingSheet } from '@/components/rating/RatingSheet';
import { Button } from '@/components/ui/Button';
import { CardSheet } from '@/components/ui/CardSheet';
import { Chip } from '@/components/ui/Chip';
import { PocketCard } from '@/components/ui/PocketCard';
import { Raised } from '@/components/ui/Raised';
import { font, ink } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

type Sheet = null | 'shelf' | 'status' | 'copies' | 'started' | 'finished';

function CardRowView({ label, value, tappable, onPress, face }: {
  label: string; value: string; tappable: boolean; onPress?: () => void; face?: React.ReactNode;
}) {
  return (
    <Pressable disabled={!tappable} onPress={onPress} accessibilityRole={tappable ? 'button' : undefined}
      accessibilityLabel={`${label}: ${value}`} accessibilityHint={tappable ? 'Double-tap to change' : undefined}
      style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}>
      <Text style={{ fontFamily: font.bold, fontSize: 14, color: ink.brown }}>{label}</Text>
      <Text numberOfLines={1} ellipsizeMode="clip" style={{ flex: 1, marginHorizontal: 6, color: ink.soft, fontFamily: font.black, fontSize: 12 }}>
        {' · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · ·'}
      </Text>
      {face}
      <Text numberOfLines={1} style={{ fontFamily: font.black, fontSize: 14, color: ink.brown, maxWidth: '55%' }}>{value}</Text>
      {tappable ? <Text style={{ fontFamily: font.black, fontSize: 14, color: ink.soft, marginLeft: 4 }}>›</Text> : null}
    </Pressable>
  );
}

export default function BookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const quiet = useSettings((s) => s.quiet);
  const removeCopy = useRemoveCopy();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [rateOpen, setRatingOpen] = useState(false);
  const { data: detail } = useQuery({ queryKey: ['book', id], queryFn: () => getBookDetail(id) });
  const { data: shelves = [] } = useQuery({ queryKey: ['shelves'], queryFn: () => listShelves() });
  if (!detail) return <View style={{ flex: 1, backgroundColor: c.paper }} />;

  const { book, copies, wishlistCopy, reading, focusCopyId } = detail;
  const today = todayIso();
  const focus = copies.find((cp) => cp.id === focusCopyId) ?? null;
  const refresh = () => invalidateLibrary(qc);
  const rows = cardRows({
    copies: copies.map((cp) => ({ shelfName: cp.shelfName, borrower: cp.borrower, loanedAt: cp.loanedAt })),
    focusShelfName: focus?.shelfName ?? null,
    wishlist: !!wishlistCopy,
    reading,
    book: { publisher: book.publisher, publishedYear: book.publishedYear, isbn13: book.isbn13 },
  }, today, new Date());
  const lent = copies.find((cp) => cp.borrower);

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
    setSheet(null);
    if (shouldPromptRating(prev, s)) setRatingOpen(true);
  };

  const nudge = () => {
    if (!lent?.borrower) return;
    Share.share({ message: `Hi ${lent.borrower}! How is ${book.title} treating you?${quiet ? '' : ' No rush. (Some rush.)'}` });
  };

  const tap = (key: CardRowKey) => {
    switch (key) {
      case 'shelf': return setSheet('shelf');
      case 'status': return setSheet('status');
      case 'rating': return setRatingOpen(true);
      case 'started': return setSheet('started');
      case 'finished': return setSheet('finished');
      case 'copies': return setSheet('copies');
      case 'loan': return nudge();
      case 'edition': return router.push({ pathname: '/book/edit', params: { bookId: book.id } });
      case 'isbn': return undefined;
    }
  };

  const removeOne = (copyId: string, leave: boolean) =>
    removeCopy(copyId, { onRemoved: () => { setSheet(null); if (leave) router.back(); } });

  const openMenu = () => {
    const items: { label: string; run: () => void; destructive?: boolean }[] = [
      { label: 'Edit details', run: () => router.push({ pathname: '/book/edit', params: { bookId: book.id } }) },
    ];
    if (copies.length === 1) items.push({ label: 'Move to shelf…', run: () => setSheet('shelf') });
    if (copies.length === 1) items.push({ label: 'Remove from shelves', destructive: true, run: () => removeOne(copies[0].id, true) });
    if (copies.length > 1) items.push({ label: 'Remove from shelves', destructive: true, run: () => setSheet('copies') });
    if (Platform.OS === 'ios') {
      const options = [...items.map((i) => i.label), 'Cancel'];
      const destructiveButtonIndex = items.findIndex((i) => i.destructive);
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: options.length - 1, destructiveButtonIndex: destructiveButtonIndex >= 0 ? destructiveButtonIndex : undefined },
        (i) => items[i]?.run()
      );
    } else {
      Alert.alert(book.title, undefined, [...items.map((i) => ({ text: i.label, onPress: i.run, style: i.destructive ? 'destructive' as const : 'default' as const })), { text: 'Cancel', style: 'cancel' as const }]);
    }
  };

  const action = primaryAction({
    ownedCopies: copies.length, wishlistCopy: !!wishlistCopy, loanedTo: lent?.borrower ?? null, readingState: reading?.state ?? null,
  });
  const runPrimary = () => {
    if (!action) return;
    switch (action.kind) {
      case 'found': setStatus(wishlistCopy!.id, 'owned'); refresh(); return;
      case 'nudge': nudge(); return;
      case 'start': changeState('reading'); return;
      case 'finish':
      case 'markRead': changeState('read'); return;
    }
  };

  const face = reading?.rating ? reactionFor(reading.rating) : null;
  const dateSheet = sheet === 'started' || sheet === 'finished';
  const dateValue = sheet === 'finished' ? reading?.finishedAt : reading?.startedAt;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: action ? 120 : 40 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 4 }}>
          <Raised offset={2} radius={22}>
            <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back"
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: ink.white, borderWidth: 2.5, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
              <Svg width={20} height={20} fill="none" stroke={ink.brown} strokeWidth={2.8}><Path d="M13 4l-7 6 7 6" /></Svg>
            </Pressable>
          </Raised>
          <Raised offset={2} radius={22}>
            <Pressable onPress={openMenu} accessibilityRole="button" accessibilityLabel="More actions"
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: ink.white, borderWidth: 2.5, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
              <Svg width={20} height={20} fill={ink.brown}><Circle cx={4} cy={10} r={2} /><Circle cx={10} cy={10} r={2} /><Circle cx={16} cy={10} r={2} /></Svg>
            </Pressable>
          </Raised>
        </View>

        <View style={{ flexDirection: 'row', gap: 18, paddingHorizontal: 20, paddingTop: 14, alignItems: 'flex-end' }}>
          <Animated.View entering={FadeInUp.duration(600).withInitialValues({ transform: [{ translateY: -120 }] })}>
            <View style={{ transform: [{ rotate: '-4deg' }] }}>
              <Raised offset={5} radius={6}>
                <CoverArt id={focus?.id ?? book.id} title={book.title} author={book.authors[0]} coverUrl={book.coverUrl} width={120} height={178} />
              </Raised>
            </View>
          </Animated.View>
          <View style={{ flex: 1, paddingBottom: 6 }}>
            <Text accessibilityRole="header" style={{ fontFamily: font.display, fontSize: 32, lineHeight: 36, color: c.text }}>{book.title}</Text>
            <Text style={{ fontFamily: font.heavy, fontSize: 14, color: c.soft, marginTop: 4 }}>{book.authors.join(', ')}</Text>
          </View>
        </View>

        <PocketCard title="Library card" style={{ marginHorizontal: 16, marginTop: 22 }}>
          {book.edited ? (
            <View style={{ position: 'absolute', right: 0, top: -2, borderWidth: 2, borderColor: ink.plum, borderRadius: 3, paddingHorizontal: 6, transform: [{ rotate: '-4deg' }] }}>
              <Text style={{ fontFamily: font.black, fontSize: 10, color: ink.plum }}>Edited by you</Text>
            </View>
          ) : null}
          {rows.map((r) => (
            <CardRowView key={r.key} label={r.label} value={r.value} tappable={r.tappable} onPress={() => tap(r.key)}
              face={r.key === 'rating' && face ? <View style={{ marginRight: 4 }}><Dewey mood={face.mood} size={22} still /></View> : undefined} />
          ))}
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
      </ScrollView>

      {action ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, paddingBottom: insets.bottom + 12, backgroundColor: c.paper, borderTopWidth: 2, borderColor: c.line }}>
          <Button label={primaryLabel(action)} onPress={runPrimary} />
        </View>
      ) : null}

      <CardSheet visible={sheet === 'shelf'} title={copies.length ? 'Move to shelf' : 'Add this book'} onClose={() => setSheet(null)}>
        {copies.length && focus ? (
          <ShelfPicker shelves={shelves} selected={focus.shelfId}
            onSelect={(sid) => { setCopyShelf(focus.id, sid); refresh(); setSheet(null); }} onCreated={refresh} />
        ) : wishlistCopy ? (
          <View style={{ marginTop: 12 }}><Button label="Found it!" onPress={() => { setStatus(wishlistCopy.id, 'owned'); refresh(); setSheet(null); }} /></View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <Button variant="ghost" flex label="Wishlist it" onPress={() => { addUserBook(book.id, 'wishlist'); refresh(); setSheet(null); }} />
            <Button flex label="Add to shelves" onPress={() => { addUserBook(book.id, 'owned'); refresh(); setSheet(null); }} />
          </View>
        )}
      </CardSheet>

      <CardSheet visible={sheet === 'status'} title="Where are you with it?" onClose={() => setSheet(null)}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {READING_STATES.map((s) => <Chip key={s} label={READING_LABEL[s]} selected={reading?.state === s} onPress={() => changeState(s)} />)}
        </View>
      </CardSheet>

      <CardSheet visible={sheet === 'copies'} title="Your copies" onClose={() => setSheet(null)}>
        {copies.map((cp, i) => (
          <View key={cp.id} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, borderBottomWidth: 1.5, borderColor: ink.cream }}>
            <Text style={{ flex: 1, fontFamily: font.heavy, fontSize: 14, color: ink.brown }}>
              {`Copy ${i + 1} · ${cp.shelfName ?? UNSHELVED}${cp.borrower ? ` · visiting ${cp.borrower}` : ''}`}
            </Text>
            <Pressable onPress={() => removeOne(cp.id, copies.length === 1)} accessibilityRole="button" accessibilityLabel={`Remove copy ${i + 1}`}
              style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}>
              <Text style={{ fontFamily: font.heavy, fontSize: 13, color: ink.tomato, textDecorationLine: 'underline' }}>Remove</Text>
            </Pressable>
          </View>
        ))}
      </CardSheet>

      <CardSheet visible={dateSheet} title={sheet === 'finished' ? 'Finished' : 'Started'} onClose={() => setSheet(null)}>
        {dateSheet ? (
          <DateTimePicker
            value={dateValue ? isoToDate(dateValue) : isoToDate(today)}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            maximumDate={isoToDate(today)}
            minimumDate={sheet === 'finished' && reading?.startedAt ? isoToDate(reading.startedAt) : undefined}
            accessibilityLabel={`${sheet === 'finished' ? 'Finished' : 'Started'} date`}
            onChange={(e, d) => {
              if (Platform.OS !== 'ios') setSheet(null);
              if (e.type === 'set' && d) {
                setReadingDates(book.id, sheet === 'finished' ? { finishedAt: todayIso(d) } : { startedAt: todayIso(d) });
                refresh();
              }
            }}
          />
        ) : null}
      </CardSheet>

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

> **Check before writing:**
> - `PocketCard` renders `children` inside a padded View. The absolute "Edited by you" stamp positions relative to that View. If it overlaps the title badly, move it to `top: -30`.
> - `Dewey` accepts `still`.
> - `Chip` has `selected`.
> - The `Button` API (`label`, `onPress`, `variant`, `flex`) is unchanged.
>
> Also, `react-native-svg`'s `Circle` is already used elsewhere.

- [ ] **Step 2: Delete `ReadingControls`**

Run `grep -rn "ReadingControls" app src`. When the only hit is the file itself, delete `src/components/reading/ReadingControls.tsx`.

- [ ] **Step 3: Checks**

Run: `npx tsc --noEmit && npx jest`. Both pass.

- [ ] **Step 4: Manual checks (for Sean)**

1. Open a read, rated book. The card shows Shelf, Status, Rating (with its Dewey face), Started, Finished, Edition and ISBN.
2. Tap each row. Every row opens its sheet or picker.
3. Use the ⋯ menu for Edit details, Move to shelf…, and Remove from shelves. After removing, you go back and the Undo toast appears.
4. For a book with two copies, open the Copies row and remove one.
5. For a wishlist-only book, the Shelf row reads "On your wishlist" and the bottom bar says Found it!

- [ ] **Step 5: Hand-off**

Files: `app/book/[id].tsx`, and the deleted `src/components/reading/ReadingControls.tsx`.

---

### Task 4: Drag spines between shelves and onto the bin

**Files:**
- Create: `src/components/shelf/DragLayer.tsx`
- Modify: `src/components/shelf/Spine.tsx`, `src/components/shelf/Shelf.tsx`, `app/(tabs)/index.tsx`, `DESIGN.md`

**Interfaces:**
- Consumes: `dropTarget`/`DropZone` (Task 1); `useToast` (Task 1); `useRemoveCopy`, `CardSheet` (Task 2); `setCopyShelf`, `listShelves`; `ShelfPicker`; `spineStyle`.
- Produces:
  ```ts
  export function DragProvider(props: { rowsById: Map<string, LibraryRow>; onDrop: (row: LibraryRow, zone: DropZone) => void; onDraggingChange?: (dragging: boolean) => void; onEdge?: (dir: -1 | 0 | 1) => void; remeasureKey?: number; children: React.ReactNode }): JSX.Element;
  export function useDropZone(key: string, id: string | null, kind: 'shelf' | 'bin'): { ref: React.RefObject<View>; onLayout?: () => void; highlightStyle: AnimatedStyle };
  export function useDragRemeasure(): () => void;   // call after scrolling
  export function DraggableSpine(props: { rowId: string; children: React.ReactNode }): JSX.Element;
  export function useDraggingId(): string | null;
  // Spine gains: hidden?: boolean; accessibilityActions?; onAccessibilityAction?
  // Shelf gains: dropId?: string | null (the shelf id; null = Unshelved); draggable?: boolean; onBookAction?: (row, action: 'move' | 'remove') => void
  ```

> **Testing note:** gestures and measuring can't be unit-tested. The hit test (`dropTarget`) is tested in Task 1. Check with tsc, Jest and Sean's device test.

- [ ] **Step 1: `DragLayer.tsx`**

Create `src/components/shelf/DragLayer.tsx`:

```tsx
/**
 * Drag a spine to another shelf or onto the bin. Zones (shelves + bin) register their window rects;
 * a long-press Pan on each spine moves a ghost on the UI thread and hit-tests with dropTarget.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming, type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import type { LibraryRow } from '@/lib/types';
import { dropTarget, type DropZone } from '@/features/shelves/dropTarget';
import { font, ink } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';
import { Spine } from './Spine';

const HOLD_MS = 400;
const EDGE = 80;

interface Ctx {
  draggingId: string | null;
  tick: number;
  zones: SharedValue<DropZone[]>;
  target: SharedValue<string>;
  x: SharedValue<number>;
  y: SharedValue<number>;
  edge: SharedValue<number>;
  bounds: SharedValue<{ top: number; bottom: number }>;
  register: (z: DropZone) => void;
  unregister: (key: string) => void;
  begin: (rowId: string) => void;
  targetChanged: (key: string) => void;
  setEdge: (dir: number) => void;
  drop: (key: string) => void;
  cancel: () => void;
  remeasure: () => void;
}

const DragCtx = createContext<Ctx | null>(null);

export const useDraggingId = () => useContext(DragCtx)?.draggingId ?? null;
export const useDragRemeasure = () => useContext(DragCtx)?.remeasure ?? (() => {});

/** Registers a view as a drop zone; highlight is 1 while the finger is over it. */
export function useDropZone(key: string, id: string | null, kind: 'shelf' | 'bin') {
  const ctx = useContext(DragCtx);
  const ref = useRef<View>(null);
  const measure = useCallback(() => {
    if (!ctx) return;
    ref.current?.measureInWindow((x, y, width, height) => ctx.register({ key, id, kind, rect: { x, y, width, height } }));
  }, [ctx?.register, key, id, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { measure(); }, [measure, ctx?.tick]);
  useEffect(() => () => ctx?.unregister(key), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const target = ctx?.target;
  const highlight = useAnimatedStyle(() => ({ opacity: target && target.value === key ? 1 : 0 }));
  return { ref, onLayout: ctx ? measure : undefined, highlightStyle: highlight };
}

export function DraggableSpine({ rowId, children }: { rowId: string; children: React.ReactNode }) {
  const ctx = useContext(DragCtx);
  if (!ctx) return <>{children}</>;
  const { zones, target, x, y, edge, bounds, begin, targetChanged, setEdge, drop, cancel } = ctx;
  const pan = Gesture.Pan()
    .activateAfterLongPress(HOLD_MS)
    .onStart((e) => {
      x.value = e.absoluteX;
      y.value = e.absoluteY;
      target.value = '';
      runOnJS(begin)(rowId);
    })
    .onUpdate((e) => {
      x.value = e.absoluteX;
      y.value = e.absoluteY;
      const z = dropTarget({ x: e.absoluteX, y: e.absoluteY }, zones.value);
      const key = z ? z.key : '';
      if (key !== target.value) {
        target.value = key;
        runOnJS(targetChanged)(key);
      }
      const b = bounds.value;
      const dir = e.absoluteY < b.top + EDGE ? -1 : e.absoluteY > b.bottom - EDGE ? 1 : 0;
      if (dir !== edge.value) {
        edge.value = dir;
        runOnJS(setEdge)(dir);
      }
    })
    .onEnd(() => {
      runOnJS(drop)(target.value);
    })
    .onFinalize((_e, success) => {
      if (!success) runOnJS(cancel)();
    });
  return <GestureDetector gesture={pan}>{children}</GestureDetector>;
}

function Ghost({ row, x, y, origin }: { row: LibraryRow; x: SharedValue<number>; y: SharedValue<number>; origin: { x: number; y: number } }) {
  const reduced = useReducedMotion();
  const style = useAnimatedStyle(() => ({
    position: 'absolute', left: x.value - origin.x - 18, top: y.value - origin.y - 60,
    transform: reduced ? [] : [{ rotate: '-6deg' }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[style, { shadowColor: ink.brown, shadowOffset: { width: 5, height: 5 }, shadowOpacity: 1, shadowRadius: 0 }]}>
      <Spine id={row.id} title={row.book.title} />
    </Animated.View>
  );
}

function Bin({ target }: { target: SharedValue<string> }) {
  const { c } = useTheme();
  const reduced = useReducedMotion();
  const zone = useDropZone('bin', null, 'bin');
  const rise = useSharedValue(reduced ? 0 : 80);
  useEffect(() => { if (!reduced) rise.value = withSpring(0, { damping: 16 }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const style = useAnimatedStyle(() => {
    const over = target.value === 'bin';
    return {
      transform: [{ translateY: rise.value }, { scale: withTiming(over ? 1.15 : 1, { duration: 120 }) }],
      backgroundColor: over ? '#B8321D' : ink.tomato,
    };
  });
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 24, alignItems: 'center' }}>
      <Animated.View ref={zone.ref} onLayout={zone.onLayout} accessibilityElementsHidden
        style={[{ width: 140, height: 64, borderRadius: 16, borderWidth: 2.5, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }, style]}>
        <Text style={{ fontFamily: font.black, fontSize: 15, color: ink.white }}>🗑 Remove</Text>
      </Animated.View>
    </View>
  );
}

export function DragProvider({ rowsById, onDrop, onDraggingChange, onEdge, remeasureKey, children }: {
  rowsById: Map<string, LibraryRow>;
  /** Bump after the bookcase scrolls so zones re-measure. */
  remeasureKey?: number;
  onDrop: (row: LibraryRow, zone: DropZone) => void;
  onDraggingChange?: (dragging: boolean) => void;
  onEdge?: (dir: -1 | 0 | 1) => void;
  children: React.ReactNode;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const dragging = useRef<string | null>(null);
  const zoneMap = useRef(new Map<string, DropZone>());
  const root = useRef<View>(null);
  const zones = useSharedValue<DropZone[]>([]);
  const target = useSharedValue('');
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const edge = useSharedValue(0);
  const bounds = useSharedValue({ top: 0, bottom: 0 });

  const register = useCallback((z: DropZone) => {
    zoneMap.current.set(z.key, z);
    zones.value = [...zoneMap.current.values()];
  }, [zones]);
  const unregister = useCallback((key: string) => {
    zoneMap.current.delete(key);
    zones.value = [...zoneMap.current.values()];
  }, [zones]);
  const remeasure = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => { remeasure(); }, [remeasureKey, remeasure]);

  const finish = useCallback(() => {
    dragging.current = null;
    setDraggingId(null);
    target.value = '';
    edge.value = 0;
    onEdge?.(0);
    onDraggingChange?.(false);
  }, [edge, onDraggingChange, onEdge, target]);

  const begin = useCallback((rowId: string) => {
    dragging.current = rowId;
    setDraggingId(rowId);
    onDraggingChange?.(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    remeasure();
  }, [onDraggingChange, remeasure]);

  const targetChanged = useCallback((key: string) => { if (key) Haptics.selectionAsync(); }, []);
  const setEdge = useCallback((dir: number) => onEdge?.(dir as -1 | 0 | 1), [onEdge]);

  const drop = useCallback((key: string) => {
    const row = dragging.current ? rowsById.get(dragging.current) : undefined;
    const zone = key ? zoneMap.current.get(key) : undefined;
    finish();
    if (!row || !zone) return;
    if (zone.kind === 'shelf' && zone.id === (row.shelfId ?? null)) return;
    onDrop(row, zone);
  }, [finish, onDrop, rowsById]);

  const cancel = useCallback(() => { if (dragging.current) finish(); }, [finish]);

  const measureRoot = useCallback(() => {
    root.current?.measureInWindow((rx, ry, _w, h) => {
      setOrigin({ x: rx, y: ry });
      bounds.value = { top: ry, bottom: ry + h };
    });
  }, [bounds]);

  const value = useMemo<Ctx>(() => ({
    draggingId, tick, zones, target, x, y, edge, bounds, register, unregister, begin, targetChanged, setEdge, drop, cancel, remeasure,
  }), [draggingId, tick, zones, target, x, y, edge, bounds, register, unregister, begin, targetChanged, setEdge, drop, cancel, remeasure]);

  const row = draggingId ? rowsById.get(draggingId) : undefined;
  return (
    <View ref={root} onLayout={measureRoot} style={{ flex: 1 }}>
      <DragCtx.Provider value={value}>
        {children}
        {row ? (
          <>
            <Bin target={target} />
            <Ghost row={row} x={x} y={y} origin={origin} />
          </>
        ) : null}
      </DragCtx.Provider>
    </View>
  );
}
```

> **Notes for the implementer:**
> - `#B8321D` is the one allowed literal: the darker "over the bin" state of `ink.tomato`.
> - `useDropZone` returns `highlightStyle` (an animated style) rather than a raw shared value. Update the Produces signature in your report to match.
> - `DraggableSpine` returns early before creating the gesture when there's no context. That's not a hook, so it's fine. But `Gesture.Pan()` is re-created every render; wrap it in `useMemo` keyed on `rowId` and the stable callbacks if you see jank.
> - If `runOnJS` errors in Reanimated 4, use `scheduleOnRN` from `react-native-worklets` and report it.

- [ ] **Step 2: Spine and Shelf**

`src/components/shelf/Spine.tsx`:
1. Add props `hidden?: boolean; accessibilityActions?: { name: string; label: string }[]; onAccessibilityAction?: (e: { nativeEvent: { actionName: string } }) => void`.
2. Pass them to the `Pressable`: `accessibilityActions={accessibilityActions}` and `onAccessibilityAction={onAccessibilityAction}`.
3. When `hidden`, give the outer `Animated.View` `opacity: 0`. This keeps the gap on the shelf.

`src/components/shelf/Shelf.tsx`:
1. Add props `dropId?: string | null; draggable?: boolean; onBookAction?: (row: LibraryRow, action: 'move' | 'remove') => void`.
2. Import `DraggableSpine`, `useDraggingId`, `useDropZone` from `./DragLayer`, and `Animated` from Reanimated.
3. In the component:

```tsx
  const zone = useDropZone(`shelf:${dropId ?? 'unshelved'}`, dropId ?? null, 'shelf');
  const draggingId = useDraggingId();
```

4. Put `ref={draggable ? zone.ref : undefined}` and `onLayout={draggable ? zone.onLayout : undefined}` on the root `View`. As the first child of the root View, add the drop highlight:

```tsx
      {draggable ? (
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 4, right: 4, top: 2, bottom: 2, borderWidth: 3, borderStyle: 'dashed', borderColor: c.line, borderRadius: 8, backgroundColor: '#F4B41A33' }, zone.highlightStyle]} />
      ) : null}
```

(`'#F4B41A33'` is `ink.bus` at 20% alpha. If the reviewer objects, use `ink.bus` with `opacity: 0.2` on an inner View instead.)

5. Change `renderItem` to:

```tsx
        renderItem={({ item: r, index: i }) => {
          const spine = (
            <Spine id={r.id} title={r.book.title} onPress={() => onPressBook(r)} lean={i === rows.length - 1 && rows.length >= 4 ? -10 : 0}
              hidden={draggingId === r.id}
              accessibilityActions={onBookAction ? [{ name: 'move', label: 'Move to shelf…' }, { name: 'remove', label: 'Remove from shelves' }] : undefined}
              onAccessibilityAction={onBookAction ? (e) => onBookAction(r, e.nativeEvent.actionName === 'remove' ? 'remove' : 'move') : undefined} />
          );
          return draggable ? <DraggableSpine rowId={r.id}>{spine}</DraggableSpine> : spine;
        }}
```

6. Add `extraData={draggingId}` to the FlatList so the hidden spine re-renders.

- [ ] **Step 3: Shelves screen**

In `app/(tabs)/index.tsx`:
1. Imports:

```tsx
import { useEffect, useRef } from 'react';            // merge into the existing React import
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';  // merge
import { setCopyShelf } from '@/db/repository';           // merge
import { invalidateLibrary } from '@/lib/invalidateLibrary';
import { useToast } from '@/stores/toast';
import { useRemoveCopy } from '@/features/shelves/useRemoveCopy';
import { UNSHELVED } from '@/features/shelves/shelfRules'; // merge
import { DragProvider } from '@/components/shelf/DragLayer';
import { CardSheet } from '@/components/ui/CardSheet';
import { ShelfPicker } from '@/components/shelves/ShelfPicker';
import type { LibraryRow } from '@/lib/types';
```

2. Inside the component, after the existing queries (all before any conditional return):

```tsx
  const qc = useQueryClient();
  const showToast = useToast((s) => s.show);
  const removeCopy = useRemoveCopy();
  const scroll = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [edgeDir, setEdgeDir] = useState<-1 | 0 | 1>(0);
  const [tick, setTick] = useState(0);
  const [moveRow, setMoveRow] = useState<LibraryRow | null>(null);
  const rowsById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  const moveTo = (row: LibraryRow, shelfId: string | null) => {
    setCopyShelf(row.id, shelfId);
    invalidateLibrary(qc);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast(`Moved to ${shelves.find((s) => s.id === shelfId)?.name ?? UNSHELVED}.`);
  };

  // Auto-scroll while a dragged spine sits near the top/bottom edge.
  useEffect(() => {
    if (!dragging || edgeDir === 0) return;
    const t = setInterval(() => {
      scrollY.current = Math.max(0, scrollY.current + edgeDir * 12);
      scroll.current?.scrollTo({ y: scrollY.current, animated: false });
      setTick((n) => n + 1);
    }, 16);
    return () => clearInterval(t);
  }, [dragging, edgeDir]);
```

3. Wrap the `ScrollView` in the provider (inside the `SafeAreaView`), and give the ScrollView the ref, scroll tracking and lock:

```tsx
      <DragProvider
        remeasureKey={tick}
        rowsById={rowsById}
        onDraggingChange={setDragging}
        onEdge={setEdgeDir}
        onDrop={(row, zone) => (zone.kind === 'bin' ? removeCopy(row.id) : moveTo(row, zone.id))}
      >
        <ScrollView ref={scroll} scrollEnabled={!dragging} scrollEventThrottle={32}
          onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }}
          onMomentumScrollEnd={() => setTick((n) => n + 1)}
          onScrollEndDrag={() => setTick((n) => n + 1)}
          contentContainerStyle={{ paddingBottom: 110 }}>
          …existing content…
        </ScrollView>
      </DragProvider>
```

> Zones re-measure through `remeasureKey`: every auto-scroll step and every scroll end bumps `tick`, which makes each `useDropZone` re-measure.

4. On each `Shelf` in `rooms.map(…)`, pass `draggable dropId={room.shelf?.id ?? null} onBookAction={(r, a) => (a === 'remove' ? removeCopy(r.id) : setMoveRow(r))}`. Leave the empty-library "Reserved" shelf non-draggable.

5. After the `ScrollView` (still inside the provider), add the VoiceOver move sheet:

```tsx
        <CardSheet visible={!!moveRow} title="Move to shelf" onClose={() => setMoveRow(null)}>
          {moveRow ? (
            <ShelfPicker shelves={shelves} selected={moveRow.shelfId}
              onSelect={(sid) => { moveTo(moveRow, sid); setMoveRow(null); }} onCreated={() => invalidateLibrary(qc)} />
          ) : null}
        </CardSheet>
```

- [ ] **Step 4: DESIGN.md**

Append this paragraph to the `### Shelves` section:

```markdown
**Drag and trash.** Hold a spine (~0.4s, Medium haptic) to lift it: a tilted ghost follows your finger, the shelf underneath gets a dashed highlight (selection haptic on each change), and a red "🗑 Remove" bin rises from the bottom; near the top/bottom edge the bookcase scrolls. Drop on another shelf (or Unshelved) to move it ("Moved to ⟨Shelf⟩.", Success haptic); drop on the bin to remove that copy ("Removed from your shelves." with Undo for 5s, Heavy haptic) — readings and ratings stay. Lent-out copies ask "It's visiting ⟨Name⟩. Remove anyway?" and Undo reopens the loan. VoiceOver: each spine offers "Move to shelf…" and "Remove from shelves". Reduce motion drops the tilt and springs; haptics stay.

**Book detail — library card.** Back and ⋯ on top, cover + title + author, then one pocket card of tap-to-change rows (Shelf, Status, Rating, Started, Finished, Copies, On loan, Edition, ISBN — each only when it applies), a "Missing details" nudge for placeholder books, and a sticky next-step button (Found it! · Start reading · Finished it · Mark as read · Nudge ⟨name⟩). ⋯ holds Edit details, Move to shelf…, and Remove from shelves.
```

- [ ] **Step 5: Checks**

Run: `npx tsc --noEmit && npx jest && npx expo-doctor`. All pass.

- [ ] **Step 6: Manual checks (for Sean)**

1. Hold a spine: it lifts and the bin appears.
2. Drag it to another shelf, including one off screen via auto-scroll: "Moved to …".
3. Drop it on the bin, then Undo.
4. Drop it back on its own shelf: nothing happens.
5. A quick tap still opens the book, and shelves still scroll sideways.
6. VoiceOver: "Move to shelf…" and "Remove from shelves".
7. Turn on Reduce Motion and repeat a drag.

- [ ] **Step 7: Hand-off**

Files: those listed.

---

## Spec coverage check

| Spec section | Task |
|---|---|
| §2.1 interaction: hold, ghost, bin, highlight, haptics, auto-scroll, drops, reduce motion, draggable scope | 4, with `dropTarget` in 1 |
| §2.2 VoiceOver actions | 4 |
| §2.3 structure (`dropTarget`, DragLayer, Shelf/Spine, no new dependencies) | 1, 4 |
| §3 library-card detail (layout, rows, CardSheet, ⋯ menu, sticky button) | 1 (`cardRows`), 2 (`CardSheet`), 3 |
| §4 remove + Undo (soft delete, loan confirm/close/reopen, root toast, replacement, invalidation) | 1 (store), 2 |
| §5 tests | 1, plus the manual steps in 3 and 4 |

**Deviations:**
- The spec's `showUndo(message, onUndo)` became a general `useToast().show(message, onUndo?)`, so "Moved to ⟨Shelf⟩." shares the same toast.
- Spec §2.3's `registerZone`/`unregisterZone` become the `useDropZone` hook.
