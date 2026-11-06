# CRISPR guides

The **CRISPR** tab finds guide RNA target sites: every protospacer next to a
PAM, on both strands, including sites that cross the origin of a circular
sequence. The scan runs in the background and follows the document, so an
edit gives a new list without asking. The tab's settings and its list are
kept per document while you look at another tab, so coming back does not
scan again.

The tab itself is short: the **Nuclease**, **Only cuts in the selection**, a
line saying how many guides were found and how many have no flag, the first
eight of them, and links to the **CRISPR workspace**, where everything else
is. Each row shows the strand (→ forward, ← reverse), the spacer with its
PAM run on in grey, the GC content, and the off-target counts. A row with a
`!` has something worth a look — hover it for what. Clicking a row selects
the protospacer in the views, and two buttons appear under it: **Add as
feature** and **Details ›**, which opens the workspace on that guide.
Clicking the open row again clears the selection. The rows are in the
workspace's order, along the molecule unless you sorted it otherwise, so
**Only cuts in the selection** is the way to make the eight the ones you
want; the flagged guides are left out until the workspace's **Show flagged**
is pressed.

While the tab or the workspace is open, every guide listed is drawn on the map and in the
sequence view as an arrow on its own strand labelled with its PAM (see
[Previews](03-viewing.md#previews)); clicking one there selects it, and it
opens under its row in the tab or on the workspace's **Guides** page. Past 200 guides none are drawn — filter
the list or narrow the scan to a selection to see them.

## The tab and the workspace

**Open CRISPR workspace ›**, at the foot of the tab, opens the whole of it in
a larger view beside the map, as **Open Enzyme workspace ›** does for
[Enzymes](07-enzymes.md#the-tab-and-the-workspace). It has three pages down
its left edge:

- **Guides** — the options (nuclease, off-targets, base editor), the
  filters, the guide list with each guide's details, and **Add N listed as
  features**.
- **Pairs** — the [paired nickases](#paired-nickases); the tab's **Paired
  nickases ›** opens it, for the nucleases that allow them.
- **Prime** — [prime editing](#prime-editing); the tab's **Prime editing ›**
  opens it, likewise.

The tab and the workspace share one scan, so what is set or found in one is
set and found in the other, and switching between them does not scan again.
Their settings and filters are kept per document while you look at another
tab.
The workspace is a region of the window, not a dialog: `Esc` with the
keyboard inside closes it and puts the keyboard back on **Open CRISPR
workspace ›**, and choosing another sidebar tab closes it too; the page it was
left on is remembered. On a phone it fills the screen.

## Filtering the list

In the workspace's **Guides** page, **Options** sets what is scanned for and
**Guides** lists what was found, all of it rather than the tab's eight. The
filters at the top of **Guides** work on the guides already found, so they
are instant and the group's title says how many are shown, as in **139 of
345**. The tab's rows follow them:

- **Spacer contains…** keeps the guides whose spacer has the bases typed, in
  IUPAC codes as in Find — `GRCC` or `TTTN` work — which is how to find a
  guide from a paper, or one starting with a `G` for a U6 promoter.
- **PAM** keeps one PAM out of those found: SpCas9's `NGG` is four of them,
  and the CRISPR literature prefers some over others.
- **Show flagged** lists the guides with a `!` too. They are hidden until
  it is pressed, so the list opens on the clean ones and the title's
  **139 of 345** says how many were set aside.

Spacer length is not a filter: it is fixed by the nuclease, so every guide
in a list has the same one.

## What it cannot tell you

**Off-targets are counted in the open documents only.** PlasmidPop has no
genome and makes no network request to search one, so the counts say where
else a guide would cut _this plasmid_ — which is what matters when the guide
has to leave the backbone alone — and nothing whatever about specificity in
a cell. Check a guide against the host genome with a genome-wide tool
(CRISPOR, CHOPCHOP, Benchling) before ordering it. The workspace says this under
its options until **Got it** is pressed; from then on the dotted
**Off-targets up to** label keeps it as a tooltip.

There is no on-target efficiency score. The published scores are trained
models, and PlasmidPop ships a number only when it can be checked against
the implementation it came from; until then the flags below are what it
will stand behind.

## Nucleases

**Nuclease** picks what to look for:

| Nuclease | PAM      | Spacer | Cut                                             |
| -------- | -------- | ------ | ----------------------------------------------- |
| SpCas9   | `NGG`    | 20 nt  | blunt, 3 bp from the PAM                        |
| SaCas9   | `NNGRRT` | 21 nt  | blunt, 3 bp from the PAM                        |
| AsCas12a | `TTTV`   | 23 nt  | staggered, 5-base 5′ overhang, PAM 5′ of spacer |

**Custom PAM…** takes a PAM written in IUPAC codes — `N` any
base, `R` A or G, `V` not T, and so on — and a spacer length of 15–30. A custom PAM is taken to sit 3′ of
the spacer and to cut bluntly three bases in from it, which is what the
engineered Cas9 variants do (`NG` for Cas9-NG, `NRN` for SpRY, `NNNRRT` for
SaCas9-KKH). A nuclease with another geometry needs a preset.

An ambiguous base in the document never makes a guide: a PAM has to be
certain and a spacer has to be plain `ACGT`, so an `N` in a sequencing gap
cannot be mistaken for a target. The same `N` does still count _against_ a
guide as a possible off-target, so an ambiguity never hides one.

## Off-targets

**Off-targets up to _n_ mismatches** sets how different another site may be and
still be counted, from 0 to 4. The counts in a row read exact, then one
mismatch, then two, and so on: `1 · 0 · 2 · 0` is one exact second site and
two sites differing in two bases. Only places with a real PAM are counted —
a near-match with no PAM is not a target.

**Count off-targets in the other open documents too** adds every other open
nucleotide document to the search, which is how to check that a guide for an
insert does not also cut the vector it is going into. The selected guide's
**Other sites** list says which document each hit is in, and **Show** jumps
to the ones in this one.

**Sort by** orders the list along the molecule, worst-first by off-targets
— fewest exact hits, then fewest near ones — or by GC content, highest
first, or by specificity, highest first (SpCas9 only; guides without a score
go last).

## Specificity score

For SpCas9 (NGG, 20 nt) a guide's details show a **Specificity** from 0 to
100: the MIT score of Hsu et al. (2013). Each off-target site is weighted by
where its mismatches fall (mismatches near the PAM hurt most, and a few
spread-out ones count less than a cluster), and 100 means no other site was
found. Two exact copies of a guide score 50.

Read it as an upper bound. It sees only the sites within **Off-targets up to
_n_ mismatches** and only the open documents, so a guide that scores 100
here is not known to be specific genome-wide. It is not an efficiency
score, which PlasmidPop does not give. Other nucleases show none, because
the weights were measured for SpCas9 only.

## Flags

A guide is flagged for the things that are known to go wrong, none of which
are efficiency predictions:

- **Binds somewhere else exactly** — the spacer occurs at another PAM site
  in what was searched.
- **TTTT ends a U6 transcript** — four T's in a row terminate Pol III, so a
  guide expressed from a U6 promoter is cut short.
- **Low or high GC** — outside 40–80%.
- **A run of one base** — five or more of the same base in a row.

## Narrowing the scan

**Only cuts in the selection** keeps the guides whose cut falls inside the
selected range — select a feature in the feature list, or a stretch in
either view, to get the guides that cut there. The cut, not the protospacer,
is what has to be in the range, so a guide reading into the region from
outside it still counts if it cuts inside. For AsCas12a, whose two strands
are cut five bases apart, it is the break on the PAM strand that counts.

The region is taken when you tick the box, and the tab shows it under the
box. Clicking a guide afterwards selects that guide without narrowing the
list to it. To narrow to a different stretch, select it and press **Use the
selection now**, or untick and tick the box again.

## Base editing

With SpCas9 (NGG), the workspace's **Base editor** marks where a base editor can act. Choose
**CBE** (C to T, protospacer positions 4–8), **ABE7.10** (A to G, 4–7) or
**ABE8e** (A to G, 4–8). Positions count from the spacer's 5′ end, so the
PAM is 21–23. Each row then shows how many bases of the right kind sit in the
window, **Only with a C to edit** (or A) hides the guides with none, and a
guide's details list the bases (such as `C4, C8`), where they are, and the
spacer with all of them converted. More than one base listed means
bystander edits: the window does not say how likely each is. On a
reverse-strand guide the base in the sequence is the complement, so a C to T
edit is a G to A there. The windows are measured for a 20 nt SpCas9 spacer, so
the choice is not offered for other nucleases.

## Prime editing

The workspace's **Prime** page designs pegRNAs for the guides found. Give
the **Edit at** position (1-based), how many bases it **Replaces** and what
it is replaced **With** (nothing deletes; zero bases replaced inserts), or
select the bases and press **Use the selection**. **PBS** sets the primer
binding site length, 8–17 (13 by default).

For each guide whose nick lies up to 30 bases before the edit on the
guide's strand, nearest first, the list gives the primer binding site, the
reverse-transcriptase template (the edit plus ten bases of homology) and the
3′ extension, which is the template followed by the primer binding site.
**Copy spacer and extension** puts the two to order on the clipboard;
add them to your scaffold. It also says whether the edit changes the PAM,
which stops the edited site being nicked again, and flags a template that
starts with C, a primer binding site outside 40–60% GC, and TTTT. An edit
before the nick, or too far after it, has no pegRNA from that guide. PlasmidPop
does not rank pegRNAs by predicted efficiency, and does not design the
second nick of PE3.

## Paired nickases

For SpCas9 and the other nucleases that cut both strands at one point, the
workspace's **Pairs** page lists pairs of guides on opposite strands whose
nicks, one on each strand, are close enough to make a staggered
double-strand break. Each pair shows its two guides and the overhang: the
offset between the nicks, and whether it is a 5′ or 3′ overhang. **Nickase**
picks which strand each guide's nick falls on: **D10A** nicks the strand the
guide pairs with, **H840A** the PAM strand. With D10A, guides whose PAMs
face outward (PAM-out) leave 5′ overhangs, the arrangement reported to work
best, and guides facing inward leave 3′ overhangs. **Nicks at most … apart**
sets the largest offset listed (100 by default). **Show** selects the span
of both guides. Pairs are ranked by the distance between the nicks only; no
pair is scored, and nothing is checked for off-target nicking beyond what
each guide's own row shows. Pairing works through the origin of a circular
sequence.

## Ordering and annotating a guide

The selected guide's box, under its row on the workspace's **Guides** page
(**Details ›** in the tab opens it), gives its protospacer range, spacer,
PAM, where both strands are cut, GC and flags, and the buttons below.

**Add as feature**, in the tab and in the box, annotates the protospacer on the document as a
`misc_feature` on its strand, with the PAM in a note, and takes you to the
feature list to name it. It is an ordinary edit, so undo takes it back.

**Add N listed as features**, above the workspace's list, annotates every guide the
filters leave in the list in one go, so a whole set is saved with the file,
exported to GenBank and drawn on the maps like any feature. Narrow the list
first (a selection, the filters, hiding flagged guides) to annotate only
the ones you want. One undo takes them all back.

**Oligos to order** writes the two oligos to anneal and clone, 5′→3′.
**pX330 / lentiCRISPRv2** adds the `CACC` and `AAAC` overhangs those vectors'
BbsI and BsmBI sites take, and a `G` in front of a spacer that has not got
one, since the U6 promoter starts with G. These are Cas9 sgRNA vectors, so
the choice is offered for SpCas9, SaCas9 and custom PAMs but not for
AsCas12a, whose crRNA vectors take other overhangs. **No overhangs** gives
the bare spacer and its reverse complement, for any nuclease. **Copy oligos** puts both on the
clipboard; **Save to My primers** puts them in
[My primers](10-primers.md#my-primers), where they can be exported with the
rest of an order.
