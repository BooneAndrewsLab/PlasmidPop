# 113. Golden Gate ends in the primer workspace

Issue #310, built 2026-10-28. The cloning mode of the primer workspace
(item 108 for the engine, item 107 for the workspace) designed
restriction-site primers and only warned on a Type IIS enzyme, so making a
Golden Gate part out of a gene meant typing the two oligos by hand — which
is what the cloning tutorial's NCBI exercise did. This is an option inside
that same mode, not a screen of its own: the insert chooser, the padding
setting, the annealing-part designer, the warnings and the Results actions
are the ones already there, and what changes is the shape of the two tails
and what Simulate runs.

Code: `src/core/cloning/goldenGateEnds.ts` (the engine),
`GoldenGateEnds.tsx` (step 3), `GoldenGatePartResult.tsx` (Results),
`Oligo.tsx` (lifted out of `CloningCandidates.tsx` so both panes draw an
oligo the same way), with the state in `cloningDesign.ts`.

## The geometry comes from the enzyme table

A primer is `padding · site · spacer · overhang · annealing part`, the site
pointing into the part. The spacer's length and the overhang's are read off
the enzyme's own row (`typeIISLayout`), never written down: for a row whose
cuts lie past the site, the spacer is `min(cutTop, cutBottom) − site
length` and the overhang `cutBottom − cutTop`. That gives BsaI
`GGTCTC(1/5)` and BsmBI one spacer base and four overhang bases, BbsI
`GAAGAC(2/6)` two and four, SapI `GCTCTTC(1/4)` one and three — the numbers
the issue quotes, but taken from the table, so an imported REBASE row is
read the same way. A row the table cannot express is not offered and
`whyNotGoldenGate` says which case it is: a double cutter (BcgI) loses an
end; a blunt Type IIS cutter (MlyI) has no overhang to join on; a 3′
overhang cannot be written as a part's end here (the reaction exists, but
the part's bases and the primer's would no longer be the same stretch, and
nothing in the app assembles one); a site with an ambiguity code cannot go
on an oligo at all. An enzyme the table lists cutting 5′ of its site is
turned around first, as item 108's tails turn one.

## The overhangs

Three sources, one pair of fields: the bundled standards' positions
(`standardOverhangChoices` over `BUNDLED_STANDARDS`, so the MoClo plant CDS
part is `AATG`…`GCTT` and the Yeast Toolkit's types are there too), the
pair the destination's own cut ends ask for (`destinationOverhangs`: the
backbone is the longest piece the enzyme releases from the plasmid in
front, and the part's left overhang is that piece's right one), or four
bases typed. Both are written as they read on the top strand; the reverse
primer carries the right one reverse-complemented, which the page says.

**The overlap rule.** `AATG` is `A` plus a start codon, so a CDS beginning
`ATG` must not have it written twice. `overlapAtStart` therefore reads the
overhang as already spelling the part's first bases — but only in two
cases, never by coincidence: the start codon (the overhang ends `ATG`, the
part begins `ATG`, and the start codon is being kept), or an overhang the
part's first bases spell whole, which is a region selected with the fusion
site already on it. `overlapAtEnd` is the same at the other end for a stop
codon the overhang spells. A maximal-overlap rule was tried first and
dropped: the tutorial's CDS happens to end `…TT` and its right overhang is
`TTCG`, so it silently ate two bases of the part. The bases the overlap
covers are not in the body the annealing parts are chosen on, which is why
the forward primer anneals from the base after the start codon — exactly
what the hand-typed oligo did.

**The frame.** The usual standards put a fusion site on a codon boundary,
so the check is that the bases from the first coding base to the start of
the right overhang are a whole number of codons (`FrameCheck`). It is
reported, not enforced, and it is skipped when the part keeps its own stop
codon, since nothing is fused after that.

## Warnings

The shapes are item 108's `CloningWarning`, with five kinds added to its
union (`internalSite`, `overhang`, `frame`, `ambiguous`, `destination`):

- **internalSite** (red): the enzyme, or the second one in the tube, has a
  site inside the part the reaction releases — including one the overhang
  and the part spell between them at the junction, since that site is in
  the part and would be cut. Nothing is offered silently: the design is
  made, said to be broken, and the simulated assembly fails too.
- **extraSite** (red, item 108's): a site in a tail, beyond the two meant.
  The free padding and spacer bases are drawn to avoid one (`buildTail`,
  reused), so this is the case that cannot be padded away.
- **overhang** (amber): `overhangWarnings` from `goldenGate.ts`, the rules
  the Bench's assembly is judged by (#11, #144), run over the two overhangs
  and the distinct overhangs the rest of the tube offers. The tube's own
  copies of these two are the junctions the part fills, not a clash, so
  they are left out; a duplicate between two _other_ parts is the
  assembly's to report, which it does.
- **frame**, **ambiguous**, and item 108's `paddingRaised`, `annealing`,
  `junctionSite`, `notSpecific` and `dimer`, unchanged.

## Simulate

`pcr` on the insert's own tab, then `goldenGate` on the destination, the
amplicon and whatever else is in the tube, and `recordGoldenGate` for the
lineage (item 52), as the Bench's panel does; the product opens as a
scratch document (item 110) with the enzyme ticked through `goldenGateSeed`
(item 112), and is named `destination-insert` to match cloning mode's
`vector-insert`. The tube is picked for the user rather than ticked:
`tubeDocuments` takes every other open DNA tab the enzyme releases a usable
piece from, which leaves out the gene's own record and the vector. When
there is no destination, when the enzyme opens nothing in it, or when the
set cannot close for want of other parts, the PCR product comes back alone
with a sentence saying which (`GoldenGatePartSimulation.missing`), as the
issue asked.

## What was left out

- **No second part designed at once**, and no plan across a standard's
  positions: that is the Modular panel's job (item 76), and this designs
  the one part in front of the user.
- **No fidelity score** on the Design page. The ligase table (#68) is
  imported for the Bench; the two overhangs of one part are judged by the
  design rules only, and the score comes when the assembly is run.
- **No 3′-overhang Type IIS enzyme**, and no enzyme whose site holds an
  ambiguity code — see the geometry above.
- **No shortcut key**: the option is a two-button switch inside step 3.
- The **region is not re-cut to the frame**: the frame check says how many
  bases are wrong and leaves the region to the user.

## Tests

`goldenGateEnds.test.ts`: the geometry against the four enzymes' rows and
against made-up blunt, 3′, double-cutting and leftward rows; the overlap
rule including the coincidence it refuses; the destination's pair read off
`pGG-Destination`; the part rebuilt from a plain gene so that it is
`GG-cds.gb`'s own part and the assembly comes to the tutorial's 3,118 bp;
the stop and start options; the out-of-frame warning; the internal site for
either enzyme in the tube; palindromic, duplicate and one-base-apart
overhangs; ambiguity codes; a region that wraps the origin; a reverse-strand
feature; a region too short; and the three "only the PCR" paths.
`cloningDesign.test.ts` for the page's helpers and `CloningDesign.test.tsx`
for the workspace driven as a user would, including Simulate opening the
circle. `tutorialFiles.test.ts` holds the NCBI exercise to the numbers the
tutorial prints (PCR 361 bp, part 335 bp, product 2,848 bp) and skips
without the gitignored record.
