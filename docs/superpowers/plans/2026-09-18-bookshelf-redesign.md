# Bookshelf Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Reading nook" look with the approved Painted Bookcase world (Book Fair Saturday + Dewey + Lamplight) across every screen, including the animated Store Mode verdict.

**Architecture:** New theme files (`palette.ts`, `motion.ts`, `useTheme.ts`) sit beside the old `tokens.ts` so the app compiles at every step; screens move over one task at a time and the old tokens are deleted last. Pure logic (spine looks, room grouping, Dewey's lines, theme resolution) lives in dependency-free modules with Jest tests; components are thin and verified by typecheck plus on-device checks. The repository gains a few read/update queries; the schema does not change.

**Tech Stack:** Expo SDK 54, React Native 0.81, Expo Router 6, react-native-reanimated 4 (+ react-native-worklets), react-native-svg, expo-haptics, TanStack Query, Zustand (persist + AsyncStorage), expo-sqlite, Jest via jest-expo.

**Spec:** `docs/superpowers/specs/2026-09-18-bookshelf-redesign-design.md` · Mockups: `.impeccable/mocks/screens/index.html` · Direction contract: `.impeccable/surfaces/app-tabs-index-tsx.md`

## Global Constraints

- Inks only: paper `#FBFAF4`, case `#F3E9D2`, ink `#2B1D14`, soft `#6B5646`, tomato `#E2462B`, bus `#F4B41A`, pool `#2F6FB0`, grass `#3E9A5A`, plum `#7B3F6E`, tape `#F7E7B4`, white `#FFFFFF`; Lamplight paper `#2E2016`, case `#1F140D`, text `#FFF4E0`, soft `#D9C3A0`, lines `#120B06`, oak frame `#A2622F`, room tags `#E3B55B`. No tints, no gradients.
- Yellow (`bus`) is only for the primary action.
- Fonts: Bagel Fat One (display), Figtree 600–900 (UI), Gochi Hand (tape notes/asides only).
- Every shape: 2–2.5px outline; depth only via hard offset shadow (3px; 4px bookcase) drawn by `Raised`.
- Touch targets ≥ 44pt. Text on paper ≥ 4.5:1.
- Motion: feedback 120ms, routine 220ms, overlay 450ms, focal 600ms; ease-out `bezier(0.16,1,0.3,1)`; respect reduced motion (`useReducedMotion`).
- Dewey lines: true, data-driven, ≤ 70 characters, never on errors or permission prompts; hidden when "Quiet librarian" is on.
- Store Mode ownership check stays synchronous and offline (`checkOwnership` unchanged).
- Imports use the `@/` alias (maps to `src/`).

## File map

| File | Responsibility |
|---|---|
| `src/theme/palette.ts` | inks, light/lamp palettes, fonts, radii, spacing |
| `src/theme/motion.ts` | durations, easing, springs |
| `src/theme/resolveScheme.ts` | pure: preference + system → `light`/`lamp` |
| `src/theme/useTheme.ts` | hook returning `{ scheme, c }` |
| `src/stores/settings.ts` | persisted theme + quiet preferences |
| `src/features/shelves/spineStyle.ts` | pure: deterministic spine look per book |
| `src/features/shelves/groupByRoom.ts` | pure: rooms from library rows, most-copied book |
| `src/features/dewey/lines.ts` | pure: every Dewey line and tape note |
| `src/lib/dates.ts` | pure: greeting + "wanted since" formatting |
| `src/db/repository.ts` | + `searchLibrary`, `listCopiesOfBook`, `setStatus`, `setLocation`, `listRooms`, stats `activeLoans` |
| `src/components/ui/*` | Raised, Button, Chip, PocketCard/LeaderRow, Stamp, Sticker, TapeNote, Bubble, ScreenHeader, Toast |
| `src/components/shelf/*` | Spine, Shelf, Bookcase, Plant, CoverArt |
| `src/components/dewey/Dewey.tsx` | Dewey SVG + moods + pop |
| `src/features/scanner/ScanViewfinder.tsx`, `VerdictSheet.tsx` | Store Mode UI |
| `app/**` | screens rewritten onto the new system |

---

### Task 1: Tooling, theme and settings

**Files:**
- Modify: `package.json` (deps + `test` script + jest preset)
- Create: `src/theme/palette.ts`, `src/theme/motion.ts`, `src/theme/resolveScheme.ts`, `src/theme/useTheme.ts`, `src/stores/settings.ts`
- Modify: `app/_layout.tsx` (load new fonts, themed status bar/background)
- Test: `src/theme/__tests__/resolveScheme.test.ts`

**Interfaces:**
- Produces: `ink`, `palettes`, `Palette`, `Scheme`, `font`, `radius`, `space` (palette.ts); `motion`, `easeOut`, `popSpring` (motion.ts); `resolveScheme(pref, system)`, `ThemePref` (resolveScheme.ts); `useTheme(): { scheme: Scheme; c: Palette }`; `useSettings` with `theme`, `quiet`, `setTheme`, `setQuiet`.

- [ ] **Step 1: Initialize git (first run only) and install dependencies**

```bash
git init && git add -A && git commit -m "chore: snapshot before bookshelf redesign"
npm install
npx expo install react-native-svg react-native-reanimated react-native-worklets @expo-google-fonts/bagel-fat-one @expo-google-fonts/figtree @expo-google-fonts/gochi-hand
npx expo install -- --save-dev jest-expo jest @types/jest
```

Then add to `package.json`: under `"scripts"` → `"test": "jest"`; top level → `"jest": { "preset": "jest-expo", "moduleNameMapper": { "^@/(.*)$": "<rootDir>/src/$1" } }` (Jest does not read tsconfig paths).

- [ ] **Step 2: Write the failing test** — `src/theme/__tests__/resolveScheme.test.ts`

```ts
import { resolveScheme } from '../resolveScheme';

describe('resolveScheme', () => {
  it('honours an explicit preference', () => {
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme('lamp', 'light')).toBe('lamp');
  });
  it('follows the system when set to system', () => {
    expect(resolveScheme('system', 'dark')).toBe('lamp');
    expect(resolveScheme('system', 'light')).toBe('light');
    expect(resolveScheme('system', null)).toBe('light');
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npx jest src/theme` — Expected: FAIL, `Cannot find module '../resolveScheme'`.

- [ ] **Step 4: Implement theme files**

`src/theme/resolveScheme.ts`
```ts
import type { Scheme } from './palette';

export type ThemePref = 'system' | 'light' | 'lamp';

export function resolveScheme(pref: ThemePref, system: 'light' | 'dark' | null | undefined): Scheme {
  if (pref === 'light' || pref === 'lamp') return pref;
  return system === 'dark' ? 'lamp' : 'light';
}
```

`src/theme/palette.ts`
```ts
/**
 * Book Fair Saturday — Painted Bookcase. Six inks + paper; no tints, no gradients.
 * Spec: docs/superpowers/specs/2026-09-18-bookshelf-redesign-design.md
 */
export const ink = {
  tomato: '#E2462B',
  bus: '#F4B41A', // primary action only
  pool: '#2F6FB0',
  grass: '#3E9A5A',
  plum: '#7B3F6E',
  tape: '#F7E7B4',
  white: '#FFFFFF',
  brown: '#2B1D14', // outlines + text on paper objects (cards, bubbles, stickers)
  soft: '#6B5646', // secondary text on paper objects
  cream: '#F3E0BE',
  paper: '#FBFAF4',
} as const;

export type Scheme = 'light' | 'lamp';

export interface Palette {
  paper: string; // screen ground
  caseBack: string; // bookcase back panel
  text: string; // text on the ground
  soft: string; // secondary text on the ground
  line: string; // outlines + hard shadows
  frame: string; // bookcase frame
  frameWidth: number;
  tabBar: string;
  roomTag: string;
}

export const palettes: Record<Scheme, Palette> = {
  light: {
    paper: '#FBFAF4',
    caseBack: '#F3E9D2',
    text: '#2B1D14',
    soft: '#6B5646',
    line: '#2B1D14',
    frame: '#2B1D14',
    frameWidth: 2.5,
    tabBar: '#FFFFFF',
    roomTag: '#FFFFFF',
  },
  lamp: {
    paper: '#2E2016',
    caseBack: '#1F140D',
    text: '#FFF4E0',
    soft: '#D9C3A0',
    line: '#120B06',
    frame: '#A2622F',
    frameWidth: 6,
    tabBar: '#1F140D',
    roomTag: '#E3B55B',
  },
};

export const font = {
  display: 'BagelFatOne_400Regular',
  body: 'Figtree_600SemiBold',
  bold: 'Figtree_700Bold',
  heavy: 'Figtree_800ExtraBold',
  black: 'Figtree_900Black',
  hand: 'GochiHand_400Regular',
} as const;

export const radius = { spine: 3, card: 8, button: 14, sheet: 26, pill: 999 } as const;
export const space = (n: number) => n * 4;
export const PLANKS = [ink.bus, ink.tomato, ink.pool, ink.grass, ink.plum] as const;
```

`src/theme/motion.ts`
```ts
import { Easing } from 'react-native-reanimated';

export const motion = { feedback: 120, routine: 220, overlay: 450, focal: 600 } as const;
export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
/** Dewey's pop and the sticker slap — the only bouncy motions in the app. */
export const popSpring = { damping: 9, stiffness: 180, mass: 0.7 } as const;
```

`src/stores/settings.ts`
```ts
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ThemePref } from '@/theme/resolveScheme';

interface SettingsState {
  theme: ThemePref;
  quiet: boolean; // "Quiet librarian": hides Dewey's lines and tape-note jokes
  setTheme: (theme: ThemePref) => void;
  setQuiet: (quiet: boolean) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system',
      quiet: false,
      setTheme: (theme) => set({ theme }),
      setQuiet: (quiet) => set({ quiet }),
    }),
    { name: 'settings', storage: createJSONStorage(() => AsyncStorage) }
  )
);
```

`src/theme/useTheme.ts`
```ts
import { useColorScheme } from 'react-native';
import { useSettings } from '@/stores/settings';
import { palettes, type Palette, type Scheme } from './palette';
import { resolveScheme } from './resolveScheme';

export function useTheme(): { scheme: Scheme; c: Palette } {
  const pref = useSettings((s) => s.theme);
  const scheme = resolveScheme(pref, useColorScheme());
  return { scheme, c: palettes[scheme] };
}
```

- [ ] **Step 5: Load new fonts in `app/_layout.tsx`** (old fonts stay until Task 10)

```tsx
import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useFonts, Fraunces_600SemiBold, Fraunces_700Bold } from '@expo-google-fonts/fraunces';
import { Nunito_600SemiBold, Nunito_700Bold, Nunito_800ExtraBold } from '@expo-google-fonts/nunito';
import { BagelFatOne_400Regular } from '@expo-google-fonts/bagel-fat-one';
import { Figtree_600SemiBold, Figtree_700Bold, Figtree_800ExtraBold, Figtree_900Black } from '@expo-google-fonts/figtree';
import { GochiHand_400Regular } from '@expo-google-fonts/gochi-hand';
import { QueryProvider } from '@/providers/QueryProvider';
import { getDb } from '@/db/database';
import { useTheme } from '@/theme/useTheme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { scheme, c } = useTheme();
  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold, Fraunces_700Bold,
    Nunito_600SemiBold, Nunito_700Bold, Nunito_800ExtraBold,
    BagelFatOne_400Regular,
    Figtree_600SemiBold, Figtree_700Bold, Figtree_800ExtraBold, Figtree_900Black,
    GochiHand_400Regular,
  });

  useEffect(() => {
    getDb(); // open + migrate on launch
  }, []);

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <QueryProvider>
      <StatusBar style={scheme === 'lamp' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.paper } }} />
    </QueryProvider>
  );
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx jest src/theme && npm run typecheck` — Expected: 2 tests PASS; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(theme): Painted Bookcase palette, motion tokens, persisted theme settings"
```

---

### Task 2: Pure logic — spines, rooms, Dewey's lines, dates

**Files:**
- Create: `src/features/shelves/spineStyle.ts`, `src/features/shelves/groupByRoom.ts`, `src/features/dewey/lines.ts`, `src/lib/dates.ts`
- Test: `src/features/shelves/__tests__/spineStyle.test.ts`, `src/features/shelves/__tests__/groupByRoom.test.ts`, `src/features/dewey/__tests__/lines.test.ts`, `src/lib/__tests__/dates.test.ts`, shared fixture `src/test/fixtures.ts`

**Interfaces:**
- Consumes: `ink` (Task 1), `LibraryRow` (`src/lib/types.ts`).
- Produces:
  - `hashString(s: string): number`, `spineStyle(id: string, title: string): SpineLook` where `SpineLook = { bg; fg; accent: string; width: number; height: number; pattern: 'plain'|'band'|'dots'; showTitle: boolean }`
  - `UNSHELVED = 'Unshelved'`, `groupByRoom(rows: LibraryRow[]): Room[]` (`Room = { name: string; rows: LibraryRow[] }`), `mostCopied(rows): { title: string; copies: number } | null`
  - `MAX_LINE = 70`, `countWord(n)`, `clip(s, n)`, `shelvesLines(ctx: ShelvesContext): string[]`, `EMPTY_SHELF`, `ownedLine(copies, exactIsbnMatch)`, `newFindLine(seed)`, `wishlistLine(count)`, `searchAside(query, ownedMatches)`, `roomNote(room: Room)`
  - `greeting(date: Date, lamp: boolean): string`, `wantedSince(iso: string, now: Date): string`

- [ ] **Step 1: Write fixtures and failing tests**

`src/test/fixtures.ts`
```ts
import type { LibraryRow } from '@/lib/types';

let n = 0;
export function row(p: { title?: string; bookId?: string; location?: string | null; status?: LibraryRow['status']; createdAt?: string } = {}): LibraryRow {
  n += 1;
  const bookId = p.bookId ?? `b${n}`;
  return {
    id: `ub${n}`, bookId, status: p.status ?? 'owned', condition: null, location: p.location ?? null,
    purchaseDate: null, purchasePrice: null, currency: null, rating: null, review: null, notes: null,
    readingProgress: null, isFavorite: false, createdAt: p.createdAt ?? '2026-01-01 10:00:00',
    updatedAt: '2026-01-01 10:00:00', deletedAt: null,
    book: {
      id: bookId, isbn13: null, isbn10: null, title: p.title ?? `Book ${n}`, subtitle: null, authors: ['A. Author'],
      publisher: null, publishedYear: null, edition: null, genres: [], pageCount: null, coverUrl: null,
      description: null, workKey: null, source: 'manual',
    },
  };
}
```

`src/features/shelves/__tests__/spineStyle.test.ts`
```ts
import { spineStyle, hashString } from '../spineStyle';

describe('spineStyle', () => {
  it('is deterministic per id', () => {
    expect(spineStyle('abc', 'Dune')).toEqual(spineStyle('abc', 'Dune'));
    expect(hashString('abc')).toBe(hashString('abc'));
  });
  it('stays within size ranges for many ids', () => {
    for (let i = 0; i < 500; i++) {
      const s = spineStyle(`id-${i}`, 'Title');
      expect(s.width).toBeGreaterThanOrEqual(22);
      expect(s.width).toBeLessThanOrEqual(36);
      expect(s.height).toBeGreaterThanOrEqual(96);
      expect(s.height).toBeLessThanOrEqual(122);
    }
  });
  it('never prints a title on dotted or narrow spines, or when the title is blank', () => {
    for (let i = 0; i < 500; i++) {
      const s = spineStyle(`id-${i}`, 'Title');
      if (s.pattern === 'dots' || s.width < 24) expect(s.showTitle).toBe(false);
    }
    expect(spineStyle('x', '   ').showTitle).toBe(false);
  });
});
```

`src/features/shelves/__tests__/groupByRoom.test.ts`
```ts
import { groupByRoom, mostCopied, UNSHELVED } from '../groupByRoom';
import { row } from '@/test/fixtures';

describe('groupByRoom', () => {
  it('groups by location, biggest room first, Unshelved last, wishlist excluded', () => {
    const rooms = groupByRoom([
      row({ location: 'Study' }), row({ location: 'Living room' }), row({ location: 'Living room' }),
      row({ location: null }), row({ location: '  ' }), row({ location: 'Study', status: 'wishlist' }),
    ]);
    expect(rooms.map((r) => [r.name, r.rows.length])).toEqual([['Living room', 2], ['Study', 1], [UNSHELVED, 2]]);
  });
  it('returns [] for no rows', () => {
    expect(groupByRoom([])).toEqual([]);
  });
});

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

`src/features/dewey/__tests__/lines.test.ts`
```ts
import { shelvesLines, ownedLine, wishlistLine, searchAside, roomNote, newFindLine, EMPTY_SHELF, MAX_LINE, countWord } from '../lines';
import { row } from '@/test/fixtures';

const long = 'An Extraordinarily Long Title That Goes On And On Forever';

describe('Dewey lines', () => {
  it('empty library gets the reserved-shelf line', () => {
    expect(shelvesLines({ totalBooks: 0, rooms: [], mostCopied: null, loaned: 0 })).toEqual([EMPTY_SHELF]);
  });
  it('uses real data and never exceeds the length cap', () => {
    const lines = shelvesLines({
      totalBooks: 412,
      rooms: [{ name: 'An Absurdly Long Room Name Indeed', count: 146 }],
      mostCopied: { title: long, copies: 3 },
      loaned: 3,
    });
    expect(lines[0]).toMatch(/^Three copies of /);
    expect(lines.some((l) => l.startsWith('146 books in the'))).toBe(true);
    expect(lines.some((l) => l.includes('Three books are out visiting friends'))).toBe(true);
    lines.forEach((l) => expect(l.length).toBeLessThanOrEqual(MAX_LINE));
  });
  it('owned line reflects copies and edition', () => {
    expect(ownedLine(3, true)).toBe("Copy #4? You own three. I've counted.");
    expect(ownedLine(1, true)).toBe('Already yours. Put it back gently.');
    expect(ownedLine(2, false)).toBe('Same book, different coat. You already own it.');
  });
  it('wishlist line scales with count', () => {
    expect(wishlistLine(0)).toBe('Nothing wished for. Suspiciously content.');
    expect(wishlistLine(4)).toBe('Four maybes. Someday is a real day.');
    expect(wishlistLine(27)).toBe('At this rate it needs its own room.');
  });
  it('search aside reports real matches', () => {
    expect(searchAside('', 0)).toBe('Your shelves first, then the catalog.');
    expect(searchAside('dune', 3)).toBe('Searching "dune". You own three already.');
    expect(searchAside('emma', 0)).toBe('No "emma" on your shelves. Yet.');
  });
  it('room note calls out true duplicates, otherwise a stable generic note', () => {
    const dupes = { name: 'Bedroom', rows: [row({ bookId: 'd', title: 'Dune' }), row({ bookId: 'd', title: 'Dune' }), row({ bookId: 'd', title: 'Dune' })] };
    expect(roomNote(dupes)).toBe('3× Dune, no regrets');
    const plain = { name: 'Study', rows: [row(), row()] };
    expect(roomNote(plain)).toBe(roomNote(plain));
    expect(roomNote(plain).length).toBeLessThanOrEqual(30);
  });
  it('new-find line is stable per seed and countWord falls back to digits', () => {
    expect(newFindLine(7)).toBe(newFindLine(7));
    expect(countWord(3)).toBe('Three');
    expect(countWord(42)).toBe('42');
  });
});
```

`src/lib/__tests__/dates.test.ts`
```ts
import { greeting, wantedSince } from '../dates';

describe('dates', () => {
  it('greets by time of day', () => {
    expect(greeting(new Date(2026, 8, 18, 9), false)).toBe('Good morning');
    expect(greeting(new Date(2026, 8, 18, 14), false)).toBe('Good afternoon');
    expect(greeting(new Date(2026, 8, 18, 20), false)).toBe('Good evening');
    expect(greeting(new Date(2026, 8, 18, 23), true)).toBe('Still up?');
  });
  it('formats wanted-since as month (same year) or year', () => {
    const now = new Date(2026, 8, 18);
    expect(wantedSince('2026-03-02 10:00:00', now)).toBe('WANTED SINCE MAR');
    expect(wantedSince('2022-06-01 10:00:00', now)).toBe('WANTED SINCE 2022');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npx jest src/features src/lib` — Expected: FAIL with `Cannot find module` for each module.

- [ ] **Step 3: Implement the modules**

`src/features/shelves/spineStyle.ts`
```ts
import { ink } from '@/theme/palette';

export type SpinePattern = 'plain' | 'band' | 'dots';
export interface SpineLook {
  bg: string; fg: string; accent: string;
  width: number; height: number;
  pattern: SpinePattern; showTitle: boolean;
}

const SWATCHES = [
  { bg: ink.pool, fg: ink.white, accent: ink.bus },
  { bg: ink.bus, fg: ink.brown, accent: ink.tomato },
  { bg: ink.tomato, fg: ink.white, accent: ink.bus },
  { bg: ink.grass, fg: ink.white, accent: ink.bus },
  { bg: ink.white, fg: ink.brown, accent: ink.bus },
  { bg: ink.plum, fg: ink.white, accent: ink.bus },
  { bg: ink.brown, fg: ink.bus, accent: ink.bus },
  { bg: ink.cream, fg: ink.brown, accent: ink.tomato },
] as const;

/** FNV-1a — stable across sessions so a book keeps its spine forever. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function spineStyle(id: string, title: string): SpineLook {
  const h = hashString(id);
  const sw = SWATCHES[h % SWATCHES.length];
  const width = 22 + ((h >>> 3) % 15); // 22–36
  const height = 96 + ((h >>> 7) % 27); // 96–122
  const p = (h >>> 11) % 5;
  const pattern: SpinePattern = p === 0 ? 'dots' : p <= 2 ? 'band' : 'plain';
  const showTitle = pattern !== 'dots' && width >= 24 && title.trim().length > 0;
  return { ...sw, width, height, pattern, showTitle };
}
```

`src/features/shelves/groupByRoom.ts`
```ts
import type { LibraryRow } from '@/lib/types';

export const UNSHELVED = 'Unshelved';
export interface Room { name: string; rows: LibraryRow[] }

/** One shelf per room (user_books.location). Wishlist books never sit on a room shelf. */
export function groupByRoom(rows: LibraryRow[]): Room[] {
  const map = new Map<string, LibraryRow[]>();
  for (const r of rows) {
    if (r.status === 'wishlist') continue;
    const name = r.location?.trim() || UNSHELVED;
    const list = map.get(name) ?? [];
    list.push(r);
    map.set(name, list);
  }
  return [...map.entries()]
    .map(([name, list]) => ({ name, rows: list }))
    .sort((a, b) => {
      if (a.name === UNSHELVED) return 1;
      if (b.name === UNSHELVED) return -1;
      return b.rows.length - a.rows.length || a.name.localeCompare(b.name);
    });
}

export function mostCopied(rows: LibraryRow[]): { title: string; copies: number } | null {
  const counts = new Map<string, { title: string; copies: number }>();
  for (const r of rows) {
    if (r.status === 'wishlist') continue;
    const e = counts.get(r.bookId) ?? { title: r.book.title, copies: 0 };
    e.copies += 1;
    counts.set(r.bookId, e);
  }
  let best: { title: string; copies: number } | null = null;
  for (const e of counts.values()) if (e.copies >= 2 && (!best || e.copies > best.copies)) best = e;
  return best;
}
```

`src/features/dewey/lines.ts`
```ts
/**
 * Dewey's lines — the wit contract (spec §5): true, data-driven, ≤ 70 chars,
 * roasts the library, never the owner. Never used for errors or permissions.
 */
import { hashString } from '@/features/shelves/spineStyle';
import type { Room } from '@/features/shelves/groupByRoom';

export const MAX_LINE = 70;
const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
export const countWord = (n: number) => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n));
export const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…');

export const EMPTY_SHELF = "An empty shelf. I've reserved it for you.";

export interface ShelvesContext {
  totalBooks: number;
  rooms: { name: string; count: number }[];
  mostCopied: { title: string; copies: number } | null;
  loaned: number;
}

export function shelvesLines(ctx: ShelvesContext): string[] {
  if (ctx.totalBooks === 0) return [EMPTY_SHELF];
  const out: string[] = [];
  if (ctx.mostCopied) {
    out.push(`${countWord(ctx.mostCopied.copies)} copies of ${clip(ctx.mostCopied.title, 22)}. I'm not judging. (I am.)`);
  }
  const big = ctx.rooms[0];
  if (big && big.count >= 20) {
    out.push(`${big.count} books in the ${clip(big.name.toLowerCase(), 16)}. Guests are impressed. Or worried.`);
  }
  if (ctx.loaned === 1) out.push('One book is out visiting a friend. I miss it.');
  if (ctx.loaned > 1) out.push(`${countWord(ctx.loaned)} books are out visiting friends. I keep a list.`);
  if (ctx.totalBooks >= 100) out.push(`${ctx.totalBooks} books. That's a lot of evenings.`);
  out.push("I dusted. You're welcome.");
  return out.map((l) => clip(l, MAX_LINE));
}

export function ownedLine(copies: number, exactIsbnMatch: boolean): string {
  if (!exactIsbnMatch) return 'Same book, different coat. You already own it.';
  if (copies <= 1) return 'Already yours. Put it back gently.';
  return `Copy #${copies + 1}? You own ${countWord(copies).toLowerCase()}. I've counted.`;
}

const NEW_FIND_LINES = ["Ooh. We don't have this one. Yet.", "A stranger! Let's make introductions."];
export const newFindLine = (seed: number) => NEW_FIND_LINES[Math.abs(seed) % NEW_FIND_LINES.length];

export function wishlistLine(count: number): string {
  if (count === 0) return 'Nothing wished for. Suspiciously content.';
  if (count >= 20) return 'At this rate it needs its own room.';
  return `${countWord(count)} maybes. Someday is a real day.`;
}

export function searchAside(query: string, ownedMatches: number): string {
  const q = clip(query.trim(), 20);
  if (!q) return 'Your shelves first, then the catalog.';
  if (ownedMatches >= 2) return `Searching "${q}". You own ${countWord(ownedMatches).toLowerCase()} already.`;
  if (ownedMatches === 1) return 'On your shelves already. Of course it is.';
  return `No "${q}" on your shelves. Yet.`;
}

const NOTES = ['the respectable ones', 'do not alphabetize', 'the overflow', 'handle with care', 'the good light', 'mostly finished'];

/** Tape note beside a room tag: a true duplicate call-out, otherwise a stable affectionate label. */
export function roomNote(room: Pick<Room, 'name' | 'rows'>): string {
  const byBook = new Map<string, { title: string; n: number }>();
  for (const r of room.rows) {
    const e = byBook.get(r.bookId) ?? { title: r.book.title, n: 0 };
    e.n += 1;
    byBook.set(r.bookId, e);
  }
  const dupe = [...byBook.values()].sort((a, b) => b.n - a.n)[0];
  if (dupe && dupe.n >= 2) return `${dupe.n}× ${clip(dupe.title, 14)}, no regrets`;
  return NOTES[hashString(room.name) % NOTES.length];
}
```

`src/lib/dates.ts`
```ts
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function greeting(date: Date, lamp: boolean): string {
  const h = date.getHours();
  if (lamp && (h >= 22 || h < 5)) return 'Still up?';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** SQLite datetime('now') strings: "YYYY-MM-DD HH:MM:SS". */
export function wantedSince(iso: string, now: Date): string {
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return 'WANTED';
  return d.getFullYear() === now.getFullYear() ? `WANTED SINCE ${MONTHS[d.getMonth()]}` : `WANTED SINCE ${d.getFullYear()}`;
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest` — Expected: all suites PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: spine looks, room grouping, Dewey's lines, date helpers (tested)"
```

---

### Task 3: Repository additions

**Files:**
- Modify: `src/db/repository.ts`

**Interfaces:**
- Produces: `searchLibrary(q: string): LibraryRow[]`, `CopyRow` (`UserBook & { borrower: string | null; loanedAt: string | null }`), `listCopiesOfBook(bookId: string): CopyRow[]`, `setStatus(userBookId: string, status: BookStatus): void`, `setLocation(userBookId: string, location: string | null): void`, `listRooms(): string[]`, `libraryStats(): { totalBooks; estValue; activeLoans; wishlist: number }`.

- [ ] **Step 1: Refactor the shared SELECT and add the new functions** — replace everything from `export function listLibrary` to the end of the file with:

```ts
const LIBRARY_SELECT = `SELECT ub.*, b.id as b_id, b.isbn13, b.isbn10, b.title, b.subtitle, b.authors, b.publisher,
       b.published_year, b.edition, b.genres, b.page_count, b.cover_url, b.description, b.work_key, b.source
  FROM user_books ub JOIN books b ON b.id = ub.book_id`;

const toRow = (r: any): LibraryRow => ({ ...toUserBook(r), book: toBook({ ...r, id: r.b_id }) });

export function listLibrary(filter?: { status?: BookStatus }): LibraryRow[] {
  const where = ['ub.deleted_at IS NULL'];
  const params: any[] = [];
  if (filter?.status) {
    where.push('ub.status = ?');
    params.push(filter.status);
  }
  return getDb()
    .getAllSync<any>(`${LIBRARY_SELECT} WHERE ${where.join(' AND ')} ORDER BY ub.created_at DESC`, params)
    .map(toRow);
}

export function getLibraryRow(userBookId: string): LibraryRow | null {
  const r = getDb().getFirstSync<any>(`${LIBRARY_SELECT} WHERE ub.id = ?`, [userBookId]);
  return r ? toRow(r) : null;
}

/** Library-first search: title, authors (JSON text) or ISBN. */
export function searchLibrary(q: string): LibraryRow[] {
  const term = q.trim();
  if (!term) return [];
  const like = `%${term}%`;
  return getDb()
    .getAllSync<any>(
      `${LIBRARY_SELECT} WHERE ub.deleted_at IS NULL AND (b.title LIKE ? OR b.authors LIKE ? OR b.isbn13 LIKE ?)
       ORDER BY b.title COLLATE NOCASE LIMIT 50`,
      [like, like, like]
    )
    .map(toRow);
}

export interface CopyRow extends UserBook {
  borrower: string | null;
  loanedAt: string | null;
}

/** Every owned copy of one book, with its active loan (if any). */
export function listCopiesOfBook(bookId: string): CopyRow[] {
  return getDb()
    .getAllSync<any>(
      `SELECT ub.*, l.borrower_name AS loan_borrower, l.loaned_at AS loan_at
         FROM user_books ub
         LEFT JOIN loans l ON l.user_book_id = ub.id AND l.returned_at IS NULL AND l.deleted_at IS NULL
        WHERE ub.book_id = ? AND ub.deleted_at IS NULL AND ub.status != 'wishlist'
        ORDER BY ub.created_at`,
      [bookId]
    )
    .map((r) => ({ ...toUserBook(r), borrower: r.loan_borrower ?? null, loanedAt: r.loan_at ?? null }));
}

function updateUserBook(userBookId: string, column: 'status' | 'location', value: string | null) {
  const d = getDb();
  d.runSync(`UPDATE user_books SET ${column} = ?, updated_at = datetime('now') WHERE id = ?`, [value, userBookId]);
  const row = d.getFirstSync<any>('SELECT * FROM user_books WHERE id = ?', [userBookId]);
  if (row) enqueue('user_books', userBookId, 'upsert', row);
}

export function setStatus(userBookId: string, status: BookStatus): void {
  updateUserBook(userBookId, 'status', status);
}

export function setLocation(userBookId: string, location: string | null): void {
  updateUserBook(userBookId, 'location', location?.trim() || null);
}

export function listRooms(): string[] {
  return getDb()
    .getAllSync<{ location: string }>(
      `SELECT DISTINCT location FROM user_books
        WHERE location IS NOT NULL AND TRIM(location) != '' AND deleted_at IS NULL
        ORDER BY location COLLATE NOCASE`
    )
    .map((r) => r.location);
}

export function libraryStats() {
  const d = getDb();
  const one = (sql: string) => d.getFirstSync<{ n: number }>(sql)?.n ?? 0;
  return {
    totalBooks: one(`SELECT COUNT(*) n FROM user_books WHERE deleted_at IS NULL AND status != 'wishlist'`),
    estValue: one(`SELECT COALESCE(SUM(purchase_price), 0) n FROM user_books WHERE deleted_at IS NULL`),
    activeLoans: one(`SELECT COUNT(*) n FROM loans WHERE returned_at IS NULL AND deleted_at IS NULL`),
    wishlist: one(`SELECT COUNT(*) n FROM user_books WHERE deleted_at IS NULL AND status = 'wishlist'`),
  };
}
```

Also add `UserBook` is already imported; no new imports needed.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` — Expected: exit 0 (profile.tsx still reads `totalBooks`/`estValue`, both kept).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(db): library search, copies with loans, status/location updates, rooms, loan + wishlist stats"
```

---

### Task 4: UI primitives

**Files:**
- Create: `src/components/ui/Raised.tsx`, `Button.tsx`, `Chip.tsx`, `PocketCard.tsx`, `Stamp.tsx`, `Sticker.tsx`, `TapeNote.tsx`, `Bubble.tsx`, `ScreenHeader.tsx`, `Toast.tsx`

**Interfaces:**
- Consumes: `ink`, `font`, `radius`, `useTheme`, `motion`, `easeOut`, `popSpring`.
- Produces (props):
  - `Raised({ offset?=3, radius?=14, shadowColor?, style?, children })`
  - `Button({ label, onPress, variant?: 'primary'|'ghost', disabled?, flex?, accessibilityLabel? })`
  - `Chip({ label, selected?, onPress })`
  - `PocketCard({ title?, children, style? })`, `LeaderRow({ label, value })`
  - `Stamp({ label, color?=ink.tomato, play, delay?=0, onLand?, style? })`
  - `Sticker({ label, size?=62, play?, delay?=0, style? })`
  - `TapeNote({ text, style? })`
  - `Bubble({ text, style?, width? })`
  - `ScreenHeader({ kicker?, title, sub? })`
  - `Toast({ text | null })`

- [ ] **Step 1: Write the components**

`src/components/ui/Raised.tsx`
```tsx
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme/useTheme';

/** Hard offset shadow drawn as a real layer — Android elevation cannot do hard offsets. */
export function Raised({
  offset = 3, radius = 14, shadowColor, style, children,
}: { offset?: number; radius?: number; shadowColor?: string; style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={[{ paddingRight: offset, paddingBottom: offset }, style]}>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: offset, top: offset, right: 0, bottom: 0, borderRadius: radius, backgroundColor: shadowColor ?? c.line }}
      />
      {children}
    </View>
  );
}
```

`src/components/ui/Button.tsx`
```tsx
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { font, ink, radius } from '@/theme/palette';
import { easeOut, motion } from '@/theme/motion';
import { useTheme } from '@/theme/useTheme';

const OFFSET = 3;

export function Button({
  label, onPress, variant = 'primary', disabled, flex, accessibilityLabel,
}: { label: string; onPress: () => void; variant?: 'primary' | 'ghost'; disabled?: boolean; flex?: boolean; accessibilityLabel?: string }) {
  const { c } = useTheme();
  const press = useSharedValue(0);
  const face = useAnimatedStyle(() => ({
    transform: [{ translateX: press.value * OFFSET }, { translateY: press.value * OFFSET }],
  }));
  const sink = (to: number) => () => {
    press.value = withTiming(to, { duration: motion.feedback, easing: easeOut });
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={sink(1)}
      onPressOut={sink(0)}
      style={{ flex: flex ? 1 : undefined, opacity: disabled ? 0.45 : 1, paddingRight: OFFSET, paddingBottom: OFFSET }}
    >
      <View style={{ position: 'absolute', left: OFFSET, top: OFFSET, right: 0, bottom: 0, borderRadius: radius.button, backgroundColor: c.line }} />
      <Animated.View
        style={[
          {
            height: 52, borderRadius: radius.button, borderWidth: 2.5, borderColor: c.line,
            backgroundColor: variant === 'primary' ? ink.bus : ink.white,
            alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18,
          },
          face,
        ]}
      >
        <Text style={{ fontFamily: font.black, fontSize: 15, color: ink.brown }}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}
```

`src/components/ui/Chip.tsx`
```tsx
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { font, ink, radius } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      hitSlop={{ top: 7, bottom: 7 }}
      style={({ pressed }) => ({ transform: [{ translateY: pressed ? 1 : 0 }] })}
    >
      <View
        style={{
          height: 32, paddingHorizontal: 13, borderRadius: radius.pill, borderWidth: 2, borderColor: c.line,
          backgroundColor: selected ? ink.brown : ink.white, alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text style={{ fontFamily: font.heavy, fontSize: 12.5, color: selected ? ink.white : ink.brown }}>{label}</Text>
      </View>
    </Pressable>
  );
}
```

`src/components/ui/PocketCard.tsx`
```tsx
import React from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { font, ink, radius } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';
import { Raised } from './Raised';

/** Library pocket card: white card, tomato top rule, dotted-leader rows. Replaces stat grids. */
export function PocketCard({ title, children, style }: { title?: string; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <Raised offset={3} radius={radius.card} style={style}>
      <View style={{ backgroundColor: ink.white, borderWidth: 2.5, borderColor: c.line, borderRadius: radius.card, overflow: 'hidden' }}>
        <View style={{ height: 9, backgroundColor: ink.tomato, borderBottomWidth: 2, borderColor: c.line }} />
        <View style={{ paddingHorizontal: 14, paddingTop: 8, paddingBottom: 8 }}>
          {title ? (
            <Text style={{ fontFamily: font.black, fontSize: 11, letterSpacing: 0.4, color: ink.soft, marginBottom: 2 }}>
              {title.toUpperCase()}
            </Text>
          ) : null}
          {children}
        </View>
      </View>
    </Raised>
  );
}

export function LeaderRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', paddingVertical: 4 }} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={{ fontFamily: font.bold, fontSize: 14, color: ink.brown }}>{label}</Text>
      <Text numberOfLines={1} ellipsizeMode="clip" style={{ flex: 1, marginHorizontal: 6, color: '#C9BBAA', fontFamily: font.black, fontSize: 12 }}>
        {' · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · ·'}
      </Text>
      <Text style={{ fontFamily: font.black, fontSize: 14, color: ink.brown }}>{value}</Text>
    </View>
  );
}
```

`src/components/ui/Stamp.tsx`
```tsx
import React, { useEffect } from 'react';
import { Text, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing, interpolate, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming,
} from 'react-native-reanimated';
import { font, ink } from '@/theme/palette';

/** Rubber stamp. When `play` turns true it slams down (420ms) and calls onLand at impact. */
export function Stamp({
  label, color = ink.tomato, play, delay = 0, onLand, style,
}: { label: string; color?: string; play: boolean; delay?: number; onLand?: () => void; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    if (!play) {
      t.value = 0;
      return;
    }
    if (reduced) {
      t.value = withDelay(delay, withTiming(1, { duration: 1 }));
      if (onLand) setTimeout(onLand, delay);
      return;
    }
    t.value = 0;
    t.value = withDelay(
      delay,
      withTiming(1, { duration: 420, easing: Easing.bezier(0.2, 0.9, 0.25, 1) }, (done) => {
        if (done && onLand) runOnJS(onLand)();
      })
    );
  }, [play]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.3, 1], [0, 1, 1]),
    transform: [
      { scale: interpolate(t.value, [0, 0.45, 0.62, 1], [2.4, 0.92, 1.04, 1]) },
      { rotate: `${interpolate(t.value, [0, 0.45, 1], [-22, -8, -9])}deg` },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLabel={label}
      style={[{ borderWidth: 3.5, borderColor: color, backgroundColor: ink.white, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3 }, s, style]}
    >
      <Text style={{ fontFamily: font.display, fontSize: 17, color }}>{label}</Text>
    </Animated.View>
  );
}
```

`src/components/ui/Sticker.tsx`
```tsx
import React, { useEffect } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';
import { font, ink } from '@/theme/palette';
import { popSpring } from '@/theme/motion';
import { useTheme } from '@/theme/useTheme';

/** Round yellow sticker. With `play`, it slaps on with a spring. */
export function Sticker({
  label, size = 62, play = true, delay = 0, style,
}: { label: string; size?: number; play?: boolean; delay?: number; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const reduced = useReducedMotion();
  const k = useSharedValue(play && !reduced ? 0 : 1);
  useEffect(() => {
    if (play && !reduced) k.value = withDelay(delay, withSpring(1, popSpring));
  }, [play]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = useAnimatedStyle(() => ({ transform: [{ rotate: '14deg' }, { scale: k.value }] }));
  return (
    <Animated.View pointerEvents="none" style={[{ width: size + 3, height: size + 3 }, s, style]}>
      <View style={{ position: 'absolute', left: 3, top: 3, width: size, height: size, borderRadius: size / 2, backgroundColor: c.line }} />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: ink.bus, borderWidth: 2.5, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: font.display, fontSize: size / 3.9, color: ink.brown, textAlign: 'center' }}>{label}</Text>
      </View>
    </Animated.View>
  );
}
```

`src/components/ui/TapeNote.tsx`
```tsx
import React from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { font, ink } from '@/theme/palette';

export function TapeNote({ text, style }: { text: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ backgroundColor: ink.tape, paddingHorizontal: 10, paddingVertical: 1, transform: [{ rotate: '-2deg' }] }, style]}>
      <Text style={{ fontFamily: font.hand, fontSize: 15, color: ink.brown }} numberOfLines={1}>{text}</Text>
    </View>
  );
}
```

`src/components/ui/Bubble.tsx`
```tsx
import React from 'react';
import { Text, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { font, ink } from '@/theme/palette';
import { easeOut, motion } from '@/theme/motion';
import { useTheme } from '@/theme/useTheme';
import { Raised } from './Raised';

/** Dewey's speech bubble. Re-keys on text so each new line scales in. */
export function Bubble({ text, width = 150, style }: { text: string; width?: number; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <Animated.View key={text} entering={ZoomIn.duration(motion.routine).easing(easeOut)} style={[{ width }, style]} accessibilityLiveRegion="polite">
      <Raised offset={3} radius={14}>
        <Animated.View style={{ backgroundColor: ink.white, borderWidth: 2, borderColor: c.line, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 7 }}>
          <Text style={{ fontFamily: font.bold, fontSize: 12, lineHeight: 16, color: ink.brown }}>{text}</Text>
        </Animated.View>
      </Raised>
    </Animated.View>
  );
}
```

`src/components/ui/ScreenHeader.tsx`
```tsx
import React from 'react';
import { Text, View } from 'react-native';
import { font } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

export function ScreenHeader({ kicker, title, sub }: { kicker?: string; title: string; sub?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
      {kicker ? <Text style={{ fontFamily: font.bold, fontSize: 14, color: c.soft }}>{kicker}</Text> : null}
      <Text accessibilityRole="header" style={{ fontFamily: font.display, fontSize: 40, lineHeight: 44, color: c.text }}>{title}</Text>
      {sub ? <Text style={{ fontFamily: font.bold, fontSize: 13, color: c.soft, marginTop: 2 }}>{sub}</Text> : null}
    </View>
  );
}
```

`src/components/ui/Toast.tsx`
```tsx
import React from 'react';
import { Text } from 'react-native';
import Animated, { FadeOut, SlideInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, ink } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';
import { Raised } from './Raised';

export function Toast({ text }: { text: string | null }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  if (!text) return null;
  return (
    <Animated.View
      key={text}
      entering={SlideInUp.duration(380)}
      exiting={FadeOut.duration(200)}
      accessibilityLiveRegion="polite"
      style={{ position: 'absolute', left: 20, right: 20, top: insets.top + 60, zIndex: 50 }}
    >
      <Raised offset={3} radius={14}>
        <Animated.View style={{ backgroundColor: ink.white, borderWidth: 2.5, borderColor: c.line, borderRadius: 14, padding: 13 }}>
          <Text style={{ fontFamily: font.heavy, fontSize: 14, color: ink.brown }}>{text}</Text>
        </Animated.View>
      </Raised>
    </Animated.View>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` — Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(ui): Raised, Button, Chip, PocketCard, Stamp, Sticker, TapeNote, Bubble, ScreenHeader, Toast"
```

---

### Task 5: Shelf components and Dewey

**Files:**
- Create: `src/components/dewey/Dewey.tsx`, `src/components/shelf/Spine.tsx`, `Shelf.tsx`, `Bookcase.tsx`, `Plant.tsx`, `CoverArt.tsx`

**Interfaces:**
- Consumes: `spineStyle`, `Raised`, `TapeNote`, `useTheme`, `ink`, `font`, `motion`, `easeOut`, `popSpring`.
- Produces:
  - `Dewey({ mood?: 'happy'|'smug'|'gasp'|'sleep', size?=64, pop?: boolean, popDelay?=0, onPress? })`
  - `Spine({ id, title, onPress?, lean?=0, scale?=1 })`
  - `Shelf({ name, count, note?, plank, rows: LibraryRow[], onPressBook, reserveRight?=0, withPlant?, children? })`
  - `Bookcase({ children, style? })`
  - `Plant({ size?=34 })`
  - `CoverArt({ id, title, author?, coverUrl?, width, height })`

- [ ] **Step 1: Write the components**

`src/components/dewey/Dewey.tsx`
```tsx
import React, { useEffect } from 'react';
import { Pressable } from 'react-native';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';
import Animated, {
  useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSpring, withTiming,
} from 'react-native-reanimated';
import { font, ink } from '@/theme/palette';
import { popSpring } from '@/theme/motion';

export type DeweyMood = 'happy' | 'smug' | 'gasp' | 'sleep';
const INK = ink.brown;

function Face({ mood }: { mood: DeweyMood }) {
  const eyes =
    mood === 'sleep' ? (
      <Path d="M40 34h6M55 34h6" stroke={INK} strokeWidth={2.5} />
    ) : mood === 'smug' ? (
      <Path d="M39 33h8M54 33h8" stroke={INK} strokeWidth={3} />
    ) : (
      <>
        <Circle cx={44} cy={34} r={2.2} fill={INK} />
        <Circle cx={59} cy={34} r={2.2} fill={INK} />
      </>
    );
  const mouth =
    mood === 'gasp' ? <Ellipse cx={51} cy={46} rx={3.2} ry={4} fill={INK} /> : <Path d="M46 45q5 3 10 0" stroke={INK} strokeWidth={2.5} fill="none" strokeLinecap="round" />;
  return (
    <>
      {eyes}
      {mouth}
    </>
  );
}

function Zzz() {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: 2600 }), -1, false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const s = useAnimatedStyle(() => ({
    opacity: t.value < 0.3 ? t.value / 0.3 : 1 - (t.value - 0.3) / 0.7,
    transform: [{ translateX: 14 * t.value }, { translateY: -26 * t.value }],
  }));
  return <Animated.Text style={[{ position: 'absolute', right: 6, top: -4, fontFamily: font.display, fontSize: 16, color: ink.bus }, s]}>z</Animated.Text>;
}

/** Dewey the bookworm. Roasts the library, never the owner. */
export function Dewey({
  mood = 'happy', size = 64, pop, popDelay = 0, onPress,
}: { mood?: DeweyMood; size?: number; pop?: boolean; popDelay?: number; onPress?: () => void }) {
  const reduced = useReducedMotion();
  const k = useSharedValue(pop && !reduced ? 0 : 1);
  useEffect(() => {
    if (pop && !reduced) k.value = withDelay(popDelay, withSpring(1, popSpring));
  }, [pop]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = useAnimatedStyle(() => ({
    opacity: k.value > 0.05 ? 1 : 0,
    transform: [{ translateY: (1 - k.value) * 40 }, { scale: 0.6 + 0.4 * k.value }],
  }));
  const body = (
    <Svg width={size} height={size * 0.95} viewBox="0 0 74 70">
      <G stroke={INK} strokeWidth={2.5}>
        <Circle cx={20} cy={56} r={11} fill={ink.grass} />
        <Circle cx={34} cy={50} r={12} fill={ink.grass} />
        <Circle cx={50} cy={36} r={17} fill="#6BBF7A" />
        <Circle cx={43} cy={33} r={6.5} fill={ink.white} />
        <Circle cx={58} cy={33} r={6.5} fill={ink.white} />
      </G>
      <Path d="M49.5 33h2" stroke={INK} strokeWidth={2.5} />
      <Face mood={mood} />
      <Path d="M47 19q-2-8 4-11" stroke={INK} strokeWidth={2.5} fill="none" strokeLinecap="round" />
    </Svg>
  );
  return (
    <Animated.View style={s}>
      {mood === 'sleep' && !reduced ? <Zzz /> : null}
      {onPress ? (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Dewey the bookworm. Tap for another remark." hitSlop={8}>
          {body}
        </Pressable>
      ) : (
        body
      )}
    </Animated.View>
  );
}
```

`src/components/shelf/Spine.tsx`
```tsx
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Defs, Pattern, Rect } from 'react-native-svg';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { spineStyle } from '@/features/shelves/spineStyle';
import { font, radius } from '@/theme/palette';
import { easeOut, motion } from '@/theme/motion';
import { useTheme } from '@/theme/useTheme';

function Dots({ color }: { color: string }) {
  return (
    <Svg style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} width="100%" height="100%">
      <Defs>
        <Pattern id="dots" width={5} height={5} patternUnits="userSpaceOnUse">
          <Circle cx={2.5} cy={2.5} r={1.1} fill={color} opacity={0.55} />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#dots)" />
    </Svg>
  );
}

export function Spine({
  id, title, onPress, lean = 0, scale = 1,
}: { id: string; title: string; onPress?: () => void; lean?: number; scale?: number }) {
  const { c } = useTheme();
  const look = spineStyle(id, title);
  const w = Math.round(look.width * scale);
  const h = Math.round(look.height * scale);
  const lift = useSharedValue(0);
  const s = useAnimatedStyle(() => ({ transform: [{ translateY: -8 * lift.value }, { rotate: `${lean}deg` }] }));
  const to = (v: number, d: number) => () => {
    lift.value = withTiming(v, { duration: d, easing: easeOut });
  };
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      onPressIn={to(1, motion.feedback)}
      onPressOut={to(0, motion.routine)}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={title}
      hitSlop={{ top: 8, bottom: 8 }}
      style={{ marginLeft: lean ? 10 : 0 }}
    >
      <Animated.View
        style={[
          {
            width: w, height: h, backgroundColor: look.bg, borderWidth: 2, borderColor: c.line, borderRadius: radius.spine,
            overflow: 'hidden', alignItems: 'center', justifyContent: 'center', transformOrigin: 'bottom right',
          },
          s,
        ]}
      >
        {look.pattern === 'dots' ? <Dots color={c.line} /> : null}
        {look.pattern === 'band' ? (
          <View style={{ position: 'absolute', left: 0, right: 0, top: 12 * scale, height: 7, backgroundColor: look.accent, borderTopWidth: 2, borderBottomWidth: 2, borderColor: c.line }} />
        ) : null}
        {look.showTitle ? (
          <View style={{ width: h - 16, height: w, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '90deg' }] }}>
            <Text numberOfLines={1} style={{ fontFamily: font.black, fontSize: 10.5 * scale, letterSpacing: 0.6, color: look.fg }}>
              {title.toUpperCase()}
            </Text>
          </View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}
```

`src/components/shelf/Plant.tsx`
```tsx
import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { ink } from '@/theme/palette';

export function Plant({ size = 34 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 34 34" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d="M9 22h16l-2 11H11z" fill={ink.tomato} stroke={ink.brown} strokeWidth={2} />
      <Path d="M17 22c0-8-6-12-10-12 0 6 4 10 10 12zM17 22c0-10 6-15 11-15 0 7-5 13-11 15z" fill={ink.grass} stroke={ink.brown} strokeWidth={2} />
    </Svg>
  );
}
```

`src/components/shelf/Shelf.tsx`
```tsx
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { LibraryRow } from '@/lib/types';
import { font, ink, radius } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';
import { TapeNote } from '@/components/ui/TapeNote';
import { Spine } from './Spine';
import { Plant } from './Plant';

export function Shelf({
  name, count, note, plank, rows, onPressBook, reserveRight = 0, withPlant, children,
}: {
  name: string; count: number; note?: string | null; plank: string; rows: LibraryRow[];
  onPressBook: (row: LibraryRow) => void; reserveRight?: number; withPlant?: boolean; children?: React.ReactNode;
}) {
  const { c } = useTheme();
  return (
    <View style={{ position: 'relative' }} accessibilityLabel={`${name} shelf, ${count} books`}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ alignItems: 'flex-end', gap: 2, paddingHorizontal: 14, paddingTop: 34, paddingRight: 14 + reserveRight, minHeight: 156 }}
      >
        {rows.map((r, i) => (
          <Spine key={r.id} id={r.id} title={r.book.title} onPress={() => onPressBook(r)} lean={i === rows.length - 1 && rows.length >= 4 ? -10 : 0} />
        ))}
        {withPlant ? <View style={{ marginLeft: 10 }}><Plant /></View> : null}
      </ScrollView>
      <View style={{ height: 16, backgroundColor: plank, borderWidth: 2, borderColor: c.line, marginHorizontal: -2.5 }} />
      <View style={{ position: 'absolute', left: 12, top: 6, flexDirection: 'row', alignItems: 'center', gap: 10 }} pointerEvents="none">
        <View style={{ backgroundColor: c.roomTag, borderWidth: 2, borderColor: c.line, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 }}>
          <Text style={{ fontFamily: font.heavy, fontSize: 11.5, color: ink.brown }}>{`${name} · ${count}`}</Text>
        </View>
        {note ? <TapeNote text={note} /> : null}
      </View>
      {children}
    </View>
  );
}
```

`src/components/shelf/Bookcase.tsx`
```tsx
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme/useTheme';
import { Raised } from '@/components/ui/Raised';

export function Bookcase({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <Raised offset={4} radius={8} style={style}>
      <View style={{ backgroundColor: c.caseBack, borderWidth: c.frameWidth, borderColor: c.frame, borderRadius: 8, overflow: 'hidden', paddingTop: 4 }}>
        {children}
      </View>
    </Raised>
  );
}
```

`src/components/shelf/CoverArt.tsx`
```tsx
import React from 'react';
import { Image, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { spineStyle } from '@/features/shelves/spineStyle';
import { font, ink } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

/** Real cover when we have one; otherwise a flat picture-book cover in the book's spine colors. */
export function CoverArt({
  id, title, author, coverUrl, width, height,
}: { id: string; title: string; author?: string; coverUrl?: string | null; width: number; height: number }) {
  const { c } = useTheme();
  const frame = { width, height, borderWidth: 2.5, borderColor: c.line, borderTopLeftRadius: 3, borderBottomLeftRadius: 3, borderTopRightRadius: 6, borderBottomRightRadius: 6, overflow: 'hidden' as const };
  if (coverUrl) {
    return <Image source={{ uri: coverUrl }} style={frame} resizeMode="cover" accessibilityLabel={`Cover of ${title}`} />;
  }
  const look = spineStyle(id, title);
  return (
    <View style={[frame, { backgroundColor: look.bg, padding: width * 0.09 }]} accessibilityLabel={`Cover of ${title}`}>
      <Svg style={{ position: 'absolute', left: 0, top: 0 }} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <Path d={`M0 ${height * 0.62} Q${width * 0.3} ${height * 0.5} ${width * 0.55} ${height * 0.6} T${width} ${height * 0.55} V${height} H0Z`} fill={look.accent} stroke={ink.brown} strokeWidth={2} />
        <Path d={`M0 ${height * 0.76} Q${width * 0.4} ${height * 0.68} ${width} ${height * 0.74} V${height} H0Z`} fill={look.bg === ink.tomato ? ink.pool : ink.tomato} stroke={ink.brown} strokeWidth={2} />
        <Circle cx={width * 0.74} cy={height * 0.32} r={width * 0.11} fill={ink.paper} stroke={ink.brown} strokeWidth={2} />
      </Svg>
      <Text numberOfLines={3} style={{ fontFamily: font.display, fontSize: Math.max(10, width / 6.5), lineHeight: Math.max(12, width / 5.6), color: look.fg }}>{title}</Text>
      {author && width >= 90 ? <Text numberOfLines={1} style={{ fontFamily: font.heavy, fontSize: width / 15, color: look.fg, marginTop: 2 }}>{author}</Text> : null}
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, backgroundColor: ink.brown, opacity: 0.22 }} />
    </View>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` — Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(shelf): Spine, Shelf, Bookcase, Plant, CoverArt, and Dewey"
```

---

### Task 6: Tab bar and Shelves (home)

**Files:**
- Modify: `app/(tabs)/_layout.tsx`, `app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `listLibrary`, `libraryStats`, `groupByRoom`, `mostCopied`, `shelvesLines`, `roomNote`, `greeting`, `Bookcase`, `Shelf`, `Dewey`, `Bubble`, `ScreenHeader`, `Button`, `useSettings`, `useTheme`, `PLANKS`.

- [ ] **Step 1: Rewrite `app/(tabs)/_layout.tsx`**

```tsx
import React from 'react';
import { View } from 'react-native';
import { Tabs } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { font, ink } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

const ICONS: Record<string, string> = {
  index: 'M4 4h4v16H4zM10 4h4v16h-4zM16 6l3.5-1 3 14.5-3.5 1z',
  search: 'M16 16l4 4',
  wishlist: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5.5-7 10-7 10z',
  profile: 'M4 21c1-4 4-6 8-6s7 2 8 6',
};

function TabIcon({ name, color }: { name: string; color: string }) {
  return (
    <Svg width={24} height={24} fill="none" stroke={color} strokeWidth={2.2}>
      {name === 'search' ? <Circle cx={11} cy={11} r={6} /> : null}
      {name === 'profile' ? <Circle cx={12} cy={9} r={4} /> : null}
      <Path d={ICONS[name]} />
    </Svg>
  );
}

function ScanTabIcon() {
  const { c } = useTheme();
  return (
    <View style={{ marginTop: -30, width: 65, height: 65 }}>
      <View style={{ position: 'absolute', left: 3, top: 3, width: 62, height: 62, borderRadius: 31, backgroundColor: c.line }} />
      <View style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: ink.bus, borderWidth: 2.5, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={28} height={28} fill="none" stroke={ink.brown} strokeWidth={2.6}>
          <Path d="M5 9V5h4M19 5h4v4M23 19v4h-4M9 23H5v-4M8 14h12" />
        </Svg>
      </View>
    </View>
  );
}

export default function TabsLayout() {
  const { c } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.text,
        tabBarInactiveTintColor: c.soft,
        tabBarStyle: { backgroundColor: c.tabBar, borderTopColor: c.line, borderTopWidth: 2, height: 86, paddingTop: 8 },
        tabBarLabelStyle: { fontFamily: font.heavy, fontSize: 10.5 },
        sceneStyle: { backgroundColor: c.paper },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Shelves', tabBarIcon: ({ color }) => <TabIcon name="index" color={color} /> }} />
      <Tabs.Screen name="search" options={{ title: 'Search', tabBarIcon: ({ color }) => <TabIcon name="search" color={color} /> }} />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarLabel: () => null,
          tabBarAccessibilityLabel: 'Scan a book',
          tabBarIcon: () => <ScanTabIcon />,
          tabBarStyle: { display: 'none' }, // Store Mode is full-screen with its own close button
        }}
      />
      <Tabs.Screen name="wishlist" options={{ title: 'Wishlist', tabBarIcon: ({ color }) => <TabIcon name="wishlist" color={color} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color }) => <TabIcon name="profile" color={color} /> }} />
    </Tabs>
  );
}
```

- [ ] **Step 2: Rewrite `app/(tabs)/index.tsx`**

```tsx
import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { listLibrary, libraryStats } from '@/db/repository';
import { groupByRoom, mostCopied } from '@/features/shelves/groupByRoom';
import { roomNote, shelvesLines } from '@/features/dewey/lines';
import { greeting } from '@/lib/dates';
import { Bookcase } from '@/components/shelf/Bookcase';
import { Shelf } from '@/components/shelf/Shelf';
import { Dewey } from '@/components/dewey/Dewey';
import { Bubble } from '@/components/ui/Bubble';
import { Button } from '@/components/ui/Button';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { useSettings } from '@/stores/settings';
import { useTheme } from '@/theme/useTheme';
import { PLANKS, ink } from '@/theme/palette';

const DEWEY_ROOM = 120; // horizontal space kept free for Dewey on his shelf

export default function ShelvesScreen() {
  const router = useRouter();
  const { scheme, c } = useTheme();
  const quiet = useSettings((s) => s.quiet);
  const lamp = scheme === 'lamp';
  const { data: rows = [] } = useQuery({ queryKey: ['library'], queryFn: () => listLibrary() });
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: () => libraryStats() });

  const rooms = useMemo(() => groupByRoom(rows), [rows]);
  const lines = useMemo(
    () => shelvesLines({
      totalBooks: stats?.totalBooks ?? 0,
      rooms: rooms.map((r) => ({ name: r.name, count: r.rows.length })),
      mostCopied: mostCopied(rows),
      loaned: stats?.activeLoans ?? 0,
    }),
    [rows, rooms, stats]
  );
  const [lineIdx, setLineIdx] = useState(0);
  const line = lines[lineIdx % lines.length];

  const total = stats?.totalBooks ?? 0;
  const loans = stats?.activeLoans ?? 0;
  const sub = total === 0
    ? 'No books yet. The shelves are patient.'
    : `${total} ${total === 1 ? 'book' : 'books'} on ${rooms.length} ${rooms.length === 1 ? 'shelf' : 'shelves'}${loans ? ` · ${loans} visiting friends` : ''}`;
  const deweyShelf = Math.min(1, Math.max(0, rooms.length - 1));

  const dewey = (
    <>
      <View style={{ position: 'absolute', right: 16, bottom: 18, zIndex: 5 }}>
        <Dewey mood={lamp ? 'sleep' : 'happy'} onPress={quiet || lamp ? undefined : () => setLineIdx((i) => i + 1)} />
      </View>
      {!quiet && !lamp ? <Bubble text={line} width={140} style={{ position: 'absolute', right: 12, top: 30, zIndex: 6 }} /> : null}
    </>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 110 }}>
        <ScreenHeader kicker={greeting(new Date(), lamp)} title="My Library" sub={sub} />
        <Bookcase style={{ marginHorizontal: 12, marginTop: 14 }}>
          {rooms.length === 0 ? (
            <Shelf name="Reserved" count={0} plank={ink.bus} rows={[]} onPressBook={() => {}} reserveRight={DEWEY_ROOM}>
              {dewey}
            </Shelf>
          ) : (
            rooms.map((room, i) => (
              <Shelf
                key={room.name}
                name={room.name}
                count={room.rows.length}
                note={quiet ? null : roomNote(room)}
                plank={PLANKS[i % PLANKS.length]}
                rows={room.rows}
                withPlant={i === 0}
                reserveRight={i === deweyShelf ? DEWEY_ROOM : 0}
                onPressBook={(r) => router.push({ pathname: '/book/[id]', params: { id: r.id } })}
              >
                {i === deweyShelf ? dewey : null}
              </Shelf>
            ))
          )}
        </Bookcase>
        {rooms.length === 0 ? (
          <View style={{ marginHorizontal: 20, marginTop: 22 }}>
            <Button label="Scan your first book" onPress={() => router.navigate('/scan')} />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
```

- [ ] **Step 3: Typecheck, then check on device**

Run: `npm run typecheck` — Expected: exit 0.
Run: `npx expo start`, open in Expo Go. Expected: bookcase with one shelf per room, room tags + tape notes, plant at end of the first shelf, Dewey + bubble on shelf 2 (or 1), tapping Dewey rotates lines, tapping a spine lifts it and opens detail; empty DB shows the Reserved shelf + "Scan your first book". Switch the phone to dark mode: Lamplight (oak frame, sleeping Dewey, no bubble).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(shelves): painted bookcase home with rooms, tape notes and Dewey; new tab bar"
```

---

### Task 7: Store Mode — viewfinder, verdict sheet, scan screen

**Files:**
- Create: `src/features/scanner/ScanViewfinder.tsx`, `src/features/scanner/VerdictSheet.tsx`
- Modify: `app/(tabs)/scan.tsx`

**Interfaces:**
- Consumes: `useScanPipeline` (`current: ScanResult | null`, `sessionCount`, `onBarcode`, `dismiss`), `upsertBook`, `addUserBook`, `listRooms`, `libraryStats`, `ownedLine`, `newFindLine`, `hashString`, `CoverArt`, `Stamp`, `Sticker`, `Chip`, `Button`, `Bubble`, `Dewey`, `LeaderRow`, `Toast`.
- Produces: `ScanViewfinder({ locked: boolean })`; `VerdictSheet({ result: ScanResult; rooms: string[]; quiet: boolean; onKeepScanning: () => void; onAdd: (status: 'owned' | 'wishlist', room: string | null) => void })`.

- [ ] **Step 1: `src/features/scanner/ScanViewfinder.tsx`**

```tsx
import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import { ink } from '@/theme/palette';

const SIZE = 250;
const corner = (pos: object, radii: object) => (
  <View style={[{ position: 'absolute', width: 44, height: 44, borderColor: ink.bus }, pos, radii]} />
);

/** Yellow corner viewfinder. The line roams until a code is read, then locks and the frame squeezes. */
export function ScanViewfinder({ locked }: { locked: boolean }) {
  const reduced = useReducedMotion();
  const y = useSharedValue(0.5);
  const squeeze = useSharedValue(1);

  useEffect(() => {
    if (locked) {
      cancelAnimation(y);
      y.value = withTiming(0.62, { duration: 120 });
      squeeze.value = withSequence(withTiming(0.95, { duration: 120 }), withTiming(1, { duration: 160 }));
    } else if (!reduced) {
      y.value = 0;
      y.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.ease) }), -1, true);
    }
  }, [locked, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  const line = useAnimatedStyle(() => ({ transform: [{ translateY: 26 + y.value * (SIZE - 52) }] }));
  const frame = useAnimatedStyle(() => ({ transform: [{ scale: squeeze.value }] }));

  return (
    <Animated.View pointerEvents="none" style={[{ width: SIZE, height: SIZE }, frame]}>
      {corner({ left: 0, top: 0, borderLeftWidth: 5, borderTopWidth: 5 }, { borderTopLeftRadius: 14 })}
      {corner({ right: 0, top: 0, borderRightWidth: 5, borderTopWidth: 5 }, { borderTopRightRadius: 14 })}
      {corner({ left: 0, bottom: 0, borderLeftWidth: 5, borderBottomWidth: 5 }, { borderBottomLeftRadius: 14 })}
      {corner({ right: 0, bottom: 0, borderRightWidth: 5, borderBottomWidth: 5 }, { borderBottomRightRadius: 14 })}
      <Animated.View style={[{ position: 'absolute', left: 14, right: 14, height: 4, borderRadius: 3, backgroundColor: ink.bus, borderWidth: 1.5, borderColor: ink.brown }, line]} />
    </Animated.View>
  );
}
```

- [ ] **Step 2: `src/features/scanner/VerdictSheet.tsx`**

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import type { ScanResult } from './useScanPipeline';
import { ownedLine, newFindLine } from '@/features/dewey/lines';
import { hashString } from '@/features/shelves/spineStyle';
import { CoverArt } from '@/components/shelf/CoverArt';
import { Dewey } from '@/components/dewey/Dewey';
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

export function VerdictSheet({
  result, rooms, quiet, onKeepScanning, onAdd,
}: {
  result: ScanResult; rooms: string[]; quiet: boolean;
  onKeepScanning: () => void; onAdd: (status: 'owned' | 'wishlist', room: string | null) => void;
}) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { verdict: v, meta, metaLoading, isbn13 } = result;
  const owned = v.owned;
  const title = v.book?.title ?? meta?.title ?? `ISBN ${isbn13}`;
  const author = (v.book?.authors ?? meta?.authors ?? [])[0];
  const edition = [v.book?.publisher ?? meta?.publisher, v.book?.publishedYear ?? meta?.publishedYear].filter(Boolean).join(', ');
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
  const line = owned ? ownedLine(v.copies, v.exactIsbnMatch) : newFindLine(hashString(isbn13));

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
      <View style={{ position: 'absolute', right: 16, top: -56, zIndex: 11 }}>
        <Dewey mood={owned ? 'smug' : 'gasp'} size={70} pop popDelay={T_DEWEY} />
      </View>
      {say && !quiet ? <Bubble text={line} width={176} style={{ position: 'absolute', right: 90, top: -66, zIndex: 11 }} /> : null}

      <Text accessibilityRole="header" style={{ fontFamily: font.display, fontSize: 40, lineHeight: 44, color: fg }}>
        {owned ? 'You own this!' : 'A new find!'}
      </Text>

      <Animated.View style={[{ marginTop: 14 }, card]}>
        <Raised offset={3} radius={14}>
          <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center', backgroundColor: ink.white, borderWidth: 2.5, borderColor: ink.brown, borderRadius: 14, padding: 12 }}>
            <CoverArt id={v.book?.id ?? isbn13} title={title} coverUrl={v.book?.coverUrl ?? meta?.coverUrl} width={62} height={92} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={2} style={{ fontFamily: font.black, fontSize: 17, color: ink.brown }}>{title}</Text>
              {author || edition ? <Text numberOfLines={1} style={{ fontFamily: font.bold, fontSize: 13, color: ink.soft, marginTop: 2 }}>{[author, edition].filter(Boolean).join(' · ')}</Text> : null}
              {owned ? (
                <View style={{ marginTop: 4 }}>
                  <LeaderRow label="Copies" value={String(v.copies)} />
                  {perRoom.slice(0, 2).map(([name, n]) => <LeaderRow key={name} label={name} value={String(n)} />)}
                </View>
              ) : metaLoading ? (
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 6 }}>
                  <ActivityIndicator color={ink.brown} />
                  <Text style={{ fontFamily: font.bold, fontSize: 13, color: ink.soft }}>Dewey is looking it up…</Text>
                </View>
              ) : !meta && !v.book ? (
                <Text style={{ fontFamily: font.bold, fontSize: 13, color: ink.soft, marginTop: 4 }}>Couldn't reach the catalog. You can still add it by ISBN.</Text>
              ) : (
                <Text style={{ fontFamily: font.heavy, fontSize: 13, color: ink.grass, marginTop: 4 }}>Not on any shelf · not on your wishlist</Text>
              )}
            </View>
          </View>
        </Raised>
        {owned ? (
          <Stamp label="ALREADY YOURS" play delay={T_MARK} onLand={onStampLand} style={{ position: 'absolute', right: 10, top: -18 }} />
        ) : (
          <Sticker label="NEW!" play delay={T_MARK} style={{ position: 'absolute', right: -8, top: -18 }} />
        )}
      </Animated.View>

      {owned ? (
        <>
          <Text style={{ fontFamily: font.heavy, fontSize: 13.5, color: fg, marginTop: 12 }}>
            {v.exactIsbnMatch ? 'Same edition you scanned. Put it back gently.' : `Different edition. You own ${v.copies} of this title.`}
          </Text>
          <View style={{ marginTop: 16 }}>
            <Button label="Keep scanning" onPress={onKeepScanning} />
          </View>
          <Pressable onPress={() => onAdd('owned', v.userBooks[0]?.location ?? null)} accessibilityRole="button" style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 }}>
            <Text style={{ fontFamily: font.heavy, fontSize: 13.5, color: fg, textDecorationLine: 'underline' }}>{`Add copy #${v.copies + 1} anyway`}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={{ fontFamily: font.heavy, fontSize: 13, color: ink.brown, marginTop: 14 }}>Shelve it in</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {rooms.map((r) => <Chip key={r} label={r} selected={room === r} onPress={() => setRoom(r)} />)}
          </View>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <Button variant="ghost" flex label="Wishlist it" onPress={() => onAdd('wishlist', null)} disabled={metaLoading} />
            <Button flex label="Add to shelves" onPress={() => onAdd('owned', room)} disabled={metaLoading} />
          </View>
          <Pressable onPress={onKeepScanning} accessibilityRole="button" style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 }}>
            <Text style={{ fontFamily: font.heavy, fontSize: 13.5, color: ink.brown, textDecorationLine: 'underline' }}>Not now, keep scanning</Text>
          </Pressable>
        </>
      )}
    </Animated.View>
  );
}
```

- [ ] **Step 3: Rewrite `app/(tabs)/scan.tsx`**

```tsx
import React, { useMemo, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Svg, { Path } from 'react-native-svg';
import { useQueryClient } from '@tanstack/react-query';
import { useScanPipeline } from '@/features/scanner/useScanPipeline';
import { ScanViewfinder } from '@/features/scanner/ScanViewfinder';
import { VerdictSheet } from '@/features/scanner/VerdictSheet';
import { addUserBook, libraryStats, listRooms, upsertBook } from '@/db/repository';
import { Button } from '@/components/ui/Button';
import { Toast } from '@/components/ui/Toast';
import { useSettings } from '@/stores/settings';
import { font, ink, radius } from '@/theme/palette';

const DEFAULT_ROOMS = ['Living room', 'Bedroom', 'Study'];
const SCENE = '#1B130D';

function CloseButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Close Store Mode"
      style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: ink.white, borderWidth: 2.5, borderColor: ink.brown, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={18} height={18} stroke={ink.brown} strokeWidth={3}><Path d="M3 3l12 12M15 3L3 15" /></Svg>
    </Pressable>
  );
}

export default function ScanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const quiet = useSettings((s) => s.quiet);
  const [permission, requestPermission] = useCameraPermissions();
  const { current, sessionCount, onBarcode, dismiss } = useScanPipeline();
  const qc = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const rooms = useMemo(() => {
    const r = listRooms();
    return r.length ? r : DEFAULT_ROOMS;
  }, [current?.isbn13]); // refresh when a new book is scanned

  const close = () => router.navigate('/');

  const addAs = (status: 'owned' | 'wishlist', room: string | null) => {
    if (!current) return;
    const { verdict, meta, isbn13 } = current;
    const book =
      verdict.book ??
      upsertBook(meta ?? {
        isbn13, isbn10: null, title: `ISBN ${isbn13}`, subtitle: null, authors: [], publisher: null, publishedYear: null,
        edition: null, genres: [], pageCount: null, coverUrl: null, description: null, workKey: null, source: 'manual',
      });
    addUserBook(book.id, status, status === 'owned' ? room ?? undefined : undefined);
    qc.invalidateQueries({ queryKey: ['library'] });
    qc.invalidateQueries({ queryKey: ['stats'] });
    const total = libraryStats().totalBooks;
    dismiss();
    setToast(status === 'owned' ? `Shelved in ${room ?? 'Unshelved'}. Book #${total}.` : 'Wishlisted. The Someday shelf grows.');
    setTimeout(() => setToast(null), 1800);
  };

  if (!permission) return <View style={{ flex: 1, backgroundColor: SCENE }} />;
  if (!permission.granted) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: SCENE, padding: 28, justifyContent: 'center' }}>
        <View style={{ position: 'absolute', top: insets.top + 8, left: 16 }}><CloseButton onPress={close} /></View>
        <Text style={{ fontFamily: font.display, fontSize: 32, lineHeight: 36, color: ink.white }}>Point, scan, know instantly</Text>
        <Text style={{ fontFamily: font.bold, fontSize: 15, lineHeight: 21, color: '#D9C3A0', marginTop: 10 }}>
          My Library needs the camera to read book barcodes. Nothing is recorded or uploaded.
        </Text>
        <View style={{ marginTop: 24 }}>
          {permission.canAskAgain ? (
            <Button label="Allow camera" onPress={requestPermission} />
          ) : (
            <Button label="Open Settings" onPress={() => Linking.openSettings()} />
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: SCENE }}>
      <CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ['ean13'] }} onBarcodeScanned={({ data }) => onBarcode(data)} />
      <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', alignItems: 'center' }}>
        <CloseButton onPress={close} />
        <View style={{ flex: 1, alignItems: 'center', marginRight: 44 }}>
          <View style={{ backgroundColor: ink.bus, borderWidth: 2.5, borderColor: ink.brown, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6 }}>
            <Text style={{ fontFamily: font.black, fontSize: 12, letterSpacing: 0.8, color: ink.brown }}>{`STORE MODE · ${sessionCount} SCANNED`}</Text>
          </View>
        </View>
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + 100, left: 0, right: 0, alignItems: 'center' }}>
        <ScanViewfinder locked={!!current} />
        {!current ? <Text style={{ fontFamily: font.heavy, fontSize: 14, color: ink.paper, marginTop: 18 }}>Point at a barcode. I'll do the rest.</Text> : null}
      </View>
      {current ? (
        <VerdictSheet key={current.isbn13} result={current} rooms={rooms} quiet={quiet} onKeepScanning={dismiss} onAdd={addAs} />
      ) : null}
      <Toast text={toast} />
    </View>
  );
}
```

- [ ] **Step 4: Typecheck, then check on device**

Run: `npm run typecheck` — Expected: exit 0.
On device: open Scan → tab bar hidden, close (X) returns to Shelves. Scan a book you own → line locks, green sheet rises, stamp slams with a heavy haptic and shake, Dewey pops, bubble "Copy #N?…". Scan an unknown book → "Dewey is looking it up…", then NEW! sticker, room chips; "Add to shelves" → sheet disappears, toast "Shelved in … Book #N." Turn on Reduce Motion → stamp appears without the slam, no pop/shake, line static.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(store-mode): roaming viewfinder, stamped verdict sheet, Dewey reactions, add toast"
```

---

### Task 8: Book detail

**Files:**
- Modify: `app/book/[id].tsx`

**Interfaces:**
- Consumes: `getLibraryRow`, `listCopiesOfBook`, `listLibrary`, `setLocation`, `setStatus`, `listRooms`, `CoverArt`, `Spine`, `PocketCard`, `LeaderRow`, `TapeNote`, `Chip`, `Button`, `Dewey`, `Raised`.

- [ ] **Step 1: Rewrite `app/book/[id].tsx`**

```tsx
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { getLibraryRow, listCopiesOfBook, listLibrary, listRooms, setLocation, setStatus } from '@/db/repository';
import { UNSHELVED } from '@/features/shelves/groupByRoom';
import { CoverArt } from '@/components/shelf/CoverArt';
import { Spine } from '@/components/shelf/Spine';
import { Dewey } from '@/components/dewey/Dewey';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { LeaderRow, PocketCard } from '@/components/ui/PocketCard';
import { Raised } from '@/components/ui/Raised';
import { TapeNote } from '@/components/ui/TapeNote';
import { font, ink, radius } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

const daysSince = (iso: string) => Math.max(1, Math.round((Date.now() - new Date(iso.replace(' ', 'T')).getTime()) / 86400000));

export default function BookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { c } = useTheme();
  const [moving, setMoving] = useState(false);
  const { data: row } = useQuery({ queryKey: ['book', id], queryFn: () => getLibraryRow(id) });
  const { data: all = [] } = useQuery({ queryKey: ['library'], queryFn: () => listLibrary() });
  const copies = useMemo(() => (row ? listCopiesOfBook(row.bookId) : []), [row]);
  const rooms = useMemo(() => listRooms(), [row]);
  if (!row) return <View style={{ flex: 1, backgroundColor: c.paper }} />;

  const room = row.location?.trim() || UNSHELVED;
  const neighbours = all.filter((r) => (r.location?.trim() || UNSHELVED) === room && r.status !== 'wishlist');
  const at = neighbours.findIndex((r) => r.id === row.id);
  const left = neighbours.slice(Math.max(0, at - 3), Math.max(0, at));
  const right = neighbours.slice(at + 1, at + 4);
  const loaned = copies.find((cp) => cp.borrower);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['book', id] });
    qc.invalidateQueries({ queryKey: ['library'] });
    qc.invalidateQueries({ queryKey: ['stats'] });
  };

  const primary =
    row.status === 'wishlist'
      ? { label: 'Found it!', run: () => { setStatus(row.id, 'owned'); refresh(); } }
      : loaned
        ? { label: `Nudge ${loaned.borrower}`, run: () => Share.share({ message: `Hi ${loaned.borrower}! How is ${row.book.title} treating you? No rush. (Some rush.)` }) }
        : row.status === 'read'
          ? { label: 'Mark as unread', run: () => { setStatus(row.id, 'owned'); refresh(); } }
          : { label: 'Mark as read', run: () => { setStatus(row.id, 'read'); refresh(); } };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 4 }}>
          <Raised offset={2} radius={22}>
            <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back to your shelves"
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: ink.white, borderWidth: 2.5, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
              <Svg width={20} height={20} fill="none" stroke={ink.brown} strokeWidth={2.8}><Path d="M13 4l-7 6 7 6" /></Svg>
            </Pressable>
          </Raised>
        </View>

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

        <View style={{ flexDirection: 'row', gap: 18, paddingHorizontal: 20, paddingTop: 22, alignItems: 'flex-end' }}>
          <Animated.View entering={FadeInUp.duration(600).withInitialValues({ transform: [{ translateY: -120 }, { scale: 0.5 }] })} style={{ transform: [{ rotate: '-4deg' }] }}>
            <Raised offset={5} radius={6}>
              <CoverArt id={row.bookId} title={row.book.title} author={row.book.authors[0]} coverUrl={row.book.coverUrl} width={132} height={196} />
            </Raised>
          </Animated.View>
          <View style={{ flex: 1, paddingBottom: 6 }}>
            <Text accessibilityRole="header" style={{ fontFamily: font.display, fontSize: 34, lineHeight: 38, color: c.text }}>{row.book.title}</Text>
            <Text style={{ fontFamily: font.heavy, fontSize: 14, color: c.soft, marginTop: 4 }}>{row.book.authors.join(', ')}</Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              <Chip label={row.status === 'read' ? 'Read' : row.status === 'wishlist' ? 'Wishlist' : row.status === 'reading' ? 'Reading' : 'On the shelf'} selected onPress={() => {}} />
              {row.rating ? <Chip label={`★ ${row.rating}`} onPress={() => {}} /> : null}
            </View>
          </View>
        </View>

        <PocketCard title={`Pocket card · ${copies.length} ${copies.length === 1 ? 'copy' : 'copies'}`} style={{ marginHorizontal: 16, marginTop: 22 }}>
          {copies.map((cp, i) => (
            <LeaderRow key={cp.id} label={`Copy ${i + 1}`} value={cp.borrower ? `Visiting ${cp.borrower}` : cp.location?.trim() || UNSHELVED} />
          ))}
          {row.book.publisher || row.book.publishedYear ? <LeaderRow label="Edition" value={[row.book.publisher, row.book.publishedYear].filter(Boolean).join(', ')} /> : null}
          <LeaderRow label="ISBN" value={row.book.isbn13 ?? '—'} />
        </PocketCard>

        {loaned?.loanedAt ? (
          <View style={{ marginHorizontal: 16, marginTop: 14, flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: ink.tape, borderWidth: 2, borderColor: c.line, borderRadius: 10, padding: 10 }}>
            <Dewey size={38} />
            <Text style={{ flex: 1, fontFamily: font.heavy, fontSize: 13, color: ink.brown }}>
              {`A copy has been visiting ${loaned.borrower} for ${daysSince(loaned.loanedAt)} days.`}
            </Text>
          </View>
        ) : null}

        {moving ? (
          <View style={{ marginHorizontal: 16, marginTop: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(rooms.length ? rooms : ['Living room', 'Bedroom', 'Study']).map((r) => (
              <Chip key={r} label={r} selected={r === room} onPress={() => { setLocation(row.id, r); setMoving(false); refresh(); }} />
            ))}
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 10, marginHorizontal: 16, marginTop: 16 }}>
          <Button variant="ghost" flex label={moving ? 'Cancel' : 'Move shelf'} onPress={() => setMoving((m) => !m)} />
          <Button flex label={primary.label} onPress={primary.run} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
```

- [ ] **Step 2: Typecheck, then check on device**

Run: `npm run typecheck` — Expected: exit 0.
On device: tap a spine → detail; cover drops in from above, mini shelf shows neighbours with the dashed HERE gap; pocket card lists copies; "Move shelf" shows room chips and moving updates the tape note; primary button toggles read / Found it!.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(book): pulled-off-the-shelf detail with pocket card, loans, move shelf"
```

---

### Task 9: Search and Wishlist

**Files:**
- Modify: `app/(tabs)/search.tsx`, `app/(tabs)/wishlist.tsx`

**Interfaces:**
- Consumes: `searchLibrary`, `lookupIsbn`, `normalizeToIsbn13` (`src/lib/isbn.ts`), `upsertBook`, `addUserBook`, `listLibrary`, `setStatus`, `searchAside`, `wishlistLine`, `wantedSince`, `Spine`, `Shelf`, `Bookcase`, `Dewey`, `Bubble`, `Raised`, `ScreenHeader`.

- [ ] **Step 1: Rewrite `app/(tabs)/search.tsx`**

```tsx
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Svg, { Circle, Path } from 'react-native-svg';
import { addUserBook, searchLibrary, upsertBook } from '@/db/repository';
import { lookupIsbn } from '@/api/bookLookup';
import { normalizeToIsbn13 } from '@/lib/isbn';
import { searchAside } from '@/features/dewey/lines';
import { UNSHELVED } from '@/features/shelves/groupByRoom';
import { Spine } from '@/components/shelf/Spine';
import { Raised } from '@/components/ui/Raised';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { useSettings } from '@/stores/settings';
import { font, ink } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

function Section({ label, count }: { label: string; count: number }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginTop: 18, marginBottom: 8 }}>
      <View style={{ width: 18, height: 2, backgroundColor: c.text }} />
      <Text style={{ fontFamily: font.black, fontSize: 13, color: c.text }}>{label}</Text>
      <Text style={{ fontFamily: font.bold, fontSize: 13, color: c.soft }}>{`· ${count}`}</Text>
    </View>
  );
}

function ResultRow({ id, title, sub, right, onPress }: { id: string; title: string; sub: string; right: React.ReactNode; onPress?: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 10, backgroundColor: ink.white, borderWidth: 2, borderColor: c.line, borderRadius: 12, padding: 10, minHeight: 68 }}>
      <Spine id={id} title="" scale={0.45} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: font.black, fontSize: 15, color: ink.brown }}>{title}</Text>
        <Text numberOfLines={1} style={{ fontFamily: font.bold, fontSize: 12.5, color: ink.soft, marginTop: 2 }}>{sub}</Text>
      </View>
      {right}
    </Pressable>
  );
}

export default function SearchScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { c } = useTheme();
  const quiet = useSettings((s) => s.quiet);
  const [q, setQ] = useState('');
  const term = q.trim();
  const isbn = normalizeToIsbn13(term);
  const { data: mine = [] } = useQuery({ queryKey: ['search', term], queryFn: () => searchLibrary(term), enabled: term.length >= 2 });
  const { data: catalog } = useQuery({ queryKey: ['isbn', isbn], queryFn: () => lookupIsbn(isbn!), enabled: !!isbn });
  const ownedHit = mine.some((r) => r.book.isbn13 === isbn);

  const add = () => {
    if (!catalog) return;
    const book = upsertBook(catalog);
    addUserBook(book.id, 'owned');
    qc.invalidateQueries();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }} edges={['top']}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 110 }}>
        <ScreenHeader title="Search" />
        <Raised offset={3} radius={14} style={{ marginHorizontal: 16, marginTop: 12 }}>
          <View style={{ height: 54, backgroundColor: ink.white, borderWidth: 2.5, borderColor: c.line, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 }}>
            <Svg width={22} height={22} fill="none" stroke={ink.brown} strokeWidth={2.6}><Circle cx={10} cy={10} r={6} /><Path d="M15 15l5 5" /></Svg>
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Title, author or ISBN"
              placeholderTextColor={ink.soft}
              accessibilityLabel="Search your shelves"
              autoCorrect={false}
              returnKeyType="search"
              style={{ flex: 1, fontFamily: font.heavy, fontSize: 16, color: ink.brown }}
            />
          </View>
        </Raised>
        {!quiet ? <Text style={{ marginHorizontal: 20, marginTop: 10, fontFamily: font.hand, fontSize: 16, color: c.soft }}>{searchAside(term, mine.length)}</Text> : null}

        {term.length >= 2 ? (
          <>
            <Section label="On your shelves" count={mine.length} />
            {mine.map((r) => (
              <ResultRow key={r.id} id={r.id} title={r.book.title}
                sub={[r.book.authors[0], r.book.publisher, r.book.publishedYear].filter(Boolean).join(' · ')}
                right={<Text style={{ fontFamily: font.black, fontSize: 11.5, color: ink.brown }}>{r.location?.trim() || UNSHELVED}</Text>}
                onPress={() => router.push({ pathname: '/book/[id]', params: { id: r.id } })} />
            ))}
          </>
        ) : null}

        {isbn && catalog && !ownedHit ? (
          <>
            <Section label="From the catalog" count={1} />
            <ResultRow id={isbn} title={catalog.title} sub={[catalog.authors[0], catalog.publishedYear].filter(Boolean).join(' · ')}
              right={
                <Pressable onPress={add} accessibilityRole="button" accessibilityLabel={`Add ${catalog.title}`} hitSlop={6}
                  style={{ height: 36, paddingHorizontal: 14, borderWidth: 2, borderColor: c.line, borderRadius: 10, backgroundColor: ink.bus, justifyContent: 'center' }}>
                  <Text style={{ fontFamily: font.black, fontSize: 13, color: ink.brown }}>+ Add</Text>
                </Pressable>
              } />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
```

- [ ] **Step 2: Rewrite `app/(tabs)/wishlist.tsx`**

```tsx
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listLibrary, setStatus } from '@/db/repository';
import { wishlistLine } from '@/features/dewey/lines';
import { wantedSince } from '@/lib/dates';
import { Bookcase } from '@/components/shelf/Bookcase';
import { Shelf } from '@/components/shelf/Shelf';
import { Spine } from '@/components/shelf/Spine';
import { Dewey } from '@/components/dewey/Dewey';
import { Bubble } from '@/components/ui/Bubble';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { useSettings } from '@/stores/settings';
import { font, ink } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

export default function WishlistScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { c } = useTheme();
  const quiet = useSettings((s) => s.quiet);
  const { data: rows = [] } = useQuery({ queryKey: ['library', 'wishlist'], queryFn: () => listLibrary({ status: 'wishlist' }) });
  const oldest = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const now = new Date();
  const found = (id: string) => {
    setStatus(id, 'owned');
    qc.invalidateQueries();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 110 }}>
        <ScreenHeader title="Wishlist" sub={rows.length ? `${rows.length} ${rows.length === 1 ? 'book' : 'books'} you'll "definitely" read` : 'Scan something in a store and tap Wishlist it.'} />
        <Bookcase style={{ marginHorizontal: 12, marginTop: 14 }}>
          <Shelf name="The Someday shelf" count={rows.length} plank={ink.plum} rows={rows} reserveRight={110}
            onPressBook={(r) => router.push({ pathname: '/book/[id]', params: { id: r.id } })}>
            <View style={{ position: 'absolute', right: 14, bottom: 18 }}><Dewey mood="smug" size={56} /></View>
            {!quiet ? <Bubble text={wishlistLine(rows.length)} width={150} style={{ position: 'absolute', right: 12, top: 28 }} /> : null}
          </Shelf>
        </Bookcase>

        {oldest.length ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginTop: 22, marginBottom: 8 }}>
            <View style={{ width: 18, height: 2, backgroundColor: c.text }} />
            <Text style={{ fontFamily: font.black, fontSize: 13, color: c.text }}>Wanted the longest</Text>
          </View>
        ) : null}
        {oldest.map((r) => (
          <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 10, backgroundColor: ink.white, borderWidth: 2, borderColor: c.line, borderRadius: 10, padding: 10 }}>
            <Spine id={r.id} title="" scale={0.45} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontFamily: font.black, fontSize: 15, color: ink.brown }}>{r.book.title}</Text>
              <Text numberOfLines={1} style={{ fontFamily: font.bold, fontSize: 12.5, color: ink.soft, marginTop: 2 }}>{r.book.authors[0] ?? ''}</Text>
              <View style={{ alignSelf: 'flex-start', marginTop: 5, borderWidth: 2, borderColor: ink.plum, borderRadius: 3, paddingHorizontal: 6, transform: [{ rotate: '-3deg' }] }}>
                <Text style={{ fontFamily: font.black, fontSize: 10, color: ink.plum }}>{wantedSince(r.createdAt, now)}</Text>
              </View>
            </View>
            <Pressable onPress={() => found(r.id)} accessibilityRole="button" accessibilityLabel={`Found ${r.book.title}, move to shelves`} hitSlop={6}
              style={{ height: 38, paddingHorizontal: 12, borderWidth: 2, borderColor: c.line, borderRadius: 10, backgroundColor: ink.bus, justifyContent: 'center' }}>
              <Text style={{ fontFamily: font.black, fontSize: 12.5, color: ink.brown }}>Found it!</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
```

- [ ] **Step 3: Typecheck, then check on device**

Run: `npm run typecheck` — Expected: exit 0.
On device: Search "du" lists your matches with rooms; typing a valid ISBN you don't own shows "From the catalog" with + Add. Wishlist shows the Someday shelf, Dewey's line, slips with WANTED SINCE stamps; "Found it!" moves the book to Shelves.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(search,wishlist): shelves-first search and the Someday shelf"
```

---

### Task 10: Profile, settings, and removing the old world

**Files:**
- Modify: `app/(tabs)/profile.tsx`, `app/_layout.tsx`, `package.json`
- Delete: `src/theme/tokens.ts`, `src/components/BookCover.tsx`

**Interfaces:**
- Consumes: `libraryStats`, `listRooms`, `useSettings`, `PocketCard`, `LeaderRow`, `Chip`, `ScreenHeader`, `Dewey`.

- [ ] **Step 1: Rewrite `app/(tabs)/profile.tsx`**

```tsx
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { libraryStats, listRooms } from '@/db/repository';
import { Chip } from '@/components/ui/Chip';
import { LeaderRow, PocketCard } from '@/components/ui/PocketCard';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Dewey } from '@/components/dewey/Dewey';
import { useSettings } from '@/stores/settings';
import type { ThemePref } from '@/theme/resolveScheme';
import { font } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

const THEMES: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'Match phone' },
  { value: 'light', label: 'Daylight' },
  { value: 'lamp', label: 'Lamplight' },
];

function Label({ children }: { children: string }) {
  const { c } = useTheme();
  return <Text style={{ fontFamily: font.black, fontSize: 13, color: c.text, marginTop: 24, marginBottom: 10 }}>{children}</Text>;
}

export default function ProfileScreen() {
  const { c } = useTheme();
  const { theme, setTheme, quiet, setQuiet } = useSettings();
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: () => libraryStats() });
  const rooms = listRooms();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 110 }}>
        <ScreenHeader title="Profile" />
        <View style={{ paddingHorizontal: 16, marginTop: 14 }}>
          <PocketCard title="Library card">
            <LeaderRow label="Books on shelves" value={String(stats?.totalBooks ?? 0)} />
            <LeaderRow label="Rooms" value={String(rooms.length)} />
            <LeaderRow label="Visiting friends" value={String(stats?.activeLoans ?? 0)} />
            <LeaderRow label="On the wishlist" value={String(stats?.wishlist ?? 0)} />
            {stats?.estValue ? <LeaderRow label="Estimated value" value={`$${stats.estValue.toFixed(0)}`} /> : null}
          </PocketCard>

          <Label>Light</Label>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {THEMES.map((t) => <Chip key={t.value} label={t.label} selected={theme === t.value} onPress={() => setTheme(t.value)} />)}
          </View>

          <Label>Dewey</Label>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Dewey mood={quiet ? 'sleep' : 'happy'} size={48} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Chip label="Chatty" selected={!quiet} onPress={() => setQuiet(false)} />
              <Chip label="Quiet librarian" selected={quiet} onPress={() => setQuiet(true)} />
            </View>
          </View>
          <Text style={{ fontFamily: font.bold, fontSize: 13, color: c.soft, marginTop: 8 }}>
            Quiet hides Dewey's remarks and the shelf notes. Room names and counts stay.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
```

- [ ] **Step 2: Remove the old world**

In `app/_layout.tsx` delete the Fraunces and Nunito imports and their five entries in `useFonts`. Then:

```bash
rm src/theme/tokens.ts src/components/BookCover.tsx
npm uninstall @expo-google-fonts/fraunces @expo-google-fonts/nunito
```

- [ ] **Step 3: Verify nothing references the old world**

Run: `grep -rnE "theme/tokens|BookCover|Fraunces|Nunito" app src` — Expected: no output.
Run: `npm run typecheck && npx jest` — Expected: exit 0; all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(profile): library card, Lamplight and Quiet librarian settings; remove the old nook theme"
```

---

### Task 11: Verify on device, impeccable finish review, DESIGN.md

**Files:**
- Create: `.impeccable/review/*.png` (captures), rewrite `DESIGN.md`, create `.impeccable/design.json` (via the documenter)

- [ ] **Step 1: Device pass (one batched round)** — in Expo Go on an iPhone and an Android phone, capture each screen in Daylight and Lamplight: Shelves, Store Mode owned verdict, Store Mode new find, Book detail, Search (with results), Wishlist, Profile. Save as `.impeccable/review/<screen>-<ios|android>-<light|lamp>.png`. Also check: Reduce Motion on (stamp static, verdict still clear), largest text size (no clipped buttons), empty library.
- [ ] **Step 2: Fix everything that round shows in one batch, recapture once.**
- [ ] **Step 3: Finish review** — spawn `impeccable-finish-reviewer` with: the original request, the spec, the direction contract (`.impeccable/surfaces/app-tabs-index-tsx.md`), the screenshots, the chosen decision comp `.impeccable/mocks/decision/shelf-a.png` as critique reference, `reference/craft-floor.md`, `reference/ios.md` and `reference/android.md`, and the note "native platform: no detector ran". Act on its disposition (ship / fix / rebuild / recapture).
- [ ] **Step 4: Documenter** — spawn `impeccable-documenter` to write DESIGN.md and `.impeccable/design.json` from the built world.
- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "docs(design): DESIGN.md for the Painted Bookcase world; finish review captures"
```
