# 44. Dam and Dcm methylation

Done, 2026-09-23 (#17). Item 7 left it out because REBASE's `<4>` is where an
enzyme's own methyltransferase acts, not whether the host's Dam or Dcm
blocks it, and that needs a separate dataset.

- **Decided:** a hand-curated list built into the app, from a supplier.
  `DAM_DCM_SENSITIVE` (`core/analysis/methylation.ts`) holds the enzymes
  NEB's application note "DNA Methylation & Restriction Digests" lists as
  blocked or impaired by Dam or Dcm methylation, by name — 46 of them, 23 in
  the bundled table, the rest there for an imported REBASE table. It is a
  list of facts, cited, not NEB's text. The PDF's OCR mangled some names
  (Acc651, Bc1I, EcoO1091, Mbol, Nrul, StyD41, Hpy1881II), corrected by hand
  to the real enzyme names. The note does not say which of Dam or Dcm, nor
  blocked from impaired; neither is stored.
- **By name, then by sequence.** Sensitivity is the enzyme's own — MboI and
  Sau3AI share GATC and only MboI is blocked; BamHI ignores the GATC in
  GGATCC — so the list decides whether to look, and the sequence decides
  where: `hostMethylationAt` finds each GATC and CCWGG within four bases of
  a site and asks whether its methylated base on either strand lands inside
  the site. That is what makes XbaI blocked in GATCTAGA and not in
  CTCTAGAC, and which of Dam or Dcm it is falls out of it.
- **Which base.** Dam: the A of GATC, `2(6)` in REBASE's M.EcoKDam, and
  the bottom strand's A opposite the T. Dcm: the inner C of CCWGG and its
  bottom-strand counterpart, the standard reading. NEB's note says "the
  first cytosine", which contradicts the rest of the literature; REBASE's
  local file has no usable Dcm entry to settle it (M.EcoA15Dcm is `?(5)`).
  With the inner C, pBR322's known cases come out right: MscI at 1,446
  (…CCTGGCCA) and EcoO109I behind it, Dcm; BspEI at 1,664 (TCCGGATC), Dam.
- **Shown, not simulated.** The Enzymes tab marks an affected cut position
  (**m**, warning colour, tooltip) and says under the row how many of its
  sites are affected. Digests, the gel, the double digests and the Cloning
  tab still cut everything: whether the DNA is methylated at all depends on
  where it was grown, which the document does not know. The follow-up is
  to make that a document property — SnapGene's sequence flags carry it —
  and let the digests use it.
