import type { ColorSchemeName } from 'react-native';
import type { Scheme } from './palette';

export type ThemePref = 'system' | 'light' | 'lamp';

export function resolveScheme(pref: ThemePref, system: ColorSchemeName | null): Scheme {
  if (pref === 'light' || pref === 'lamp') return pref;
  return system === 'dark' ? 'lamp' : 'light';
}
