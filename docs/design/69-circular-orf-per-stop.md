# 69. One ORF per stop on a circle (#145)

**Found:** the 2026-10-05 correctness audit, against a brute-force walk from
every start codon (codon tables from Biopython). In 10 of its 46 circular
cases the ORF list had a duplicate.

- **A nested start was listed beside the ORF across the origin.**
  `scanStrand` read a doubled copy of a circular strand frame by frame and
  began each frame with no open start, so a start before that frame's first
  stop was reported even when it sat inside an ORF that came round the
  origin and ended at the same stop. With L = 316 (table 4, minimum 4
  codons) the list held both 273–504 and 122–188, and 504 is 188 + 316. When
  L is not a multiple of three the outer ORF begins in another frame (the
  reading changes frame at the origin); when it is, in the same one.
- **A second variant lost an ORF.** When L is not a multiple of three a
  reading can run more than once round before it meets a stop. The scan held
  on to the first start, found the ORF longer than the molecule and dropped
  it, and with it every later start sharing that stop, including ones that
  fit (L = 29: the ATG at 22 through the stop at 43 was missing). A random
  check of 2,250 short circles (6 to 400 bp) found 535 with one or the other
  (493 with an extra ORF, 156 with one missing); the lines had none.

**Built:** circular strands are scanned by stop rather than by frame
(`scanCircle` in `orf.ts`). Each codon position is classed once (stop,
start, neither); each stop then walks back codon by codon, modulo L, to the
previous stop or until the ORF would be longer than L, and keeps the
farthest start it passed. So there is one ORF per stop, from the first start
that fits, wherever the origin falls. Each position is walked over by one
stop at most, so the scan is linear: 1 Mb circular takes the same time as
before (~0.4 s). Linear strands keep the frame scan, which had neither fault.

The minimum length applies to the chosen (longest) ORF, so whether it is
applied before or after picking among starts makes no difference. A reading
with no stop anywhere round the circle is still no ORF, and an ORF may be
exactly L long (start just after its stop). Alternative starts follow the
same rule. The consumers (ORFs tab, map and sequence previews, Add as CDS,
Align's ORF track) take the list as it is and needed no change.

**Tests:** `orf.test.ts` pins the audit case, a same-frame nested start on
both strands, the over-long first start, alternative starts, and a property
test against a brute-force walk on circles and lines.
