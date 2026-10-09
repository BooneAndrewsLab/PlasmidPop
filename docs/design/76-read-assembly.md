# 76. Assembling reads into a contig (#208)

**Asked:** several Sanger reads joined with no reference, into a
quality-aware consensus with disagreements flagged, saved as a document.
Reference-based checking (item 46) covers clone verification; this is for an
insert not known yet, or one consensus from overlapping reads.

**Built:**

- `core/assembly/consensus.ts`: `callColumn`. A read's base is right with
  probability 1 - 10^(-q/10) and otherwise one of the other four symbols
  (three bases and a gap) equally; the posterior over A, C, G, T and gap under
  a flat prior is what is called. The bases whose posterior first reaches 0.8
  (`CALL_POSTERIOR`) are the call, as an IUPAC code if more than one, with a
  Phred quality from their summed posterior (capped at 60). A lone Q10 read
  (0.9) calls a base; two Q10 reads that disagree make R/Y/...; Q40 against
  Q8 keeps the Q40 base. A column where the gap leads is left out of the
  consensus. Votes of N or another ambiguity code carry nothing; a column
  with no vote is N. Qualities are clamped to 1-60 so no vote rules a base out.
- `core/assembly/assemble.ts`: `assembleReads`, greedy overlap-layout-
  consensus. Reads are trimmed with `trimByQuality` (item 46). The longest
  trimmed read seeds a contig; every other read, longest first, is aligned
  (`alignEitherStrand`, local, `fast`) to the contig's current consensus and
  joined when the aligned stretch is at least 25 bases at 90% identity and the
  read's stretch fits an end-free overlap: at each end either the read or the
  consensus runs out, within 8 bases (`END_SLACK`). Bases left over inside
  that slack are paired off with the consensus one to one and further read
  bases extend the contig. Passes repeat until none places a read, then the
  rest seed contigs of their own. A read is placed at the first contig it
  fits, not the best: simple, and enough for a few to a few dozen reads of one
  region.
- **The layout is a multiple alignment** kept as a row of cells per read
  (a base, `-` inside its stretch, a space outside) so each column is called
  from all the reads and a read's insertion becomes a column of its own, in
  which the other reads have a gap where they span it. A gap's quality is the
  lower of the bases either side in its row, as `columnQualities` does.
- **Alignment is injected** (`AssemblyAlign`): the panel passes
  `analysisClient.alignEitherStrand`, so the work is in the worker and the
  main thread only waits; tests run it inline. Cancel aborts the running
  request and the signal.
- **Disagreements** are the columns whose call is an ambiguity code or where a
  read at or above Confident from (Q20 by default, the setting of item 46)
  puts a base, or a gap, the call does not include. A poor dissenter is
  outvoted silently.
- **UI** (`AssemblyResult`, in the Align tab): **Assemble reads** beside
  **Align** for two to 96 records, using Trim poor ends and the thresholds
  already there. A layout of bars (an SVG of a few dozen rects, no sequence
  text) with red marks at disagreements, the disagreements listed with each
  read's base and quality, a contig picker, and **Save consensus as
  document**, which opens a tab (`editorStore.openConsensus`) with the call
  qualities as its read when any read had qualities. Events: `align /
assemble` and `align / assemble-save` (item 38).

**Left out, on purpose:** the traces under the layout (the layout shows reads
as bars, not bases, and no trace view of a read that is not the document);
bases only a minority of reads have, in columns the consensus drops, are not
shown in the stack; no repeat resolution or paired ends; no quality-weighted
choice among several contigs a read fits. Each is an issue if users ask.
