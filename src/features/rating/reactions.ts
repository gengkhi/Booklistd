import type { ReadingState } from '@/lib/types';

/** Dewey faces used by ratings (4 reuses the existing 'happy'). */
export type ReactionMood = 'bored' | 'meh' | 'hmm' | 'happy' | 'starry' | 'teary' | 'smitten';
type Flourish = 'zzz' | 'eyeRoll' | 'headTilt' | 'happyBounce' | 'sparkleBurst' | 'tissue' | 'goldenGlow';
export type Haptic = 'light' | 'medium' | 'heavy' | 'heavySuccess';

export interface Reaction { rating: number; label: string; mood: ReactionMood; flourish: Flourish; haptic: Haptic }

/** The whole rating scale. Only `rating` is stored (readings.rating, 1–7). */
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

export function shouldPromptRating(prev: ReadingState | null, next: ReadingState | null): boolean {
  return prev !== 'read' && next === 'read';
}
