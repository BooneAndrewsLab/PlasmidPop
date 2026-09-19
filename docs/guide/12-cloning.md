# Simulated cloning

The **Cloning** tab cuts the document with restriction enzymes, describes
the resulting fragments end by end, and lets you collect fragments, from
this file and others, into a ligation. It also runs a
**Golden Gate** reaction (below) over the open documents. Either way the
product opens as a new document with the features of its parts.

## Digest

The digest uses the enzymes **ticked in the Enzymes tab**. Tick the enzymes
you would put in the tube, then come back. It follows the ticks alone: the
toolbar's **Cut sites** toggle only hides the sites drawn in the views, so a
decluttered map still digests with everything ticked. Fragments are listed largest
first, each with:

- its **length** (click it to select the fragment in the views) and range;
- its two **ends**: the enzyme that made the cut, whether the end is blunt
  or has a 5′ or 3′ overhang, and the overhang bases;
- the **features** it carries;
- **Add**, which puts it in the assembly below, and **Open**, which opens it
  as a document of its own.

An uncut linear molecule is one fragment with the ends the molecule already
has; an uncut circular molecule gives nothing to work with.

## Sticky ends on a document

A fragment you **Open**, and a linear ligation product, is a molecule whose
two strands stop in different places, and it is kept that way: the document
remembers each end's shape, overhang and enzyme. The toolbar says so next to
the length (`538 bp, linear · AlwNI 3′ CCA / BsaI 5′ ACCG`), and the sequence
view draws it:

- bases with nothing opposite them — the single-stranded part of the
  overhang — are washed over and have a gap on the complement line;
- where the other strand runs past the sequence instead, its bases are drawn
  just outside the first or last column.

Digesting such a molecule again gives its outer fragments the ends it came
with, so a piece can be cut, opened and cut again without losing track of
what will ligate to what.

The ends are saved with the document. GenBank has nowhere to put them, so
they travel as a comment line of ours (`PlasmidPop-ends: ...`) that other
software ignores and PlasmidPop reads back.

Editing the molecule's tip — typing over an overhang base, deleting the first
or last bases, pasting at either end — leaves an end that is no longer the
one the enzyme made, so that end goes back to being a plain blunt one. An
edit in the middle leaves both ends alone. Making the molecule circular drops
them, since a circle has no ends; reverse-complementing swaps them.

## Assembly

**Add** moves a fragment to the **Assembly** list. The list is shared by
every open tab and is kept in the browser, so it survives closing every tab
and reloading the page: a ligation you set up on Friday is still there on
Monday. The usual workflow is:

1. Open the vector, tick the enzymes, add the backbone fragment.
2. Open the file with the insert (it gets a tab of its own), tick the same
   (or compatible) enzymes, add the insert fragment.
3. Arrange the parts: **⇄** flips a fragment (reverse complement, ends
   swapped), **↑ ↓** reorder, **✕** removes.
4. Between consecutive parts a junction line shows **✓** when the ends can
   be ligated, **✕ ends do not match** when they cannot. With **Circular
   product** ticked there is also a closing junction from the last part back
   to the first.
5. Give the product a name (or keep the suggested one) and click
   **Assemble**. It is enabled only when every junction is compatible.

The product opens as a new circular or linear document carrying the parts'
features, and the assembly list is cleared. It is saved to the browser like
any other document; use Save to write it to a file.

Ends are compatible when both are blunt, or when they have the same kind of
overhang with complementary bases. A PstI end will not join an EcoRI end,
and a BamHI end will join a BglII end (both leave `GATC`).

## Golden Gate

Golden Gate is a different reaction and has a section of its own at the
bottom of the tab. Every part carries the same Type IIS enzyme's site at
each end, pointing inwards, so cutting takes the sites away with the flanks
and leaves a four-base overhang the designer chose. Cutting and ligating
happen in one tube, and the overhangs, not you, decide the order.

The panel works that out:

1. Open the destination vector and every part, each in its own tab.
2. Choose the **enzyme** the parts were designed for. BsaI is the default;
   BsmBI, BbsI and SapI are there too, along with the other Type IIS
   enzymes in the table that leave an overhang.
3. Untick any open document that is not in the tube. Everything open is in
   it to begin with.
4. The panel digests each part, throws out the pieces that still carry a
   recognition site (those are cut again in a real reaction) and any piece
   with a blunt end, then follows the overhangs from one piece to the next.
   It reports the order it found and the size of the circle.
5. Name the product if you like, then **Assemble**. It opens as a new
   circular document with the parts' features.

**Pieces left out** expands to say what was discarded and why. In a
well-designed set that is the vector's stuffer and each part's two flanks.

A part goes in whichever way round its overhangs demand, so a part ordered
back to front is turned around for you and the order says **(flipped)**
beside it. If two parts offer the same
overhang, or none offers the one the reaction has reached, the panel says
so rather than guessing: Golden Gate needs every overhang to be distinct,
and an ambiguous set is a design problem worth seeing.

The product is always circular, and always the whole set: a reaction that
would use only some of the parts is reported as a failure, not quietly
assembled from what fits.

## Not yet

Gibson assembly from primers or fragment sets, partial digests,
dephosphorylation, and ambiguity codes in overhangs (an `N` never pairs).
Golden Gate takes whole open documents rather than fragments from the
assembly list, will not mix two enzymes in one reaction, and does not check
that a set of overhangs would misligate in the tube. Nothing fills in or
chews back an overhang yet (no Klenow or T4 polymerase blunting), the
circular map does not draw the ends, and a FASTA export does not carry
them.
