import type { Scheme } from './palette';

export type ThemePref = 'system' | 'light' | 'lamp';

export function resolveScheme(pref: ThemePref, system: 'light' | 'dark' | null | undefined): Scheme {
  if (pref === 'light' || pref === 'lamp') return pref;
  return system === 'dark' ? 'lamp' : 'light';
}
