# 106. Short and narrow laptop windows

Done in 1.17.5 (#292). Seen on a small MacBook in Safari 16.6 with a
circular plasmid in the Both view: five parts of the layout degraded when
there was little height or width. Each fix is a patch to the existing
layout, with no new setting.

1. **Sidebar rail.** Icons alone when the labels do not all fit; see
   item 18 for the measurement.
2. **Header.** Undo and Redo are curved arrows (first the characters `↶` `↷`, drawn as SVG from 1.17.6 because macOS fonts render them as bent arrows, #293), with the name (kept as
   the `aria-label`, so queries by name still work) and the shortcut in the
   tooltip. The planned `⋯` overflow menu for the least-used groups was
   _not_ built: it was only to follow if the icons alone did not stop the
   wrap at about 1100 px, and that could not be checked from the session
   (no browser reached the dev server). Reopen the issue if the `?` still
   drops to a row of its own.
3. **Map labels.** A cut-site label with less room than its full text drops
   its position first (`fitCutLabel`: `AlwNI`, the position left to the
   hover), and is shortened with an ellipsis only when the names alone do
   not fit, so a number is never cut. `+N labels not shown` is hoverable and
   tappable: `renderCircularMap` returns its box and the full text of each
   label left out (`hiddenLabels`), and `CircularMapView` shows
   `hiddenLabelsTip` in the follow tooltip, twelve names and a count. The
   linear view needed nothing: it writes the enzyme name only, never the
   position, and has no count.
4. **Edit bar.** The visible hint is `Insert bases…` with the long text in
   its tooltip. Find is a magnifier and Delete selection a bin (both keep
   their names as `aria-label`; Find is `Find…` so it stays distinct from
   the find bar's own field). Add feature stays text: a `+` would sit
   beside the map's zoom `+`. On a bar narrower than 860 px (a container
   query on `.editbar`, so it follows the pane and not the window) Style,
   Case, Set origin here and Make linear sit behind `More ▾`. The group is
   always mounted, so Alt+Y and Alt+U stay bound, but with `More` closed
   on a narrow bar the menu they open is out of sight.
5. **Storage panel.** `persisted() === true` does not exempt Safari from
   its seven-day cap, so where the cap warning applies
   (`mayBeDroppedAfterAWeek`) the "agreed to keep them" sentence is left
   out (`persistenceSentence`).
