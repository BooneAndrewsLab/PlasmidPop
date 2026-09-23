# 43. SnapGene fixtures, checked against Biopython

Done, 2026-09-23 (#44). The question was which SnapGene versions to support
and where test files could come from: SnapGene's own files cannot be
committed, so CI had only `.dna` files built in memory by the test that
reads them — the same assumptions on both sides.

- **Decided:** support what current SnapGene writes, and build our own
  fixtures. All 203 files bundled with SnapGene 8.2 carry the same cookie
  (format 1, export version 15, import version 19) and the same packet
  order, `09 00 03 08 0a 05 06 0d 0e` give or take history and display
  packets; the reader checks no version, and an older file with the same
  packets reads the same.
- **Fixtures written by someone else's understanding.**
  `scripts/oracle/snapgene_fixtures.py` writes five `.dna` files into
  `src/io/fixtures/snapgene/` from the packet format — a plasmid with a
  gapped CDS, a reverse gene, a feature over the origin, markup in
  qualifiers and primers on both strands; a TA vector; a D-TOPO vector; one
  outside ASCII; a bare one — with the packets PlasmidPop skips left in.
  Biopython then reads them (`generate.py`, `snapgene.json`) and
  `src/test/oracle/snapgene.test.ts` holds our reader to its answer, so CI
  compares two independent readers rather than a reader with its own
  writer. Biopython keeps SnapGene's both-strands sequence and does not read
  ends, so the test rebuilds that sequence from ours and clips its
  locations to the part we keep; the ends are checked on their own.
- **Local check against the real files.** `npm run oracle:snapgene`
  (`run.sh snapgene-local [dir]`) runs the same comparison over every `.dna`
  under a SnapGene installation. On 8.2's 203 files and 2,835 features it
  found two bugs, both in primers, both now fixed:
  - A primer's `BindingSite location` counts from 0 and includes both
    ends, unlike a feature's 1-based `range`. We read it as a range, so
    every imported primer sat one base to the left. Settled against the
    primers' own sequences, not against Biopython: read from 0, 72 of 80
    sites match their primer's 3′ end exactly (mean identity 0.99); read as
    a range, none do (0.26).
  - SnapGene stores a binding site a second time with `simplified="1"`;
    we imported it as a second primer. The copy is now dropped when it is
    the same site, as Biopython does.
- After both, zero disagreements on all 203 files.
