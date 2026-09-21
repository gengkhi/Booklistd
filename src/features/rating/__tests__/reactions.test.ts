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
    expect(shouldPromptRating(null, 'read')).toBe(true);
    expect(shouldPromptRating('reading', 'read')).toBe(true);
    expect(shouldPromptRating('read', 'read')).toBe(false);
    expect(shouldPromptRating('read', 'want')).toBe(false);
    expect(shouldPromptRating('reading', 'dnf')).toBe(false);
  });
});
