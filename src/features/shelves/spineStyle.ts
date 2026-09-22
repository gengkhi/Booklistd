import { ink } from '@/theme/palette';

type SpinePattern = 'plain' | 'band' | 'dots';
export interface SpineLook {
  bg: string; fg: string; accent: string;
  width: number; height: number;
  pattern: SpinePattern; showTitle: boolean;
}

const SWATCHES = [
  { bg: ink.pool, fg: ink.white, accent: ink.bus },
  { bg: ink.bus, fg: ink.brown, accent: ink.tomato },
  { bg: ink.tomato, fg: ink.white, accent: ink.bus },
  { bg: ink.grass, fg: ink.white, accent: ink.bus },
  { bg: ink.white, fg: ink.brown, accent: ink.bus },
  { bg: ink.plum, fg: ink.white, accent: ink.bus },
  { bg: ink.brown, fg: ink.bus, accent: ink.bus },
  { bg: ink.cream, fg: ink.brown, accent: ink.tomato },
] as const;

/** FNV-1a — stable across sessions so a book keeps its spine forever. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function spineStyle(id: string, title: string): SpineLook {
  const h = hashString(id);
  const sw = SWATCHES[h % SWATCHES.length];
  const width = 26 + ((h >>> 3) % 11); // 26–36, wide enough for a rotated title
  const height = 96 + ((h >>> 7) % 27); // 96–122
  const p = (h >>> 11) % 5;
  const pattern: SpinePattern = p === 0 ? 'dots' : p <= 2 ? 'band' : 'plain';
  const showTitle = title.trim().length > 0;
  return { ...sw, width, height, pattern, showTitle };
}
