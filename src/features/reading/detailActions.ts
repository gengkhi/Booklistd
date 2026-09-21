import type { ReadingState } from '@/lib/types';

export type PrimaryAction =
  | { kind: 'found' } | { kind: 'nudge'; borrower: string }
  | { kind: 'start' } | { kind: 'finish' } | { kind: 'markRead' } | null;

/** The one big button on book detail: the next natural step for this book. */
export function primaryAction(i: { ownedCopies: number; wishlistCopy: boolean; loanedTo: string | null; readingState: ReadingState | null }): PrimaryAction {
  if (i.wishlistCopy && i.ownedCopies === 0) return { kind: 'found' };
  if (i.loanedTo) return { kind: 'nudge', borrower: i.loanedTo };
  if (i.readingState === 'want') return { kind: 'start' };
  if (i.readingState === 'reading') return { kind: 'finish' };
  if (i.readingState === null) return { kind: 'markRead' };
  return null;
}

export function primaryLabel(a: Exclude<PrimaryAction, null>): string {
  switch (a.kind) {
    case 'found': return 'Found it!';
    case 'nudge': return `Nudge ${a.borrower}`;
    case 'start': return 'Start reading';
    case 'finish': return 'Finished it';
    case 'markRead': return 'Mark as read';
  }
}
