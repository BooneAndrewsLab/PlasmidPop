# r8-provenance STATE (area 2, round 8; baseline d2a4a50)

Probes: src/__audit__/r8-provenance/ ; scripts/data here.

## Done
- Read BRIEF, audit.md sections, note 73, r7 STATE/gen/check, `git show f276cca`.
- Code read: trimTip (seqDocument.ts:524), bluntEnds (:691), narrowedAtTip/pieceOrigin (featureOrigin.ts:300-365), pcr amplify (pcr.ts:226-265), insert at tip does not grow a feature (range.ts:159), delete fixes codon_start (#160/#176).

## Check 1: r7 versions sweep re-run at HEAD (run.test.ts copy, gen.py/check.py copies), seed 2, 300 cases, 11,148 products
- 0 FALSE_JOIN, 0 BAD_TRANSLATION_REJOIN. bad_translation_carried 44, ALL in 'ed' mode (editor substitution, by design). rc/rcrc/bt/bf/btrc/bfrc now 0 (were M1 in r7) -> #199 fix verified on sweep.
- missed_rejoin 1756 all in mixed-version plans (by design #187).

## Next
- seeds 3,4 + seed 5 TRANSFORM 0.6
- targeted trim probe (gen_trim.py): bluntEnds trim/fill, rc on sticky linear docs, fwd/rev/join, codon_start, 0/all/partial-codon loss; check kept /translation, codon_start frame, origin record
- PCR probe vs pydna; mutagenesis Open mutant; gateway CDS over att

## Check 2: r7 sweep seeds 3,4,5(TRANSFORM .6): 34,160 products; 0 FALSE_JOIN/WHOLE_JOIN_OVER_CHANGED/BAD_TRANSLATION_REJOIN/TE; bad_translation_carried only 'ed' (editor). misses: mixed-version (by design) + 3 single-version blunt f/rc in seed 4 (low, not investigated).

## Check 3: trim probe (gen_trim.py / trim.test.ts / check_trim.py): independent cell model of bluntEnds trim/fill + reverseComplement (head/tail/trimStart/trimEnd), sticky linear docs, 1-3 ops, CDS fwd/rev/join near tips, cs 1-3, tables 1/11/4, partial flags, transl_except.
- seeds 1-5: 27,000 cases, ~54k CDS, ~11.9k with bases lost, ~41.9k kept /translation: 0 problems. Checked: sequence, coverage/reading, strand, codon_start frame, partial5 (#186 rule)/partial3, /translation dropped iff lost>0, origin from/to/key composition, transl_except relocation/drop, translateCds vs Biopython (allowing trailing partial-codon residue and Sec).
## Next: PCR probe vs pydna (mismatch in/out CDS, tail, rev primer, origin-spanning, CDS partly inside, Taq, span>L)

## Check 4: PCR probe (gen_pcr.py / pcr.test.ts / check_pcr.py), pydna amplify.pcr product oracle + textbook
- seeds 2-4 (9,000 cases, ~22k CDS, ~15k fully inside amplicon, 982 with mutated bases) + seed 5 with back-to-back overlapping primers (span>L, 2,000): product seq == pydna in all; 0 STALE_TRANSLATION, 0 kept /translation disagreeing with product bases, 0 /translation on pieces, 0 wrongly dropped. ~200 synonymous mismatches drop /translation (conservative, fine).
- SUSPICIOUS (PCR area, low, false refusal): seed-5 case 69 (ov69.json, ov.test.ts): circular back-to-back primers with overlapping 5' ends refused ("primers ... overlap") when one site's annealLength is longer than the other's span (reverse site [266,295) extended by a tail that happens to match, forward [275,294)); pydna gives 337 bp. pcr.ts:184 rule `span < f.annealLength && span < r.annealLength`. 20/~1200 overlap cases.
## Next: rejoin of trimmed pieces in multi-fragment, mixed-version plans (gen.py add all-bt/all-bf plans)

## Check 5: gen8.py (gen.py + per-case 3x all-blunted plans, modes bt/bf/btrc/bfrc/rcbt/rcbf, every version combo, circular+linear) with run8.test.ts; seeds 11,12: 36,216 products (13,032 blunted multi-part, 8,328 mixed-version), ~4k whole CDS w/ /translation in blunted products: 0 FALSE_JOIN / WHOLE_JOIN_OVER_CHANGED / BAD_TRANSLATION_REJOIN / TE; carried only 'ed'.
- seed-4 single-version misses (case 45 plans 11/13/18): oracle artifact - gene reappears on the other strand because the 1-bp flanking pieces happen to be complementary (b41 = comp b68); pieces are on opposite strands, refusal correct.

## Check 6: other CDS-rewriting paths
- Gibson: exact terminal overlaps -> same bases. Gateway: fragmentFromRange at crossovers within identical shared stretch -> whole CDS bases unchanged. GG: carries records, doesn't read them; clipped CDS lose /translation via extractRange.
- Mutagenesis "Open mutant" (MutagenesisPanel.tsx:276-284): applies design.edit as an editor edit -> template /translation kept stale, flagged in FeatureList; by the #179/item-66 policy (edits in the open document keep + flag). Noted, not a bug per policy.
- ORF "Add as CDS" writes /translation from the ORF protein (out of scope).

## DONE - report sent
