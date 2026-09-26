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
- **NEB's Q5 Tm and annealing temperature** (#69, 1.8).
  `q5MeltingTemperature` is NEB's documented method — SantaLucia (1998)
  nearest neighbours with the whole primer concentration in the logarithm,
  then Owczarzy et al. (2004)'s salt correction — at 150 mM monovalent,
  which is the one number NEB does not publish. It was fitted to the
  calculator itself: eleven primers of 17–32 nt and 9–90 % GC read off
  https://tmcalculator.neb.com on 2026-09-25 all come out to the degree,
  including two the fit did not use. It is 1–3 °C above
  `meltingTemperature`, which is what NEB means when it says other
  calculators underestimate the Tm for Q5. `q5AnnealingTemperature` is the
  lower Tm plus one, capped at 72 °C, which held for every pair tried. Both
  are shown only for the back-to-back design: the overlapping one is
  Agilent's kit, whose own formula is its rule.
- **Changing a residue rather than bases** (#69, 1.8). `codonSiteAt` finds
  the codon a position falls in, through `translateCds`, so a `join(...)`,
  the origin, `/codon_start` and the feature's own genetic code all apply
  for free. Its `codon` is in reading order, which on the reverse strand
  means each forward base complemented where it stands — not the three
  reverse-complemented, which would reverse an asymmetric codon;
  `codonOnForwardStrand` puts the new one back the same way. The panel
  offers the residue only while the selection lies inside the one codon:
  over more than that, the change is to the bases.
- **Codon usage** (`codonUsage.ts`, #69, 1.8) is the Codon Usage Database's
  counts (Nakamura et al. 2000) for six expression hosts, fetched
  2026-09-25 and cited in `DATA-LICENSES.md`: counts of codons in
  published genes are facts about genomes. `codonChoices` orders an amino
  acid's codons by the host's share, ties going to the fewest bases
  changed, so a K→R keeps to one base where it can. `libraryCoverage`
  reads a degenerate codon with the same genetic code and reports codons,
  amino acids, stops and the colonies for 95 % coverage of any one codon
  (1 − (1 − 1/n)^T ≥ 0.95, about 3n).
- **Fixed by the property tests, 2026-09-24.** Agilent's N had the
  deleted bases subtracted as well as the inserted ones, though a deletion's
  bases are not in the primer: a QuikChange deletion of 20 bases or more got
  N ≤ 0 and a NaN Tm, shorter ones a low Tm and longer primers than needed.
  A CDS running over the origin of a circle got no protein change for an
  edit just after the origin. And back-to-back insertions mostly failed to
  amplify, which was PCR's (item 36).
