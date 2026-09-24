# 47. Site-directed mutagenesis

Done, 2026-09-23 (#61; `src/core/cloning/mutagenesis.ts`, the Cloning tab's
**Mutate**). Item 36 made PCR write its primers' bases into the product, so
a mutation needed no reaction of its own: only primers designed around it.
That design was left to the user, and it is the part of mutagenesis people
use a tool for.

- **The selection is the change.** A range and what it becomes, a caret
  and what goes in, or a range and nothing: substitution, insertion and
  deletion are one `replace` of `range` with `replacement`, and the edit
  that makes the mutant is the same op the editor would apply
  (`insert`/`delete`/`replace`). So **Open mutant** opens the template
  renamed and applies it as the one edit, and the tracked-changes marks
  (item 21) show the change with nothing new in them.
- **Two designs, because two are in use.** Back to back (NEB Q5 SDM):
  non-overlapping primers pointing away from each other, the change on the
  forward primer's 5′ end, each annealing part grown to 60 °C by the
  nearest-neighbour Tm the rest of the app uses; an insert over 20 bases is
  split between the two tails so neither primer is long. Overlapping
  (QuikChange): one primer and its reverse complement, the change in the
  middle, flanks grown alternately until Agilent's own formula
  (81.5 + 0.41·%GC − 675/N − %mismatch, N without an indel's bases) gives
  78 °C. The formula is used because it is what QuikChange's rules are
  written in; mixing it with nearest-neighbour numbers would move the
  threshold.
- **Tested by running it.** The back-to-back tests amplify the plasmid
  with the designed primers through `pcr`, close the product with `ligate`
  (the KLD step) and compare the circle with `mutant`, from any origin: a
  design that is internally consistent but wrong on the bench cannot pass.
  They do it across the origin too.
- **What it does to a protein** is read by translating every CDS the change
  lies inside before and after (`translateCds`), so the feature's genetic
  code, strand and `/codon_start` apply for free. The result is named by
  position (`K2R`), as silent, as a frameshift from the first residue that
  differs (which is not always the one at the edit: deleting the first A of
  AAA leaves AAG, still K), or as an in-frame gain or loss.
- **The digest gives up the preview channel** while Mutate is picked, as it
  does for PCR: neither is about the fragments.
- Follow-ups (NEB's Q5 Tm, codon changes by amino acid, degenerate codons)
  are #69.
- **Fixed by the property tests, 2026-09-24.** Agilent's N had the
  deleted bases subtracted as well as the inserted ones, though a deletion's
  bases are not in the primer: a QuikChange deletion of 20 bases or more got
  N ≤ 0 and a NaN Tm, shorter ones a low Tm and longer primers than needed.
  A CDS running over the origin of a circle got no protein change for an
  edit just after the origin. And back-to-back insertions mostly failed to
  amplify, which was PCR's (item 36).
