# 149. Protein FASTA export (#451, #452)

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
- **Long joins are summarised (#454).** A CDS of up to three segments keeps
  its literal location; a longer join (human ACACA has about 57 exons) is
  written as `CDS 1538..320521 (57 exons, join)`, so the name line stays
  short. The span is the first segment's start to the last segment's end in
  the feature's stored order, 1-based inclusive, wrapped in `complement(...)`
  on the reverse strand, with `<`/`>` kept from those two ends; `order(...)`
  says `order` for `join`. On a circular sequence whose CDS wraps the origin
  the ends are taken modulo the length, so the span can read start > end
  (`41..3`), meaning across the origin. `headerLocation` in
  `proteinExport.ts`; ORF and selection records are single ranges and
  unchanged.
- **Entry points.** File ▸ **Download protein FASTA…** (every CDS in one
  `<doc>_proteins.faa`; disabled with a tip for a protein document or one
  with no CDS; the CDS list is computed only while the menu is open);
  **Download protein** under a selected CDS in the Features tab (also in the
  read-only view, since it changes nothing); **Download FASTA** beside
  **Copy protein** in the ORFs tab, for the selected ORF or the selection.
- All downloads go through `downloadText`, never a file handle (item 24).
- **Events** (item 38): `file / export` named `protein-fasta`,
  `cds-protein-fasta`, `orf-protein-fasta`. No names, sequences or counts.

## A gene or an mRNA (#452)

A selected `gene` or `mRNA` in the Features tab offers the same **Download
protein**, resolved to the CDS inside it. Its own span is never translated:
it holds the introns and the UTRs (ACT1 is `<1..>1437` as a gene,
`join(1..10,320..1437)` as a CDS), so reading it through gives a wrong
protein that looks right for the first few residues.

- **The lookup is `codingFeaturesOf`** (`src/core/analysis/geneCds.ts`): CDS
  features on the same strand, every range segment inside the gene's span.
  Segments are measured as offsets from the gene's first base, modulo the
  length on a circle, so a gene over the origin works whether it is one
  wrapping range or a `join` split there; a linear sequence never wraps.
- **Qualifiers decide between candidates.** `/locus_tag` when both features
  carry one, else `/gene`: if any CDS names the same gene only those count,
  and a CDS naming another gene (one nested in an intron) never counts. A
  CDS with neither qualifier counts only when none matches, which is the
  whole rule for files without qualifiers (SnapGene).
- **An mRNA prefers the CDS spliced as it is**: each CDS exon lies in an
  exon of the mRNA and the CDS's introns equal the mRNA's introns within the
  CDS's extent. Without this every isoform's CDS
  would lie inside every mRNA of the gene. If none fits, all candidates stay.
- **One CDS, one record; several, one multi-record file**, through the same
  `cdsProteinFasta`, so the records are the CDS's own (ids `_2`, `_3` when
  isoforms share a name). The file is named for the gene (`<doc>_<gene>.faa`,
  `<doc>_<gene>_proteins.faa`), since that is what was selected. A CDS that
  translates to nothing is not counted (`geneCds` in `proteinExport.ts`).
- **The button** is the CDS's own row, in the same place above
  Rename/Edit/Remove, so it is in the read-only view too. With several CDS
  it reads **Download protein (2 CDS)**; with none there is no button rather
  than a disabled one, since a gene with no CDS (a tRNA or rRNA gene) is
  ordinary and has nothing to explain.
- **Event**: `file / export` named `gene-protein-fasta`, for gene and mRNA
  alike; no names, sequences or counts.

## Not done

The selection in a frame other than +1: the Translate tab's six-frame
export already covers it.
