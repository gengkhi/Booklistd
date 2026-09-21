# Dewey Ratings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user rate a copy by picking one of seven Dewey reactions. Each reaction has its own animation and haptic. The rating is prompted after "Mark as read" and can be changed anytime from book detail.

**Architecture:**
- The rating is the existing `user_books.rating` integer, now **1–7**.
- One pure table, `REACTIONS`, maps each number to its label, Dewey mood, flourish and haptic.
- `Dewey` gains six new faces.
- `ReactionDewey` plays a spring pop plus a flourish, driven by one Reanimated progress value.
- `RatingSheet` is a React Native `Modal`.
- A Supabase migration widens the server CHECK constraint from 1–5 to 1–7.

**Tech Stack:** Expo SDK 57, Reanimated (already used by `Dewey`), react-native-svg, expo-haptics (already installed), Supabase migrations, Jest (jest-expo).

**Spec:** `docs/superpowers/specs/2026-09-21-dewey-ratings-design.md`

## Global Constraints

- **Git:** Sean runs all git and Supabase deploy commands. **Never run `git add`/`git commit`/`git push` or `supabase db push` yourself.** Each task ends with a "Hand-off" step listing commands for Sean.
- **Working directory:** paths are relative to `Booklistd/` (`C:\Users\seanj\Documents\personal\Booklistd\Booklistd`).
- **No new dependencies.**
- **Expo Go:** everything must run in Expo Go SDK 57 on iOS.
- **Scale:** exactly 7 reactions, rating integers 1–7. The only value stored is the integer.
- **Labels, verbatim:** 1 "Put me to sleep" · 2 "Meh." · 3 "Had its moments" · 4 "Good company" · 5 "Couldn't put it down" · 6 "Wrecked me (nicely)" · 7 "Forever shelf".
- **Flourishes, verbatim from the spec:** 1 Drifting z's · 2 Eye-roll · 3 Head tilt · 4 Happy bounce and blush · 5 Sparkle burst · 6 Tissue floats down · 7 Golden glow.
- **Haptics:** 1–3 Light · 4–5 Medium · 6 Heavy · 7 Heavy then Success notification.
- **Reduce motion:** the face fades in, with no pop and no flourish. The haptic still fires.
- **Only the big Dewey animates.** The reaction row is static.
- **Deploy order:** the Supabase migration must be deployed **before** any app build containing ratings 6–7 reaches a device that syncs.
- **Styling:** use existing tokens from `@/theme/palette` and `useTheme()`, plus the motion constants from `@/theme/motion`.
- **Checks after every task:**
  - `npx tsc --noEmit` exits 0.
  - `npx jest` passes.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/features/rating/reactions.ts` | create | `REACTIONS`, `reactionFor`, `isValidRating`, `nextRating`, `shouldPromptRating`, types |
| `src/features/rating/__tests__/reactions.test.ts` | create | Unit tests |
| `src/features/rating/haptics.ts` | create | `fireHaptic(h)` |
| `supabase/migrations/20260921120000_widen_rating_scale.sql` | create | CHECK changes from 1–5 to 1–7 |
| `src/db/repository.ts` | modify | `setRating` |
| `src/components/dewey/Dewey.tsx` | modify | New moods, `still`, animated `pupil` and `blush` |
| `src/components/dewey/flourishes/SparkleBurst.tsx` | create | Front-layer flourish |
| `src/components/dewey/flourishes/Tissue.tsx` | create | Front-layer flourish |
| `src/components/dewey/flourishes/GoldenGlow.tsx` | create | Back-layer flourish |
| `src/components/dewey/ReactionDewey.tsx` | create | Pop + flourish + haptic for one rating |
| `src/components/rating/RatingSheet.tsx` | create | The seven-reaction sheet |
| `src/components/rating/RatingBadge.tsx` | create | Static Dewey + label shown on detail |
| `app/book/[id].tsx` | modify | Prompt on Mark as read, badge, Rate it |
| `DESIGN.md` | modify | Document ratings |

---

### Task 1: The reaction table and rating rules

**Files:**
- Create: `src/features/rating/reactions.ts`
- Test: `src/features/rating/__tests__/reactions.test.ts`

**Interfaces:**
- Consumes: `BookStatus` from `@/lib/types`. This file defines the `ReactionMood` union itself and doesn't import anything from `Dewey`. Task 3 then widens `DeweyMood` to include `ReactionMood`.
- Produces:
  ```ts
  export type ReactionMood = 'bored' | 'meh' | 'hmm' | 'happy' | 'starry' | 'teary' | 'smitten';
  export type Flourish = 'zzz' | 'eyeRoll' | 'headTilt' | 'happyBounce' | 'sparkleBurst' | 'tissue' | 'goldenGlow';
  export type Haptic = 'light' | 'medium' | 'heavy' | 'heavySuccess';
  export interface Reaction { rating: number; label: string; mood: ReactionMood; flourish: Flourish; haptic: Haptic }
  export const REACTIONS: readonly Reaction[];
  export const HAPTIC_RANK: Record<Haptic, number>;
  export function reactionFor(rating: number | null | undefined): Reaction | null;
  export function isValidRating(n: unknown): n is number;
  export function nextRating(current: number | null, tapped: number): number | null;
  export function shouldPromptRating(prev: BookStatus, next: BookStatus): boolean;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/features/rating/__tests__/reactions.test.ts`:

```ts
import { HAPTIC_RANK, isValidRating, nextRating, REACTIONS, reactionFor, shouldPromptRating } from '../reactions';

describe('REACTIONS', () => {
  it('has exactly seven reactions numbered 1 to 7 in order', () => {
    expect(REACTIONS.map((r) => r.rating)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it('uses the agreed labels and flourishes', () => {
    expect(REACTIONS.map((r) => r.label)).toEqual([
      'Put me to sleep', 'Meh.', 'Had its moments', 'Good company', "Couldn't put it down", 'Wrecked me (nicely)', 'Forever shelf',
    ]);
    expect(REACTIONS.map((r) => r.flourish)).toEqual(['zzz', 'eyeRoll', 'headTilt', 'happyBounce', 'sparkleBurst', 'tissue', 'goldenGlow']);
  });
  it('never gets gentler as the rating goes up', () => {
    for (let i = 1; i < REACTIONS.length; i++) {
      expect(HAPTIC_RANK[REACTIONS[i].haptic]).toBeGreaterThanOrEqual(HAPTIC_RANK[REACTIONS[i - 1].haptic]);
    }
  });
});

describe('reactionFor', () => {
  it('finds a reaction by rating, and nothing for unrated or out of range', () => {
    expect(reactionFor(6)?.label).toBe('Wrecked me (nicely)');
    expect(reactionFor(null)).toBeNull();
    expect(reactionFor(9)).toBeNull();
  });
});

describe('isValidRating', () => {
  it('accepts integers 1 to 7 only', () => {
    [1, 4, 7].forEach((n) => expect(isValidRating(n)).toBe(true));
    [0, 8, 2.5, NaN, -1, '3', null].forEach((n) => expect(isValidRating(n)).toBe(false));
  });
});

describe('nextRating', () => {
  it('sets a new reaction, and clears it when the current one is tapped again', () => {
    expect(nextRating(null, 5)).toBe(5);
    expect(nextRating(3, 5)).toBe(5);
    expect(nextRating(5, 5)).toBeNull();
  });
});

describe('shouldPromptRating', () => {
  it('prompts only when a book becomes read', () => {
    expect(shouldPromptRating('owned', 'read')).toBe(true);
    expect(shouldPromptRating('reading', 'read')).toBe(true);
    expect(shouldPromptRating('read', 'read')).toBe(false);
    expect(shouldPromptRating('read', 'owned')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest src/features/rating/__tests__/reactions.test.ts`
Expected: FAIL with `Cannot find module '../reactions'`.

- [ ] **Step 3: Write the implementation**

Create `src/features/rating/reactions.ts`:

```ts
import type { BookStatus } from '@/lib/types';

/** Dewey faces used by ratings (4 reuses the existing 'happy'). */
export type ReactionMood = 'bored' | 'meh' | 'hmm' | 'happy' | 'starry' | 'teary' | 'smitten';
export type Flourish = 'zzz' | 'eyeRoll' | 'headTilt' | 'happyBounce' | 'sparkleBurst' | 'tissue' | 'goldenGlow';
export type Haptic = 'light' | 'medium' | 'heavy' | 'heavySuccess';

export interface Reaction { rating: number; label: string; mood: ReactionMood; flourish: Flourish; haptic: Haptic }

/** The whole rating scale. Only `rating` is stored (user_books.rating, 1–7). */
export const REACTIONS: readonly Reaction[] = [
  { rating: 1, label: 'Put me to sleep', mood: 'bored', flourish: 'zzz', haptic: 'light' },
  { rating: 2, label: 'Meh.', mood: 'meh', flourish: 'eyeRoll', haptic: 'light' },
  { rating: 3, label: 'Had its moments', mood: 'hmm', flourish: 'headTilt', haptic: 'light' },
  { rating: 4, label: 'Good company', mood: 'happy', flourish: 'happyBounce', haptic: 'medium' },
  { rating: 5, label: "Couldn't put it down", mood: 'starry', flourish: 'sparkleBurst', haptic: 'medium' },
  { rating: 6, label: 'Wrecked me (nicely)', mood: 'teary', flourish: 'tissue', haptic: 'heavy' },
  { rating: 7, label: 'Forever shelf', mood: 'smitten', flourish: 'goldenGlow', haptic: 'heavySuccess' },
];

export const HAPTIC_RANK: Record<Haptic, number> = { light: 0, medium: 1, heavy: 2, heavySuccess: 3 };

export function isValidRating(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= REACTIONS.length;
}

export function reactionFor(rating: number | null | undefined): Reaction | null {
  return isValidRating(rating) ? REACTIONS[rating - 1] : null;
}

/** Tapping the current reaction clears the rating. */
export function nextRating(current: number | null, tapped: number): number | null {
  return current === tapped ? null : tapped;
}

export function shouldPromptRating(prev: BookStatus, next: BookStatus): boolean {
  return prev !== 'read' && next === 'read';
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx jest src/features/rating/__tests__/reactions.test.ts`
Expected: PASS, 7 tests.

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Hand-off**

```
git add src/features/rating/reactions.ts src/features/rating/__tests__/reactions.test.ts
git commit -m "feat(rating): seven Dewey reactions and rating rules"
```

---

### Task 2: Server scale 1–7 and `setRating`

**Files:**
- Create: `supabase/migrations/20260921120000_widen_rating_scale.sql`
- Modify: `src/db/repository.ts` (`updateUserBook` and a new `setRating`)

**Interfaces:**
- Consumes: `isValidRating` (Task 1).
- Produces: `export function setRating(userBookId: string, rating: number | null): void`. It throws `Error('Rating must be a whole number from 1 to 7.')` for invalid values, and otherwise updates the row and queues a `pending_ops` upsert.

> **Testing note:** `expo-sqlite` doesn't run under Jest. The validation is `isValidRating`, which Task 1 already tests, and `setRating` only delegates to it. This task is checked with `tsc` and Jest.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260921120000_widen_rating_scale.sql`:

```sql
-- Dewey ratings: seven reactions (1–7) replace the 1–5 star scale.
-- The original constraint was declared inline, so its name is Postgres-generated;
-- drop any CHECK on user_books that mentions rating rather than guessing the name.
do $$
declare c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.user_books'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%rating%'
  loop
    execute format('alter table public.user_books drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.user_books
  add constraint user_books_rating_check check (rating between 1 and 7);
```

Also update the mirror comment in `supabase/migrations/0001_init.sql`? **No.** Migrations are history and never get edited. The SQLite schema has no CHECK on `rating`, so there's nothing to change on the device.

- [ ] **Step 2: Add `setRating`**

In `src/db/repository.ts`, add to the imports:

```ts
import { isValidRating } from '@/features/rating/reactions';
```

Replace `updateUserBook` with:

```ts
function updateUserBook(userBookId: string, column: 'status' | 'location' | 'rating', value: string | number | null) {
  const d = getDb();
  d.runSync(`UPDATE user_books SET ${column} = ?, updated_at = datetime('now') WHERE id = ?`, [value, userBookId]);
  const row = d.getFirstSync<any>('SELECT * FROM user_books WHERE id = ?', [userBookId]);
  if (row) enqueue('user_books', userBookId, 'upsert', row);
}
```

Add after `setLocation`:

```ts
/** Dewey rating 1–7 (see src/features/rating/reactions.ts); null clears it. */
export function setRating(userBookId: string, rating: number | null): void {
  if (rating !== null && !isValidRating(rating)) throw new Error('Rating must be a whole number from 1 to 7.');
  updateUserBook(userBookId, 'rating', rating);
}
```

- [ ] **Step 3: Type-check and run the tests**

Run: `npx tsc --noEmit && npx jest`
Expected: tsc exits 0. All suites pass.

- [ ] **Step 4: Hand-off, including the deploy**

Tell Sean that this migration **must be deployed before the ratings UI ships**. Give him:

```
npx supabase login
npx supabase link --project-ref rmevekabhdfvztnanmrp
npx supabase migration list          # check which migrations the remote already has
npx supabase db push                 # applies 20260921120000_widen_rating_scale.sql
git add supabase/migrations/20260921120000_widen_rating_scale.sql src/db/repository.ts
git commit -m "feat(rating): widen rating scale to 1-7 and add setRating"
```

If `migration list` shows `0001_init` or `harden_touch_updated_at` as not applied remotely but they were applied by hand in the SQL editor, run `npx supabase migration repair --status applied <version>` for them **before** `db push`. Otherwise `db push` will try to create the tables again.

---

### Task 3: Dewey's reaction faces

**Files:**
- Modify: `src/components/dewey/Dewey.tsx`

**Interfaces:**
- Consumes: `ReactionMood` (Task 1).
- Produces:
  ```ts
  export type DeweyMood = 'happy' | 'smug' | 'gasp' | 'sleep' | ReactionMood;
  // New Dewey props (all optional, existing callers unchanged):
  //   still?: boolean                 — never render the looping Zzz
  //   pupil?: SharedValue<number>     — 0..1, lifts the pupils on the 'meh' face (eye-roll)
  //   blush?: SharedValue<number>     — 0..1, cheek blush opacity
  ```

- [ ] **Step 1: Widen the mood type and imports**

At the top of `src/components/dewey/Dewey.tsx`, change the svg import and the mood type:

```tsx
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';
import Animated, {
  useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSpring, withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import type { ReactionMood } from '@/features/rating/reactions';
```

```tsx
export type DeweyMood = 'happy' | 'smug' | 'gasp' | 'sleep' | ReactionMood;
```

- [ ] **Step 2: Replace `Face` with a version that draws every mood**

Replace the whole `function Face(...) { ... }` with:

```tsx
const ACircle = Animated.createAnimatedComponent(Circle);
const AEllipse = Animated.createAnimatedComponent(Ellipse);

function starPath(cx: number, cy: number, R = 4.8, r = 2.1) {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r : R;
    d += `${i ? 'L' : 'M'}${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`;
  }
  return `${d}Z`;
}
const STARS = `${starPath(43, 33)}${starPath(58, 33)}`;
const FLAT_MOUTH = 'M46 46h10';
const SMILE = 'M46 45q5 3 10 0';
const HAPPY_CLOSED = 'M40 35q3-3 6 0M55 35q3-3 6 0';

/** Eye-roll pupils: pupil 0 = looking ahead, 1 = rolled up under the lids. */
function MehEyes({ pupil }: { pupil?: SharedValue<number> }) {
  const left = useAnimatedProps(() => ({ cy: 35 - 4 * (pupil?.value ?? 0) }));
  const right = useAnimatedProps(() => ({ cy: 35 - 4 * (pupil?.value ?? 0) }));
  return (
    <>
      <ACircle cx={43} r={2.2} fill={INK} animatedProps={left} />
      <ACircle cx={58} r={2.2} fill={INK} animatedProps={right} />
      <Path d="M37.5 30.5h11M52.5 30.5h11" stroke={INK} strokeWidth={2.5} />
    </>
  );
}

function Blush({ blush }: { blush: SharedValue<number> }) {
  const p = useAnimatedProps(() => ({ opacity: blush.value }));
  return (
    <>
      <AEllipse cx={39} cy={42} rx={3.6} ry={2} fill={ink.tomato} animatedProps={p} />
      <AEllipse cx={62} cy={42} rx={3.6} ry={2} fill={ink.tomato} animatedProps={p} />
    </>
  );
}

function Face({ mood, pupil }: { mood: DeweyMood; pupil?: SharedValue<number> }) {
  const dots = (dx = 0) => (
    <>
      <Circle cx={44 + dx} cy={34} r={2.2} fill={INK} />
      <Circle cx={59 + dx} cy={34} r={2.2} fill={INK} />
    </>
  );
  const line = (d: string) => <Path d={d} stroke={INK} strokeWidth={2.5} fill="none" strokeLinecap="round" />;
  switch (mood) {
    case 'sleep':
      return <>{line('M40 34h6M55 34h6')}{line(SMILE)}</>;
    case 'smug':
      return <>{line('M39 33h8M54 33h8')}{line(SMILE)}</>;
    case 'gasp':
      return <>{dots()}<Ellipse cx={51} cy={46} rx={3.2} ry={4} fill={INK} /></>;
    case 'bored':
      return <>{line('M40 34h6M55 34h6')}{line(FLAT_MOUTH)}</>;
    case 'meh':
      return <><MehEyes pupil={pupil} />{line(FLAT_MOUTH)}</>;
    case 'hmm':
      return <>{dots(2)}{line('M46 46q5-2 10 1')}</>;
    case 'starry':
      return <><Path d={STARS} fill={ink.bus} stroke={INK} strokeWidth={1} /><Ellipse cx={51} cy={46} rx={3.2} ry={4} fill={INK} /></>;
    case 'teary':
      return <>{line(HAPPY_CLOSED)}{line('M46 45q5 4 10 0')}<Path d="M42 40v4M63 40v4" stroke={ink.pool} strokeWidth={2.5} strokeLinecap="round" /></>;
    case 'smitten':
      return (
        <>
          {line(HAPPY_CLOSED)}
          <Rect x={36} y={46} width={30} height={20} rx={2} fill={ink.tomato} stroke={INK} strokeWidth={2.5} />
          <Path d="M51 46v20" stroke={INK} strokeWidth={2} />
        </>
      );
    case 'happy':
    default:
      return <>{dots()}{line(SMILE)}</>;
  }
}
```

> The existing `sleep` and `smug` faces used the smile mouth, and `gasp` used the ellipse. The switch keeps exactly those, so Store Mode and empty states look the same as before.

- [ ] **Step 3: Accept the new props and pass them through**

Change the `Dewey` signature and body:

```tsx
export function Dewey({
  mood = 'happy', size = 64, pop, popDelay = 0, onPress, still, pupil, blush,
}: {
  mood?: DeweyMood; size?: number; pop?: boolean; popDelay?: number; onPress?: () => void;
  still?: boolean; pupil?: SharedValue<number>; blush?: SharedValue<number>;
}) {
```

Inside the `<Svg>`, replace `<Face mood={mood} />` with:

```tsx
      <Face mood={mood} pupil={pupil} />
      {blush ? <Blush blush={blush} /> : null}
```

Replace the Zzz line `{mood === 'sleep' && !reduced ? <Zzz /> : null}` with:

```tsx
      {(mood === 'sleep' || mood === 'bored') && !reduced && !still ? <Zzz /> : null}
```

- [ ] **Step 4: Type-check and run the tests**

Run: `npx tsc --noEmit && npx jest`
Expected: tsc exits 0. All suites pass.

- [ ] **Step 5: Hand-off**

```
git add src/components/dewey/Dewey.tsx
git commit -m "feat(dewey): six reaction faces, still mode, animated pupils and blush"
```

---

### Task 4: Flourishes, haptics and `ReactionDewey`

**Files:**
- Create: `src/features/rating/haptics.ts`
- Create: `src/components/dewey/flourishes/SparkleBurst.tsx`
- Create: `src/components/dewey/flourishes/Tissue.tsx`
- Create: `src/components/dewey/flourishes/GoldenGlow.tsx`
- Create: `src/components/dewey/ReactionDewey.tsx`

**Interfaces:**
- Consumes:
  - Task 1: `reactionFor`, `Haptic`.
  - Task 3: `Dewey` with `pupil`/`blush`.
  - Existing: `popSpring` and `motion` from `@/theme/motion`.
- Produces:
  ```ts
  export function fireHaptic(h: Haptic): void;
  export function SparkleBurst(props: { p: SharedValue<number>; size: number }): JSX.Element;
  export function Tissue(props: { p: SharedValue<number>; size: number }): JSX.Element;
  export function GoldenGlow(props: { p: SharedValue<number>; size: number }): JSX.Element;
  /** playKey: bump it to replay (0 = show the face without playing). */
  export function ReactionDewey(props: { rating: number | null; playKey: number; size?: number }): JSX.Element;
  ```
  The flourish progress `p` runs from 0 to 1 over 800ms, starting 200ms after the pop.

- [ ] **Step 1: Haptics**

Create `src/features/rating/haptics.ts`:

```ts
import * as Haptics from 'expo-haptics';
import type { Haptic } from './reactions';

export function fireHaptic(h: Haptic): void {
  const S = Haptics.ImpactFeedbackStyle;
  if (h === 'light') Haptics.impactAsync(S.Light);
  else if (h === 'medium') Haptics.impactAsync(S.Medium);
  else {
    Haptics.impactAsync(S.Heavy);
    if (h === 'heavySuccess') setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success), 160);
  }
}
```

- [ ] **Step 2: SparkleBurst**

Create `src/components/dewey/flourishes/SparkleBurst.tsx`:

```tsx
import React from 'react';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { ink } from '@/theme/palette';

const SPARKS = [
  { dx: -50, dy: -30, color: ink.bus },
  { dx: 46, dy: -36, color: ink.bus },
  { dx: -30, dy: -54, color: ink.tomato },
  { dx: 30, dy: -58, color: ink.pool },
];

function Spark({ p, dx, dy, color, k }: { p: SharedValue<number>; dx: number; dy: number; color: string; k: number }) {
  const s = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.05, 0.6, 0.9], [0, 1, 1, 0], 'clamp'),
    transform: [
      { translateX: interpolate(p.value, [0, 0.7], [0, dx * k], 'clamp') },
      { translateY: interpolate(p.value, [0, 0.7], [0, dy * k], 'clamp') },
      { scale: interpolate(p.value, [0, 0.3, 0.7], [0.4, 1.3, 1], 'clamp') },
    ],
  }));
  return <Animated.Text style={[{ position: 'absolute', left: '50%', top: '38%', marginLeft: -7, fontSize: 18 * k, color }, s]}>✦</Animated.Text>;
}

/** "Couldn't put it down": sparkles fly out from Dewey. */
export function SparkleBurst({ p, size }: { p: SharedValue<number>; size: number }) {
  const k = size / 110;
  return <>{SPARKS.map((s, i) => <Spark key={i} p={p} k={k} {...s} />)}</>;
}
```

- [ ] **Step 3: Tissue**

Create `src/components/dewey/flourishes/Tissue.tsx`:

```tsx
import React from 'react';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { ink } from '@/theme/palette';

/** "Wrecked me (nicely)": a tissue floats down from nowhere and lands by Dewey. */
export function Tissue({ p, size }: { p: SharedValue<number>; size: number }) {
  const k = size / 110;
  const s = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.1], [0, 1], 'clamp'),
    transform: [
      { translateX: interpolate(p.value, [0, 0.35, 0.6, 1], [20, -8, 4, 4], 'clamp') * k },
      { translateY: interpolate(p.value, [0, 0.35, 0.6, 1], [-90, -48, -12, -12], 'clamp') * k },
      { rotate: `${interpolate(p.value, [0, 0.35, 0.6, 1], [-20, 15, -6, -6], 'clamp')}deg` },
    ],
  }));
  return (
    <Animated.View
      style={[{
        position: 'absolute', left: '50%', bottom: size * 0.3, marginLeft: -11 * k, width: 22 * k, height: 18 * k,
        backgroundColor: ink.white, borderWidth: 2, borderColor: ink.brown,
        borderTopLeftRadius: 3, borderTopRightRadius: 8, borderBottomLeftRadius: 8, borderBottomRightRadius: 3,
      }, s]}
    />
  );
}
```

- [ ] **Step 4: GoldenGlow**

Create `src/components/dewey/flourishes/GoldenGlow.tsx`:

```tsx
import React from 'react';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { ink } from '@/theme/palette';

/** "Forever shelf": a warm glow swells behind Dewey — enshrined. Render it *behind* Dewey. */
export function GoldenGlow({ p, size }: { p: SharedValue<number>; size: number }) {
  const d = size * 1.3;
  const glow = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.25, 0.6, 1], [0, 0.55, 0.35, 0.25], 'clamp'),
    transform: [{ scale: interpolate(p.value, [0, 0.3, 0.7, 1], [0.4, 1, 1.2, 1.15], 'clamp') }],
  }));
  const ring = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.3, 1], [0, 0.9, 0], 'clamp'),
    transform: [{ scale: interpolate(p.value, [0, 1], [0.6, 1.5], 'clamp') }],
  }));
  const base = { position: 'absolute' as const, width: d, height: d, borderRadius: d / 2, left: '50%' as const, marginLeft: -d / 2, bottom: -d * 0.12 };
  return (
    <>
      <Animated.View style={[base, { backgroundColor: ink.bus }, glow]} />
      <Animated.View style={[base, { borderWidth: 3, borderColor: ink.bus }, ring]} />
    </>
  );
}
```

- [ ] **Step 5: ReactionDewey**

Create `src/components/dewey/ReactionDewey.tsx`:

```tsx
import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing, interpolate, useAnimatedStyle, useDerivedValue, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming,
} from 'react-native-reanimated';
import { reactionFor } from '@/features/rating/reactions';
import { fireHaptic } from '@/features/rating/haptics';
import { motion, popSpring } from '@/theme/motion';
import { Dewey } from './Dewey';
import { GoldenGlow } from './flourishes/GoldenGlow';
import { SparkleBurst } from './flourishes/SparkleBurst';
import { Tissue } from './flourishes/Tissue';

const FLOURISH_DELAY = 200;
const FLOURISH_MS = 800;

/** Dewey reacting to a rating: spring pop + that reaction's flourish + haptic. Bump playKey to replay. */
export function ReactionDewey({ rating, playKey, size = 110 }: { rating: number | null; playKey: number; size?: number }) {
  const reduced = useReducedMotion();
  const r = reactionFor(rating);
  const flourish = r?.flourish ?? null;
  const pop = useSharedValue(1);
  const p = useSharedValue(0);

  useEffect(() => {
    if (!r || playKey === 0) return;
    fireHaptic(r.haptic);
    pop.value = 0;
    p.value = 0;
    if (reduced) {
      pop.value = withTiming(1, { duration: motion.routine });
      return;
    }
    pop.value = withSpring(1, popSpring);
    p.value = withDelay(FLOURISH_DELAY, withTiming(1, { duration: FLOURISH_MS, easing: Easing.linear }));
  }, [playKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const popStyle = useAnimatedStyle(() =>
    reduced
      ? { opacity: pop.value }
      : { opacity: pop.value > 0.05 ? 1 : 0, transform: [{ translateY: (1 - pop.value) * 30 }, { scale: 0.6 + 0.4 * pop.value }] }
  );
  const bodyStyle = useAnimatedStyle(() => {
    if (flourish === 'headTilt') return { transform: [{ rotate: `${interpolate(p.value, [0, 0.2, 0.45, 0.7, 1], [0, -10, 8, -5, 0])}deg` }] };
    if (flourish === 'happyBounce') return { transform: [{ translateY: interpolate(p.value, [0, 0.15, 0.3, 0.42, 0.55, 1], [0, -12, 0, -6, 0, 0]) }] };
    return { transform: [] };
  });
  const pupil = useDerivedValue(() => (flourish === 'eyeRoll' ? interpolate(p.value, [0, 0.25, 0.6, 0.85, 1], [0, 1, 1, 0, 0]) : 0));
  const blush = useDerivedValue(() => (flourish === 'happyBounce' ? interpolate(p.value, [0, 0.15], [0, 0.8], 'clamp') : 0));
  const motionOn = !reduced && !!r;

  return (
    <View style={{ width: size * 1.8, height: size * 1.4, alignItems: 'center', justifyContent: 'flex-end' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {motionOn && flourish === 'goldenGlow' ? <GoldenGlow p={p} size={size} /> : null}
      <Animated.View style={popStyle}>
        <Animated.View style={[{ transformOrigin: 'bottom' }, bodyStyle]}>
          <Dewey mood={r?.mood ?? 'happy'} size={size} pupil={pupil} blush={flourish === 'happyBounce' ? blush : undefined} />
        </Animated.View>
      </Animated.View>
      {motionOn && flourish === 'sparkleBurst' ? <SparkleBurst p={p} size={size} /> : null}
      {motionOn && flourish === 'tissue' ? <Tissue p={p} size={size} /> : null}
    </View>
  );
}
```

> `zzz` needs no code here. `Dewey` renders its looping `Zzz` for the `bored` mood unless `still` is set, and the big Dewey doesn't set `still`.

- [ ] **Step 6: Type-check and run the tests**

Run: `npx tsc --noEmit && npx jest`
Expected: tsc exits 0. All suites pass.

- [ ] **Step 7: Hand-off**

```
git add src/features/rating/haptics.ts src/components/dewey/flourishes src/components/dewey/ReactionDewey.tsx
git commit -m "feat(rating): ReactionDewey with seven flourishes and graded haptics"
```

---

### Task 5: RatingSheet and RatingBadge

**Files:**
- Create: `src/components/rating/RatingSheet.tsx`
- Create: `src/components/rating/RatingBadge.tsx`

**Interfaces:**
- Consumes: `REACTIONS`, `reactionFor`, `nextRating` (Task 1), `ReactionDewey` (Task 4), `Dewey` with `still` (Task 3).
- Produces:
  ```ts
  export function RatingSheet(props: {
    visible: boolean; rating: number | null;
    onRate: (next: number | null) => void;   // called on every tap, already resolved via nextRating
    onClose: () => void;
  }): JSX.Element;
  export function RatingBadge(props: { rating: number; onPress: () => void }): JSX.Element;
  ```

- [ ] **Step 1: RatingSheet**

Create `src/components/rating/RatingSheet.tsx`:

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { nextRating, REACTIONS, reactionFor } from '@/features/rating/reactions';
import { Dewey } from '@/components/dewey/Dewey';
import { ReactionDewey } from '@/components/dewey/ReactionDewey';
import { font, ink, radius } from '@/theme/palette';

const AUTO_CLOSE_MS = 1200;

/** "How was it?" — seven Dewey reactions. Saves on tap; closes itself shortly after the last tap. */
export function RatingSheet({
  visible, rating, onRate, onClose,
}: { visible: boolean; rating: number | null; onRate: (next: number | null) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState<number | null>(rating);
  const [playKey, setPlayKey] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    if (visible) {
      setCurrent(rating);
      setPlayKey(0);
    }
    return clear;
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const tap = (n: number) => {
    const next = nextRating(current, n);
    setCurrent(next);
    onRate(next);
    if (next !== null) setPlayKey((k) => k + 1);
    clear();
    timer.current = setTimeout(onClose, AUTO_CLOSE_MS);
  };

  const label = reactionFor(current)?.label ?? 'Tap how it felt';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close rating" />
      <View
        accessibilityViewIsModal
        style={{
          backgroundColor: ink.paper, borderTopWidth: 2.5, borderColor: ink.brown,
          borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
          paddingHorizontal: 16, paddingTop: 18, paddingBottom: insets.bottom + 12,
        }}
      >
        <Text accessibilityRole="header" style={{ fontFamily: font.display, fontSize: 30, color: ink.brown, textAlign: 'center' }}>How was it?</Text>
        <View style={{ alignItems: 'center' }}>
          <ReactionDewey rating={current} playKey={playKey} size={96} />
          <Text accessibilityLiveRegion="polite" style={{ fontFamily: font.black, fontSize: 16, color: ink.brown, marginTop: 4 }}>{label}</Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 14 }}>
          {REACTIONS.map((r) => {
            const on = r.rating === current;
            return (
              <Pressable
                key={r.rating}
                onPress={() => tap(r.rating)}
                accessibilityRole="button"
                accessibilityLabel={`Rate: ${r.label}`}
                accessibilityState={{ selected: on }}
                style={{
                  width: 84, minHeight: 88, alignItems: 'center', paddingVertical: 6, borderRadius: 12, borderWidth: 2,
                  borderColor: on ? ink.brown : 'transparent', backgroundColor: on ? ink.bus : 'transparent',
                }}
              >
                <Dewey mood={r.mood} size={40} still />
                <Text style={{ fontFamily: font.heavy, fontSize: 11, lineHeight: 13, color: ink.brown, textAlign: 'center', marginTop: 2 }}>{r.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable onPress={onClose} accessibilityRole="button" style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 6 }}>
          <Text style={{ fontFamily: font.heavy, fontSize: 13.5, color: ink.brown, textDecorationLine: 'underline' }}>Not now</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
```

> The sheet uses fixed `ink` colours rather than theme colours on purpose. It's a paper object like the VerdictSheet, which also uses `ink.paper`/`ink.brown` in both themes.

- [ ] **Step 2: RatingBadge**

Create `src/components/rating/RatingBadge.tsx`:

```tsx
import React from 'react';
import { Pressable, Text } from 'react-native';
import { reactionFor } from '@/features/rating/reactions';
import { Dewey } from '@/components/dewey/Dewey';
import { font, ink, radius } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

/** The rating on book detail: a still Dewey face + its label. Tap to change it. */
export function RatingBadge({ rating, onPress }: { rating: number; onPress: () => void }) {
  const { c } = useTheme();
  const r = reactionFor(rating);
  if (!r) return null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Your rating: ${r.label}. Tap to change.`}
      style={{
        height: 32, paddingLeft: 4, paddingRight: 12, borderRadius: radius.pill, borderWidth: 2, borderColor: c.line,
        backgroundColor: ink.white, flexDirection: 'row', alignItems: 'center', gap: 4,
      }}
    >
      <Dewey mood={r.mood} size={26} still />
      <Text style={{ fontFamily: font.heavy, fontSize: 12.5, color: ink.brown }}>{r.label}</Text>
    </Pressable>
  );
}
```

- [ ] **Step 3: Type-check and run the tests**

Run: `npx tsc --noEmit && npx jest`
Expected: tsc exits 0. All suites pass.

- [ ] **Step 4: Hand-off**

```
git add src/components/rating
git commit -m "feat(rating): rating sheet and badge"
```

---

### Task 6: Wire ratings into book detail

**Files:**
- Modify: `app/book/[id].tsx`
- Modify: `DESIGN.md`

**Interfaces:**
- Consumes: `setRating` (Task 2), `shouldPromptRating` (Task 1), `RatingSheet` and `RatingBadge` (Task 5).
- Produces: nothing new.

- [ ] **Step 1: Imports and state**

In `app/book/[id].tsx`:

1. Add `setRating` to the repository import:

```tsx
import { getLibraryRow, listCopiesOfBook, listLibrary, listRooms, setLocation, setRating, setStatus } from '@/db/repository';
```

2. Add these imports below the `CoverArt` import:

```tsx
import { RatingBadge } from '@/components/rating/RatingBadge';
import { RatingSheet } from '@/components/rating/RatingSheet';
import { shouldPromptRating } from '@/features/rating/reactions';
```

3. Directly under `const [moving, setMoving] = useState(false);` add (it must come before the `if (!row) return` early return):

```tsx
  const [rateOpen, setRatingOpen] = useState(false);
```

- [ ] **Step 2: Prompt after Mark as read**

Replace the `Mark as read` entry in `primary`:

```tsx
          : { label: 'Mark as read', run: () => { setStatus(row.id, 'read'); refresh(); } };
```

with:

```tsx
          : { label: 'Mark as read', run: () => {
              const prev = row.status;
              setStatus(row.id, 'read');
              refresh();
              if (shouldPromptRating(prev, 'read')) setRatingOpen(true);
            } };
```

- [ ] **Step 3: Badge and Rate it**

Replace:

```tsx
              {row.rating ? <Pill label={`★ ${row.rating}`} /> : null}
```

with:

```tsx
              {row.rating ? (
                <RatingBadge rating={row.rating} onPress={() => setRatingOpen(true)} />
              ) : row.status === 'read' ? (
                <Pressable onPress={() => setRatingOpen(true)} accessibilityRole="button" style={{ height: 32, justifyContent: 'center', paddingHorizontal: 4 }}>
                  <Text style={{ fontFamily: font.heavy, fontSize: 13, color: c.text, textDecorationLine: 'underline' }}>Rate it</Text>
                </Pressable>
              ) : null}
```

- [ ] **Step 4: Mount the sheet**

Directly before the closing `</SafeAreaView>`, after `</ScrollView>`, add:

```tsx
      <RatingSheet
        visible={rateOpen}
        rating={row.rating}
        onRate={(n) => { setRating(row.id, n); refresh(); }}
        onClose={() => setRatingOpen(false)}
      />
```

- [ ] **Step 5: Update DESIGN.md**

In `DESIGN.md`, in the components section after the Dewey description (search for "Dewey the bookworm"), add:

```markdown
**Dewey ratings.** A copy's rating is one of seven Dewey reactions, stored as 1–7 in `user_books.rating`: 1 Put me to sleep (drifting z's) · 2 Meh. (eye-roll) · 3 Had its moments (head tilt) · 4 Good company (happy bounce + blush) · 5 Couldn't put it down (sparkle burst) · 6 Wrecked me (nicely) (tissue floats down) · 7 Forever shelf (golden glow). "Mark as read" slides up the RatingSheet ("How was it?", seven still Deweys, "Not now"); tapping saves immediately, the big Dewey springs up with that reaction's flourish (≈1s, `popSpring`) and a haptic that strengthens with the rating (Light ×3, Medium ×2, Heavy, Heavy + Success), and the sheet closes itself 1.2s after the last tap. Tapping the current reaction clears it. Reduce motion: face fades in, no flourish, haptic stays. Book detail shows the rating as a still Dewey + label pill (tap to change), or "Rate it" on unrated read books. The source of truth is `REACTIONS` in `src/features/rating/reactions.ts`.
```

- [ ] **Step 6: Type-check and run the tests**

Run: `npx tsc --noEmit && npx jest`
Expected: tsc exits 0. All suites pass.

- [ ] **Step 7: Manual check on the iPhone**

**Requires Task 2's migration to be deployed first** if you want to confirm that sync accepts 6–7.
1. Open an unread book and tap **Mark as read**. The sheet slides up.
2. Tap each of the seven reactions in turn, and check each flourish and its haptic strength: z's, eye-roll, tilt, bounce and blush, sparkles, tissue, glow.
3. Stop tapping. The sheet closes on its own about 1.2s later, and the badge shows the chosen Dewey and label.
4. Tap the badge, then tap the current reaction. The rating clears, and "Rate it" appears.
5. Tap **Not now**, and tap the dimmed background. Both close the sheet without changes.
6. Tap several reactions rapidly. The last one wins, and the sheet closes 1.2s after the last tap.
7. Turn on **iOS Settings → Accessibility → Motion → Reduce Motion** and rate again. The face fades, with no pop or flourish, and the haptic still fires.
8. Tap Mark as unread, then Mark as read again. The sheet opens with the existing reaction selected.

- [ ] **Step 8: Hand-off**

```
git add "app/book/[id].tsx" DESIGN.md
git commit -m "feat(rating): rate books with Dewey reactions from book detail"
```

---

## Spec coverage check

| Spec section | Task |
|---|---|
| §2 The scale (7 reactions, labels, faces, flourishes, haptics) | 1 (table), 3 (faces), 4 (flourishes, haptics) |
| §3 Server migration 1–7, deploy order, constraint name | 2 |
| §3 SQLite: no change | 2 (noted) |
| §3 setRating validation, updateUserBook widening, pending_ops | 2 |
| §4.1 RatingSheet: header, big Dewey, row, tap/clear, auto-close, Not now | 5 |
| §4.2 Book detail: prompt on Mark as read, badge, Rate it, rating kept when leaving read | 6 |
| §5 Animation: faces, flourishes, ReactionDewey, UI thread, haptics, reduce motion, static row | 3, 4, 5 |
| §6 Edge cases: preselect, per copy, rapid taps, invalid values throw | 1, 2, 5, 6 |
| §7 Tests: unit and manual | 1, 6 |

**Deviations from spec:**
- **The sheet closes on "Not now" or a tap on the dimmed background, not a swipe-down.** A transparent RN `Modal` doesn't support swipe-to-dismiss, and a gesture sheet would need a new dependency, which this plan avoids.
- **Flourish files:** the spec listed `EyeRoll`, `HeadTilt` and `HappyBounce` as separate components. They move Dewey's own body or pupils, so they're implemented as animated styles/props inside `ReactionDewey` and `Dewey`, and only the three overlay flourishes (`SparkleBurst`, `Tissue`, `GoldenGlow`) get their own files. `Zzz` is reused as the spec said.
