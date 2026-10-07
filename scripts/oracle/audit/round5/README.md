# Fifth audit (2026-10-07): scripts

The oracle scripts of the two scoped fifth-round areas, with each area's
`STATE.md` (findings and evidence as the agent wrote them), for ideas and
oracle logic. Their paths point at a session scratchpad
(`/tmp/claude-.../scratchpad/audit/<area>/`) that no longer exists, and the
Vitest probes that fed them (`src/__audit__/`, untracked) and their data are
not kept: read them rather than running them.

- `cut-ligate/`: base-identity check of CDS protein, `/codon_start` and partial
  marks through digest, flip and ligate (including the #181 rejoin), and of
  deletes, against Biopython translation.
- `circ-reads/`: read mapping across the origin against Biopython
  `PairwiseAligner` (single and batch paths), and the document-diff triage.

What came out clean is frozen in `scripts/oracle/{editing,alignment}.py` and
`src/test/oracle/` (`ligation` and `circularReads`). The findings (#182-#184)
are the cases the frozen sets leave out.
