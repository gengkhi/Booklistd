import type { Reading, ReadingState } from '@/lib/types';
import { reactionFor } from '@/features/rating/reactions';

export const READING_STATES: readonly ReadingState[] = ['want', 'reading', 'read', 'dnf'];
export const READING_LABEL: Record<ReadingState, string> = {
  want: 'Want to read',
  reading: 'Reading',
  read: 'Read',
  dnf: 'Did not finish',
};

export type ReadingFields = Pick<Reading, 'state' | 'startedAt' | 'finishedAt' | 'rating'>;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date as 'YYYY-MM-DD' (never UTC — a late-night finish belongs to that day). */
export function todayIso(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Moving to a state fills in the dates a person would expect; the rating always survives. */
export function applyReadingState(prev: ReadingFields | null, next: ReadingState, today: string): ReadingFields {
  const rating = prev?.rating ?? null;
  if (next === 'want') return { state: 'want', startedAt: null, finishedAt: null, rating };
  if (next === 'reading') {
    const reread = prev?.state === 'read' || prev?.state === 'dnf';
    return { state: 'reading', startedAt: !reread && prev?.startedAt ? prev.startedAt : today, finishedAt: null, rating };
  }
  return { state: next, startedAt: prev?.startedAt ?? null, finishedAt: today, rating };
}

export function clampDates(startedAt: string | null, finishedAt: string | null) {
  if (startedAt && finishedAt && finishedAt < startedAt) return { startedAt, finishedAt: startedAt };
  return { startedAt, finishedAt };
}

export function canRate(state: ReadingState): boolean {
  return state === 'read' || state === 'dnf';
}

/** "Day N" of a read in progress; the start day is day 1. */
export function dayNumber(startedAt: string, today: string): number {
  const days = Math.round((isoToDate(today).getTime() - isoToDate(startedAt).getTime()) / 86400000);
  return Math.max(1, days + 1);
}

export function formatMonthYear(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function formatShortDate(iso: string, today: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const base = `${d} ${MONTHS[m - 1]}`;
  return String(y) === today.slice(0, 4) ? base : `${base} ${y}`;
}

export function groupReadByYear<T extends { finishedAt: string | null }>(items: T[]): { year: string; items: T[] }[] {
  const dated = items.filter((i) => i.finishedAt).sort((a, b) => b.finishedAt!.localeCompare(a.finishedAt!));
  const groups: { year: string; items: T[] }[] = [];
  for (const item of dated) {
    const year = item.finishedAt!.slice(0, 4);
    const last = groups[groups.length - 1];
    if (last && last.year === year) last.items.push(item);
    else groups.push({ year, items: [item] });
  }
  const undated = items.filter((i) => !i.finishedAt);
  if (undated.length) groups.push({ year: 'Undated', items: undated });
  return groups;
}

/** One short line about a reading, for the Store Mode verdict card. */
export function readingLine(r: ReadingFields | null, today: string): string | null {
  if (!r) return null;
  switch (r.state) {
    case 'read': {
      const label = reactionFor(r.rating)?.label;
      return label ? `Read · ${label}` : 'Read';
    }
    case 'reading':
      return r.startedAt ? `Reading now · day ${dayNumber(r.startedAt, today)}` : 'Reading now';
    case 'want':
      return 'On your TBR pile';
    case 'dnf':
      return "Didn't finish";
  }
}
