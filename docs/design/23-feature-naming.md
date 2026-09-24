# 23. Feature naming: `/gene` outranks `/product`, so one gene's name spreads over every feature that mentions it

Fixed 2026-09-21. Noticed 2026-09-20 on the bundled
example, which appears to show "two tet features at 86..1276". It is not
a parsing bug: J01749 really carries `gene 86..1276 /gene="tet"` and
`CDS 86..1276 /gene="tet"`, which is how NCBI writes a gene, and `bla` at
`complement(3293..4153)` is the same pair. What makes the pair read as a
duplicate is `deriveFeatureName` (`src/io/genbank/parseGenBank.ts`), whose
`NAME_QUALIFIERS` precedence is one global list —
`label, gene, product, locus_tag, standard_name`. Two consequences: the
CDS is shown as `tet` rather than its own
`/product="tetracycline resistance protein"`, which is exactly what would
have told the two rows apart; and `/gene` on a _non-gene_ feature is a
cross-reference to the gene it sits in, not a name, so
`misc_feature 146..147`, `misc_binding 411..414`, `misc_difference 426`,
`misc_binding 469..472` and `old_sequence 526..528` are all labelled
`tet` too — 7 features named `tet` and 4 named `bla` in one 50-feature
record.

- **The precedence is type-aware now.** `NAME_QUALIFIERS` is gone;
  `nameQualifiersFor(type)` gives `gene` → `label, gene`; `CDS` and the
  transcripts (`mRNA`, `tRNA`, `rRNA`, `ncRNA`, `tmRNA`, `misc_RNA`,
  `precursor_RNA`) → `label, product, gene`; everything else →
  `label, product` and _not_ `gene`, each ending in
  `locus_tag, standard_name` so a CDS or gene carrying only a
  `/locus_tag` still has a name. Unnamed falls back to the empty string,
  since the list and the map already show the type (`misc_binding
411..414` reads as itself). On the bundled example: `tet` and `bla`
  went from 7 and 4 features to 1 each, the two CDSs took their own
  `/product`, and 38 unnamed features became 44 of 50.
- **Round-trip survives it**, checked rather than assumed: the fixtures
  pass, and the writer now asks the _same_ question the parser does —
  `featureLines` compares the name against `deriveFeatureName(type,
qualifiers)` rather than against any qualifier in a global list. That
  also fixes a case the old check got wrong: a CDS renamed to its
  `/product` while still carrying a `/label` of its own wrote no
  `/label` and read back under the old one.
- **A `gene` that exactly coincides with a `CDS` of the same name is
  drawn once** (#28, 2026-09-24), as SnapGene does: `drawableFeatures`
  leaves out a gene whose name, strand and every segment match a CDS's,
  and the CDS keeps the bar because it has the translation. Display only —
  the feature list shows both and both are written back out — and since
  `drawableFeatures` feeds every view and export, the map, the sequence
  view and the SVGs agree. After the naming fix the bundled example has no
  such pair (`tet` the gene is `tet`, its CDS the product's name); it is for
  a file where both carry the same `/label`.
