# r7-provenance STATE

## Done

- Read ROUND7, BRIEF, audit.md, r6 provenance STATE; diff a2734eb..HEAD (featureOrigin bases hash + sameOriginal, rejoin whole-only bases check, seqDocument.trimTip/narrowedAtTip in reverseComplement).
- Only caller of rejoinPieces: ligate.ts:197 (gibson/GG/gateway/emptyVector/documentFromFragment go through ligate).

## Next

- run copied r6 h1/q2 probes (expect #187/#188 fixed)
- versions sweep (gen.py/run.test.ts/check.py)

## Check 1: r6 repro probes (h1.test.ts, q2.test.ts copied) at HEAD

- #187 repro (P backbone + P2 ins18 insert, fwd + rc + del6 + subst): pieces now stay apart (honest partials, origins valid). FIXED.
- #188 repro (q2 case D, BamHI fragment doc replace K->R, emptyVector, fwd+rc): pieces stay apart, no stale /translation. FIXED.
- q2 rest unchanged (partial digest, setOrigin recut, flip) still whole with Sec.

## Versions sweep built: gen.py / src/**audit**/r7-provenance/run.test.ts / check.py

- v1 random plasmid (CDS w/ correct /translation from translateCds, joins, rev, across origin, TE Sec), v2 = v1 + 1-2 edits (sub/ins/del/replace, 80% in features), same ids; planted palindromic sites; plans mix versions, flip f/ff, doc rc/rcrc, doc, ed (post-cut substitution), blunt bt/bf(+rc), emptyVector, linear.
- oracle: rejoined (not a shifted part feature) must be a run of some version's same-named feature (genomic bases incl. introns, exon structure, partial flags w/ #186 skip rule, codon_start, TE index); /translation = Biopython reading or faithful source carry.
- seed1 60 cases 2280 products: 0 FALSE_JOIN, 0 BAD_TRANSLATION_REJOIN. bad_translation_carried 18 = editor stale /translation after 'ed' on a whole (never cut) CDS - editor behaviour, flagged by translationCheck, out of area. missed_rejoin(low) 369 - investigating.

## Check 2: versions sweep seeds 2,3,4 (300 cases each; 34,140 products, 29,268 rejoined (21,733 whole), ~94k CDS, ~36k with /translation)

- 0 FALSE_JOIN, 0 WHOLE_JOIN_OVER_CHANGED_BASES, 0 BAD_TRANSLATION_REJOIN, 0 TE_WRONG/TE_EXTRA, 0 TRANSLATION_ON_PIECE, 0 oracle_vs_pp protein.
- missed_rejoin(low) ~1.6k/seed: ALL in plans mixing v1+v2 pieces (by-design refusal from #187 fix: records of different versions never join even when product == one version base-for-base). Zero misses in single-version plans.
- bad_translation_carried: only in modes ed (editor stale, by design/flagged), rc/rcrc/bt/bf/btrc/bfrc. Never f/ff/n/doc.

## FINDING M1 (medium, pre-existing): tip trimming by SeqDocument.bluntEnds (seqDocument.ts:689ff, plain delete) and SeqDocument.reverseComplement (trimTip, seqDocument.ts:525) keeps /translation of a whole CDS whose end lay on the overhang

- probe src/**audit**/r7-provenance/tipTrim.test.ts: C20+ATGAAATTTCGGTAC+C+A40 circ, CDS[20,35) /translation=MKFRY, KpnI single cut (3' GTAC overhang carries CDS last 4 bases).
  bluntEnds('trim') -> CDS [61,72) 3'-partial, /translation MKFRY, bases give MKFR; emptyVector keeps it. doc.reverseComplement same (rev [0,11) MKFRY). flipFragment drops /translation and gives record [0,11] (#179 rule).
- Also: no piece record (origin) on the trimmed whole CDS in these paths (narrowedAtTip only narrows existing records), unlike flipFragment -> can't rejoin later (low).
- Visible: FeatureList marks stale (translationCheck length/residue) -> medium per brief scale; same symptom class as #188 (rated medium).

## Next: targeted near-variants (#188 PCR mismatch path; IUPAC/lowercase hash; circular origin rc; old shelf records w/o bases)

## Check 3: seed 5 (300 cases, TRANSFORM_P 0.6: v2 = rc(v1) or setOrigin(v1), 'm' mode = same molecule from v2): 11,934 products, 9,449 rejoined (7,119 whole): 0 FALSE_JOIN/BAD_TRANSLATION/TE. Cross-version rc/setOrigin pieces rejoin (blunt: 0 pieces left; sticky leftovers = flipped-overhang by design).

## Check 4: hash.test.ts: upper/lower-cased fragment, IUPAC N in CDS, fwd+rev: rejoin whole w/ correct translation. Old records without `bases`: stay apart (by design), no crash.

## Check 5: pcr.test.ts: PCR insert (EcoRI-BamHI inside CDS) ligated into P backbone. rev strand: no mismatch -> whole w/ correct /translation; primer mismatch inside piece -> pieces apart (fixed #188 PCR path). fwd strand: CDS fully inside amplicon is whole in PCR product with new id -> never rejoins with backbone (low false refusal, key differs).

FINDING M2 (same class as M1): pcr.ts:239-251 a whole CDS inside the amplicon keeps template /translation when a primer mismatch falls in it (MKEFKLRKLRGSKKK vs bases MKEFKLSKLRGSKKK). Flagged by FeatureList stale mark.

## Check 6: gibson.test.ts two halves of P (A[0,75), B[50,180)) fwd+rev: whole rejoin w/ correct translation; one half edited outside overlap -> pieces apart. CLEAN.

## Check 7: vitest src/core/cloning src/core/document src/core/features src/test/oracle: 1050 pass, 3 skipped.

## Totals seeds 1-5: 48,354 products, 40,740 rejoined features (30,280 whole), ~50.6k CDS with /translation checked vs Biopython. 0 HIGH.

## DONE - report sent
