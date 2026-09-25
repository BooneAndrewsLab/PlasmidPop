# Proteins

A protein opens as a document of its own, with one letter per residue, and
its features (domains, sites, mature peptides) drawn on it as they are on
DNA.

## Opening a protein

- **A protein FASTA file** (`.faa`, or any FASTA file). Each record says what
  it is by its letters: one with letters no base has (E, F, I, L, P, Q, …)
  opens as a protein. A record written only in nucleotide codes (A, C, G, T,
  U and the IUPAC ambiguity codes) is always DNA, even a short peptide that
  happens to be spelt that way, so a DNA file is never taken for a protein.
- **A GenPept file** (`.gp`, `.gpff`): an NCBI protein record, GenBank's
  format with `aa` in the LOCUS line. Its header, references and features
  are read as a GenBank file's are, with feature positions in residues.
- **File ▸ Open from NCBI…** with a protein accession (`NP_000509`,
  `AAA12345`): the GenPept record is fetched and opens as if you had
  downloaded it (see
  [Opening a record from NCBI](02-files.md#opening-a-record-from-ncbi)).
- **Translate ▸ Open as protein**, from a CDS feature or a frame of a DNA
  document (see below).
- **New**, and choose **Protein**, to type or paste one.

## What a protein has, and what it does not

The sequence view shows the residues with the ruler counting them, and the
toolbar says `147 aa, protein`. Features, Find, Style, Case, Undo, History,
Compare with… and share links all work as they do for DNA. Find looks for
residues as well as feature names: `X` in what you type matches any residue,
and `B`, `Z` and `J` either of the two they stand for.

Everything that reads DNA is gone rather than greyed out: the map and the
view switcher, the Complement, Translations and Cut sites toggles and their
keys, Reverse complement and Make circular, and the Enzymes, ORFs, Translate,
Primers, Cloning and Align tabs, and **Detect features**, whose parts are
DNA. A protein is not offered as a template,
insert or vector on the Bench. Typing takes residues only, and residues do
not paste into DNA, nor bases into a protein: translate DNA first.

A protein downloads as GenPept (`.gp`) from **File ▸ Download GenPept…**, and
as protein FASTA (`.faa`) from **Export sequence as FASTA**.

## The Protein tab

The **Protein** tab gives, for the whole protein or the residues selected:

- **Length** in residues.
- **Molecular weight**, from average residue masses plus one water.
- **Theoretical pI**, from the pK values of Bjellqvist et al., with the
  N-terminus's pK depending on the first residue, as ExPASy ProtParam
  computes it, and the **charge at pH 7**.
- **The extinction coefficient at 280 nm** in water (Pace et al., 1995):
  5500 per Trp and 1490 per Tyr, plus 125 per cystine when every pair of Cys
  forms one. Both values are given, with the absorbance of 1 g/L (Abs 0.1%)
  for each. A protein with no Trp, Tyr or Cys has none, and says so.
- **Composition**: how many of each residue, and what share.

These are computed as ExPASy ProtParam computes them, and agree with it. A
stop (`*`) is not counted as a residue. Ambiguous residues (B, Z, X) are
weighed by an average and given no charge, and the tab says the numbers are
then estimates.

## Open as protein

In a DNA document's **Translate** tab:

1. Under **CDS features**, click **Open as protein** beside a CDS. The protein
   opens in a new tab named after the CDS, on its Protein tab. It is the
   CDS's translation as drawn under it in the sequence view: its own genetic
   code (`/transl_table`), `/codon_start`, `/transl_except` (a
   selenocysteine shows as `U`), every piece of a `join`, and the reverse
   strand read from its reverse complement. The stop that ends it is left
   off; a stop inside it stays, as `*`, since it is what the bases say.
2. Or select a stretch of DNA and click **Open as protein** on one of the six
   frames. That frame's translation opens as it stands, stops and all, named
   after the document, the range and the frame, and read with the genetic
   code chosen in the tab.

The protein carries the DNA's organism, and a comment saying what it was
translated from. The DNA is not changed.
