# ui-wiring audit — STATE (paused by orchestrator)

## Done (code reading, all by grep/scoped reads — no tests run yet)
Traced UI→core→display for: PrimerPanel (design/check/add features/save), PrimerCollection
(worker search, hitFeature, primerFromFeature, CSV/FASTA export), PrimerSettings (GC %→fraction,
number boxes), PcrPanel + primerToPcr (template = history.present, useMemo on pcr()), MutagenesisPanel
(codonSiteAt/codonOnForwardStrand/applyCodon, designMutagenesis, Open mutant = template + apply(edit)),
OverlapPrimerDesign (insert = selection/featureExtent/whole), GibsonPanel/GoldenGatePanel/LigationPanel/
GatewayPanel (preview and run use identical options; docs = history.present or documentFromFragment),
useTube, CloningPanel digest (tickedSites → cuttableSites(methylation) → digest/partialDigest → shelve),
clipboard.ts + fragmentFromRange (copy = extractRange, case preserved), sequenceExport.ts
(readExportRange/rangeBoxes), saveFile.ts + FileMenu exports (present doc; selection via extractRange),
share.ts + io/share/link.ts (GenBank deflate/base64url; selection via extractRange), workers
(analysisProtocol pack/unpack, analysisClient, analysis.worker), useAnalysis + editorStore.setAnalysis
(identity check `history.present === doc`), carryAnalysis (provisional carry-over).

## Findings so far (from reading; tests written but NOT yet executed)
1. PrimerPanel designed pairs are remembered per documentId only (useRemembered 'primers.pairs',
   src/app/components/PrimerPanel.tsx:135) and never invalidated by an edit. After inserting/deleting
   bases, the old pairs stay listed; "Add both as features" (lines 302-327) places primer_bind at the
   OLD coordinates on the NEW document, and "Save both" saves oligos designed for the old template.
   Likely severity: high (stale oligos offered for ordering; mis-placed features). Test written.
2. CloningPanel digest runs on provisional (carried) analysis: `ready = analysis.doc === doc` ignores
   `analysis.provisional` (CloningPanel.tsx:240-290). carryAnalysis (editorStore.ts ~258-300) keeps a
   site when positions map unchanged, so a same-length substitution that destroys a site leaves it in
   the list; fragments can be shelved in the ~150 ms+ window before the worker answers (longer if the
   worker errors — useAnalysis only `fail()`s). Severity medium-low (transient). Test written.
3. Wrapped-range display: PrimerPanel target note and designedFor show `start+1–end` with end > length
   (e.g. "591–620" on 600 bp); OverlapPrimerDesign.describeSpan same. StatusBar/PcrPanel/PrimerCollection
   use modulo correctly. Low/cosmetic. Test written.
4. MutagenesisPanel strips 'U' and any non-IUPAC char from the change box silently (line 245). Low.
5. useAnalysis: if the worker request fails, provisional analysis persists indefinitely (no retry). Low.

## Verified clean by reading (no bug seen)
PCR panel recomputes from current template; Gibson/GG/Ligation/Gateway preview == run options;
setAnalysis identity check prevents stale worker results; PrimerCollection guards stale answers by
(doc, primers, limits) identity; featureSequence reverse-complements reverse features (primerFromFeature);
cut position display = `cut` (bases before cut, SnapGene convention); EnzymePanel selectSite uses
siteStart..siteStart+len; export/share use extractRange; GenBank parser merges origin-spanning joins.

## Test file written (not yet run)
/home/matej/code/WebstormProjects/PlasmidPop/src/__audit__/ui-wiring/seam.audit.test.tsx
Covers: stale pairs after edit; wrapped target note; add-feature for site over origin;
rotation invariance of designPrimers/designMutagenesis with wrapped ranges; MutagenesisPanel codon
change on forward/reverse CDS incl. over the origin (render + Open mutant → translateCds);
provisional digest shelving; export/share of wrapped selection round trip; readExportRange/rangeBoxes;
pack/unpack cut sites. NOTE: the share test guesses `readShareLink`'s name/return shape — fix imports
from src/app/share.ts (grep export) before running.

## Next step
export PATH=/home/matej/Programs/miniconda3/envs/node/bin:$PATH
npx vitest run src/__audit__/ui-wiring   # fix import names, read console.log evidence, then
confirm/refute findings 1-3, add a PCR-panel check (product sequence/dephosphorylated flag) if cheap,
then write the final report via SubagentHandback.

## RESUMED 09:38 — tests executed
`npx vitest run src/__audit__/ui-wiring` → 16/16 pass (assertions encode the findings).
Finding 1 CONFIRMED end to end (Rev primer feature at [470,494) reads TGTGTGACGCTTGCAGACCAAGTG, note says CAACTCTTCTTGTGTGACGCTTGC after a 10 bp insert).
Finding 2 CONFIRMED (provisional digest offers 2 fragments; shelved fragment ends BamHI/EcoRI though GAATTC no longer exists).
Finding 3 CONFIRMED (note "Target 591–620 (30 bp)" on 600 bp circle).
Clean: codon change fwd/rev/over-origin, rotation invariance of designPrimers/designMutagenesis, export/share of wrapped selection, readExportRange/rangeBoxes, pack/unpack, primer sites over origin → features.
Added sites.audit.test.tsx. Final report delivered via SubagentHandback.
