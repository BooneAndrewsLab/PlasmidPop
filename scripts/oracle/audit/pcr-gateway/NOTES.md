# pcr-gateway audit — state (paused)

Scratch dir: `/tmp/claude-9005/-home-matej-code-WebstormProjects-PlasmidPop/0d36857c-4f3e-42c7-b46a-0fa7317cc69d/scratchpad/audit/pcr-gateway/`
Audit tests: `/home/matej/code/WebstormProjects/PlasmidPop/src/__audit__/pcr-gateway/`
Node: `export PATH=/home/matej/Programs/miniconda3/envs/node/bin:$PATH`; run `npx vitest run src/__audit__/pcr-gateway`.
Python oracle: `/home/matej/Programs/miniconda3/envs/primer3/bin/python`.

## Done so far

### Source read

- `src/core/cloning/pcr.ts` (414 l), `src/core/cloning/gateway.ts` (481 l),
  `src/core/primers/anneal.ts` (366 l) read in full.
- Design notes 36-pcr, 48-gateway read; 49-cloning-bench grepped.

### PCR — verified clean (no bug found yet)

- `src/__audit__/pcr-gateway/pcrDump.test.ts` → `pcr-results.json`
  (~100 cases: random linear/circular, origin-spanning products, anneal-region
  mismatches, wrong orientation, repeated binding sites, IUPAC primers, Taq,
  inverse PCR, mutagenic 5' inserts, lowercase template, tiny circles).
- `check_pcr.py` compares every product against:
  - oracle A, the canonical assembly `fwd_primer + template[f.end:r.start] +
revcomp(rev_primer)` taken round the circle — **111/111 products identical**
    (so: tails, mismatch carry-in, IUPAC carry-in, origin wrap, whole-circle
    inverse products, Taq A-tail all correct);
  - oracle B, `pydna.amplify.pcr` (limit=15) — **60 cases, 0 mismatches**. The
    single reported "failure" is the `repeat` case where pydna raises
    "PCR not specific!" on a 2-site template while PlasmidPop correctly lists
    several products — not a bug.
- `src/__audit__/pcr-gateway/pcrFeatures.test.ts` → `pcr-features.json`:
  feature transfer onto products verified for inside/straddling/multi-segment/
  reverse-strand/origin-wrapping features on linear, origin-spanning and
  whole-circle (inverse PCR) products. All transferred features' product
  subsequence equals the template's; the straddling feature is correctly
  truncated at the amplicon end; primer_bind features sit at
  `[0, |fwd|)` and `[len-|rev|, len)`. **All correct.**

### Reasoned-through, not yet confirmed either way (low-severity candidates)

- `PCR_DEFAULTS.maxProduct` (20 000) appears unused: `pcr()` uses
  `options.maxProduct ?? POLYMERASE_REACH[polymerase]`. Cosmetic/dead constant.
- `describeFailure` says "Both primers anneal to the same strand" even when a
  single primer was supplied (pcr.ts:372-374). Cosmetic wording only.
- `gateway.ts:301` chooses the wanted circle by ccdB: if a vector annotates a
  ccdB-named feature **outside** the cassette (so the backbone piece carries it
  and the cassette piece does not), the two circles would be swapped and the
  byproduct returned as the clone. Needs a constructed test.
- `gateway.ts:225-231` refuses when only one pair is strand-opposed. Real
  GenBank files annotate att site 2 as `complement(...)` in one vector and
  forward in another; that combination is refused rather than handled. Need to
  confirm it is only a refusal (safe) and never a wrong product.
- `gateway.ts:379-390` `recombinant()` adds a site feature as
  `rangeSegment(start, start + length)` which can run past the circle's length;
  need to check the resulting feature is a valid wrapped feature.
- `sharedCore` (gateway.ts:105) takes the longest common substring; for real
  attL1×attR1 and attB1×attP1 that is **19 bp**, not 15 (measured). Because the
  shared stretch is identical in both parents, the product sequence is
  invariant to where inside it the crossover falls, so this should be harmless
  for sequence — but it shifts the annotated recombinant-site boundaries, and
  `gatewayWarnings` warns "shorter than a full att core" only below 15.

## What is left

1. **Gateway differential vs pydna** — the main remaining work.
   `make_gateway_cases.py` is **written but never run**. It builds 6 cases from
   authentic att sequences (pydna's own gateway doctest sequences, Hartley
   2000 / Invitrogen-derived; they are listed at the top of the script) and
   stores pydna `gateway_assembly(..., multi_site_only=True)` products in
   `gateway-cases.json`:
   BP-forward, LR-forward, LR-site2-inverted (the real orientation),
   BP-linear-substrate, LR-attL1-wraps-origin, LR-vector-reversed.
   Next step: run it, then write
   `src/__audit__/pcr-gateway/gatewayDump.test.ts` that reads
   `gateway-cases.json`, rebuilds each molecule as a `SeqDocument` with
   `protein_bind` features named attB1/attP1/… at the given ranges and strands,
   runs `gateway(insert, vector, reaction)`, and dumps product + byproduct
   sequences, lengths, features and warnings; then a `check_gateway.py` that
   compares each product circle against pydna's, as a **circular** comparison
   (rotation- and reverse-complement-invariant) and also checks total length =
   insert + vector.
2. The ccdB-placement swap scenario and the wrapped recombinant-site feature
   (items above) as constructed cases.
3. **attB-tailed primer design**: grep showed PlasmidPop has **no** attB tail
   sequences anywhere (`GGGGACAAGTTTGTACAAAAAAGCAGGCT` etc. are absent; only
   `src/core/cloning/gateway.ts` and `src/app/components/GatewayPanel.tsx`
   mention attB, as labels). Design note 48 lists "the PCR panel annotating an
   attB tail" as not-yet-done. So there is nothing to check against the
   Invitrogen manual — confirm once more and report as "not implemented".
4. Reference URLs recorded so far: NCBI efetch of PQ197128.1 (pDONR221
   derivative, real attL1/attL2) and LC217877.1 (pDONR Zeo MultiSite,
   attL1/attL2/attR3/attR4), both downloaded to this dir and site positions
   confirmed with `pydna.gateway.find_gateway_sites`. Addgene's
   `sequences.addgene.org/.../*.gbk` endpoint 404s for this environment, and
   `tools.thermofisher.com/content/sfs/vectors/*.txt` returns 403, so authentic
   vector files came from NCBI and from pydna's bundled consensus sequences.

## Cleanup note

`src/__audit__/` is untracked scratch; nothing outside it and the scratch dir
has been modified.

## RESUMED 2026-10-05

### Gateway vs pydna — DONE, clean

`make_gateway_cases.py` run, `gatewayDump.test.ts` + `check_gateway.py` written and run.
**6/6 cases: product AND byproduct sequences identical to pydna**
(`gateway_assembly(..., multi_site_only=True)`), compared rotation- and
revcomp-invariantly; mass conserved (insert+vector = product+byproduct).
Cases: BP-forward, LR-forward, LR-site2-inverted (real orientation),
BP-linear-substrate (product only, correct), LR-attL1-wraps-origin,
LR-vector-reversed. ccdB warning fired in all.

Observations from the dump (NOT yet bugs):

- Recombinant site features can run past the end of the circle, e.g. BP-forward
  product is 1260 bp and carries attL1 at segment [1176, 1275]. Need to check
  this is a valid wrapped feature (text + GenBank round-trip).
- In the "both sites forward" fixtures the junction-2 site is labelled attB2/attL2
  but is biologically attP2/attR2 (199 bp). That is a FIXTURE artifact: with both
  att sites written forward the gene is not flanked by B-arms. Confirmed by hand.
- In LR-site2-inverted the product's attB2 comes out 22 bp, not 25: the pydna
  attL2 string is truncated by exactly the 3 bases GGT. Also a fixture artifact.
  A faithful fixture needs attL2 + "GGT" so attB2 = ACCACTTTGTACAAGAAAGCTGGGT
  (= revcomp of the Invitrogen attB2 ACCCAGCTTTCTTGTACAAAGTGGT).

### Still to do

(2) ccdB annotated outside the cassette -> circles swapped? (3) one-sided
orientation refusal. (4) wrapped recombinant-site feature validity.
(5) realistic full-length att fixture checking attB1/attB2 are 25 bp.

### Edge results (gatewayEdge.test.ts -> gateway-edge.json)

- **realistic-LR CLEAN and authoritative**: entry attL1-gene-rc(attL2)-kanR x
  dest attR1-ccdB-rc(attR2)-ampR-ori gives product 1153 bp = gene+ampR+ori with
  **attB2 text exactly ACCCAGCTTTCTTGTACAAAGTGGT, the Invitrogen attB2**, and a
  25-bp attB1; byproduct 1352 bp = ccdB+kanR with attP1/attP2. ccdB removed
  from the product correctly.
- **Wrapped recombinant-site feature is CLEAN**: attB1 at [1143,1168] on a
  1153 bp circle writes as `join(1144..1153,1..15)` in GenBank and round-trips
  to the same segments; sequence identical.
- **One-sided orientation: CLEAN** — refused with a clear message, no product.
- **all-forward annotation: CLEAN** — identical correct product to the
  properly-stranded fixture, so a consistent strand convention does not matter.
- **BUG CONFIRMED (ccdb-in-backbone-only)**: cassette named "lethal cassette"
  (no "ccdb" in the name) + a backbone feature named "ccdB promoter" makes
  gateway.ts:268-301 pick the WRONG circle: `product` = 1352 bp carrying the
  lethal cassette + kanR (that is the byproduct), `byproduct` = 1273 bp carrying
  gene+ampR+ori (that is the real expression clone). Sites mislabelled too.

### Circle-choice: REALISTIC TRIGGER FOUND (gatewayCircleChoice.test.ts)

`attSites` sorts by position (gateway.ts:71) and `gateway` takes
`[i1, i2] = inserts` in that order (gateway.ts:203). An entry clone whose
insert spans the origin therefore presents attL2 first, and then the
geometric default circle (`crossed`, gateway.ts:274-287) is the WRONG one;
only the ccdB test at gateway.ts:301 rescues it. With no feature whose name
matches /ccdb/i the rescue does not happen:

rotated entry + cassette named "Gateway cassette"
product = 1352 bp, kanR + Gateway cassette, labelled attB1/attB2 <-- WRONG
byproduct = 853 bp, gene + ampR <-- the real clone
rotated entry + cassette named "ccdB" -> correct (853 bp product)
plain entry + either name -> correct

No warning is emitted in the failing case (the ccdB warning is also keyed on
the name). PlasmidPop's own BP product has its sites in reversed positional
order (attL1 wrapping the origin), so a BP -> LR chain inside the app takes
this path routinely.
Severity: high. Both sequences are right; which one is called the product is
wrong, and the att labels follow the wrong circle.

### Also clean

- BP-then-LR round trip from a linear attB PCR product: expression clone
  carries the gene whole and attB1/attB2 **exactly 25 bp matching the
  Invitrogen sites** (attB2 = ACCCAGCTTTCTTGTACAAAGTGGT).
- My two "cassette on the bottom strand" fixtures in gatewayLayout.test.ts
  were internally inconsistent (both attR annotated reverse); the honest
  version of that layout is the already-passing LR-vector-reversed case.
  Both were refused, not mis-built, so nothing unsafe.
- MultiSite in one pass is refused by design (>2 sites of a kind), as design
  note 48 states.

STATUS: all planned checks done. Writing the final report.
