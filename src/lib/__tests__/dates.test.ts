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
