import type { AuthMethod } from '@/auth/session';

export const SIGN_IN_AGAIN = 'Sign in again to back up';

export function methodLabel(m: AuthMethod | null): string {
  if (m === 'apple') return 'with Apple';
  if (m === 'google') return 'with Google';
  if (m === 'email') return 'by email';
  return '';
}

/** Spec §2 and §4: until sync ships nothing is backed up; after, only rows still in the queue are at risk. */
export function signOutWarning({ syncEnabled, pending }: { syncEnabled: boolean; pending: number }): string | null {
  if (!syncEnabled) return "Your library isn't backed up yet. Signing out deletes it from this phone.";
  if (pending <= 0) return null;
  return pending === 1 ? "1 change hasn't backed up yet. Sign out anyway?" : `${pending} changes haven't backed up yet. Sign out anyway?`;
}
