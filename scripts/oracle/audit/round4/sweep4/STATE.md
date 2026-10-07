# sweep4 STATE
Area: 4th audit sweep of e1d25c4 (cut label at origin), 260e037 (hit slop across origin), a5cd6f2 (AB1 PLOC), bcf0729 (SnapGene negative readingFrame) + neighbours.
## Done
- read brief, audit.md, fix diffs
## Next
- item 1: grep every place cut/site positions shown/exported
- item1 DONE clean: cutLabel via findCutSites+exportMapSvg labels vs Biopython search(linear=False) — 450 circular cases (15 enzymes incl Type IIS both orientations; 36 cuts exactly at origin, rotations ±2 around top & bottom cut). Probe src/__audit__/sweep4/cutlabel.test.ts + cutlabel.py
- item1 digest fragment ends at/near origin vs pydna Dseqrecord.cut: 638 cases clean (watson+crick+overhang text), 2 refused by pydna. digestOrigin.test.ts/.py
- No other numeric cut display found (linear map shows names only; CloningPanel describeRange ok by reading)
- item2 DONE clean: hitslop.test.ts — every angle inside the drawn tiny-feature mark (selectionSweep MIN_FEATURE_PX) → baseOf → featureAtLane hits the feature; N in {400..1e6}, features [0,1),[N-1,N), wrapping [N-1,N+1),[N-2,N+2), zoom 1/4/30: 5355 angles, 0 misses. Read: FeatureSet.overlapping/rangesOverlap ok with negative query start; cutSiteAt/changeAt use wrap-safe angleGap/onSweep.
  - LOW note: featureAtLane widens only if whole feature < MIN px, but drawing widens per segment → a tiny segment of a multi-segment feature drawn wider than its hit area (hover cosmetic).
## Next: item3 AB1 PLOC
- item3 DONE clean: Biopython Tests/Abi downloaded to $S/dl (8 ab1) + src/io/fixtures/abif (3). abif_variants.py makes 58 files: orig, PBAS2 indel w/o own PLOC2/PCON2 (expect none), PBAS2==PBAS1 w/o own (expect other copy; also lowercase PBAS1), shorter PBAS2 with own, own PLOC2 wrong length, PBAS2 trailing NUL, PBAS2 absent. abif.test.ts + abif_compare.py: 0/58 mismatches; orig files equal Biopython SeqIO abi (seq, phred, PLOC2).
## Next: item4 SnapGene readingFrame
- item4 DONE clean: 203 SnapGene samples, all 862 CDS with /translation translated by parseSnapGene+translateCds vs file /translation: reverse -2 (3), -3 (1), forward 2 (5), 3 (1), reverse -1 multi-seg (87), wrap (2): all match except known conventions (TOPO lacZα codon_start 3 #154 rule x6, first codon M x1 thrombin, X vs '?' ambiguous x3). Synthetic (sg_synth.py): 180 files, rf ±1..3 x stale codon_start x {single, join, wrapping single, wrapping join in natural order, 3-seg wrap} x both strands, vs Biopython translate: 0 bad.
- item5: CONFIRMED LOW: featureAtLane slop only when whole feature < MIN px; tiny segment of joined feature [100,101)+[1000,30000) N=1e6: drawn mark spans bases 999020..1180, only 5/51 angles hit (hitslopMulti.test.ts). Checked clean by reading: hostMethylationAt window wraps; digestFragments; selectSite unrolled end; SEC13 CDS with gap segment translation matches.
## ALL DONE — report sent
