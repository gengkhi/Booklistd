import { reactionFor } from '@/features/rating/reactions';
import { formatMonthYear, type ReadingFields } from '@/features/reading/readingLogic';

export type StoreVerdictKind = 'owned' | 'wishlist' | 'read' | 'new';

/** Exactly one verdict per scan, in priority order: owned > wishlist > read > new. */
export function storeVerdict(v: { ownedCopies: number; wishlistCopies: number; reading: Pick<ReadingFields, 'state'> | null }): StoreVerdictKind {
  if (v.ownedCopies > 0) return 'owned';
  if (v.wishlistCopies > 0) return 'wishlist';
  if (v.reading && (v.reading.state === 'read' || v.reading.state === 'dnf')) return 'read';
  return 'new';
}

export function newFindNote(reading: Pick<ReadingFields, 'state'> | null): string | null {
  if (reading?.state === 'want') return 'On your TBR pile';
  if (reading?.state === 'reading') return "You're reading this";
  return null;
}

export function readVerdictLine(r: ReadingFields): string {
  if (r.state === 'dnf') return 'You gave up on this one';
  const label = reactionFor(r.rating)?.label ?? 'Read';
  return r.finishedAt ? `${label} · Finished ${formatMonthYear(r.finishedAt)}` : label;
}
