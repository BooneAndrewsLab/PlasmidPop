# 57. Protein documents

Done, 2026-09-25 (#66; `core/sequence/alphabet.ts`, `core/document/tools.ts`,
`core/analysis/proteinProperties.ts`, `core/analysis/openAsProtein.ts`,
`ProteinPanel.tsx`). Asked for: open and view protein sequences as documents
of their own, as SnapGene and Benchling do; protein FASTA and GenPept in;
**Translate ▸ Open as protein** for a CDS or a selection; length, molecular
weight, pI and extinction coefficient.

## An alphabet on the document

`SeqDocument.alphabet` is `nucleotide` or `protein`. It is set when the
document is made and no edit changes it: there is no op for it, and
translating a CDS makes a new document rather than turning one over. That is
what keeps it cheap to carry.

- **History:** a delta never carries it, since it cannot change between two
  states. A stored whole state says `alphabet: 'protein'` and nothing for DNA,
  so every row from before proteins still reads, and a splice is checked
  against the alphabet of the state it applies to.
- **IndexedDB and share links** hold GenBank text, so GenPept's `aa` carries
  the alphabet for free. The stored row has an optional `alphabet` beside
  `topology` for the file list. No Dexie version is needed for an unindexed
  field.
- **Clipboard:** a fragment says `alphabet: 'protein'` (absent for bases, as
  every fragment was before). Pasting checks the alphabet before the letters,
  since `MKRS` is valid IUPAC DNA and would otherwise paste as bases.
- **The model refuses** what makes no sense for a protein: circular topology
  and reverse complement throw; ends and methylation are ignored. A protein's
  checksum is SEGUID's single-stranded `lsseguid` of its upper-cased residues.

The protein letters are the IUPAC one-letter codes: the twenty, `U`
(selenocysteine), `O` (pyrrolysine), `B`, `Z`, `J`, `X`, and `*` for a stop,
which a translated frame carries. In either case.

## Tools off in one place

`hasTool(doc, tool)` (`core/document/tools.ts`) lists what each alphabet has:
complement, translations, enzymes, ORFs, translate, primers, cloning, align,
detect features (item 59), reverse complement, circular (map, origin, topology), ends and methylation
for DNA; protein properties for a protein. Every control asks it: the
sidebar's tabs (`sidebarTabsFor`, which the rail, `Alt+[`/`Alt+]` and the
phone's detail tabs all use), the toolbar's view switcher and toggles, their
`Alt` keys (left to the browser), the edit bar, File's map export, the
sequence view's complement, translation and cut-site rows, the analysis
worker (not run), the bench's tube and templates (`cloningDocuments`), the
review map of a comparison. So a tool is switched off by editing one set, and
a control added later asks the same question.

`setSidebarTab` ignores a tab the document in front does not have, and a new
tab inheriting the last one's panel falls back to Protein or Features. A
CDS/translation check (item 1) is not run on a protein: a GenPept `CDS` is
the residues it came from, not codons.

Hidden, not greyed out: a protein never has these, so a disabled button would
only be noise.

## Follow-ups done in 1.8 (#95)

- **Features come with the protein.** `featuresOntoProtein` puts what was
  annotated inside the CDS onto the residues it codes for: a domain, a site,
  a signal or mature peptide, a `misc_feature` marking a motif. Each base of
  the CDS knows its codon (from `translateCds`, so a join, the reverse
  strand and `/codon_start` are already right), and a segment becomes the
  residues its bases fall in — a feature covering part of a codon covers
  that residue, since a domain boundary mid-codon means the residue. A
  feature running past the CDS keeps the piece inside and is marked partial
  there, and so is one covering the stop, which is not a residue. What is
  left out is a denylist of the types that are about the DNA (promoter,
  intron, primer_bind, the UTRs…), since an allowlist would drop an unusual
  but meaningful annotation. Positions are walked in reading order, which
  descends for a reverse-strand CDS, so partial-at-the-start means the
  protein's start.
- **Pasted residues open as a protein.** Bare text with no FASTA header was
  read as bases or refused; now it may be a protein. The catch the issue
  named is real — nearly every letter is an amino acid, so any English text
  is valid residues — so the text must also be _shaped_ like a sequence:
  blocks of at least ten letters, as a copied sequence comes, rather than
  the short words of prose. `guessAlphabet` then decides which it is, by the
  same rule a FASTA record is read by, so anything written wholly in IUPAC
  nucleotide codes is still bases.
- **Protein alignment** (#95, 1.8). Residues are not bases: a conservative
  substitution is not a mismatch, so `alignPairwise` takes an `alphabet`
  and scores a protein by **BLOSUM62** — the NCBI's own copy, fetched by
  `scripts/make-blosum.mjs` rather than typed (`DATA-LICENSES.md`) — with
  BLAST's gap costs for proteins (11 to open, 1 to extend) rather than
  EMBOSS's for DNA. `U` and `O`, which the matrix predates, score as the
  residues they stand in for (C and K); a letter that is no residue scores
  the matrix's worst. The match line follows BLAST: `|` the same residue,
  `:` a substitution the matrix scores positive, `.` one it does not.
  `alignEitherStrand` returns the forward alignment at once for a protein —
  there is no second strand, and reverse-complementing residues would be
  nonsense — and the panel asks for _residues_, reads pasted letters with
  the document's alphabet, and is a tab a protein has (`hasTool`).
- **`order(...)` kept** (#95, 1.10); see below.
- **SnapGene `.prot` files** (#95, 1.10) and **`.rna`** (#112); see below.

## Reading the alphabet from a file

**FASTA** (`guessAlphabet`): a record is a protein only when it has a letter
no nucleotide code has _and_ fewer than 90% of its letters are A, C, G, T, U
or N. The two conditions are for the two ways to get it wrong:

- text wholly in IUPAC nucleotide codes is DNA however many ambiguity codes
  it has, even a peptide spelt in them (`MKRSWAT`): misreading a DNA file is
  worse than asking a user to use New ▸ Protein for a strange peptide;
- mostly bases with a stray letter (`ACGT…X`) is damaged DNA, and the reader
  reports the letter as before rather than opening a protein.

A protein runs to about a quarter A/C/G/T/N, so 90% leaves a wide margin.
Bare pasted text stays DNA only: any English text would pass as residues.

**GenPept** is a GenBank record whose LOCUS counts `aa`. It has no molecule
type in the LOCUS line, so the first three capitals after the length are its
division. It is written back in NCBI's columns with `aa` and blank molecule
type, and Biopython 1.8x reads what we write as a protein with every feature
(checked by hand on NP_000509). Fixtures: NP_000509 (HBB) and NP_000198
(INS), with `.gp` so the DNA fixture loops do not pick them up. GenPept's
many `order(...)` `Site` locations are kept as `order(...)` (below).

## `order(...)`: a joining on the feature

GenPept lists a binding site's residues as `order(31,34..35,38,…)`: pieces
that belong together but are not one stretch of sequence, unlike `join(...)`,
whose pieces are spliced into one. Until #95 the parser flattened both into
segments and wrote everything back as `join`, with a warning, for DNA too.

- **The model:** `Feature.joining?: 'order'` (and the same field on
  `FeatureLocation`, which `parseLocation` returns and `formatLocation`
  takes). Absent is `join`, so every feature made before, every stored row
  and every fragment on a clipboard means what it did, and nothing that
  makes a one-piece feature has to say anything. A one-value field rather
  than `'join' | 'order'` so there is one way to spell the default:
  `createFeature` and the history codec drop anything but `'order'`.
- **Nothing computes with it.** Translation, the views, Find and the
  cloning code read segments in order whichever it is; an `order` CDS
  would be nonsense, and nobody writes one. It is carried, not consulted —
  which is why it is a field that every copy keeps rather than a qualifier.
- **Every copy keeps it.** Edits move a feature with `{ ...feature,
segments }`, so shifts, deletions, the origin, reverse complement and a
  paste keep it unasked; the places that build a feature field by field were
  found by making the field required for a moment and reading the compiler's
  errors: the GenBank parser, the history codec's `copyFeature` and its
  equality, the stored-row check (`isStoredFeature`, which refuses any
  other value), the clipboard fragment reader, and `featuresOntoProtein`
  (an `order` of sites on a CDS is an `order` of residues). Compare and What
  changed treat a change of joining as a change of the feature ("now
  order(…)"). The Feature editor shows and takes `order(...)` in its
  location field, so typing `join` for `order` changes it. Share links,
  stored documents and Made from carry GenBank text, so they needed nothing.
- **Tests:** the edit arbitraries now lay a quarter of their features as
  `order`, and the editing, history and GenBank property tests check it
  survives every op; GenBank's round trip writes it back only where the
  location is a list, a single piece being bare either way.
- **What is still lost:** one operator nested inside the other
  (`order(join(1..3,5..7),9..10)`), since a feature has one operator for
  all its segments. The outer one wins and the parser says so. An
  origin-spanning piece of an `order` is written as its two halves in the
  list (`order(5..8,95..100,1..3)`), which `parseLocation` merges back, the
  same as it does for a `join`; nesting a `join` would be stricter, but not
  every reader takes nested operators.

A protein downloads as `.gp` and `.faa`.

**SnapGene `.prot`** (#95) is the `.dna` container with a protein in it,
worked out from the only real files to hand — the two SnapGene 8.2 ships as
samples (`KPYK1_ECOLI.prot`, `THYX_MYCTU.prot`, 470 and 250 residues, from
UniProt P0AD61 and P9WG57) — and nothing assumed beyond them. Neither can
be committed; `parseSnapGeneProtein.test.ts` builds a file of the same
layout and reads the real two when SnapGene is installed.

- **The cookie says which.** Its first short after `SnapGene` is 1 in all
  203 bundled `.dna` files and 2 in both `.prot` files (an `.rna` has 7), so
  that, not the extension or which packets are there, decides. Biopython
  reads the short and ignores it, and has no reader for a protein at all, so
  it could not be the oracle here that it is for `.dna` (item 43).
- **Residues in packet 0x15**, in place of 0x00: a flags byte, 0 in both
  files and not read (the DNA's bits are topology and methylation, which a
  protein has neither of), then the residues in ASCII.
- **Everything else is a `.dna`'s:** features in 0x0A with 1-based inclusive
  `range`s counted in residues, notes in 0x06, properties in 0x08 (both
  stickinesses 0; not read for a protein), display settings in 0x0D
  (skipped). There are no primers. A feature's direction is dropped, since a
  protein has one strand, and the molecule type is blank, as GenPept's is.
- **Checked against SnapGene itself.** Every feature carries SnapGene's
  `/calculated_mol_wt` of the residues it covers ("26.4 kDa"); the local
  test computes the same weight ProtParam's way (above) over the range as
  read and requires it within 0.05 kDa, for every one-piece feature of both
  files. An off-by-one in the range or a wrong residue would show there.
  Multi-piece `Site`s are read as joined, the default: SnapGene keeps no
  operator, and the same sites in GenPept would be `order(...)`, but nothing
  in the file says so.
- **Found on the way:** SnapGene's notes hold line breaks (`&#10;`), which
  the GenBank writer wrote as they were, so a GenPept download lost every
  feature after the first such note. The writer now writes a break as the
  space a GenBank reader joins lines with.

**SnapGene `.rna`** (#112) is the same container again, from the two
SnapGene 8.2 samples (`ECO 16S rRNA.rna`, 1541 nt, J01859; `Homo sapiens
mitochondrial tRNA-Ala.rna`, 72 nt, LC530712), not committed. What the bytes
show:

- Cookie kind **7** (export 15, import 19, as in the others). The bases are in
  packet **0x20** (0x00 is absent), after a flags byte that is 0 in both files
  and is not read: the DNA's bits are topology and methylation, and nothing
  shows what an RNA's would be, so a document opens linear with the default
  methylation (a `.dna` bit 0 set would otherwise make a circle).
- **T, never U**: neither file has a `U` anywhere in its sequence. The 16S
  file's bases are lowercase, the tRNA's uppercase; both are read as written.
- Features (0x0A), notes (0x06), properties (0x08, stickiness 0 and
  Unmodified; not read for an RNA), an empty primers packet (0x05) and display
  settings (0x0D) are a `.dna`'s, ranges in bases. The history packets 0x07
  and 0x0B of the tRNA are carried as in a `.dna`. The source feature's
  `mol_type` is `rRNA` / `tRNA`; the notes' `SequenceClass` is `UNA`, as in
  every file. No packet says single- or double-stranded.
- **Representation.** There is no RNA alphabet: the model's nucleotide
  alphabet already takes `U` (IUPAC, complement `U` to `A`, restriction
  patterns map `U` to `T`), but SnapGene and GenBank both spell an RNA's bases
  with T, so the sequence stays as read and the **molecule type `RNA`** is
  what says it is RNA, the way a GenBank record's LOCUS does. It is a field
  of the metadata, already kept from GenBank, so a download writes `RNA`
  on the LOCUS line and a reopened file keeps it, and nothing in the editor
  changes behaviour (translation, digests and so on act on the bases as they
  do for DNA). Converting to U for display, or a real RNA alphabet, would be
  a larger change with no sample to say what it should do; not done.
  Decided 2026-10-02 to keep T for now; showing U is #113.
- **Checked against SnapGene itself.** Both files annotate single bases by
  what they are: a `modified_base` is named for the base it modifies (`m1a`,
  `m2g`, `cm`, `um`, `p` for pseudouridine), and each of the 16S file's 18
  `variation` features has a note beginning with the base found there ("g in
  major species; c in undetermined species"). The local test requires the
  base we read under every such feature to match (all 25 do, so the packet
  and the ranges are right to the base). A reader-independent oracle does not
  exist: Biopython's SnapGene parser needs packet 0x00.
- **The other two open points of #112 stay as documented.** The samples have
  no multi-segment `Site` and no `.prot`, so they shed no light on whether a
  split site is `order(...)` (still read as a join) or on the `.prot` flags
  byte (still 0 in both samples, not read). The `.rna` flags byte is likewise
  0 in both and not read.

## Properties: what ProtParam computes

ExPASy ProtParam is the tool a biologist checks against, so the numbers are
computed its way and tested against its output for six UniProt entries (HBB,
lysozyme, preproinsulin, GFP, polyubiquitin-B, BSA), to the second decimal.

- **Molecular weight:** average residue masses as ExPASy lists them, plus one
  water (18.01524). U and O from average element masses (ProtParam has
  neither); J as I/L, which weigh the same; B and Z the mean of their pair
  and X 110 Da, flagged so the tab calls the weight an estimate.
- **pI:** the **Bjellqvist** pK set (Bjellqvist et al. 1993, 1994) that
  ProtParam uses: K 10.0, R 12.0, H 5.98, D 4.05, E 4.45, C 9.0, Y 10.0,
  N-terminus 7.5 (7.59 A, 7.0 M, 6.93 S, 8.36 P, 6.82 T, 7.44 V, 7.7 E),
  C-terminus 3.55 after every residue. Bjellqvist gives 4.55 after D and
  4.75 after E, and 1.7 first used them, but ProtParam does not: MKWVDDE is
  4.03 there and was 4.32 here (found by mutation testing, item 50; peptides
  ending in D or E are now among the test's ProtParam values). Bisection on
  [0, 14] to 10⁻⁴. EMBOSS's
  set was the alternative; it gives different answers from ProtParam and
  would have been the one people saw disagree.
- **Extinction coefficient at 280 nm** (Pace et al. 1995): 5500 per Trp,
  1490 per Tyr, 125 per cystine (a pair of Cys), with cystines and reduced,
  and Abs 0.1% for each.

A stop is left out of everything.

## Open as protein

`proteinFromCds` reads the CDS with `translateCds`, the same function the
Translations row uses, so genetic code, `/codon_start`, `/transl_except`,
joins and the reverse strand agree with what is on screen. The terminal
stop is dropped and an internal one kept. The protein is named after the CDS
(its name, `/product`, `/gene`, `/locus_tag`), gets one `Protein` feature
over the chain with its `/product` as GenPept annotates one, the DNA's
organism and taxonomy, and a comment saying what it was translated from. The
DNA's accession and references stay with the DNA. A frame of the Translate
panel opens the same way, stops and all. The tab opens clean, like New: it
can be made again from the DNA.
