# 68. Overhang sets with two of one junction (#144)

**Found:** the 2026-10-05 correctness audit, against the T4 18 h 37 °C
end-joining table of Potapov et al. 2018 (a local copy, not committed).

- **`setFidelity` scored a degenerate set as a clean one.**
  `['GGAG', 'CTCC', 'AATG', 'AGGT']` (an overhang with its own reverse
  complement) and `['GGAG', 'GGAG', 'AATG', 'AGGT']` (a duplicate) both
  scored 0.99873, the same as `['GGAG', 'AATG', 'AGGT']`. The tube's ends
  are a set, so the two junctions became one, and the cross-junction join
  counted as each one's own. The published formula has the same blind spot,
  but the number was false confidence: those parts can go in either order.
- **`overhangWarnings` said nothing about identical overhangs.** For
  `a === b` the one-base rule (`same === 1`) and the turned-around rule
  (`turned <= 1`, which needs `a` to be `b`'s reverse complement or near it)
  both missed, so `['AGGA', 'AGGA', 'TTCG']` gave no warning. The
  exhaustive test had pinned this as intended, on the ground that
  `goldenGate` refuses such an assembly as ambiguous; but the function is
  exported for any set, and a duplicate is the worst flaw a set can have.
- **`worst` named one mis-join twice.** A mis-join between two junctions is
  charged to both, and was listed once per junction (`CCTT+AGTG` and
  `AGTG+CCTT`, with different denominators), so it could take two of the
  three rows the panel shows. Over the audit's 36 sets, 445 rows were such
  repeats.

**Built:**

- `sameJunctions(overhangs)` lists pairs of junctions that can be one
  another: equal, or equal once one is turned around, by IUPAC code
  (`overhangsMatch`), so `GGAN` collides with `GGAG` and `NTCC` too. Blunt
  ends and overhangs of different lengths never collide; a palindrome alone
  is not a collision (it is the palindrome rule's), a palindrome twice is.
- `setFidelity` returns those pairs as `ambiguous` and a fidelity of 0 when
  there are any, rather than a share; the junctions and mis-joins are still
  listed. The Golden Gate panel shows **Fidelity not scored** and names the
  pairs instead of a percentage.
- `worst` keeps one row per unordered pair, at the higher of its two rates
  — the junction it costs most.
- `overhangWarnings` has a rule ahead of the one-base one: distance 0 by
  IUPAC mask, worded "stands at two junctions" for an exact duplicate and
  "can be the same overhang" for a code that could be the other.

**Checked, not affected:** Golden Gate itself refuses a set in which two
parts offer the same overhang (item 3), so neither fault reached the panel
from a real assembly; the Bench's Golden Gate goes through the same
`goldenGate`. There is no overhang-suggesting helper to share the flaw.
Clean sets score exactly as before on the real table.
