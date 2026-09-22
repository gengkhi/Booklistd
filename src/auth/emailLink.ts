export const RESEND_AFTER_MS = 60_000;

/** A light check so "Send link" enables at the right time; Supabase does the real validation. */
export function isPlausibleEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export function resendLabel(sentAt: number, now: number): { label: string; enabled: boolean } {
  const left = Math.ceil((sentAt + RESEND_AFTER_MS - now) / 1000);
  return left > 0 ? { label: `Resend in ${left}s`, enabled: false } : { label: 'Resend', enabled: true };
}
