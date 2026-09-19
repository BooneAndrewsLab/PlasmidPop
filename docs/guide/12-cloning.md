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
- the **features** it carries.

An uncut linear molecule is one blunt-ended fragment; an uncut circular
molecule gives nothing to work with.

## Assembly

**Add** moves a fragment to the **Assembly** list. The list survives opening
another file, so the usual workflow is:

1. Open the vector, tick the enzymes, add the backbone fragment.
2. Open the file with the insert, tick the same (or compatible) enzymes,
   add the insert fragment.
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
pairs), and keeping the assembly list across page reloads.
