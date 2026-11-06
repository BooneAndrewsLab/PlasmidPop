# 134. The Enzymes workspace, looked at in a browser

Status: the Enzymes part of the look pass of item 133 (#396), built. The
CRISPR (#397) and Cloning (#398) passes add their own sections below as
they are done.

What was asked: the makeover of item 133 was built page by page by agents
that could not see the result, each report ending with a list of things only
a person in a real browser could judge. This pass is that judgement for the
Enzymes tab: the slim panel at 320 px, the four workspace pages beside the
map on a 1568 px and a 1489 px window, light and dark, and the phone
reader through a 390 px frame of the dev server (note in memory: the
window cannot be resized, so the frame stands in). It needs the
maintainer's eyes afterwards, as items 107 and 129 did.

## What was seen, and what was done about it

- **Page scroll carried over.** The workspace body is one scroller shared
  by every page, so Digest and Double opened scrolled to where Enzymes had
  been left, past their headings and chips. `WorkspaceShell` now puts the
  body back at its top when the page changes. This is the shell, so Primers
  and Align get it too.
- **The detail pane was out of sight.** Selecting a row on the Enzymes page
  showed nothing: the table's scroll box was 60 vh high, the filter bar
  took another 140 px, and the detail was below the fold of a laptop
  window. The box is now `min(42vh, 420px)` and the filter bar is one
  wrapped row (Filter, Cuts, Sold by, Isoschizomers, then the two buttons
  at the right) instead of a label-and-input row each. On a 711 px window
  the detail's head, with Tick and Find a partner, shows under the table.
- **A sideways scroll in the table.** The Positions and Bands columns set
  the width. Both now wrap (`enz-cuts` 14 em, `enz-bands` 15 em), and the
  **Dam/Dcm** column is not drawn at all when no enzyme in the list has a
  site that could be blocked.
- **The overhang said twice.** The detail's head says "5′ overhang · cuts
  once" and its list began with "5′ overhang". The list now starts at the
  next fact.
- **Phone.** The shared `.ws--phone .dt` rule makes every table row inline,
  which put the headings and cells of the windowed tables in one run. The
  heading row is now a wrapping strip of sort labels, an empty cell is not
  drawn, and the positions and the bands each take a line.
- **A ticked enzyme the table filters out left the slim panel (#406).** The
  panel listed the ticked rows from the table's `rows`, which the Cuts and
  Sold by filters narrow. It now lists them from `tickedRows`, which
  ignores both, so a ticked enzyme is always on the panel and in "N ticked".

## Seen and left

- The Digest page puts the gel above the fragments table. With 30 ticked
  enzymes the chips take four lines and the table starts below a full
  window; that is the plan's order (the gel has room, D-decision on the
  Digest page) and worth a second look once someone digests with fewer.
- The Double page's pairs table has a wide empty gap before **Tick both**.
  It is the Bands column's share; left as it reads clean.
- On the phone the Enzymes table is a column of short cards in a box of its
  own, under the note on hidden cut sites. It works; a card layout of its
  own would read better and is not in this milestone.

## Not checked

The slim panel at 320 px was looked at on the 1568 px window only, not in
a frame; and the light theme of the Digest and Double pages, because the
window that was used from the middle of the pass on was in the dark theme.
