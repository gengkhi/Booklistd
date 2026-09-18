---
name: My Library — Painted Bookcase
description: A hand-painted picture-book bookcase where every owned book is a spine, kept by Dewey the bookworm.
colors:
  paper: "#FBFAF4"
  case-back: "#F3E9D2"
  brown: "#2B1D14"
  soft: "#6B5646"
  tomato: "#E2462B"
  bus: "#F4B41A"
  pool: "#2F6FB0"
  grass: "#3E9A5A"
  plum: "#7B3F6E"
  tape: "#F7E7B4"
  white: "#FFFFFF"
  cream: "#F3E0BE"
  scene-dark: "#1B130D"
  lamp-paper: "#2E2016"
  lamp-case-back: "#1F140D"
  lamp-text: "#FFF4E0"
  lamp-line: "#120B06"
  lamp-frame-oak: "#A2622F"
  lamp-room-tag: "#E3B55B"
typography:
  display:
    fontFamily: "BagelFatOne-Regular, Georgia, serif"
    fontSize: "40px"
    fontWeight: 400
    lineHeight: "44px"
    letterSpacing: "normal"
  body:
    fontFamily: "Figtree-SemiBold, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: "1.3"
  bold:
    fontFamily: "Figtree-Bold, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: "1.3"
  heavy:
    fontFamily: "Figtree-ExtraBold, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 800
    lineHeight: "1.3"
  black:
    fontFamily: "Figtree-Black, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 900
    lineHeight: "1.2"
  hand:
    fontFamily: "GochiHand-Regular, cursive"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "1.1"
rounded:
  spine: "3px"
  card: "8px"
  button: "14px"
  sheet: "26px"
  pill: "999px"
spacing:
  unit: "4px"
  gutter: "16-20px"
  touchTarget: "44pt"
components:
  button-primary:
    backgroundColor: "{colors.bus}"
    textColor: "{colors.brown}"
    typography: "{typography.black}"
    rounded: "{rounded.button}"
    padding: "0 18px"
    height: "52px"
  button-ghost:
    backgroundColor: "{colors.white}"
    textColor: "{colors.brown}"
    typography: "{typography.black}"
    rounded: "{rounded.button}"
    padding: "0 18px"
    height: "52px"
  chip-selected:
    backgroundColor: "{colors.brown}"
    textColor: "{colors.white}"
    typography: "{typography.heavy}"
    rounded: "{rounded.pill}"
    padding: "0 13px"
    height: "32px"
  chip-unselected:
    backgroundColor: "{colors.white}"
    textColor: "{colors.brown}"
    typography: "{typography.heavy}"
    rounded: "{rounded.pill}"
    padding: "0 13px"
    height: "32px"
  pocket-card:
    backgroundColor: "{colors.white}"
    textColor: "{colors.brown}"
    rounded: "{rounded.card}"
    padding: "14px"
  spine:
    backgroundColor: "{colors.pool}"
    textColor: "{colors.white}"
    rounded: "{rounded.spine}"
    width: "22-36px"
    height: "96-122px"
---

# Design System: My Library — Painted Bookcase

## Overview

**Creative North Star: "Book Fair Saturday"** — a children's-library picture book, grown up.

My Library is a hand-painted bookcase, not a cover grid. Every copy a reader owns renders as its own standing spine — colored, outlined, sized and patterned deterministically from the copy's database id, so the same book always wears the same spine. Shelves are rooms; a plank of color carries a room tag pill and a handwritten tape note. Dewey, a small SVG bookworm, sits on one shelf and says one true, dry, data-driven thing about the library — never about the owner. The whole world runs on six fixed inks plus paper, 2–2.5px outlines, and hard offset shadows with no blur; nothing is a tint, a gradient, or a soft glow. This is Operate register (PRODUCT.md): the redesign's charm lives in precise, reliable details — the Store Mode verdict, the pocket card, the shelf props — never at the expense of scan speed or legibility.

The build replaces "Reading nook at golden hour" (cream + Fraunces + clay + soft warm shadows) outright. Nothing from that world survives except the underlying data model; palette, type, shadow language and signature components are new from the ground up.

**Key Characteristics:**
- Six fixed inks (tomato, bus/yellow, pool, grass, plum, tape) plus paper and brown ink — no tints, no gradients, halftone dots for extra tone
- Every shape carries a 2–2.5px ink outline and a hard 3–4px offset shadow (never soft, never blurred)
- Bagel Fat One for display type, Figtree for all UI, Gochi Hand reserved for handwritten asides
- Yellow (`bus`) is spoken for: it is the primary-action color and nothing else
- Each owned copy's spine is deterministic and permanent, derived from its row id
- Dewey's lines are generated from real counts — never invented, never aimed at the reader

## Colors

Six fixed inks plus paper and brown; no tints, no gradients. Extra tone comes from halftone dot patterns (see Shapes), never from lightening a color.

### Primary
- **Bus Yellow** (`#F4B41A`): the primary-action color, exclusively. Scan sticker, primary buttons, the Store Mode viewfinder corners and scan line, the "STORE MODE · N SCANNED" pill, Lamplight's lamp light. Nothing else in the system is allowed to use it — see the Yellow Rule below.

### Secondary
- **Tomato** (`#E2462B`): stamps (ALREADY YOURS, WANTED SINCE…), the pocket card's top rule, book-detail's "you are here" plank, verdict emphasis.
- **Pool Blue** (`#2F6FB0`): the most common spine/plank color, one of the shelf plank rotation colors.
- **Grass Green** (`#3E9A5A`): the "You own this!" verdict sheet, Dewey's body fill, read-status accents.
- **Plum** (`#7B3F6E`): the wishlist/Someday shelf plank, a spine swatch, wishlist stamps.

### Neutral
- **Ink Brown** (`#2B1D14`): every outline, every hard shadow, and primary text on paper-toned surfaces (light scheme's `line`/`text`).
- **Soft Brown** (`#6B5646`): secondary text on the light scheme — warm-tinted, never gray.
- **Paper** (`#FBFAF4`): the light scheme's screen ground.
- **Case Back** (`#F3E9D2`): the bookcase's back panel, behind the shelves.
- **Cream** (`#F3E0BE`): one of the eight deterministic spine swatches only — not a screen-level neutral.
- **Scene Dark** (`#1B130D`): the Store Mode camera screen's backdrop, behind the live camera view and its permission/loading states.
- **White** (`#FFFFFF`): cards, bubbles, toasts, inputs, ghost buttons, Dewey's eye-whites — always outlined, never a bare fill.

### Lamplight (dark twin)
Lamplight is not an inverted light scheme; it recolors the frame and reweights two roles:
- **Lamplight Paper** (`#2E2016`) / **Case Back** (`#1F140D`): screen ground and bookcase back go near-black brown, not gray.
- **Oak Frame** (`#A2622F`, 6px wide vs. light's 2.5px ink outline): the bookcase frame turns into a lit oak plank, thicker than the outline it replaces.
- **Lamplight Room Tag** (`#E3B55B`): room tag pills switch from white to this warm gold — the one place Lamplight's surface color differs from a straight brown/cream swap.
- **Lamplight Text** (`#FFF4E0`) on **Lamplight Line** (`#120B06`): text lightens, outlines go near-black, so the 2–2.5px ink-outline language still reads at night.
- The five accent inks (tomato, bus, pool, grass, plum) and white are unchanged in Lamplight — only the ground, frame and room tag shift.

### Named Rules
**The Yellow Rule.** `bus` (#F4B41A) is the primary-action color and nothing else: the Scan sticker, primary buttons, and Store Mode's own chrome (viewfinder, scan line, session pill). No decorative, informational or secondary use anywhere in the app.

**The No-Tint Rule.** Every color in the system is one of the fixed inks at full saturation, or paper/white. Extra visual weight comes from a halftone dot pattern, an outline weight change, or a different ink — never from lightening, darkening or fading a color toward transparency.

## Typography

**Display Font:** Bagel Fat One (with Georgia, serif fallback)
**Body Font:** Figtree, weights 600–900 (with system-ui fallback)
**Hand Font:** Gochi Hand (with cursive fallback) — tape notes and Dewey-adjacent asides only

**Character:** A rounded, chunky picture-book display face over a heavy, no-nonsense UI sans; a single cursive hand font supplies the one "handwritten" register, tightly scoped so it never becomes a UI crutch.

### Hierarchy
- **Display** (Bagel Fat One 400, 40px/44, screen titles) or (34px/38, book title on Book detail) or (19px, stamp text): screen titles, the verdict headline ("You own this!" / "A new find!"), cover-art titles, stamp copy. Never used for body or UI chrome.
- **Black** (Figtree 900, 15px UI label / 17px verdict card title / 10.5px vertical spine title): primary button and chip-selected labels, the verdict card's book title, spine titles (rotated 90°), pocket-card values.
- **Heavy** (Figtree 800, 13–14px): chip labels, LeaderRow labels/emphasis text, Dewey-adjacent status lines ("On your wishlist", "Not on any shelf").
- **Bold** (Figtree 700, 13–15px): headers' sub line, secondary/soft text, tape-note-adjacent captions.
- **Hand** (Gochi Hand 400, 15px, rotated −2°): tape notes and Dewey's tap-to-rotate remarks live in `Bubble`'s bold body copy, not hand — hand is reserved for `TapeNote` alone. Never on a control.

### Named Rules
**The Controls-Never-Handwrite Rule.** Gochi Hand renders only inside `TapeNote`. Every pressable — buttons, chips, tabs, stamps, stickers — uses Figtree, never the hand font, so nothing a user must tap is rendered in a script face.

## Layout

4pt spacing grid (`space(n) = n × 4px`); 16–20px screen gutters; touch targets ≥44pt. Screens are a `SafeAreaView` + vertical `ScrollView`; the Shelves tab's bookcase is a single full-width panel holding one horizontally-scrolling, virtualized shelf per room (`FlatList`, `initialNumToRender={12}`), so a 500-book room scrolls instead of paginating. The tab bar carries a raised, circular Scan sticker as the center primary action, off the shared tab baseline.

## Elevation & Depth

The system uses exactly one depth device — a hard, unblurred offset shadow — everywhere, structural rather than ambient. It is drawn as a real solid-color layer (a `Raised` view painted in the current scheme's `line` color, offset behind its content), not a CSS/native `boxShadow`, because Android's `elevation` API cannot produce a hard offset. There are no soft shadows, no blur, and no ambient ombre anywhere in the built app.

### Shadow Vocabulary
- **Card/sheet offset** (`Raised offset=3`, radius matches host): the default — pocket cards, buttons, bubbles, toasts, stamps' host card.
- **Bookcase offset** (`Raised offset=4`, radius 8): the one place depth is pushed slightly harder, marking the bookcase as the screen's main object.
- **Back-button offset** (`Raised offset=2`, radius 22): the smallest offset, on Book detail's circular back control.
- **Pulled-cover offset** (`Raised offset=5`, radius 6): the largest offset, on Book detail's tilted (−4°) cover art — the "pulled off the shelf" moment.
- **Button press:** the button's face (not the shadow layer) translates by the offset (3px) on press-in, so the face visually sinks into its own shadow rather than the shadow shrinking.

### Named Rules
**The Raised Rule.** Depth is always a solid offset shape behind the content, drawn at the shape's own outline color, never a translucent/blurred shadow. If it isn't drawn by `Raised`, it isn't a shadow in this system.

## Shapes

2–2.5px ink outline (`c.line`) on essentially every shape — cards, buttons, chips, spines, the bookcase, stamps, stickers, bubbles. Lamplight thickens the bookcase's outline to a 6px oak frame in place of the thin ink line, everywhere else the outline weight is unchanged. Radii are role-based, not uniform: spines round only 3px (near-rectangular, like real book spines), cards 8px, buttons 14px, sheets (the verdict sheet's top corners) 26px, and pill shapes (chips, room tags, the Scan pill, stickers) are fully round. Cover art rounds asymmetrically — 3px on the spine edge, 6px on the fore-edge — to read as a bound object rather than a card. Halftone dot patterns (an SVG tile of 0.9px-radius dots) are the system's only way to add visual texture without breaking the flat-ink rule.

## Components

### Buttons
- **Shape:** 14px radius, 2.5px outline, 52px height.
- **Primary:** `bus` (#F4B41A) fill, brown (#2B1D14) text, Figtree Black — the only place primary yellow is legal outside Store Mode's own chrome.
- **Ghost:** white fill, same outline/text — used as the secondary action beside a primary (e.g. "Move shelf" / "Wishlist it").
- **Press:** the button's face translates 3px right/down over 120ms (`motion.feedback`) so it visually sinks into its own drawn shadow; releases back over the same duration.
- **Disabled:** 0.45 opacity, no shadow change.

### Chips
- **Style:** full-pill, 2px outline, 32px height.
- **State:** selected = brown fill / white text; unselected = white fill / brown text. Also used as a non-interactive status `Pill` on Book detail (identical look, no press feedback, never announced as a button).

### Cards / Pocket Card
- **Corner Style:** 8px radius.
- **Background:** white, with a 9px tomato top rule under a 2px outline divider — replaces stat-grid layouts everywhere in the app.
- **Shadow Strategy:** `Raised offset=3` (see Elevation & Depth).
- **Border:** 2.5px ink outline.
- **Internal Padding:** 14px horizontal, 8px vertical; rows inside use `LeaderRow` — a dotted-leader label ⋯⋯⋯ value pattern.

### Navigation
Five-tab bar (Shelves · Search · Scan · Wishlist · Profile); Scan is a raised circular yellow sticker breaking the tab baseline as the app's one unmissable primary action. Tab switches are instant/native, no transition authored.

### Spine (signature)
An outlined rectangle whose width (22–36px), height (96–122px), fill/pattern (plain, band, or halftone dots from an 8-swatch set), and vertical title visibility are all derived deterministically (FNV-1a hash) from the copy's database id — so a given copy always renders the same spine, and the Book detail cover pulled for that copy shares its fill/accent colors. Titles render rotated 90°, Figtree Black 10.5px. Press lifts the spine −8px over 120ms; the last spine on a shelf of 4+ leans −10°.

### Shelf / Bookcase (signature)
A `Shelf` is a horizontally virtualized row of spines standing on a colored plank (one of five rotating plank colors), with a room-tag pill (name · count) and an optional rotated tape note at top-left. A `Bookcase` is the outlined, `Raised`-shadowed panel that holds one `Shelf` per room, with exactly one prop (a two-tone `Plant` SVG) at the end of the first shelf.

### Stamp / Sticker (signature)
`Stamp` renders rubber-stamp verdict copy (ALREADY YOURS, WANTED SINCE…) that slams onto the verdict card: scale 2.4→0.92→1.04→1 with rotation −22°→−8°→−9° over 420ms, firing a heavy haptic and a small card shake on impact. `Sticker` is its "new find" counterpart — a yellow circle that spring-slaps into place. Both are `pointerEvents="none"`, decorative-over-content, and both collapse to a static end state under reduced motion.

### Dewey (signature)
An SVG bookworm (three stacked green circles, white eye-patches, ink outline) with four moods — happy, smug, gasp, sleep — and a spring "pop" entrance (`popSpring`: damping 9, stiffness 180, mass 0.7) used on the Shelves shelf and the verdict sheet. Sleep mood draws a drifting "z". Speaks through `Bubble` (white, outlined, `Raised`-shadowed, `ZoomIn` on text change) using lines from `src/features/dewey/lines.ts` — see the wit contract in Do's and Don'ts.

## Do's and Don'ts

### Do:
- **Do** keep `bus` yellow exclusive to primary actions and Store Mode's own chrome (the Yellow Rule).
- **Do** draw all depth as a solid offset shape via `Raised`, never a blurred/translucent shadow.
- **Do** derive a copy's spine and fallback cover deterministically from its id, so it never changes between sessions.
- **Do** keep secondary text warm-toned (`soft` #6B5646 light / #D9C3A0 lamp) — never true gray.
- **Do** keep Dewey's lines true and data-driven (built from real counts/loans/wishlist age), roasting the library, never the reader.
- **Do** silence Dewey on errors, permission prompts and destructive confirmations; those use plain librarian copy that names the problem and the fix.
- **Do** cap Dewey's lines at 70 characters and hide them entirely (bubbles, tape-note jokes, toast quips) under the Quiet librarian setting.
- **Do** collapse the verdict stamp/sticker/Dewey-pop sequence to static, non-scaling end states under reduced motion, while keeping verdict color, copy and haptics.

### Don't:
- **Don't** introduce a tint, gradient, or lightened/darkened variant of an ink — reach for a different ink or a halftone dot pattern instead.
- **Don't** give a shape a soft or blurred shadow, an ambient glow, or native `elevation` — every raised surface in this world uses the hard-offset `Raised` layer.
- **Don't** render Gochi Hand on anything pressable; it is reserved for `TapeNote` alone.
- **Don't** invent a Dewey line — every line must trace to a real count, duplicate, loan, or wishlist-age value in the context object it's built from.
- **Don't** use emoji as icons or status markers; the app's only iconography is inline SVG line art (back chevron, close X) or the illustrated components above.
- **Don't** stack cards inside cards, or build a metric-grid of big-number tiles; use `PocketCard` + `LeaderRow`'s dotted-leader rows instead.
- **Don't** place an eyebrow/kicker label over a display headline as a new pattern — the build carries exactly one instance of this (the Shelves greeting over "My Library"), and it is a defect this DESIGN.md does not extend into a system rule. See the finish notes.
