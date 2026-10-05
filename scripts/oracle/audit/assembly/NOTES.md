# Audit area: `assembly` — state at pause

Scope: `src/core/cloning/gibson.ts`, `goldenGate.ts`, `overlapPrimers.ts`,
`fidelity.ts` (added mid-task by the coordinator, with the Potapov 2018 SI).

## Environment / how to resume

- Node: `export PATH=/home/matej/Programs/miniconda3/envs/node/bin:$PATH`
- Python oracle: `/home/matej/Programs/miniconda3/envs/primer3/bin/python`
  (pydna 5.5.16, Biopython 1.88, pandas).
- Scratch dir (this dir): `.../scratchpad/audit/assembly/`
- Audit vitest files: `/home/matej/code/WebstormProjects/PlasmidPop/src/__audit__/assembly/`
  (`gibson.audit.test.ts`, `gg.audit.test.ts`, `gg2.audit.test.ts`,
  `fid.audit.test.ts`, `op.audit.test.ts`, `extra.audit.test.ts`).
- Pattern used throughout: Python generates `*_cases.json` + an oracle answer,
  a vitest file runs PlasmidPop and writes `*_out.json`, a Python script diffs.

## DONE — verified clean (no bugs found in any of these)

### 1. Gibson / HiFi product sequence — 15 cases, clean (14 usable)
- Script `gen_gibson.py` (builds cases + pydna `Assembly` cross-check),
  harness `gibson.audit.test.ts`, diff `check_gibson.py`.
- Covered: circular products of 2, 3, 4, 5, 6 fragments; linear products of
  3 and 4; overlaps 15/20/25/30/40 bp; fragments supplied in rotated input
  order; 1–2 fragments supplied reverse-complemented; overlaps spanning the
  origin of the target circle.
- Result: **14/14 products are an exact rotation (or rc-rotation) of the
  intended molecule**, exact length, no duplicated or dropped bases at any
  junction. Join lengths all equal the designed overlap. pydna agreed on
  every product length.
- The 15th case (`lin-3frag-25ov`) is a degenerate generated case: the two
  cut points fell 7 bp apart so part2 is only 32 bp and part1 genuinely
  shares 18 bp with part3. PlasmidPop correctly refused it as ambiguous;
  pydna also produced the spurious 18 bp product. Not a bug.

### 2. Golden Gate product sequence — 23 cases, clean
- Linear parts: `gen_gg.py` + `oracle_gg.py` + `gg.audit.test.ts` (14 cases).
- Circular destination vector: `gen_gg2.py` + `oracle_gg2.py` +
  `gg2.audit.test.ts` (9 cases). Diff with `cmp.py`.
- Oracle is independent: `pydna.Dseq(...).cut(Bio.Restriction.BsaI|BsmBI|BbsI|SapI)`,
  fragments filtered by recognition-site string, overhangs read from pydna's
  own `five_prime_end()`/`three_prime_end()`, flipping via pydna's
  `reverse_complement()`, then an overhang walk.
- Covered: BsaI (GGTCTC 1/5), BsmBI (CGTCTC 1/5), BbsI (GAAGAC 2/6),
  SapI (GCTCTTC 1/4, 3-nt overhang); 2, 3, 4 and 6 parts; parts supplied
  reverse-complemented (1 or 2 of them); rotated input order; a circular
  destination vector with the stuffer dropped out; **the origin of the
  circular vector placed inside the overhang and inside the Type IIS
  recognition site itself** (`vec-circ-3ins-origin-shift`, `-origin-mid-site`).
- Result: **23/23 products match the oracle and the intended construct
  exactly** (rotation/orientation aside), correct overhang on the correct
  strand at every junction, correct flip decisions.
- Enzyme table spot-check (`src/core/analysis/enzymeTable.ts`): BsaI 7/11,
  BsmBI 7/11, BbsI 8/12, SapI 8/11, BfuAI 10/14, BtgZI 16/20 — all correct
  for site length + (N1/N5, N2/N6, N1/N4, N4/N8, N10/N14). Reverse-strand
  cut arithmetic in `findCutSites` (`start + n - cutBottom`,
  `start + n - cutTop`) was derived by hand and is correct; the 23 cases
  exercise it (every part has one forward and one reverse site).

### 3. In-Fusion / NEBuilder overlap primers — 10 cases, clean
- `gen_op.py`, `op.audit.test.ts`, `check_op.py`.
- Checked for every case: forward tail == vector's last 15 (In-Fusion) /
  20 (NEBuilder) bases; reverse tail == rc(vector's first 15/20); both tails
  are at the **5′** end of the oligo; annealing part equals the insert's
  start / rc of the insert's end on the correct strand; `annealLength`
  matches; **pydna `amplify.pcr` with those two oligos gives byte-identical
  amplicon to PlasmidPop's**; amplicon == tail+insert+tail; final product ==
  `vector + insert`, circular, exact length.
- Covered: both kits; insert at the start and at the end of the template;
  a 60 bp insert (annealing capped at half the insert); lowercase template;
  lowercase vector; **circular template**; **a region that wraps the origin
  of a circular template** (start 1800, end 2300 on a 2000 bp circle —
  handled correctly, pydna agreed); a 40 bp vector.
- Result: **10/10 clean.**

### 4. fidelity.ts — parsing and scoring, clean
Potapov et al. 2018, ACS Synth Biol 7:2665, doi 10.1021/acssynbio.8b00333,
SI at `fixtures/local/potapov2018/Supplemental Data/` (gitignored).

**Layout of the real files** (checked with pandas):
- FileS01–S04, S06, S08 are 257×257: header row `Overhang,AAAA,AAAC,…`
  (256 columns), then 256 rows whose **labels are the reverse complements of
  the column labels in the same order** (`TTTT, GTTT, CTTT, ATTT, …`).
  So cell (row `TTTT`, col `AAAA`) = 830 is the *correct* Watson–Crick pair.
- Accessed **by label**, the matrix is exactly symmetric:
  f(a,b) == f(b,a) for 2000/2000 sampled pairs. (It is *not* symmetric as a
  raw array, because the row order differs from the column order — a trap
  PlasmidPop avoids by keying `counts` on labels.) It is *not* rc-symmetric:
  f(a,b) == f(rc(b),rc(a)) only 92 % of the time (measurement noise).
- `parseFidelityCsv` reads the converted CSV correctly: 256 overhangs,
  overhangLength 4, `counts.get('TTTT').get('AAAA') == 830` and
  `counts.get('AAAA').get('TTTT') == 830`, `GTTT×AAAC == 3690` — all match
  the raw file. `events` = 408 338 = (775 566 + Σf(a,a))/2, i.e. correct
  unordered-pair counting. **The `max(counts[a][b], counts[b][a])` lookup in
  `joined()` is right for this layout.**
- **Scoring**: independent Python re-implementation of the paper's
  definition (`fid_oracle.py`) vs PlasmidPop (`fid.audit.test.ts`),
  **36 sets, all agreeing to < 1e-12**: the real 9-overhang set from
  FileS05 table_02 (AAGG ACTC AGGA AGTG ATCA GCCG CTGA GCGA GGAA), a
  MoClo level-0 set, a YTK-style 8-overhang set, 28 random sets of 4/6/8/10/
  12/16/20 overhangs, a palindrome-containing set, a set containing an
  overhang and its reverse complement, a set with a duplicated overhang,
  a one-base-apart pair, and a set with an overhang of the wrong length
  (correctly reported in `unknown`, excluded from the product).
- **Reference anchor**: the Potapov 9-overhang set scores 0.98976 against
  the T4 18 h 37 °C table (FileS04); the same 10-fragment assembly was
  measured at 0.998885 correct under HF-cycled conditions
  (FileS05 `table_05`). Right ballpark and the right direction (HF cycled
  is the high-fidelity condition), so the formula is not mis-scaled.
  The matrix in FileS05 `table_02` is itself a measured per-set table and is
  a good target for a direct formula reproduction — **not yet done** (see
  "left to do").

## FINDINGS SO FAR (none critical; nothing produces a wrong oligo or construct)

1. **Low / usability — the fidelity importer cannot read the published
   files.** `FidelityReport.tsx:77` accepts only
   `text/csv,text/plain,.csv,.tsv,.txt`, but 12 of the 14 Potapov SI files
   (including FileS04 T4 18 h 37 °C, the table NEB's own tools are built on)
   are `.xlsx`; only FileS06 and FileS08 (T7 ligase) are CSV. A user who
   downloads the SI and clicks "Import a ligase fidelity table" cannot pick
   the file they have. `docs/guide/12-cloning.md:425-430` describes the shape
   but never says the file must be CSV/TSV, so there is no hint to convert.
   Evidence: `ls` of the SI directory; the `accept` attribute.

2. **Low — `setFidelity` gives a near-perfect score to a degenerate set.**
   A set containing an overhang and its own reverse complement
   (`['GGAG','CTCC','AATG','AGGT']`) and a set with a plainly duplicated
   overhang (`['GGAG','GGAG','AATG','AGGT']`) both score **0.99873**, the
   same as if the clash were not there. Cause: `fidelity.ts:182`
   `ends = [...new Set(known.flatMap(o => [o, rc(o)]))]` collapses the two
   junctions onto the same pair of ends, and `fidelity.ts:188` makes the
   cross-junction join the *own* pair, so it is scored as on-target.
   My independent implementation of the same published formula reproduces
   this, so it is a limitation of the metric as much as of the code — but
   the number shown is false confidence. Mitigation in practice: these sets
   are unreachable from the Golden Gate panel, which is the only caller
   (`GoldenGatePanel.tsx:224` passes `assembly.order[].fragment.left.overhang`
   from an assembly that already succeeded, and `goldenGate` refuses a
   duplicated/rc-duplicated overhang as ambiguous first). `setFidelity` is
   nevertheless exported from `@/core`. Suggest a guard or a warning.

3. **Note, not yet confirmed — Gibson models a fragment as its top strand
   only.** `gibson.ts:174/177` take `document.sequence.toString()` and
   `gibson.ts:269-277` rebuild each piece with `BLUNT_END` ends. For a vector
   opened with an enzyme that leaves a **5′** overhang this is the right
   answer (the overhang is the 5′ end of a strand, so the T5 exonuclease
   chews it and the polymerase fills in from the designed homology), and
   `designOverlapPrimers` warns when the vector has sticky ends
   (`overlapPrimers.ts:218-222`). For a **3′** overhang the bases are on a 3′
   single strand, which the exonuclease does not chew, so they should survive
   into the product and the top-strand-only model would silently drop them.
   Test 2 of `extra.audit.test.ts` was written to measure the 5′ case
   (EcoRI-opened plasmid) and had not run yet when the pause arrived.

## LEFT TO DO (next steps, in priority order)

1. **Fix and run `src/__audit__/assembly/extra.audit.test.ts`.** It failed
   only on a bad import: line 107 uses
   `require('@/core/cloning/goldenGate')`, which the ESM test env rejects
   (`Cannot find module`). Replace with a top-level
   `import { overhangWarnings } from '@/core/cloning/goldenGate';` and rerun
   `npx vitest run src/__audit__/assembly/extra.audit.test.ts`. It covers,
   in one file: (a) case-insensitivity of `designOverlapPrimers` (same
   sequence upper vs lower must give the same oligos, Tm and product);
   (b) the sticky-ended-vector Gibson question in finding 3 above — it already
   records `vectorEnds`, product length, `expectedTopOnly` and `duplexExtent`
   so the 4-base question is answerable straight from `extra_out.json`;
   (c) a Golden Gate part carrying an **internal BsaI site** (must be dropped
   with reason `site`, and the assembly must then fail rather than silently
   produce something); (d) `overhangWarnings` on a palindrome, a duplicate,
   an overhang+rc pair, a one-base-apart pair and 3-nt SapI overhangs.
2. **Reproduce the formula against FileS05 `table_02` directly.** Map the
   labels `1,1',2,2',…` to the sequences in that sheet's `Sequence` column
   (AAGG/CCTT, ACTC/GAGT, AGGA/TCCT, AGTG/CACT, ATCA/TGAT, GCCG/CGGC,
   CTGA/TCAG, GCGA/TCGC, GGAA/TTCC; junction 10 has no counts), write it as
   a 18×18 CSV in PlasmidPop's expected shape, feed it to `parseFidelityCsv`
   and `setFidelity`, and compare the result with the measured
   `table_05` correct fraction 0.998885. `potapov_set.py` is already written
   for this and currently errors only because it reads the `Sequence` column
   as a count (`could not convert string to float: 'AAGG'`) — drop that last
   column before the numeric conversion. This also exercises the parser on a
   **non-256** table and on a table whose rows are not in column order.
   Also worth checking: whether the parser accepts a table smaller than 256
   rows at all (it requires square, which this one is).
3. **Gibson warnings (`gibsonWarnings`) against an independent oracle** —
   the repeat search (rolling 2-bit seed, `gibson.ts:350-468`) has fiddly
   coordinate maths, especially `start: isReverse ? text.length - start - k`
   for reverse-strand hits and the stretch-merging at line 447-455. Plant a
   known repeat at a known position on each strand and check the reported
   1-based position and the "(other strand)" flag. Medium priority: these
   are warnings, not sequences.
4. **A real worked example** (Addgene MoClo / Yeast Toolkit, Lee et al. 2015,
   or the NEB Golden Gate manual) fetched from Addgene/NCBI and compared
   base-by-base. Not started; the synthetic cases above are already checked
   against pydna/Biopython, so this is confirmatory rather than new coverage.
5. Optional: `terminalOverlap` max-cap behaviour when real homology exceeds
   `maxOverlap` 60 (a 70 bp designed overlap) — does the product lose bases?
   Reasoning says no, but it is cheap to check.

## Files written so far

Scratch (`.../scratchpad/audit/assembly/`):
`gen_gibson.py`, `check_gibson.py`, `gibson_cases.json`, `gibson_out.json`,
`gen_gg.py`, `oracle_gg.py`, `gg_cases.json`, `gg_oracle.json`, `gg_out.json`,
`gen_gg2.py`, `oracle_gg2.py`, `gg2_cases.json`, `gg2_oracle.json`, `gg2_out.json`,
`cmp.py`, `gen_op.py`, `check_op.py`, `op_cases.json`, `op_out.json`,
`fid_oracle.py`, `fid_sets.json`, `fid_oracle.json`, `fid_out.json`,
`potapov_set.py` (broken, see step 2), `T4_18h_37C.csv`, `T4_01h_25C.csv`,
`HF_cycled.csv` (junk — FileS05 is multi-sheet, not a matrix).

Repo (untracked, `src/__audit__/assembly/`):
`gibson.audit.test.ts`, `gg.audit.test.ts`, `gg2.audit.test.ts`,
`op.audit.test.ts`, `fid.audit.test.ts`, `extra.audit.test.ts` (failing import).

Nothing outside `src/__audit__/assembly/` and the scratch dir was modified.
No commits, no issues filed, no `npm run mutate`.

---

# RESUMED 2026-10-05 — all STATE.md next steps 1-3 now DONE

## Step 1 DONE — `extra.audit.test.ts` + new `extra2.audit.test.ts`
(import fixed: top-level `import { goldenGate, overhangWarnings }`.)
Outputs: `extra_out.json`, `extra2_out.json`.

### 1a. Case-insensitivity of `designOverlapPrimers` — CLEAN
Same vector+template upper vs lower: identical oligos, identical Tm
(60.4556091171705 both), identical product.

### 1b. 3'-overhang Gibson question — RESOLVED, NOT A BUG
- 5' overhang, single-cut circular vector (EcoRI): vtop 1910 = full plasmid
  length, product 2410 = 1910 + 500 insert. **Nothing lost** — for a single
  cut on a circle the top strand already spans the whole molecule.
- 3' overhang, double digest (PstI CTGCA^G, cutTop 5 / cutBottom 1):
  vector top strand 1349, duplex 1353 (4 bottom-strand-only bases at the
  left end, overhang TGCA), product **1949 = top-strand model**, not 1953.
  So PlasmidPop does leave those 4 bases out.
- **This is the right answer.** Those 4 bases sit on the vector's left-end
  3' protrusion. T5 exonuclease is 5'->3' and does not touch a 3' end, and
  the amplicon's homology (reverse tail = rc of the vector's first 20
  *top*-strand bases) does not cover them, so they remain a 3' flap at the
  junction. Gibson 2009 (Nat Methods 6:343-345) uses Phusion, and NEBuilder
  HiFi likewise uses a proofreading polymerase, whose 3'->5' exonuclease
  removes a 3' flap before Taq ligase seals. The bench product is therefore
  the top-strand model. The panel also warns ("...has sticky ends; the tails
  match its top strand...", `overlapPrimers.ts:218-222`), which fired here.
- Also confirmed the forward tail correctly ENDS in the 3' overhang bases
  (`...AGCTGCA`), i.e. the right-end 3' overhang is on the top strand and is
  carried into the primer. Correct.

### 1c. Golden Gate with an internal BsaI site — CLEAN
Control (3 site-free parts): assembles, product 1212 bp = 3 x (4+400). Exact.
Same set with one extra internal `GGTCTCACCCC` in p3: p3's 211 bp piece is
dropped with reason `site`, and the reaction is **refused** —
"No part starts with the overhang BsaI 5' GGTA left by p2. 1 of 3 parts were
never reached." No silent wrong product.

### 1d. `overhangWarnings` — one gap found
- palindromes AATT, GCGC -> both warned. Correct.
- overhang + its reverse complement (AGGA, TCCT) -> "AGGA pairs with TCCT
  turned around, so the parts at those junctions can swap." Correct.
- one base apart (AGGA, AGGC) -> warned. Correct. Also for 3-nt SapI
  overhangs (AGG, AGC) -> warned. Correct.
- **EXACT DUPLICATE (AGGA, AGGA) -> NO WARNING AT ALL.** `goldenGate.ts:320`
  tests `same === 1` and `goldenGate.ts:325` `turned <= 1`; for a==b,
  `same === 0` and `turned === 4`, so neither branch fires. Two identical
  junction overhangs is the worst possible Golden Gate design error.
  Reachability: `overhangWarnings` has no caller outside `goldenGate.ts:252`
  (grepped), and `goldenGate` refuses a duplicated overhang as ambiguous
  before it gets there — so **unreachable from the UI today**. Latent gap in
  an exported function; severity low.

### 1e. `gibsonWarnings` repeat positions — CLEAN
Planted junction-1's 20 bp overlap forward inside part C at 0-based 300, and
the reverse complement of junction-2's overlap inside part A at 0-based 100.
Reported exactly: "...also occurs in C at 301" and "...also occurs in A at
101 (other strand)". Both the 1-based conversion and the reverse-strand
coordinate flip (`gibson.ts:412`, `text.length - start - k`) are right.

## Step 2 DONE — Potapov FileS05 `table_02` through the parser: STRONG REFERENCE MATCH
`potapov_set.py` (fixed: drop the trailing `Sequence` column before the
numeric conversion) builds an 18x18 CSV for the 9-junction set
(AAGG ACTC AGGA AGTG ATCA GCCG CTGA GCGA GGAA) from the paper's own measured
per-set end-joining matrix; `fid2.audit.test.ts` feeds it to
`parseFidelityCsv` + `setFidelity`.

- Parser accepts the non-256 table: 18 overhangs, 108 544 events, length 4.
- **PlasmidPop 0.99852302387442, Python oracle 0.99852302387442 (identical),
  paper's own measured correct-assembly fraction 0.998885**
  (FileS05 `table_05`, the {A:B:C:D:E:F:G:H:I:J} row). Absolute error 0.00036.
  Displayed as "99.9 %".
- Same comparison for all 8 per-set files in the SI:
  | file | predicted | observed |
  |---|---|---|
  | FileS05 HF cycled    | 0.998523 | 0.998885 |
  | FileS11 HF 01h 37C   | 0.998907 | 0.999489 |
  | FileS10 FP cycled    | 0.998130 | 0.998586 |
  | FileS14 FP 18h 37C   | 0.998520 | 0.998758 |
  | FileS13 DP 18h 37C   | 0.855389 | 0.913252 |
  | FileS09 DP cycled    | 0.719672 | 0.816098 |
  | FileS12 LF 18h 37C   | 0.203038 | 0.680664 |
  | FileS07 LF cycled    | 0.034664 | 0.258921 |
  The four high-fidelity conditions agree to <0.001 absolute. The
  low-fidelity ones under-predict, as expected: the product-of-independent-
  junctions metric is a conservative lower bound (a mis-ligation can still
  end in a correct circle). Nothing here is a PlasmidPop bug — the same
  pattern comes out of the independent Python implementation.

## Step 3 — NEW minor finding (cosmetic)
`setFidelity`'s `worst` list reports a symmetric mis-join twice, once from
each junction's point of view with slightly different denominators: for the
FileS05 set it yields `('CCTT','AGTG',0.000315)` and
`('AGTG','CCTT',0.000300)`. `FidelityReport.tsx:157` takes the top 3 above
`WORTH_NAMING = 0.001`, so on a bad set the same pair can occupy two of the
three named rows. Cosmetic; no wrong number.

## Remaining (optional, low value)
- `terminalOverlap` when the true homology exceeds `maxOverlap` 60.
- A real Addgene MoClo/YTK plasmid (confirmatory only; synthetic cases are
  already checked against pydna/Biopython).

## New files since the pause
Scratch: `extra_out.json`, `extra2_out.json`, `potapov_set.py` (fixed),
`potapov_S05_set.csv`, `potapov_S05_set.json`, `fid2_out.json`.
Repo (untracked): `src/__audit__/assembly/extra2.audit.test.ts`,
`fid2.audit.test.ts`; `extra.audit.test.ts` import fixed.

## Step 4 DONE — NEW HIGH-SEVERITY FINDING: Gibson refuses any overlap > 60 bp

`extra3.audit.test.ts` -> `extra3_out.json`. Two halves of a 2000 bp circle
sharing N bases at each junction, `minOverlap: 20`, default `maxOverlap`:

| shared homology | joins | product | terminalOverlap(...,60) | terminalOverlap(...,200) |
|---|---|---|---|---|
| 40 | 40,40 | 2000 OK | 40 | 40 |
| 55 | 55,55 | 2000 OK | 55 | 55 |
| 60 | 60,60 | 2000 OK | 60 | 60 |
| **61** | — FAIL | null | **0** | 61 |
| 65 | — FAIL | null | 0 | 65 |
| 70 | — FAIL | null | 0 | 70 |
| 80 | — FAIL | null | 0 | 80 |

Message at 61 bp: *"Nothing follows A: no other part starts with its last 20
bases or more. 1 of 2 parts were never reached."* — which is **false**: B
starts with A's last 61 bases.

Cause: `gibson.ts:111-117` `terminalOverlap` walks n from
`min(max, |a|, |b|)` **down to** `min` and needs an exact suffix/prefix
match at some n <= 60. When the true shared stretch is 61, the 60-base
suffix of A is S[1..61) while the 60-base prefix of B is S[0..60) — equal
only if S is periodic. So the overlap is not "reported at the cap", it is
not found at all.

`gibson.ts:87-92` documents the opposite: *"Not a limit on the design — a
longer shared end is simply reported at this length."* That is wrong for
every non-periodic sequence. The existing unit test that appears to cover it
(`gibson.test.ts:58`, `terminalOverlap('ACGTACGT','ACGTACGT',2,4) === 4`)
passes only because `ACGTACGT` has period 4 — which is why this was never
caught.

Reachability: `maxOverlap` is **hardcoded at 60** (`GIBSON_DEFAULTS`) with no
UI control — `GibsonPanel.tsx:145-159` exposes only `minOverlap`, from
`GIBSON_OVERLAPS = [12,15,20,25,30,40]` (`benchSettings.ts:58`), so
`minOverlap` can never exceed `maxOverlap` (no pathological case there) but
the user also has **no way to raise the ceiling**. `docs/guide/12-cloning.md:475`
says only "finds the longest shared stretch" and never mentions a cap.
Long overlaps are real practice (Gibson 2009 used 40 bp; NEBuilder HiFi and
the NEBuilder Assembly Tool support longer for large or difficult joins, and
a junction that happens to sit inside a shared feature easily exceeds 60).
No wrong sequence is emitted, so: **high, not critical.**
