# 155. Unsupported location syntax is named, not offset-numbered

Issue #463. The 2026-11-25 corpus run showed features dropped with
`Cannot parse location "...": expected a number at offset N`, which says
nothing about the cause.

## What was built

- `parseLocation` (`src/core/features/location.ts`): when the parser fails,
  `classifyFailure` scans the location text and, on a match, throws an
  `UnsupportedLocationError` (a `LocationError`) carrying `syntax` and a plain
  `description`. Texts that parse are untouched; a location that fails for
  another reason keeps its old message.
- `buildFeatures` (`parseGenBank.ts`): the skip warning reads
  `Skipped <key> feature: <description> (location "...")` with the line.
  After five features skipped for one syntax in a record, the rest become one
  warning, "N more features skipped (M in all): <description>", on the line of
  the first one folded in.
- The guide (`02-files.md`) lists the syntaxes.

## Per syntax

All are skipped with a named warning. None is supported, for one reason: a
`Segment` keeps no original location text (only `single` for `<23` and `>30`),
so reading `bond(24)` as base 24 would be written back as `24`: a different
operator, silently, and for `join(bond(a),bond(b))` a plain join. That is not
lossless, so nothing here changes a feature's geometry.

| Syntax                                         | Status                                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `bond(...)`, `site(...)`                       | named and skipped; follow-up: a `bond` segment kind (or carried operator text) written back unchanged |
| `gap(n)`, `gap()`                              | named and skipped; follow-up: a gap segment, which also needs sequence-length semantics               |
| `one-of(a,b)..c`, `(a.b)..c`, `a..(b.c)`, `?`  | named and skipped; follow-up: keep the exact text on the segment                                      |
| `..<`, `>..`, trailing `>`                     | named and skipped; the meaning of the old forms is not settled, so no guess                           |
| negative coordinates                           | named and skipped; the position lies outside the record                                               |
| remote `ACC:a..b`                              | named and skipped (message unchanged)                                                                 |
| `a.b`, `a^b`, `<a..>b`, `order`, circular wrap | unchanged                                                                                             |

## Evidence

Corpus run (409 GenBank-like files): every file's feature count and segments
are identical before and after; only warning text changed. P04637 Bond
features, `1MRR_A.gp` (8 skipped, now 5 listed plus a summary), `dbsource_wrap.gb`,
`negative_location.gb`, `NC_001284.gbk` and `dmel_2Lchunk.gb` (13 skipped, 5
listed plus a summary) now name their syntax.
