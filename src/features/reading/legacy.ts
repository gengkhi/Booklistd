import { isValidRating } from '@/features/rating/reactions';
import type { ReadingFields } from './readingLogic';

export type CopyStatus = 'owned' | 'wishlist';
export interface LegacyCopy { status: string; rating: number | null; updatedAt: string }

/** Pre-v3 statuses mixed ownership and reading; keep only the ownership half. */
export function mapCopyStatus(old: string): CopyStatus {
  return old === 'wishlist' || old === 'want_to_buy' ? 'wishlist' : 'owned';
}

/** The reading implied by one book's pre-v3 copies, or null. A rated copy was read, whatever its status. */
export function readingFromLegacy(copies: LegacyCopy[]): ReadingFields | null {
  const impliesRead = (c: LegacyCopy) => c.status === 'read' || isValidRating(c.rating);
  const tracked = copies.filter((c) => impliesRead(c) || c.status === 'reading');
  if (tracked.length === 0) return null;
  const state = tracked.some(impliesRead) ? 'read' : 'reading';
  const latest = tracked
    .filter((c) => (state === 'read' ? impliesRead(c) : c.status === 'reading'))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const date = latest.updatedAt.slice(0, 10);
  const ratings = copies.map((c) => c.rating).filter(isValidRating);
  const rating = ratings.length ? Math.max(...ratings) : null;
  return state === 'read'
    ? { state, startedAt: null, finishedAt: date, rating }
    : { state, startedAt: date, finishedAt: null, rating };
}
