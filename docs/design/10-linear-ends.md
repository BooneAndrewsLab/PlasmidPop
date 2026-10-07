# 10. Linear molecule end handling

Done. A `SeqDocument` carries the
shape of its two ends (`src/core/document/ends.ts`: kind, overhang bases
in the same top-strand convention as a digest fragment, and the enzyme),
null for a circular molecule or a plainly blunt linear one. `digest`
gives the outer fragments the molecule's own ends, a linear `ligate`
product keeps the outermost ends of the assembly, and
`documentFromFragment` (**Open** in the Cloning tab) opens a fragment as
a document. An edit that reaches a tip blunts that end, reverse
complement swaps them, making the molecule circular drops them. The
sequence view washes over single-stranded bases, leaves a gap opposite
them and draws a bottom-strand overhang in the gutter beyond the first
or last column (the gutters grow to fit); the toolbar names both ends.
They survive a save: GenBank has no field for them, so they ride in a
`PlasmidPop-ends:` comment that the parser turns back into ends
(`src/io/genbank/endsComment.ts`). Not yet: filling in or chewing back an
overhang (Klenow / T4 blunting; #8).

Added 2026-09-23 (#9):

- **FASTA** carries the GenBank comment's text in brackets at the end of
  the header, `[PlasmidPop-ends: …]`, beside the `[topology=circular]` the
  format already uses; the parser takes it out of the description, and the
  writer strips one that is there before adding its own.
- **SnapGene** writes overhangs in packet 0x08,
  `<AdditionalSequenceProperties>`: `UpstreamStickiness` and
  `DownstreamStickiness`, a count of single-stranded bases with the sign
  giving the kind (positive 5′, negative 3′). Established from SnapGene
  8.2's 203 bundled files: every linearised TA vector is -1/-1 and its
  sequence starts with the A under the bottom strand's T and ends with the
  top strand's T; pET151 D-TOPO and kin are 0/4. So SnapGene's sequence is
  both strands' union, and ours is the top strand: where the bottom strand
  is the longer one (3′ upstream, 5′ downstream) those bases are deleted
  from the sequence with an ordinary `delete`, which clips any feature on
  them, and the end records them. All 203 files import and round-trip their
  ends through GenBank. Import only; there is no .dna writer.
  The clip is an ordinary `delete`, which since #160 also moves `codon_start`
  of a CDS past the bases it took off the front of the reading, so a frame-1
  CDS clipped by one base becomes `codon_start=3` (#154). Consistent with
  #153, which reads SnapGene's `readingFrame` as `codon_start`; a reverse
  CDS carries it negated (-1..-3), and the magnitude is the frame (#164).
- **The circular map** strokes both tips of the open ring in the cut-site
  colour and writes `describeEnds` under the length in the centre, whole or
  not at all like the title. Inside the ring beside the gap was the first
  idea and collides with the feature lanes.

Added 2026-09-23 (#8): **blunting**, the edit bar's **Blunt (fill in)** and
**Blunt (trim)**, one `bluntEnds` edit op with a `method`, so it is undoable,
named in the History and data a CRDT can carry.

- **Two methods, because the bench has two answers for a 5′ overhang.** A
  polymerase (Klenow, T4) fills it in; a single-strand nuclease (mung bean)
  cuts it off. For a 3′ overhang they agree: T4's exonuclease and mung bean
  both remove it, and Klenow alone would leave it, which nobody wants.
- **Where the bases change follows from which strand is longer.** A top
  strand's overhang is in the sequence and a bottom strand's is not, so
  filling a left 5′ overhang changes no base (the bottom strand just pairs
  it), filling a right one appends it, and chewing a left 3′ overhang back
  removes nothing of the sequence. Only trimming a left 5′ overhang moves
  every position, which is why `mapPositionThrough` has a case for it
  (`bluntShift`) and the caret keeps its place on the bases.
- **Both ends at once.** Blunting one end is done on the bench by blunting
  before the second cut, and the app follows the same order: digest, open,
  blunt, digest again. An end-by-end control would be a UI for a step
  nobody does.
- The blunted end forgets its enzyme. "EcoRI blunt" would read as an end
  EcoRI made, which it is not, and the filled-in bases are in the sequence
  to say where it came from.

Changed 2026-09-24 (#72): **a line of ours is ours only if it can be read.**
The reader took a readable line out of the comments and left a damaged one,
but the writer skipped every line with our prefix, so the damaged one
vanished on the next save; with a readable line beside it, the reader
dropped the damaged one too. `isOwnComment` (`ownComments.ts`) now decides
for both, by parsing: a line that parses is regenerated from the document,
one that does not is an ordinary comment both ways. FASTA's header tags
follow the same rule, which reverses the earlier choice to drop a damaged
ends tag: it is not read half-way, and it is no longer lost either.

Added 2026-10-06 (#160): `SeqDocument.delete` keeps a CDS in frame
(`src/core/features/codonStart.ts`). It counts the bases the deletion takes
off the front of the reading: the left end of the first segment for a forward
CDS, the right end of the last for a reverse one, on through every segment
the deletion removes whole, across the origin of a circle. Cuts in the middle
or at the far end change nothing. `codon_start` then advances to the first
whole codon left; frame 1 is the default and its qualifier is dropped rather
than written as `1`. `replace` and a paste over a selection delete through
the same path (a replacement keeps the first bases of its range, so only
the bases it actually removes count). The importer's own workaround went.

Added 2026-10-06 (#163): the same `advanceCodonStart` step also marks the
5′ end partial (`partialStart` on the first segment, `partialEnd` on the
last of a reverse CDS), as `extractRange` does, so what is left reads from
its first whole codon instead of treating a TTG/CTG there as `M`.

Added 2026-10-06 (#162): `extractRange`, under copy and every cloning
product, does the same for a CDS whose reading start falls outside the
region (counting the bases of the reading that precede it, then `advanceCodonStart`). It also lists the
pieces of a feature inside a region across the origin in the feature's own
order, not the region's, so a feature cut by the region's gap keeps the
order of its `join`.

Added 2026-10-06 (#169): a region that keeps both ends of a feature but drops
bases from its middle gives one feature per kept stretch, not a `join`
across the gap, whose far side would read out of frame (the usual case is a
digest backbone, or a region across the origin of a circle, whose gap is
inside a CDS). Decisions:

- A drop is a gap in the feature's own bases: pieces are laid end to end
  along the feature's range segments, and two consecutive pieces with bases
  between them split. A gap that is the source's own space between join
  segments does not count, nor does the origin inside a wrapping segment, so
  an intron-style `join` that is kept whole stays one feature, and a source
  join that loses a middle stretch splits at that drop only (three or more
  stretches give that many features). A whole-circle region drops nothing,
  but see #174 below.
- Each stretch keeps the name, type, strand and qualifiers, with a new id.
  `/translation` is removed, since the stored protein is the whole one's
  and would disagree with every piece. Stretches are listed in the
  feature's own order. The cut sides are marked partial (`<`/`>`).
- A CDS stretch counts the bases of the reading before its first base
  (the low end for forward, the high end for reverse) and goes through
  `advanceCodonStart`, so a reverse stretch's 5′-partial is `partialEnd` on
  its last range. The same count replaces the old per-region helper; for a
  region that drops no middle it gives the same answer.
- Sites (`a^b`) keep the old behaviour and never split a feature.

Added 2026-10-07 (#174): a whole-circle region that starts inside a
feature (a single-cutter digest, or copying the whole circle from a point
inside one) drops none of its bases, yet puts them at the two ends of the
linear product. Kept as one `join(…end, start…)`, the feature skipped
whatever was later ligated at the cut, so a CDS with an insert in its
MCS still translated as the intact protein (pydna drops such a feature
on `looped()`; we keep the pieces). Decisions:

- Two consecutive pieces of a feature whose bases follow each other in
  the source (round the circle, so a segment across the origin counts)
  but do not abut in the extract split, exactly as a #169 drop does: cut
  sides partial, `/translation` removed, each CDS stretch with its own
  `codon_start`. A join's own gap, or two source segments that meet at the
  cut, are told apart by source position, not by segment.
- This includes a feature across the origin of a circle taken whole from
  0, which used to stay a `join` across the product's ends.
- Ligation re-joins nothing: closing the cut vector on itself (the empty
  vector) gives the two partial pieces side by side, not the feature it
  was cut from. Superseded by #181 and #182 below.

Added 2026-10-07 (#181): ligation joins the two pieces back into one
feature wherever a junction (the circular product's origin included)
brings them together again. Pieces carry no link to the feature they were
cut from, so the test is on what they are: the left one's last segment
ends at the junction and the right one's first starts there, both marked
partial at that side; same type, name, strand and joining; the same
qualifiers but for `/codon_start` and the located ones (#179 gave each
piece its own); and for a CDS, the 3' piece's `/codon_start` is the frame
the 5' piece leaves off in, so a junction that gains or loses bases (a
fill-in, a different overhang) leaves them apart. The joined feature keeps
the outer partial marks, the 5' piece's qualifiers and the 3' piece's
located ones. `/translation` is not restored: the pieces no longer hold
it, and whether the original had one cannot be told from them.

Added 2026-10-07 (#182): superseded. Joining by what the pieces look like
missed a `join` cut in its intron, joined pieces across a junction that
had lost bases, and could not bring back a `/transl_except` whose codon
the cut split. Each piece now carries a record of the feature it was cut
from, and ligation joins pieces only when they meet again exactly as they
were cut, restoring the feature whole, `/translation` and located
qualifiers included. See item 73.
