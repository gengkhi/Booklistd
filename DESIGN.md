# DESIGN.md — "Reading nook at golden hour"

Committed visual world. Source of truth alongside the Design canvas mockups.
Tokens live in code at `src/theme/tokens.ts` — change both together.

## Palette
| Token | Hex | Use |
|---|---|---|
| ground | #FBF3E3 | app background (oat cream) |
| surface | #FFFAF0 | cards, nav, inputs |
| butter | #F6E3BC | soft callouts, warnings |
| butterDeep | #F3E6C8 | chips, toggle tracks |
| wood | #DDB588 | shelf rails |
| ink | #3B2A1B | primary text (cocoa) |
| muted | #6E5B44 | secondary text — warm-tinted, never gray |
| clay | #B3543A | primary accent; white-cream (#FFF6EA) text on fills |
| owned / ownedTint | #2E7B4F / #DDEBD9 | verdict green + tags |
| espresso | #271C11 | Store Mode dark scene |
| lamplight | #EFB877 | scan line, Store Mode pill |

## Type
- Display: **Fraunces** 600/700 — headings, verdicts, numbers on the library card
- UI/body: **Nunito** 600/700/800 — rounded, friendly
- No Inter/Roboto/system display faces.

## Shape & depth
- Radii: 16–20 cards, 30 sheets, pill for small controls. Book covers: 4px spine edge / 9px fore-edge.
- Shadows always warm-tinted (#7A4A20 base), offset + soft blur. Never gray, never hard-offset, never glow halos.

## Signature motifs (the differentiation kit — protect these)
1. **Arch** — reading-nook window: Store Mode viewfinder, book-detail alcove (#F4E3C2).
2. **Library checkout card** — dotted-leader stat rows; replaces metric-card grids everywhere.
3. **Bookmark marker** — small pennant at the tip of progress bars.
4. **Shelf props** — one small vector plant or steaming mug per shelf view, geometric, never sketchy.
5. **Wood rails** — #DDB588 with inset lower edge under every cover row.

## Voice in UI
"You own this!" / "A new find!" / "Both copies live on your Bedroom Shelf" / "Copy 1 is visiting Maya" / "Lamplight mode" (dark theme). Verdict text must be readable at arm's length in a dim aisle.

## Motion (Phase 4)
One authored moment: the verdict sheet's spring-up + haptic. Everything else answers user action quietly. Exponential ease-out; respect reduced motion.

## Bans (from Impeccable craft floor)
Metric-card grids (big number + small label), eyebrow labels above headings, gradient text, gray secondary text, hard-offset shadows, emoji-as-icons, nested cards.
