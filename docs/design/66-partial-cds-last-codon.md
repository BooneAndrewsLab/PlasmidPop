# 66. The two-base end of a 3′-partial CDS (#142)

**Found:** the 2026-10-05 correctness audit. Of 6,295 NCBI CDS compared with
their own `/translation`, 17 disagreed only by a last residue we left out.
Each is 3′-partial (`>` on the forward strand) and ends two bases into a
codon: `PZ765744.1` `<1..>778`, `/codon_start=3`, ends `GT` and is stored
`…SIV`; `OQ554331.1` `<1..>1281`, `/codon_start=2`, ends `CC` and is stored
`…DMP`. `translateCds` read whole codons only, so the check reported the
file one residue too long, and **Update /translation** would have deleted a
residue NCBI considers valid. Biopython drops the two bases too; this is
NCBI's convention, not the genetic code's.

**The rule**, checked on every one of the 491 audit CDS whose bases do not
fill their last codon (Biopython 1.88, conda `primer3`): NCBI reads the two
bases as the residue `XYN` gives under the feature's code when that is not
`X` — every completion codes the same amino acid — and only when the 3′ end
is partial. It drops one leftover base, two that leave the residue open
(`TA`), and two at a complete 3′ end (14 such records). No record in the
audit had an unambiguous pair at a complete end or on the reverse strand,
so those two are by reasoning: a complete end with a part-codon is a
malformed CDS NCBI would not translate further, and the reverse strand's 3′
end is the first segment's start (`complement(<1..N)`).

**Built** (`cdsTranslation.ts`):

- `translateCds` appends that residue as a codon of two positions
  (`Codon.positions` is a two- or three-tuple; `isPartCodon`, `lastBaseOf`).
  Reading order, `/codon_start`, joins and the origin are what the whole
  codons already do; the genetic code is the feature's.
- `codonSpan` ends at the part-codon's second base, so clicking the residue
  selects its two bases. A `/transl_except` naming exactly those two bases
  applies to it.
- Everything built on the translation follows: the residue is drawn under
  its bases, the `/translation` check and the re-check after an edit expect
  it, **Update /translation** writes it, and **Open as protein** ends in it.
- `codonSiteAt` (Mutate, item 47) skips it: there is no third base to
  write, so changing that residue is not offered. The alignment's residue
  differences (item 62) need three columns and skip it as well.

**Checked:** the CDS oracle (`scripts/oracle/cds.py`, `.venv-oracle`,
Biopython 1.85) no longer leaves these out; it pads the second opinion's
two bases with `N` the same way, and `ncbi-cds.gbk` gained `PZ765744.1`,
`OQ554331.1` and `QB063967.1` (codon_start 3, 2 and 2; tables 9, 4 and 5).
Re-running the audit, 6,293 of 6,295 CDS match their `/translation`; the two
left are the trans-spliced rps12 of NC_000932, which the location model does
not cover.

## Partial marks on a kept piece (#176)

A 3' mark matters here because it is what lets the two-base end residue be
read at all, so it must not be lost. `extractRange` used to mark a piece
partial only where the region cut inside it. Now the first and last kept range
pieces, in the feature's own order along its segments, are marked on the side
where bases of the location are not kept (`from > 0`, `to < total`), which
covers a dropped whole join segment and the far side of the origin of a
wrapping segment; the run-splitting of #169/#174 builds on those marks.
A delete likewise marks a CDS 3'-partial (`markReadingEndLost`,
`basesLostFromReadingEnd`, the mirror of the 5' pair from #160/#163) when
bases leave the end of its reading, including a dropped last segment that
carried the mark. Non-CDS features are not marked by a delete; they never were.
