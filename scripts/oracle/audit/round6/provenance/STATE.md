# r6-provenance STATE
## Done
- Read brief, audit.md, design 73, featureOrigin.ts, extract.ts runs section.
## Hypotheses
- H1: rejoinPieces `follows` checks only origin.key + to/from + placement, never that the two records are the same (whole/span/gaps). Pieces sharing a key from two versions of a doc (mutagenesis mutant keeps feature ids — mutagenesis.ts:306; or edit between two digests) can join with head's record -> wrong length/located qualifiers. Exon substitutions never checked (only intron hash).
## Next
- probe src/__audit__/r6-provenance/h1.test.ts
## CONFIRMED F1 (H1) — src/__audit__/r6-provenance/h1.test.ts
featureOrigin.ts:399 follows() compares only origin.key (+to/from, placement). P = circ 'C'*20+CDS(42, Sec TGA transl_except pos:54..56)+'C'*40; P2 = P.insert(35, GCT*6) (feature id kept, as mutagenesis mutant does, mutagenesis.ts:306). EcoRI+BamHI both; ligate [P backbone, P2 insert] circular ->
 CDS [77,119) not partial (42 bp, real gene 60 bp running to 17), /transl_except pos:111..113 lands on an AAA codon -> protein MKEFKAAAAAAUKK (fake Sec), origin {from 0,to 43, span 42} invalid; plus a leftover 5'-partial piece [0,17).
 Substitution variant: joins whole with stale WT /translation (same as editor's own stale-translation behaviour; low).
 Mutant bb + WT insert: joins first two pieces with mutant record -> 3'-partial piece, honest-ish (low).
## Regression sweep (round-5 gen/check copied to scratch, check.py partial rule patched for #186: e5 = ix0 > skip or orig p5)
- seeds 3,4,5 (400/500/500 cases, ~12k plans, ~32k CDS) + seed 6 linear: 0 false join, 0 missed rejoin, 0 protein/TE/partial/codon_start errors; only by-design flipped-overhang lost annotation.
- round5 restore/repro/flip186/skip186 probes pass.
## Next: Q2 neighbours (reverseComplement doc, setOrigin, paste, gibson/GG, partial digest), Q3 blunt variants, Q4 suite.
## Q2 probe q2.test.ts (run with --reporter=verbose to see console)
- CLEAN: doc reverseComplement / flipFragment of BamHI-cut fragment (pieces stay apart as overhang annotation dropped - by design), GenBank reload (origin lost, stays 2 pieces, labels added), partial digest (both 102-bp single-site-missing fragments close to whole CDS w/ Sec), 3-fragment flip/setOrigin(0,5,30,70,100)/recut/flip-back/religate -> whole CDS + Sec, both orders.
- F2 (medium): substitution in a piece after the cut (fragment doc .replace) -> emptyVector rejoins to whole CDS and RESURRECTS the original /translation (piece itself had none): fwd MKEFKKKKGSKUK vs actual MKEFKKKKGSRUK; rc twin same. Exon bases never verified (only intron hash). Same mechanism for PCR primer mismatches inside a clipped piece (pcr.ts:239-251 fromPrimer substitutes, features shifted keep origin).
- note (low): doc.reverseComplement trims via delete edits (seqDocument.ts onBottomStrand) leaving origin stale (o [25,42] on 13-bp piece); harmless (placementOf rejects).
## Next: Q3 blunt variants, Q4 existing tests.
## Q3 #183 blunt sweep (gen_blunt.py, blunt.test.ts, check_blunt.py; pydna T4('ACGT') for fill, mung() for trim)
- 300+600 cases (21 single cutters incl BsaI/BsmBI/SapI/BglI/BstXI/3' and blunt cutters; 7 enzyme pairs), fill/trim, closed via emptyVector(doc) and after GenBank round trip: 1738 products, 0 null, product seq = pydna, 0 false rejoin / unmarked partial / missed rejoin (blunt cutters rejoin), protein = Biopython table 11, frame ok. CLEAN.
- #186 near variants covered by regression sweep (codon_start 1-3, both strands, flips, Biopython protein + patched partial rule): CLEAN.
## Next: Q4 run existing tests; then maybe mutant-as-insert F1 variants (reverse strand, join intron).
## Q4: vitest src/core/cloning src/core/document src/core/features src/test/oracle: 976 pass. editing.py/json cut5 rule changed deliberately with #186 (lost > skip5) - consistent with design addendum.
## F1 variants: reverse strand identical (fake Sec, origin [0,47] span 42); del6 in mutant insert -> 3'-partial joined piece of correct length (honest). Insertion direction is the harmful one.
## DONE - report sent
