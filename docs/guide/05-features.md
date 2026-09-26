# Features

Features are the annotations on the sequence: genes, CDSs, promoters,
origins, primer binding sites and so on. They are read from and written to
GenBank feature tables, so anything another program annotated is here, and
anything you annotate travels with the file.

## The Features tab

Each row shows the feature's colour, its name (or type when it has no name),
its type and its location in GenBank notation: `complement(1234..1500)` for a
reverse-strand feature, `join(...)` for a feature in several pieces, and a
range like `4200..150` for one that wraps the origin of a circular sequence.

- **Click** a row to select the feature. Both views scroll to it and
  highlight its bases.
- The selected row gets **Rename**, **Edit** and **Remove** buttons.
  **Double-click** a row to rename it in place.
- A ⚠ after a CDS's name means its bases no longer give the protein its
  `/translation` states — usually because of an edit inside it. Select it
  to see what differs and to update or remove the stored translation (see
  [Checking a record against itself](09-translate.md#checking-a-record-against-itself)).

Features are coloured by type (CDS blue, gene green, promoter orange,
terminator red, origin purple, primer site pink, and so on) unless the file
carries its own colours from ApE or SnapGene, which are used instead.

The `source` feature that GenBank records use for organism metadata is
listed but not drawn on the views. On the map, features that share a name
share one label.

## Where a name comes from

GenBank has no one field for a feature's name, so it is taken from the
qualifiers, and which one wins depends on the type:

- Anything you named yourself wins: a `/label` is used before all others.
- A **gene** is named by its `/gene`.
- A **CDS** and the RNAs (`mRNA`, `tRNA`, `rRNA` and kin) are named by their
  `/product` first, then by their `/gene`. So NCBI's usual pair over the same
  range reads as two rows — `tet` for the gene and _tetracycline resistance
  protein_ for the CDS — rather than as `tet` twice.
- **Every other type** is named by `/product`, `/locus_tag` or
  `/standard_name`, and never by `/gene`. On a `misc_feature` or a
  `misc_binding`, `/gene` is a cross-reference to the gene the feature sits
  inside, not a name of its own; taking it as one would put a single gene's
  label on every feature within it.

A feature with none of those is listed and drawn under its type, which is
normal for the `misc_feature`s that fill most records. Rename it (or any
other) in the Features tab and the name is written back as a `/label`.

## Adding a feature

1. Select the bases to annotate in either view.
2. Click **Add feature** in the edit bar.
3. A `misc_feature` called _New feature_ appears in the list with its name
   ready to be typed over. Press `Enter` to confirm.
4. Click **Edit** to change the type, strand or anything else.

The ORFs and Primers tabs add features of their own: an ORF as a `CDS` with
its translation, primers as `primer_bind` sites.

## Detecting common features

A bare FASTA file, or a record someone annotated sparsely, opens with few
features or none. **Detect features**, at the top of the Features tab, looks
for the parts plasmids are made of and offers what it finds:

1. Click **Detect features**. The search runs in the background; a progress
   bar with **Cancel** shows while it does (a plasmid takes a moment, a
   megabase well under a second).
2. The hits are listed under the button, every one ticked, each with its
   type, its location, and how well it matched: _exact_, or the number of
   mismatches and the identity, such as _2 mismatches, 99.7%_. Hover over a
   row to see what the part is and the record it was matched against; click
   it to select those bases in the views.
3. Untick any you do not want (or **Untick all** and tick a few), then click
   **Add N features**. They are added as one edit, so a single **Undo** takes
   them all away again. **Dismiss** puts the list away without adding
   anything.

What is found:

- **Both strands**, and **through the origin** of a circular sequence.
- **Near matches**: by default a part is found when at least 95% of its
  bases match. **Match at least** in the list changes that to 98%, 90% or
  exactly, and searches again. Mismatches are substitutions only: a copy of a
  part with bases inserted or deleted is not found. Parts shorter than 24
  bases (primer sites, short tags) are only found exactly, so that they do
  not turn up by chance.
- **By what it codes for**, as well as by its bases. Every vector spells a
  short tag — FLAG, Myc, the T7 tag, the SV40 nuclear localisation signal —
  in its own codons, and a fluorescent protein carried from one construct to
  the next picks up silent changes; neither is found by matching DNA. Those
  parts are looked for in all six translations instead, and a hit says so:
  _exact protein match_, or _2 residues differ, 99% of the protein_. This is
  how the fluorescent proteins whose DNA is not in a public record (EYFP,
  ECFP, mTurquoise2, mScarlet, Superfolder GFP, mKate2, TagBFP, Clover,
  mRuby2 and mRuby3 among them) are found at all. A short peptide must match
  exactly, for the same reason a short stretch of DNA must.
- **Ambiguity codes** in your sequence (`N`, `R`, `Y`, …) count against a
  match like a mismatch, but are reported separately, as _1 ambiguous base_,
  when the code allows the part's base.
- A hit the document **already has** — a feature on the same strand, of the
  same type or name, over nearly the same bases — is not offered again; the
  list says how many there were.
- Where two parts of one type cover the same bases, only the better match is
  offered: the pBR322 origin rather than the pUC origin that differs from it
  by one base, `lacZ` rather than the `lacZα` inside it. Parts of different
  types are offered together, so a primer site inside a promoter is two
  features.

A feature added this way is named after the part and carries two notes: what
the part is, and _Detected by PlasmidPop_ with how well it matched and the
record it was matched against, so an annotation the app made can always be
told from one the file came with.

**Detect in every file opened without features**, a tick box under the list,
runs the search by itself whenever a file you open has no features (a
`source` feature does not count), and brings the Features tab forward when
it finds something. Nothing is added until you click **Add**. It is off
until you turn it on, and remembered in this browser.

### Where the parts come from

The bundled list holds over two hundred parts: origins of replication,
resistance and auxotrophic markers, promoters, terminators, tags and fusion
partners, operators and recombination sites, reporters, and the usual
sequencing-primer sites, plus common fluorescent proteins. Every one is read
from a public NCBI record whose accession and location are cited with it; the
fluorescent proteins are chosen from [FPbase](https://www.fpbase.org), whose
data is shared under CC BY-SA 4.0, and their DNA is the coding sequence of
the NCBI record FPbase names. The list is matched as DNA, so a fluorescent
protein or tag written with other codons is not found, and some short tags
(the His tag, HA, V5) are not in the list yet.

## Editing a feature

**Edit** opens the full editor under the row:

- **Name** and **Type**. The type field suggests common GenBank keys (CDS,
  gene, promoter, terminator, rep_origin, primer_bind, misc_feature, …) but
  accepts anything.
- **Strand**: forward or reverse. Reverse-strand features are drawn with an
  arrow pointing left and are translated from the reverse complement.
- **Thickness**: how thick the feature's bar is drawn in the sequence view
  and on the map, _Thin_, _Medium_ or _Full_. **As its type** is thin for
  an intron, so a gene's exons stand out from the gaps between them, and
  full for everything else. The lane keeps its height whatever the bar's,
  and only a full bar has room for its name inside it (the map's labels are
  unaffected). The choice is saved with the feature as a
  `/PlasmidPop_thickness` qualifier, which other programs ignore.
- **Location**, 1-based inclusive, in GenBank syntax without the
  `complement(...)` wrapper (use the strand selector for that):
  `100..450` for a range, `join(100..200,300..450)` for several pieces,
  `4000..120` to wrap the origin of a circular sequence, `<100..450` or
  `100..>450` for partial ends. Invalid input is explained under the field
  and disables saving.
- **Qualifiers**: the `/name="value"` pairs of the GenBank table, such as
  `gene`, `product`, `note`, `codon_start`, `transl_table` or
  `translation`. Add, edit or remove rows; a qualifier with no value is
  written as a flag (`/pseudo`).

**Save changes** applies everything as one undo step. **Remove feature**
deletes it.

## Features and edits

Insertions and deletions move and resize features automatically, on both
strands and across the origin. Copying a selection carries its features
along, and pasting adds them at the destination; see
[Editing](04-editing.md).
