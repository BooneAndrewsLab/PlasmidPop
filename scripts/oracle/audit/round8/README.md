# Eighth audit (2026-10-08): scripts

The oracle scripts of the two scoped eighth-round areas (commit `d2a4a50`),
with each area's `STATE.md`. As in earlier rounds, their paths point at a
session scratchpad that no longer exists, and the Vitest probes
(`src/__audit__/r8-*`, untracked) and generated data are not kept: read them
rather than running them.

- `diff/`: the document diff after #197/#198. `oracle.py` is a base-identity
  model of `seqDocument.replace` that enumerates every single replace turning
  a into b, wrapping ones included; `classify.py` sorts false "unchanged" into
  the by-design families. Sweeps were run against snapshots of the code before
  the fixes. Found #200 (a removed or renamed feature's "was" span took in an
  insertion drawn at its end), fixed in `ad1c6fe`.
- `provenance/`: `featureOrigin`, trims and PCR after #199. `gen.py`/`check.py`
  re-run round 7's sweep; `gen8.py` adds blunted multi-fragment plans over two
  versions; `gen_trim.py`/`check_trim.py` model `bluntEnds` and
  `reverseComplement`; `gen_pcr.py`/`check_pcr.py` compare products with pydna.
  Found #201 (PCR refused back-to-back primers on a circle whose runs overlap
  unevenly), fixed in `07728bf`.

Round 8 found no high-severity bug, so it meets the stopping rule for 1.11.2.
