# Fourth audit (2026-10-06/07): scripts

The oracle scripts of the three fourth-round areas, with each area's
`STATE.md` (findings and evidence as the agent wrote them), for ideas and
oracle logic. Their paths point at a session scratchpad
(`/tmp/claude-.../scratchpad/audit/<area>/`) that no longer exists, and the
Vitest probes that fed them (`src/__audit__/`, untracked) and their data are
not kept: read them rather than running them.

- `region-copy/`: base-identity check of `extractRange` and of deletes.
- `circ-align/`: read mapping, CDS effects and document diff across the origin
  against Biopython `PairwiseAligner` and translate.
- `sweep4/`: cut labels and circular digests at the origin, AB1 copy
  selection, SnapGene readingFrame.

What came out clean is frozen in `scripts/oracle/{editing,digest,abif_fixtures,
snapgene_fixtures,alignment}.py` and `src/test/oracle/`.
