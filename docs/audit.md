# Correctness audits

How to check that PlasmidPop's sequence results are right, against answers
that do not come from its own code. Read this before starting an audit; it
holds what the last one had to discover, so the next one need not.

## Baseline

| Audit      | Commit audited     | Issues filed                 | Areas                                                                                        |
| ---------- | ------------------ | ---------------------------- | -------------------------------------------------------------------------------------------- |
| 2026-10-05 | `9a336fa` (1.11.1) | #132–#146 (milestone 1.11.2) | first six areas below                                                                        |
| 2026-10-06 | `7a7b988`          | #152–#159 (milestone 1.11.2) | alignment and diff, reads, SnapGene, map geometry                                            |
| 2026-10-06 | `5b324ba`          | #162–#168 (milestone 1.11.2) | editing (first time), SnapGene, alignment incl. circular reads, sweep of the #152–#161 fixes |

The next audit starts from `git diff <last commit audited>..HEAD`:
audit only the areas whose files changed or are new. Everything verified
clean last time is re-checked on every CI run by the saved oracle answers
in `src/test/oracle/` (item 37), except the cases left out for open bugs.
Add a row here when an audit finishes.

## Running one

- **One heavy-model agent at a time.** Six in parallel spiked usage toward
  the limit. Each agent gets one area, the shared brief
  (`scripts/oracle/audit/BRIEF.md`) and the area's row below.
- **STATE.md after every check.** An agent can be stopped by a usage limit
  without warning; it writes findings, evidence and the next step to its
  scratch `STATE.md` after each completed check, and can be resumed from it.
- **Agents never edit code, commit or file issues.** Scratch Vitest probes
  go in `src/__audit__/<area>/` (untracked; delete before a release, as it
  breaks local typecheck and lint), scripts and data in the session
  scratchpad.
- **Re-check every claimed bug** in the source before filing it. Then file
  one issue per root cause with the repro and the reference that proves it.
- **Freeze what came out clean** as oracle answers (`scripts/oracle/generate.py`
  and its modules), so the next audit can skip it.
- **Check the area map against the tree first.** List `src/core/*`,
  `src/io/*` and `src/app/*` and make sure every directory that computes
  something a user acts on has a row below. Editing and region copy were
  missing until the third audit, which found three bugs there (#162, #163).
- **Close an audit issue only after its repro and near-variants pass.**
  #153 was reported for readingFrame ±2/±3, fixed for the positive values
  only, and its fixture also carried the matching codon_start, so the test
  passed without reading a negative frame (#164). Re-run the audit's own
  probe, not just the new unit test.
- **A line in "Conventions" needs the cases that support it.** "Global
  banded always equals it" came from junk-flank cases only; tandem repeats
  break it (#167).
- Rank by cost to the user: wrong oligo or construct sequence → wrong
  positions/sizes that mislead a design → refusals and false warnings →
  cosmetics.

## Setup

- `scripts/oracle/audit/fetch.sh` downloads the reference data (NCBI
  records, REBASE files and methylation tables, Biopython's test files) into
  `fixtures/local/oracle-cache/`.
- For one-off comparisons the conda env `primer3` has Biopython, pydna,
  primer3-py and pytest. The pinned oracle venv (`scripts/oracle/run.sh`)
  is for regenerating saved answers; pins are in its `requirements.txt`.
- Ligation fidelity needs Potapov et al. 2018 SI (doi
  10.1021/acssynbio.8b00333), which may not be redistributed. The user
  downloads it to `fixtures/local/potapov2018/`.
- The 2026-10-05 scripts are in `scripts/oracle/audit/<area>/` with each
  area's notes. Their paths point at an old scratchpad; read them for ideas
  rather than running them.

## Areas

| Area                                           | Code                                                                                                              | Design notes       | Reference                                                                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Primers, Tm, mutagenesis                       | `core/primers/*`, `core/cloning/mutagenesis.ts`                                                                   | 36, 47, 56         | primer3-py; Biopython `Tm_NN` (Q5); NEB Tm API `tmapi.neb.com/tm/q5/0.5/<primer>`; NEB E0554 and Agilent 200523 manuals      |
| Gibson, Golden Gate, overlap primers, fidelity | `core/cloning/{gibson,goldenGate,overlapPrimers,fidelity}.ts`                                                     | 03, 49             | pydna `Assembly`, `Dseq.cut`, `amplify.pcr`; Potapov 2018 SI                                                                 |
| Digest, ligation, methylation, REBASE          | `core/analysis/{restriction,methylation,enzymeTable}.ts`, `core/cloning/{digest,ligate,partial}.ts`, `io/rebase/` | 07, 30, 40, 42, 44 | Biopython `Restriction`; pydna; REBASE `withrefm`, `emboss_e` and damlist overlap tables                                     |
| PCR, Gateway                                   | `core/cloning/{pcr,gateway}.ts`                                                                                   | 36, 48             | pydna `amplify.pcr`, `assembly2.gateway_assembly`; Invitrogen attB sequences                                                 |
| Translation, file formats                      | `core/analysis/{cdsTranslation,sixFrame,orf,geneticCodes}.ts`, `io/*`, `core/checksum`                            | 01, 04, 43, 57     | NCBI `gc.prt`; NCBI `/translation`; Biopython parsers and test files; `seguid`                                               |
| Editing, region copy, undo                     | `core/document/*` (`seqDocument.ts`, `extract.ts`), `core/features/*`                                             | 51, 66             | Biopython `SeqRecord` slicing, `+`, `reverse_complement(features=True)`; pydna `shifted()`; a base-identity model in Python  |
| Pairwise alignment, diff                       | `core/alignment/*`, `core/diff/*`                                                                                 | 45                 | Biopython `PairwiseAligner` (EDNAFULL −10/−0.5; BLOSUM62 −11/−1); an independent LCS for diffs                               |
| Sequencing reads                               | `io/fastq/*`, `io/abif/*`, `view/trace.ts`, `core/alignment/quality.ts`                                           | 45, 46, 70         | Biopython `SeqIO` fastq/abi and its `Tests/Quality`, `Tests/Abi` files                                                       |
| SnapGene files                                 | `io/snapgene/*`                                                                                                   | —                  | The 203 sample files' own `/translation` qualifiers; a raw packet parser; Biopython `snapgene` (reads only the circular bit) |
| Circular map, SVG export, linear layout        | `view/circular/*`, `view/svg/*`, `view/linear/*`                                                                  | —                  | Own invariants: angle/position round trips, arc endpoints from the exported SVG, panel numbers                               |
| UI-to-core wiring                              | `app/components/*Panel.tsx`, `app/clipboard.ts`, `workers/*`                                                      | —                  | none needed: the panel's own invariants (feature bases equal the primer in its note; results belong to the current document) |

## Conventions and false positives

Each of these looked like a bug and is not. Check this list before
reporting one.

- **NCBI J02459 (lambda)** has 6 HindIII sites, not NEB's 7: position
  37,584 reads AAGCCA. Its HindIII digest gives 6682 where NEB says
  6557 + 125. NEB's lambda BstEII end fragment is 8454, we compute 8453.
- **Ambiguity codes in the sequence** match a recognition site only when
  every expansion does (a documented subset rule); Biopython differs in a
  few places.
- **Ambiguous codons** whose expansions disagree translate to X; Biopython
  gives B/Z/J.
- **Linear ligation products** leave out a trailing bottom-strand 5′
  overhang from their length (carried in `ends`); pydna counts it.
- **Gibson with a 3′-overhang vector** drops the overhang bases. That is
  correct: T5 exonuclease does not touch 3′ ends and the polymerase trims
  the 3′ flap.
- **Gateway partner sites share 19 bp**, not the 15-bp core. The product
  is the same wherever in the shared stretch the crossover falls.
- **Potapov tables** label rows with the reverse complements of the column
  labels, in the same order. Read them by label, never as a raw array. The
  set-fidelity formula under-predicts for low-fidelity ligases; that is
  the formula, not our code.
- **pydna** refuses PCR with more than one binding site ("not specific")
  and digests with overlapping adjacent cuts. Fall back to the textbook
  product.
- **primer3-py 2.x** defaults to `formamide_conc=0.8`, a 2 °C offset. Set
  it to 0. Use `tm_method='santalucia', salt_corrections_method='santalucia'`.
- **Biopython `ovhg`** is negative for 5′ overhangs. Our `cutBottom − cut`
  equals `−ovhg`.
- **Trans-spliced mixed-strand CDS** (NC_000932 rps12) are known to be
  unsupported, with a warning.

- **Banded alignment** (local and global) is not exact: with tandem
  repeats or a long insertion near a read end it can score a few percent
  below the optimum (#167). Without those, 0 deficits in 480 cases.
- **Local alignment runs on through junk flanks** with EDNAFULL −10/−0.5:
  a read past the end of the reference shows its overhang as differences.
  Biopython does the same; accepted.
- **Feature labels outrank cut labels** on a crowded map, so cut labels can
  all be dropped (none of 114 survive at 10,000 features). By design.
- **First codon of a CDS** always translates as M here; SnapGene does so
  only with `translateFirstCodonAsMet`. TA/TOPO vectors with a 1-base 3′
  overhang lose their first lacZα residue under the #154 rule (correct).
- **Refined diffs** (`refine: true`) keep fewer equal bases than the LCS by
  design (affine-gap re-alignment); raw Myers equals the LCS.
- **Peaks above 32,767** in ABIF are read unsigned; Biopython reads them
  signed. Ours is right (item 46).
- **Biopython `snapgene`** takes record name and description from
  `<Comments>`; ours does not.
- **SnapGene sample files** live in `~/Programs/snapgene_8.2.2_linux`
  (203 .dna); they may not be committed. `fixtures/local` has none.
- **Circular read mapping** lives in `app/readAlignment.ts` (a doubled
  reference), not in `core/alignment`. Audited 2026-10-06; see #165, #166.

## Reference sources that work from here

| Works                                   | Blocked (as of 2026-10-05)                  |
| --------------------------------------- | ------------------------------------------- |
| NCBI efetch                             | neb.com marker and methylation pages (403)  |
| REBASE (`rebase.neb.com`)               | Addgene `sequences.addgene.org` (404)       |
| NEB Tm API, NEB and Agilent manual PDFs | `tools.thermofisher.com` vector files (403) |
| GitHub (Biopython test files)           |                                             |

For Gateway vectors use NCBI records (PQ197128, LC217877) and pydna's
bundled att sequences instead of Addgene or Thermo files.
