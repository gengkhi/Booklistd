# Bookshelf Redesign — Design Spec

**Date:** 2026-09-18 · **Status:** approved by Sean (mockups in `.impeccable/mocks/screens/index.html`)
**Direction:** Book Fair Saturday → Painted Bookcase, with handwritten shelf notes and a Lamplight dark mode.
**Replaces:** the "Reading nook at golden hour" world (cream + Fraunces + clay). Product truth in PRODUCT.md is unchanged.

## 1. Goal

Make My Library cozy, distinctive, usable and quietly funny. The library *is* a bookcase: every book is a spine on a shelf, every shelf is a room. Wit comes from four places: Dewey (a small bookworm with glasses), library ephemera (pocket cards, stamps, tape notes), tactile motion, and dry copy. The Store Mode verdict stays the fastest, clearest moment in the app.

## 2. Visual system

**Inks (fixed set — no tints, no gradients; extra tone = halftone dots):**

| Token | Light | Lamplight | Use |
|---|---|---|---|
| paper | #FBFAF4 | #2E2016 | screen ground |
| case | #F3E9D2 | #1F140D | bookcase back panel |
| ink | #2B1D14 | #FFF4E0 (text) / #120B06 (lines) | text, every outline, hard shadows |
| soft | #6B5646 | #D9C3A0 | secondary text |
| tomato | #E2462B | same | stamps, pocket-card rule, verdict emphasis |
| bus | #F4B41A | same | **primary action only** (Scan, Add, Keep scanning) + lamp light |
| pool | #2F6FB0 | same | spines, planks |
| grass | #3E9A5A | same | "You own this!" sheet, Dewey, read status |
| plum | #7B3F6E | same | spines, wishlist stamps |
| tape | #F7E7B4 | same | handwritten notes, loan callouts |
| white | #FFFFFF | #FFFFFF | cards, bubbles, inputs |
| oak | — | #A2622F | Lamplight bookcase frame |

**Type:** Bagel Fat One (display: screen titles, verdicts, cover titles) · Figtree 600–900 (all UI) · Gochi Hand (tape notes and asides only, never controls). Replaces Fraunces + Nunito.

**Shape & depth:** 2–2.5px ink outline on every shape. Depth = hard offset shadow `3px 3px 0 ink` (4px on the bookcase). No soft shadows, no blur. Radii: spines 3, cards 8–14, buttons 14, sheets 26, chips/pills full.

**Grid:** 4pt spacing, 16–20px screen gutters, touch targets ≥44pt.

**Signature components**
- **Spine** — outlined rectangle, height/width/color/pattern (plain, band, dots) derived deterministically from the book id; vertical title (Figtree 900, 10.5). Optional lean. Tappable.
- **Shelf** — row of spines standing on a colored plank; room tag pill (top-left) + optional tape note (Gochi Hand, rotated −2°).
- **Bookcase** — outlined panel holding shelves; one prop per case (a potted plant at the end of the first shelf).
- **Pocket card** — white card, tomato top rule, dotted-leader rows (replaces stat grids).
- **Stamp** — tomato outlined Bagel text, rotated −9°; variants: ALREADY YOURS, ON LOAN, WANTED SINCE …
- **Sticker** — yellow circle with outline + hard shadow (NEW!, counts).
- **Dewey** — SVG bookworm; moods: happy, smug, gasp, sleep. Speech bubble: white, outline, hard shadow.
- **Button** — primary (bus) / ghost (white); press sinks into the shadow.

## 3. Screens

1. **Shelves (home, `app/(tabs)/index.tsx`)** — greeting, "My Library", sub line (count · shelves · visiting friends). A bookcase with one shelf per room (grouped by `user_books.location`; empty → "Unshelved"). Each shelf scrolls horizontally when its spines overflow (a dedicated room view is a later phase). Dewey sits on one shelf with a data-driven line. Empty library: an empty "Reserved" shelf, Dewey saying "An empty shelf. I've reserved it for you.", primary "Scan your first book".
2. **Store Mode (`app/(tabs)/scan.tsx`)** — full-screen camera, yellow corner viewfinder, sweeping scan line, "STORE MODE · N SCANNED" pill, close button. Verdict sheet:
   - *Owned:* grass sheet, "You own this!", mini card (cover, title, author/edition, dotted rows: copies + per-room counts), ALREADY YOURS stamp, edition note ("Same edition you scanned" / "Different edition — you own N of this title"), primary "Keep scanning", link "Add copy #N+1 anyway".
   - *New find:* paper sheet, "A new find!", mini card + NEW! sticker, room chips ("Shelve it in"), ghost "Wishlist it" + primary "Add to shelves", loading state "Dewey is looking it up…".
   - Camera permission screen in the same world.
3. **Book detail (`app/book/[id].tsx`)** — back/more buttons, mini shelf with a dashed "HERE" gap + tape note "Room — its spot", pulled cover (tilted, hard shadow), title/author, status chips, pocket card listing every copy (edition · room or "Visiting {name}"), ISBN row, loan callout when a copy is loaned, actions "Move shelf" / primary contextual.
4. **Search (`app/(tabs)/search.tsx`)** — outlined field with hard shadow, Gochi aside, sections "On your shelves · N" (local LIKE on title/author/isbn) then "From the catalog" — only when the query is a valid ISBN (existing `lookupIsbn`), with "+ Add". Free-text catalog search is out of scope (no API exists yet); the section is simply absent for non-ISBN queries.
5. **Wishlist (`app/(tabs)/wishlist.tsx`)** — "27 books you'll "definitely" read", the Someday shelf (plum plank), Dewey, "Wanted the longest" slips with WANTED SINCE stamp and "Found it!" (moves to owned).
6. **Profile (`app/(tabs)/profile.tsx`)** — restyled library card (pocket card), Lamplight toggle (System / Light / Lamplight), "Quiet librarian" toggle (Dewey stops talking).
7. **Tab bar** — Shelves · Search · [Scan] · Wishlist · Profile; Scan is the raised yellow sticker button.

## 4. Motion

Library: Reanimated 4 (UI thread; press handling via Pressable), expo-haptics. Tokens: feedback 120ms, routine 220ms, overlay 450ms, focal 600ms; ease-out `(0.16,1,0.3,1)`; exits ~65% of entrances; no bounce except Dewey's pop and the sticker slap (named springs).

- **Focal — verdict:** scan line roams → locks on read (viewfinder squeezes 0.95) → sheet springs up (450ms) → owned: stamp slams (scale 2.4→1, rotate −22°→−9°, 420ms) + card shake + heavy haptic; new: sticker slaps (380ms spring) → Dewey pops (520ms) → bubble in (260ms).
- **Continuity:** tapping a spine lifts it (translateY −8) then pushes Book detail; the cover animates in from above ("pulled off the shelf"). Adding a book: in Store Mode the sheet slides away and a toast drops in ("Shelved in Living room. Book #413.").
- **Feedback:** buttons/chips sink into shadow (120ms); spines lift on press (the last spine on a full shelf leans); Dewey bubble swaps with a scale-in; tab switch is instant (native).
- **Idle (rare):** Lamplight Dewey sleeps with a drifting "z".
- **Reduced motion:** stamp/sticker appear without scale, no Dewey pop or shake, scan line static; verdict, color and haptics remain.

## 5. Dewey rules (the wit contract)

- Lines are **data-driven and true**: built from the user's real counts, duplicates, loans, wishlist age. Never invent facts.
- Dry, adult, affectionate; roasts the *library*, never the user's taste or worth. No emoji.
- Never speaks on errors, permission prompts, or destructive confirmations — those use plain librarian copy that names the problem and the fix.
- One line per screen, max ~70 characters. Tap Dewey to rotate lines.
- "Quiet librarian" setting hides bubbles and tape-note jokes (room tags stay).
- Lines live in one module (`src/features/dewey/lines.ts`) as pure functions of a context object → unit-tested.

## 6. Architecture

- `src/theme/palette.ts` — `ink`, `palettes.light/lamp`, `font`, `radius`, `space`; `src/theme/motion.ts` — durations, easing, springs. Hard shadows are drawn by a `Raised` layer (Android elevation cannot do hard offsets).
- `src/theme/useTheme.ts` — resolves System/Light/Lamplight (Zustand `useSettings`, persisted with AsyncStorage) via pure `resolveScheme()`.
- `src/components/ui/` — `Button`, `Chip`, `PocketCard` (+ `LeaderRow`), `Stamp`, `Sticker`, `TapeNote`, `Bubble`, `ScreenHeader`.
- `src/components/shelf/` — `Spine` (+ `spineStyle(bookId,title)` pure), `Shelf`, `Bookcase`, `Plant`, `CoverArt` (flat illustrated fallback when no coverUrl).
- `src/components/dewey/Dewey.tsx` — SVG, `mood` prop, optional pop animation.
- `src/features/dewey/lines.ts` — pure line builders; `useDeweyLine(context)`.
- `src/features/shelves/groupByRoom.ts` — pure grouping/sorting.
- `src/features/scanner/VerdictSheet.tsx`, `ScanViewfinder.tsx` — Store Mode UI; `useScanPipeline` unchanged except exposing `lock` timing.
- Repository additions: `searchLibrary(q)`, `listCopiesOfBook(bookId)` (with active loan borrower), `setStatus(userBookId, status)`, `listRooms()`.
- Dependencies: `react-native-svg`, `react-native-reanimated`, `react-native-worklets`, `@expo-google-fonts/bagel-fat-one`, `@expo-google-fonts/figtree`, `@expo-google-fonts/gochi-hand`; remove Fraunces/Nunito. Dev: `jest`, `jest-expo`, `@types/jest`. Theme lives in new files (`palette.ts`, `motion.ts`, `useTheme.ts`); the old `tokens.ts` and `BookCover` are deleted once every screen has moved over.

## 7. Error & edge states

- No camera permission: explainer + "Allow camera"; denied permanently → "Open Settings".
- Lookup offline/failed on a new find: sheet shows ISBN, "Couldn't reach the catalog — you can still add it by ISBN" + Add anyway.
- Work match (different edition): owned sheet, stamp stays ALREADY YOURS; the edition note carries the nuance ("Different edition — you own N of this title").
- Very long titles: spine truncates, detail wraps; Dynamic Type up to XXL without clipping controls.
- 0 books, 1 room, 30+ rooms (vertical scroll of shelves), 500+ books in a room (horizontal virtualized shelf).

## 8. Testing & verification

- Unit (jest-expo): `spineStyle` determinism, `groupByRoom`, Dewey line builders (true facts, length cap, quiet mode), theme resolution.
- `npm run typecheck` clean.
- Manual on device via Expo Go (iOS + Android): every screen light + Lamplight, reduced motion on, largest text size, scan an owned / new / different-edition ISBN.
- Impeccable finish: native platform, no detector; finish reviewer with screenshots, then documenter rewrites DESIGN.md + `.impeccable/design.json`.

## 9. Out of scope (this build)

Free-text catalog search, room management UI (create/rename/reorder rooms), drag-to-reshelve, lending flow UI beyond display + "Nudge", CSV import, sync changes, onboarding.
