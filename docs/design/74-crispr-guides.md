# 74. CRISPR guide finder (#206)

**Asked:** finding CRISPR guides is the free feature that pulls students to
Benchling, and PlasmidPop had nothing for it. A first version: SpCas9 and a
small preset list, a custom PAM in IUPAC, both strands, correct through the
origin of a circle, GC / poly-T / homopolymer flags, off-targets within the
open documents, and oligos to clone a guide. On-target scoring only if it
could be checked against a published implementation.

**Decided: a scan in `core/analysis/crispr.ts` behind the usual worker
request, a `CRISPR` sidebar tab, and no on-target efficiency score at all.
A specificity score was added later (see the end).**

## No score

Rule Set 2 (Doench 2016) and its kin are trained models, not formulas: a
reimplementation that is not checked against the original's own outputs is a
number that looks like a score and is not one. Azimuth is a Python package
with a model file and no published vector of test cases, and nothing in the
project's oracle setup could have pinned ours to it. The issue said to ship
without a score rather than ship a heuristic wearing one, so the panel shows
only what it can stand behind: the off-target counts, and the four flags
whose causes are mechanical (an exact second site, `TTTT` terminating a Pol
III transcript, GC outside 40–80%, a run of five bases). The guide page says
so in as many words, next to the other thing that must not be misread —
that off-targets are counted in the open documents only, because there is no
genome here and no backend to hold one.

This is the first feature where the honest answer was to leave a column out.
Worth remembering when the next scored thing comes up.

## The scan

One window per base per strand, as the restriction and ORF scans do.
A circle gets `W - 1` of its own bases appended so a window may cross the
origin and still be read with plain string indexing; the reverse strand is
the reverse complement of the whole molecule, read the same way, and
`toForward` puts strand-local coordinates back on the forward strand.
Coordinates are unrolled, 0-based half-open, as everywhere else.

Two asymmetries are deliberate:

- **A PAM must be certain, a spacer must be plain `ACGT`.** An `N` in a
  sequencing gap cannot become a target.
- **An off-target candidate matches if it _could_.** The same `N` counts
  against every guide. Ambiguity may never hide a cut site; it may only
  fail to offer one.

`pamWindows(strict)` is the one switch between the two readings, so they
cannot drift apart.

Cut positions are per nuclease and per strand: `cut.pamStrand` and
`cut.targetStrand`, counted from the spacer's 5′ end along the strand the
PAM is on. Cas9 cuts both at the same place and Cas12a does not, and a guide
reports the two as forward- and reverse-strand boundaries, so the staggered
5′ overhang is visible rather than implied. A custom PAM is assumed to be
Cas9-like (3′ of the spacer, blunt three bases in) because the engineered
variants that need one — Cas9-NG, SpRY, SaCas9-KKH — all are; anything else
needs a preset.

## Off-targets, and why they are not quadratic

Counting off-targets compares each guide with every other PAM-adjacent site,
and a record has about as many sites as guides: a 200 kb BAC has ~25,000
SpCas9 sites, so done plainly that is 625 M comparisons, measured at 8.2 s.

The fix is the pigeonhole principle. Two spacers differing in at most _k_
places must share one of any _k_ + 1 equal blocks, so `SeedIndex` buckets
the sites by each of their _k_ + 1 blocks and a guide is only compared with
the sites sharing a block with it. Sites whose spacer is ambiguous belong to
no bucket and are compared with every guide; a real record has very few.
200 kb went to 818 ms, a 10× cut, and the comparison itself stayed as it was
— four bit planes ANDed and a popcount, which is what makes the surviving
comparisons cheap. `docs/perf-notes.md` has the table.

The index is pure bookkeeping: it skips comparisons that could not have
matched, so it must not change an answer. The Biopython oracle below passing
unchanged before and after is what says it does not.

## Checked against Biopython

`scripts/oracle/crispr.py` → `src/test/oracle/crispr.json`, compared by
`src/test/oracle/crispr.test.ts`. The PAM search there is
`Bio.SeqUtils.nt_search`, which expands the IUPAC codes itself — a different
matcher, not a port of ours — and the cut geometry is written from the
published description of each nuclease. It pins every guide of pUC19,
pBR322, phiX174 and the linear U49845 record, plus random circles where the
origin falls inside a spacer or a PAM: coordinates, PAM, both cut
boundaries, and for pUC19 the off-target counts by mismatch as well. pUC19
is also scanned after being rotated 1,337 bases, which must give the same
guides.

The unit tests add what the oracle cannot reach: the ambiguity rules (a
real fixture is plain `ACGT`, so "could match" and "does match" coincide
there), the listing cap, and a brute-force scan of random sequences written
the slow, obvious way.

## Not done

- No genome-wide specificity, and no plan for one: it needs a backend
  (CLAUDE.md, Non-goals). The panel says so rather than leaving it to be
  assumed.
- No on-target score, as above. If a published implementation ever ships
  test vectors, it becomes a column and an oracle file.
- Base and prime editing windows, and paired nickases, are each a feature of
  their own.
- The guides are a preview overlay, not a track that can be exported with
  the map (#212 would be where that lands).

## The panel, revised (2026-10-09)

A first pass at the tab put the selected guide's details after the list,
which can be 200 rows long: a guide clicked on the map opened somewhere off
the bottom of the sidebar. The details now open in place under the row
(`GuideDetail`, inside the row's `<li>`), and the row is scrolled into view
when the click came from a view. The Overhangs select took its label's line
and spilled past a 300 px sidebar; it sits under its label now, and the
buttons wrap as whole pills rather than as two-line ones.

Filters were added on the result rather than the scan — spacer contents in
IUPAC, the PAM actually found, hide flagged — so they are instant, with GC
as a third sort. Spacer length was considered and left out as a filter: the
nuclease fixes it, so every guide in a list has the same one. A GC range
was left out too; the flags already mark the 40–80% band and the sort finds
the rest.

Measuring this turned up a rescan per click: `documents` in the store is a
new array on every selection change, the list of other documents was
rebuilt from it, and the worker request keyed on that list. The list is now
state replaced only when a document's name, sequence or topology differs,
and a test counts the worker calls across a click.

## Specificity score (2026-10-09)

Asked for guide scores, the line this note drew was kept: only what is a
published formula, not a trained model. The MIT off-target score (Hsu 2013)
is one: twenty position weights, a mean-distance damping and 1/n², summed
over off-target sites as `100 / (100 + Σ)`. It is computed in the same
loop that counts off-targets, from the bit planes' mismatch positions, over
every site found, not the 50 listed. SpCas9 NGG with a 20 nt spacer only;
every other nuclease gets `null` and the panel hides the row.

It is an upper bound: it sees only the sites within the chosen mismatch
limit (default 3) and only the open documents. The guide page says so. The
unit tests pin the formula by hand arithmetic, not against another
implementation, so the weights are the one thing checked by reading, not by
an oracle. On-target scores (Rule Set 2, CRISPRscan) stay out until a
reference implementation with test vectors is available.
