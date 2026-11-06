# 135. The CRISPR workspace, looked at in a browser

Status: the CRISPR part of the look pass of item 133 (#397), built. Item
134 is the Enzymes pass and says how the two were done.

What was asked: the same judgement as for the Enzymes tab, on the slim
panel, the three workspace pages (Guides, Pairs, Prime) and the phone,
with pBR322 open (578 guides, 3,881 pairs) in the dark theme on a
1489 px window.

## What was seen, and what was done about it

- **The settings were a form of rows.** Nuclease, Off-targets up to, the
  two check boxes, Spacer contains, PAM, Show flagged and Base editor took
  about 270 px, so the table started at y = 375 on an 812 px window. Their
  fields (`panel__field--row`, one to a line) now take `flex: 1 1 15em`
  with their select or number box set to `width: 0; flex: 1 1 8em`, which
  is what stopped a long option list from sizing the row. Nuclease and
  Off-targets share a line, as do PAM, Show flagged and Base editor; the
  table starts at y = 300. The rules are on `.crispr-ws__settings` and
  `.crispr-filters`, which sit above the `.crispr-ws` wrapper rather than
  inside it.
- **The table was wider than its box.** The Spec. column and the flags
  column were cut off at the right. The five off-target columns were each
  about 67 px for a one-digit number; the table's cells in this workspace
  now take 4 px of side padding instead of 6, which brought it within the
  box. Flags still scroll in by a few pixels at the narrowest split.
- **The detail was out of sight.** As on the Enzymes page, the 60 vh box
  left no room for the detail's head; it is `min(42vh, 420px)` here too.
- **The Prime form's replacement box** was too narrow for its own
  placeholder ("ACGT, or nothing to delete" was cut at "nothing to d").
  It has a minimum of 14 em.

Seen and fine: the slim panel (the 8 rows, the status line and the three
doors); the Pairs table (nick pairs, the overhang column) and the Prime
page with an edit at 120 (five pegRNAs, the parts block with its Copy
buttons, the edit on the map); the badges on the rail (466, 3,881, 5).

## Seen and left

- The Pairs and Prime tables stop at a short box with empty space under
  them on a tall window. Their scroll boxes are separate from the Guides
  one and could be taller; there is no detail pane under them to leave
  room for.
- On the phone the settings come before the table, so the table is below
  the first screen. It works; moving the settings into a folded section is
  a change to the page's design and is not in this milestone.
- `pairNickases` runs in the workspace for the badge. With 578 guides it is
  not noticeable; the 25,000-guide BAC case from the C5 report was not
  measured here.

## Not checked

The light theme of these pages, and the slim panel at 320 px (the window
had only the one width).
