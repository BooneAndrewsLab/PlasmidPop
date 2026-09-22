# Simulated cloning

The **Cloning** tab cuts the document with restriction enzymes and
describes the resulting fragments end by end. Below the digest, a picker
chooses one of three reactions to build something with: **Ligation**, which
joins fragments you have collected by their overhangs, **Golden Gate**, and
**Gibson**. They are alternatives, so one is shown at a time and the choice
is remembered. Whichever you use, the product opens as a new document with
the features of its parts.

The digest belongs to the document in front of you. The three reactions do
not: they work across the open tabs, and two of them never look at the
document you happen to be reading.

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

Every fragment is also drawn on the map and in the sequence view while the
tab is open, in the dashed preview colour (see
[Previews](03-viewing.md#previews)), with a tick where each cut falls.
Nothing is added to the document. Hovering a row draws that one fragment as
a solid arrow instead, which is how you see at a glance which piece is the
backbone and which is the insert — the sizes alone cannot tell you where
they are.

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
them, since a circle has no ends; reverse-complementing swaps them and moves
the sequence to the other strand's window, which is a few bases longer or
shorter (see [Editing the sequence](04-editing.md#whole-sequence-operations)).

## Ligation

**Add** moves a fragment to the **Ligation** list. The list is shared by
every open tab and is kept in the browser, so it survives closing every tab
and reloading the page: a ligation you set up on Friday is still there on
Monday. The usual workflow is:

1. Choose **Ligation** under the digest.
2. Open the vector, tick the enzymes, add the backbone fragment.
3. Open the file with the insert (it gets a tab of its own), tick the same
   (or compatible) enzymes, add the insert fragment.
4. Arrange the parts: **⇄** flips a fragment (reverse complement, ends
   swapped), **↑ ↓** reorder, **✕** removes.
5. Between consecutive parts a junction line shows **✓** when the ends can
   be ligated, **✕ ends do not match** when they cannot. With **Circular
   product** ticked there is also a closing junction from the last part back
   to the first.
6. Give the product a name (or keep the suggested one) and click
   **Assemble**. It is enabled only when every junction is compatible.

The product opens as a new circular or linear document carrying the parts'
features, and the assembly list is cleared. It is kept in the browser like
any other document; download it to get a file.

Ends are compatible when both are blunt, or when they have the same kind of
overhang with complementary bases. A PstI end will not join an EcoRI end,
and a BamHI end will join a BglII end (both leave `GATC`).

## Golden Gate

Golden Gate is a different reaction; choose it in the picker under the
digest. Every part carries the same Type IIS enzyme's site at
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

**_N_ pieces left out** expands to say what was discarded and why. In a
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

## Gibson

Gibson assembly has no enzyme and no site. Each piece is made to end in the
same 15–40 bases the next one starts with — by the tails of the primers it
was amplified with, usually — and in the tube an exonuclease, a polymerase
and a ligase join them. The product is seamless: the shared stretch appears
once, and there is no scar to design around.

So the panel asks only what is in the tube. Choose **Gibson** in the picker,
then:

1. Open each part in its own tab: the linearised (or PCR-amplified) vector
   and the inserts. A circular document is left out, because it has no ends
   to join by — digest or linearise it first.
2. Untick anything that is not in the reaction. Set **Overlap** to the
   shortest homology to accept; 15 bp is the default and what NEB's protocol
   asks for.
3. The panel finds the longest shared stretch between the end of one part
   and the start of another, follows the chain, and reports the order. A
   part whose ends only fit the other way round is turned around for you and
   says **(flipped)**.
4. Each junction line gives the length of the homology and its melting
   temperature. The reaction is held at 50 °C, so a junction under 48 °C is
   marked: the homology is there, but it may not anneal.
5. **Assemble** opens the product as a new document with every part's
   features. Untick **Circular product** for a linear one.

One part on its own is an assembly too, if its two ends share homology: that
is how a PCR product is circularised.

If two parts could follow the same one, or nothing follows a part, the panel
says which and assembles nothing. Homology that is unique to each junction is
what makes a Gibson design work, and a set that is ambiguous on paper is
worth seeing before it is ambiguous in the tube.

## Not yet

Partial digests, dephosphorylation, and ambiguity codes in overhangs (an
`N` never pairs). Gibson does not check for homology _inside_ a part that
could anneal as readily as the junction it was designed for, does not take
parts from the assembly list above it, and models neither the length of the
chew-back nor the polymerase's fill-in, so a very long part with a very short
overlap may fail on the bench while looking right here.
Golden Gate takes whole open documents rather than fragments from the
assembly list, will not mix two enzymes in one reaction, and does not check
that a set of overhangs would misligate in the tube. Nothing fills in or
chews back an overhang yet (no Klenow or T4 polymerase blunting), the
circular map does not draw the ends, and a FASTA export does not carry
them.
