# CRISPR guides

The **CRISPR** tab finds guide RNA target sites: every protospacer next to a
PAM, on both strands, including sites that cross the origin of a circular
sequence. The scan runs in the background and follows the document, so an
edit gives a new list without asking. The tab's settings and its list are
kept per document while you look at another tab, so coming back does not
scan again.
A step-by-step exercise with a sample file, for picking a guide, adding guides
as features, paired nickases and prime editing, is the
[CRISPR tutorial](../tutorials/crispr.md).

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

While the tab or the workspace's **Guides** page is open, every guide listed is
drawn on the map and in the sequence view as an arrow on its own strand
labelled with its PAM (see [Previews](03-viewing.md#previews)); clicking one
there selects it, and it is the selected row in the tab or on the **Guides**
page, with its details. Past 200 guides none are drawn on the views — the
workspace's table still lists them all; filter the list or narrow the scan to
a selection to see them drawn. What the views draw follows the workspace's
page: the **Pairs** page draws the open pair's two guides and the **Prime**
page the guides that could make the edit and the edit itself.

## The tab and the workspace

**Open CRISPR workspace ›**, at the foot of the tab, opens the whole of it in
a larger view beside the map, as **Open Enzyme workspace ›** does for
[Enzymes](07-enzymes.md#the-tab-and-the-workspace). It has three pages down
its left edge:

- **Guides** — [the guide table](#the-guide-table): the settings (nuclease,
  off-targets, other documents, the region), the filters, every guide found
  with the selected one in full beside it, and **Add N listed as features**.
- **Pairs** — the [paired nickases](#paired-nickases), a table of the pairs
  of guides whose nicks make a staggered break; the tab's **Paired nickases
  ›** opens it, for the nucleases that allow them.
- **Prime** — [prime editing](#prime-editing), the edit's form and a table of
  the pegRNAs for it; the tab's **Prime editing ›** opens it, likewise.

The rail counts what each page lists: the guides, the pairs, and the pegRNAs
once an edit is typed. For a nuclease that cannot make pairs or pegRNAs, the
two pages say what they need and send you to **Guides**.

The tab and the workspace share one scan, so what is set or found in one is
set and found in the other, and switching between them does not scan again.
Their settings and filters are kept per document while you look at another
tab.
The workspace is a region of the window, not a dialog: `Esc` with the
keyboard inside closes it and puts the keyboard back on **Open CRISPR
workspace ›**, and choosing another sidebar tab closes it too; the page it was
left on is remembered. On a phone it fills the screen.

## The guide table

The workspace's **Guides** page has, from the top, the **settings** that
change what is scanned for — **Nuclease** (and the PAM and spacer length of a
custom one), **Off-targets up to**, **Count off-targets in the other open
documents too** and **Only cuts in the selection** — then the **filters**,
then a table of every guide found, not the tab's eight. The page's heading
says how many were found and how many have no flag, as in **578 · 112
clean**, or **139 of 345** when the filters have left some out. The line
under the table says the same in words, and how many of the guides found
have no flag.

The filters work on the guides already found, so they are instant:

- **Spacer contains…** keeps the guides whose spacer has the bases typed, in
  IUPAC codes as in Find — `GRCC` or `TTTN` work — which is how to find a
  guide from a paper, or one starting with a `G` for a U6 promoter.
- **PAM** keeps one PAM out of those found: SpCas9's `NGG` is four of them,
  and the CRISPR literature prefers some over others. It is offered when
  more than one was found.
- **Show flagged** lists the guides with a `!` too. They are hidden until
  it is pressed, so the table opens on the clean ones and the heading's
  **139 of 345** says how many were set aside.
- **Base editor** and **Only with a C to edit**, with SpCas9 (see
  [Base editing](#base-editing)).

Spacer length is not a filter: it is fixed by the nuclease, so every guide
in a list has the same one.

Each row of the table is a guide:

- **#**, its place in the list as it is now ordered;
- the strand (→ forward, ← reverse) and the **position** of the protospacer,
  1-based;
- the **spacer**, and its **PAM**;
- **GC**, the share of the spacer that is G or C;
- the off-target counts, a column each: **Exact** for the other places with
  the same spacer and a PAM, then **1 mm**, **2 mm** and so on up to the
  setting of **Off-targets up to** (see [Off-targets](#off-targets));
- **Spec.**, the [specificity score](#specificity-score), with SpCas9
  (NGG, 20 nt) only;
- with a base editor chosen, the number of bases it would edit
  (**C→T**, or **A→G**);
- a `!` for a guide with a [flag](#flags): hover it for what.

**Position**, **GC**, **Exact**, each of the mismatch columns and **Spec.**
order the table; click a column again to turn it round. **Position**, the
order along the molecule, is where it starts; **GC** and **Spec.** begin with
the highest, and **Exact** with the fewest exact hits, then the fewest near
ones. The order is shared with the tab, so the tab's eight are the first
eight in it. A long list is drawn a screenful at a time, so a 200 kb
sequence's thousands of guides cost no more than a plasmid's.

Clicking a row selects the protospacer in the views and shows the guide in
full beside the table (under it in a narrow window); clicking the open row
again clears the selection. The keys walk the table as they do the others
(see [Keyboard shortcuts](14-shortcuts.md#workspaces)): `↓` and `↑` select the
next and the previous guide, `Home` and `End` the first and the last, and
`Escape` puts the guide away. A guide clicked on the map or in the sequence
is scrolled to.

## What it cannot tell you

**Off-targets are counted in the open documents only.** PlasmidPop has no
genome and makes no network request to search one, so the counts say where
else a guide would cut _this plasmid_ — which is what matters when the guide
has to leave the backbone alone — and nothing whatever about specificity in
a cell. Check a guide against the host genome with a genome-wide tool
(CRISPOR, CHOPCHOP, Benchling) before ordering it. The workspace says this at the
head of the **Guides** page until **Got it** is pressed; from then on the
dotted **Off-targets up to** label keeps it as a tooltip.

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
still be counted, from 0 to 4, and how many count columns the table has. The
counts in a row read exact, then one mismatch, then two, and so on: `1 · 0 ·
2 · 0` is one exact second site and two sites differing in two bases. Only
places with a real PAM are counted — a near-match with no PAM is not a
target.

**Count off-targets in the other open documents too** adds every other open
nucleotide document to the search, which is how to check that a guide for an
insert does not also cut the vector it is going into. The selected guide's
**Other sites** table, under its details, says which document each hit is in
and how many bases differ, and **Show** selects the ones in this document (the
selection then no longer covers the guide, so its details close). At most 50
sites, the closest first, are listed for a guide.

The **Exact** column puts the guides in order of off-targets — fewest exact
hits, then fewest near ones — and a mismatch column of that count; **GC** and
**Spec.** by GC content and by specificity, highest first (SpCas9 only;
guides without a score go last).

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

With SpCas9 (NGG), the **Base editor** in the Guides page's filters marks where
a base editor can act. Choose
**CBE** (C to T, protospacer positions 4–8), **ABE7.10** (A to G, 4–7) or
**ABE8e** (A to G, 4–8). Positions count from the spacer's 5′ end, so the
PAM is 21–23. The table then has a column, **C→T** or **A→G**, of how many bases of
the right kind sit in the window (hover it for the editor), **Only with a C to
edit** (or A) hides the guides with none, and a guide's details list the
bases (such as `C4, C8`), where they are, and the spacer with all of them
converted. More than one base listed means
bystander edits: the window does not say how likely each is. On a
reverse-strand guide the base in the sequence is the complement, so a C to T
edit is a G to A there. The windows are measured for a 20 nt SpCas9 spacer, so
the choice is not offered for other nucleases.

## Prime editing

The workspace's **Prime** page designs pegRNAs for the guides found, all of
them, whatever the Guides page's filters have set aside. Across the top, give
the **Edit at** position (1-based), how many bases it **Replaces** and what
it is replaced **With** (nothing deletes; zero bases replaced inserts), or
select the bases and press **Use the selection**, which takes the position and
length of whatever is selected at that moment; a row of the table selects its
guide, so press it before choosing one. **PBS** sets the primer binding site
length, 8–17 (13 by default). The boxes are kept per document, with the
scan, while you look at another page or tab.

Under them is a table of the pegRNAs, one for each guide whose nick lies up to
30 bases before the edit on the guide's strand, nearest first: the guide
(its strand, spacer and PAM), the **Nick** (the nick falls after this base),
its **Distance** to the edit, the **PBS**, and whether the edit also changes
the PAM, which stops the edited site being nicked again (**PAM changed**). A
`!` flags a template that starts with C, a primer binding site outside
40–60% GC, and TTTT; hover it for what. An edit before the nick, or too far
after it, has no pegRNA from that guide, and when no guide is near enough the
page says so. The rail's **Prime** shows how many pegRNAs there are once an
edit is typed.

Clicking a row selects the guide's protospacer and shows its parts under the
table: the **PBS**, the **RT template** (the edit plus ten bases of homology)
and the **3′ extension**, which is the template followed by the primer binding
site, each with a **Copy**, and **Copy spacer and extension**, which puts the
two lines to order on the clipboard; add them to your scaffold. Clicking the
open row again puts it away. The views carry the guides that could make the
edit as arrows, as on the Guides page, and the edit itself as a tick: over the
bases it replaces, or on the one after an insertion, labelled with the new
bases. Clicking an arrow opens its row. The keys walk the table as they do
the others (see [Keyboard shortcuts](14-shortcuts.md#workspaces)).
PlasmidPop does not rank pegRNAs by predicted efficiency, and does not design
the second nick of PE3.

## Paired nickases

For SpCas9 and the other nucleases that cut both strands at one point, the
workspace's **Pairs** page lists pairs of guides on opposite strands whose
nicks, one on each strand, are close enough to make a staggered
double-strand break. **Nickase** picks which strand each guide's nick falls
on: **D10A** nicks the strand the guide pairs with, **H840A** the PAM strand.
**Nicks at most … apart** sets the largest offset listed (100 by default; an
empty box is the default). With D10A, guides whose PAMs face outward
(PAM-out) leave 5′ overhangs, the arrangement reported to work best, and
guides facing inward leave 3′ overhangs.

Under them is a table with a row for each pair, every one of them, the
closest nicks first: the guide whose nick is on the **forward** strand and
the one whose is on the **reverse** strand, each with its direction, its
position and its spacer, then how many bases the nicks are **Apart**, and the
**Overhang** they leave, 5′ or 3′ and how long, or blunt. The page says how
many pairs there are, and the rail's **Pairs** shows the same number. Pairs
are ranked by the distance between the nicks only; no pair is scored, and
nothing is checked for off-target nicking beyond what each guide's own row
shows. Pairing works through the origin of a circular sequence.

Clicking a row selects the span of both guides in the views and draws the two
as arrows, labelled with their PAMs, in place of the other guides while the
page is in front; clicking an arrow selects that guide. Clicking the open row
again, or `Escape` on it, clears the selection. The keys walk the table as
they do the others (see [Keyboard shortcuts](14-shortcuts.md#workspaces)).
The pair stays open when you look at another page and come back.

## Ordering and annotating a guide

The selected guide's pane, beside the table on the workspace's **Guides**
page (**Details ›** in the tab opens it), is headed with the guide's place and
strand. It gives the protospacer range, spacer, PAM, where both strands are
cut, GC, flags and the buttons below, and under them every **Other site**.

**Add as feature**, in the tab and in the pane, annotates the protospacer on
the document as a `misc_feature` on its strand, with the PAM in a note. It is
an ordinary edit, so undo takes it back. In the tab it takes you to the
feature list to name it; in the workspace, which the feature list would
close, it stays where it is and says **Added 1 feature.** with an **Undo**
beside it; rename the feature from the Features tab.

**Add N listed as features**, under the workspace's table, annotates every
guide the filters leave in the list in one go, so a whole set is saved with
the file, exported to GenBank and drawn on the maps like any feature. Narrow
the list first (a selection, the filters, hiding flagged guides) to annotate
only the ones you want. It says **Added N features.** with **Undo**, which
takes them all back in one step; the line goes once something else is done to
the document.

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

## When the scan stops

The scan runs in the browser's background worker. If that worker is stopped
(for want of memory on a very large sequence with many other documents, say)
the page says **The analysis stopped**, with the technical text under
**Technical details** and **Try again**, offered once; narrowing the scan to
a selection or counting fewer mismatches makes it smaller. A scan that takes
more than a quarter of a minute says that it is taking a while, and finishes
by itself.
