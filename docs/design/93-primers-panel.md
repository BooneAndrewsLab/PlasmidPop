# 93. The Primers tab as three groups and a denser candidate list (#226)

**Asked:** redesign the Primers side panel: visual polish and consistency
with the rest of the sidebar, clearer sections, a denser candidate list,
and the phone layout. Noticed alongside the Format menu's cramped GC
window row (item 92), which set the visual language this follows.

**What was wrong:** the tab was three headings in a column with a rule
between them, and the parts that make it up did not match each other or
the other tabs. A designed pair took about 170 px of a 300 px panel: two
lines per primer (the bases, then its Tm and GC under them), then a foot
whose three buttons — **Add both as features** alone is three lines wide
there — wrapped into a ragged column. The target and the rules were one
grey paragraph, and the rules were said twice (there and in the Settings
summary, which only said "defaults"). Under My primers, **Mismatches** and
**Shortest site** were two full-width selects whether or not Find was on;
a site read as `bla-F 4,129–4,153 exact Add PCR rev` on one line, wrapping
where it happened to; a kept primer gave its length and nothing else a
scientist checks before ordering. On a phone the tab is not offered at all
(`PhoneShell` lists Features, Protein and Enzymes: a reader, item 15), so
"the phone layout" here means the stacked sidebar between 600 and 720 px,
where the panel is as wide as the window.

**Built:**

- The three parts are `fieldset.panel__group`s with legends, as the CRISPR
  and Align tabs' groups are: **Design primers** (for the selection),
  **Check a primer**, **My primers** (count in the legend's note). The
  target stands on a line of its own in the ink colour. **Settings** and
  **Add primers** are `.panel__details`: a disclosure whose summary is a
  settings row — the name on the left, what it comes to on the right in
  quiet text (`describePrimerCriteria` for the settings, with a **changed**
  flag once any is off its default) — with the chevron the Format menu's
  sub-rows and the alignment heading use, turned when open.
- A candidate pair is one block: a head of rank, product size and ΔTm (the
  two numbers a pair is first judged by); the two primers as rows of the
  strand arrow the site lists use, the bases, and the Tm and GC content
  pushed to the right edge, so they line up as a column down the list; and
  the actions, **Show**, **Add both** and **Save both**, on one line. A
  primer row is a wrapping flex row: beside a 20-mer the numbers fit at
  300 px, beside a longer primer they go to a line of their own but stay at
  the right edge, in the column. The bases never break mid-sequence; they
  are what gets ordered. A pair is about 100–120 px now, and the whole list
  of ten fits in a laptop's sidebar with the head of the next group in
  sight. Pointing at a pair previews it, so the row lights up on hover and
  focus-within and the shown pair keeps that tint with its left bar. The
  visible label is **Add both** and the accessible name stays **Add both
  as features**, so the guide's and the tests' name holds and the visible
  text is in it.
- **Mismatches** and **Shortest site** are indented sub-rows of the Find
  tick box (`.panel__form--sub`, label left and the select sized to its
  choices) and are there only while Find is on, as the Format menu's custom
  width is only there under **Custom**. A site is two lines, the primer's
  name over its position and fit, with **Add** and **PCR fwd/rev** at the
  right. A kept primer gives `17 nt · Tm 52.8 °C` beside its name
  (`meltingTemperature` at the tab's conditions; a degenerate primer, whose
  Tm is NaN, its length alone), and its actions on one tight line.
- **Check a primer** gets a mono box, its stats in a tabular line, and
  **Add sites as primer_bind** and **Save to My primers** in one row.

**Not changed:** what is designed, found or saved; the `primers.*` and
`collection.*` panel memory; analytics events; the `.pair__row` and
`.pair__foot` rules the PCR, mutagenesis, SOE and overlap panels share — the
candidates use `.pair--candidate`, `.pair__head` and `.pair__oligo` of their
own. Guide page 10 was updated to match.
