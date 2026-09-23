# 1. Amino-acid translation under CDS features

Done. One line per
CDS between the strands and the feature lanes, codon-aligned with
alternating shading, honouring `/codon_start`, `/transl_table`, joins,
reverse strand, partial ends and origin wrap
(`src/core/analysis/cdsTranslation.ts`, `drawTranslations` in
`renderLinear.ts`); "Translations" toggle in the toolbar.

- **Every genetic code, 2026-09-21.** `codons.ts` shipped tables 1 and 11
  and they shared one codon map, so they differed only in start codons;
  anything else a file asked for was read with the standard code and
  nothing said so. A `/transl_table=2` gene came out chopped at the first
  TGA, which is tryptophan under that code. All 27 NCBI codes are now
  generated from NCBI's own `gc.prt` by `scripts/make-genetic-codes.py`
  into `src/core/analysis/geneticCodes.ts` — a hand-copied 64-character
  string is how a translation table ends up quietly wrong — and compiled
  to maps on first use. `TranslationTable` is the union of the ids we
  ship; `isStopCodon` takes one too, without which `findOrfs` ended an ORF
  at a codon the chosen code reads as an amino acid. A `/transl_table`
  naming no code NCBI uses (7, 8 and 17–20 were withdrawn) falls back to
  the standard code and says so in `CdsTranslation.unknownTable`.
- **Checked against the file's own `/translation`, 2026-09-21**
  (`src/core/analysis/translationCheck.ts`). Most records state the
  protein they expect; that qualifier is the one honest oracle for the
  genetic code, `/codon_start`, splicing a `join(...)`, the reverse strand
  and a CDS that wraps the origin, because someone else translated the
  same bases. `checkTranslations` compares them when a file is opened and
  reports a disagreement through the status bar's parse warnings
  (`src/app/translationWarnings.ts`): the feature, where it is, the first
  residue that differs, eight at most and the rest counted. Residues
  neither side claims to know are excused — an `X` on either side. The
  committed records state 20 proteins and agree with us on all of them,
  which is a test (`src/io/genbank/storedTranslation.test.ts`, local
  fixtures included when present).
- **`/transl_except`, 2026-09-23.** Until now the check excused every `U`
  and `O` in a stored `/translation`, because the selenocysteine and
  pyrrolysine they stand for come from `/transl_except` and we did not read
  it; the translation on screen showed a stop there. `translateCds` now
  applies each `(pos:…,aa:…)` to the codon whose three bases it names
  (`applyExceptions`), the start codon included, and the excuse is gone, so
  a `U` the record cannot account for is reported. The exception must name
  exactly one codon of the feature, in frame; one that does not, or names an
  amino acid INSDC does not list, is left unapplied and reported
  (`unused-exception`). A `TERM` of one or two bases is the stop the poly(A)
  tail completes past the annotation and has no codon of ours to change, so
  it is accepted silently. `NM_000581` (human GPX1, Sec at residue 49) is
  committed as the real-record test.

  The harder half was that the qualifier holds absolute 1-based positions,
  exactly like the feature's own location, and nothing moved them: an
  insertion upstream would have left the exception naming the wrong codon,
  and three bases would have made it silently name the next one. The
  GenBank location grammar moved from `src/io/genbank/location.ts` to
  `src/core/features/location.ts` so the core can read and write it, and
  `moveFeature` (`src/core/features/locatedQualifiers.ts`) moves a feature
  and every located qualifier it carries — `/transl_except` and `/anticodon`,
  both `(pos:LOCATION,…)` — by the same function. Every path that moves
  features goes through it: insert, delete, replace, reverse complement, set
  origin, extract (so copy, digest, Gibson and Golden Gate), paste, PCR,
  ligation, and the Edits/Compare diff, which would otherwise have reported a
  moved exception as an edited qualifier. A located qualifier whose base
  count changes on the way (an edit inside its codon, an extract that cuts
  it) no longer means what it said and is dropped; one we cannot parse is
  kept as it was, unmoved, rather than lost. Topology changes need nothing:
  the text is the same, only its reading differs.

- **Re-checked as the sequence is edited** (#2, 2026-09-24). Decided: yes,
  with the marker on the feature. `translationProblems`
  (`src/app/state/translationProblems.ts`) checks every coding feature of
  the version on screen, keyed in a `WeakMap` on the feature object and the
  bases under it: features are immutable, so one an edit did not touch is
  the same object in the next version and is not translated again, and one
  pushed along by an edit upstream is a new object with the same bases,
  which is the other half of the key. The feature list puts a ⚠ on the row
  of a CDS whose claims its bases do not bear out, and under the selected
  row says what disagrees, with **Update /translation** (rewritten from the
  bases, `translationFor`) and **Remove /translation** when the stored
  protein is what disagrees — each one `updateFeature`, so one undo. A
  record that disagreed when opened is flagged the same way, which the
  status-bar warning at open already said. The fix is in the list rather
  than the feature editor because the editor holds its qualifiers as form
  state, and a button rewriting one underneath it would race the form.
