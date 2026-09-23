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
  neither side claims to know are excused — an `X` on either side, and the
  `U`/`O` of selenocysteine and pyrrolysine, which come from the
  `/transl_except` we still do not read. The six committed records state
  19 proteins and agree with us on all of them, which is a test
  (`src/io/genbank/storedTranslation.test.ts`, local fixtures included
  when present).
- Not yet: `/transl_except`; re-checking a `/translation` as the sequence
  is edited (the check runs at open, not per keystroke).
