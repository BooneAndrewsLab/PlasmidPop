# 15. Mobile-friendly layout

Done, 2026-09-22, as a **reader**, not a
smaller editor. The question asked first was who holds the phone and why,
and the answer shaped everything: someone opened a link a colleague sent
(item 11 made that inevitable — plasmids now travel in chat messages, and
messages are read on phones), someone at the bench or the freezer wants a
list (which enzyme cuts once, what are the fragments), or someone is
showing a map to a colleague. Nobody designs a primer or types a base on a
phone. So the target was "a share link reads well on a phone", and the
centre of gravity moved from the map to the list.

- **`PhoneShell`** (`src/app/components/`) at `PHONE_QUERY` (600 px,
  `layout.ts`): one pane at a time — **Map**, **Sequence**, **Details** —
  behind a bar of three 48 px tabs at the foot of the screen, with the
  safe-area inset under it. Details is the Features and Enzymes panels
  alone (`SidebarPanel`, lifted out of `Sidebar` for it), on the store's
  own `sidebarTab` so a tab any other code opens is honoured, falling back
  to Features from one the phone has not got. The pane is local state,
  starting on the map, because that is what a link is opened to see; it is
  not a view preference. Tapping a row in a list bumps `reveal`, and on a
  phone the view is on another pane, so the shell answers a reveal raised
  while on Details by going to the view pane last looked at; a reveal from
  a view itself changes nothing, and the nonce present at mount is never
  answered.
- **The toolbar is the name, the size and shape, and the File menu.** The
  view switcher is the shell's bar; the toggles, Format, Edits and History
  are for editing. `.toolbar__meta`, hidden at 720 px to make room for the
  toggles, comes back at 600 px because the toggles have gone and "4,361
  bp, circular" is the first thing a reader wants. No splitters; the
  sidebar's 200 px row of the stacked layout is overridden away.
- **Touch is a tap, not a drag**, decided by `pointerType` rather than by
  screen size, so a tablet in the desktop layout gets the same. On the
  sequence view a finger down decides nothing — the browser owns the drag
  (`touch-action: pan-x pan-y pinch-zoom`) and the view acts on the tap at
  `pointerup` if the finger lifted within `TOUCH_SLOP` (10 px); a scroll
  arrives as a `pointercancel` or an up elsewhere and is left alone. The
  press itself is the same `press()` a mouse takes, so a tap on a feature
  bar selects the feature and one on the bases places the caret. On the
  map a finger drag was already a pan or a pinch (`touch-action: none`);
  what was missing was hover. **A tap on a feature sets the hover** to it,
  and `onPointerLeave` — which fires the moment a finger lifts — leaves a
  touch hover alone, so the tapped feature's label comes back if the ring
  dropped it and stays until the next tap. That is item 29's recovery for
  dropped labels, made to work without a pointer that rests.
- **The reader shows the bases alone**: `LinearSequenceView`'s `reader`
  prop applies neither the Complement nor the Translations toggle, since
  each adds a line to every row and a phone has the height for neither.
  The stored preferences are untouched. Cut sites are left to the toggle:
  they rank below features in the label layout, so they cost the features
  nothing (measured: pBR322 at 390×600 draws 24 feature labels with no cut
  sites and 24 with 35), and the Enzymes tab's own "Show cut sites" link
  still works.
- **Measured** in `labelCollisions.test.ts`, which now has a 390×600 case:
  pBR322 with every feature named draws 24 and drops 32 at zoom 1 (34 and
  22 at 900×700), 31 and 60 with 35 cut sites; the 13.8 kb construct draws
  30 and drops 26. 0 collisions, leaders ≤ 54 px, 1–5 ms. Those drop
  counts are the argument for item 29's second label ring and item 31's
  spreading a crowd about its centre: a phone is where they would pay.
- **`@media (pointer: coarse)`** grows the things a finger lands on:
  buttons and segmented buttons to 36 px, document tabs and their × to
  36/28 px, the map's zoom buttons, the sidebar's tabs to 40 px.
- A **notice** under the toolbar says once that this is the reader and
  editing works best on a larger screen, with **Got it** remembered in
  `localStorage` — without it the missing toolbar reads as broken. The
  guide's "On a phone" section (`03-viewing.md`) says the rest.
- **The first look on a real phone found a map bug** (2026-09-22): the
  name in the centre of the ring was drawn as a squeezed script.
  `drawCentre` handed `fillText` its `maxWidth`, which condenses the
  glyphs sideways rather than doing anything readable (and the SVG export
  did the same through `lengthAdjust="spacingAndGlyphs"`); with four
  lanes of features inside a 390 px ring there are ~40 px in the middle.
  `fitTitle` now steps the title font down to `MIN_TITLE_PX` (11) and past
  that the name is **left out**, not shortened — the first cut ellipsized
  it, and "SYN…" says nothing the toolbar's name does not, on a phone or on
  a desktop map dragged narrow (which squished the same way). The length
  is whole or absent too, and takes the middle when the name has gone.
  Nothing on the map passes a `maxWidth` any more. Tested through the SVG:
  "pBR322" stays at 15 px, "pLenti-CMV-EGFP1" steps down whole, "SYNPBR322
  copy" at a phone's size draws nothing, and no `textLength` is written.
- **Not done from here: tested on a real device**, which the item asked
  for and which a jsdom test cannot stand in for. Also not yet: long-press
  to select a stretch of sequence for copying (the one editor-ish thing a
  reader might want, and it fights the browser for the gesture); whether the messaging
  apps people actually use pass a 10 k-character URL fragment intact
  (Slack and email do; some SMS apps rewrite long links), which decides
  whether the link case is real; a Web Share Target so a GenBank
  attachment can be opened from a phone's mail app; hiding cut sites by
  default on a phone; and the phone pane is not remembered across a tab
  switch or a reload.
