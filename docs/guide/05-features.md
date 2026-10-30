# Features

Features are the annotations on the sequence: genes, CDSs, promoters,
origins, primer binding sites and so on. They are read from and written to
GenBank feature tables, so anything another program annotated is here, and
anything you annotate travels with the file.

## The Features tab

Each row shows the feature's colour, its name (or type when it has no name),
its type and its location in GenBank notation: `complement(1234..1500)` for a
reverse-strand feature, `join(...)` for a feature in several pieces (the
sequence view marks the gaps between them; see
[Features in pieces](03-viewing.md#features-in-pieces)),
`order(...)` for pieces listed but not joined (a binding site's residues, as
GenPept has them), and a range like `4200..150` for one that wraps the origin
of a circular sequence.

- **Click** a row to select the feature. Both views scroll to it and
  highlight its bases.
- The selected row gets **Rename**, **Edit** and **Remove** buttons, and
  **Remove all N _type_** (`Remove all 14 mRNA`) when the document has more
  than one feature of that type: it removes every one of them, those of a
  type hidden in the views included. One **Undo** puts them all back in
  their places (see [Removing features in bulk](#removing-features-in-bulk)).
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

### Hiding a type of feature

An NCBI record carries an mRNA, a CDS and often a run of exons for each gene,
and the map draws them all. **Format ▸ Feature types** (see
[Format](03-viewing.md#format)) has a tick for each type the document has;
unticking one leaves it out of the circular map, the sequence view and the
map strip, with its labels and translation line. Only the display changes: the
features stay in this list (and a banner here says "N types hidden", with a
**Show all** link), they are still written to GenBank and SnapGene files, and
editing is unaffected. Selecting a hidden feature in this list still
selects its bases, but it cannot be clicked on the map or the sequence while
its type is hidden.

The ticks belong to the document, are not an edit (nothing to undo, nothing
unsaved), and the last choice is where each new document starts. **File ▸
Export figure** starts its own Features ticks from them, and the sequence
figure leaves hidden types out.

### Grouped features

A gene record from NCBI repeats itself: one CDS per transcript variant,
each differing only in its `/protein_id`, and after each one the same
signal peptide and mature peptides again. Drawn one each they stack into
twenty lanes of the same few bars. The views draw them grouped instead:

- Features of the **same type, strand and location** are one bar with a
  count: `sig_peptide ×4`, `insulin preproprotein ×4`. Their qualifiers may
  differ; hovering the bar lists each feature with the qualifiers that
  tell it from the others.
- A gene's **mRNA variants** (by `/gene`) are one row showing the union
  of their exons, labelled `INS · 4 transcripts`; once you select it an arrow `▸`
  shows that clicking again opens it. A gene with a single transcript
  keeps its own row.

Clicking a grouped bar selects the first of its features. Its row in this
list is highlighted with the usual **Rename**, **Edit** and **Remove**, and
a note under it says what the views draw it with and lists the others;
click one to select that feature instead and act on it. Clicking a
transcripts row that is already selected opens it (`▾`): a row per
transcript stacks above it, each clickable on its own; clicking the open
row closes it again. Open rows are remembered for the document while it is
open, and figures exported from it draw them open too.

Only the drawing is grouped. This list, the editor, undo, the GenBank and
SnapGene files and the clipboard all have every feature; hidden types (above)
are left out first, so a hidden feature is never counted in a bar.

### Showing one transcript

To read a gene record as a single variant without touching it, pick the
transcript: **Format ▸ Transcripts** has a row for each gene with two or
more mRNAs, with a select of **All** and each transcript's accession
(`NM_000207.3`; hover an entry for its name). Under a selected transcript in
this list, the group note has **Show only this transcript**, which does the
same. The views and this list then show that mRNA, and leave out:

- the gene's other mRNAs;
- a CDS of the gene that another transcript can carry and this one cannot —
  one that uses an exon this transcript skips, or reads through an intron it
  splices;
- a signal, transit or mature peptide, propeptide or proprotein that no
  CDS still shown can carry.

Nothing is removed: a banner here says which genes are narrowed, with a
**Show all** link, the Format button says "N picked", and under the shown
transcript **Show all 4 INS transcripts** brings the gene's back; **Show all
transcripts** in the menu clears every gene. The picks belong to the
document, are not an edit (nothing to undo, nothing unsaved), are never
written to a file, and the last ones are where the next document starts — a
gene or an accession the document lacks is ignored. Exported figures draw
what the screen draws. To keep the pick for good, use **Remove the other
transcripts** under the shown transcript
(see [Removing features in bulk](#removing-features-in-bulk)).

What stays is whatever the record cannot tell apart. Nothing in an NCBI
record says which CDS belongs to which mRNA, so the pick keeps every CDS the
chosen transcript _could_ carry; on the INS record its four CDSs, which
encode the same protein from four different 5′ ends, all stay, as the one
`×4` bar they already were, with their peptides. A CDS or peptide the
record gives no way to place — one with no `/gene`, one that fits none of
the gene's transcripts, a peptide inside no CDS — is never hidden by a pick.

### Removing features in bulk

Hiding and grouping leave the document as NCBI sent it. To make it hold one
transcript variant, or no exons at all, remove the others; this is an edit,
so the file you save no longer matches the NCBI record, and **Undo** takes
it back in one step.

- **Remove all N _type_**, under the selected feature, removes every
  feature of its type. While a transcript is picked, Remove all counts only
  what the list shows: the gene's other transcripts, left out of the list,
  are neither counted nor removed.
- Under a member of a grouped bar or row, the note listing the group has
  **Remove the other transcripts** (for a gene's mRNA variants: keeps the
  selected one, removes the gene's other mRNAs and what only they can
  carry, below) or **Remove the other copies** (for features on the same
  bases: keeps the selected one).
- Under a transcript shown alone (above), the note that says what the pick
  leaves out has **Remove the other transcripts** too, so a pick can be made
  permanent in one step.

The buttons that remove are in red, apart from **Show only this
transcript**, which changes only what the views draw.

Removing the other transcripts removes exactly what picking the transcript
would leave out of the views: the gene's other mRNAs, the CDSs the kept mRNA
cannot carry, and the signal, transit or mature peptides, propeptides and
proprotein that no remaining CDS can carry. What stays is what stays under a
pick: nothing in an NCBI record says which CDS belongs to which mRNA, so a
CDS the kept transcript could carry stays (the four INS CDSs, all of them),
as does anything the record gives no way to place — a CDS or peptide with no
`/gene`, one that fits none of the gene's transcripts. The History tab and
the Undo button's tip name what went, and it is one step:
`Remove 3 other INS transcripts, 2 CDSs and 5 peptides`. The **Remove the
other copies** button removes only the copies. While a transcript is picked
its gene's others are not listed here, so the removal is offered under the
picked transcript.

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
2. Click **Add feature** in the edit bar, or in the bar that floats beside
   the selection.
3. The Features tab opens on a new `misc_feature` called _New feature_, with
   its full editor (see [Editing a feature](#editing-a-feature)) open under
   it and scrolled into view. The name is ready to be typed over.
4. Set what you need and press `Enter` (or **Save changes**). **Cancel**,
   `Escape` or **Remove feature** takes the new feature away again as if it
   had never been added, with no undo step left behind.

The new feature is the selected one, even when the bases were selected by
clicking a feature that already covers them.

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
   mismatches and the identity, such as _2 mismatches, 99.7%_, with bases
   inserted or deleted named first, such as _1 base deleted, 99.8%_. Hover over a
   row to see what the part is and the record it was matched against; click
   it to select those bases in the views.
3. Untick any you do not want (or **Untick all** and tick a few), then click
   **Add N features**. They are added as one edit, so a single **Undo** takes
   them all away again. **Dismiss** puts the list away without adding
   anything.

What is found:

- **Common RNAs**: the Cas9 gRNA scaffold, the E. coli 5S rRNA and a
  few tRNAs (the glycine tRNA of tRNA-gRNA arrays, E. coli tRNA-Glu), offered
  as `misc_RNA`, `rRNA` and `tRNA` features. The structured-RNA families a
  covariance model would find are not searched for.
- **Plant, yeast and viral-vector parts**: the T-DNA border repeats, the
  NOS and CaMV 35S promoters and terminators, the pVS1, CloDF13 and
  pBR322 _bom_ elements of binary vectors, the Tn7 ends, the AOX1 promoter
  and terminator of _Pichia_, the EM7 and hSyn promoters, the AAV2 inverted
  terminal repeat, the HIV-1 RRE, the pCI chimeric intron and the hGH
  poly(A). Where a vector carries a shortened or altered version of one of
  these, it is offered only if enough of it is left to match. The CaMV
  poly(A) signal is offered on the strand of the gene it ends (in pCAMBIA
  vectors, the hygromycin gene), the strand its AATAAA reads on.
- **The pieces of a CAG promoter** are offered one by one: the CMV
  enhancer, the _chicken beta-actin promoter (CAG)_ and the CAG intron. A
  CMV promoter is offered with its enhancer, as _CMV enhancer and
  promoter_.
- **Both strands**, and **through the origin** of a circular sequence.
- **A part cut off by the end**: in a linear sequence — a fragment, a
  sequencing read — a part may run past either end, and what is there is
  offered for it, listed as _exact as far as it goes, cut off at the end_.
  The feature is marked partial at that end, which is what GenBank's `<`
  and `>` mean, so it stays partial when you save. At least 30 bases and a
  fifth of the part must be there, so that a sliver is not annotated as a
  gene.
- **Near matches**: by default a part is found when at least 95% of its
  bases match. **Match at least** in the list changes that to 98%, 90% or
  exactly, and searches again. Parts shorter than 24 bases (primer sites,
  short tags) are only found exactly, so that they do not turn up by chance.
- **Variants that must match in full**: a few parts differ from the usual
  sequence by a base or two, and a near match would report both. _lacUV5_ is
  one: the wild-type lac promoter differs from it by two bases in the -10
  box, so it is only found where every base matches, whatever **Match at
  least** says. An ambiguity code where it has a base, a missing base or a
  cut-off end rules it out.
- **A variant's name only where the bases carry the variant.** Several
  parts are named for one variant of an element: _trc_ beside tac, the
  kanamycin gene of _kanMX_ beside the transposon's, _luc+_ beside luc2,
  _avGFP_ beside the GFP mutants, _DsRed-Express2_ beside the other DsReds,
  _TetR (Tn10)_ beside the repressor inside an rtTA. The two differ by
  little enough that a match finds either, so such a name is only used
  where what was matched shows what the name claims — the residues the
  variant alone has, the one base of a promoter's spacer, or a match on the
  bases where the variant is in the codons alone. Where it does not, the
  call is named for the element itself (_GFP_, _DsRed_, _TetR_, _firefly
  luciferase_), and the note says so; where another part of the list is the
  right answer there instead, it is left to it.
- **f1 and M13 origins** are one part, _f1/M13 ori_. The two phages differ
  at two bases over the origin, records in GenBank name the same bases
  either way, and a vector's copy is usually a base or two from both, so
  one label covers them and a locus gets one call rather than two.
- **lacI and lacIq promoters**: the 78 bp upstream of lacI is offered as
  _lacI promoter_, or as _lacIq promoter_ where it carries the one base
  (a T in its -35 box) that makes lacIq. Where that base is anything else,
  unread or cut off, it is the wild-type _lacI promoter_. The last 35 bp,
  next to the start codon, are offered as _lacI promoter (3' end)_ where
  the whole region is not found.
- **Bases inserted or deleted**: a copy of a part with a small indel — a
  frameshift, a filled-in site — is found too, up to 8 bases inserted or
  deleted in all. Each one counts against **Match at least** as a mismatch
  does, and the list says what was found, as _3 bases inserted, 1 mismatch,
  98.7%_, so it is never mistaken for a copy with substitutions only. Where
  substitutions alone explain a copy well enough, that is how it is shown:
  an indel in the last few bases of a part reads as a mismatch or two
  there. Parts shorter than 36 bases are not looked for with indels.
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
  Every coding part in the list is looked for this way too, from its own
  bases: a resistance marker recoded for another host (a Kan, Hyg or Bsd gene
  in a different vector family's codons) is still found, as the part.
- **Similar proteins**, a step further. A part's protein is also searched for
  with substitutions and gaps, so a diverged relative of a part, such as
  another aminoglycoside phosphotransferase or a β-lactamase variant, is
  offered as _similar protein: 87% identical over 96% of the part's protein_.
  It is never named as the part: the feature is called **similar to KanR**, so
  a homologue is not taken for the exact part. How diverged a relative may be
  depends on the part (a short protein or a fluorescent protein must be
  closer than an enzyme), and where the part itself was found over the same
  bases nothing "similar" is offered. Your own coding **My parts** are
  searched this way too.
- **Only in a frame that can be read.** Six translations read things nobody
  translates: a glycine linker (`GGT GGT GGT …`) in a fusion reads, on the
  other strand, as a run of histidines. So a part found by what it codes for
  is not offered where its own frame has no ATG before it (back to the stop
  before it) and is open for fewer than 75 codons (the [ORFs](08-orfs.md)
  tab's default shortest ORF), while an ORF of at least that length runs
  across it on the other strand.
  Nor is it offered where it lies inside a CDS the document has on the other
  strand, unless a CDS on its own strand covers it too. A tag with a start
  codon before it is offered whatever the other strand holds, and so is a
  tag with no ORF on either side.
- **Ambiguity codes** in your sequence (`N`, `R`, `Y`, …) count against a
  match like a mismatch, but are reported separately, as _1 ambiguous base_,
  when the code allows the part's base.
- A hit the document **already has** — a feature on the same strand, of the
  same type or name, over nearly the same bases — is not offered again; the
  list says how many there were.
- Where two parts of one type cover the same bases, only the better match is
  offered: the pBR322 origin rather than the pUC origin that differs from it
  by one base, a _3xFLAG_ rather than the _FLAG_ inside it. Parts of different
  types are offered together, so a primer site inside a promoter is two
  features, and so are parts on opposite strands (but see the SV40 poly(A)
  region below). A part
  made of other parts is offered with them: the _T7lac promoter_ comes with
  the _T7 promoter_ and the _lac operator_ it is made of.
- **The SV40 poly(A) region reads both ways.** The SV40 early and late
  poly(A) signals are the same stretch of DNA on opposite strands, and a
  vector uses the one its gene runs into. Where both are found, each is
  offered only if a gene on its strand — one found, or a CDS the document
  has — ends no more than 500 bases before it: _SV40 late poly(A) signal_
  after a luciferase, _SV40 poly(A) signal_ (the early one) after EGFP.
  Where no gene runs into either, the early _SV40 poly(A) signal_ is
  offered alone, as the usual name for the region; where genes run into
  both, both are offered. A gene ends where its frame stops, so a part that
  is only the start of one (a tag before an insert) counts from the
  insert's stop codon. Annotate the gene and the list follows, without
  searching again. A gene of no part of ours that you have not annotated
  cannot count, and neither can one whose stop is further than 500 bases
  away (a long 3′ untranslated region): the region is then labelled early.
- Two variants of one protein that differ in length by only a few bases (EGFP
  and ECFP) are one locus: the one that matches better is offered, even if
  it is the slightly shorter.
- **Touching copies of one tag are one feature.** A tandem epitope tag is
  the same short peptide two or three times over, end to end, so three
  `DYKDDDDK` in a row are offered as one **3xFLAG** rather than as three
  FLAGs. The count is of the epitope: two touching _6xHis_ are **12xHis**.
  Copies with any bases between them stay separate features — a tandem Myc
  whose repeats are nine bases apart is that many labels — and so do copies
  on opposite strands. The 3xFLAG whose first two units are the
  variants `DYKDHDG` and `DYKDHDI` is a part of its own, found whole.
- A part that is a **segment of a gene** or of a longer element is not
  offered where that gene is found around it on the same strand: the _AmpR
  signal peptide_ is the start of _AmpR_, and the map shows one AmpR rather
  than AmpR with its first 69 bases labelled again. The same holds for
  _HIV-1 LTR (R-U5)_, the end of an _HIV-1 LTR_ (all a lentiviral vector
  keeps where a heterologous promoter replaces U3), the _lacI promoter
  (3' end)_ inside a lacI or lacIq promoter, the _chicken beta-actin
  promoter (CAG)_ inside the whole _chicken beta-actin promoter_, and the
  _SV40 NLS_ inside _SV40 large T antigen_. It holds even where the segment
  matches exactly and the gene around it has a mismatch somewhere else.
  Where the gene is not there — a signal peptide or an NLS fused to
  something else — the segment is offered as itself. A segment hidden this
  way is not listed at all; the gene's feature covers its bases.

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

The bundled list holds about three hundred parts, 203 curated ones and
about 100 fluorescent proteins from FPbase: origins of replication,
resistance and auxotrophic markers, promoters, terminators, tags and fusion
partners, operators and recombination sites, reporters, and the usual
sequencing-primer sites, the parts of binary and viral vectors, plus common
fluorescent proteins. Every one is read
from a public NCBI record whose accession and location are cited with it; the
fluorescent proteins are chosen from [FPbase](https://www.fpbase.org), whose
data is shared under CC BY-SA 4.0, and their DNA is the coding sequence of
the NCBI record FPbase names. Tags and coding parts are matched by their
protein as well as their DNA (above), so one written in other codons is
still found.

### My parts

The bundled list cannot know your lab's own parts: in-house promoters, tags,
landing pads, toolkit parts. **My parts**, under the Detect features button in
the Features tab, is a list of your own that Detect features looks for as
well. It is kept in this browser, like My primers, and leaves it only as a
download.

- **Add a part** from any document: open a feature, choose **Save to My
  parts**. Its bases are saved as they read in the feature's own direction,
  with its type, name and notes. Or **Add from file…** with a GenBank file
  (each feature of each record becomes a part; a record with no features is
  one part) or a FASTA file (each record a part).
- A part must be at least 12 bases of A, C, G and T (a peptide part, 5
  residues); the message after adding says how many were left out as too short,
  with other letters in them, or already kept.
- **Download as GenBank** writes your parts as one record each, which **Add
  from file…** reads back, so a lab can share one file. Parts that only
  have a protein cannot be written as DNA, and imported lists (below) are
  not included.
- Detect features searches My parts together with the bundled list. A hit
  from yours says **from My parts** under it, and the feature it adds has a
  note naming that list instead of an NCBI record. Where one of your parts and
  a bundled one cover the same bases, yours is the one offered.

**Import a pLannotate database.** If you already have a copy of one of
[pLannotate](https://github.com/mmcguffi/pLannotate)'s databases and may use
it, open **Import a pLannotate database** and choose its FASTA file
(`snapgene.fasta` for nucleotides, `fpbase.fasta` for proteins) together with
its descriptions table, a CSV or TSV with the columns `sseqid, name, type,
blurb` (older ones: `sseqid, Feature, Type, Description`), or FPbase's headerless
`slug, name, blurb` TSV. A table is paired with the FASTA of the same file name
stem; without one, parts are named by their ids. The files are read in your
browser and not uploaded, and none of that data is part of PlasmidPop. Its
parts are labelled **pLannotate: snapgene** (or **fpbase**) and show that label on
a hit, so they are never taken for the bundled, cited list. **Remove this list**
takes one import away again. pLannotate's BLAST, DIAMOND and SQLite files are not
read; use its FASTA and table.

## Editing a feature

**Edit** opens the full editor under the row, with the name selected for
typing over:

- **Name** and **Type**. The type field suggests common GenBank keys (CDS,
  gene, promoter, terminator, rep_origin, primer_bind, misc_feature, …) but
  accepts anything. One of those typed in another case (`cds`, `polya_signal`)
  becomes that key, spelled as GenBank spells it, when you leave the field.
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
  `order(100..200,300..450)` for pieces that are listed together but not
  one stretch of sequence, `4000..120` to wrap the origin of a circular
  sequence, `<100..450` or
  `100..>450` for partial ends. Invalid input is explained under the field
  and disables saving.
- **Qualifiers**: the `/name="value"` pairs of the GenBank table, such as
  `gene`, `product`, `note`, `codon_start`, `transl_table` or
  `translation`. Add, edit or remove rows; a qualifier with no value is
  written as a flag (`/pseudo`).

**Save changes** (or `Enter`) applies everything as one undo step.
**Cancel** (or `Escape`) closes the editor and leaves the feature as it was.
**Remove feature** deletes it.

## Features and edits

Insertions and deletions move and resize features automatically, on both
strands and across the origin. Copying a selection carries its features
along, and pasting adds them at the destination; see
[Editing](04-editing.md).
