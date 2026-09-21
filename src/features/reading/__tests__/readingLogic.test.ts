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
