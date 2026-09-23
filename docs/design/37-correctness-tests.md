# 37. Tests that a plasmid comes out as it went in

Done, 2026-09-23. Asked for: confidence that editing never silently damages
a sequence. The worst case is a malformed plasmid nobody notices. That
means testing against answers that do not come from the code under test,
with both random and fixed inputs, so a corner case never depends on the
generator happening to find it.

## Editing, against a reference model

- **The reference** (`src/test/editArbitraries.ts`, `RefModel`) is a plain
  array of bases, each with an identity that travels with it, edited with
  `splice`. After every edit `checkEdit` requires: the sequence equals the
  model's letter for letter; every feature covers exactly the bases it
  covered, less the deleted ones; inserted bases join a feature exactly
  when they land between two adjacent bases of one of its segments (or
  anywhere in a segment that goes all the way round a circle), as one run
  in that gap; a feature is dropped exactly when no base is left; strands
  flip only on a reverse complement; every segment is valid.
- **Random sessions** (fast-check, `editing.property.test.ts`): up to 30
  edits — insert, delete, replace, paste with features, reverse complement,
  set origin, topology changes, added features — on linear and circular
  sequences with joins, sites, IUPAC and lowercase bases, sometimes longer
  than a rope leaf. The same sessions run through `EditorStore` with bursts
  of undo and redo against a snapshot stack
  (`editorStore.property.test.ts`), and through a GenBank write and
  re-read (`genbank.property.test.ts`).
- **Fixed samples** (`editing.exhaustive.test.ts`): every edit at every
  position of every sequence up to 5 bp, both topologies, on a document
  carrying every feature that fits at once. Also every pair of edits up to
  3 bp, and random edits on the real NCBI records in `src/io/fixtures`.
  These found what the random sessions had missed: the generator made no
  sites, and three edits left a site at `length` on a circle, which
  `isValidSegment` rejects. The three were a deletion reaching the end, a
  linear sequence closed with a site after its last base, and a paste or
  insertion into an emptied circle. After that, editing the feature threw,
  and saving wrote the site one base early. Fixed with `closeSiteOnCircle`
  (the gap after the last base is position 0). The generator makes sites
  now.
- **The tests were tested.** Each suite was run against planted bugs
  (off-by-one insertion, a dropped wrap piece, rotation and flip errors,
  segment order on a flip, paste position, redo skipping a step, wrong
  locations). All were caught, and fast-check shrank each to a 1–3 bp
  example. Redo skipping a step was missed until undo and redo came in
  bursts, which is why they do.

## Biopython as an oracle

- **Answers recorded once, compared in CI.** `scripts/oracle/generate.py`
  (Biopython pinned in `scripts/oracle/requirements.txt`, venv made by
  `npm run oracle:generate`) writes Biopython's answers to
  `src/test/oracle/*.json`. The Vitest files beside them compare ours, so
  CI needs no Python. Each area has fixed samples (hand-written edge cases,
  the real fixtures) and seeded random ones.
- **GenBank:** our parser must read what Biopython reads (bases, topology,
  type, strand, qualifiers, extracted sequence of every feature), and
  `formatLocation` must write each location as Biopython does, in
  hand-written tricky files, files Biopython wrote, and the NCBI fixtures.
- **Restriction:** the same cuts from about 280 enzymes (the bundled table
  plus a spread of Type IIS, interrupted and ambiguous sites) on the real
  plasmids, on sites straddling the origin or touching the ends, and on
  random sequences. The bundled table must equal REBASE as Biopython ships
  it; all 127 do.
- **Translation:** every codon over the IUPAC alphabet (15³) under every
  NCBI code, start and stop codons, and whole sequences.
- **Other tools reading our files:** `npm run oracle:writer` writes our
  GenBank for every oracle record and 300 randomly edited documents, then
  has Biopython read each back and compare it to what we meant. This is
  run by hand, since it needs Python.
- **Biopython is not always right.** Its `search` reports one match per
  position. Where an ambiguous non-palindromic site reads as a site on both
  strands at once (SgrTI's CCDS on CCGG), it loses the reverse one. The
  generator recovers those by also searching the reverse complement with
  Biopython, so the oracle stays independent of our code.

## Known differences

Each one is tolerated only in its exact shape, so anything new still fails:

- On a linear molecule we list a cut whose top or bottom strand is cut
  exactly at an end. That is no double-strand break; Biopython omits it.
- We write X for an ambiguous codon that can only be one of two amino
  acids; Biopython writes B, Z or J.
- In codes 27, 28 and 31, codons that are a stop or an amino acid by
  context are stops to Biopython; we translate them.
- `order(...)` is read as `join(...)` (with a warning on opening) and
  written back as `join(...)`.

The writer check found one more: our LOCUS line left out the division
code when a document had none, which is every document made in the app,
and Biopython 1.85 refuses such a file outright ("LOCUS line does not
contain space at position 68"). The writer now puts SYN, NCBI's division
for synthetic constructs, where there is none. Since then all 441 files of
the writer check read back as meant.
