# Restriction enzymes

The **Enzymes** tab scans the sequence for the recognition sites of a
bundled table of about 130 common, commercially available enzymes. The scan
runs in the background whenever the sequence changes, on both strands, and
handles ambiguity codes in recognition sequences (`GRCGYC`), enzymes that cut
outside their site (Type IIS such as BsaI and BsmBI) and sites that wrap the
origin of a circular sequence. A site longer than a circular sequence is not
found in it, since spelling it would mean reading round the circle more than
once. You can swap the bundled table for the whole
of REBASE — see [Importing the full REBASE table](#importing-the-full-rebase-table)
below, or add a single enzyme of your own — see
[Adding your own enzyme](#adding-your-own-enzyme).
A step-by-step exercise with a sample file, for the enzymes that cut once, a
double digest and Dam/Dcm methylation, is the
[Enzymes tutorial](../tutorials/enzymes.md).

## The tab and the workspace

The tab is a slim panel for the common case, and the **Enzyme workspace** is
the rest. The tab has:

- a **Filter** box. With text in it the tab lists the enzymes whose name or
  site match, a dozen at most, then **and N more ›**, which opens the
  workspace on its list. Tick one there, or click where it cuts to select the
  site;
- a line, read aloud as a status: how many enzymes there are, how many of
  them cut once, more than once and not at all, and how many are ticked.
  When the DNA's host methylation blocks some ticked sites, it says how many
  (see [Where the DNA was grown](#where-the-dna-was-grown));
- with the box empty, the **ticked enzymes**, a row each (see
  [The enzyme table](#the-enzyme-table)), and **Hide all** under them;
- **Grown in**;
- how everything ticked would read on a gel, in a sentence, with **Digest ›**
  to the picture;
- **Open Enzyme workspace ›** and, when two enzymes could be paired,
  **Double digests ›**.

**Open Enzyme workspace ›** opens a larger view beside the map, as **Open
Align workspace ›** does for [Align](11-align.md#the-tab-and-the-workspace).
It has four pages down its left edge:

- **Enzymes** — the [enzyme table](#the-enzyme-table): every enzyme that
  cuts, with its filters and supplier, **Show listed** and **Hide all**, and
  the selected enzyme in full beside it.
- **Digest** — [the ticked enzymes](#the-digest-page) as chips, their digest
  on a gel, and a table of the fragments it cuts, to put on the shelf.
- **Double** — the best double digests, in a table with a gel under it (see
  [Choosing a diagnostic digest](#choosing-a-diagnostic-digest)).
- **Table** — the table in use, with **Import an enzyme table** and **Add an
  enzyme** open under it, and the enzymes of your own listed.

**Digest ›** and **Double digests ›** open it on those pages; **Open Enzyme
workspace ›** on the page it was left on. **Grown in** is in the
workspace's head, on every page, since it changes every page's answer. The
tab and the workspace share the filter and the ticks, so what is set in one
is set in the other. The workspace is a region of the window, not a dialog:
`Esc` with the keyboard inside closes it and puts the keyboard back on
**Open Enzyme workspace ›**, whichever link opened it, and choosing another
sidebar tab closes it too. On a phone it fills the screen.

## The enzyme table

The workspace's **Enzymes** page is a table of the enzymes that cut the
sequence — or, with isoschizomers sharing a row, of every group of enzymes
that cut it identically (see [Isoschizomers](#isoschizomers)). A row has:

- a **tick box** that chooses the enzyme: its cut sites are drawn in the
  views, and the Cloning tab digests with it;
- the **name**, with **+N** after it when N other enzymes share the row
  (hover it for their names);
- the **site**: the recognition site, 5′→3′ on the top strand (hover for
  what else is known of the enzyme, such as its suppliers after a REBASE
  import);
- the **overhang** the cut leaves: blunt, 5′ or 3′ (hover for how many
  bases);
- **Cuts**: how many times it cuts;
- the **positions**: the base after which the top strand is cut (a cut
  exactly at the origin of a circle is after its last base, so it reads as
  the sequence's length). Click one to select that recognition site in the
  views. A dozen are listed, then **+N** for the rest, and three on a phone;
- **Dam/Dcm**, for an enzyme these methylations can block: how many of its
  sites they may block, as _1 of 2_ (see
  [Dam and Dcm methylation](#dam-and-dcm-methylation));
- the **bands** this enzyme alone would give, largest first, as a gel would
  show them. Fragments within about 15 % of each other are written as one
  band (`2,181 ×2`), because that is what you would see. A ⚠ means the lane
  would hide something — pieces running as one band, or bands under 100 bp
  that may run off the end — and the tooltip says which. An enzyme that
  simply linearises the plasmid gets no mark: there is nothing to tell
  apart, which is not a fault.

The **Name**, **Overhang**, **Cuts** and **Bands** headings sort the table,
and say which way with an arrow: **Name** is the catalogue, A to Z.
**Overhang** puts blunt cutters first, then those leaving a 5′ overhang, then
a 3′ one, the shorter overhang first within each; **Cuts** puts the enzymes
that cut the fewest times first, so the unique cutters head the list. Ties in
either are in name order. **Bands** is _band separation_,
which puts the enzymes whose bands are easiest to tell apart on a gel first
and the ones whose bands would run together last, which is how a diagnostic
digest is actually chosen (see
[Choosing a diagnostic digest](#choosing-a-diagnostic-digest)). Click the
heading again to turn the order round, Z to A, the most cuts or longest
overhang first, or the lanes hardest to read first; click the other heading to start again from its top. The order is
remembered between sessions.

Move the mouse over a row and that enzyme's sites are stressed in the views
beside the table: a heavier mark and its name in the sequence view, a heavier
tick and a boxed label on the map, kept even where the ring is too crowded to
name every site. This works for an enzyme that is not ticked, so you can see
where it would cut before choosing it; the sites go as the mouse leaves the
row, and nothing is ticked or changed. A touch screen has no hover, so it
does not highlight. Highlighted sites are never part of an exported figure.

The table scrolls inside the page, so the line under it — how many enzymes
cut, and how many do not cut at all — stays where you left it however many
cut. Only the rows on screen are drawn, which is what keeps an imported
table of 1,500 enzymes responsive; a browser page search (Ctrl+F) will not
find an enzyme that is scrolled out of sight, so use the filter box for that.

### One enzyme in full

Click a row — anywhere but its tick box or a position — to see that enzyme
beside the table, or under it where there is not room. Click it again, or
press `Esc` with the keyboard in the table, to put it away; the next `Esc`
closes the workspace. The pane has:

- what is known of the enzyme: its overhang, its suppliers and every
  isoschizomer when there are some, the other enzymes in its row, and how
  many of its sites Dam or Dcm methylation may block;
- **every site it cuts**, each with the ten bases of the top strand either
  side of its recognition site, the methylation that overlaps it, and
  **Select**, which selects that site in the views. A four-base cutter can
  have thousands, so the first 200 are listed;
- **its lane alone**, on a gel, with its own bands to click;
- **Tick** or **Untick**, as the box in the row;
- **Find a partner ›**, which opens the **Double** page with the best
  partners for this enzyme already searched (see
  [A partner for one enzyme](#a-partner-for-one-enzyme)). It is off for an
  enzyme that cuts more than three times, which is not paired.

The keys are in [Keyboard shortcuts](14-shortcuts.md#workspaces): the
table is one stop in the tab order, `↑ ↓ Home End` walk the rows, and
the detail follows the selected one.

The tab's own rows, for the ticked enzymes and a search, carry the same tick,
name, site, positions and bands in a list instead of a table.

## Choosing which to show

- When a document opens, the enzymes that cut **exactly once** are ticked,
  so unique sites are on the map at once. If there are more than 50 of them
  — which happens with an imported REBASE table, where a small fragment can
  have ninety unique cutters — nothing is ticked instead, because ninety
  labels is a wall rather than a starting point. The tab then offers **Tick
  the N enzymes that cut once** if you want them after all; with a **Cuts**
  filter set, it offers those instead — **Tick the N enzymes that cut
  twice**.
- A cloning product the app makes opens with just the enzymes the reaction
  used ticked instead: the enzymes at the joined ends of a **Ligation**, the
  two enzymes of a primer-workspace **Simulate** (cloning mode), the Type IIS
  enzyme (and the second one, when set) of a **Golden Gate** or **Modular**
  assembly, and the template's own ticks for a **mutagenesis** mutant. An
  enzyme the product no longer cuts (BsaI after Golden Gate) is still ticked,
  with nothing to mark. Gibson, PCR, Overlap PCR, Gateway, Yeast assembly, fragments,
  back-translations and comparisons open with the default above. This only
  sets the opening state: it is not saved in a file, is not an edit and
  does not mark the document changed, and a product reopened from storage keeps
  the ticks it was left with.
- Tick or untick individual enzymes. **Show listed** ticks every enzyme
  currently in the (filtered) list, **Hide all** clears them. Show listed
  asks for a narrower list past 200 enzymes: more labels than that is more
  than the views can draw.
- **Filter** by name (`Eco`) or by site (`GGATCC`).
- **Cuts** lists only the enzymes that cut a chosen number of times: once (a
  unique site to clone into), twice, once or twice, or three times or fewer.
  A **diagnostic digest** is the usual reason for wanting more than one — an
  enzyme that cuts twice gives two bands to check a construct against, where
  a unique cutter only linearises it. **Any number** is the default.
- **Bands**, the table's heading, sorts by band separation. Bands twice as
  long as each other are as distinct as bands ever get, so past that the
  order prefers a lane whose smallest band is bright — 500 bp or more on a
  1 % gel — over one with a faint sliver at the foot. Turned round, it
  lists the lanes hardest to read first.
- **Sold by** narrows the list to one supplier's catalogue. It appears only
  after you import a REBASE table, which is where the supplier information
  comes from.

- **Isoschizomers share a row** is described [below](#isoschizomers).

**Cuts**, the order (and its direction), **Sold by** and **Isoschizomers** are remembered between sessions, like
the toolbar's view settings: they say what you are generally looking for
rather than anything about the document. The name filter is not — it is a
question about the list in front of you, not a standing choice.

Cut sites of the ticked enzymes are drawn in the sequence view (a mark with
the enzyme name above the bases) and on the map (labels around the ring), and
they are included in **File ▸ Export figure…**, where the map's
**Restriction enzymes** toggle can leave them off the figure.

## Choosing a diagnostic digest

Set **Cuts** to _Twice_ and click the **Bands** heading. The enzyme at the
top gives the two bands easiest to read, which is the one to run. On pBR322
that is HincII, at 3,254 + 1,107 bp, with BstAPI and DrdI (3,948 + 413) just
behind it; BtsI also cuts twice, but its two cuts are 20 bp apart, so it is
at the bottom with a ⚠ and one band you could see.

When no single enzyme will do, the **Double** page lists the twenty best
pairs of the enzymes listed, one to a row, judged by the same rule on the
digest with both — on pBR322, EagI + MscI at 3,854 + 507 bp. It pairs only
enzymes that cut three times or fewer, and follows the other filters, so
_Sold by_ narrows the pairs to what you can buy from one place. A pair whose
second enzyme cuts only where the first already does is left out, since it
is the same digest as one enzyme alone. Under the table is a gel of the
pair on the row you chose — the best one until you click another, or move to
it with the arrow keys and press `Enter` — with a lane for each enzyme alone
and a last one, **Both**; choosing a row ticks nothing. **Tick both** ticks
that pair and nothing else, so the map follows and the Digest page is its
digest. With a big imported table only the 120 enzymes that cut least are
paired; narrow the list to pair the others.

### A partner for one enzyme

Often the question is narrower: _what do I cut with EcoRI to check this?_
Select EcoRI in the table and choose **Find a partner ›**, or set **Pair**
above the table to _EcoRI with a partner_, and the
twenty best partners for it are listed, looked for among **every** enzyme
that cuts three times or fewer — the name filter and the **Cuts** filter do
not narrow them, only **Sold by** does. With exactly one enzyme ticked, the
page offers **Find a partner for** it in one click. Set **Pair** back to
_any two listed enzymes_ for the pairs of the list.

Tick a candidate and the Digest page says what the whole digest would look
like — several enzymes ticked together give a lane none of their own rows
can predict.

### A double digest beside the single ones

Tick two enzymes (or three) and the gel on the Digest page draws a lane for
each of them alone and a last lane, **Both** (or **All 3**), for the digest
with all of them —
the way a double digest is run at the bench, so a band can be read off
against the lanes that explain it. A band in **Both** that is in neither
single lane is the piece between the two enzymes' sites. The sizes are
written beside the combined lane; hover a band in any lane for its size, and
the line under the gel lists what each enzyme gives alone. Tick four or more
and the gel goes back to one lane for them all.

## Isoschizomers

Enzymes from different organisms often recognise the same site and cut it
in the same place — BamHI, BstI and a dozen others all cut `G^GATCC`. They
give the same fragments with the same ends, so at the bench they are one
choice whatever the label on the tube. With **Isoschizomers share a row**
on (the default), they are listed as one row: an imported REBASE table
of about 1,580 enzymes becomes about 400 rows.

- The row carries the best-known name: an enzyme from the bundled table if
  there is one, otherwise the one sold by most companies. A name you
  searched for, or one you ticked, takes its place, and with **Sold by**
  set only that supplier's enzymes can name the row.
- Ticking the row ticks the enzyme named on it, and unticking it unticks
  every enzyme in the row.
- When a document opens and its single cutters are ticked, one enzyme per
  row is ticked, so one cut is drawn with one label rather than twelve.
- The line under the table still counts enzymes, and says how many rows
  they take.

Enzymes that recognise the same site but cut it differently —
_neoschizomers_ such as SmaI (`CCC^GGG`, blunt) and XmaI (`C^CCGGG`, 5′
overhang) — keep separate rows, because the ends they leave are what a
cloning plan depends on. Turn **Isoschizomers share a row** off to list every enzyme on
its own.

## Hiding the cut sites without losing the choice

**Cut sites** in the toolbar, next to Complement and Translations, hides
every drawn cut site at once — useful when a map with a dozen labels is too
busy to read. The ticks stay exactly as they are, so switching it back on
restores the same set; no need to untick and re-tick a carefully chosen list.
The toggle is remembered between sessions (see
[Viewing and selecting](03-viewing.md)); the ticks are not, they start again
at the single cutters of each document you open (or at nothing, with a big
table).

While it is off:

- the sequence view, the map and **File ▸ Export figure…** draw no cut
  sites;
- the Digest page's gel and fragments and the
  [Cloning](12-cloning.md) tab's digest are unchanged — they follow the
  ticks, not the toggle.

The Enzymes tab says so while the sites are hidden, and offers a **Show cut
sites** link to bring them back.

## The Digest page

The **Digest** page of the workspace is where the ticked enzymes are cut. It
is off, with a note in its heading, while nothing is ticked; **Tick
enzymes** takes you to the list.

Across the top, the ticked enzymes are **chips**: the × on one unticks it
(the same ticks as the Enzymes page and the tab), **Untick all** clears
them, and a chip drawn dashed is an enzyme that does not cut this DNA, or
whose every site its methylation blocks.

The **gel** draws the lane a complete digest with all ticked enzymes would
give (with a lane for each enzyme alone beside it when two or three are
ticked), beside a ladder — 1 kb, or 100 bp when everything is small, unless
you choose one (see [The gel](#the-gel) below). A short band is drawn faint,
because a stain binds DNA by mass and a 200 bp band really is faint next to
a 4 kb one. **Click a band to select that piece** — in a single enzyme's
lane, the piece that enzyme alone cuts — in the sequence view and on the map;
where two pieces run together, the click takes the larger one, and the band
says so when you hover it. Under it, **On a gel** says in words what the
picture cannot: which pieces would run together, and whether any are too
small to stay on the gel. The gel is drawn larger than the tab's, where the
window has the room.

Beside it (or under it, in a narrow window) is the **table of fragments**,
largest first — on a circular molecule, n cuts give n fragments; on a linear
one, n + 1. A row has the piece's number, its length, its span (1-based, and
round the origin on a circle), the enzyme that cut each end with the
overhang it left (hover for the full description) and the features it
carries. Point at a row, or move to it with the arrow keys, and the piece is
drawn on the map and the sequence view, the way the Cloning tab's rows do;
click a row, or press `Enter` on it, to select the piece. **Add** puts it on
the shelf, to be joined on the Bench (and **Add again** puts a second copy
there, which a tandem insert needs); clicking the piece on the map adds it
too. **Open the Bench ›** under the table goes there.

**Partial digest** lists every piece a digest that missed some of the sites
could give, not only the complete digest's: with two EcoRI sites on a
plasmid, the two complete pieces and the circle opened at either site. A
piece says how many sites it left **uncut**; the table lists the 200 that
miss the fewest, and only the row under the pointer is drawn on the views,
since the pieces overlap. The gel stays the complete digest. The choice is
remembered for each document. It lives only here: the Cloning tab's Digest
links to this page instead of having a toggle of its own.

When the document's host methylation blocks some of the ticked sites, the
page says how many are left out and which enzymes they are (see
[Where the DNA was grown](#where-the-dna-was-grown)).

### The gel

Under every drawn gel — on the Digest page and in the
[Cloning](12-cloning.md) tab's PCR — two menus say what it is a picture of:

- **Agarose**: 0.7, 1, 1.5 or 2 %. A thinner gel spreads out large
  fragments and loses small ones off the end; a thicker one the reverse. The
  choice changes the drawing and everything judged from it: the ⚠ on a row,
  the **Band separation** order and the double digests offered.
- **Ladder**: chosen to fit what is run (1 kb, or 100 bp when everything is
  under 1.5 kb), or always the 1 kb, the 1 kb Plus (both scales in one
  lane) or the 100 bp one.

Both are remembered between sessions.

The gel is a rule of thumb, not a simulation: band positions are
calculated from the length, and two fragments within about 15 % of each
other are called one band. Each percentage has a range it separates well —
0.7 % from about 800 bp to 12 kb, 1 % from 500 bp to 10 kb, 1.5 % from
200 bp to 4 kb, 2 % from 100 bp to 2 kb. More than one fragment above the
top of it will compress near the well, and anything under a fifth of the
foot of it (100 bp on a 1 % gel, 20 bp on a 2 % one) may run off the end.
Your gel may do better or worse.

To join the fragments into a new construct, put them on the shelf and use
the Bench (see [Cloning](12-cloning.md)).

## How to check whether an enzyme is a unique cutter

1. Open the **Enzymes** tab.
2. Type the enzyme name in the filter box.
3. Look at the number of cut positions in its row; in the workspace's table
   it is the **Cuts** column. To list all unique cutters at once, open the
   workspace and set **Cuts** to _Once_.

## Importing the full REBASE table

The bundled table is deliberately small: the enzymes most people clone with.
For everything else — and for supplier and isoschizomer information —
import [REBASE](https://rebase.neb.com), the restriction enzyme database
Richard Roberts and colleagues have maintained since 1975.

PlasmidPop cannot download it for you. REBASE files are copyright "all
rights reserved", so we have no right to ship them, and rebase.neb.com does
not allow a web page to fetch them. You download the file; the app reads it.

1. Open the **Enzymes** tab, then its workspace, and go to the **Table**
   page. **Import an enzyme table** is open there.
2. Follow **Download withrefm from REBASE**. The file opens as plain text in
   a new tab — save it with Ctrl+S, or right-click the link and choose _Save
   link as_. It is about 4 MB.
3. Back in PlasmidPop, click **Choose file…** and pick what you saved
   (usually `link_withrefm.txt`), or drop the file onto the section. The
   picker asks for text files; if your browser saved it without an
   extension, switch the picker to _All files_.

The table is read in your browser, kept in this browser's local storage, and
never uploaded anywhere. It survives reloads, and the Table page says which
release it is scanning with. **Go back to the bundled table** undoes the
import.

Of the roughly 6,100 records in REBASE, about 1,580 become usable enzymes.
The section reports what it left out: enzymes whose cut position nobody has
determined, and the ones that cut at a modified base rather than at a
sequence (AbaSI, MspJI and kin), whose REBASE site is a base or two and
would otherwise appear to cut everywhere.

A few enzymes are written in REBASE with only their top-strand cut
(HauII's `TGGCCANNNNNNNNNNN^`); PlasmidPop knows the other cut for the ones
it has checked. If a later REBASE writes one of them differently, or adds a
new one, the import leaves it out rather than guess, and lists it under the
summary as a warning. Such an enzyme is worth reporting as an issue.

About 27 of them — BcgI, BaeI, CspCI, BsaXI and kin — cut on _both_ sides
of their recognition site, cutting it out on a piece of about 30 bp. Each
site of theirs is two cuts, so such an enzyme with one site in your plasmid
is listed as cutting twice, draws two cut marks, and in a digest cuts out
the short piece carrying the site. The tooltip on
its recognition site says so. They are not offered for Golden Gate. A table
imported before version 1.2 does not have them; import it again to add
them.

Scanning with the whole table takes about 15 ms on a 4 kb plasmid instead of
3 ms, and about 130 ms on a 50 kb construct, in the background.

If you publish work that used it, please cite REBASE: Roberts RJ, Vincze T,
Posfai J, Macelis D, _REBASE — a database for DNA restriction and
modification: enzymes, genes and genomes_, Nucleic Acids Research.

## Adding your own enzyme

For an engineered enzyme, a nicking or homing enzyme the table lacks, or a
site you want to treat as an "enzyme" in a Golden Gate design, use
**Add an enzyme** on the Enzyme workspace's **Table** page, open under the
import. Give it a name and its recognition site in REBASE notation:

- `G^AATTC` — the caret is the top-strand cut; the bottom strand is cut
  symmetrically (EcoRI, a 4-base 5′ overhang).
- `G^AATT_C` — the same with the bottom-strand cut written out after the
  underscore, for a cut that is not the mirror image.
- `GGTCTC(1/5)` — a Type IIS enzyme: the cuts fall 1 base (top) and 5 bases
  (bottom) past the 3′ end of the site. Negative numbers count back into the
  site, and `(10/12)CGANNNNNNTGC(12/10)` cuts on both sides.
- IUPAC codes (`R`, `Y`, `N`, …) work in either case. A caret after N padding
  (`GGTCTCN^NNNN_`) needs the underscore, because the caret alone does not
  say where the bottom strand is cut.

The section shows how the site was read: where the top and bottom strands are
cut, the overhang that leaves, and whether the site is palindromic. **Save
enzyme** stores it in this browser, and it is at once in the sites list,
digests, Golden Gate and the diagnostic ranking, like any other enzyme. It
is read by the same code as the REBASE import, so both mean the same by a
notation. Your enzymes survive a reload and an imported table (importing or
**Go back to the bundled table** leaves them alone); use **Remove**, beside it
under **Your enzymes**, to delete one. The page's tab in the workspace's rail
counts them. A name already in the table in use is refused, and a
site with too few specific bases to be a real cutter is too.

## Notes

The bundled table was typed from supplier catalogues and has no supplier,
isoschizomer or methylation information; an imported REBASE table adds all
three (hover an enzyme's recognition site to see them). What REBASE calls
the methylation site is where the enzyme's _own_ methyltransferase modifies
the site — it is not a statement about Dam or Dcm methylation from your
_E. coli_ strain, which is the next section.

## Dam and Dcm methylation

Most laboratory _E. coli_ strains methylate the DNA they copy: Dam puts a
methyl group on the A of every GATC, Dcm on the inner C of every CCAGG and
CCTGG. Some enzymes will not cut, or cut poorly, where that methyl group
lands inside their site — sometimes only when a GATC or CCWGG is made by the
site together with the bases beside it, as with XbaI in `GATCTAGA`.

For the enzymes New England Biolabs lists as blocked or impaired, the
Enzymes tab looks at the bases around each site. Which methylase matters,
and how much of the site it must reach, is per enzyme, taken from REBASE's
tables of overlapping methylation: BstXI, AlwNI and PflMI ignore a GATC
inside their N bases, and SfoI is blocked only when CCWGG methylates both
ends of its site, not one. FokI is impaired when a CCWGG ends in the first
GG of its `GGATG`, as in `CCAGGATG`, the one way Dcm reaches its site. A few enzymes NEB lists as sensitive have no
such table in REBASE (BclI, DpnII, BssKI, BcgI, FspI and PhoI); for those,
any Dam or Dcm methyl group inside the site counts. A cut position whose site a Dam or Dcm methyl
group would fall in, in a way that enzyme is sensitive to, is marked with a small **m** and
written in the warning colour; hovering it says which. The table's **Dam/Dcm**
column (it is there only when some enzyme in the list has a site that could be
blocked) says how many of its sites are affected — _1 of 2_ — and the enzyme's
detail says it in words, _1 of 2 sites may be blocked by Dam/Dcm
methylation_, and marks the sites, with the methylase, in its list of them.
The enzyme's tooltip says it is a sensitive one.

On pBR322, for example, the MscI site is inside a CCTGG and the BspEI site
inside a GATC, so plasmid grown in an ordinary strain may not cut there.

### Where the DNA was grown

Whether those marks matter depends on where the DNA came from, and the
document says so: **Grown in**, in the tab and in the workspace's head, is one of
**dam+/dcm+** (an ordinary laboratory strain of E. coli, and the default
for any plasmid), **dam+ only**, **dcm+ only**, or **unmethylated** — DNA
from a `dam− dcm−` strain, from mammalian cells, or straight out of a PCR.
A product the PCR panel makes is unmethylated from the start.

What it changes is the cutting, not the marking. A site stays marked
whatever the host is, because "this would be blocked in a dam+ strain" is
worth knowing about DNA that is not in one. But a site the host's
methylation does block is left out of:

- the fragments and the gel on the Digest page;
- the double-digest ranking, so an enzyme this DNA would silence is not
  offered as a partner;
- the Cloning tab's digest, and so the shelf, the ligation and the gel
  there.

On pBR322 that is the difference the guide's own example turns on: EagI +
MscI is a clean two-band digest on paper, and plasmid from an ordinary
strain will not give it, because the MscI site is Dcm-blocked.

The Cloning tab says when it has left a site out for this reason, and when
every ticked enzyme is blocked it says so rather than claiming nothing is
ticked.

A piece of a molecule is that molecule's DNA: a selection exported as a
file, a digest fragment put on the shelf or opened as a document, keeps the
host of the document it came from, so a fragment of a PCR product stays
unmethylated. A ligation, Golden Gate, Gibson or Gateway product is what
you would transform and grow, so it starts as dam+/dcm+. A yeast assembly
product is made and isolated in yeast, which has neither Dam nor Dcm, so it
starts unmethylated; set **Grown in** if you took it through E. coli.

Changing it is an edit like any other, so **Undo** takes it back, and it is
saved with the document: GenBank has nowhere to put it, so it travels as a
comment line of ours (`PlasmidPop-methylation: ...`), the way sticky ends
do. A SnapGene file brings its own setting with it — the flags its sequence
packet carries — and a file that says nothing is read as an ordinary
plasmid.

Cut positions are given on the top strand; the bottom-strand cut and the
overhang are used by the Cloning tab.
