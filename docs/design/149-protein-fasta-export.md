# 149. Protein FASTA export (#451)

## What was asked

A way to download the protein of an annotated CDS, an ORF or a selection as
a file. Until now the proteins could be copied (ORFs tab) or exported as six
frames (Translate tab), and the File menu wrote only the nucleotide
document.

## What was built

`src/app/proteinExport.ts` holds every writer; the UI only calls it.

- **Translation is `translateCds`, not a new one.** A CDS is read with its
  own `/transl_table`, `/codon_start`, `/transl_except`, `join(...)`, reverse
  strand (reverse-complemented first) and origin wrap, exactly as the
  sequence view and the `/translation` check read it. An ORF or a selection
  is translated by the ORFs tab with the app's genetic code and handed to
  `rangeProteinFasta`.
- **No terminal stop.** A trailing `*` is dropped, as `/translation` and
  UniProt-style FASTA do; internal stops stay. A CDS that translates to
  nothing is left out.
- **Header** (`formatFastaRecord`): `id description`. The id is
  `<doc>_<label>` (`_2`, `_3` for repeated names; `<doc>_ORF_<from>-<to>`,
  `_rev` on the reverse strand). The description names the document, the
  label, the location in GenBank syntax (`join(...)`, `complement(...)`,
  1-based inclusive), the residue count, and the genetic code only when it is
  not the standard one (the six-frame convention).
- **Entry points.** File ▸ **Download protein FASTA…** (every CDS in one
  `<doc>_proteins.faa`; disabled with a tip for a protein document or one
  with no CDS; the CDS list is computed only while the menu is open);
  **Download protein** under a selected CDS in the Features tab (also in the
  read-only view, since it changes nothing); **Download FASTA** beside
  **Copy protein** in the ORFs tab, for the selected ORF or the selection.
- All downloads go through `downloadText`, never a file handle (item 24).
- **Events** (item 38): `file / export` named `protein-fasta`,
  `cds-protein-fasta`, `orf-protein-fasta`. No names, sequences or counts.

## Not done

The selection in a frame other than +1: the Translate tab's six-frame
export already covers it.
