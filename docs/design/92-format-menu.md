# 92. The Format menu as a settings list (#227)

**Asked:** rework the Format menu. The GC window row had looked cramped
(fixed in 4e4a62f as a label-left, control-right row), which suggested the
menu's field rows and grouping wanted a look as a whole.

**What was wrong:** the menu was a classic menu, one item per choice: three
text sizes, six row widths, three residue numberings, three trace heights,
each on its own line with a tick. With the toggles, the colour swatches and
the GC window that came to 24 rows and about 875 px — taller than a laptop
viewport (800 px) and the list neither scrolled nor could be reached by
keyboard past the edge, so **Trace**, **Reset the layout** and **Keyboard
shortcuts…** were off the screen on many machines. Choosing a text size
meant reading three lines to find the ticked one. The one row that was laid
out differently, the GC window, was the one that read best.

**Built:**

- `FormatMenu` is laid out as a settings list, the way SnapGene's View
  options and Benchling's display settings are: a setting is one row, its
  name on the left and its control on the right. A setting with a few
  choices (text size, bases per row, residue numbers, trace) is a row of
  segmented buttons — the toolbar's `.segmented` at a smaller size — so
  every choice is in view and one click away, with no tick to hunt for. A
  toggle stays a `menuitemcheckbox` row with its tick. A row that belongs to
  the one above (the custom width, the base colours, the GC window) is
  indented under it, shown only while it applies. The whole menu is now
  10 rows plus the sub-rows, about 430–500 px, and
  `.menu__list--settings` caps it at the viewport height and scrolls past
  that, so nothing is ever unreachable.
- Two groups with the labels the guide uses: **Sequence view** (the strands
  themselves: text size, bases per row, numbering, colours) and **Tracks**
  (what is drawn around them: GC content, residue numbers, trace). The two
  items that are not about the sequence view, **Reset the layout** and
  **Keyboard shortcuts…**, sit under a separator as before.
- Labels shortened to read in a row: **Fit** for "Fit the window", **All**
  for "Every residue"; the tooltips keep the long form. The GC row shows its
  key (`Alt+G`) in the shortcut column, as the Edits menu's items do, and
  carries it as `aria-keyshortcuts`.
- Keyboard: Tab still walks every control, as `Alt+O` promised (#34),
  since each segment is a button. The arrow keys also move along a row's
  choices, applying as they go and wrapping at the ends, stepping from the
  focused button so a typed row width (no segment chosen) still has a
  starting point. A row whose setting has nothing to apply to (residue
  numbers on a protein, the trace without an AB1 read) is disabled as a
  whole, the reason in its tooltip and a note beside its name.
- Roles: each choice row is a `radiogroup` of `radio` buttons named by its
  label, so the tests and a screen reader find "Large" or "60" as a radio;
  the toggles keep `menuitemcheckbox`. The menu is narrower than 390 px,
  though a phone never shows it (the phone toolbar is the name and the
  File menu).

**Not changed:** which settings there are, their store fields, their
analytics events (item 38) and what they are remembered as. Guide pages
03, 02, 09 and 14 were updated to match.
