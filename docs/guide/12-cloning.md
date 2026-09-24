# Simulated cloning

Cloning happens in two places, split by what each thing works on.

The **Cloning** tab in the sidebar is about the document in front of you,
and draws on its views. Its picker chooses one of three: **Digest**, which
cuts the document with restriction enzymes and describes the fragments end
by end, **PCR**, which amplifies a stretch of it with two primers, and
**Mutate**, which designs the primers for a point mutation, insertion or
deletion. The fragments and PCR products you keep go on the
[shelf](#the-shelf).

The **[Bench](#the-bench)**, a tab of its own beside **Files** in the tab
strip, is where the parts are joined, from any number of documents:
**Ligation**, which joins shelf fragments by their overhangs, **Golden
Gate**, **Gibson** (with the In-Fusion and NEBuilder primer design), and
**Gateway**. Beside the reaction it draws what the reaction would make, and
a digest to check it by.

In both places the reactions are alternatives, so one is shown at a time
and the choice is remembered. Whichever you use, the product opens as a new
document with the features of its parts.

## Digest

The digest uses the enzymes **ticked in the Enzymes tab**, less any site
the document's own methylation blocks (see
[Where the DNA was grown](07-enzymes.md#where-the-dna-was-grown)). Tick the enzymes
you would put in the tube, then come back. It follows the ticks alone: the
toolbar's **Cut sites** toggle only hides the sites drawn in the views, so a
decluttered map still digests with everything ticked. Fragments are listed largest
first, each with:

- its **length** (click it to select the fragment in the views) and range;
- its two **ends**: the enzyme that made the cut, whether the end is blunt
  or has a 5′ or 3′ overhang, and the overhang bases;
- the **features** it carries;
- **Add**, which puts it on the [shelf](#the-shelf), and **Open**,
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
The last line of the Cloning tab counts what is on the shelf, so you see it
land, and **Open the Bench** takes you to it.

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
decided is already in those two sequences. They stay in the boxes while you
look at the digest, another sidebar tab or another document, and come back
with this one; Mutate's change does the same.

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
- **Degenerate primers work.** An ambiguity code in a primer (`N`, `R`,
  `NNK` for a codon library) pairs with every base it stands for, and is
  written into the product as the code it is, so a library made with Mutate
  amplifies here. Its melting temperature is that of the molecule in the mix
  that matches the template.
- **A mismatch is a mutation, not an error.** The product is the primers'
  sequence, not the template's, so a deliberate mismatch is carried into
  every copy. That is site-directed mutagenesis, and it needs nothing else
  here: design the primer with the change in it and amplify.
- **The product lists what it would be**: its length, the stretch of
  template it copies, and whether it runs over the origin. **Show** draws it
  and its two primers on the map and in the sequence view (see
  [Previews](03-viewing.md#previews)), a primer's mismatches marked on it;
  **Open** opens it as a document, with
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
that would give a longer product is reported and not built. A Taq product's
length counts its added A, as the length of any fragment counts the overhang
its top strand carries: a 500 bp amplicon is listed, drawn and shelved as 501.

**5′-phosphorylated primers**: oligos are made without a 5′ phosphate unless
ordered with one, and a PCR product's 5′ ends are its primers'. So a
shelved product is marked dephosphorylated (see
[Ligation](#ligation)) unless this is ticked, and will not ligate into a
dephosphorylated vector — as on the bench.

**Primer dimers.** When the 3′ end of one primer pairs with the other, or
with a second copy of itself, over more than 4 bases, the panel says so:
a polymerase can extend the pair into a short product of its own.

## The Bench

The Bench is the tab after **Files** in the tab strip; its count is the
number of parts on the shelf. It stays in the strip while the shelf holds
anything, even with every document closed. It has three columns:

- the **shelf** on the left;
- the **reaction** in the middle: **Ligation**, **Golden Gate**, **Gibson**
  or **Gateway**, picked at the top. What each is set to — the parts left
  out of its tube, its enzymes, the tabs it uses, a name you have started
  typing — stays as it was while you look at a document, and across a
  reload;
- **what it makes** on the right, once the parts go together: the product's
  map, and **Check by digest**, a gel lane of the product cut with one
  enzyme. The enzyme list offers every enzyme that cuts the product between
  once and six times, the clearest lane first — the order the Enzymes tab's
  [band separation](07-enzymes.md) sort uses — and the product's own
  methylation is allowed for. It is the digest to run on a miniprep before
  sending it for sequencing.

The phone reader has no Bench.

## The shelf

**Add** in the digest, and **Shelve** under a PCR product, put a part on the
**shelf**. The shelf belongs to the Bench rather than to one reaction:
Ligation joins its fragments, and Golden Gate and Gibson take them into the
tube beside the open documents. A shelved part is a copy, sequence, ends and
features, so it does not need the file it came from: it survives closing
every tab, deleting the file and reloading the page. Fragments you collected
on Friday are still there on Monday.

On the Bench each part shows its name, length and ends. **−P** dephosphorylates it (see
below), **⇄** flips a fragment (reverse complement, ends swapped), **↑ ↓**
reorder, **✕** removes, and **Clear shelf** empties it. The order and the flips are what Ligation joins by; Golden
Gate and Gibson work out their own order and ignore them. A reaction leaves
the shelf as it is, so a vector cut once can take one insert after another.

**Undo** and **Redo** in the toolbar, and **Ctrl+Z** / **Ctrl+Shift+Z**,
undo and redo changes to the shelf while the Bench is in front, including
parts added from the Cloning tab. The shelf keeps a history of its own:
undoing on the Bench never touches a document, and a document's undo never
touches the shelf. Hover **Undo** to see what it will take back.

## Site-directed mutagenesis

**Mutate** designs the two primers for a change to the document in front of
you, and opens the plasmid they would make.

1. Select the bases to change, or put the cursor where new bases go.
2. Type what they become in **Change to** (for a cursor, **Bases to
   insert**). Leave it empty to delete the selection. Ambiguity codes are
   accepted, for a degenerate codon.
3. Choose the design:
   - **Back to back** is NEB's Q5 site-directed mutagenesis: the primers
     point away from each other and meet at the change, which rides on the
     forward primer's 5′ end (a long insert is split between the two). Each
     primer's annealing part grows until it reaches 60 °C. Amplify the
     whole plasmid, then phosphorylate, ligate and digest the template
     (KLD).
   - **Overlapping** is Agilent's QuikChange: two complementary primers
     with the change in the middle, grown until they reach 78 °C by
     Agilent's formula. Copy the plasmid round, digest the template with
     DpnI, and transform.
4. The panel names the change (`A801G`, `Δ1,001–1,030`, `+GACTAC… after
1,500`) and what it does to every CDS it falls in — the residue changed
   (`lacZ K12R`), a silent change, or a frameshift — read with the
   feature's own genetic code and strand. Each primer is written 5′ to 3′
   as you would order it, new bases in upper case, with **Copy**.
5. **Open mutant** opens the plasmid with the change made. It opens as the
   template renamed, with the change as its one edit, so the edit marks show
   it and **Undo** takes it back.

A design that cannot reach its temperature within 60 bases says so.

## Ligation

Ligation joins the shelf's fragments in the order they stand on the shelf.
The usual workflow is:

1. Open the vector, tick the enzymes, add the backbone fragment.
2. Open the file with the insert (it gets a tab of its own), tick the same
   (or compatible) enzymes, add the insert fragment.
3. Open the **Bench** and choose **Ligation**. Every shelf fragment is in the
   ligation to begin with; untick one to leave it out, for instance a piece
   you collected for a Gibson.
4. Arrange the parts on the shelf. Between consecutive parts in the
   **Ligation** list a junction line shows **✓** when the ends can be
   ligated, **✕ ends do not match** when they cannot. With **Circular
   product** ticked there is also a closing junction from the last part back
   to the first.
5. Once every junction is compatible, a **Product** line says what the
   ligation would make: its length, whether it is circular, and the
   features it carries. Give the product a name (or keep the suggested one)
   and click **Assemble**.

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

Golden Gate is a different reaction; choose it on the Bench. Every part carries the same Type IIS enzyme's site at
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
   It reports the order it found, the overhang each part joins on, and a
   **Product** line with the circle's length and the features it carries. A part with no
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

So the panel asks only what is in the tube. Choose **Gibson** on the Bench,
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
   temperature, and a **Product** line under them the length, topology and
   features of what would come out. The reaction is held at 50 °C, so a junction under 48 °C is
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

### In-Fusion and NEBuilder: designing the insert primers

In-Fusion (Takara) and NEBuilder HiFi (NEB) work the way Gibson does, so
the reaction is the one above; what they need is the two primers that put
the vector's ends on the insert. **Design insert primers**, under the Gibson
panel, makes them.

1. Linearise the vector — digest it, or amplify it by inverse PCR — and
   open it in a tab.
2. Open the template to amplify the insert from.
3. Choose **In-Fusion** (15 bases of homology) or **NEBuilder HiFi** (20),
   then the two tabs, then the **Insert**: the template tab's selection, if
   it has one, any of its features, or, for a linear template, all of it.

Each primer is the vector's end in upper case followed by the bases that
anneal to the template, grown until they melt at 60 °C. The panel then
_runs_ the design — amplifies the insert with those primers and assembles
the amplicon with the vector — so what it shows is the circle they would
really make, not a promise. **Open product** opens it.

It warns when the vector has sticky ends, and when the primers would
amplify something else from the template as well.

## Gateway

Gateway is recombination, not cutting and joining: an integrase pairs two
att sites that share a core and swaps the DNA on either side. Two sites on
one plasmid and their partners on another therefore exchange the stretches
between them, which is why every reaction makes two circles.

- **BP**: an attB substrate × a donor vector (attP) → an **entry clone**
  (attL) and a byproduct (attR).
- **LR**: an entry clone (attL) × a destination vector (attR) → an
  **expression clone** (attB) and a byproduct (attP).

**The att sites are read from the annotation the files carry.** A real
donor, entry or destination vector labels them (`attP1`, `attR2`, `attL5`,
`attP2r`), and so does a PCR product once its attB tails are annotated.
Nothing is bundled and nothing is guessed from the sequence: if a plasmid
does not label its sites, the panel says so, and you can annotate them
yourself (see [Features](05-features.md)).

1. Open both plasmids, each in its own tab.
2. On the Bench choose **Gateway**, then **BP** or **LR**. Each picker lists every open
   tab with the att sites it annotates.
3. The panel recombines them and describes the clone. **Open clone** opens
   it; **Open byproduct** opens the other circle.

The numbers are what pair: `attL1` recombines only with `attR1`, never with
`attR2`, and the panel says so rather than guessing when they do not match.
The crossover point is found from the two plasmids themselves — partner
sites share a core, so the longest stretch they have in common is it — and
each recombinant site is half of each parent's, named for what it has
become.

It also tells you:

- that the **ccdB** cassette leaves on the byproduct, so the clone that
  grows in an ordinary strain is the one you want;
- when a pair shares less than a full att core, which usually means a site
  is annotated over only part of its length;
- when a **tag in the backbone reads out of frame** into the insert across
  an att site — the commonest Gateway mistake, and one the sequence can
  answer.

A vector written on the other strand from the insert — its att sites
annotated on the reverse strand where the insert's are on the forward — is
the same plasmid read the other way round, and recombines the same. One
pair of sites on the same strand and the other on opposite strands is not
an exchange, and the panel says so.

A linear attB substrate (a PCR product) gives a clone but no byproduct
circle: its two flanks come away as loose ends and are lost.

One pair of sites at a time, so a multisite LR is done a fragment at a time.

## Not yet

How much more readily a short product amplifies than a long one is not
modelled beyond the order the products are listed in, and a mismatched
primer's first-cycle temperature leaves out what the mismatched stretch
still contributes. Gibson does not model the chew-back itself, only the
length rules above, and Golden Gate's overhang warnings follow design rules
rather than measured ligation fidelity. In-Fusion and NEBuilder differ here only in how much homology
they ask for; their exonucleases are not modelled separately. Gateway reads
att sites from a file's annotation rather than finding them by sequence, and runs one pair at
a time, so a multisite LR takes several passes.
