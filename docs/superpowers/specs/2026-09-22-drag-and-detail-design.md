# Drag Books, Trash and Library-Card Detail — Design Spec

**Date:** 2026-09-22 · **Status:** approved by Sean in brainstorming; awaiting spec review
**Mockups:** `.superpowers/brainstorm/6332-1790014438/content/` (`drag-modes.html` option A, `detail-layouts.html` option C)
**Builds on:** Shelf creation (shelves are places; `setCopyShelf`, `removeCopy` exist).
**Out of scope:** reordering books within a shelf; a Trash screen, or recovery after the Undo window; moving several books at once.

## 1. Goal

1. **Drag books between shelves** on the bookcase by holding a spine.
2. **Remove a book** by dropping it on a trash bin, with Undo.
3. **Tidy book detail** into a single library card of tap-to-change rows.

## 2. Drag and drop on the bookcase

### 2.1 Interaction
- **Pick up:** hold a spine for about 400ms (gesture-handler long press). A **Medium** haptic plays.
  - The spine's slot on the shelf becomes an empty gap.
  - A floating **ghost spine** (same look, tilted -6°, 5pt hard shadow) follows the finger on an overlay layer above the ScrollView.
  - A red trash bin labelled **"🗑 Remove"** slides up at the bottom of the screen.
- **A quick tap still opens the book.** Shelves still scroll sideways and the bookcase still scrolls vertically; only a long press starts a drag.
- **While dragging:**
  - the shelf under the finger gets a dashed outline and a light yellow tint, with a **Light** haptic each time the target changes;
  - the bin scales up and darkens while the finger is over it;
  - within 80pt of the top or bottom edge, the bookcase auto-scrolls and drop zones are re-measured.
- **Drop:**
  - **On a different shelf, including Unshelved:** `setCopyShelf(copyId, shelfId | null)`, a **Success** haptic, and the toast "Moved to ⟨Shelf⟩."
  - **On the bin:** removes the copy (§4), with a **Heavy** haptic and the toast "Removed from your shelves." with an **Undo** button (5s).
  - **Anywhere else, or on its own shelf:** the ghost springs back and nothing changes.
- **Reduce motion:** no tilt, spring or bin slide; the ghost tracks the finger and the bin simply appears. Haptics still play.
- **What can be dragged:** only spines of At home copies on the bookcase. The Currently reading strip and the Wishlist tab don't drag. Books keep their order within a shelf.

### 2.2 Accessibility
Each bookcase spine exposes the VoiceOver actions:
- **"Move to shelf…"**: opens a CardSheet with the ShelfPicker.
- **"Remove from shelves"**: the same as dropping on the bin, including Undo.

### 2.3 Structure
- **`src/features/shelves/dropTarget.ts`** (pure, tested): `dropTarget(point, zones)`.
  - `zones` = `{ id: string | null /* shelf id; null = Unshelved */, kind: 'shelf' | 'bin', rect: { x, y, width, height } }[]`.
  - Returns the zone containing the point. The bin takes priority when zones overlap, and a point in a gap between zones returns null.
- **`src/components/shelf/DragLayer.tsx`**: an overlay and context that owns the drag state (the ghost, the current target and the bin), plus `registerZone` / `unregisterZone`, measured with `measureInWindow` on layout and after scroll.
- **Changes:** `Shelf` registers its zone and passes a long-press gesture to each `Spine`. `Bookcase` / `app/(tabs)/index.tsx` host the DragLayer and the auto-scroll.
- **Dependencies:** none new (react-native-gesture-handler and Reanimated are already present).

## 3. Book detail as a single library card

### 3.1 Layout
- **Top bar:** back on the left, **⋯** on the right.
- **Header:** the tilted cover beside the title and author.
- **Removed:** the shelf-spot strip of neighbour spines, the status pills, ReadingControls, the pocket card and the Move shelf button. The card replaces all of them.
- **The library card:** one PocketCard with a red top rule, made of **tap-to-change rows** that each end in "›".
- **Below the card:** the **"Missing details"** nudge (placeholder books only).
- **"Edited by you"** becomes a small stamp on the card.
- **Sticky bottom bar:** one primary button from `primaryAction` (Found it! · Start reading · Finished it · Mark as read · Nudge ⟨name⟩), hidden when there is no next step.

### 3.2 Rows (pure `cardRows(detail, today)`, tested; rows appear only when they apply)

| Row | Value | Tap |
|---|---|---|
| Shelf | the shelf name / "Unshelved" / "On your wishlist" / "Not on your shelves" | A CardSheet with the ShelfPicker (moves the focus copy). When not owned, the sheet shows **Add to shelves** / **Wishlist it** instead. |
| Status | reading label, or "Not started" | A CardSheet with the four reading chips. Tapping the selected chip clears it (with a confirmation if rated). Choosing Read then opens the RatingSheet. |
| Rating | read/dnf only: a still Dewey face + label, or "Rate it" | The RatingSheet |
| Started | only when set, or when the state is reading/read/dnf ("Add date" if empty) | The date picker |
| Finished | read/dnf only | The date picker (min = started) |
| Copies | only with 2+ copies: "2 · Study, Bedroom" | A CardSheet listing the copies, each with its shelf, loan, **Move** and **Remove** |
| On loan | only if a copy is lent: "⟨Name⟩ · N days" | Share the nudge |
| Edition | publisher, year | Edit details |
| ISBN | isbn13 or "—" | none (display only) |

- Each row is a 44pt Pressable, labelled "⟨Row⟩: ⟨value⟩" with the hint "Double-tap to change". ISBN has no hint.
- **`CardSheet`** (`src/components/ui/CardSheet.tsx`): a transparent Modal bottom sheet with a title and children, closed by the backdrop or "Done". It is shared by the Shelf, Status and Copies sheets.

### 3.3 ⋯ menu
- **Edit details**
- **Move to shelf…** (only with exactly one copy)
- **Remove from shelves** (red; hidden when there are no copies). With one copy it removes it (§4) and goes back, then shows the Undo toast on the previous screen. With several copies it opens the Copies sheet.

## 4. Removing a copy, and Undo

- **Remove** = `removeCopy(id)` (soft delete, queued sync). Readings and ratings are untouched.
- **Lent-out copy:** first confirm "It's visiting ⟨Name⟩. Remove anyway?". On confirm, the open loan's `returned_at` is set to now, and that is queued.
- **New `restoreCopy(id, reopenLoanId?)`:** clears `deleted_at` on the copy (same id, shelf and dates), and if a loan was closed by the removal, clears that loan's `returned_at`. Both are queued.
- **Undo toast:** `src/components/ui/UndoToast.tsx`, with text plus an Undo button, 5s, hosted at app root level so it survives navigating back from detail.
  - A module-level `showUndo(message, onUndo)` store (zustand, which is already a dependency) drives it.
  - A new removal replaces a pending Undo, and the earlier removal stays done.
- **After removing the last copy:** a book with a reading shows under Reading / Read as not owned, and Store Mode says "You've read this" (existing behaviour).
- **Invalidation:** `invalidateLibrary` after every move, remove and undo.

## 5. Testing

- **Unit (Jest):**
  - `dropTarget`: inside a shelf, inside the bin, bin priority on overlap, gaps → null, the Unshelved zone (`id: null`);
  - `cardRows`: owned single copy; owned several copies; wishlist only; not owned with a reading; read with rating (Rating/Finished present); want (no dates); on loan; placeholder book;
  - the undo store: a new `showUndo` replaces the pending one, the timeout clears it, Undo calls back once.
- **Manual (iPhone, Expo Go SDK 57):**
  1. Hold and drag a book to another shelf, including auto-scrolling to an off-screen shelf.
  2. Drop on the bin, then Undo.
  3. Drop on its own shelf: nothing happens.
  4. A quick tap still opens the book; shelves still scroll sideways.
  5. VoiceOver "Move to shelf…" and "Remove from shelves".
  6. Every library-card row, and the ⋯ menu.
  7. Remove on a book with two copies; remove a lent-out copy (confirm, then Undo reopens the loan).
  8. Reduce Motion is on.
