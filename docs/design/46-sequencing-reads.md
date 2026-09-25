# 46. Sequencing reads: AB1 and FASTQ

Milestone 1.3, from user feedback on aligning Sanger and nanopore reads (the
same feedback as item 45): "I would want the base calling qualities to be in
there when I do the alignment so I know the confidence." Issues #49 (readers),
#50 (qualities in Align), #51 (long reads), #52 (chromatogram); the questions
in #53 were decided at the start of 1.3 (2026-09-23): the chromatogram ships in
1.3, built last, and an opened AB1 is an ordinary document with its read kept
alongside it.

## Reading them (#49)

- **ABIF** (`io/abif/parseAbif.ts`). Big-endian, a directory of 28-byte
  entries, data of four bytes or fewer inside the entry. Read: base calls
  (PBAS), qualities (PCON), peak positions (PLOC), the analysed channels
  DATA9–12 in FWO_1's order, the sample name (SMPL1) as the description.
  PBAS, PCON and PLOC come as copy 1 (as called) and copy 2 (as edited);
  copy 2 is preferred, as Biopython does, and a tag falls back to the other
  copy only when its length matches the calls. That matters: the nanopore
  service files met in practice have PLOC1 and no PLOC2. Peaks stored as
  shorts are read unsigned, so a trace past 32,767 points still lines up.
  A file without base calls (fragment analysis, `.fsa`) is refused with
  that reason rather than opened empty; a trace that does not line up with
  the calls is left off with a warning.
- **FASTQ** (`io/fastq/fastq.ts`), Phred + 33. The quality is read until it
  is as long as the bases, since `@` is also a quality character and cannot
  on its own mark the next record. A `.fastq.gz` is decompressed by the
  platform's `DecompressionStream` (`readSequenceData`), so nothing is
  bundled for it; the stream is built by hand rather than from a Blob,
  which jsdom cannot stream.
- **Checked against Biopython.** Real AB1 files are an instrument's or a
  lab's, so the committed fixtures are written by
  `scripts/oracle/abif_fixtures.py` from the format — an instrument-shaped
  file with edited calls, raw channels and run tags to skip, a service-shaped
  one with only PLOC1, one without calls — and Biopython's reading of them
  is the oracle (`src/test/oracle/abif.json`). `npm run oracle:abif [dir…]`
  runs the same comparison on local files: on 2026-09-23, 13 files from a
  nanopore service and Biopython's own 310, 3100, 3730 and empty-run files
  agreed in bases, qualities, all four channels and peaks.

## The read on the document

- **`SeqDocument.read`** (`core/document/read.ts`): a quality per base and,
  from AB1, the trace (four `Int16Array` channels and an `Int32Array` of
  peaks). Typed arrays, since a trace is tens of thousands of samples.
- **Kept while the bases are the read's.** `with()` drops the read whenever
  a patch brings new bases and does not bring a read of its own, so every
  base-changing edit, present or future, drops it without having to know
  about reads. Feature, name and metadata edits and a change of topology
  keep it. Reverse complement brings its own: qualities reversed, each
  channel mirrored onto its complement's, peaks mirrored, so the trace
  still sits under its bases. Undo gets a dropped read back for free, since
  history keeps the documents.
- **Said when it is left behind** (`ReadNotice`): after an edit that drops
  it ("Undo brings them back"), and at a download, since GenBank has no
  place for qualities or a trace. A share link carries GenBank too, and so
  arrives without it; the guide says so rather than a notice.
- **Stored beside the GenBank text.** Documents are stored as GenBank text,
  which cannot hold a read, so `StoredDocument.read` (and the working
  copy's `origin.read`) keeps it as the typed arrays IndexedDB stores
  natively; a stored read that no longer fits its bases is left off rather
  than losing the document.
- **Something to see before the trace view:** the status bar says
  "Read, 92% Q20+".
- **Many-record files.** A tab holds one molecule, so a FASTQ of reads opens
  its first. That was already true of FASTA, silently; now a warning says
  how many records were not opened and that the Align box can pick one.
  In the Align box an AB1 or FASTQ shows as FASTA text, while its records
  keep their qualities (#50, below).

## Qualities in Align (#50)

- **Where the qualities live.** The Align box is text, and FASTA cannot
  carry a quality, so a file read into it is kept as the text it shows plus
  its records as read; the records are used while the box still holds that
  exact text. An edit to the text is a new sequence, read afresh, without
  qualities: nothing silently mismatched.
- **Trimming** (`trimByQuality`, `core/alignment/quality.ts`): Mott's
  algorithm, each base scoring 0.05 − 10^(−q/10) and the maximal-scoring
  stretch kept, as phred's `-trim_alt`. Biopython's `abi-trim` is the same
  idea but never scores the first base and drops the last base of the
  stretch, so it is not the oracle here; a brute-force search over random
  qualities is. The read is trimmed before it is aligned, rather than the
  alignment afterwards, so its junk ends cannot pull a local alignment or
  add end gaps to a global one. When nothing clears the cutoff the panel
  says so instead of aligning an empty read.
- **Confidence per difference** (`columnQualities`, `readDifferences`). A
  column's quality is the read base's; for a base the read lacks, the lower
  of its neighbours', since a missing base has none and it is the calls
  either side that vouch for the gap. Q20 (one error in a hundred) divides
  confident from poor by default, the threshold Sanger QC commonly uses; it
  is a setting since #56 (below). For a read that aligned reversed, the qualities are reversed
  with it and its numbering counts along the reverse complement, as before.
- **Shown three ways**: a line of counts ("1 difference at confident bases
  (Q20+), 3 at poor ones"), the confident ones listed with their position
  and quality to click to in the document (the first 50), and the poor
  read bases marked in the alignment. The count is the answer to "does my
  clone match"; the list is where to look.
- **The document's own read** was not used at first: when the open
  document was itself an AB1 and the box held the reference, its qualities
  were ignored. It is since #57, below.

## The thresholds as settings (#56)

- **Confident from, Q10–Q50.** Q20 is right for Sanger and wrong for the
  rest: a nanopore service's consensus reports Q40 and more, so at Q20
  every call it makes is "confident", and raw nanopore reads sit at Q10–20,
  so at Q20 half of a good read is "poor". A select of Q10, 13, 15, 20, 25,
  30, 40, 50 rather than a number box: a half-typed value never reaches the
  alignment, and a stored value is checked against the list on the way back
  in, as the other view preferences are (`isConfidentQuality`).
- **Trim at, beside it**, as the error rate Mott's algorithm scores with —
  10%, 5%, 2%, 1%, 0.1%, labelled with their Q (10, 13, 17, 20, 30). Kept
  as a probability rather than a Q so the default stays phred's exact 0.05;
  Q13 would be 0.0501. Disabled while trimming is off.
- **App settings, not the document's** (`SharedState.readConfidentQuality`,
  `readTrimCutoff`), remembered with the view preferences: a lab reads the
  same kind of reads day after day. Both are shown only when the box holds
  a read.
- **What follows the threshold**: the count, the list of confident
  differences and the shading of poor bases, all worked out when drawn from
  the column qualities the result keeps, so a change shows without
  aligning again; the status bar's **Read, 92% Q20+** too, so the two never
  disagree about what "good" is. The trim cutoff needs a new alignment,
  since it decides what is aligned.

## The document as the read (#57)

- **Swapped, not a second quality line.** When the open document has an
  intact read (`doc.read`, which an edit to the bases drops) and the box's
  record has none, the box is taken as the reference and the document as
  the read: the pair is sent the other way round. The issue offered two
  ways: qualities on the first sequence, or swapping. Swapping was chosen
  because everything about a read — trimming before aligning, choosing and
  turning its strand, the column qualities, the shading, the trace strip,
  a difference's kind named from the read's side — is built for the second
  sequence, and differences are counted against the reference whichever
  one is open. Qualities on the first line would have meant a second copy
  of each of those, mirrored. It is automatic rather than a button to swap
  the text, since the document cannot go into the box; a checkbox, **This
  document is the read**, ticked by default, gives the old way back.
- **Positions go back to the document.** The list must select in the
  document, which is now the read, so a difference also carries
  `positionB`, its read base (or, for a base the read lacks, the one it
  comes before). Along the read as aligned, from `offsetB`, it is mirrored
  back when the read aligned reversed (`readRange`): base _o_ of the
  reverse complement is base _L_ − 1 − _o_ of the read, the point before
  it _L_ − _o_. The label names both: **Mismatch at 36 (pRef 41), Q40**.
  **Select aligned region in this document** selects the aligned read.
- **A circular reference** in the box (a GenBank record marked circular,
  or a FASTA header saying so) wraps as a circular document does, so a
  read through the plasmid's origin still aligns in one piece; the
  records keep their topology for it. **Against selection only** is off in
  this mode: a selection of the read has not been asked for.
- **One path for both** (`app/readAlignment.ts`): trimming and building the
  pair (`prepareReadAlignment`) and turning the answer into what is shown
  (`finishReadAlignment`) moved out of the panel, so the usual way, this
  way and a batch (#59) share them.

## Long reads (#51)

- **Banded, around anchors** (`core/alignment/banded.ts`). The read's
  15-mers found in the reference (a word met more than four times there is
  a repeat and skipped) are anchors; their longest chain rising in both
  sequences is the guide, and an anchor whose diagonal is far from both
  neighbours' is dropped as a chance match. 15 rather than the strand
  check's 11: a chain wants few chance matches more than many true ones,
  and a 5% error read still keeps about half its 15-mers.
- **The band is the rectangles between anchors.** The optimal path between
  two anchors that lie on it cannot leave the rectangle they span, however
  many indels the read has in between, so a long insertion or a stretch
  without anchors is covered without guessing a width. Each rectangle is
  padded by a margin (64 first) for anchors slightly off the path; past
  the chain's ends the band follows the diagonal; a global alignment adds
  the matrix corners as anchors. Made monotone, it is what the fill needs.
- **Checked by its edge.** A path that touches the band's edge (not the
  matrix's) may have been cut off, so the margin is widened (256, 1024) and
  the fill run again; at the widest, the full alignment replaces it if it
  fits. Tests compare the banded score with the full one on noisy reads,
  a 400-base insertion and a repeated segment.
- **One fill** (`alignInBand`): the full alignment is the band of every
  cell, same visiting order and tie-breaking, checked identical on 800
  random pairs before the old fill was removed; 5% slower in full, which
  buys not having two fills to keep in step.
- **When**: up to 25 M cells the full fill, exact and under a second;
  past it the band. Too little in common to band and too large in full is
  refused, saying which.
- **Through the origin.** A local alignment against a whole circular
  document is made against the sequence with its start repeated after its
  end, as far as the read is long; an alignment found wholly in the repeat
  is moved one turn back, positions are shown modulo the length, and the
  selection is the unrolled range the document model already has for a
  range across the origin. A read longer than the circle (a concatemer)
  selects the circle once.

## The chromatogram (#52)

- **Where** (decided on #52 at the start of the work): both in the sequence
  view of an opened AB1, between the ruler and the strands, and under each
  block of an alignment in the Align panel; one renderer for both
  (`view/trace.ts`). On a phone the reader's sequence view shows it too,
  read-only, since it is the same view.
- **Lining the trace up with letters.** Peaks are not evenly spaced and
  letters are, so the caller lists the bases to draw with the x of each
  one's centre, and the signal between two listed peaks is stretched over
  the distance between their centres, half a base's worth beyond the ends.
  In the alignment a gap in the read is a column left out of the list, so
  the trace stretches across it with no case of its own; a read aligned
  reversed draws the reverse complement of its read (channels swapped and
  mirrored, `reverseComplementRead`), indexed as its line is numbered.
- **Scale**: the 99th percentile of the tallest channel, sampled over the
  whole trace and cached, so one dye blob does not flatten the rest and
  every row and block is drawn to the same height. Qualities are bars
  behind, Q60 at full height.
- **In the layout** it is `traceHeight` in the row metrics (0 without a
  trace), so the strands, selection, caret and everything positioned from
  `forwardTextTop` move down with it; the SVG export draws it through the
  same renderer. Colours are the view's base colours, so it follows the
  theme, with a quality colour of its own (`--seq-trace-quality`).
- **The Align strip** is a canvas per 60-column block, as wide as the
  block's text at the `<pre>`'s own character width, drawn once. Picking a
  confident difference scrolls to its block and marks it.
- **Follow-ups**: a toggle for the sequence view's trace (#55) — done
  2026-09-24 as **Format ▸ Trace**: Hidden, Short (the 64 px it had) or
  Tall (128), `SharedState.traceSize`, remembered with the view
  preferences, followed by the SVG export, and offered only while a read
  with a trace is in front. The issue's second idea, scaling a weak
  signal, needed nothing: each trace is already drawn against its own
  99th percentile (`traceScale`), so a weak read fills its band.

## Follow-ups filed

#55 a toggle for the sequence view's trace; #56 a setting for the Q20
threshold (done, above); #57 using the document's own read when it is the read (done, above); #58
exporting a read as FASTQ; #59 aligning every record of a file as a batch.

## Found on the way

- **A second banner above the views collapsed to nothing.** `.app__editor`
  was a grid of `auto minmax(0, 1fr)`: the flexible row went to whichever
  child came second. With the working-copy banner showing, a download,
  share or read notice under it got a 0 px row. It is a flex column now.
