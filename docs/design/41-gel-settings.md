# 41. The gel's percentage and ladder, and a reversible order

Done, 2026-09-23 (#21). Item 30's gel model was a 1 % agarose gel with a
ladder picked for you, and the Band separation order ran one way.

- **A percentage is a resolved range** (`gelForAgarose` in
  `core/analysis/gel.ts`): 0.7 % is 800 bp–12 kb, 1 % 500 bp–10 kb, 1.5 %
  200 bp–4 kb, 2 % 100 bp–2 kb, from the supplier tables. The rest of
  `GelOptions` is scaled from the range's foot the way `DEFAULT_GEL` sits at
  1 % — easily missed under a fifth of it, dye front at a tenth, bright at
  the foot itself — so `gelForAgarose(1)` is `DEFAULT_GEL` exactly and the
  1 % behaviour did not move. Resolution stays 15 %: a thicker gel shifts
  the range down more than it sharpens it, and a second knob with no data
  behind it would be false precision.
- **One setting for every gel.** `gelAgarose` and `gelLadder` are shared
  state remembered in `viewPrefs`, and `useGelOptions` is the one place
  the options are read, by the ⚠ on a row, the order, the double digests,
  the ticked-digest lane and the PCR lane. The menus sit under the gel
  itself (in its caption, which now names the percentage) rather than in
  the Enzymes controls, because the PCR tab draws a gel too and the
  question "what gel is this" is asked while looking at one.
- **Ladders:** Automatic keeps item 30's rule (100 bp when everything is
  under 1.5 kb, else 1 kb); 1 kb Plus is added for a lane with a large and
  a small piece, which neither of the two fits.
- **Reversing** is a toggle beside Order, `enzymeSortReversed`. By name it
  is Z–A; by band separation it is the hardest lanes first — for finding
  the enzyme whose pieces run together — with the enzymes that do not cut
  kept at the foot, since they have no lane to be judged by.
