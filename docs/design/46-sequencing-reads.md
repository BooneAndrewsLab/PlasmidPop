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
  confident from poor, the threshold Sanger QC commonly uses; it is not a
  setting yet. For a read that aligned reversed, the qualities are reversed
  with it and its numbering counts along the reverse complement, as before.
- **Shown three ways**: a line of counts ("1 difference at confident bases
  (Q20+), 3 at poor ones"), the confident ones listed with their position
  and quality to click to in the document (the first 50), and the poor
  read bases marked in the alignment. The count is the answer to "does my
  clone match"; the list is where to look.
- **The document's own read** is not used: when the open document is itself
  an AB1 and the box holds the reference, its qualities are ignored. Aligning
  the read into the reference is the usual way round.

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

## Found on the way

- **A second banner above the views collapsed to nothing.** `.app__editor`
  was a grid of `auto minmax(0, 1fr)`: the flexible row went to whichever
  child came second. With the working-copy banner showing, a download,
  share or read notice under it got a 0 px row. It is a flex column now.
