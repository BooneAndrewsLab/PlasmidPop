# 36. PCR: the reaction that makes a part

Done, 2026-09-22
(`src/core/cloning/pcr.ts`, `src/core/primers/anneal.ts`, the Cloning
tab's fourth reaction). A digest takes a molecule apart and Golden Gate
and Gibson put molecules together, but nothing could _make_ a part, so an
assembly could only be built out of files that already existed. Almost no
bench work is like that: the insert is amplified, the backbone is
amplified, and the homology a Gibson joins them by is on the primers
rather than in any file. Item 3 and item 26 both end on wants this
answers.

- **A primer is not its binding site.** It is a 3′ part that anneals and a
  5′ tail that does not, and the tail is where the restriction site, the
  homology arm, the tag or the mutation lives.
  `findPrimerBindingSites` asks whether the _whole_ oligo matches, which
  is the right question for "is this specific to my plasmid" and cannot
  see a cloning primer at all. `findAnnealingSites` walks back from the 3′
  end instead — the end a polymerase extends from, and where a mismatch
  stops the reaction whatever the rest does — and reports the leftover as
  a tail. The run is trimmed back to a match, so a site never begins on a
  mismatch, and a tail base that happens to pair does pair: that changes
  the report and not the molecule, which is a test rather than a note.
- **The product is the primers' sequence, not the template's.** The first
  cycle copies the template and every cycle after copies the product, so a
  mismatch under a primer is a mutation to write down rather than an error
  to flag. Site-directed mutagenesis therefore needs nothing of its own:
  design the primer with the change in it and amplify.
- **Upper case in the product means "not from the template".** The
  annealed bases are written in the template's own case and only the
  tails and the mismatches in the primer's, so the capitals in a product
  are exactly what the template did not supply — which is how a primer is
  written out in a paper, and is free. (Writing the oligo over the
  template shouts the whole annealing region, since primers are cleaned
  to upper case and an ORIGIN block is lower: seen in the browser, not in
  a test, and now both.)
- **Inverse PCR needs no case either.** On a circle the product is the
  stretch from the forward primer round to the reverse one, so back-to-back
  primers give nearly the whole plasmid — which is how a vector is
  linearised for a Gibson. A pair pointing away from each other on a
  _linear_ template is refused with that sentence.
- **The panel asks for two oligos and nothing else**, because everything a
  designer decided is already in them. It reports what they would do: the
  lengths, the tails, the Tm of the annealing part, where each lands, and
  the products — cleanest and shortest first, since an exactly-matched
  short amplicon out-competes the rest in the tube. Every product and
  every site is drawn through item 26's preview channel until one is
  picked, which is how an off-target band is seen beside the wanted one;
  clicking a previewed product opens it, as clicking a digest fragment
  shelves it. The digest gives up the preview channel while the panel is
  open, there being one of them.
- **PCR is first in the picker** and, with the digest, one of the two
  things in the tab that are about the document in front of you rather
  than about the tube of open tabs: a PCR has one template.
- The products are drawn as a gel (item 30). One band is what a real gel
  gets compared against; two are the question of whether they could be
  told apart, which is why the gel is drawn at all.
- **Measured** (`docs/perf-notes.md`): 2.1 ms for a plasmid, 11 ms for
  50 kb, so it runs in a main-thread memo on every keystroke like the two
  one-pot panels. The 50 kb case gives six spurious products, which is not
  a modelling error — over 100 kb of searchable strand a 15-base 3′ match
  with two mismatches turns up by chance, and a long template really does
  prime in more places. It is why the products are sorted by mismatches
  first and capped.
- The last test amplifies a vector by inverse PCR, amplifies an insert
  from a _different_ molecule with tails that anneal nowhere on it, and
  hands both to `gibson`: the loop this closes.
- **Another tab as the template, and products on the shelf, 2026-09-23**
  (#13). **Template** picks any open tab, the front one by default and
  again when the picked one closes. Only the front document's products are
  drawn: the preview channel belongs to the tab in front, and another
  molecule's coordinates would be drawn on the wrong one, so the list says
  so and **Show** is not offered rather than drawing nothing silently.
  **Shelve** needed no conversion of its own: a linear document digested
  with no enzymes is one fragment with the document's own ends, which for a
  product is blunt at both, so `digest(product.document, [])` is the shelf
  part, features and all. It is the shelf's third use, which is what moved
  the shelf out of Ligation (item 3, #16).
- **The polymerase, dimers, two temperatures and phosphates, 2026-09-23**
  (#14).
  - `polymerase`: proofreading (blunt, 20 kb) or Taq, which appends an A
    to each 3′ end — past the top strand on the right, past the bottom
    strand on the left, where the top strand would read T — and reaches
    5 kb. Those ends are the `ends` a digest fragment has, so a TA vector
    with 3′ T overhangs ligates to the product on the shelf with nothing new
    in `ligate`. The reach numbers are the makers' routine figures; the
    processivity of a real enzyme falls off rather than stops.
  - `primerDimers` uses the primer designer's own measure
    (`threePrimeComplementarity`, over its `maxThreePrime` of 4), for each
    primer against the other and against itself.
  - `AnnealingSite.templateTm` is the Tm of the 3′ stretch before the first
    mismatch: what surely pairs while the template is the original. The
    panel gives it beside the whole primer's Tm, which is what the primer
    anneals at once the product exists. Nearest-neighbour mismatch
    parameters would give one honest number instead of a bound; they were
    left out rather than typed in from memory.
  - A shelved product is dephosphorylated unless **5′-phosphorylated
    primers** is ticked (#10's follow-up), since its 5′ ends are the oligos'.
