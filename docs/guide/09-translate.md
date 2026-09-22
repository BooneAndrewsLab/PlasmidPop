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
- features that wrap the origin of a circular sequence.

Stops are shown as `*`, codons with ambiguity codes as `X`.

Clicking an amino acid selects its codon — the three bases it is read from —
and dragging along the line extends the selection codon by codon, which is a
quick way to take a protein-aligned piece of a gene. Click the feature bar
below instead to select the whole feature.

A `/transl_table` naming a code NCBI does not use — 7 and 8 were withdrawn,
17 to 20 were never issued — falls back to the standard code.

Not yet supported: `/transl_except`.

## The Translate tab

The tab translates the current selection, or the whole sequence when nothing
is selected, in all six frames:

- **+1, +2, +3** read the forward strand from its first, second and third
  base.
- **−1, −2, −3** read the reverse complement, starting at the 3′ end of the
  selection.

Each frame shows its length in amino acids, the number of stop codons, and
the protein with every stop marked, so the open frame stands out. **Copy**
puts one frame on the clipboard. **Export FASTA** downloads all six as one
protein FASTA file, one record per frame, named after the document and the
range.

The Translate tab uses the standard genetic code.

## How to find the reading frame of a fragment

1. Select the fragment in either view (or press `Ctrl+F` and find it).
2. Open the **Translate** tab.
3. The frame with no stops, or the fewest, is the one to look at.
4. To annotate it, use the [ORFs](08-orfs.md) tab and **Add as CDS
   feature**, or select the exact range and **Add feature** with type `CDS`.
