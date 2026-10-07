# cut-ligate STATE (round 5)

## Done

- Read ROUND5.md, BRIEF.md, audit.md, extract.ts, ligate.ts (#181 diff), design 10 (#169/#174/#181).

## Plan

1. gen.py -> cases.json (random circles, CDS fwd/rev, codon_start 1-3, joins, origin, transl_except; synthetic CutSites with d in -4..4; plans: self-close, flip, 2-frag order/swap/flip, dropout, two sources same feature name).
2. src/**audit**/round5-cut-ligate/run.test.ts reads cases.json, runs digest/flip/ligate/emptyVector, writes out.json.
3. check.py: base-identity model; per output feature check bases contiguous in source reading, codon_start frame, partial marks, protein vs Biopython, transl_except, coverage, missed/false rejoins.

## Findings

(none yet)

## Next step

write gen.py

## Findings so far (run 1: 300 cases, 1868 plans, 4230 CDS)

- F1 (medium?): transl_except whose codon straddles a cut is dropped from both pieces (ok) but NOT restored when #181 rejoins the pieces into the whole CDS -> religated/empty vector CDS translates the codon by the table (case 52 seed 1: f1 reverse join, TE complement(36..38), cut at 37). 22 hits.
- Tandem identical copies: dropout religation rejoins F2-5' + F1-3' into one full CDS: bases identical to unit, so arguably correct (not a bug). Checker to treat as in-frame chimera.
- Lost annotation: flipped fragments with 3' overhang lose the overhang bases' annotation (flipFragment trims them, head adds bases unannotated). To categorize.

## Run 2 (seed 2, 400 cases, 3519 plans, 9242 CDS) results

- product sequence: all match identity model. codon_start, partial marks, stale /translation: 0 errors. missed rejoin (non-flip): 0.
- protein mismatches: 40, ALL are the TE-straddle case (F1). Confirmed: transl_except codon cut by top/bottom cut -> dropped from both pieces; #181 rejoin does not restore -> religated whole CDS reads codon by table.
- CDS chimeric rejoins: all in frame (frame gate works). Tandem identical copies (182) fine.
- F2 (low/medium): in-frame deletion (dropout of middle fragment / reordered fragments) rejoined into an unmarked "whole" feature (11 CDS, 3 misc w/o frame gate). Cross-source same-name misc pieces rejoined (20), CDS 2.
- F3 (low, by design item 34): flipped sticky fragment loses overhang-base annotation, so its pieces stop |d| short of the junction and never rejoin (self-closing a flipped single-cut vector keeps 2 pieces + gap).

## Next

check callers (goldenGate/gibson/partialDigest/paste), linear sources, real enzymes + pydna cross-check

## restore.test.ts (400 iters, real enzymes EcoRI KpnI BsaI SmaI BglI PstI BsmBI SapI HindIII NotI, both orientations)

- CLEAN: single-cut self-close (ligate, emptyVector(doc)), redigest of fragment doc then close, partialDigest whole-circle fragment closed, whole-plasmid PCR (20 nt overlap) + Gibson closing: every CDS whole again with same protein/codon_start/partials.
- F4 (low/medium): two cuts, religated in order or swapped: a join CDS whose second cut falls in its intron gap stays 2 partial CDS (pieces don't touch junction; rejoin only handles junction-touching pieces). 140 hits, all join features.

## Next: minimal repro F1 (EcoRI in TGA Sec codon), linear sources, pydna spot check

- F1 minimal repro CONFIRMED (repro.test.ts): CDS ATGAAATGAATTCCCGGGTAA with transl_except Sec at 17..19, EcoRI cuts in TGA; source MKUIPG*, ligate self / emptyVector -> MK*IPG*, transl_except gone.
- F2 CONFIRMED (repro2.test.ts): EcoRI dropout of internal 30 bp from rep_origin+CDS [10,100): closed backbone shows ori & geneX [69,129) whole, no partial marks. KpnI single cut, trim or fill (3' chewed back, -4 bp) then close: promoter Ptac 30->26 bp rejoined unmarked. Design note 10 #181 claims junction gaining/losing bases leaves pieces apart: true only for CDS non-3n.
- F5 (low, outside features): bluntEnds() sets ends null, so emptyVector(blunted vector) returns null (treated as PCR product without phosphates) -> no empty-vector background for a filled-in/blunted vector.
- Linear sources (300 cases, 2292 plans, 2980 CDS): only F1 (35). Clean otherwise.

## Next: look at e209aa4 codonStart change (3'-partial CDS cut at its end), multi-copy junction iteration in rejoinAtJunctions, then report

- Deletion probe (del.test.ts + del.py, 2738 cases / 4908 surviving CDS, linear+circular, joins, origin): partial marks (#176 incl. 3'-end loss) and codon_start all CLEAN.
- No existing issue for F1 (gh search transl_except).

## DONE - final report sent
