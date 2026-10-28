# PlasmidPop cloning tutorials

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

- [Ligation](#ligation): cut with restriction enzymes and join the pieces.
- [Golden Gate](#golden-gate): one reaction, enzyme sites that cut themselves
  out, overhangs that decide the order.
- [Modular cloning](#modular-cloning): Golden Gate with a standard's part
  positions (MoClo).
- [Gibson, In-Fusion and NEBuilder](#gibson-in-fusion-and-nebuilder): no enzyme
  site at all, pieces that end in each other.
- [Overlap-extension PCR](#overlap-extension-pcr): fuse fragments from different
  templates with primer tails and nothing else.

More methods (Gateway and others) are planned and will appear here as their own
entries.

### Ligation

Restriction cloning: the oldest and plainest method, and the one to start with.

- **[Ligation: vector and insert](ligation.md)**: cut a vector and an insert
  with EcoRI and BamHI, ligate them, see why mismatched ends fail and why a
  single-enzyme cut needs dephosphorylation; then do it with insulin from NCBI.
  Beginner, about 30 minutes. Files: [pLig-Vector.gb](files/pLig-Vector.gb),
  [Insert-EcoRI-BamHI.gb](files/Insert-EcoRI-BamHI.gb),
  [Insert-PstI-BamHI.gb](files/Insert-PstI-BamHI.gb),
  [Insert-EcoRI-EcoRI.gb](files/Insert-EcoRI-EcoRI.gb).

### Golden Gate

BsaI cuts its own site out of every part and leaves a four-base overhang, so
cutting and joining happen in one tube. Do the first tutorial before the second.

- **[One gene into one vector](golden-gate.md)**: put a gene into a BsaI
  expression vector in about eight steps, with a synthetic ORF and again with
  insulin from NCBI. Beginner, about 20 minutes. Files:
  [pGG-Expression.gb](files/pGG-Expression.gb), [GG-gene.gb](files/GG-gene.gb).
- **[Four parts and the warnings](golden-gate-parts.md)**: promoter, coding
  part, tag and terminator in one tube, in a scrambled tab order, then three
  broken designs and what the panel says about them. Intermediate, about 30
  minutes. Files: [pGG-Destination.gb](files/pGG-Destination.gb),
  [GG-prom.gb](files/GG-prom.gb), [GG-cds.gb](files/GG-cds.gb),
  [GG-tag.gb](files/GG-tag.gb), [GG-term.gb](files/GG-term.gb) and the
  `GG-broken-*` and `GG-warn-*` files.

### Modular cloning

Golden Gate with a standard: every part is cut for its own position, so any
promoter fits in front of any coding part. Do Golden Gate first.

- **[MoClo plant standard](modular.md)**: promoter, coding part and terminator
  go into a level-1 destination in one reaction; one part at the wrong position
  shows what the panel says; then two promoters by two coding parts make four
  constructs from one plan. Intermediate, about 25 minutes. Files:
  [MC-L1-Destination.gb](files/MC-L1-Destination.gb),
  [MC-L0-Promoter-A.gb](files/MC-L0-Promoter-A.gb),
  [MC-L0-Promoter-B.gb](files/MC-L0-Promoter-B.gb),
  [MC-L0-CDS-A.gb](files/MC-L0-CDS-A.gb),
  [MC-L0-CDS-B.gb](files/MC-L0-CDS-B.gb),
  [MC-L0-Terminator.gb](files/MC-L0-Terminator.gb),
  [MC-wrong-position.gb](files/MC-wrong-position.gb).

### Gibson, In-Fusion and NEBuilder

No restriction site and no scar: each piece ends in the bases the next one
starts with, and an exonuclease, a polymerase and a ligase join them. Do the
Gibson tutorial before the In-Fusion one.

- **[Gibson: a vector and two inserts](gibson.md)**: a linearised vector and
  two inserts joined by 26 to 30 bp overlaps in a scrambled tab order, the
  panel's overlap and Tm report, the 2,379 bp circle, then one mismatched
  overlap and what the panel says about it. Intermediate, about 20 minutes.
  Files: [GB-Vector.gb](files/GB-Vector.gb),
  [GB-Insert1.gb](files/GB-Insert1.gb), [GB-Insert2.gb](files/GB-Insert2.gb),
  [GB-bad-Insert2.gb](files/GB-bad-Insert2.gb).
- **[In-Fusion and NEBuilder: one gene into a vector](in-fusion.md)**: cut a
  vector with EcoRV, let the app design the insert primers with homology tails,
  and read the circle they make, with a synthetic ORF and again with insulin
  from NCBI. Intermediate, about 20 minutes. Files:
  [pIF-Vector.gb](files/pIF-Vector.gb), [IF-gene.gb](files/IF-gene.gb).

### Overlap-extension PCR

No enzyme at all: each fragment is amplified with a tail that is its
neighbour's end, and the products anneal at the overlap and extend into one
molecule. Do Gibson first if you want the comparison.

- **[Overlap-extension PCR: a promoter, a gene and a tag](overlap-pcr.md)**:
  fuse three fragments from three templates, read the six primers the panel
  designs, the overlaps and the 769 bp fusion, try the overlap Tm, then one tag
  that is a base off the frame and the warning the panel gives. Intermediate,
  about 20 minutes. Files: [OE-Promoter.gb](files/OE-Promoter.gb),
  [OE-Gene.gb](files/OE-Gene.gb), [OE-Tag.gb](files/OE-Tag.gb),
  [OE-bad-Tag.gb](files/OE-bad-Tag.gb).

## Reference

- [Before you start](before-you-start.md): opening the files, enzyme ticks,
  what the Bench is, and what to do if a number does not match.
- [Sample files](sample-files.md): every file, what it is, and a plain download.
- The [user guide](../guide/README.md), and
  [Simulated cloning](../guide/12-cloning.md) in particular.
