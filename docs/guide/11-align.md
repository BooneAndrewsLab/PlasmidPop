# Pairwise alignment

The **Align** tab aligns another sequence to the open document, for example
a Sanger read against the plasmid, or a synthesised fragment against its
design.

## How to align

1. Paste the other sequence into the box: bare bases, a FASTA record or a
   GenBank record all work. Or drop a file on the box, or click **Choose
   file…**: GenBank, FASTA, SnapGene, AB1 and FASTQ files (gzipped too)
   are read into the box without opening a tab.
2. If the box holds several records (a FASTA file of several reads, say),
   pick the one to align from the list that appears.
3. Choose **Global (end to end)** to align the whole of both sequences
   (Needleman–Wunsch), or **Local (best region)** to find the best-matching
   stretch (Smith–Waterman). Local is the right choice for a read against a
   plasmid.
4. Tick **Against selection only** to align against the selected part of
   the document instead of all of it.
5. Click **Align**. Both orientations of the other sequence are considered
   and the better one is shown; the heading says when it was the reverse
   complement.

The result reports the score, percent identity, the number of columns and
of gap columns, then the alignment in blocks of 60 with the document
position (1-based) at the start of each line. `|` marks identical bases,
`:` a base matched only through an ambiguity code (an `N` in a read, or
`R` in the document against an `A`), `.` a mismatch and a space a gap.
Identity counts only the `|` columns. **Select aligned region in this
document** selects the covered bases so you can annotate or copy them.

## Aligning a read with its qualities

An AB1 or FASTQ file dropped on the box (or chosen with **Choose file…**)
keeps its base qualities for the alignment; the note under the box says
**with base qualities**. They last while the box holds the file's text: edit
it and it is read as plain bases again. See [Sequencing reads](15-reads.md)
for what the qualities are.

- **Trim poor ends**, on by default, cuts the read's unreliable start and
  tail before aligning — the first 20–50 bases and the end of a Sanger read,
  typically. It keeps the stretch whose bases are mostly better than Q13 (a
  5% chance of error; see **Trim at** below), by Mott's algorithm as phred uses it, so a single
  poor base inside a good stretch stays. The result says how many bases went
  from each end; untick it to align the whole read.
- **The differences, by confidence.** Above the alignment, a line says how
  many differences from the document sit on bases the read was sure of
  (Q20 or better, one error in a hundred, unless set otherwise) and how many
  on poor ones. Each
  confident difference is listed with its position in the document and its
  quality; click one to select it there. Those are the ones worth a look;
  the poor ones are usually the sequencer, not the clone.
- **Where confident starts, and where trimming cuts.** Under the controls,
  **Confident from** sets the quality a base must have for a difference on
  it to count as confident, from Q10 to Q50: Q20 suits Sanger reads, a
  nanopore service's consensus (Q40 and up) wants Q40, raw nanopore reads
  Q10 or Q13. The count, the list and the shading follow it at once, without
  aligning again, and so does the status bar's share of good bases for an
  opened read. **Trim at** sets the error rate trimming keeps bases better
  than: Q13 (5%) is phred's usual, Q20 (1%) or Q30 (0.1%) trim harder, Q10
  (10%) keeps more of a noisy read; it applies the next time you align. Both
  are remembered in this browser with the view preferences.
- **Poor bases are marked in the read's line** of the alignment, underlined
  and in the warning colour, so a mismatch on one reads as doubt.
- **The trace, under the read.** An AB1 read shows its trace under each
  block of the alignment, each base's peak under its letter and stretched
  across a gap in the read, so a mismatch can be checked against the
  signal it was called from: one clean peak of the read's base, or two
  peaks on top of each other. Clicking a confident difference in the list
  also brings its block into view and marks it. **Show the trace under the
  read** turns it off.

## When the document is the read

Opened the AB1 or FASTQ itself, and want to check it against the plasmid?
Paste or drop the plasmid (or any reference) into the box. While the open
document is a read — opened from an AB1 or FASTQ, its bases unedited — and
the box holds a sequence without qualities of its own, the note above the
box says **… is a read**, and the document is aligned _to_ the box: the box
is the reference, the document the read. Its qualities and trace are then
used as above — trimming, confident and poor differences, the shading, the
trace under each block.

- The top line of each block is the reference, numbered as the box's
  sequence; the bottom is the read, numbered along the read (or along its
  reverse complement, when that is what aligned).
- Each confident difference is named at its place in the read, with the
  reference position beside it: **Mismatch at 36 (pRef 41), Q40**.
  Clicking it selects that base in the document, the read. **Select aligned
  region in this document** selects the stretch of the read that aligned.
- A GenBank reference marked circular is aligned through its origin, as a
  circular document is.
- **Against selection only** does not apply: the whole read is aligned.
- Untick **This document is the read** to align the box's sequence to the
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
