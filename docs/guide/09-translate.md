# Translation

PlasmidPop translates DNA in two places: under CDS features in the sequence
view, and for any selection in the **Translate** tab.

## Amino acids under CDS features

With **Translations** on in the toolbar, every `CDS` feature gets a line of
one-letter amino acids between the strands and the feature bars. Each
residue sits under its codon, and codons are shaded alternately so the
frame is easy to follow. The translation honours:

- `/codon_start` (1, 2 or 3) for features that begin mid-codon;
- `/transl_table`: every genetic code NCBI numbers (1–6, 9–16 and 21–33), not
  only the standard and bacterial ones. The code decides the amino acids as
  well as the start codons — TGA is a stop under the standard code and
  tryptophan under the vertebrate mitochondrial one — so a gene read with the
  wrong code comes out chopped short;
- `join(...)` locations: the pieces are spliced before translating;
- reverse-strand features, translated from the reverse complement and drawn
  right to left;
- partial ends (`<` and `>`), which suppress the start-codon `M`;
- `/transl_except`, which reads one codon as a residue the genetic code
  would not give it: `(pos:220..222,aa:Sec)` makes that UGA selenocysteine,
  `U`, instead of a stop. Pyrrolysine shows as `O`;
- features that wrap the origin of a circular sequence.

Stops are shown as `*`, codons with ambiguity codes as `X`.

A `/transl_except` names its codon by position in the sequence, so it moves
with its feature: insert bases upstream, reverse-complement the molecule, set
a new origin or copy the gene into another tab, and it still names the same
codon. An edit to that codon's own bases removes it. The same goes for
`/anticodon` on a tRNA.

Clicking an amino acid selects its codon — the three bases it is read from —
and dragging along the line extends the selection codon by codon, which is a
quick way to take a protein-aligned piece of a gene. `Ctrl+Shift+←` and
`Ctrl+Shift+→` do the same from the keyboard: the first press takes the codon
the cursor is in, each one after that adds the next. Click the feature bar
below instead to select the whole feature.

A `/transl_table` naming a code NCBI does not use — 7 and 8 were withdrawn,
17 to 20 were never issued — falls back to the standard code, and a warning
in the status bar says which feature asked for what. So does a
`/transl_except` that names no codon of its feature, such as one out of
frame; that codon is read with the genetic code.

## Checking a record against itself

Most records state the protein they expect: a CDS carries a `/translation`
qualifier its author wrote out. When a file is opened, every CDS that has
one is translated from its own bases and compared with it, and a
disagreement is reported in the status bar with the feature, where it is,
and the first residue that differs:

```
CDS rpoB at complement(4,181,245..4,185,273) — the file's /translation
differs from the sequence at residue 12: the file says Q, the sequence gives E.
```

This is worth knowing before trusting either one. It usually means the file
and its own annotation have drifted apart — a sequence edited without the
translation being redone — but it can equally mean the feature needs a
genetic code or a `/codon_start` it does not have. Only the first eight are
listed; the rest are counted.

An `X` on either side is not counted as a disagreement: it is a residue
nobody is claiming to know. A `U` or `O` in the file is counted unless a
`/transl_except` puts it there.

The check also follows your edits. As soon as an edit makes a CDS disagree
with its `/translation` — a base changed inside it, say — its row in the
**Features** list gets a ⚠, and hovering it says how. Select the feature and
the same explanation appears under it, with two ways out:

- **Update /translation** rewrites the stored protein from the bases as
  they are now;
- **Remove /translation** drops it; the protein is still shown under the
  feature, translated from the bases.

Either is one step in the History, so `Ctrl+Z` undoes it. A record that
disagreed with itself when it was opened carries the ⚠ from the start.

## The Translate tab

The tab translates the current selection, or the whole sequence when nothing
is selected, in all six frames:

- **+1, +2, +3** read the forward strand from its first, second and third
  base.
- **−1, −2, −3** read the reverse complement, starting at the 3′ end of the
  selection.

Each frame shows its length in amino acids, the number of stop codons, and
the protein with every stop marked, so the open frame stands out. **Copy**
puts one frame on the clipboard, and **Open as protein** opens it as a protein
document of its own, stops and all. **Export FASTA** downloads all six as one
protein FASTA file, one record per frame, named after the document and the
range.

Above the frames, **CDS features** lists the coding features of the
selection (or of the whole sequence), each with **Open as protein**: the
protein it codes for opens in a tab of its own, named after the CDS. It is
read exactly as the line under the CDS is — its own genetic code,
`/codon_start`, `/transl_except`, every piece of a join, the reverse strand —
and the stop that ends it is left off. See [Proteins](16-proteins.md).

**Code** chooses the genetic code the six frames are read with — any of the
27 NCBI numbers, the standard code by default. A frame full of stops under
the standard code often has none under the right mitochondrial one, which is
the quickest way to tell what you are looking at. The choice is remembered
and is shared with the [ORFs](08-orfs.md) tab, because both are reading
bases that carry no `/transl_table` of their own; CDS features are read with
theirs whatever is chosen here.

**Export FASTA** names the code in each description line when it is not the
standard one.

## How to find the reading frame of a fragment

1. Select the fragment in either view (or press `Ctrl+F` and find it).
2. Open the **Translate** tab.
3. The frame with no stops, or the fewest, is the one to look at.
4. To annotate it, use the [ORFs](08-orfs.md) tab and **Add as CDS
   feature**, or select the exact range and **Add feature** with type `CDS`.
