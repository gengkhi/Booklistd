# Dewey Ratings — Design Spec

**Date:** 2026-09-21 · **Status:** approved by Sean in brainstorming; awaiting spec review
**Mockups:** `.superpowers/brainstorm/2324-1789973478/content/` (`rating-scale.html`, `rating-flourishes.html`)

## 1. Goal

Rating a book should be fun, not a spreadsheet chore. The user rates a copy by picking one of seven Dewey the bookworm reactions. Each reaction has its own animation and haptic. Today `user_books.rating` exists (1–5) but nothing in the app can set it.

Out of scope for now:
- sub-ratings or a 1–100 meter (these could be added on top later);
- showing ratings on spines, in lists or as filters;
- review text;
- social features.

## 2. The scale

A rating is an integer from **1 to 7**. The code keeps a single list, `REACTIONS`, in `src/features/rating/reactions.ts`:

| n | Label | Face | Flourish | Haptic |
|---|---|---|---|---|
| 1 | Put me to sleep | closed eyes, flat mouth | Drifting z's | Light |
| 2 | Meh. | half-lidded, flat mouth | Eye-roll | Light |
| 3 | Had its moments | side-glance, crooked mouth | Head tilt | Light |
| 4 | Good company | dot eyes, smile | Happy bounce and blush | Medium |
| 5 | Couldn't put it down | star eyes, open mouth | Sparkle burst | Medium |
| 6 | Wrecked me (nicely) | happy-closed eyes, smile, tears | Tissue floats down | Heavy |
| 7 | Forever shelf | happy-closed eyes, hugging a book | Golden glow | Heavy + Success notification |

Only the number is stored. Labels, faces and flourishes all come from `REACTIONS`.

## 3. Data

- **Supabase:** a new migration replaces `user_books_rating_check` (`rating between 1 and 5`) with `rating between 1 and 7`. **Deploy it before the app release**, because the sync push would otherwise reject ratings of 6 or 7. No data needs moving: no ratings exist yet.
- **SQLite:** no change. `rating INTEGER` has no CHECK.
- **Repository:** `setRating(userBookId, n: number | null)`.
  - It throws on anything that isn't an integer from 1 to 7, or null.
  - Otherwise it goes through `updateUserBook`, whose column union gains `'rating'` and whose value type widens to `string | number | null`. It therefore updates `updated_at` and queues a `pending_ops` upsert the same way `setStatus` does.
- **The constraint name** `user_books_rating_check` is Postgres's automatic name for the inline check. Confirm it before writing the migration; `drop constraint if exists` makes the migration safe to re-run.

## 4. Screens and flows

### 4.1 RatingSheet (`src/components/rating/RatingSheet.tsx`)
- A bottom sheet with the heading "How was it?".
- **Big Dewey:** a large `ReactionDewey` at the top shows the current reaction, or the neutral `happy` mood when unrated.
- **Reaction row:** seven small static Deweys, each labelled, with the current one highlighted.
  - The row wraps so it fits a phone screen.
  - Each item is a button with an accessibility label such as "Rate: Wrecked me (nicely)".
- **Tapping a reaction:** `nextRating(current, tapped)` decides the result.
  - A new reaction saves at once and plays that reaction's animation and haptic on the big Dewey.
  - Tapping the current reaction clears the rating.
- **Closing:**
  - The sheet closes on its own about 1.2s after the last tap. Each new tap restarts the timer and the animation, so the last tap wins.
  - "Not now" or a swipe-down closes it without changing anything.

### 4.2 Book detail (`app/book/[id].tsx`)
- **"Mark as read":** after `setStatus(…, 'read')`, `shouldPromptRating(prev, 'read')` opens the RatingSheet with the current rating selected (if any).
- **The rating display** replaces the `★ n` pill: a small static reaction Dewey plus its label. Tapping it opens the RatingSheet.
- **"Rate it" link:** shown when the status is `read` and there's no rating.
- **Leaving `read`:** an existing rating stays and still displays.

## 5. Animation

- **`Dewey` component:** gets seven reaction faces, drawn in the existing SVG style. The existing moods stay as they are.
- **`src/components/dewey/flourishes/`:**
  - reuse the existing `Zzz`;
  - add `EyeRoll`, `HeadTilt`, `HappyBounce`, `SparkleBurst`, `Tissue` and `GoldenGlow`.
- **`ReactionDewey({ rating, playKey })`:** runs the shared spring-up pop with the existing `popSpring`. The reaction's flourish starts at about 200ms, and the whole thing finishes within about 1s. Changing `playKey` replays it.
- **Motion:** runs on Reanimated shared values on the UI thread, with `react-native-svg` for the drawings. No new dependencies.
- **Haptics:** `expo-haptics`, fired as the pop starts, using the strength from `REACTIONS`.
- **Reduce motion** (`useReducedMotion`): the face swaps in with a short fade and no flourish. The haptic still plays.
- **The reaction row never animates.** Only the big Dewey does.

## 6. Edge cases

- **Re-marking a book as read** preselects the existing rating.
- **Several copies of a book:** each copy has its own rating (`user_books`), the same as status.
- **Rapid taps:** the last tap wins, and the animation and close timer restart.
- **An out-of-range value reaches `setRating`:** it throws. The UI only ever passes values from `REACTIONS`.

## 7. Testing

- **Unit tests (Jest):**
  - `REACTIONS` has exactly seven entries, numbered 1 to 7, with non-empty labels and haptic strength never decreasing.
  - `nextRating`: a new reaction sets the rating, the same reaction clears it.
  - `shouldPromptRating`: true only when moving from something other than `read` to `read`.
  - `setRating`: rejects 0, 8, 2.5 and NaN.
- **Manual (iPhone, Expo Go SDK 57):**
  - all seven flourishes and their haptics;
  - with iOS "Reduce motion" on;
  - "Not now", changing a rating, clearing a rating, rapid tapping;
  - after marking read → reading → read.
