# 1. Amino-acid translation under CDS features

Done. One line per
CDS between the strands and the feature lanes, codon-aligned with
alternating shading, honouring `/codon_start`, `/transl_table`, joins,
reverse strand, partial ends and origin wrap
(`src/core/analysis/cdsTranslation.ts`, `drawTranslations` in
`renderLinear.ts`); "Translations" toggle in the toolbar.

- **Translation scope, #304.** A fetched region with seven isoforms drew
  seven overlapping lines. `translatedFeatures`
  (`src/core/analysis/translationScope.ts`) filters the coding features
  before lane assignment: All (the old behaviour), Selected, or One per
  gene (the default: longest total segment length per `/gene`, then the CDS
  named after the gene, then listing order; a gene-less CDS is its own
  group; the selected CDS always stays). Display only: hit-testing, codon
  drag and the Translate tab read every CDS. Stored in the view prefs as
  `translationScope`; `exportLinear` takes `translationScope` and
  `selectedFeatureId`, defaulting to All when absent.
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

- **Re-checked as the sequence is edited** (#2, 2026-09-23). Decided: yes,
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

- **Split and unfinished codons, #318.** The stub of a codon split by a
  join (INS `join(249..435,1223..1368)`: base 435 `G` is codon 63, finished
  by `TG` at 1223-1224) was a tint with no letter, which read as a rendering
  glitch, and a CDS with an open end (`249..>435`) left a codon that never
  finishes and drew nothing for it. Chosen from mockups B, E and D:
  - _Split (B)._ `codonRuns` (`src/core/analysis/splitCodons.ts`) cuts a
    codon's bases into the stretches a row draws and says on which side each
    is open: more of the codon later in reading order lies right of a
    forward-strand stretch and left of a reverse one. The stretch without the
    middle base gets the letter at 35% opacity (the stop colour for `*`) and
    a dotted 2 px edge in the theme's caret colour on its open side. The same
    rule covers a row break and the origin of a circular record, so a codon
    cut only by the drawing is marked where it is cut; it has no tooltip,
    since nothing splits it in the sequence. A split is told from a whole
    codon by `codonPieces`: bases that are neighbours on the sequence (the
    last and the first base are, on a circular one), read down on the
    reverse strand.
  - _Unfinished (E)._ `translateCds` returns the one or two last bases of a
    3'-partial CDS that make no codon as `CdsTranslation.leftover`; a closed
    CDS that stops short lists none, since nothing was left open. They, and
    the two-base part codon of #142, are drawn hatched under a dashed outline
    in the muted ink with no solid tint, so they cannot be taken for a split
    stub. The part codon keeps its letter: that residue is in NCBI's
    `/translation` and in our protein, so hiding it would disagree with both.
  - _Tooltip (D)._ `codonNoteAt` words it, in the app's 1-based positions,
    with the three-letter name from `AMINO_ACID_NAMES` (the one letter where
    there is none, as for `U`) and U for T in an RNA record. A pointer over a
    translation line uses the existing follow tooltip; a touch has no hover,
    so a tap shows it for `TAP_TIP_MS` and the next tap or touch removes it
    (the canvas's `pointerleave`, which a lifting finger fires, does not).
  - The hatching is drawn by hand, as clipped diagonal lines, because the
    drawing context the SVG export shares has no clip.
