/**
 * "Reading nook at golden hour" — the committed visual world.
 * Source of truth: the Design canvas + DESIGN.md. Change values there first.
 */
export const colors = {
  ground: '#FBF3E3', // oat cream — app background
  surface: '#FFFAF0', // cards, nav, inputs
  butter: '#F6E3BC', // soft callouts, warnings base
  butterDeep: '#F3E6C8', // chips, toggle track
  wood: '#DDB588', // shelf rails
  ink: '#3B2A1B', // cocoa — primary text
  inkSoft: '#5A4732',
  muted: '#6E5B44', // secondary text (warm, never gray)
  clay: '#B3543A', // primary accent (fills take onAccent text)
  clayDeep: '#8F3F2A',
  owned: '#2E7B4F', // verdict green
  ownedTint: '#DDEBD9',
  ownedText: '#2E6B45',
  warnText: '#6B4A0E',
  warnIcon: '#8A5F1D',
  star: '#B07A22',
  espresso: '#271C11', // Store Mode dark scene
  lamplight: '#EFB877',
  creamOnDark: '#F8EDD9',
  mutedOnDark: '#B9A585',
  onAccent: '#FFF6EA',
} as const;

export const font = {
  display: 'Fraunces_700Bold',
  displaySemi: 'Fraunces_600SemiBold',
  body: 'Nunito_600SemiBold',
  bodyBold: 'Nunito_700Bold',
  bodyHeavy: 'Nunito_800ExtraBold',
} as const;

export const radius = { sm: 9, md: 16, lg: 20, xl: 30, pill: 999 } as const;
export const space = (n: number) => n * 4;

export const shadow = {
  warm: {
    shadowColor: '#7A4A20',
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  lifted: {
    shadowColor: '#8F3F2A',
    shadowOpacity: 0.32,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
} as const;
