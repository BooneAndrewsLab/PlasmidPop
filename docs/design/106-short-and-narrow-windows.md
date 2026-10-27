# 106. Short and narrow laptop windows

Done in 1.17.5 (#292); point 6 for #296. Seen on a small MacBook in Safari 16.6 with a
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
6. **A phone on its side (#296, after 1.17.6).** At about 800 x 400 the
   desktop layout applies (wider than `PHONE_QUERY`) and the toolbar took
   four rows, 154 px of 400: the logo and name; File, History, View and the
   three toggles; Format and Edits; the `?`. `SHORT_WINDOW_QUERY`
   (`layout.ts`: at most 1000 px wide and 500 px high) names that window,
   and two changes bring the toolbar to one row of 49 px at 800 x 400 and
   844 x 390, measured in iframes of the dev server:
   - **The toggles go into Format.** `SHOW_IN_FORMAT_QUERY` is the short
     window or the stacked layout's 720 px, where `.toolbar__show` had been
     hidden by CSS with no other way to them but the keys. There the toolbar
     does not render the group, and `FormatMenu`'s `viewToggles` puts
     Complement, Translations and Cut sites first under **Show**, as
     checkbox items with their keys, the same setters and the same
     analytics. A protein, which has none of the three, gets neither. This is
     the edit bar's `More ▾` (point 4) applied to the toolbar, but into an
     existing menu rather than a new one: a fourth menu beside File, Format
     and Edits would cost the row what it saved.
   - **The rest is drawn tighter** in a CSS block on the same query, with a
     601 px floor so the phone's own rules are untouched: smaller padding
     and gaps, the logo at 22 px, the toolbar's own buttons (not those in
     its menus' lists) at 4 x 8 px padding, the name capped at 20vw, and the
     size and shape back under the name as on a phone (the 720 px rule hid
     them only to make room for the toggles). Wrapping stays on, so a name
     or a font that does not fit costs a second row, not an overflow.
     The width cap leaves a wide short window as it was: its toolbar fits on
     one row with the toggles in it. Not measured: a real phone, and the
     36 px buttons of `pointer: coarse`, which the desktop Chrome used cannot
     emulate; at that height the row is about 48 px plus padding. Also seen
     in the same session, unchanged here: at 1280 x 800 the `?` still drops
     to a row of its own (point 2's open question).
