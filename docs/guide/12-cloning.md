# Simulated cloning

The **Cloning** tab cuts the document with restriction enzymes and
describes the resulting fragments end by end. Under the digest is the
**shelf**, where fragments you collect wait for a reaction, and under that a
picker chooses one reaction to build something with: **PCR**, which
amplifies a stretch of this document with two primers, **Ligation**, which
joins shelf fragments by their overhangs, **Golden Gate**, and **Gibson**. They are alternatives, so one is shown at a time and the choice
is remembered. Whichever you use, the product opens as a new document with
the features of its parts.

The digest belongs to the document in front of you, and so does PCR unless
you pick another tab as its template. The other three do not: they work
across the open tabs and the shelf, and two of them never look at the
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
- **Add**, which puts it on the [shelf](#the-shelf) below, and **Open**,
  which opens it as a document of its own.

An uncut linear molecule is one fragment with the ends the molecule already
has; an uncut circular molecule gives nothing to work with.

**Partial digest** lists every piece a digest that misses some of the sites
can give, not only the complete digest's: each stretch from one cut to any
later one, with the sites between left uncut, and on a circle the whole
molecule opened at each single site. It is how an insert is cut out when the
enzyme also cuts inside it. Each piece says how many sites it leaves uncut
(none for a complete digest's). The count grows fast — two sites give 4
pieces on a circle, 35 give over a thousand — so beyond 200 the list keeps
the pieces that miss the fewest sites, which are what a partial digest mostly
gives, and only the piece under the pointer is drawn on the views.

Every fragment is also drawn on the map and in the sequence view while the
tab is open, in the dashed preview colour (see
[Previews](03-viewing.md#previews)), with a tick where each cut falls.
Nothing is added to the document. Hovering a row draws that one fragment as
a solid arrow instead, which is how you see at a glance which piece is the
backbone and which is the insert — the sizes alone cannot tell you where
they are.

**Click a fragment in either view to put it on the shelf**, which is what
**Add** in its row does. On the map that is the thin dashed ring just inside
the backbone; in the sequence view it is the band outside the feature lanes.
The shelf sits above every reaction, so you see it land whichever reaction
is picked.

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

On the circular map, where a linear molecule is an open ring, both tips are
marked in the cut-site colour and the ends are named under the length in the
middle.

Digesting such a molecule again gives its outer fragments the ends it came
with, so a piece can be cut, opened and cut again without losing track of
what will ligate to what.

The ends are saved with the document. GenBank has nowhere to put them, so
they travel as a comment line of ours (`PlasmidPop-ends: ...`) that other
software ignores and PlasmidPop reads back; FASTA carries the same in its
header, and SnapGene files bring their own overhangs with them (see
[Files and storage](02-files.md)).

Editing the molecule's tip — typing over an overhang base, deleting the first
or last bases, pasting at either end — leaves an end that is no longer the
one the enzyme made, so that end goes back to being a plain blunt one. An
edit in the middle leaves both ends alone. Making the molecule circular drops
them, since a circle has no ends; reverse-complementing swaps them and moves
the sequence to the other strand's window, which is a few bases longer or
shorter (see [Editing the sequence](04-editing.md#whole-sequence-operations)).

### Blunting the ends

To join an end to one it does not match — an EcoRI end to a SmaI one, say —
make it blunt first. With a sticky-ended linear molecule open, the edit bar
offers two ways, as the bench does:

- **Blunt (fill in)** is Klenow or T4 DNA polymerase: a 5′ overhang is filled
  in, so its bases become base pairs and the molecule grows by them where
  they were on the other strand, and a 3′ overhang is chewed back.
- **Blunt (trim)** is mung bean nuclease: every overhang, 5′ or 3′, is
  removed.

Both ends are blunted at once, and features move with the bases. It is an
edit like any other, so **Undo** takes it back and the History names it. To
blunt one end only, do it before cutting the other: digest with the first
enzyme, **Open** the fragment, blunt it, then digest that with the second.
To put the blunted piece on the shelf, untick every enzyme: an uncut linear
document is one fragment, with the ends it has, and **Add** shelves it.

## PCR

PCR is where a part comes from. The other three reactions join pieces that
already exist somewhere; a PCR makes one that is in no file yet, because
what a primer carries at its 5′ end ends up in the product.

Choose **PCR** in the picker and paste the two oligos, written 5′ to 3′ as
you would order them. Nothing else is asked, because everything a designer
decided is already in those two sequences.

The template is the document in front of you. With more than one tab open,
**Template** picks another one instead, so an insert can be amplified out of
one plasmid while you look at the vector it is going into. Its products are
listed and can be opened or shelved, but they are not drawn: the views show
the document in front of you, and another molecule's positions would land in
the wrong places.

- **Only the 3′ end has to match the template.** A cloning primer is a 3′
  part that anneals and a 5′ tail that does not — a restriction site, a
  Gibson homology arm, a tag, a His stretch. The tail is copied into the
  product all the same. Under each box the panel says how long the oligo is,
  how much of it is tail, the melting temperature of the part that anneals
  and where it lands. A tailed or mismatched primer gets two temperatures:
  the first on the template, counting only the 3′ bases up to the first
  mismatch, and the second once the product — which carries the whole
  primer — is the template. The usual advice for such primers, a few cycles
  at the lower temperature before the rest at the higher, follows from the
  two.
- **The last 5 bases must match exactly**, as they must on the bench: a
  polymerase extends from the 3′ end, and a mismatch under it stops the
  reaction whatever the rest of the oligo does. Up to two mismatches further
  back are allowed.
- **A mismatch is a mutation, not an error.** The product is the primers'
  sequence, not the template's, so a deliberate mismatch is carried into
  every copy. That is site-directed mutagenesis, and it needs nothing else
  here: design the primer with the change in it and amplify.
- **The product lists what it would be**: its length, the stretch of
  template it copies, and whether it runs over the origin. **Show** draws it
  and its two primers on the map and in the sequence view (see
  [Previews](03-viewing.md#previews)); **Open** opens it as a document, with
  the template's features and a `primer_bind` feature for each oligo, tail
  and all. Clicking the previewed product in either view opens it too.
  **Shelve** puts it on the [shelf](#the-shelf) instead, the same molecule
  with blunt ends, ready for a ligation, a Golden Gate or a Gibson.
- **Upper case in the product means "not from the template".** The bases that
  came from the template are written in the case the template writes them
  (usually lower, in a GenBank file), so what is left in capitals is the 5′
  tails and any mismatch — the way a primer is written out in a paper.
- **More than one product** is what a real tube gives when a primer binds in
  more than one place. They are listed cleanest and shortest first, because
  an exactly-matched short amplicon out-competes the rest, and drawn as a
  gel so you can see whether the bands could be told apart — on the agarose
  percentage and beside the ladder chosen under it (see
  [The gel](07-enzymes.md#the-gel)).

Two primers pointing away from each other on a plasmid amplify the long way
round — inverse PCR, which is how a vector is linearised for a Gibson. It
needs nothing special here: it is simply the product that happens to be
nearly the whole molecule.

**Polymerase** chooses what comes out. A proofreading enzyme (Q5, Phusion,
Pfu) leaves the product blunt and reaches 20 kb; **Taq** adds one A to each
3′ end, which is what TA cloning joins by (a TA vector's single 3′ T
overhangs pair with them on the shelf), and is taken to reach 5 kb. A pairing
that would give a longer product is reported and not built.

**5′-phosphorylated primers**: oligos are made without a 5′ phosphate unless
ordered with one, and a PCR product's 5′ ends are its primers'. So a
shelved product is marked dephosphorylated (see
[Ligation](#ligation)) unless this is ticked, and will not ligate into a
dephosphorylated vector — as on the bench.

**Primer dimers.** When the 3′ end of one primer pairs with the other, or
with a second copy of itself, over more than 4 bases, the panel says so:
a polymerase can extend the pair into a short product of its own.

## The shelf

**Add** puts a fragment on the **shelf**, under the digest. The shelf belongs
to the whole tab rather than to one reaction: Ligation joins its fragments,
and Golden Gate and Gibson take them into the tube beside the open
documents. It is shared by every open tab and kept in the browser, so it
survives closing every tab and reloading the page: fragments you collected
on Friday are still there on Monday.

Each part shows its name, length and ends. **−P** dephosphorylates it (see
below), **⇄** flips a fragment (reverse complement, ends swapped), **↑ ↓**
reorder, **✕** removes, and **Clear shelf** empties it. The order and the flips are what Ligation joins by; Golden
Gate and Gibson work out their own order and ignore them. A reaction leaves
the shelf as it is, so a vector cut once can take one insert after another.

## Ligation

Ligation joins the shelf's fragments in the order they stand on the shelf.
The usual workflow is:

1. Open the vector, tick the enzymes, add the backbone fragment.
2. Open the file with the insert (it gets a tab of its own), tick the same
   (or compatible) enzymes, add the insert fragment.
3. Choose **Ligation** in the picker. Every shelf fragment is in the
   ligation to begin with; untick one to leave it out, for instance a piece
   you collected for a Gibson.
4. Arrange the parts on the shelf. Between consecutive parts in the
   **Ligation** list a junction line shows **✓** when the ends can be
   ligated, **✕ ends do not match** when they cannot. With **Circular
   product** ticked there is also a closing junction from the last part back
   to the first.
5. Give the product a name (or keep the suggested one) and click
   **Assemble**. It is enabled only when every junction is compatible.

The product opens as a new circular or linear document carrying the parts'
features; the shelf keeps its fragments. The product is kept in the browser
like any other document; download it to get a file.

Ends are compatible when both are blunt, or when they have the same kind of
overhang with complementary bases. A PstI end will not join an EcoRI end,
and a BamHI end will join a BglII end (both leave `GATC`). An ambiguity code
in an overhang pairs with any base it stands for: `N` with anything, `R`
with `A` or `G`.

**Dephosphorylation.** A ligase joins a strand only to a 5′ phosphate, which
a restriction enzyme leaves on every end. Treating a vector with a phosphatase
(CIP, rSAP) — **−P** on its shelf row — takes those phosphates away, so the
vector can no longer close on itself: its closing junction says **both sides
dephosphorylated** and Assemble stays off. An insert with its phosphates
still joins it, one strand at each junction, as on the bench. Two
dephosphorylated parts do not join each other at all. The treatment belongs
to the shelf part; a part you **Open** as a document does not carry it.

## Golden Gate

Golden Gate is a different reaction; choose it in the picker under the
digest. Every part carries the same Type IIS enzyme's site at
each end, pointing inwards, so cutting takes the sites away with the flanks
and leaves a four-base overhang the designer chose. Cutting and ligating
happen in one tube, and the overhangs, not you, decide the order.

The panel works that out:

1. Put the destination vector and every part in the tube. Anything open is
   one, each in its own tab, and so is anything on the [shelf](#the-shelf) —
   a piece already cut out of a plasmid goes in beside a file, and the list
   says which is which.
2. Choose the **enzyme** the parts were designed for. BsaI is the default;
   BsmBI, BbsI and SapI are there too, along with the other Type IIS
   enzymes in the table that leave an overhang. For parts made for two
   enzymes — a BsaI vector taking a BsmBI part, say — choose the second in
   **and**; both then cut everything in the tube, and a piece keeping
   either site is cut again.
3. Untick anything that is not in the tube. Everything is in it to begin
   with.
4. The panel digests each part, throws out the pieces that still carry a
   recognition site (those are cut again in a real reaction) and any piece
   with a blunt end, then follows the overhangs from one piece to the next.
   It reports the order it found and the size of the circle. A part with no
   site in it — a fragment off the shelf, usually — survives the digest
   whole and joins on the sticky ends it already has, which is what happens
   in the tube.
5. Name the product if you like, then **Assemble**. It opens as a new
   circular document with the parts' features.

When the parts assemble, the panel also checks the set of overhangs the
product joins on, as a designer would, and lists what could make a ligase
join the wrong ends:

- two overhangs one base apart, like `AATG` and `AATC`;
- an overhang one base (or none) from another one read the other way round,
  since a ligase pairs an overhang with the complement of the other's too;
- an overhang that is its own reverse complement (`GATC`), which lets a part
  join a copy of itself back to front;
- an ambiguity code, which pairs with every base it could stand for.

These are warnings: the product shown is the one the design intends, and
**Assemble** still works, but the tube may give other products as well.

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

1. Put the parts in the tube. Anything open is one: the linearised (or
   PCR-amplified) vector and the inserts, each in its own tab. So is anything
   on the [shelf](#the-shelf), which is how a backbone cut out of a plasmid
   joins an insert amplified from somewhere else — the two are one list with
   a tick each, and a piece off the shelf says so beside its size. A circular
   document is left out, because it has no ends to join by; digest or
   linearise it first.
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

When the parts assemble, the panel also lists what could make the tube give
something else:

- **Homology found elsewhere.** The exonuclease leaves each end as a long
  single strand, and it anneals to whatever pairs with it. So each
  junction's homology is looked for everywhere else in the tube, on both
  strands, in stretches as long as **Overlap**; a hit is named with its part
  and position, as somewhere a chewed-back end could anneal instead.
- **A short part.** A piece under 200 bp may be chewed away from both ends
  before it anneals; NEB suggests adding it in a 5-fold excess.
- **Short overlaps for the number of pieces.** NEB asks for 15–20 bp with
  two or three pieces and 20–30 bp with four to six.

These are warnings; **Assemble** still works.

If two parts could follow the same one, or nothing follows a part, the panel
says which and assembles nothing. Homology that is unique to each junction is
what makes a Gibson design work, and a set that is ambiguous on paper is
worth seeing before it is ambiguous in the tube.

## Not yet

How much more readily a short product amplifies than a long one is not
modelled beyond the order the products are listed in, and a mismatched
primer's first-cycle temperature leaves out what the mismatched stretch
still contributes. Gibson does not model the chew-back itself, only the
length rules above, and Golden Gate's overhang warnings follow design rules
rather than measured ligation fidelity.
