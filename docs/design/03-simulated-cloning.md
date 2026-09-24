# 3. Simulated cloning

Done: restriction-ligation, Golden Gate and
Gibson. The
Cloning sidebar tab digests the document with the enzymes ticked in the
Enzymes tab (`digest` in `src/core/cloning/digest.ts`: fragments with
both ends described as blunt / 5′ / 3′ plus the overhang bases) and lets
fragments be collected into an assembly that survives opening another
file, so vector and insert can come from different documents. Parts can
be flipped and reordered; every junction is checked (`endsCompatible`,
`assemblyJunctions` in `ligate.ts`) and `ligate` opens the product as a
new circular or linear document with the fragments' features; a fragment
can also be opened on its own (**Open**, item 10). The shelf survives a
reload: it is a row of its own in IndexedDB (Dexie version 2, table
`shelf`), written by `useAutosaveShelf` and read back by
`restoreLastSession`, which gives way to a shelf the user has already
started filling. A **Golden Gate** section below it takes whole open
documents instead (`goldenGate` in `src/core/cloning/goldenGate.ts`):
one Type IIS enzyme (`isTypeIIS`, `goldenGateEnzymes`, BsaI by
default), digest every ticked document, drop the pieces that still carry
a site or lack two sticky ends, then walk the overhangs, flipping a part
where that is how it fits, and refuse with a sentence rather than guess
when they do not force one circle. It costs a few ms on the main thread
(`docs/perf-notes.md`). `flipFragment` was fixed along the way: a
fragment's `sequence` is its top strand alone, so turning it over moves
the window by an overhang at each end rather than just
reverse-complementing it. Not yet: partial digests,
dephosphorylation, resolving IUPAC codes in overhangs, mixing two
enzymes in one Golden Gate, and checking whether a set of Golden Gate
overhangs would misligate.

- **Gibson, 2026-09-22** (`src/core/cloning/gibson.ts`, the third reaction
  the Cloning tab's picker offers). The reaction has no enzyme, no site and no scar: each
  piece is made to end in the bases the next one starts with, and an
  exonuclease, a polymerase and a ligase join them in one tube. So there
  is nothing to digest and no overhang table to consult — the whole
  question is which end matches which, and whether that order is forced.
  `terminalOverlap` takes the _longest_ shared stretch within
  `minOverlap`..`maxOverlap`, because a designed 30-mer also has a
  matching 15-base suffix and the designed one is the true junction.
  - **The product is seamless**, which is the whole point: every shared
    stretch is in it once. Each part gives up the homology it shares with
    the part before it, _except_ the closing one of a circle, which is
    taken off the last part's tail instead — trimming the first part's
    head was the first cut, and it gave back the same circle written from
    an origin the user never chose. Caught by asserting the product is
    the sequence the parts were cut from, not merely its length.
  - **A circle can be followed one way round; a linear product cannot.**
    The chain walks forward from the first part, and for a linear product
    also backward, because the part the user happened to open first may
    be in the middle of it. Golden Gate never needed this: its product is
    always circular.
  - **One part is an assembly** when its own two ends share homology,
    which is how a PCR product is circularised.
  - Junctions carry the overlap's melting temperature
    (`meltingTemperature`, already there for primers). The reaction is
    held at 50 °C, so the panel marks a junction under 48 °C rather than
    refusing it: whether it anneals is a bench question, and the homology
    is real either way.
  - Circular documents are dropped with a sentence rather than ignored, as
    Golden Gate drops a piece that keeps its site. 1.0 ms for six 2 kb
    parts (`docs/perf-notes.md`), so it sits in the same main-thread memo
    the Golden Gate does.
  - **The tube takes the shelf too, 2026-09-22**, for Golden Gate as well
    as Gibson (`tube.ts`, `PartsTube.tsx`, shared by both panels). A real
    assembly mixes them — a backbone cut out of a plasmid with an insert
    amplified from somewhere else — so the open documents and the ligation
    shelf are one list with a tick each rather than a choice between them.
    A shelf fragment goes in as `documentFromFragment` makes it, the same
    linear document with its ends and features that **Open** gives, so
    neither `gibson` nor `goldenGate` changed at all. Two fragments of one
    digest with the same enzyme at both ends share a default name, and a
    name is how both panels report an ambiguity, so a repeat is numbered.
    A shelf fragment carrying no Type IIS site survives the Golden Gate's
    digest whole and joins on the sticky ends it already has, which is
    what the reaction does in the tube and needed no special case.
  - Not yet: homology _inside_ a part that would anneal as readily as the
    junction it was designed for is not looked for, and neither the
    chew-back's length nor the fill-in is modelled, so a very long part
    with a very short overlap can fail on the bench while looking right
    here.
- **One reaction at a time, and the fragments on the views, 2026-09-22.**
  Three reactions stacked down a 300 px column made the tab 3,482 px tall
  against a 931 px viewport, measured rather than guessed. They are
  alternatives, not steps, so a segmented picker under the digest chooses
  one (`cloningReaction`, kept with the view preferences because a lab
  that does Gibson does Gibson every week) and only that one renders: 807
  px, one screen. The fragment list scrolls inside itself as the enzyme
  list does, since the picker is below it and a digest of every single
  cutter of pBR322 is 35 rows.
  - The picker sits **under** the digest rather than at the top of the
    tab. The digest is the one part that is about the document in front of
    you; the three reactions work across the open tabs, and two of them
    never look at it. The line between them is the thing the tab was
    missing.
  - **The digest draws its fragments on both views** through item 26's
    preview channel, which its note had named as the obvious next caller.
    Each is a `span` — a dashed arc with a tick at either end — so a ring
    of fragments reads as fragments rather than as one unbroken band, and
    the ticks land where the enzyme cuts. The one under the pointer is an
    `arrow` instead: solid, with a head. That needed no rendering work,
    which is the channel paying for itself; two shapes it already had say
    "these are the pieces" and "this is the one you are asking about".
  - The question the preview answers is which piece is the backbone. The
    sizes cannot say where they are, and clicking a row to select it
    answers for one piece at a time.
  - **A previewed fragment is clickable** (2026-09-22) and goes to the
    shelf exactly as its **Add** button does; the panel switches to
    Ligation so it can be seen landing. The views know nothing of
    fragments: a span carries `clickable` and a click raises
    `previewActivated` (owner, id, nonce) for whoever drew it, as `reveal`
    is raised for the views. Only clickable spans answer, so Find's 200
    matches and the Primers arrows keep the behaviour the views already
    had where they are drawn — on the map that matters, because the
    preview ring is inside the backbone's own hit band and would otherwise
    shadow half of it. The nonce is seeded at mount, or coming back to the
    tab would answer the last click again and shelve a fragment by itself
    (caught by a test, not by reading).
  - Not yet: the Golden Gate and Gibson products are not previewed at all,
    which would need somewhere to draw a molecule that is not open; and a
    digest of dozens of fragments draws a busy ring, which is honest but
    not useful.
- **The shelf is the bench's, 2026-09-23** (#16, decided at the start of
  1.4). Golden Gate and Gibson took parts from it and a fragment clicked in
  a view landed on it, yet it lived under **Ligation** and adding to it
  switched the picker there, pulling the user out of the reaction they were
  working in. PCR products (#13) would have been its third use. It is now a
  section of its own (`ShelfPanel.tsx`) between the digest and the picker,
  and `addToShelf` leaves `cloningReaction` alone; the store's `assembly`
  became `shelf`, the name persistence already used.
  - **The shelf keeps Ligation's order and flips.** A ligase does not choose
    an order, so the user must, and the shelf is where the parts already
    were arranged; a second arrangement inside the Ligation panel would be
    two orders for one list. The one-pot reactions find their own order and
    orientation, so a flip on the shelf changes nothing for them.
  - **Ligation takes ticks, like the tubes** (`LigationPanel.tsx`). A shared
    shelf can hold a PCR product meant for a Gibson next to a backbone meant
    for a ligation; without a way to leave one out, every stray part would
    break the junctions.
  - **Assembling no longer empties the shelf.** It did when the shelf was
    Ligation's own list; a shared one may hold parts for the next reaction,
    and a vector cut once is often ligated to one insert after another.
    **Clear shelf** is one click.
- **Partial digests and dephosphorylation, 2026-09-23** (#10).
  - `partialDigest` lists every stretch between two stops, each with the
    number of sites inside it left `uncut`, so a complete digest is the
    subset with none and the panel lists both kinds the same way. It is a
    toggle rather than always on because it grows with the square of the
    cuts: 35 sites on pBR322 give 1,225 pieces, and cutting all of them out
    took 180 ms. So `partialDigest` takes a `limit` (200 in the panel) and
    cuts out only the pieces that miss the fewest sites — what a tube mostly
    holds — in 10–20 ms for that extreme case and about 1 ms for three
    sites (`docs/perf-notes.md`). The panel draws only the piece under the
    pointer, since pieces of a partial digest overlap by design and a ring
    of all of them is a smear.
  - Dephosphorylation is a property of the fragment
    (`DigestFragment.dephosphorylated`), not of an end: a phosphatase treats
    the whole molecule. A junction needs a 5′ phosphate on at least one side
    (the other strand's nick is sealed in the cell), so `Junction` gained
    `dephosphorylated` to tell "both bare" from "ends do not match", which are
    different things to do something about. It is set on a shelf part, where
    it is used, and a part opened as a document loses it: documents do not
    model phosphates, and a GenBank file has nowhere to keep them.
  - Not modelled: a PCR product's missing phosphates (standard oligos have
    none, so a blunt PCR product will not go into a dephosphorylated vector
    on the bench); it is shelved as phosphorylated.
- **Golden Gate II, 2026-09-23** (#11).
  - `endsCompatible` resolves IUPAC codes (`overhangsMatch`): two overhangs
    pair when, base by base, the codes allow a common base. It is the rule
    for ligation too, since an overhang is the same molecule whichever
    reaction joins it; an `N` overhang therefore fits several parts, and
    Golden Gate reports that as the ambiguity it is.
  - A second enzyme (`secondEnzyme`) cuts everything too, and a piece
    keeping either site is dropped, now saying whose (`DroppedFragment.enzyme`).
    Two is enough: the case is a vector made for one enzyme and parts for
    another, and a list would be a control for a reaction nobody runs.
  - `overhangWarnings` checks the junction overhangs of a product that did
    assemble: palindromes, pairs one base apart either way round, and
    ambiguity codes. Warnings rather than refusals, because the product is
    what the design intends and the fidelity of a near pair depends on the
    ligase and the temperature (published ligation-fidelity tables), which
    the app does not have. A table like that would turn the warning into a
    measured misligation rate.
