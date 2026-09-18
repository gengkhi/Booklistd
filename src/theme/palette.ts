/**
 * Book Fair Saturday — Painted Bookcase. Six inks + paper; no tints, no gradients.
 * Spec: docs/superpowers/specs/2026-09-18-bookshelf-redesign-design.md
 */
export const ink = {
  tomato: '#E2462B',
  bus: '#F4B41A', // primary action only
  pool: '#2F6FB0',
  grass: '#3E9A5A',
  plum: '#7B3F6E',
  tape: '#F7E7B4',
  white: '#FFFFFF',
  brown: '#2B1D14', // outlines + text on paper objects (cards, bubbles, stickers)
  soft: '#6B5646', // secondary text on paper objects
  cream: '#F3E0BE',
  paper: '#FBFAF4',
} as const;

export type Scheme = 'light' | 'lamp';

export interface Palette {
  paper: string; // screen ground
  caseBack: string; // bookcase back panel
  text: string; // text on the ground
  soft: string; // secondary text on the ground
  line: string; // outlines + hard shadows
  frame: string; // bookcase frame
  frameWidth: number;
  tabBar: string;
  roomTag: string;
}

export const palettes: Record<Scheme, Palette> = {
  light: {
    paper: '#FBFAF4',
    caseBack: '#F3E9D2',
    text: '#2B1D14',
    soft: '#6B5646',
    line: '#2B1D14',
    frame: '#2B1D14',
    frameWidth: 2.5,
    tabBar: '#FFFFFF',
    roomTag: '#FFFFFF',
  },
  lamp: {
    paper: '#2E2016',
    caseBack: '#1F140D',
    text: '#FFF4E0',
    soft: '#D9C3A0',
    line: '#120B06',
    frame: '#A2622F',
    frameWidth: 6,
    tabBar: '#1F140D',
    roomTag: '#E3B55B',
  },
};

export const font = {
  display: 'BagelFatOne_400Regular',
  body: 'Figtree_600SemiBold',
  bold: 'Figtree_700Bold',
  heavy: 'Figtree_800ExtraBold',
  black: 'Figtree_900Black',
  hand: 'GochiHand_400Regular',
} as const;

export const radius = { spine: 3, card: 8, button: 14, sheet: 26, pill: 999 } as const;
export const space = (n: number) => n * 4;
export const PLANKS = [ink.bus, ink.tomato, ink.pool, ink.grass, ink.plum] as const;
