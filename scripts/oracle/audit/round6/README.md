# Sixth audit (2026-10-07): scripts

The oracle scripts of the two scoped sixth-round areas, with each area's
`STATE.md` (findings and evidence as the agent wrote them), for ideas and
oracle logic. Their paths point at a session scratchpad
(`/tmp/claude-.../scratchpad/audit/<area>/`) that no longer exists, and the
Vitest probes that fed them (`src/__audit__/`, untracked) and their data are
not kept: read them rather than running them.

- `provenance/`: feature provenance and rejoin after the #182-#186 fixes.
  `gen.py`/`check.py` are the round-5 cut-and-ligate sweep with the partial
  rule patched for #186 (0 false joins, 0 missed rejoins); `gen_blunt.py`/
  `check_blunt.py` close blunted (fill/trim) vectors and compare with pydna
  (#183). Found #187 (pieces sharing a key across two versions of a plasmid
  rejoin with the wrong record) and #188 (a substitution inside a clipped
  piece resurrects the original `/translation`).
- `diff/`: the document diff after #184/#185, against optimal-alignment
  consistency (`oracle.py`, `analyze.py`). Found #189 (the cartesian product
  of start and end readings accepts locations no editor op produces) and #190.

What came out clean is frozen in `scripts/oracle/blunt.py` and
`src/test/oracle/blunt.test.ts` (blunted ends closed on themselves, sequence
only). Left out: feature rejoin across versions or edited pieces (#187, #188)
and diff results, whose definition of "unchanged" is editor-relative and waits
for #189.
