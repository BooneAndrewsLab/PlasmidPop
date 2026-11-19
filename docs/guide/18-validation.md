# Validation

PlasmidPop's sequence results are checked against answers that do not come
from its own code, and its tests are themselves tested by mutation. This page
says what is checked against what, how many cases there are, what is known to
differ, and the latest mutation score. The numbers on it are not typed: the case
counts, the oracle versions and the mutation score are read when the app is
built from the data committed beside the code, so they cannot say more than the
repository holds. The descriptions of what each area compares, and the list of
known differences, are written by hand, and a test fails if an oracle has no
section.

## How to read it

- **An oracle** is an independent program or data set that gives the right
  answer for a case: Biopython, pydna, primer3-py, MAFFT, pLannotate, or
  NCBI's own records. The answers were recorded once, with the version named
  below, and are committed as JSON files. The tests compare PlasmidPop's
  answer with the recorded one on every run, so checking needs no Python and
  no network.
- **A case** is one input with its recorded answer: a digest of one sequence,
  one PCR, one assembly, one primer. Cases are counted from the files when the
  page is built.
- **Not every area has a reference tool.** Where there is none, the section
  says what stands in for it (a known construct, a gate against a tool's
  mean) and what that does not prove.
- **Passing is not proof of correctness.** It means PlasmidPop agrees with the
  oracle on these cases, apart from the differences listed. A case set can
  miss a corner, and an oracle can be wrong, which is why some differences
  below are marked as the oracle's.

## What a mutation run is

A mutation run changes the code in small ways (a `<` becomes `<=`, a `+`
becomes `-`) and asks whether any test fails. A change no test notices is a
survivor: either the tests are too weak there, or the change makes no
difference a test could see. The run is made by hand before each release,
never in the automatic checks, because it takes a long time and needs an idle machine.
`npm run mutate:summary` writes the result to `docs/validation/mutation-summary.json`,
which is what the Mutation testing section below reads.

**Read the per-file scores, not only the overall one.** The overall score is a
project-wide figure, and a file well below it can hide behind many strong ones. A
file's own score is the better guide to how well its tests would notice a change.
Two things can flatter or understate it, and both are written down in design note 50:
a few heavy test suites are left out of a mutation run, and mutants judged
impossible to tell from the original are ignored, not counted as survivors. A
score is therefore a measure of the tests that ran, not a proof of correctness.

<!-- validation-tables -->

## Known limits and deliberate choices

These are decisions, not oversights. Each has a design note with the
measurement or the reasoning, and a review that lists one of them as a gap is
repeating what is written here.

- **Repeat placement looks at eight alternatives.** When a Sanger read fits
  several copies of a repeat, the assembly weighs the chosen place and at most
  eight alternatives (16 stretches per read per round). A read that only fits
  beyond that stays at its best place with the `ambiguous-join` and
  `pair-distance` warnings, so the failure is visible. The bound is not going
  up: Sanger reads cannot tell that many copies apart (design note 130).
- **Primer thermodynamics is a compact nearest-neighbour model.** It is
  SantaLucia's stacking energies with loop, mismatch and dangling-end terms,
  checked against Primer3 (see the primer guide for the agreement figures),
  not a reimplementation of `thal`. Some loop terms were fitted to Primer3's
  output, so that agreement is partly by construction. Melting temperatures
  are good to about ±2 °C at 500 nM oligo and 50 mM monovalent salt; other
  buffers need adjusting by hand. A Rust/WASM version is shelved until batch
  design measures slow (issue 359).
- **No real-world benchmark for Sanger assembly yet.** It is checked against
  constructed read sets and a mutation run, not against an independent
  assembler on real traces. Issue 450 tracks it.
- **Mutation testing is run by hand before each release, not in CI.** It
  takes hours and needs an idle machine, so it would be slow and noisy on a
  shared runner. The result is committed as
  `docs/validation/mutation-summary.json`, and the score floor is checked at
  release time (design note 50).

## Where the data is

The oracle answers are in `src/test/oracle/` of the
[source](https://github.com/BooneAndrewsLab/PlasmidPop), with the scripts that
make them in `scripts/oracle/` and their pinned versions in
`scripts/oracle/requirements.txt`. The design notes behind them are items 37,
121 to 125 and 143 in `docs/design/`, the mutation testing is item 50, and this page
is item 142. A test fails if a file in that folder has no section here, so a
new oracle cannot be added without appearing on this page.
