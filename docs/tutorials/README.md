# PlasmidPop tutorials

Hands-on, step-by-step exercises for cloning in PlasmidPop. Pick the method you
want to learn; each tutorial is one page with numbered steps, the numbers to
expect, and sample files you can download. Every file is a **synthetic
example**, and every number is checked by a test that runs the same files
through the functions the app uses, so the pages cannot drift from the app.
They are also published as plain web pages, readable without JavaScript, at
`/tutorials/` on the PlasmidPop site.

New to the Bench or to the sample files? Start with
[Before you start](before-you-start.md) (five minutes).

## Pick a method

- **[Ligation](ligation.md)**: restriction cloning. Cut a vector and an insert
  with EcoRI and BamHI, ligate them, see why mismatched ends fail and why a
  single-enzyme cut needs dephosphorylation; then do it with insulin from NCBI.
  Beginner, about 30 minutes. Files: [pLig-Vector.gb](files/pLig-Vector.gb),
  [Insert-EcoRI-BamHI.gb](files/Insert-EcoRI-BamHI.gb),
  [Insert-PstI-BamHI.gb](files/Insert-PstI-BamHI.gb),
  [Insert-EcoRI-EcoRI.gb](files/Insert-EcoRI-EcoRI.gb).
- **[Golden Gate: one gene into one vector](golden-gate.md)**: put a gene into
  a BsaI expression vector in one reaction, about eight steps, with a synthetic
  ORF and again with insulin from NCBI. Beginner, about 20 minutes. Files:
  [pGG-Expression.gb](files/pGG-Expression.gb), [GG-gene.gb](files/GG-gene.gb).
- **[Golden Gate: four parts and the warnings](golden-gate-parts.md)**:
  promoter, coding part, tag and terminator in one tube, in a scrambled tab
  order, then three broken designs and what the panel says about them.
  Intermediate, about 30 minutes; do the previous tutorial first. Files:
  [pGG-Destination.gb](files/pGG-Destination.gb),
  [GG-prom.gb](files/GG-prom.gb), [GG-cds.gb](files/GG-cds.gb),
  [GG-tag.gb](files/GG-tag.gb), [GG-term.gb](files/GG-term.gb) and the
  `GG-broken-*` and `GG-warn-*` files.

More methods (modular cloning, Gibson, overlap-extension PCR, Gateway and
others) are planned.

## Reference

- [Before you start](before-you-start.md): opening the files, enzyme ticks,
  what the Bench is, and what to do if a number does not match.
- [Sample files](sample-files.md): every file, what it is, and a plain download.
- The [user guide](../guide/README.md), and
  [Simulated cloning](../guide/12-cloning.md) in particular.
