# Simulated cloning

The **Cloning** tab cuts the document with restriction enzymes, describes
the resulting fragments end by end, and lets you collect fragments, from
this file and others, into a ligation. The product opens as a new document
with the features of its parts.

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
every open tab, so the usual workflow is:

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

## Not yet

Gibson and Golden Gate assembly from primers or fragment sets, partial
digests, dephosphorylation, ambiguity codes in overhangs (an `N` never
pairs), and keeping the assembly list across page reloads. Nothing fills in
or chews back an overhang yet (no Klenow or T4 polymerase blunting), the
circular map does not draw the ends, and a FASTA export does not carry them.
