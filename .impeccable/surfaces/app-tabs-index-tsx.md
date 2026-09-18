---
version: 1
slug: "app-tabs-index-tsx"
primary_target: "app/(tabs)/index.tsx"
related_targets: ["app/(tabs)/scan.tsx","app/book/[id].tsx","app/(tabs)/search.tsx","app/(tabs)/wishlist.tsx","app/(tabs)/profile.tsx"]
---

Scope: whole app shell (Shelves, Store Mode, Book detail, Search, Wishlist, Profile). Visitor mode: Operate. Platform: adaptive (iOS + Android, Expo).
Audience/job: book owners cataloging physical books; in a store, know in under a second whether they own the book in hand.
Memorable moment: the Store Mode stamp (ALREADY YOURS) with Dewey popping up.
Unresolved: room management UI, free-text catalog search (no API yet).
Mockups: .impeccable/mocks/screens/index.html (approved). Spec: docs/superpowers/specs/2026-09-18-bookshelf-redesign-design.md.

## Direction contract
THESIS: The library is a painted bookcase: every book a spine, every shelf a room, kept by Dewey the bookworm. Refuses the category default of a cover grid on cream with a serif title.
OWN-WORLD: Six fixed inks plus paper (tomato, school-bus yellow, pool blue, grass, plum, warm-brown ink), no tints or gradients, halftone dots for extra tone; 2px ink outline on everything, hard 3px offset shadows; Bagel Fat One display, Figtree UI, Gochi Hand tape notes; pocket cards, stamps, stickers, masking tape. Yellow is only ever the primary action. Lamplight dark twin: oak frame, halftone lamp light.
STORY: The owner sees their home's shelves at a glance, finds any book by room, and in a store gets an instant, legible verdict; the wit (true, data-driven, dry) makes them want to open the app.
FIRST VIEWPORT: Shelves tab: greeting + "My Library" (Bagel 40) + count line; below, one outlined bookcase filling the width with three room shelves of standing spines on colored planks, room tag pills top-left, tape notes beside them, Dewey with a speech bubble on one shelf; raised yellow Scan sticker button centered in the tab bar as the primary action.
FORM: Book Fair Saturday (children's-library picture book, grown up), candidate 5 of 7 on the ordered list, refined to the Painted Bookcase; seed key 59b9ef76.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
