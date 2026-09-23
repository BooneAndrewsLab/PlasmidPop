# 40. Enzymes that cut on both sides of their site

Done, 2026-09-23 (#19). REBASE has 27 enzymes with a cut on each side of
the site — BcgI is `(10/12)CGANNNNNNTGC(12/10)` — and item 7's import
skipped them because `Enzyme` held one pair of cut offsets.

- **An optional second pair, not a list of cuts.** `Enzyme.secondCut`
  holds the cut after the site; `cutTop`/`cutBottom` keep the one before
  it. Nothing in REBASE cuts three times per site, every existing
  enzyme and stored set stays valid unchanged, and the worker and Dexie
  carry the extra field through structured clone without a migration. A
  set imported before this has no double cutters until it is imported
  again.
- **A match is two `CutSite`s.** `findCutSites` pushes each cut on its
  own, with the same `siteStart` and strand, so everything downstream —
  digest, gel, map and sequence marks, the edit carry-over in
  `carryAnalysis` — handles them the way it handles two cutting
  enzymes, with no change. On a linear molecule a cut past an end is
  dropped and the other kept, as for Type IIS. The price is in counting:
  a BcgI with one site "cuts twice", so it is not a single cutter and is
  not ticked when a document opens. That is what it does to the DNA — it
  takes out ~34 bp rather than linearising — so the count is left as the
  truth rather than special-cased.
- **Mirroring.** The reverse-strand pass mirrors both pairs round the
  site as before. Palindromic double cutters have symmetric offsets in
  REBASE (AlfI, BplI, FalI, HsoII…), so the forward pass alone finds both
  cuts; HaeIV is the one exception, the data are taken as given.
- **Golden Gate** leaves them out (`goldenGateEnzymes`): they are Type IIS
  by the test `isTypeIIS` applies, but a part keeps no end of the
  enzyme's making on one side only.
- **Isoschizomer key** includes the second pair, so a double cutter never
  shares a row with a single cutter of the same site (item 39).
