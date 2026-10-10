# 77. Modular cloning standards and combinatorial plans (#214)

**Asked:** people doing modular cloning think in standards and positions
(MoClo, the Yeast Toolkit, GoldenBraid, Loop), not in a bag of fragments
that Golden Gate sorts out. Proposed: overhang standards as data, parts
tagged with a position, and a plan choosing a part per position and listing
each product and which assemblies cannot form.

**Built** (`src/core/cloning/moclo.ts`, `src/app/components/ModularPanel.tsx`,
a fourth Bench reaction, **Modular**):

- A standard is `{id, name, positions: {name, left, right}[]}`. Overhangs are
  in the convention of `DigestFragment` ends, which is the one
  `endsCompatible` compares, so a part's position is found by comparing its
  digest's ends (and the flipped fragment's) with each position.
- **Detection by digest, not by scanning for sites.** `goldenGateFragments`
  is what the reaction would keep from a document (no site left, two sticky
  ends); a position is the piece whose ends equal one position's, a
  destination the piece whose left end is some position's right end and whose
  right end is some position's left end. That reuses the reaction's own
  notion of a part, so the tag cannot say a part fits where Golden Gate
  would not use it.
- **Tags by hand** are bench settings (`bench.modular.tags`, by ingredient id,
  remembered like the other bench settings), not a new field of the
  document: a part's position is a property of the standard being worked with
  and of the enzyme chosen, not of its sequence, and no file format of ours
  has a place for it. A hand tag overrides detection.
- **The plan** is the cartesian product of the slots, each run through
  `goldenGate`, capped at 500 combinations (each is a full digest of every
  part). A slot end that no other slot meets is reported up front by
  `planGaps`; products that fail show the reaction's own sentence. Failing
  products are listed first, since finding them is what the plan is for. The
  overhang warnings and fidelity are shown once, from the first product that
  forms: they are a property of the junction set, which every product shares.
- **Bundled standards:** the MoClo plant common syntax (fusion sites GGAG,
  TACT, AATG, AGGT, GCTT, CGCT; Weber et al. 2011, Patron et al. 2015) and
  the Yeast Toolkit (Lee et al. 2015, types 1 to 8 and their a/b
  subdivisions, as in the published signatures). These are short overhang
  sequences stated in the papers, which carry no sequence data of anyone's
  parts; they are the same kind of fact as an enzyme's recognition site.
  Cross-checked against the `moclo` Python library's YTK signatures, and the
  plant fusion sites against the Phytobrick fusion-site letters A to F.
- **Imported standards** are a text/CSV file (one position per line,
  optional `# name, enzyme` line), stored in IndexedDB (schema version 10,
  `overhangStandards`) and kept apart from the bundled ones. An id that
  collides with a bundled standard is refused.

**Decided:** GoldenBraid, CIDAR and Loop are not bundled. Their tables could
not be checked against a primary source while this was built, and a wrong
overhang in a bundled standard is worse than none. They import from a file.
The plant syntax's NT/CT-tag subdivisions beyond the D site (AGGT) and the
GoldenBraid-specific sites were left out for the same reason.

**Not done:** multi-level plans (a level-1 product as a part of a level-2
plan) work by opening the product and choosing the other enzyme, not as one
plan; no well positions or inventory (out of scope in the issue).
