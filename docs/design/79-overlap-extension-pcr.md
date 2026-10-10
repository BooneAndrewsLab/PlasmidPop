# 79. Overlap-extension (SOE) PCR primers (#216)

**Asked:** primer design covered amplifying a region and site-directed
mutagenesis, but not fusing two or more fragments by PCR with tails that
overlap the neighbour. Proposed: on the Bench, choose fragments in order and
get the inner and outer primers (overlap Tm a setting), the first-round and
fused products checked by the existing PCR simulation, warnings for a short
or non-unique overlap or a frameshift in a CDS spanning a junction, and
the primers in My primers.

**Built** (`src/core/cloning/overlapExtension.ts`,
`src/app/components/SoePanel.tsx`, a sixth Bench reaction, **Overlap PCR**):

- **Fragments are a tab and a part of it** (`insertChoices.ts`, shared with
  the In-Fusion designer, #63): its selection, a feature, or all of a
  linear template. The same tab twice, with a gap between the parts, is a
  deletion; there is no separate deletion mode.
- **The overlap at a junction** is the last `a` bases of the upstream
  fragment and the first `b` of the downstream one, `a = ceil(L/2)`, with
  `L` grown from 18 until it melts at the overlap Tm (default 60 °C, nearest
  neighbour, as everywhere) or reaches 40. The downstream fragment's forward
  primer takes the first half as its tail, the upstream fragment's reverse
  primer the reverse complement of the second. Each annealing part is grown
  to 60 °C (`growAnnealing`, shared with the In-Fusion designer, #63) and is never shorter than
  the tail it continues, so the two inner primers are complementary over the
  whole overlap, as they are drawn in the usual scheme.
- **Every step is run, not described.** Each fragment is amplified by `pcr`
  from its own template; the first-round products are joined by `gibson`
  with `circular: false` (the same end-homology search, so an ambiguous or
  repeated overlap is refused the same way); the fused sequence must equal
  the fragments end to end; and `pcr` with the two outer primers on the
  fused molecule gives the product. Any step that fails is the design's
  `problem`, in words.
- **Warnings:** an overlap under 15 bases or under 50 °C; an overlap found
  more than once in the fused molecule (both strands); an annealing part
  more than 5 °C under target; and a frame check. The frame check reads,
  for each CDS that covers the last base of a fragment (first, for the
  reverse strand), how many coding bases the ribosome has read when it
  arrives, from `/codon_start` and the segments in reading order, and the
  same for the CDS covering the next fragment's first base; unequal
  residues mod 3 are a shift. It covers a deletion inside a gene and a tag
  fused to a gene at once, and it handles `join(...)` and a CDS over the
  origin. A CDS cut off at a junction with nothing on the other side to
  continue it is not reported: nothing says what it was meant to read into.
- **Lineage:** the fused molecule is recorded as a `gibson` step with the
  new kit `overlap-extension` (linear), under a `pcr` step for the outer
  primers, over one `pcr` step per fragment for its inner primers
  (`recordOverlapExtension`). The kit is a value of `HomologyKit`, so the
  GenBank "made from" comment round-trips it with no format change, and the
  protocol (item 78) lists every primer and writes the fusion as a reaction
  of its own with the usual instruction (equimolar products, about ten
  cycles without primers, then the outer primers) rather than as the
  Gibson mix it is not.
- **Primers go to My primers** by **Save primers**, named after the product
  or the fragments, with a note of what each is for. Analytics: `cloning`
  `soe` (opened) and `soe-oligos` (saved), never a name.

**Decided:** both inner primers carry half of the overlap as a tail rather
than one carrying all of it. The two products still overlap by `L`, and an
inner primer is no longer than its tail plus an annealing part of
Tm 60 °C. A middle fragment gets a tail at each end. Fragments are taken
from tabs only: shelf parts are digest fragments with overhangs, which is
not what SOE joins. Primers over ambiguous bases are refused, not
designed.

**Not done:** the annealing efficiency of the first-round products (the
overlap Tm is the only measure), hairpins inside an overlap, and a drawn gel
of the first-round and final products.
