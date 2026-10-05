# digest audit — STATE (paused on orchestrator request)

Scratch dir: this directory (`audit/digest/`). Vitest dump: `src/__audit__/digest/dump.test.ts`
(run: `export PATH=/home/matej/Programs/miniconda3/envs/node/bin:$PATH && npx vitest run src/__audit__/digest`).
Python: `/home/matej/Programs/miniconda3/envs/primer3/bin/python <script>` in this dir.

## Reference data fetched (in `ref/`)

- NCBI GenBank: L09137 (pUC19), J01749 (pBR322), J02459 (lambda, 48502 linear), J02482 (phiX174) via efetch.
- REBASE withrefm 610 (`withrefm.txt`, http://rebase.neb.com/rebase/link_withrefm) and emboss_e 610 (`emboss_e.txt`, link_emboss_e).
- REBASE overlapping-methylation tables (Dam/Dcm, NEB + Thermo enzymes): `rebase_dam_N.html`, `rebase_dcm_N.html`, `rebase_dam_V.html`, `rebase_dcm_V.html`
  from http://rebase.neb.com/cgi-bin/damlist?mM.EcoKDam+sN etc. Parsed to `rebase_methylation.json` by `parse_rebase_meth.py`
  (124 enzymes; per configuration: top/bottom methylated indices in site, effect blocked/impaired/cut). REBASE header figures
  confirm Dam = A of GATC (index 1, bottom index 2), Dcm = inner C of CCWGG (index 1, bottom index 3) — PlasmidPop's MOTIFS match.
- NEB pages (www.neb.com) return 403 to WebFetch and curl; Chrome navigate landed on "Page Not Found" (en-ca redirect). NEB marker sizes
  not yet cited from NEB; Chrome tab 330503857 is still open (close with tabs_close_mcp).

## Done + results

1. `compare_sites.py` (Biopython 1.88 Bio.Restriction oracle):
   - Bundled ENZYME_TABLE: 127/127 enzymes match Biopython/REBASE site, cutTop (fst5) and cutBottom (size+fst3). 0 mismatches.
   - findCutSites vs RestrictionBatch.search: 17 sequences (pUC19/pBR322/phiX circ+lin, lambda lin+circ, random circ/lin, lowercase,
     IUPAC-laden, pUC19 rotated so EcoRI straddles origin). 12,136 Biopython sites compared; every (enzyme, doc) set identical, and
     cutBottom−cut == −ovhg at every site (both strands, Type IIS, 3' overhangs, wraparound folding). Only diffs: 3 sites on the
     IUPAC random linear seq (BsaHI, MmeI, MslI) where the sequence has an ambiguity code (R) under a pattern R — PlasmidPop's
     documented subset-matching convention vs Biopython's regex; not a bug.
   - digest() fragments vs Biopython catalyse/split: all 40-odd cases identical (lambda HindIII/BstEII/EcoRI/BamHI/KpnI/XhoI,
     phiX HaeIII, pBR322 MspI/HinfI/TaqI/FokI/BbvI/MlyI/HgaI/BglI/AvaI/HincII/EcoO109I/DrdI/MmeI/BpmI/BsgI, pUC19 sets, Type IIS mixes,
     interrupted-site mixes). (One "MISMATCH" row rand2_circ was my test's fault: BsmFI/MboII/HphI are not in the bundled table.)
   - Sizes vs NEB markers (from memory, NOT yet cited): phiX174 HaeIII 1353/1078/872/603/310/281/271/234/194/118/72 exact;
     pBR322 MspI 26 fragments 622/527/404/307/242/238/217/201/190/180/160/160… exact; lambda BstEII 8453(NEB says 8454)/7242/6369/…
     lambda HindIII on J02459: 23130, 9416, **6682**, 4361, 2322, 2027, 564 — J02459 from NCBI has only 6 AAGCTT (the 37,584 site of
     NEB's cI857 lambda reads AAGCCA in J02459), so the NEB 6557+125 pair is a sequence difference, not a PlasmidPop error
     (Biopython agrees). cos 12-nt overhangs are not modelled (lambda is treated as blunt linear) — cosmetic.
2. `compare_rebase.py` (PlasmidPop parse of withrefm 610 vs Biopython table + independent re-read of <3>):
   - 1579 enzymes parsed; 743 overlap Biopython; **3 mismatches = CONFIRMED BUG** (medium/high):
     `readSite` in `src/io/rebase/withrefm.ts:170-173` treats a trailing `^` after N's as an in-site caret with symmetric bottom cut
     `length - caret` = 0. REBASE `CASTGNN^` (TspRI, NEB-sold; TscAI) means site CASTG, top cut +7, bottom cut −2 (9-nt 3' overhang;
     emboss_e: `TspRI CASTG 5 2 0 7 -3`; Biopython elucidate `N_NNCASTGNN^N`). PlasmidPop gives site `CASTGNN`, cutTop 7, cutBottom 0
     (7-nt overhang, bottom cut 2 bp off). HauII `TGGCCANNNNNNNNNNN^` → PP cutTop 17/cutBottom 0 (17-nt 3' overhang) vs REBASE
     cutTop 17/cutBottom 15 (2-nt 3' overhang; emboss `HauII tggcca 6 2 0 17 15`). Top-strand cut (and so top-strand fragment sizes)
     right; fragment ends/overhangs wrong → wrong ligation compatibility. Only REBASE-import users; bundled table unaffected.
   - All other notation forms (caret, (n/m) trailing, leading, double cutters) agree with Biopython; 0 disagreements with my own
     independent <3> reader; no palindromic site has asymmetric cuts. Skipped cutters (AbaSI `C(11/9)`, MspJI, FspEI, LpnPI,
     AspBHI `YSCNS(8/12)`, SgeI `CNNGNNNNNNNNN^`) are the documented MIN_SITE_BITS filter — by design.
3. `compare_ligate.py` (pydna 5.5.16 oracle): fragment ends (watson/crick/ovhg) identical to pydna cut() for EcoRI+HindIII, EcoRI+PstI,
   KpnI+SacI; ligation products identical (rotation-equivalent) for pUC19/pBR322 EcoRI-HindIII insert, BamHI vector + lambda BglII
   insert in both orientations (hybrid GGATCT/AGATCC sites, no BamHI/BglII site regenerated — correct), PstI 3' self-close (+flipped),
   blunt SmaI + PvuII/EcoRV (+flipped), BsaI Type IIS self-close (+flipped), linear EcoRI join (watson identical; pydna's len counts the
   trailing bottom-strand AATT, PP's `ends.right` carries it — convention, fine). EcoRI vs BglII ends: both PP and pydna refuse.
   partialDigest circular/linear HaeII on pUC19: fragment set + uncut counts exactly the expected n² / (n+2)(n+1)/2 sets.

## Dumps regenerated but NOT yet analysed (JSON in this dir)

- `rotations.json`: pBR322 rotated by 21 offsets (incl. L−1…L−26): sites + methylation marks → check invariance under shift
  (origin handling for all enzymes incl. Type IIS, and hostMethylationAt across the origin). Write `compare_rotations.py`.
- `digests.json` now has pBR322/lambda cases with features (`sourceFeatures`, per-fragment `features` with segments
  `{kind:'range',start,end,partialStart,partialEnd}`) → oracle: intersect each source segment with fragment range (unrolled, +L for wrap),
  shift by −range.start; compare (name, strand, segments). Write `compare_features.py`.
- `methylation.json`: PP marks on all docs (pBR322 known cases MscI 1446 Dcm, BspEI 1664 Dam, ClaI/XbaI… to eyeball).
- `sensitive.json`: DAM_DCM_SENSITIVE list dumped for the Python side.

## Next step (resume here)

1. Run `compare_methylation.py` (written, not yet run): A1 = REBASE says CUT but PP blocks (false block → site silently dropped from
   digests in dam+/dcm+); A2 = REBASE blocked but enzyme not in list; A3 = blocked with methylated base outside the recognition site
   (PP looks only inside the site — suspected for Type IIS e.g. BsaI GGTCTCCWGG where the Dcm C sits in the cut region; REBASE's BsaI Dcm
   entry shows bottom[0] only so far); B = enzymes PP blocks on a kind REBASE never lists (e.g. list has no Dam/Dcm distinction).
   Verify any hit by constructing a minimal sequence and running hostMethylationAt/cuttableSites in the vitest.
2. Write/run `compare_rotations.py` and `compare_features.py` (above).
3. Cite NEB marker sizes: try Chrome on https://www.neb.com/en-us/products/n3012-lambda-dna-hindiii-digest (note en-us), N3014 BstEII,
   N3026 phiX HaeIII, N3032 pBR322 MspI, and the dam/dcm usage guideline; else cite REBASE/Biopython + GenBank only.
4. Close Chrome tab 330503857. Write final report (SubagentHandback) per BRIEF.md format.

## RESUMED 2026-10-05 — all checks complete, final report delivered via SubagentHandback

- compare_methylation.py + meth_detail.py: Dam/Dcm model over-blocks (see report). Real-sequence false drops: pBR322 FokI site@133
  (cut 146; CCTGG|GGATG, REBASE: cut), lambda FokI@30043, lambda BsaHI@30472 (CCAGG|GGCGTC, REBASE: cut). Synthetic: BstXI/AlwNI/PflMI
  marked Dam for GATC inside their N's (REBASE/NEB: no Dam sensitivity); SfoI/BstXI/SfiI marked Dcm for one-sided CCWGG (REBASE: cut).
  Controls XbaI/BsaI/MscI marked correctly. FseI (dcm impaired) not in list — minor.
- compare_rotations.py: pBR322 rotated 21 ways incl. L-1..L-26: cut sites (462) and methylation marks (50) invariant. Clean.
- compare_features.py: 197 fragments with features vs interval-intersection oracle: 0 differ. Clean.
- repro.test.ts: TspRI/HauII parse bug also doubles the cuts (site CASTGNN read as non-palindromic → reverse-strand pass adds a
  second cut 2 bp away; one CASTG gives 3 fragments incl. a 2-bp piece). NEB marker pages still 403 — sizes uncited.
