import { useColorScheme } from 'react-native';
import { useSettings } from '@/stores/settings';
import { palettes, type Palette, type Scheme } from './palette';
import { resolveScheme } from './resolveScheme';

export function useTheme(): { scheme: Scheme; c: Palette } {
  const pref = useSettings((s) => s.theme);
  const scheme = resolveScheme(pref, useColorScheme());
  return { scheme, c: palettes[scheme] };
}
