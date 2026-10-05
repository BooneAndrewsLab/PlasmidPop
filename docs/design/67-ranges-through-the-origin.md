# 67. Ranges through the origin, as a person reads them (#143)

**Found:** the 2026-10-05 correctness audit. A range is `[start, end)` in
unrolled coordinates, so one through the origin of a circle has `end` past
the length (`[590, 620)` on a 600 bp plasmid). The status bar, PCR, My
primers, ORFs, the digest's fragments, lineage, extracted-range names and
the SVG export already folded the end back with `((end - 1) % L) + 1`, each
on its own. Others printed the unrolled end:

- **Primers**: the target note said `Target 591–620 (30 bp)`, and the
  design's "designed for" text (in "No suitable pairs for …" and the note
  saved with a primer in My primers) the same.
- **Insert primers** (Gibson ▸ In-Fusion / NEBuilder): the Insert choices
  wrote a selection or feature through the origin as `591–620, 30 bp`.
- **Review ▸ Features** (edit marks, What changed): a feature through the
  origin was `41..60` on a 50 bp circle.
- **Protein properties**: the selection note, for the same reason, though a
  protein is linear in practice.
- **Mutate**: `describeChange` took the old bases with
  `template.slice(start, end)`, which stops at the end of the string, so
  `[2498, 2502)` on a 2,500 bp circle was labelled `TT2,499–2,502CATG`. It
  reads round the origin now and wraps the end: `TTCT2,499–2CATG`. The
  primers, product and mutant were always right; only the label was not.

**Built:** `oneBasedEnd(end, length)` and `formatSpan(range, length,
separator)` in `core/range`, used by the panels above. The places that
already wrapped were left as they are.

**Checked, already right:** GenBank locations (`formatLocation` writes the
two pieces), Detect features and the Features list (both via
`formatLocation`), Translate and six-frame export (`rangeBounds`), the
reads batch list, alignment positions and verdicts. Alignment column ranges
are columns of a linear stack and do not wrap.
