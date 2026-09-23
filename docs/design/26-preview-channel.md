# 26. Preview a primer before it becomes a feature

Done, 2026-09-21,
and not primer-shaped: what was built is the **overlay channel** the note
asked for. A preview is a list of `OverlaySpan`s — id, label, an
_unrolled_ range, strand, and `arrow` (the thing itself) or `span` (the
stretch between two things) — that both renderers draw beside
`doc.features` (`src/view/overlay.ts`). It lives in the store as
`preview` (`SharedState`, carrying the document it was computed for and
the panel that put it there; `compose` hides it behind another document
tab, `apply` drops it because an edit moves the ground under it, and a
panel clears only its own on the way out — the find bar and a sidebar
tab can both be open). Nothing previewed is in the document, the History
or the SVG exports.

- **In the sequence view** the spans take a band of their own outside the
  feature lanes, and the rows grow for it exactly as they do for
  translation lines (`overlayHeight`, `RowLayout.overlays`, `overlayTop`,
  and an `overlay` hit kind that is deliberately inert — a click there
  does nothing rather than dropping a caret). The lanes are packed by the
  _same_ greedy colouring the features use: `assignLanes` and
  `lanesPerRow` are now thin wrappers over `packLanes` and
  `itemLanesPerRow`, which take `{ id, pieces }`.
- **On the map** they are a ring in the 12 px gap between the backbone and
  the first feature lane. The _last_ lane takes that gap, so a primer's
  solid arc is drawn in the clear and it is the bracket's dashed line that
  crosses the features. A span too short to see is widened by
  `selectionSweep` — item 16's rule for a short selection — so a 22 nt
  primer on a 4 kb plasmid is still an arrow with a head on it.
- Everything is dashed, in `--seq-preview`, a colour used for nothing
  else. That needed `setLineDash` on `DrawingContext` (canvas has it;
  `SvgContext` writes `stroke-dasharray`), which is also how the renderer
  tests can assert what was drawn.
- **Primers**: **Show** on a pair draws its two sites as arrows and the
  product as a bracket, and selects the product — the cheap half the note
  predicted would carry most of the value. Hovering a pair shows it while
  the pointer is there, **Hide** or leaving the tab takes it off, and
  **Add both as features** is still the only thing that edits. **Hide
  gives the product selection back** as well as the drawing (2026-09-22,
  reported the same day): a highlight left behind reads as a pair still
  being shown, which is confusing while the other pairs are being
  hovered. Only the range **Show** selected is cleared — a selection made
  since is the user's and is left alone — which is why the panel holds
  the range it selected rather than a flag. Under
  **Check a primer** every binding site is previewed at once, so
  off-target sites are seen together instead of one selection at a time.
- **Find** draws every match while the bar is open, the current one still
  the selection on top; past 200 matches it draws none, because the count
  answers that question better than 200 marks would.
- A wrapped product taught the convention the hard way: a range over the
  origin must be **unrolled** (`unrollRange`), or `rangePieces` hands back
  a piece with `end <= start` and the span silently draws nothing. That
  was a real bug in the first cut of the Primers panel, found by reading
  the store in the browser rather than by a test.
- **A span can be clicked** (2026-09-22), where the panel that drew it
  marks it `clickable`: the view reports it through
  `editorStore.activatePreview` and knows nothing more. The Cloning tab's
  digest fragments were the first caller and are the reason the flag
  exists — a preview that answers a click everywhere would shadow the
  backbone's own hit band on the map, and a find match has nothing to
  say to one.
- **PCR was the third caller** (2026-09-22, item 36) and cost the channel
  no rendering work at all: a product is a stretch of the template, so it
  is a span, and the two primers are arrows. It did show up the one-channel
  limit in the flesh — the digest above it in the same tab draws fragments
  — so the digest now stands aside while that panel is open, which is a
  decision made twice now and wants a rule if a third panel needs one.
- Not yet: ORFs and a previewed Golden Gate or Gibson product are the
  obvious next callers, the last needing somewhere to draw a molecule
  that is not open; there is one channel, so two panels pointing at once
  means the last one wins; a preview does not come back after leaving the
  sidebar tab; and a previewed primer still does not draw its mismatches,
  which is the thing a scientist squints at.
