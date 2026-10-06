# PlasmidPop correctness audit — shared brief

PlasmidPop (repo: /home/matej/code/WebstormProjects/PlasmidPop) is a browser DNA editor (SnapGene-like). Goal of this audit: find hidden bugs that would make a scientist build a wrong plasmid or order wrong oligos. Read the project CLAUDE.md first (domain rules: 0-based half-open internally, GenBank 1-based inclusive, circular wraparound, reverse strand, multi-segment features, IUPAC).

## Method: differential testing against INDEPENDENT oracles

Existing tests mostly check the code against answers its own author wrote. Your job is to compare against answers that do NOT come from this codebase:

- Python oracles in conda env `primer3`: `/home/matej/Programs/miniconda3/envs/primer3/bin/python` has Biopython 1.88 (Bio.Restriction, Bio.Seq translate with tables), primer3-py 2.0.3, pydna 5.5.16 (ligation, Gibson, Golden Gate, PCR, Gateway), pytest.
- Published / authoritative data: NCBI records via efetch (https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=ACC&rettype=gbwithparts&retmode=text), NEB published values, REBASE, papers. Use WebFetch/curl. Record the URL for every reference value you rely on.
- When an oracle and PlasmidPop disagree, work out which is right from the biology/primary source before calling it a bug. Oracles have quirks and conventions too (e.g. pydna's Tm defaults, Biopython's ovhg sign convention). Convention differences that are clearly documented and displayed correctly are not bugs, but note them if a user could be misled.

## How to run PlasmidPop code

- Node: `export PATH=/home/matej/Programs/miniconda3/envs/node/bin:$PATH` first (npm is not on PATH otherwise).
- Write scratch vitest files ONLY under `src/__audit__/<your-area>/` (untracked; vitest includes `src/**/*.test.ts`). Run with `npx vitest run src/__audit__/<your-area>`. A good pattern: a vitest file that runs PlasmidPop functions on inputs and writes JSON results to your scratch dir, then a Python script that computes the oracle answer and diffs.
- Put Python scripts, downloaded reference files and outputs in `/tmp/claude-9005/-home-matej-code-WebstormProjects-PlasmidPop/0d36857c-4f3e-42c7-b46a-0fa7317cc69d/scratchpad/audit/<your-area>/`.
- DO NOT edit any file outside those two directories. Do not commit, push, file issues, or fix bugs. Do not run `npm run mutate`. Do not kill processes with `pkill -f` (it kills your own shell).
- Cost discipline: grep first, then Read with offset/limit; avoid reading huge files whole. Design notes in docs/design/NN-*.md explain each area — read the relevant ones.

## Priorities

Rank by "costs the user money if wrong": anything that ends up in an oligo sequence or a predicted construct sequence first; then sizes/positions a user relies on to pick a strategy; then cosmetics. Include circular sequences across the origin, reverse strand, IUPAC, lowercase, edge positions (0, length), and Type IIS / non-palindromic enzymes wherever they apply.

## Report (your final message, concise, max ~800 words)

1. **Confirmed bugs**: for each, severity (critical = wrong oligo/construct sequence; high = wrong positions/sizes that would mislead design; medium; low), file:line, a minimal reproduction (inputs → PlasmidPop output vs correct output), the reference source that proves it, and confidence.
2. **Suspicious but unconfirmed** items (short).
3. **What you verified clean**: which functions, against which oracle, how many cases. This is as important as the bugs.
4. Paths of your audit test files and scripts.

## Rules added in later audits

- Read `docs/audit.md` "Conventions and false positives" before reporting anything; those are not bugs.
- Issues filed by earlier audits may be closed: verify each fix in your area against the original repro and its near-variants, and look for regressions it introduced.
- **Update `<scratchpad>/audit/<area>/STATE.md` after every completed check** (findings with evidence, what is done, the exact next step). You may be stopped without warning and resumed by message.
- The saved oracle answers in `src/test/oracle/` already cover what earlier audits verified clean; spend effort on what they don't cover.
- Replace the scratchpad path above with the current session's scratchpad.
