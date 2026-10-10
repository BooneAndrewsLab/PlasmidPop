# 80. Verify clones (#218)

**Asked:** a plate of whole-plasmid sequencing consensuses, one a clone,
checked against the construct(s) they should be: which clones match, which
differ inside a feature, which only outside, which are not the construct at
all; a table, a click to the comparison, a CSV. Mixed plates, with clones
matched to constructs by best fit or by file name.

**Built:**

- `core/verify/variants.ts`: an alignment's mismatch and gap columns grouped
  into variants (SNV, substitution, insertion, deletion, and extra / missing
  region from 20 bases, `EXTRA_FROM`), in the construct's 0-based half-open
  coordinates, then placed on its features by `placeVariants`. A CDS hit by
  an indel whose size is not a multiple of three is a "frameshift in CDS x";
  a deletion covering a whole feature says it is deleted; anything else is
  "<type> <name> changed". `source` is skipped, as it spans everything. An
  insertion counts as inside a feature only strictly inside a stretch of it.
- `core/verify/verify.ts`: `verifyClone`, one clone against a set of
  constructs, never throwing for one it cannot align. The construct is the one
  whose file-name pattern is in the clone's name (longest wins), else the one
  sharing the most 16-mers (both strands, wrapped for a circle). A clone
  sharing under 5% is "wrong construct" without being aligned. Otherwise a
  circular clone is turned with `alignToDocument` (item 33), then its origin
  is made exact by finding the construct's first (or last) 24 bases in it,
  because the anchor vote can be a base or two out when the clone has an
  indel, which showed as an insertion at the start and a deletion at the end.
  It is then aligned globally (`alignEitherStrand`, `fast`, in the worker;
  one request a clone, injected as `VerifyAlign`). Under 75% identity
  (`WRONG_IDENTITY`) it is the wrong construct. `verifyCsv` writes the table.
- `app/verifyClones.ts`: reading the files (`readSequenceData`, so gzip and
  every format open), and `verifyPlate`, the clones one after another with
  progress and cancel, up to 384.
- UI: **File ▸ Verify clones…** (`VerifyClonesDialog`, `shared.verifyDialog`).
  Expected constructs are the open DNA tabs. A row opens Compare with…
  (`ComparisonSource` `clone`, the clone held in memory) after bringing the
  construct's tab forward; its Open button makes the clone a tab. Analytics
  `verify`: `run`, `csv`, `compare` (item 38), never names or counts.

**Decided:** identity is the alignment's, over all columns, so a clone missing
a quarter of its construct is "wrong construct" rather than "missing region";
the verdict is for the plate-level question, and the comparison has the
detail. Ambiguity codes in a consensus are not differences, only counted.

**Not done:** the ZIP of #213 as input (that issue is in 1.16, and a ZIP is
not read yet), the protein effect of a base change in a CDS (missense,
nonsense, silent), choosing the construct by anything but 16-mers and the file
name, and a trace or map of the clone's differences in the dialog.
