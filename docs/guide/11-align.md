# Pairwise alignment

The **Align** tab aligns another sequence to the open document, for example
a Sanger read against the plasmid, or a synthesised fragment against its
design. In front of a [protein](16-proteins.md#aligning-two-proteins) it
aligns two proteins, scored by BLOSUM62.

## How to align

1. Paste the other sequence into the box: bare bases, a FASTA record or a
   GenBank record all work. Or drop a file on the box, or click **Choose
   file…**: GenBank, FASTA, SnapGene, AB1 and FASTQ files (gzipped too)
   are read into the box without opening a tab. To align against a
   document already open in another tab, pick it from **Open tab…** (the
   same kind only: protein against protein); its current sequence is used,
   unsaved edits, topology and, for a read, its qualities and trace
   included. Choose or drop several
   files at once to align all of their records together (below).
2. If the box holds several records (a FASTA file of several reads, say),
   pick the one to align from the list that appears — or align them all,
   see [Aligning a batch of reads](#aligning-a-batch-of-reads).
3. Click **Align**, the button just under the box and the file controls.
   Both orientations of the other sequence are considered and the better
   one is shown; the heading says when it was the reverse complement. The
   defaults suit most sequences; the **Options** group under the button
   holds the rest:
4. In **Options**, choose **Global (end to end)** to align the whole of both sequences
   (Needleman–Wunsch), or **Local (best region)** to find the best-matching
   stretch (Smith–Waterman). Local is the right choice for a read against a
   plasmid, and is chosen for you when the box holds a read (a file with
   base qualities) or a sequence under half as long as what it is aligned
   to; the note in the Options group says so. Global would score such a
   sequence across the whole of the plasmid and report a perfect read at
   17% identity. A mode you choose yourself stays chosen while the Align
   tab is open, whatever you then put in the box.
5. Tick **Against selection only** to align against the selected part of
   the document instead of all of it (it is greyed out until something is
   selected). Click **Align** again to re-run with the new options.

The result appears in a **Result** group under Options, and reports the
score, percent identity, the number of columns and of gap columns. It does not print the alignment itself, which is too wide
for a side panel: click **Large view** to read it in a window of its own,
along the whole sequence (see below). Identity counts only the identical
columns.

Point at the result's summary line (a bordered button with a › at its end; hover it, or Tab to it) to see where the
alignment sits: the region it covers is drawn in the map and the sequence
view, in the same dashed purple as other previews, without touching your
selection. A region that runs through the origin of a circular plasmid is
drawn at both ends. Click it (or press Enter) to select the
covered bases, so you can annotate or copy them, and scroll to them; the
highlight steps aside for the selection. On a phone, tap to select. The
highlight goes when the pointer or focus leaves, when you edit, or when you
leave the tab. The same works for each read in a batch's list, where the
whole row is the target, not just the name.

## A result belongs to its input

A result stays on screen only while it describes what is in the panel.
Pasting or editing the sequence box, choosing or dropping a file, taking
another open tab or picking another record **clears** the result and its group (or the
batch's list) and stops an alignment that is still running, so an old
result never looks like the new input's. Changing **Mode** or **Against
selection only** is different, since people tweak these while comparing:
the result stays but is dimmed, "Input changed, align again" shows under
the Result group's name, and its summary line and Large view buttons are
disabled until you click **Align** again. A Large view window that is already open keeps its own
result until you close it.

## Aligning a batch of reads

A FASTQ file of reads, or a FASTA of several Sanger reads, can be aligned
all at once — the usual way to check a batch of clones.

1. Drop the file on the box, or click **Choose file…**. The note under the
   box says how many records it has. To check clones sequenced as separate
   files, pick or drop all the files at once, in any mix of formats: their
   records become the samples, in file order, and the box is emptied (its
   text would be unwieldy). Rows are named by record and file. A new pick
   replaces the samples loaded, as does typing in the box; a file that
   cannot be read is named and the others kept. The 96-record limit counts
   across all the files.
2. Leave the mode as it is, and each record is aligned in the mode it
   would get on its own: Local for a read or anything under half the
   document's length, Global otherwise. A mode you choose is used for every
   record. Tick **Against selection only** if the reads should be looked
   for in part of the document only.
3. Choose **All N records** in the record list under the box; the **Align**
   button then reads **Align all**. Click it. Each record is aligned against the document in turn,
   in the background; the bar counts reads (**12 of 96**) and **Cancel**
   stops the batch, keeping the reads already aligned. Leaving the Align tab
   cancels it too.
4. The reads are listed as they finish, in a **Results** group, one row each: the name, its length
   and whether it aligned **reversed**, the **identity**, the number of
   differences on confident bases (**Q20+ diffs**, following **Confident
   from**; a read without qualities counts all of its differences, as
   **Diffs**), and the stretch of the document it **covers**. Click
   **Identity** to sort lowest first — the clones to look at — then highest
   first, then back to the file's order.
5. Click a read's name to pick it, then click **Large view of all** (the
   highlighted button above the list): the window stacks every read, with
   the one you picked already selected, its score line showing.

A read that could not be aligned (nothing good enough after trimming, too
large) is listed with the reason, and the rest carry on. At most 96 records
(a plate) are aligned at once; for a larger file the note says so and
the list has no **All records** choice: pick one record, or split the file. A batch
is aligned in a band around the words each read shares with the document,
which gives the same alignments as one at a time and takes about half a
second for a plate of Sanger reads against a 5 kb plasmid.

## Aligning a read with its qualities

An AB1 or FASTQ file dropped on the box (or chosen with **Choose file…**)
keeps its base qualities for the alignment; the note under the box says
**with base qualities**. They last while the box holds the file's text: edit
it and it is read as plain bases again. See [Sequencing reads](15-reads.md)
for what the qualities are.

A **Reads** group, under Options, appears when the box (or the document) holds
a read.

- **Trim poor ends**, on by default, cuts the read's unreliable start and
  tail before aligning — the first 20–50 bases and the end of a Sanger read,
  typically. It keeps the stretch whose bases are mostly better than Q13 (a
  5% chance of error; see **Trim at** below), by Mott's algorithm as phred uses it, so a single
  poor base inside a good stretch stays. The result says how many bases went
  from each end; untick it to align the whole read.
- **The differences, by confidence.** Under the score line, a line says how
  many differences from the document sit on bases the read was sure of
  (Q20 or better, one error in a hundred, unless set otherwise) and how many
  on poor ones. Each
  confident difference is listed with its position in the document and its
  quality; click one to select it there. Those are the ones worth a look;
  the poor ones are usually the sequencer, not the clone.
- **Where confident starts, and where trimming cuts.** In the Reads group,
  **Confident from** sets the quality a base must have for a difference on
  it to count as confident, from Q10 to Q50: Q20 suits Sanger reads, a
  nanopore service's consensus (Q40 and up) wants Q40, raw nanopore reads
  Q10 or Q13. The count and the list follow it at once, without
  aligning again, and so does the status bar's share of good bases for an
  opened read. **Trim at** sets the error rate trimming keeps bases better
  than: Q13 (5%) is phred's usual, Q20 (1%) or Q30 (0.1%) trim harder, Q10
  (10%) keeps more of a noisy read; it applies the next time you align. Both
  are remembered in this browser with the view preferences.

The panel does not draw a read's poor bases or an AB1 trace; the large
view does (below).

## When the document is the read

Opened the AB1 or FASTQ itself, and want to check it against the plasmid?
Paste or drop the plasmid (or any reference) into the box. While the open
document is a read — opened from an AB1 or FASTQ, its bases unedited — and
the box holds a sequence without qualities of its own, the note above the
box says **… is a read**, and the document is aligned _to_ the box: the box
is the reference, the document the read. Its qualities and trace are then
used as above — trimming, confident and poor differences.

- The reference is the box's sequence and the read the document, which is
  turned into its reverse complement when that is what aligned.
- Each confident difference is named at its place in the read, with the
  reference position beside it: **Mismatch at 36 (pRef 41), Q40**.
  Clicking it selects that base in the document, the read. **Select aligned
  region in this document** selects the stretch of the read that aligned.
- A GenBank reference marked circular is aligned through its origin, as a
  circular document is.
- **Against selection only** (in Options) does not apply: the whole read is aligned.
- Untick **This document is the read** (in Options) to align the box's sequence to the
  document the usual way round, without the qualities. A box that holds a
  read of its own (a dropped AB1 or FASTQ) is always aligned the usual way.

## Scoring and limits

Scores use match +5, mismatch −4, gap open −10 and gap extend −0.5 (the
EMBOSS DNAfull scheme). Ambiguity codes score by the same scheme, by the
bases they stand for: `A` against `R` (A or G) +1, `A` against `N` −2. An
`N` is therefore neither a match nor a full mismatch, and a run of them does
not attract the alignment.

Alignment runs in a background thread and the interface stays responsive.
A long one shows a progress bar with the percentage done and a **Cancel**
button; leaving the Align tab cancels it too. For large inputs the
orientation is picked first from the short words the two sequences share,
so only one alignment runs; when neither orientation clearly wins, both are
aligned.

A long read against the plasmid it came from — a nanopore read of 10 kb,
say — is aligned in a band around the words the two share rather than over
every pair of bases, which takes a fraction of a second rather than
several. The answer is the same: when the best path runs along the edge of
the band, the band is widened and the alignment done again. Two sequences
that share too little for a band, and would need more than 150 million
cells in full (about 12 kb × 12 kb), are refused to protect the browser's
memory; align against a selection for those.

## Reads through the origin

On a circular document, a **Local** alignment against the whole document
finds a read that runs through the origin, such as a whole-plasmid nanopore
read that happens to start in the middle. Positions are numbered as the
document's, going from its last base back to 1, and **Select aligned
region in this document** selects across the origin.

## Large view

**Large view** on a result (the highlighted button under the score line)
opens the alignment in a window of its own, and
**Large view of all** on an Align all batch stacks every aligned read at
once, starting with the read picked in the list selected. The document sits at the top with a position ruler and each sample is
a row under it, all moving together under one scroll, so a column reads
straight down through the document and every sample. Differences from the
document have a coloured background, by where the column falls in the
document: red in a CDS or an ORF (a difference that may change a
protein), blue in any other feature, grey outside every feature. A column
in several features takes the highest, CDS first. A key sits in the toolbar,
and the heading counts the differing columns in each. Colour is not the only
cue: a changed base is a plain block, a base the sample lacks (a dash) has a
bar along its foot, a base the sample adds has one along its head, and a
match through an ambiguity code is a paler block. The colours are from the
whole document, whether or not **Features** and **ORFs** are on; ORFs count
once the ORFs panel has found them. With no document behind the reference
(a pasted sequence) every difference is grey and there is no key.

- The strip above the rows spans the whole alignment. It marks every
  difference, in the same three colours, and shows the stretch now in view as a rectangle; click or
  drag on it to move there. A thin **coverage band** along its foot shows
  how many reads cover each column at good quality: bare for none, light
  for one, dark for two or more, so a gap shows at a glance. A read counts
  where its base is at or above the confident quality (Confident from, in
  the Reads options); a read with no qualities counts everywhere it
  reaches, and a read of either strand counts.
- **Samples that disagree.** With two or more samples, a column where
  samples carry different bases from each other (not only from the
  document) is marked three ways: a solid foot under the strip's marks, a
  small triangle under the ruler and a faint tint down the column. The
  status row counts them ("3 columns where samples disagree"). Only bases at
  or above Confident from count (a read with no qualities counts
  everywhere), a deletion in one sample against a base in another is a
  disagreement, an ambiguity code such as N takes no part, and the empty
  cells a sample's insertion leaves in the others are ignored. Disagreement
  between reads is more often a base-calling error than a real change. A
  difference that every covering sample shares (they all read G where the
  document has A) is not marked: that agreement is what makes it credible,
  and the list notes it as "samples agree".
- Under the toolbar, when the reference is a document, a **verification
  line** per feature (the source feature and ORFs are left out) says what the
  reads show: "lacZα confirmed by 2 reads" when every base of it is covered
  at good quality and nothing differs, with ", forward strand only" (or
  reverse) when all the covering reads are on one strand; "AmpR: 1
  difference" when a column inside it differs (a poor-quality base does not
  count either way); "x: 17 of 20 bases covered" when only part is reached
  and nothing in that part differs; and "ori: not covered". The number of
  reads is the fewest over the feature's bases, so one read covering only
  half of it does not raise it. Click a line to bring the feature into view.
  A feature across the origin of a circle counts each base once. These lines
  say what the alignment shows, not that the construct is right: a base no
  read covers is unchecked, not good.
- The toolbar has five groups. At the left, **‹ Prev** and **Next ›**
  (`Alt+N`, `Alt+Shift+N`, or whatever Next change is bound to in
  Format ▸ Keyboard shortcuts…) go from one difference to the next and wrap
  round at the ends, with a count beside them ("3 of 41"). A run of
  neighbouring differing columns (a 5-base gap, say) is one stop, and the
  whole run is marked. Beside the count, **List** opens the table of
  differences described below, and **Go to** and **Find** open a small
  form under the toolbar (see below), and **Export** opens another for
  saving or copying the alignment (see below). At the right, the **Show** group switches **Features**, **ORFs**,
  **Amino acids** and **Trace** on and off; they stay as you left them
  when you open the window again. Under the toolbar, the sample's score
  line sits at the left and the colour key at the right.
- **Go to** (`Ctrl+G`) takes a 1-based position, numbered as the ruler
  numbers the document, and scrolls to its column and marks it, however many
  columns another sample's insertion has opened before it. A position past
  the end of the document (or of a circular one) is refused with the last
  position; one in the document but outside the stretch the alignment covers
  (when the document's selection was aligned) says which positions are. When
  the document is the read, positions are those of the reference you pasted.
  **Find** (`Ctrl+F`, the editor's Find key, which here belongs to the
  window) looks for a motif, IUPAC codes allowed (`GAATTC`, `RGATCY`), at
  least three bases, on both strands, in the **Reference** or in the sample
  chosen in **In** (the sample you picked on the alignment; choosing another
  there picks it). A sample is searched on its own bases, so a motif is found
  across a deletion, and the marked columns include the gap they span; the
  reference is searched across another sample's insertion the same way. The
  form says "2 of 5"; **‹** and **›**, `Enter` and `Shift+Enter` step through
  the matches, wrapping round, and each is marked and scrolled into view
  (a match on the reverse strand says so). A motif across a circle's origin
  is found in the reference only when a sample reads through the origin,
  which makes the reference run on. `Esc` closes the form first and the window
  on the second press; neither key reaches the editor underneath.
- **Export** takes the alignment out of the window for a notebook, a slide or
  an email. The form's **Columns** are those on screen when it opens (1-based
  alignment columns, the gap columns another sample opened included); type a
  range, or press **On screen** or **All**. **Save SVG** and **Save PNG**
  download a picture of those columns as the window draws them: the names,
  the ruler, the feature track, the reference and every sample with the
  differences shaded, the marks where samples disagree, and the amino-acid
  strips and chromatograms when they are switched on. The picture uses the
  window's colours and theme, and nothing picked or marked in the window. It
  is named from the document and the columns (`pUC19-alignment-1-120.svg`).
  A picture is drawn whole, so a very large one is refused with the reason:
  an SVG up to 100,000 bases (columns times rows, the document's row
  counted), a PNG up to 400,000 and about 16,000 pixels on a side (it is
  drawn at twice the size when that fits, for sharp text). Choose fewer
  columns, or copy the text. **As text** copies the columns in blocks of the
  width in **in blocks of** (60 by default, 10 at least): in each block the
  document's row and a row per sample, each with its name and the 1-based
  number of its first and last base in the block, then a match line under the
  document where `|` marks a column in which every sequence that reaches it
  has the same base (a gap agrees with a gap, case is ignored). The
  document's numbers are the ruler's; a sample's count its own bases along
  the stretch aligned, so a read's numbers start at 1 for its first aligned
  base, and are left blank where the sample has no base in a block. Names are
  cut to 24 characters. **As aligned FASTA** copies the same columns as one
  record per sequence, the document first, all the same length with `-`
  for a gap and for the columns a sample does not cover, 60 to a line, ready
  for any tool that reads an alignment. A file leaves the app as a download;
  copying is to the clipboard.
- Between the ruler and the document row runs a **feature track**: the
  document's features as bars, an arrow for the strand, a join tied by a
  line, and one across the origin of a circular document drawn where a read
  through the origin sees it. Read a difference against the bar above it to
  see whether it falls in a gene, a promoter or nothing; hover a bar for its
  name and type. The **Features** and **ORFs** buttons in the Show group (pressed means on) switch each on.
  ORFs are the ones the ORFs panel finds (at its minimum length), outlined
  and dashed in their own lanes under the features. A feature that an
  insertion in a sample splits round is drawn across the gap columns. Up to
  eight lanes are drawn; the score line counts what did not fit. When the
  document is the read and the reference is the sequence in the box, there is
  no track, since a pasted sequence brings none of its own.
- The **Amino acids** button (shown when the document has a CDS in the alignment; `Alt+T` in this window, as Translations is in the views) draws a
  strip of residues under the document row and under each sample: the
  document's own, then what the sample's bases make of the same codons, read
  with the feature's genetic code and strand. A residue that changed is shaded
  (another residue, a stop gained or lost); one the same letter from other
  bases is shaded faintly; a `-` marks a codon with a base missing or inserted
  inside it; a codon the sample does not reach is left empty. The codons are
  the document's, so a frameshift shows as `-` where it starts and as changed
  residues after it, not as a re-read frame.
- **List** opens a table of the differences, one row per run of differing
  columns, between the verification lines and the alignment (it is closed by
  default and remembered like the Show buttons). Its columns are the
  **Position** in the document (1-based, as the ruler numbers it; an
  insertion is put at the base before it, and on a circular document a read
  through the origin counts on from 1 again), the **Change** from the
  document's bases to the sample's (`A→G`, `-` for none, long runs cut to
  their ends and a length), the **Samples** that carry it (with several
  carrying different bases, each change is listed), the **Feature** it falls
  in (a CDS or ORF first, then any other feature, else `none`), the lowest
  read **Quality** over the differing columns (reads with qualities only),
  the **Protein effect** inside a CDS and a **Note** ("samples disagree"
  where the region has a column marked as above, "samples agree" where two
  or more samples carry the same change and none disagrees, else blank). The
  effect is `silent`, a missense such as
  `p.K42R`, a nonsense `p.K42*`, a stop lost `p.*42K`, `frameshift` for an
  insertion or deletion that is not a multiple of three bases, or
  `in-frame indel`. Codons are read in the CDS's own frame, strand and
  genetic code, so a reverse-strand CDS is translated after reverse
  complementing. Outside a CDS the effect is blank, and where a region
  crosses more than one CDS each is named. Click a row, or press Enter on its
  position, to go to it as **Next** does and pick a sample that carries it.
  **Copy** puts the whole table on the clipboard as tab-separated text with a
  header line, ready for a lab notebook or a spreadsheet. With no document
  behind the reference there is no feature or effect.
- Click a name, or click into the alignment and press `↑` or `↓`, to pick
  a sample. Its score and identity show under the toolbar, with
  **Select in document** beside them to select the region it aligned to.
- `Esc` closes the window and returns you to where you were.

An insertion in one sample opens gap columns in the document row and in
every other sample, so the rows stay in register. This is each sample
aligned to the document alone, laid side by side; it is not a multiple
sequence alignment, and two samples are not aligned to each other. The
A read's bases below the confident quality sit on a grey block, faded, so a
difference there is easy to discount. A read opened from an AB1 file has its
chromatogram drawn under its row, each base's peak under its letter and the
base qualities as faint bars behind; press **Trace** in the window's toolbar
(shown when any sample has one, on by default) to hide it and see more rows.
