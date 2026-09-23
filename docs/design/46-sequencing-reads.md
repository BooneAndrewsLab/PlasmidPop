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
  In the Align box AB1 and FASTQ are read as FASTA for now, which loses the
  qualities until #50.

## Found on the way

- **A second banner above the views collapsed to nothing.** `.app__editor`
  was a grid of `auto minmax(0, 1fr)`: the flexible row went to whichever
  child came second. With the working-copy banner showing, a download,
  share or read notice under it got a 0 px row. It is a flex column now.
