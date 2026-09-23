# 45. Align: ambiguity codes, larger inputs, files

Done, 2026-09-23 (#46, #47, #48), for 1.2.1. From a user trying the Align tab
on Sanger and nanopore reads: a file dropped on the box opened a tab, and a
~10 kb nanopore read was refused ("120,538,441 alignment cells; the
in-browser limit is 30,000,000"). The rest of that feedback — AB1 and FASTQ
with base qualities, banded alignment, a chromatogram — is milestone 1.3
(#49–#53).

- **Ambiguity codes score by EDNAFULL** (`core/alignment/scoring.ts`). The
  aligner compared characters, so an `N` in a read mismatched everything
  and a degenerate base in the document never matched, against the IUPAC
  rule in CLAUDE.md. The matrix is EMBOSS's EDNAFULL (NCBI NUC.4.4), copied
  from Biopython's `substitution_matrices.load('NUC.4.4')`, which is the
  scheme the guide already named: definite bases keep the caller's
  match/mismatch, codes get the matrix's partial scores (A–R +1, A–N −2,
  N–N −1). Treating any overlap as a full match was the alternative and was
  rejected: a read with a run of `N`s would then align anywhere. The fill
  looks each pair up in a 16 × 16 table of the pre-encoded sequences, which
  is no slower than the old character comparison.
- **What a column is.** The match line gains `:` for a match only through
  a code; `identities` counts the same definite base only, and a new
  `ambiguous` count carries the rest, so identity does not rise with the
  number of `N`s.
- **Edit marks stay exact.** `diff/refine.ts` re-aligns neighbourhoods of
  an edit with the same aligner; it passes `iupac: false`, since an A
  rewritten as N is an edit whatever it could stand for.
- **One traceback byte per cell.** The three states' moves, two bits each,
  are packed into one byte instead of three arrays, so memory is n·m bytes.
  The limit rose from 30 M to 150 M cells (about 12 kb × 12 kb, 150 MB) —
  a little more than the old limit's footprint of 90 MB, chosen so the
  reported case fits. An allocation the browser refuses is reported as such
  rather than as a crash. The same alignments come out, about 15% faster
  (docs/perf-notes.md).
- **The strand is chosen before aligning** (`alignEitherStrand`,
  `core/alignment/strands.ts`). The panel aligned both strands in full and
  kept the better. Above 4 M cells the 11-mers of each strand of the read
  are now counted against the document (a 512 KB bitmap of all 4¹¹), and
  only the strand with at least 20 and three times the other's count is
  aligned; otherwise both are, as before. Below 4 M both are always aligned:
  it is under a second and exact. A 5% error rate leaves most 11-mers
  intact (thousands for a 10 kb read), while unrelated 10 kb sequences share
  a few dozen by chance on each strand, so the ratio decides. The worker has
  an `alignEitherStrand` request for it.
- **Files in the box** (`AlignPanel.tsx`). The box and a **Choose file…**
  button read any format Open reads. A text file goes into the box as it
  is; a SnapGene file, being binary, as FASTA of its records. The box stays
  the one source of what is aligned, editable as before.
- **Claimed drops.** The app-wide drop handler (open in a new tab) now
  leaves alone a drop an inner target has claimed with `preventDefault`;
  checking `defaultPrevented` there, rather than stopping propagation in
  each target, keeps the app's drag outline in step. The REBASE import's
  drop zone was already calling `preventDefault` and had the same fault,
  opening its file as a tab too; it is fixed by the same change. The Align
  box only claims drags that carry files, so dragged text still drops in.
- **Several records.** The box used only the first record of a FASTA or
  GenBank text, silently. Now a list of the records (name and length)
  appears when there are several, and the chosen one is aligned. Aligning
  all of them at once is left for reads in 1.3.
