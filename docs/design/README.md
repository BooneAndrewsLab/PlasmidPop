# Design notes

Each file here is one numbered item of work: what was asked for, what was
built, and why it was built that way. The numbers are stable — code comments
and the notes themselves cite them as "item N", which means
`docs/design/NN-*.md`.

These notes were kept in `CLAUDE.md` up to release 1.1.0 (2026-09-22). The
"Not yet" lists at the ends of the items are a snapshot from then; open work
is tracked in GitHub Issues now, not here. A new design note is added when a
piece of work needs its reasoning written down, with the next free number.

## Items

1. [Amino-acid translation under CDS features](01-cds-translation.md)
2. [Copy and paste with features](02-copy-paste-features.md)
3. [Simulated cloning](03-simulated-cloning.md)
4. [Translation of any selected range in six frames](04-six-frame-translation.md)
5. [History panel](05-history-panel.md)
6. [Multiple open documents (tabs)](06-tabs.md)
7. [Enzyme table from REBASE](07-rebase-enzymes.md)
8. [Linear map export as SVG](08-linear-svg-export.md)
9. [Sequence view options](09-sequence-view-options.md)
10. [Linear molecule end handling](10-linear-ends.md)
11. [Sharing, without a backend](11-share-links.md)
12. [User documentation](12-user-guide.md)
13. [Licence](13-licence.md)
14. [Circular map zoom](14-map-zoom.md)
15. [Mobile-friendly layout](15-phone-reader.md)
16. [Make tiny features visible on the circular map](16-tiny-features.md)
17. [Create from scratch](17-new-document.md)
18. [Sidebar tab strip that stays on one row](18-sidebar-rail.md)
19. [Selecting amino acids in the sequence view](19-select-codons.md)
20. [Hide cut sites without losing the enzyme selection](20-hide-cut-sites.md)
21. [Show edits in the sequence view](21-edit-marks.md)
22. [Working copies: the opened file is never written to](22-working-copies.md)
23. [Feature naming: `/gene` outranks `/product`, so one gene's name spreads over every feature that mentions it](23-feature-naming.md)
24. [One way out: download, never write](24-download-only.md)
25. [A diff on the map, not only in the sequence](25-map-diff.md)
26. [Preview a primer before it becomes a feature](26-preview-channel.md)
27. [Name the features a diff removed](27-removed-feature-names.md)
28. [Drag the boundary between the map and the sequence](28-splitters.md)
29. [Map labels are written over by the ruler, and drift across the map as they are spaced](29-map-label-spacing.md)
30. [Filter the enzyme list by how many times an enzyme cuts, not just "once"](30-cut-count-filter.md)
31. [A crowded side of the map places its labels outrageously](31-crowded-map-labels.md)
32. [Key bindings for the things that were only ever a click away](32-key-bindings.md)
33. [File ▸ Compare with… another file on disk](33-compare-with.md)
34. [Turning a sticky-ended molecule over loses the window shift](34-sticky-flip.md)
35. [A feature whose type changed reads as a removal and an addition](35-feature-type-change.md)
36. [PCR: the reaction that makes a part](36-pcr.md)
37. [Tests that a plasmid comes out as it went in](37-correctness-tests.md)
38. [Usage statistics that can say what is not used](38-usage-events.md)
39. [Isoschizomers share a row](39-isoschizomer-rows.md)
40. [Enzymes that cut on both sides of their site](40-double-cutters.md)
41. [The gel's percentage and ladder, and a reversible order](41-gel-settings.md)
42. [A double-digest partner for one enzyme](42-digest-partner.md)
43. [SnapGene fixtures, checked against Biopython](43-snapgene-fixtures.md)
44. [Dam and Dcm methylation](44-dam-dcm.md)
45. [Align: ambiguity codes, larger inputs, files](45-align-reads.md)
46. [Sequencing reads: AB1 and FASTQ](46-sequencing-reads.md)
47. [Site-directed mutagenesis](47-mutagenesis.md)
48. [Gateway cloning](48-gateway.md)

## Changelog to 1.1.0

The status paragraph `CLAUDE.md` carried until 1.1.0, kept as it was.

**1.0.0 is the first public release** (2026-09-22), the version the repo went
public at and the first to be archived on Zenodo for a citable DOI. Bump
`package.json` and `CITATION.cff` together; each GitHub Release gets a DOI of
its own, and the concept DOI in `CITATION.cff` stands for all of them.
**1.1.0** (2026-09-22) adds the primer settings, the sidebar reorder, the
aligned Enzymes filters and the phone reader's read-only Features list.
**The site deploys only when a GitHub Release is published** (`deploy.yml`;
the `github-pages` environment allows `main` and tags `v*`), so a push to main
reaches no user until a release carries it. The guide's header shows the
version (`__APP_VERSION__`, defined from `package.json` in `vite.config.ts`).

Build order steps 1–10 are implemented and committed; step 11 (backend) is
dropped rather than pending — the app stays a static site, and sharing is a
link, not an account (decided and built 2026-09-21, item 11). Beyond the build order, these have landed: Download GenBank
(write-back through the File System Access API came first and item 24 took
it out again), SVG map export, selection export, find (Ctrl+F), a full
feature editor, a History sidebar tab, sequence-view / selection SVG
export, tracked-changes marks for the sequence view (`src/core/diff/`, the
**Edits** menu), a bundled example
(pBR322), an optional REBASE enzyme table imported from the user's own
download (`src/io/rebase/`), and Matomo usage statistics (`src/app/analytics.ts`,
always on when configured, no user toggle by decision of 2026-09-18;
events at file open/new/download/export, enzyme show, primer design, align,
ligate, history jump, edit-mark baseline; the Pages workflow sets the
instance URL and site id 6). The view switcher, the Complement /
Translations / Cut sites toggles, the Format menu's sequence-view options,
the Edits baseline, the pane sizes and whether the sidebar is open are
remembered in localStorage
(`src/app/state/viewPrefs.ts`, applied and watched by `useViewPrefs`);
documents and enzyme ticks are unaffected. The logo
(`design/logo/`, made in Claude Design) is used for the favicon, PWA icons (`scripts/make-icons.sh`) and the toolbar lockup
(`src/app/components/Logo.tsx`; wordmark outlined by
`scripts/make-wordmark.py`, no webfont). Added 2026-09-19: runs of typing
coalesce into one undo step, the Cloning tab's assembly shelf survives a
reload, Golden Gate assembly (items 5 and 3 under "Potential new
features"), and the rough edges the REBASE import left (item 7) are
cleared. Added 2026-09-20: working copies, so the file a document was opened
from is never written to (item 22). Added 2026-09-21: **nothing writes to a
file at all any more** — a document lives in this browser and leaves it as a
download (item 24). Added 2026-09-21: a feature takes its name from the
qualifiers that suit its type, so `/gene` no longer labels every feature
inside a gene (item 23). Added 2026-09-21: **File ▸ Copy share link** — a
document travels whole inside the URL fragment, so it reaches the person it
is sent to without being uploaded anywhere, and the Matomo call now reports
a page URL with the fragment cut off (item 11). Added 2026-09-21: the
circular map's labels are spaced against the ruler's numbers and each other,
slide along the ring rather than across the map, and are left out with a
count in the corner rather than stacked on top of one another when the ring
is full — hovering a feature or a cut site brings its own back, and the SVG
export grows its canvas instead of dropping anything (item 29). Added 2026-09-21: a
**preview channel** both views draw beside the document's own annotation
(`src/view/overlay.ts`), used by the Primers tab for a designed pair and its
product and by Find for every match at once, so weighing up candidates costs
no edit (item 26). Added 2026-09-21: the boundaries between the map, the
sequence and the sidebar are **dragged** rather than fixed ratios
(`src/app/components/Splitter.tsx`, one splitter used twice; the fractions and
the sidebar's width are remembered in `viewPrefs`, **Format ▸ Reset the
layout** puts them back), and clicking the open sidebar tab collapses the
sidebar to its rail (item 28), and the Enzymes tab filters by how often an
enzyme cuts rather than only "once" (item 30; that filter and the supplier one
are remembered, the search box is not). Added 2026-09-21: a map label slides only
a short way from its own tick, the labels read in the order their ticks are
and their leaders do not cross, all three measured by rendering rather than
asserted (item 31), and the review before a download names the features a
removal took and where they were rather than counting them (item 27).
Added 2026-09-21: **every NCBI genetic code**, generated from
NCBI's own file rather than typed in — table 2's TGA is tryptophan, and
before this a mitochondrial gene was read with the standard code and chopped
short with nothing said (item 1) — a **Code** chooser for the Translate and
ORFs tabs (item 4), and a check of each CDS against the `/translation` its
file carries, reported in the status bar when a file is opened (item 1).
Added 2026-09-21: **File ▸ Compare with…**, which reads a file, says how the
open document differs from it and drops it, sharing its body with the
download review (item 33); features are matched by content there, since two
files agree on nothing internal. Added 2026-09-21: `Alt` **key bindings** for
the view toggles, the edit marks, the sidebar, the document tabs and the
share link, and `Ctrl+Shift+←`/`→` to extend a selection a codon at a time
(item 32). Added 2026-09-22: the **circular map marks tracked changes** too —
arcs over the backbone where bases are new or replaced, a wedge where they
closed up, an outline on a feature that was touched — and the review before a
download and **Compare with…** both open with that ring, so where a change
landed is the first thing said rather than the last (item 25). Added 2026-09-22:
a molecule has a **name that does not change with how it is written** — the
SEGUID v2 checksum (`src/core/checksum/`, our own synchronous SHA-1, checked
against the reference implementations' vectors), shown short in the status bar
and copied whole on a click. **Compare with… lines a rotated plasmid up**
before diffing it instead of calling it different throughout (item 33's last
open point), and a working copy carries
`PlasmidPop-derived-from: cdseguid=… pBR322.gb` into every file and share link
it leaves as, which is what items 22 and 11 were both waiting on. Added
2026-09-22: **turning a sticky-ended molecule over moves the window** the
sequence is written over, which the checksum had just caught it not doing
(item 34). Added 2026-09-22: **a phone reader** (`PhoneShell`, item 15) — under
600 px one pane at a time behind a bar of three tabs, a toolbar cut to the name
and the File menu, touch that taps and scrolls rather than selecting, and a
tapped feature keeping its label as a hovered one does. Added 2026-09-22:
**a diagnostic digest is chosen by its bands** rather than by how often an
enzyme cuts — every row carries the bands that enzyme alone would give and an
**Order** select sorts by how far apart they are, over a model of a 1 %
agarose gel (`src/core/analysis/gel.ts`, item 30). Added 2026-09-22:
**Gibson assembly** (`src/core/cloning/gibson.ts`, item 3), which joins parts
by the homology at their ends rather than by an enzyme's overhang, and takes
its parts from the open tabs and the ligation shelf alike, as Golden Gate now
does. Added 2026-09-22: the Cloning tab **shows one reaction at a time** and
**draws the digest's fragments on both views** through the preview channel,
where clicking one shelves it (item 3); **each document tab keeps its own
sidebar panel** (item 6). Added 2026-09-22: a feature that differs between
two files is **paired with the one it became** instead of being reported as a
loss and a gain, the review says what changed about it (`type gene → CDS`),
and the outline in the views is **solid where the bases moved and broken
where only the label did** (item 35). Added 2026-09-22: **PCR**
(`src/core/cloning/pcr.ts`, `src/core/primers/anneal.ts`, item 36) — the
Cloning tab's fourth reaction and the one that _makes_ a part rather than
joining parts, annealing a primer by its 3′ end so a 5′ tail (a site, a
Gibson arm, a mutation) is carried into the product; and the **gel is drawn**
rather than only described (`src/app/components/Gel.tsx`, item 30), a lane
beside a chosen ladder under the Enzymes tab's ticked fragments and under the
PCR products, where clicking a band selects that piece. Added 2026-09-22: **primer
settings** (`src/core/primers/criteria.ts`, `PrimerSettings.tsx`) — length,
Tm, GC and ΔTm ranges, where each primer is looked for relative to the
selection's start and end (a negative near edge reaches into it), and
filters for runs, hairpins (`longestHairpinStem`), self-dimers and 3′ dimers
with itself or the partner (`threePrimeComplementarity`), plus a required GC
clamp, a product size range, and refusing a primer that also anneals
elsewhere on the template (`requireSpecific`, on by default; cost in
`docs/perf-notes.md`); one `PrimerCriteria` drives both the designer and
**Check a primer**, and is kept in `viewPrefs`. The phone reader's Features
list (`FeatureList`'s `reader`) offers no Rename / Edit / Remove, so a
stray tap cannot fork a shared plasmid (item 15). The sidebar tabs now read Features, ORFs,
Translate, Primers, Enzymes, Cloning, Align, History, and the Enzymes tab's
Filter / Cuts / Order / Sold by sit in one two-column grid (`.panel__form`).
Tests: 972 passing.
Perf measurements live in `docs/perf-notes.md`.

## Open questions at 1.1.0

Moved to GitHub Issues; kept here as they stood.

- Enzyme database source: settled and built (item 7). REBASE data is all
  rights reserved, so it is imported from the user's own download rather
  than bundled. Only a full bundle would need NEB's permission.
- Which SnapGene .dna versions to support and where to get test fixtures.
- Whether the `/translation` check should follow edits rather than run only
  when a file is opened, and where a per-feature "this no longer matches"
  marker would live if it did (item 1).
- Auth provider: moot, there is no backend (decided 2026-09-21).
- Where to refuse a share link for length, and what a document opened from
  one counts as in item 22's terms (item 11).
- Whether a preview can show a molecule that is not open. The channel draws
  spans on the document in front of you, which is why a Golden Gate or Gibson
  product cannot be previewed before it is assembled: it is a different
  molecule, not a range of this one. A PCR product _is_ a range of this one,
  which is why item 36 could preview its products and those two still cannot.
  Opening it and looking is the answer for now, and a second surface to draw
  on is a much larger idea than the want behind it (items 3, 26 and 36).
- Whether the shelf is the ligation's or the bench's. Both one-pot reactions
  take parts from it now, and a fragment clicked in a view lands there, but
  it still lives under **Ligation** and adding to it switches the picker
  there. If it grows a third use it wants a place of its own (item 3). A PCR
  product is the obvious third thing to put on it and deliberately is not:
  it opens as a tab, which the tube already takes (item 36).
