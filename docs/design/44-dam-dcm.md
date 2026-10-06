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

Added 2026-09-23 (#45): **the host, and digests that respect it.**

- **A document property.** `SeqDocument.methylation` is `{dam, dcm}`,
  `dam+ dcm+` by default, because that is where a plasmid on a bench comes
  from and a file that says nothing is a plasmid. `pcr` sets it to neither:
  DNA made in a tube has met no methylase. The Enzymes tab's **Grown in**
  offers the four strains a digest is planned against, as an undoable edit
  (`setMethylation`), which is also how it survives a reload — documents
  are stored as GenBank.
- **Marking and cutting are separate.** `hostMethylationAt` is about the
  sequence and stays whatever the host is: "blocked in a dam+ strain" is
  worth knowing about DNA that is not in one, so every site keeps its
  **m**. `cuttableSites` is the other half, and it is what the fragments,
  the gel, the double-digest ranking and the Cloning tab's digest use. The
  distinction is the whole design: one is a property of the sequence, the
  other of this DNA.
- **The pair ranking drops a silenced enzyme entirely**, rather than
  ranking it on cuts it would not make. On pBR322 that is the guide's own
  example, EagI + MscI: a clean two-band digest that plasmid from an
  ordinary strain will not give.
- **It round-trips.** GenBank has nowhere for it, so it rides in a comment
  of ours (`PlasmidPop-methylation: dam-; dcm+`, `methylationComment.ts`),
  written only when it is not the default and taken out of the comments on
  read so a file does not collect copies — the pattern item 10 set for
  sticky ends. SnapGene's own flags byte carries it (0x04 Dam, 0x08 Dcm,
  0x10 EcoKI; 0x01 is circular and 0x02 double-stranded), so its files
  bring their setting with them; EcoKI is read and dropped, since no
  enzyme in the table is blocked by it. **Corrected 2026-10-06 (#152):**
  the first reading took 0x02 as Dam and 0x04 as Dcm, which opened every
  unmethylated double-stranded file as Dam-on. Ground truth: 203 sample
  files (only `ssDNA.dna` lacks 0x02) and a Dam+ Dcm- save (0x06). Dcm =
  0x08 is by elimination, as no sample isolates it.
- Still not modelled: blocked from impaired, and which of Dam or Dcm per
  enzyme, neither of which NEB's note gives (see above); CpG and other
  methylation; an enzyme's own methyltransferase.
- **Derived DNA keeps its host, 2026-09-24.** Found by
  `methylation.exhaustive.test.ts`: an extracted region, a digest fragment
  and a fragment opened as a document all reset to `dam+ dcm+`, so a piece
  of a PCR product came back methylated and its next digest left out sites
  the tube would cut. `extractRange` now copies the source's methylation,
  `DigestFragment.methylation` carries it (and the shelf stores it), and
  `documentFromFragment` restores it. A ligation of several pieces, and the
  products of the one-pot reactions and Gateway, stay `dam+ dcm+`: they are
  what gets transformed and grown.
- **The Cloning tab says what the host took out.** When every ticked
  enzyme's sites are blocked it said "No enzyme is ticked", which sent the
  user to the Enzymes tab to tick what was already ticked; it now names the
  enzymes, the host, and **Grown in**. When only some sites are blocked, a
  line under the count names them.
- **FASTA carries it too, 2026-09-24** (#71): `[PlasmidPop-methylation:
dam-; dcm-]` in the header beside the ends tag, written only when the host
  is not the default. A tag that cannot be read stays in the description and
  survives a save, as a user's own text.

Added 2026-10-05 (#135): **per methylase and per overlap, from REBASE.**
The correctness audit found the name list too coarse: any Dam or Dcm base
inside the site blocked it, whichever methylase the enzyme minds and
however little of the site the methyl group touched. BstXI, AlwNI, PflMI and
SfiI were lost to a GATC inside their N bases; SfoI, BstXI, SfiI, BsaHI and
FokI to a CCWGG on one side only. Dam's and Dcm's bases were right.

- **Decided:** `hostMethylationAt` now compares the methylated bases the
  sequence puts inside the site with the configurations REBASE's "Effects of
  overlapping methylation" tables list for NEB's enzymes
  (`rebase.neb.com/cgi-bin/damlist?mM.EcoKDam+sN`, `mM.EcoKDcm+sN`), 41
  enzymes, kept as `REBASE_CONFIGURATIONS`. A configuration is the offsets of
  methylated bases on each strand within the site; the enzyme is affected
  when the DNA has at least those bases. Facts, cited, not REBASE's
  pages; nothing bundled that the policy forbids.
- **Mirror images.** REBASE draws a palindromic site once, and MscI's
  `TGGCCAGG` and `CCTGGCCA` are one configuration, so a palindromic site is
  matched both ways. A non-palindromic site found on the reverse strand is
  read mirrored, so the configuration follows the enzyme's own spelling.
- **Statuses.** A configuration counts if REBASE records it blocked, or
  impaired with no "cut" beside it. Cut and impaired together is read as
  cut: the impairment rows are tests with M.HpaII or M.SssI, not Dcm.
- **FokI is not Dcm-sensitive.** NEB's own pages refuse automated reads
  (403), so the evidence is REBASE's FokI record: the only impaired entry
  for the base Dcm methylates is "overlapping M.HpaII methylated sites"
  (50% cleaved); the M.SssI test is cut. No Dcm test. The configuration
  REBASE draws, which the audit found cut in pBR322 and lambda, is cut, and
  FokI leaves the table. Revisit if NEB's chart is later seen to say
  otherwise. HaeIII is likewise not added (cut with Dcm), and FseI is.
  _Reversed by #149, below._
- **Enzymes REBASE has no table for** (BclI, DpnII, BssKI, BcgI, FspI,
  PhoI) keep NEB's note: any methylated base of the methylase named, or
  either for the three the note leaves unnamed (`ANY_OVERLAP`). REBASE
  lists no Dam table row for BclI or DpnII at all.
- Still not modelled: blocked from impaired; imported REBASE enzymes under
  other names.

Added 2026-10-05 (#149): **FokI is impaired by overlapping Dcm, per NEB.**
neb.com still refuses automated reads, but the Wayback Machine's copies
can be read: the "Dam-Dcm and CpG Methylation" selection chart
(`web.archive.org/web/20250907211349/https://www.neb.com/en-us/tools-and-resources/selection-charts/dam-dcm-and-cpg-methylation`)
gives FokI `GGATG(9/13)` Dam not sensitive, Dcm and CpG "impaired by
overlapping", and the FokI R0109 product page
(`web.archive.org/web/20260116204035/https://www.neb.com/en-us/products/r0109-foki`)
says "dcm methylation: Impaired by Overlapping" and "Impaired by
overlapping dcm methylation and by overlapping CpG methylation". NEB names
no configuration, but only one exists: a CCWGG can put its methyl group
inside `GGATG` only by ending in the site's first GG (`CCWGGATG`, or
`CATCCWGG` read from the other strand), which methylates the base opposite
that G, `[[], [0]]`, as for BsaI and BsmFI. FokI is in
`REBASE_CONFIGURATIONS` with that entry. REBASE's 50% M.HpaII row for the
same base agrees with "impaired"; it is NEB's word that it applies to Dcm.
The model does not tell impaired from blocked, so these sites are marked
like any other. pBR322's site at 133 (`CCTGGATG`) and lambda's at 30043
(J02459, `CCCAGGATG`; Biopython 1.85 finds that site and cuts after 30056,
lambda's only FokI site with a CCWGG in it, 150 in all) are now marked. Not read: NEB's FAQ
"Is FokI blocked by methylation?" (no archived copy); NEB's FokI datasheet
PDF (not tried, since the chart and product page agree).
